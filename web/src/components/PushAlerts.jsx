import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';
import { unsupportedReason, currentSubscription, enableAlerts, disableAlerts } from '../push/device.js';

// "Get visitor alerts on this device" panel. The host turns it on once per
// phone/computer; after that, a visitor signing in for them makes the
// device ring, even with the page closed.
export default function PushAlerts() {
  const t = useT();
  const [state, setState] = useState('loading'); // loading | unsupported | off | on | denied
  const [reason, setReason] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const why = unsupportedReason();
      if (why) { if (!cancelled) { setReason(why); setState('unsupported'); } return; }
      if (Notification.permission === 'denied') { if (!cancelled) setState('denied'); return; }
      try {
        const sub = await currentSubscription();
        if (sub) {
          // Re-register with the server: keeps it in sync if the server
          // lost the row, and claims a shared device for this user.
          await api.post('/api/push/subscriptions', sub.toJSON()).catch(() => {});
        }
        if (!cancelled) setState(sub ? 'on' : 'off');
      } catch {
        if (!cancelled) setState('off');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const run = async (fn) => {
    setBusy(true); setMsg(null); setErr(null);
    try { await fn(); } finally { setBusy(false); }
  };

  const turnOn = () => run(async () => {
    try {
      await enableAlerts();
      setState('on');
      setMsg(t('push.enabled'));
    } catch (e) {
      if (e.code === 'PERMISSION_DENIED') setState(Notification.permission === 'denied' ? 'denied' : 'off');
      else setErr(e.code === 'SERVER_DISABLED' ? t('push.serverDisabled') : t('push.enableFailed'));
    }
  });

  const turnOff = () => run(async () => {
    try { await disableAlerts(); setState('off'); setMsg(t('push.disabled')); }
    catch { setErr(t('common.failed')); }
  });

  const sendTest = () => run(async () => {
    try {
      const r = await api.post('/api/push/test', {});
      if (r.sent > 0) setMsg(t('push.testSent'));
      else setErr(t('push.testFailed'));
    } catch { setErr(t('push.testFailed')); }
  });

  if (state === 'loading') return null;

  return (
    <div className="panel" data-testid="push-alerts">
      <h2>{t('push.title')}</h2>
      {state === 'unsupported' && <p className="muted">{t(`push.why.${reason}`)}</p>}
      {state === 'denied' && <p className="muted">{t('push.denied')}</p>}
      {state === 'off' && (
        <>
          <p className="muted">{t('push.offHelp')}</p>
          <button onClick={turnOn} disabled={busy}>{t('push.turnOn')}</button>
        </>
      )}
      {state === 'on' && (
        <>
          <p>{t('push.onHelp')}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button onClick={sendTest} disabled={busy}>{t('push.sendTest')}</button>
            <button className="secondary" onClick={turnOff} disabled={busy}>{t('push.turnOff')}</button>
          </div>
        </>
      )}
      {msg && <p className="muted" role="status" style={{ marginTop: 8 }}>{msg}</p>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
