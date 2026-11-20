import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { client, createUser } from './helpers.js';

// The suite normally skips rate limiting (NODE_ENV=test). This file turns it
// back on to prove the limiters are attached to the real routes, and that a
// spoofed X-Forwarded-For can't reset the bucket while TRUST_PROXY is off.
// Each test hits a different route, so their buckets do not overlap.

beforeAll(() => { process.env.VISITAS_TEST_RATE_LIMITS = '1'; });
afterAll(() => { delete process.env.VISITAS_TEST_RATE_LIMITS; });

async function hammer(n, send) {
  const codes = [];
  for (let i = 0; i < n; i++) codes.push((await send(i)).status);
  return codes;
}

describe('Rate limits are wired to the real routes', () => {
  test('POST /api/visitors/lookup: 20/min, then 429 even with spoofed X-Forwarded-For', async () => {
    const codes = await hammer(21, (i) => client()
      .post('/api/visitors/lookup')
      .set('X-Forwarded-For', `203.0.113.${i}`)
      .send({ email: `nobody${i}@x.com` }));
    expect(codes.slice(0, 20).every(c => c === 404)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  test('POST /api/visits: 30/min, then 429', async () => {
    const codes = await hammer(31, () => client().post('/api/visits').send({}));
    expect(codes.slice(0, 30).every(c => c === 400)).toBe(true);
    expect(codes[30]).toBe(429);
  });

  test('POST /api/auth/login: 10/min, then 429', async () => {
    createUser({ username: 'rl-user', password: 'RateLimit1234' });
    const codes = await hammer(11, () => client().post('/api/auth/login').send({ username: 'rl-user', password: 'wrong-password' }));
    expect(codes.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  test('POST /api/visits/:id/sign-out (public): 10/min, then 429', async () => {
    const codes = await hammer(11, () => client().post('/api/visits/999999/sign-out'));
    expect(codes[10]).toBe(429);
  });
});
