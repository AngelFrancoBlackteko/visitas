import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useBranding } from '../branding.jsx';
import { useNavigate } from 'react-router-dom';
import { useT } from '../i18n/index.jsx';

export default function Login() {
  const { login } = useAuth();
  const { appName, logoUrl } = useBranding();
  const nav = useNavigate();
  const t = useT();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await login(username, password);
      nav('/admin/hosts');
    } catch (e) {
      setErr(e.status === 401 ? t('login.invalid') : e.status === 429 ? t('common.tooManyRequests') : e.message);
    }
    finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="panel login-card" onSubmit={onSubmit}>
        <div style={{ marginBottom: 16, textAlign: 'center' }}>
          {logoUrl
            ? <img src={logoUrl} alt={appName} style={{ maxHeight: 56, maxWidth: 240 }} />
            : <div style={{ fontSize: 18, fontWeight: 600 }}>{appName}</div>}
        </div>
        <h1>{t('login.title')}</h1>
        <label htmlFor="login-username">{t('login.username')}</label>
        <input id="login-username" value={username} onChange={e => setU(e.target.value)} autoFocus required />
        <label htmlFor="login-password">{t('login.password')}</label>
        <input id="login-password" type="password" value={password} onChange={e => setP(e.target.value)} required />
        {err && <div className="error">{err}</div>}
        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={busy}>{busy ? t('login.busy') : t('login.submit')}</button>
        </div>
      </form>
    </div>
  );
}
