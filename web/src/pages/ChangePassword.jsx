import { useRef, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { Navigate } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';

export default function ChangePassword({ forced = false }) {
  const { user, refresh } = useAuth();
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);

  const wasForcedRef = useRef(forced);

  if (wasForcedRef.current && ok && user && !user.mustChangePassword) {
    return <Navigate to="/admin/hosts" replace />;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(null); setOk(false);
    if (next !== confirm) { setErr(t('pw.mismatch')); return; }
    try {
      await api.post('/api/auth/change-password', { currentPassword: current, newPassword: next });
      await refresh();
      setOk(true);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={onSubmit}>
        <h1>{forced ? t('pw.titleForced') : t('pw.title')}</h1>
        {forced && <div className="banner">{t('pw.mustChange')}</div>}
        <label htmlFor="cp-current">{t('pw.current')}</label>
        <input id="cp-current" type="password" value={current} onChange={e => setCurrent(e.target.value)} required />
        <label htmlFor="cp-new">{t('pw.new')}</label>
        <input id="cp-new" type="password" value={next} onChange={e => setNext(e.target.value)} required />
        <label htmlFor="cp-confirm">{t('pw.confirm')}</label>
        <input id="cp-confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
        {err && <div className="error">{err}</div>}
        {ok && <div style={{ color: 'var(--success)', marginTop: 8 }}>{t('pw.updated')}</div>}
        <div style={{ marginTop: 16 }}>
          <button type="submit">{t('pw.submit')}</button>
        </div>
      </form>
    </div>
  );
}
