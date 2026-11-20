import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, createUser, client, adminAgent, row, rows } from './helpers.js';

function seedHost() {
  return createUser({ username: 'host1', password: 'HostPass1234', displayName: 'Host One', role: 'admin' });
}

async function signIn(extra = {}) {
  const host = seedHost();
  const res = await client().post('/api/visits').send({ visitorName: 'Alice Visitor', email: 'a@x.com', phone: '+15555550100', hostUserId: host.id, ...extra });
  expect(res.status).toBe(201);
  return res.body.visit;
}

describe('Badge QR sign-out', () => {
  beforeEach(resetDb);

  test('each visit gets a 32-hex sign-out code, separate from the public token', async () => {
    const v = await signIn();
    const r = row('SELECT signout_code, public_token FROM visits WHERE id = ?', v.id);
    expect(r.signout_code).toMatch(/^[0-9a-f]{32}$/);
    expect(r.signout_code).not.toBe(r.public_token);
  });

  test('the sign-out code never appears in API visit payloads', async () => {
    const v = await signIn();
    const code = row('SELECT signout_code FROM visits WHERE id = ?', v.id).signout_code;
    expect(JSON.stringify(v)).not.toContain(code);
    const a = await adminAgent();
    const list = await a.get('/api/visits');
    expect(JSON.stringify(list.body)).not.toContain(code);
    const active = await client().get('/api/visits/active');
    expect(JSON.stringify(active.body)).not.toContain(code);
  });

  test('badge page embeds a QR (SVG) for the sign-out URL', async () => {
    const v = await signIn();
    const res = await client().get(`/api/visits/badge/${v.publicToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<svg');
    expect(res.text).toContain('Scan to sign out');
  });

  test('POST /api/visits/sign-out/badge signs the visitor out and returns only the name', async () => {
    const v = await signIn();
    const code = row('SELECT signout_code FROM visits WHERE id = ?', v.id).signout_code;
    const res = await client().post('/api/visits/sign-out/badge').send({ code });
    expect(res.status).toBe(200);
    expect(res.body.visit).toEqual({ id: v.id, visitorName: 'Alice Visitor', signedOutAt: expect.any(String) });

    const r = row('SELECT status, signed_out_method FROM visits WHERE id = ?', v.id);
    expect(r).toEqual({ status: 'signed_out', signed_out_method: 'kiosk' });
    const audit = rows("SELECT details FROM audit_log WHERE subject_id = ? AND action = 'visit_signed_out'", v.id);
    expect(JSON.parse(audit[0].details)).toEqual({ method: 'kiosk', via: 'badge_qr' });
  });

  test('second scan of the same badge is a 409', async () => {
    const v = await signIn();
    const code = row('SELECT signout_code FROM visits WHERE id = ?', v.id).signout_code;
    await client().post('/api/visits/sign-out/badge').send({ code });
    const res = await client().post('/api/visits/sign-out/badge').send({ code });
    expect(res.status).toBe(409);
  });

  test('unknown code is a 404, malformed code is a 400', async () => {
    await signIn();
    expect((await client().post('/api/visits/sign-out/badge').send({ code: 'a'.repeat(32) })).status).toBe(404);
    expect((await client().post('/api/visits/sign-out/badge').send({ code: 'not-a-code' })).status).toBe(400);
    expect((await client().post('/api/visits/sign-out/badge').send({})).status).toBe(400);
  });
});

describe('Kiosk sign-out mode setting', () => {
  beforeEach(resetDb);

  test('defaults to badge and is readable without auth', async () => {
    const res = await client().get('/api/settings/kiosk-signout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'badge' });
  });

  test('admin can switch to list; anonymous id sign-out then works', async () => {
    const a = await adminAgent();
    const put = await a.put('/api/settings/kiosk-signout').send({ mode: 'list' });
    expect(put.status).toBe(200);
    expect((await client().get('/api/settings/kiosk-signout')).body.mode).toBe('list');

    const v = await signIn();
    const res = await client().post(`/api/visits/${v.id}/sign-out`);
    expect(res.status).toBe(200);
  });

  test('rejects unknown modes and anonymous writes', async () => {
    const a = await adminAgent();
    expect((await a.put('/api/settings/kiosk-signout').send({ mode: 'anyone' })).status).toBe(400);
    expect((await client().put('/api/settings/kiosk-signout').send({ mode: 'list' })).status).toBe(401);
  });
});
