import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, createUser, agentFor, client, row, rows } from './helpers.js';
import { config } from '../src/config.js';
import { setPushSenderForTests, isAllowedEndpoint, getVapidKeys, sendPushToUser } from '../src/services/push.js';
import { notifyVisitEvent, notifySigninBlocked } from '../src/notifications/index.js';
import { createVisit } from '../src/services/visits.js';
import { db } from '../src/db/index.js';
import webpush from 'web-push';

const ORIGINAL_NOTIFICATIONS = JSON.parse(JSON.stringify(config.notifications));
const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';
const APPLE = 'https://web.push.apple.com/QGx-device-token';
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

let pushes;
beforeEach(() => {
  resetDb();
  config.notifications = { email: { enabled: false }, sms: { enabled: false } };
  pushes = [];
  setPushSenderForTests(async (sub, payload) => { pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) }); });
});
afterEach(() => {
  setPushSenderForTests(null);
  config.notifications = JSON.parse(JSON.stringify(ORIGINAL_NOTIFICATIONS));
});

async function hostAgent(username = 'host1') {
  const host = createUser({ username, displayName: 'Host One', role: 'admin' });
  return { host, agent: await agentFor(username, host.password) };
}

describe('push subscriptions API', () => {
  test('requires a session', async () => {
    expect((await client().get('/api/push/config')).status).toBe(401);
    expect((await client().post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS })).status).toBe(401);
  });

  test('config returns a stable VAPID public key', async () => {
    const { agent } = await hostAgent();
    const a = await agent.get('/api/push/config');
    expect(a.status).toBe(200);
    expect(a.body.enabled).toBe(true);
    expect(a.body.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await agent.get('/api/push/config')).body.publicKey).toBe(a.body.publicKey);
    expect(JSON.stringify(a.body)).not.toContain(getVapidKeys().privateKey);
  });

  test('a host subscribes a device, sees it, and removes it', async () => {
    const { host, agent } = await hostAgent();
    const r = await agent.post('/api/push/subscriptions').send({ endpoint: FCM, expirationTime: null, keys: KEYS });
    expect(r.status).toBe(201);
    expect(r.body.devices).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toContain(FCM); // the endpoint is a bearer secret
    expect(row('SELECT user_id FROM push_subscriptions WHERE endpoint = ?', FCM).user_id).toBe(host.id);

    const del = await agent.post('/api/push/unsubscribe').send({ endpoint: FCM });
    expect(del.body).toMatchObject({ removed: true, devices: [] });
  });

  test('rejects endpoints that are not a known push service (SSRF guard)', async () => {
    const { agent } = await hostAgent();
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://169.254.169.254/latest/meta-data',
      'https://evil.example.com/push',
      'https://fcm.googleapis.com.evil.com/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
    ]) {
      const r = await agent.post('/api/push/subscriptions').send({ endpoint, keys: KEYS });
      expect(r.status, endpoint).toBe(400);
    }
    expect(rows('SELECT * FROM push_subscriptions')).toHaveLength(0);
    expect(isAllowedEndpoint(APPLE)).toBe(true);
    expect(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
  });

  test('rejects malformed keys', async () => {
    const { agent } = await hostAgent();
    expect((await agent.post('/api/push/subscriptions').send({ endpoint: FCM, keys: { p256dh: 'not base64!', auth: 'x' } })).status).toBe(400);
    expect((await agent.post('/api/push/subscriptions').send({ endpoint: FCM })).status).toBe(400);
  });

  test('a user cannot remove someone else\'s device', async () => {
    const { agent: a1 } = await hostAgent('host1');
    const { agent: a2 } = await hostAgent('host2');
    await a1.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    const r = await a2.post('/api/push/unsubscribe').send({ endpoint: FCM });
    expect(r.body.removed).toBe(false);
    expect(rows('SELECT * FROM push_subscriptions')).toHaveLength(1);
  });

  test('a shared device moves to whoever subscribed it last', async () => {
    const { agent: a1 } = await hostAgent('host1');
    const { host: h2, agent: a2 } = await hostAgent('host2');
    await a1.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    await a2.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    const all = rows('SELECT user_id FROM push_subscriptions');
    expect(all).toEqual([{ user_id: h2.id }]);
  });

  test('keeps at most 10 devices per user', async () => {
    const { agent } = await hostAgent();
    for (let i = 0; i < 12; i++) {
      await agent.post('/api/push/subscriptions').send({ endpoint: `${FCM}-${i}`, keys: KEYS });
    }
    expect(rows('SELECT * FROM push_subscriptions')).toHaveLength(10);
  });

  test('test push reaches only the caller\'s devices', async () => {
    const { agent: a1 } = await hostAgent('host1');
    const { agent: a2 } = await hostAgent('host2');
    await a1.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    await a2.post('/api/push/subscriptions').send({ endpoint: APPLE, keys: KEYS });
    const r = await a1.post('/api/push/test');
    expect(r.body).toEqual({ sent: 1, failed: 0 });
    expect(pushes.map(p => p.endpoint)).toEqual([FCM]);
    expect(pushes[0].payload.title).toMatch(/test alert/);
  });

  test('the generated VAPID keys sign a real Web Push request (no network)', async () => {
    const { publicKey, privateKey } = getVapidKeys();
    const sub = { endpoint: FCM, keys: { p256dh: webpush.generateVAPIDKeys().publicKey, auth: 'tBHItJI5svbpez7KI4CCXg' } };
    const details = webpush.generateRequestDetails(sub, JSON.stringify({ title: 'x' }), {
      vapidDetails: { subject: 'mailto:admin@visitas.world', publicKey, privateKey },
    });
    expect(details.endpoint).toBe(FCM);
    expect(details.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(details.headers['Content-Encoding']).toBe('aes128gcm');
  });

  test('turned off in config: no key, no subscribe', async () => {
    config.notifications.push = { enabled: false };
    const { agent } = await hostAgent();
    expect((await agent.get('/api/push/config')).body).toEqual({ enabled: false, publicKey: null });
    expect((await agent.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS })).status).toBe(409);
  });
});

