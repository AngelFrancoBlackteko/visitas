import { describe, test, expect, beforeEach } from 'vitest';
import { resetDb, createUser, client, adminAgent } from './helpers.js';
import { getPrintBadge } from '../src/services/settings.js';

describe('Paperless kiosk (badge printing off)', () => {
  beforeEach(resetDb);

  test('printing is on by default and readable without signing in', async () => {
    const res = await client().get('/api/settings/kiosk-badge');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ print: true });
    expect(getPrintBadge()).toBe(true);
  });

  test('turning printing off also switches sign-out to the name list', async () => {
    const a = await adminAgent();
    const put = await a.put('/api/settings/kiosk-badge').send({ print: false });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ print: false, signoutMode: 'list' });
    expect((await client().get('/api/settings/kiosk-badge')).body).toEqual({ print: false });
    expect((await client().get('/api/settings/kiosk-signout')).body).toEqual({ mode: 'list' });
  });

  test('badge-QR sign-out cannot be chosen while paperless', async () => {
    const a = await adminAgent();
    await a.put('/api/settings/kiosk-badge').send({ print: false });
    const res = await a.put('/api/settings/kiosk-signout').send({ mode: 'badge' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRINT_BADGE_OFF');
    expect((await client().get('/api/settings/kiosk-signout')).body.mode).toBe('list');
  });

  test('turning printing back on keeps the sign-out mode until the admin changes it', async () => {
    const a = await adminAgent();
    await a.put('/api/settings/kiosk-badge').send({ print: false });
    const on = await a.put('/api/settings/kiosk-badge').send({ print: true });
    expect(on.body).toEqual({ print: true, signoutMode: 'list' });
    expect((await a.put('/api/settings/kiosk-signout').send({ mode: 'badge' })).status).toBe(200);
  });

  test('a paperless sign-in still reaches the host and the visitor can sign out by name', async () => {
    const a = await adminAgent();
    await a.put('/api/settings/kiosk-badge').send({ print: false });
    const host = createUser({ username: 'host1', displayName: 'Host One', role: 'admin' });
    const created = await client().post('/api/visits').send({ visitorName: 'Ana Pérez', hostUserId: host.id });
    expect(created.status).toBe(201);
    const out = await client().post(`/api/visits/${created.body.visit.id}/sign-out`);
    expect(out.status).toBe(200);
    expect(out.body.visit.visitorName).toBe('Ana Pérez');
  });

  test('rejects bad values and non-admin writes', async () => {
    const a = await adminAgent();
    expect((await a.put('/api/settings/kiosk-badge').send({ print: 'no' })).status).toBe(400);
    expect((await a.put('/api/settings/kiosk-badge').send({ print: false, extra: 1 })).status).toBe(400);
    expect((await client().put('/api/settings/kiosk-badge').send({ print: false })).status).toBe(401);
  });
});
