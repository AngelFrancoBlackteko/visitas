import { describe, test, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { client } from './helpers.js';
import { assertStrongJwtSecret, config } from '../src/config.js';
import { publicLimiter } from '../src/middleware/rateLimits.js';

describe('JWT secret strength check', () => {
  test('rejects missing secret', () => {
    expect(() => assertStrongJwtSecret('')).toThrow(/not set/);
  });

  test('rejects the .env.example placeholder', () => {
    expect(() => assertStrongJwtSecret('change-me-please')).toThrow(/placeholder/);
  });

  test('rejects short secrets', () => {
    expect(() => assertStrongJwtSecret('a'.repeat(31))).toThrow(/at least 32/);
  });

  test('accepts a generated secret', () => {
    expect(() => assertStrongJwtSecret('f'.repeat(128))).not.toThrow();
  });
});

describe('Security headers', () => {
  test('API responses carry CSP and nosniff, no X-Powered-By', async () => {
    const res = await client().get('/api/health');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['content-security-policy']).toMatch(/object-src 'none'/);
    expect(res.headers['content-security-policy']).not.toMatch(/upgrade-insecure-requests/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('uploaded files are served sandboxed so an SVG cannot run script', async () => {
    const dir = resolve(config.dataDir, 'uploads');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'logo-test.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await client().get('/uploads/logo-test.svg');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
  });
});

describe('Public rate limiter', () => {
  test('returns 429 once the per-IP budget is spent', async () => {
    const app = express();
    app.get('/x', publicLimiter({ max: 2, message: 'slow down', skipInTest: false }), (_req, res) => res.json({ ok: true }));
    expect((await request(app).get('/x')).status).toBe(200);
    expect((await request(app).get('/x')).status).toBe(200);
    const third = await request(app).get('/x');
    expect(third.status).toBe(429);
    expect(third.body.error).toBe('slow down');
  });
});
