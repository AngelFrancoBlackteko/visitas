import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { getLanguage } from '../i18n/index.js';

const DEFAULTS = {
  'branding.app_name': 'visitas.world',
  'branding.logo_path': null,
  // 'badge': visitors sign out by scanning the QR on their badge (default).
  // 'list':  legacy tap-your-name list; anyone at the kiosk can sign out
  //          anyone. Only for sites that don't print badges.
  'kiosk.signout_mode': 'badge',
  // true: the kiosk opens the printable badge after each sign-in.
  // false: paperless — no badge is printed; the host is still notified.
  'kiosk.print_badge': true,
};

export const SIGNOUT_MODES = ['badge', 'list'];

export function getSignoutMode() {
  const v = getSetting('kiosk.signout_mode');
  return SIGNOUT_MODES.includes(v) ? v : 'badge';
}

/** Whether the kiosk prints a badge after sign-in (false = paperless). */
export function getPrintBadge() {
  return getSetting('kiosk.print_badge') !== false;
}

// Read the project version on every call. The file is small and the JSON
// parse is cheap; doing it live means a `package.json` bump shows up in the
// topbar immediately without needing a process restart.
function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(config.repoRoot, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch { return '0.0.0'; }
}

export function getSetting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (r === undefined) return DEFAULTS[key] ?? null;
  try { return JSON.parse(r.value); } catch { return r.value; }
}

export function setSetting(key, value) {
  const v = JSON.stringify(value);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, v);
}

export function clearSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function getBranding() {
  return {
    appName: getSetting('branding.app_name') ?? 'visitas.world',
    logoUrl: getSetting('branding.logo_path'),
    version: readVersion(),
    // Public on purpose: the kiosk and login screens render in this language.
    language: getLanguage(),
  };
}
