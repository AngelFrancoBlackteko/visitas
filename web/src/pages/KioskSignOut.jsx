import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';

// The badge QR encodes `<base>/kiosk/signout/<32-hex code>`. A USB/Bluetooth
// scanner "types" that URL into the field below; a phone camera opens it.
// Either way we only need the 32-hex code.
export function extractSignoutCode(text) {
  const m = String(text || '').trim().toLowerCase().match(/([0-9a-f]{32})\/?$/);
  return m ? m[1] : null;
}

export default function KioskSignOut() {
  const { appName, logoUrl } = useBranding();
  const { code: codeFromUrl } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const t = useT();

  const modeQ = useQuery({
    queryKey: ['kiosk-signout-mode'],
    queryFn: () => api.get('/api/settings/kiosk-signout'),
  });
  const mode = modeQ.data?.mode ?? 'badge';
  const showList = !codeFromUrl && modeQ.isSuccess && mode === 'list';

  const listQ = useQuery({
    queryKey: ['active-visitors-public'],
    queryFn: () => api.get('/api/visits/active'),
    refetchInterval: 10_000,
    enabled: showList,
  });

  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [signedOut, setSignedOut] = useState(null);
  const [scan, setScan] = useState('');
  const scanRef = useRef(null);

  useEffect(() => {
    if (!signedOut) return;
    const t = setTimeout(() => nav('/kiosk'), 4000);
    return () => clearTimeout(t);
  }, [signedOut, nav]);

  // Keep the scan field focused so a hardware scanner always lands in it.
  useEffect(() => {
    if (!codeFromUrl && mode === 'badge' && !signedOut) scanRef.current?.focus();
  }, [codeFromUrl, mode, signedOut, modeQ.isSuccess]);

  const finish = (visit) => {
    setSignedOut(visit);
    qc.invalidateQueries({ queryKey: ['active-visitors-public'] });
  };

  const onSignOutById = async (id) => {
    setBusy(id); setErr(null);
    try {
      const r = await api.post(`/api/visits/${id}/sign-out`, {});
      finish(r.visit);
    } catch (e) {
      setErr(
        e.status === 403 ? t('signout.useBadge')
          : e.status === 409 ? t('signout.alreadyOut')
          : e.status === 429 ? t('common.tooManyRequests')
          : e.data?.error || e.message,
      );
    } finally { setBusy(null); }
  };

  const onSignOutByCode = async (raw) => {
    const code = extractSignoutCode(raw);
    if (!code) { setErr(t('signout.notBadge')); return; }
    setBusy('badge'); setErr(null);
    try {
      const r = await api.post('/api/visits/sign-out/badge', { code });
      finish(r.visit);
    } catch (e) {
      if (e.status === 409) setErr(t('signout.alreadyOut'));
      else if (e.status === 404 || e.status === 400) setErr(t('signout.notRecognised'));
      else if (e.status === 429) setErr(t('common.tooManyRequests'));
      else setErr(e.data?.error || e.message);
    } finally {
      setBusy(null);
      setScan('');
    }
  };

  const brand = (
    <div className="kiosk-brand">
      {logoUrl ? <img src={logoUrl} alt={appName} /> : <div className="kiosk-app-name">{appName}</div>}
    </div>
  );

  if (signedOut) {
    return (
      <div className="kiosk-wrap">
        {brand}
        <div className="kiosk-card">
          <h1>{t('signout.goodbye', { name: signedOut.visitorName?.split(' ')[0] || t('common.visitor') })}</h1>
          <p>{t('signout.signedOut')}</p>
          <div className="kiosk-stub">{t('kiosk.returning')}</div>
        </div>
      </div>
    );
  }

  // Opened from a phone camera scan of the badge QR. Ask for a tap rather
  // than signing out on page load, so link previews can't trigger it.
  if (codeFromUrl) {
    return (
      <div className="kiosk-wrap">
        {brand}
        <div className="kiosk-card kiosk-signout">
          <h1>{t('signout.title')}</h1>
          <p>{t('signout.tapButton')}</p>
          {err && <div className="error">{err}</div>}
          <button
            type="button"
            className="kiosk-primary"
            disabled={busy === 'badge'}
            onClick={() => onSignOutByCode(codeFromUrl)}
          >
            {t('signout.signMeOut')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk-wrap">
      {brand}
      <div className="kiosk-card kiosk-signout">
        <h1>{t('signout.title')}</h1>

        {modeQ.isLoading && <p className="muted">{t('common.loading')}</p>}
        {err && <div className="error">{err}</div>}

        {modeQ.isSuccess && mode === 'badge' && (
          <form
            onSubmit={(e) => { e.preventDefault(); onSignOutByCode(scan); }}
            className="signout-scan"
          >
            <p>{t('signout.scanPrompt')}</p>
            <label htmlFor="signout-scan-input" className="muted">{t('signout.badgeCode')}</label>
            <input
              id="signout-scan-input"
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy === 'badge'}
              placeholder={t('signout.scanPlaceholder')}
            />
            <button type="submit" disabled={busy === 'badge' || !scan.trim()}>{t('signout.submit')}</button>
            <p className="muted">{t('signout.lostBadge')}</p>
          </form>
        )}

        {showList && (
          <>
            <p>{t('signout.tapName')}</p>
            {listQ.isLoading && <p className="muted">{t('common.loading')}</p>}
            {!listQ.isLoading && listQ.data?.visits?.length === 0 && (
              <p className="muted">{t('signout.noOne')}</p>
            )}
            <div className="signout-list">
              {(listQ.data?.visits ?? []).map(v => (
                <button
                  key={v.id}
                  type="button"
                  className="signout-item"
                  disabled={busy === v.id}
                  onClick={() => onSignOutById(v.id)}
                >
                  <span className="signout-name">{v.visitorName}</span>
                  <span className="signout-host muted">{t('signout.visiting', { host: v.hostName ?? t('signout.someone') })}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 24 }}>
          <Link to="/kiosk" className="muted">{t('signout.back')}</Link>
        </div>
      </div>
    </div>
  );
}
