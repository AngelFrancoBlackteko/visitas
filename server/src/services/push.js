import webpush from 'web-push';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getSetting, setSetting } from './settings.js';
import { createPending, markSent, markFailed } from './notificationsLog.js';

/**
 * Browser push notifications (Web Push, RFC 8030 + VAPID, RFC 8292).
 *
 * A signed-in user (normally a host) opts a device in from the admin UI.
 * The browser returns a subscription: an endpoint URL at the browser
 * vendor's push service plus two keys. We store it and, when a visitor
 * signs in for that host, send an end-to-end encrypted message to that
 * endpoint. Only the browser holding the private key can read it.
 *
 * No third-party account or API key is needed. The server needs outbound
 * HTTPS to the push services, and the page must be served over HTTPS
 * (browsers refuse push on plain-HTTP origins other than localhost).
 */

const VAPID_SETTING_KEY = 'push.vapid';
const MAX_DEVICES_PER_USER = 10;

// The server POSTs to whatever endpoint a browser hands over, so only
// accept the real push services. Without this, any signed-in user could
// make the server send requests to arbitrary hosts (SSRF).
const ALLOWED_PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,               // Chrome, Edge (Android), Samsung, Opera
  /^android\.googleapis\.com$/,           // older Chrome
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,               // Safari on iPhone/iPad (16.4+) and macOS
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,    // Edge on Windows
];

let testSender = null;

/** Test seam: `async (subscription, payloadJson) => void`; throw `{ statusCode }` to simulate a push-service error. */
export function setPushSenderForTests(fn) {
  testSender = fn;
}

export function pushEnabled() {
  return config.notifications?.push?.enabled !== false;
}

export function isAllowedEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return ALLOWED_PUSH_HOSTS.some(re => re.test(u.hostname));
}

/**
 * VAPID key pair. VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env vars win; else a
 * pair is generated on first use and kept in the settings table, so
 * existing subscriptions survive restarts. Changing keys invalidates every
 * subscription (devices must opt in again).
 */
export function getVapidKeys() {
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv };

  const saved = getSetting(VAPID_SETTING_KEY);
  if (saved?.publicKey && saved?.privateKey) return saved;

  const fresh = webpush.generateVAPIDKeys();
  setSetting(VAPID_SETTING_KEY, fresh);
  return fresh;
}

function vapidSubject() {
  const env = process.env.VAPID_SUBJECT?.trim();
  if (env) return env;
  // Push services want a contact: an https URL or a mailto:.
  if (config.baseUrl.startsWith('https://')) return config.baseUrl;
  return 'mailto:admin@visitas.world';
}

export function listForUser(userId) {
  return db.prepare(`
    SELECT id, user_agent AS userAgent, created_at AS createdAt, last_success_at AS lastSuccessAt
    FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC
  `).all(userId);
}

/**
 * Store (or move) a device subscription for this user. An endpoint belongs
 * to one browser profile; if another user subscribed it before (shared
 * device), it now belongs to whoever subscribed last.
 */
export function subscribe({ userId, endpoint, p256dh, auth, userAgent = null }) {
  if (!isAllowedEndpoint(endpoint)) {
    const err = new Error('unsupported push service');
    err.status = 400;
    throw err;
  }
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = datetime('now')
    `).run(userId, endpoint, p256dh, auth, userAgent ? String(userAgent).slice(0, 256) : null);

    // Cap devices per user: drop the oldest beyond the limit.
    db.prepare(`
      DELETE FROM push_subscriptions
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
      )
    `).run(userId, userId, MAX_DEVICES_PER_USER);
  });
  tx();
}

/** Remove a device. Only the owner's own subscription is touched. */
export function unsubscribe({ userId, endpoint }) {
  const info = db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
  return info.changes > 0;
}

/**
 * Send `{ title, body, url, tag }` to every device of `userId`.
 * Every attempt lands in notifications_log (kind 'push', recipient
 * 'user:<id>' — never the endpoint, which is a bearer secret).
 * Devices the push service reports gone (404/410) are deleted.
 * Never throws; returns { sent, failed }.
 */
export async function sendPushToUser(userId, message, { event = 'unspecified' } = {}) {
  const result = { sent: 0, failed: 0 };
  if (!pushEnabled()) return result;
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (!subs.length) return result;

  const payload = JSON.stringify({
    title: String(message.title ?? '').slice(0, 120),
    body: String(message.body ?? '').slice(0, 500),
    url: safeRelativeUrl(message.url),
    tag: message.tag ? String(message.tag).slice(0, 64) : undefined,
  });

  let vapid = null;
  for (const s of subs) {
    const logId = createPending({ kind: 'push', event, recipient: `user:${userId}`, subject: null });
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      if (testSender) {
        await testSender(subscription, payload);
      } else {
        vapid ??= getVapidKeys();
        await webpush.sendNotification(subscription, payload, {
          TTL: 60 * 60,           // a visitor alert older than an hour is useless
          urgency: 'high',
          timeout: 10_000,
          vapidDetails: { subject: vapidSubject(), publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        });
      }
      db.prepare("UPDATE push_subscriptions SET last_success_at = datetime('now') WHERE id = ?").run(s.id);
      markSent(logId);
      result.sent += 1;
    } catch (err) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      }
      markFailed(logId, code ? `push service ${code}${code === 404 || code === 410 ? ' (device removed)' : ''}` : err);
      logger.error({ err: err?.message, statusCode: code, userId }, 'push send failed');
      result.failed += 1;
    }
  }
  return result;
}

// Only same-origin paths may be opened from a notification click.
function safeRelativeUrl(url) {
  const u = typeof url === 'string' ? url : '';
  return /^\/(?!\/)[\w\-./?=&%#]*$/.test(u) ? u : '/admin/active-visitors';
}
