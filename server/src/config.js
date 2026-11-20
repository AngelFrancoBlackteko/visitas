import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

dotenv.config({ path: resolve(repoRoot, 'server/.env') });

function readJson(relPath, fallback) {
  const p = resolve(repoRoot, relPath);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export const config = {
  repoRoot,
  port: Number(process.env.PORT ?? 3000),
  env: process.env.NODE_ENV ?? 'development',
  dataDir: resolve(repoRoot, process.env.DATA_DIR ?? './data'),
  baseUrl: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  logLevel: process.env.LOG_LEVEL ?? 'info',

  jwt: {
    // Lazy: only required when actually issuing/verifying tokens. CLI tools
    // that touch the DB but not auth (e.g. reset-admin) don't need this set.
    get secret() {
      const v = process.env.JWT_SECRET;
      if (!v) throw new Error('Missing required env var: JWT_SECRET');
      return v;
    },
    ttlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 43200),
  },

  auth: readJson('config/auth.json', {
    local: { enabled: true },
    ad: { enabled: false },
  }),

  notifications: readJson('config/notifications.json', {
    email: { enabled: false },
    sms: { enabled: false },
  }),

  // Express `trust proxy`. Off by default: with it on, a client that can
  // reach the app directly could spoof X-Forwarded-For and dodge the rate
  // limits. Set TRUST_PROXY=1 when the app sits behind exactly one reverse
  // proxy (the bundled Caddy), so rate limits key on the real client IP.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  adBindPassword: process.env.AD_BIND_PASSWORD ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  smsAuthToken: process.env.SMS_AUTH_TOKEN ?? '',
};

export function dbPath() {
  if (process.env.VISITAS_DB_PATH) return process.env.VISITAS_DB_PATH;
  return resolve(config.dataDir, 'visitas.sqlite');
}

function parseTrustProxy(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  if (v === '' || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // e.g. "loopback" or a comma-separated list of subnets
}

// Values that have shipped in examples/docs and must never sign real sessions.
const KNOWN_WEAK_SECRETS = new Set([
  'change-me-please',
  'change-me-in-production-please',
  'change-me',
  'changeme',
  'secret',
  'jwt_secret',
]);
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Throws if JWT_SECRET is missing, a known placeholder, or too short to
 * resist brute force. Anyone who knows the secret can mint an admin session,
 * so the server refuses to start rather than run with a guessable one.
 */
export function assertStrongJwtSecret(secret = process.env.JWT_SECRET) {
  if (!secret) throw new Error('JWT_SECRET is not set. Generate one with: openssl rand -hex 64');
  if (KNOWN_WEAK_SECRETS.has(secret.trim().toLowerCase())) {
    throw new Error('JWT_SECRET is still the example placeholder. Generate one with: openssl rand -hex 64');
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters. Generate one with: openssl rand -hex 64`);
  }
}
