import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const LANGUAGE_CACHE_KEY = 'visitas-language';

// Remember the last language the server reported so a reload doesn't flash
// the default language before /branding answers.
function cachedLanguage() {
  try { return window.localStorage.getItem(LANGUAGE_CACHE_KEY); } catch { return null; }
}

const BrandingContext = createContext({ appName: 'visitas.world', logoUrl: null, version: '0.0.0', language: null, refresh: () => {} });

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(() => ({ appName: 'visitas.world', logoUrl: null, version: '0.0.0', language: cachedLanguage() }));

  const refresh = useCallback(async () => {
    try {
      const b = await api.get('/api/settings/branding');
      setBranding(b);
      if (b?.language) {
        try { window.localStorage.setItem(LANGUAGE_CACHE_KEY, b.language); } catch {}
      }
    } catch {}
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return (
    <BrandingContext.Provider value={{ ...branding, refresh }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
