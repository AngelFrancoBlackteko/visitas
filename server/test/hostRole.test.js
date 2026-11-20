import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, createUser, agentFor, adminAgent, client, row } from './helpers.js';
import { createVisit } from '../src/services/visits.js';
import { setPushSenderForTests } from '../src/services/push.js';
import { notifyVisitEvent } from '../src/notifications/index.js';

async function hostAgent(username = 'hana') {
  const u = createUser({ username, displayName: 'Hana Host', role: 'host', email: `${username}@corp.test` });
  return { user: u, agent: await agentFor(username, u.password) };
}

describe('host role', () => {
  beforeEach(resetDb);

  test('admins can create and switch users to host', async () => {
    const a = await adminAgent();
    const created = await a.post('/api/users').send({ username: 'nuevo', password: 'LongEnough12345', role: 'host' });
    expect(created.status).toBe(201);
    expect(row('SELECT role FROM users WHERE username = ?', 'nuevo').role).toBe('host');
    const sec = createUser({ username: 'sec', role: 'security' });
    const p = await a.patch(`/api/users/${sec.id}`).send({ role: 'host' });
    expect(p.status).toBe(200);
    expect(row('SELECT role FROM users WHERE id = ?', sec.id).role).toBe('host');
  });

  test('hosts appear in the kiosk host list and can receive visitors', async () => {
    const { user } = await hostAgent();
    const hosts = await client().get('/api/hosts');
    expect(hosts.body.hosts.map(h => h.id)).toContain(user.id);
    const res = await client().post('/api/visits').send({ visitorName: 'Ana Pérez', hostUserId: user.id });
    expect(res.status).toBe(201);
  });

  test('security users still cannot be hosts', async () => {
    const sec = createUser({ username: 'guard', role: 'security' });
    const res = await client().post('/api/visits').send({ visitorName: 'Ana', hostUserId: sec.id });
    expect(res.status).toBe(400);
  });

  test('a host sees only their own visits, without contact details', async () => {
    const { user, agent } = await hostAgent('hana');
    const other = createUser({ username: 'otro', role: 'host' });
    createVisit({ visitorName: 'Ana Pérez', company: 'ACME', email: 'ana@acme.test', phone: '+525512345678', purpose: 'Reunión', hostUserId: user.id });
    createVisit({ visitorName: 'Beto', hostUserId: other.id });

    const res = await agent.get('/api/visits/mine');
    expect(res.status).toBe(200);
    expect(res.body.visits).toHaveLength(1);
    expect(res.body.visits[0]).toMatchObject({ visitorName: 'Ana Pérez', company: 'ACME', purpose: 'Reunión', status: 'on_site' });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('ana@acme.test');
    expect(json).not.toContain('5512345678');
    expect(json).not.toMatch(/publicToken|public_token|signout/);
  });

  test('/mine needs a session', async () => {
    expect((await client().get('/api/visits/mine')).status).toBe(401);
  });

  test('a host cannot reach admin or security endpoints', async () => {
    const { agent } = await hostAgent();
    for (const path of ['/api/visits', '/api/visits/active-list', '/api/users', '/api/kiosks', '/api/documents', '/api/visitors', '/api/invitations', '/api/bans', '/api/notifications-log']) {
      const r = await agent.get(path);
      expect([401, 403], path).toContain(r.status);
    }
    expect((await agent.put('/api/settings/language').send({ language: 'en' })).status).toBe(403);
    expect((await agent.put('/api/settings/kiosk-badge').send({ print: false })).status).toBe(403);
  });

  test('a host cannot force-sign-out a visitor', async () => {
    const { user, agent } = await hostAgent();
    const v = createVisit({ visitorName: 'Ana', hostUserId: user.id });
    const r = await agent.post(`/api/visits/${v.id}/sign-out`);
    expect(r.status).toBe(403); // default badge mode: only admin/security may sign out by id
  });

  test('a host can turn on alerts for their own devices', async () => {
    const { agent } = await hostAgent();
    const r = await agent.post('/api/push/subscriptions').send({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
    });
    expect(r.status).toBe(201);
  });

  test('a host\'s alert opens their own visits page', async () => {
    const { user, agent } = await hostAgent();
    await agent.post('/api/push/subscriptions').send({
      endpoint: 'https://web.push.apple.com/device',
      keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
    });
    const sent = [];
    setPushSenderForTests(async (_sub, payload) => { sent.push(JSON.parse(payload)); });
    try {
      const visit = createVisit({ visitorName: 'Ana', hostUserId: user.id });
      await notifyVisitEvent('signed_in', { visit });
    } finally { setPushSenderForTests(null); }
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('/admin/my-visits');
  });
});
