import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import { COOKIE_NAME, verifyToken } from '../auth/jwt.js';
import { db } from '../db/index.js';
import QRCode from 'qrcode';
import {
  createVisit, signOutVisit, getById, getByPublicToken,
  listActive, listAll, sanitizeForWall, getSignoutCode, signOutByCode,
} from '../services/visits.js';
import { getSignoutMode } from '../services/settings.js';
import { renderBadge } from '../services/badge.js';
import { photoFileFor } from '../services/photo.js';
import { getSetting } from '../services/settings.js';
import { publicLimiter } from '../middleware/rateLimits.js';

const router = Router();

const BADGE_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "script-src-attr 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

// Rate limit on the public sign-out path. Skipped under NODE_ENV=test so the
// existing suite (which fires sign-outs back to back) isn't perturbed.
const signOutLimiter = publicLimiter({
  max: 10,
  message: 'too many sign-out requests, slow down',
});

const ackSchema = z.object({
  kind: z.enum(['nda', 'safety']),
  signedName: z.string().max(128).nullable().optional(),
  signaturePngBase64: z.string().max(2_000_000).nullable().optional(),
});

const createSchema = z.object({
  visitorName: z.string().min(1).max(128),
  company: z.string().max(128).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  hostUserId: z.number().int().positive().optional(),
  purpose: z.string().max(256).nullable().optional(),
  fields: z.record(z.string(), z.any()).optional(),
  kioskSlug: z.string().min(1).max(64).nullable().optional(),
  acknowledgments: z.array(ackSchema).optional(),
  inviteToken: z.string().min(8).max(128).nullable().optional(),
  photoPngBase64: z.string().max(5_000_000).nullable().optional(),
}).refine(
  (data) => data.hostUserId || data.inviteToken,
  { message: 'hostUserId or inviteToken required' },
);

// Public: the kiosk creates visits without auth. Rate-limited per IP because
// every sign-in can fan out to host email/SMS (SMS costs money), so an
// unthrottled script could flood hosts and run up the provider bill.
const createLimiter = publicLimiter({
  max: 30,
  message: 'too many sign-ins from this device, slow down',
});

router.post('/', createLimiter, (req, res, next) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request', details: parse.error.flatten() });
  try {
    const v = createVisit({
      visitorName: parse.data.visitorName,
      company: parse.data.company ?? null,
      email: parse.data.email ?? null,
      phone: parse.data.phone ?? null,
      hostUserId: parse.data.hostUserId,
      purpose: parse.data.purpose ?? null,
      fields: parse.data.fields ?? {},
      kioskSlug: parse.data.kioskSlug ?? null,
      acknowledgments: parse.data.acknowledgments ?? [],
      inviteToken: parse.data.inviteToken ?? null,
      photoPngBase64: parse.data.photoPngBase64 ?? null,
    });
    res.status(201).json({ visit: v });
  } catch (e) { next(e); }
});

// Sanitized active-list — wall view at /active reads this. Public by default;
// when admins flip the wall_view.public setting off (workshops doing sensitive
// client work), the endpoint requires an admin/security session cookie.
router.get('/active', (req, res) => {
  const isPublic = getSetting('wall_view.public');
  if (isPublic === false) {
    const callerId = tryIdentifyUser(req);
    const ok = callerId
      ? db.prepare("SELECT 1 AS ok FROM users WHERE id = ? AND role IN ('admin','security') AND active = 1").get(callerId)?.ok
      : null;
    if (!ok) return res.status(401).json({ error: 'wall view requires sign-in' });
  }
  const kioskSlug = req.query.kiosk || null;
  const visits = listActive({ kioskSlug }).map(sanitizeForWall);
  res.json({ visits, asOf: new Date().toISOString() });
});