describe('push delivery', () => {
  test('a visitor sign-in pushes to the host\'s devices only', async () => {
    const { host, agent } = await hostAgent('host1');
    const { agent: other } = await hostAgent('host2');
    await agent.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    await other.post('/api/push/subscriptions').send({ endpoint: APPLE, keys: KEYS });

    const visit = createVisit({ visitorName: 'Ana Pérez', company: 'ACME', hostUserId: host.id, purpose: 'Meeting' });
    await notifyVisitEvent('signed_in', { visit });

    expect(pushes).toHaveLength(1);
    expect(pushes[0].endpoint).toBe(FCM);
    expect(pushes[0].payload).toMatchObject({ url: '/admin/active-visitors', tag: `visit-${visit.id}` });
    expect(pushes[0].payload.title).toBe('Ana Pérez is here to see Host One');
    expect(pushes[0].payload.body).toContain('ACME');

    const log = row("SELECT kind, event, recipient, status FROM notifications_log WHERE kind = 'push'");
    expect(log).toEqual({ kind: 'push', event: 'signed_in', recipient: `user:${host.id}`, status: 'sent' });
  });

  test('sign-outs do not push by default', async () => {
    const { host, agent } = await hostAgent();
    await agent.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    const visit = createVisit({ visitorName: 'Ana', hostUserId: host.id });
    await notifyVisitEvent('signed_out', { visit });
    expect(pushes).toHaveLength(0);
  });

  test('inactive hosts get nothing', async () => {
    const { host, agent } = await hostAgent();
    await agent.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    const visit = createVisit({ visitorName: 'Ana', hostUserId: host.id });
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(host.id);
    await notifyVisitEvent('signed_in', { visit });
    expect(pushes).toHaveLength(0);
  });

  test('a device the push service reports gone is removed and logged as failed', async () => {
    const { host, agent } = await hostAgent();
    await agent.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    setPushSenderForTests(async () => { const e = new Error('Gone'); e.statusCode = 410; throw e; });
    const r = await sendPushToUser(host.id, { title: 'x', body: 'y' }, { event: 'signed_in' });
    expect(r).toEqual({ sent: 0, failed: 1 });
    expect(rows('SELECT * FROM push_subscriptions')).toHaveLength(0);
    expect(row("SELECT status, error FROM notifications_log WHERE kind = 'push'")).toMatchObject({ status: 'failed', error: expect.stringMatching(/410/) });
  });

  test('a transient error keeps the device', async () => {
    const { host, agent } = await hostAgent();
    await agent.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    setPushSenderForTests(async () => { const e = new Error('busy'); e.statusCode = 503; throw e; });
    await sendPushToUser(host.id, { title: 'x', body: 'y' });
    expect(rows('SELECT * FROM push_subscriptions')).toHaveLength(1);
  });

  test('notification links stay on this site', async () => {
    const { host, agent } = await hostAgent();
    await agent.post('/api/push/subscriptions').send({ endpoint: FCM, keys: KEYS });
    await sendPushToUser(host.id, { title: 'x', body: 'y', url: 'https://evil.example.com' });
    await sendPushToUser(host.id, { title: 'x', body: 'y', url: '//evil.example.com' });
    expect(pushes.map(p => p.payload.url)).toEqual(['/admin/active-visitors', '/admin/active-visitors']);
  });

  test('a blocked sign-in pushes to admin and security devices', async () => {
    const guard = createUser({ username: 'guard', role: 'security' });
    const ga = await agentFor('guard', guard.password);
    await ga.post('/api/push/subscriptions').send({ endpoint: APPLE, keys: KEYS });
    await notifySigninBlocked({ ban: { id: 1, mode: 'name', reason: 'test' }, attempt: { visitorName: 'Mallory', kioskSlug: 'default' } });
    expect(pushes).toHaveLength(1);
    expect(pushes[0].endpoint).toBe(APPLE);
    expect(pushes[0].payload.title).toContain('Mallory');
  });
});
