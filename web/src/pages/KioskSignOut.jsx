import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';

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
      setErr(e.data?.error || e.message);
    } finally { setBusy(null); }
  };

  const onSignOutByCode = async (raw) => {
    const code = extractSignoutCode(raw);
    if (!code) { setErr('That doesn’t look like a visitor badge. Please try again or ask reception.'); return; }
    setBusy('badge'); setErr(null);
    try {
      const r = await api.post('/api/visits/sign-out/badge', { code });
      finish(r.visit);
    } catch (e) {
      if (e.status === 409) setErr('This badge is already signed out.');
      else if (e.status === 404) setErr('Badge not recognised. Please ask reception.');
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
          <h1>Goodbye, {signedOut.visitorName?.split(' ')[0] || 'visitor'}.</h1>
          <p>You&rsquo;ve been signed out. Have a good day.</p>
          <div className="kiosk-stub">Returning to the welcome screen automatically…</div>
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
          <h1>Sign out</h1>
          <p>Tap the button to sign out of your visit.</p>
          {err && <div className="error">{err}</div>}
          <button
            type="button"
            className="kiosk-primary"
            disabled={busy === 'badge'}
            onClick={() => onSignOutByCode(codeFromUrl)}
          >
            Sign me out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="kiosk-wrap">
      {brand}
      <div className="kiosk-card kiosk-signout">
        <h1>Sign out</h1>

        {modeQ.isLoading && <p className="muted">Loading…</p>}
        {err && <div className="error">{err}</div>}

        {modeQ.isSuccess && mode === 'badge' && (
          <form
            onSubmit={(e) => { e.preventDefault(); onSignOutByCode(scan); }}
            className="signout-scan"
          >
            <p>Scan the QR code on your visitor badge. You can also scan it with your phone&rsquo;s camera.</p>
            <label htmlFor="signout-scan-input" className="muted">Badge code</label>
            <input
              id="signout-scan-input"
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy === 'badge'}
              placeholder="Scan your badge"
            />
            <button type="submit" disabled={busy === 'badge' || !scan.trim()}>Sign out</button>
            <p className="muted">Lost your badge? Please ask reception to sign you out.</p>
          </form>
        )}

        {showList && (
          <>
            <p>Tap your name below to sign out.</p>
            {listQ.isLoading && <p className="muted">Loading…</p>}
            {!listQ.isLoading && listQ.data?.visits?.length === 0 && (
              <p className="muted">No one is currently signed in.</p>
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
                  <span className="signout-host muted">visiting {v.hostName ?? 'someone'}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 24 }}>
          <Link to="/kiosk" className="muted">← Back to sign-in</Link>
        </div>
      </div>
    </div>
  );
}
