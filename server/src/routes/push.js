import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, blockIfPasswordChangeRequired } from '../middleware/auth.js';
import {
  getVapidKeys, pushEnabled, listForUser, subscribe, unsubscribe, sendPushToUser,
} from '../services/push.js';
import { t } from '../i18n/index.js';

// Browser push opt-in for signed-in users (hosts, admin, security). Every
// route acts only on the caller's own devices.
const router = Router();
router.use(requireAuth, blockIfPasswordChangeRequired);

const b64url = (max) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/);

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: b64url(256),
    auth: b64url(64),
  }),
});

const endpointSchema = z.object({ endpoint: z.string().url().max(2048) }).strict();

router.get('/config', (_req, res) => {
  if (!pushEnabled()) return res.json({ enabled: false, publicKey: null });
  res.json({ enabled: true, publicKey: getVapidKeys().publicKey });
});

router.get('/subscriptions', (req, res) => {
  res.json({ devices: listForUser(req.user.id) });
});

router.post('/subscriptions', (req, res, next) => {
  if (!pushEnabled()) return res.status(409).json({ error: 'push notifications are turned off on this server' });
  const parse = subscriptionSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid subscription' });
  try {
    subscribe({
      userId: req.user.id,
      endpoint: parse.data.endpoint,
      p256dh: parse.data.keys.p256dh,
      auth: parse.data.keys.auth,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ devices: listForUser(req.user.id) });
  } catch (e) { next(e); }
});

router.post('/unsubscribe', (req, res) => {
  const parse = endpointSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid request' });
  const removed = unsubscribe({ userId: req.user.id, endpoint: parse.data.endpoint });
  res.json({ removed, devices: listForUser(req.user.id) });
});

router.post('/test', async (req, res, next) => {
  try {
    const r = await sendPushToUser(req.user.id, {
      title: t('push.test.title'),
      body: t('push.test.body'),
      url: '/admin/active-visitors',
      tag: 'test',
    }, { event: 'test_push' });
    res.json(r);
  } catch (e) { next(e); }
});

export default router;