// Token-keyed badge — public, but the random 64-hex token in the URL is
// unguessable, so this can't be enumerated by walking visit ids.
router.get('/badge/:token', async (req, res, next) => {
  try {
    const v = getByPublicToken(req.params.token);
    if (!v) return res.status(404).type('text/plain').send('visit not found');
    // QR with the sign-out URL: scanned by the kiosk (USB/Bluetooth scanner
    // types it into the sign-out field) or by the visitor's phone camera.
    const code = getSignoutCode(v.id);
    const signoutQrSvg = code
      ? await QRCode.toString(signoutUrl(req, code), { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
      : null;
    res.set('Cache-Control', 'private, no-store');
    // The badge is a standalone print page with an inline print script and
    // inline styles; all user data in it is HTML-escaped by renderBadge.
    res.set('Content-Security-Policy', BADGE_CSP);
    res.type('text/html').send(renderBadge(v, { signoutQrSvg, signoutCode: code }));
  } catch (e) { next(e); }
});

// Token-keyed photo — same deal. 404 once the retention sweep purges it.
router.get('/photo/:token', (req, res) => {
  const v = getByPublicToken(req.params.token);
  if (!v) return res.status(404).type('text/plain').send('photo not available');
  const file = photoFileFor(v.id);
  if (!file) return res.status(404).type('text/plain').send('photo not available');
  res.set('Cache-Control', 'private, no-store');
  res.type('image/png').sendFile(file);
});

// Sign-out. Public when called without auth (visitor self-signs-out at kiosk),
// admin/security when called with a valid session cookie (force sign-out).
// Rate-limited on the public path; admin/security with auth bypasses the
// limiter because their sign-outs are deliberate and audited.
// Visitor self sign-out with the code from their badge QR. Public and
// rate-limited; the code is 128 random bits, so it can't be guessed.
const badgeSignOutSchema = z.object({
  code: z.string().regex(/^[0-9a-f]{32}$/, 'invalid badge code'),
}).strict();

router.post('/sign-out/badge', signOutLimiter, (req, res, next) => {
  const parse = badgeSignOutSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid badge code' });
  try {
    const v = signOutByCode(parse.data.code);
    res.json({ visit: publicSignOutView(v) });
  } catch (e) { next(e); }
});

// Sign-out by visit id. Admin/security with a session cookie can always
// force a sign-out. Without a session it is only allowed when the site has
// opted into the legacy 'list' kiosk mode: ids are sequential, so in the
// default 'badge' mode an anonymous caller could otherwise sign out anyone.
router.post('/:id/sign-out', signOutLimiter, (req, res, next) => {
  const id = Number(req.params.id);
  const callerId = tryIdentifyUser(req);
  const isAdminOrSecurity = callerId
    ? db.prepare("SELECT 1 AS ok FROM users WHERE id = ? AND role IN ('admin','security') AND active = 1").get(callerId)?.ok
    : null;

  if (!isAdminOrSecurity && getSignoutMode() !== 'list') {
    return res.status(403).json({ error: 'sign out by scanning the QR code on your badge, or ask reception', code: 'BADGE_SIGNOUT_REQUIRED' });
  }

  try {
    const v = signOutVisit({
      visitId: id,
      byUserId: isAdminOrSecurity ? callerId : null,
      method: isAdminOrSecurity ? 'admin' : 'kiosk',
    });
    // Anonymous callers get the minimum the kiosk shows ("Goodbye, Ana"),
    // not the visitor's contact details.
    res.json({ visit: isAdminOrSecurity ? v : publicSignOutView(v) });
  } catch (e) { next(e); }
});

// Admin/security routes below.
router.use(requireAuth, blockIfPasswordChangeRequired, requireRole('admin', 'security'));

router.get('/', (req, res) => {
  const status = req.query.status || null;
  const kioskSlug = req.query.kiosk || null;
  res.json({ visits: listAll({ status, kioskSlug, limit: 500 }) });
});

router.get('/:id', (req, res) => {
  const v = getById(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'visit not found' });
  res.json({ visit: v });
});

function publicSignOutView(v) {
  return { id: v.id, visitorName: v.visitorName, signedOutAt: v.signedOutAt ?? null };
}

function signoutUrl(req, code) {
  // Prefer the configured public URL; fall back to the host the badge was
  // requested on (the kiosk's own view of the server).
  const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}/kiosk/signout/${code}`;
}

function tryIdentifyUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    return payload.sub;
  } catch {
    return null;
  }
}

export default router;
