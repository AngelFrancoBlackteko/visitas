import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useBranding } from '../branding.jsx';
import es from './es.js';
import en from './en.js';

// UI translations. The language is one site-wide setting, chosen by an admin
// under Settings and served publicly with the branding (so the kiosk, login
// and wall view render in it before anyone signs in). Spanish (Mexico) is the
// default.

export const DICTIONARIES = { es, en };
export const FALLBACK_LANGUAGE = 'es';
const LOCALE_TAGS = { es: 'es-MX', en: 'en-US' };

export function translate(lang, key, vars = {}) {
  const dict = DICTIONARIES[lang] ?? DICTIONARIES[FALLBACK_LANGUAGE];
  const template = dict[key] ?? DICTIONARIES[FALLBACK_LANGUAGE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in vars && vars[name] != null ? String(vars[name]) : m));
}

const I18nContext = createContext({
  lang: FALLBACK_LANGUAGE,
  locale: LOCALE_TAGS[FALLBACK_LANGUAGE],
  t: (key, vars) => translate(FALLBACK_LANGUAGE, key, vars),
});

export function I18nProvider({ children }) {
  const { language } = useBranding();
  const lang = DICTIONARIES[language] ? language : FALLBACK_LANGUAGE;

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, locale: LOCALE_TAGS[lang], t }), [lang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Shorthand: `const t = useT();` then `t('kiosk.welcome')`. */
export const useT = () => useContext(I18nContext).t;

/** "12 min" / "1 h 5 min" since a SQLite UTC timestamp. */
export function durationSince(t, iso) {
  if (!iso) return '';
  const start = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.max(0, Math.floor((Date.now() - start) / 60000));
  if (mins < 60) return t('common.mins', { n: mins });
  return t('common.hoursMins', { h: Math.floor(mins / 60), m: mins % 60 });
}
