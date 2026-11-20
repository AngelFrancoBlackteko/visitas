import { db } from '../db/index.js';
import { messages } from './messages.js';

/**
 * Server-side translations: badge, host notifications, visitor emails and
 * the default visitor-form labels.
 *
 * The active language is a single, site-wide setting (`app.language`) that
 * an admin changes under Settings. Until an admin picks one, it falls back to
 * the DEFAULT_LANGUAGE env var, then to Spanish (Mexico).
 *
 * Add a language: add a block to messages.js with the same keys as `es`,
 * add the same in web/src/i18n/, and add the code to SUPPORTED_LANGUAGES.
 * The i18n test fails if any key is missing.
 */

export const SUPPORTED_LANGUAGES = ['es', 'en'];
export const FALLBACK_LANGUAGE = 'es';

const LOCALE_TAGS = { es: 'es-MX', en: 'en-US' };

export function isSupportedLanguage(lang) {
  return SUPPORTED_LANGUAGES.includes(lang);
}

/** Language used before an admin saves one: DEFAULT_LANGUAGE env, else 'es'. */
export function defaultLanguage() {
  const env = String(process.env.DEFAULT_LANGUAGE ?? '').trim().toLowerCase();
  return isSupportedLanguage(env) ? env : FALLBACK_LANGUAGE;
}

export const LANGUAGE_SETTING_KEY = 'app.language';

/** The site's active language (read straight from the settings table). */
export function getLanguage() {
  let saved = null;
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(LANGUAGE_SETTING_KEY);
    if (r) saved = JSON.parse(r.value);
  } catch { /* table missing during early boot: use the default */ }
  return isSupportedLanguage(saved) ? saved : defaultLanguage();
}

/** BCP-47 tag for dates and numbers, e.g. 'es-MX'. */
export function localeTag(lang = getLanguage()) {
  return LOCALE_TAGS[lang] ?? LOCALE_TAGS[FALLBACK_LANGUAGE];
}

/**
 * Translate `key`, replacing `{name}` placeholders with `vars.name`.
 * Missing keys fall back to Spanish, then to the key itself, so a gap never
 * crashes a sign-in.
 */
export function t(key, vars = {}, lang = getLanguage()) {
  const dict = messages[lang] ?? messages[FALLBACK_LANGUAGE];
  const template = dict[key] ?? messages[FALLBACK_LANGUAGE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in vars && vars[name] != null ? String(vars[name]) : m));
}

/**
 * Resolve a value that may be localized. Strings pass through unchanged;
 * objects like { "es": "Nombre", "en": "Name" } return the active language,
 * then Spanish, then English, then the first value present.
 */
export function pickLocalized(value, lang = getLanguage()) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value;
  return value[lang] ?? value[FALLBACK_LANGUAGE] ?? value.en ?? Object.values(value)[0];
}
