import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBranding } from '../branding.jsx';
import { useTheme } from '../theme.jsx';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';

export default function Settings() {
  const { appName, logoUrl, refresh } = useBranding();
  const t = useT();
  const [file, setFile] = useState(null);
  const [name, setName] = useState(appName);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const onUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setErr(null); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await fetch('/api/settings/branding/logo', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      await refresh();
      setFile(null);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onClearLogo = async () => {
    setBusy(true); setErr(null);
    try {
      await api.delete('/api/settings/branding/logo');
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onSaveName = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName: name }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1>{t('settings.title')}</h1>
      {err && <div className="error">{err}</div>}
      <LanguagePicker />
      <ThemePicker />

      <PhotoCaptureToggle />

      <PhotoRetention />

      <WallViewPrivacy />

      <KioskBadgePrint />
      <KioskSignOutMode />

      <NotificationTester />

      <NotificationsLogPanel />

      <div className="panel">
        <h2>{t('settings.branding')}</h2>
        <p className="muted">{t('settings.brandingHelp')}</p>
        <label>{t('settings.appName')}</label>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={64} />
        <div style={{ marginTop: 8 }}>
          <button onClick={onSaveName} disabled={busy || name === appName}>{t('settings.saveName')}</button>
        </div>

        <h2>{t('settings.logo')}</h2>
        <div className="muted" style={{ marginBottom: 8 }}>{t('settings.logoHelp')}</div>
        {logoUrl ? (
          <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
            <img src={logoUrl} alt={t('settings.currentLogo')} style={{ maxHeight: 60, maxWidth: 240, background: '#fff', padding: 8, borderRadius: 4 }} />
            <button className="danger" onClick={onClearLogo} disabled={busy}>{t('settings.removeLogo')}</button>
          </div>
        ) : (
          <div className="muted" style={{ marginBottom: 12 }}>{t('settings.noLogo')}</div>
        )}

        <form onSubmit={onUpload}>
          <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <div style={{ marginTop: 8 }}>
            <button type="submit" disabled={!file || busy}>{busy ? t('settings.uploading') : t('settings.uploadLogo')}</button>
          </div>
        </form>
      </div>
    </>
  );
}

function LanguagePicker() {
  const t = useT();
  const { language, refresh } = useBranding();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  // Show the click right away; the whole UI re-renders once /branding returns.
  const [pending, setPending] = useState(null);
  const selected = pending ?? language;
  const onPick = async (next) => {
    setPending(next); setSaving(true); setErr(null);
    try {
      await fetch('/api/settings/language', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      }).then(r => (r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || `HTTP ${r.status}`)))));
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); setPending(null); }
  };
  return (
    <div className="panel">
      <h2>{t('settings.language')}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>{t('settings.languageHelp')}</div>
      <div className="theme-picker">
        {['es', 'en'].map(code => (
          <label key={code} className={`theme-option ${selected === code ? 'selected' : ''}`}>
            <input
              type="radio"
              name="language-choice"
              value={code}
              checked={selected === code}
              disabled={saving}
              onChange={() => onPick(code)}
              data-testid={`language-${code}`}
            />
            <span>{t(`settings.lang.${code}`)}</span>
          </label>
        ))}
      </div>
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function ThemePicker() {
  const { choice, applied, setChoice } = useTheme();
  const t = useT();
  const options = [
    { value: 'light', label: t('settings.theme.light') },
    { value: 'dark',  label: t('settings.theme.dark') },
    { value: 'auto',  label: t('settings.theme.auto') },
  ];
  return (
    <div className="panel">
      <h2>{t('settings.theme')}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        {t('settings.themeHelp1')}<strong>{t('settings.themeHelp2')}</strong>{t('settings.themeHelp3')}
      </div>
      <div className="theme-picker">
        {options.map(o => (
          <label key={o.value} className={`theme-option ${choice === o.value ? 'selected' : ''}`}>
            <input
              type="radio"
              name="theme-choice"
              value={o.value}
              checked={choice === o.value}
              onChange={() => setChoice(o.value)}
            />
            <span>{o.label}</span>
            {o.value === 'auto' && choice === 'auto' && (
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{t('settings.currently', { value: t(`settings.theme.${applied}`) })}</span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

function PhotoCaptureToggle() {
  const qc = useQueryClient();
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-photo'],
    queryFn: () => api.get('/api/settings/photo'),
  });
  const enabled = !!data?.enabled;

  const m = useMutation({
    mutationFn: (next) => fetch('/api/settings/photo', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-photo'] }),
  });

  return (
    <div className="panel">
      <h2>{t('settings.photo')}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        {t('settings.photoHelp')}
      </div>
      <label className="theme-option" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 360 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={isLoading || m.isPending}
          onChange={(e) => m.mutate(e.target.checked)}
        />
        <span>{enabled ? t('common.enabled') : t('common.disabled')}</span>
      </label>
    </div>
  );
}

function PhotoRetention() {
  const qc = useQueryClient();
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-photo-retention'],
    queryFn: () => api.get('/api/settings/photo/retention'),
  });
  const [days, setDays] = useState('');
  const current = data?.retentionDays ?? 30;
  const editing = days !== '' && Number(days) !== current;

  const m = useMutation({
    mutationFn: (next) => fetch('/api/settings/photo/retention', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: Number(next) }),
    }).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings-photo-retention'] }); setDays(''); },
  });

  return (
    <div className="panel">
      <h2>{t('settings.retention')}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        {t('settings.retentionHelp')}
      </div>
      <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
        <div>
          <label htmlFor="retention-days">{t('settings.retentionDays')}</label>
          <input
            id="retention-days"
            type="number" min={1} max={365}
            placeholder={String(current)}
            value={days}
            onChange={e => setDays(e.target.value)}
            disabled={isLoading || m.isPending}
            style={{ width: 120 }}
          />
        </div>
        <button onClick={() => m.mutate(days)} disabled={!editing || m.isPending}>
          {m.isPending ? t('common.saving') : t('common.save')}
        </button>
        <span className="muted">{t('settings.currentlyDays', { n: current })}</span>
      </div>
      {m.error && <div className="error" style={{ marginTop: 8 }}>{m.error.error || t('common.failed')}</div>}
    </div>
  );
}

function KioskBadgePrint() {
  const qc = useQueryClient();
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-kiosk-badge'],
    queryFn: () => api.get('/api/settings/kiosk-badge'),
  });
  const print = data?.print !== false;

  const m = useMutation({
    mutationFn: (next) => fetch('/api/settings/kiosk-badge', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ print: next }),
    }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-kiosk-badge'] });
      qc.invalidateQueries({ queryKey: ['settings-kiosk-signout'] });
    },
  });

  return (
    <div className="panel">
      <h2>{t('settings.badgePrint')}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>{t('settings.badgePrintHelp')}</div>
      {[true, false].map(opt => (
        <label key={String(opt)} className="theme-option" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 460 }}>
          <input
            type="radio"
            name="kiosk-badge-print"
            value={opt ? 'print' : 'paperless'}
            checked={print === opt}
            disabled={isLoading || m.isPending}
            onChange={() => m.mutate(opt)}
          />
          <span>{t(opt ? 'settings.badgePrint.on' : 'settings.badgePrint.off')}</span>
        </label>
      ))}
    </div>
  );
}

function KioskSignOutMode() {
  const qc = useQueryClient();
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-kiosk-signout'],
    queryFn: () => api.get('/api/settings/kiosk-signout'),
  });
  const mode = data?.mode ?? 'badge';

  const m = useMutation({
    mutationFn: (next) => fetch('/api/settings/kiosk-signout', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-kiosk-signout'] }),
  });

  return (
    <div className="panel">
      <h2>{t('settings.signout')}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        {t('settings.signoutHelp1')}<strong>{t('settings.signoutHelp2')}</strong>{t('settings.signoutHelp3')}
        <strong>{t('settings.signoutHelp4')}</strong>{t('settings.signoutHelp5')}
      </div>
      {['badge', 'list'].map(opt => (
        <label key={opt} className="theme-option" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 460 }}>
          <input
            type="radio"
            name="kiosk-signout-mode"
            value={opt}
            checked={mode === opt}
            disabled={isLoading || m.isPending}
            onChange={() => m.mutate(opt)}
          />
          <span>{t(`settings.signout.${opt}`)}</span>
        </label>
      ))}
      {m.data?.code === 'PRINT_BADGE_OFF' && (
        <div className="error" style={{ marginTop: 8 }}>{t('settings.signoutNeedsPrint')}</div>
      )}
    </div>
  );
}

function WallViewPrivacy() {
  const qc = useQueryClient();
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ['settings-wall-view'],
    queryFn: () => api.get('/api/settings/wall-view'),
  });
  const isPublic = data?.public !== false;

  const m = useMutation({
    mutationFn: (next) => fetch('/api/settings/wall-view', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public: next }),
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings-wall-view'] }),
  });

  return (
    <div className="panel">
      <h2>{t('settings.wall')}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        {t('settings.wallHelp1')}<code>/active</code>{t('settings.wallHelp2')}
      </div>
      <label className="theme-option" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 460 }}>
        <input
          type="checkbox"
          checked={isPublic}
          disabled={isLoading || m.isPending}
          onChange={(e) => m.mutate(e.target.checked)}
        />
        <span>{isPublic ? t('settings.wallPublic') : t('settings.wallPrivate')}</span>
      </label>
    </div>
  );
}

function NotificationsLogPanel() {
  const t = useT();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['notifications-log'],
    queryFn: () => api.get('/api/notifications-log?limit=20'),
    refetchInterval: 60_000,
  });
  const entries = data?.entries ?? [];

  return (
    <div className="panel">
      <h2>{t('settings.log')} <button style={{ marginLeft: 8 }} onClick={() => refetch()} disabled={isLoading}>{t('common.refresh')}</button></h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        {t('settings.logHelp1')}<strong>{t('settings.logHelp2')}</strong>{t('settings.logHelp3')}
      </div>
      {entries.length === 0 ? (
        <div className="muted">{t('settings.logEmpty')}</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('settings.log.when')}</th><th>{t('settings.log.kind')}</th><th>{t('settings.log.event')}</th><th>{t('settings.log.recipient')}</th><th>{t('common.status')}</th><th>{t('settings.log.error')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id}>
                <td title={e.createdAt}>{e.createdAt}</td>
                <td>{e.kind}</td>
                <td>{e.event}</td>
                <td>{e.recipient}</td>
                <td style={{ color: e.status === 'failed' ? 'var(--danger)' : e.status === 'sent' ? 'var(--success)' : undefined }}>
                  {e.status}
                </td>
                <td className="muted" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.error || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NotificationTester() {
  const t = useT();
  return (
    <>
      <TestPanel
        title={t('settings.emailTitle')}
        helpText={t('settings.emailHelp')}
        endpoint="/api/settings/email/test"
        recipientLabel={t('settings.emailRecipient')}
        recipientType="email"
        recipientPlaceholder="you@your-workshop.com"
        sendLabel={t('settings.emailSend')}
      />
      <TestPanel
        title={t('settings.smsTitle')}
        helpText={t('settings.smsHelp')}
        endpoint="/api/settings/sms/test"
        recipientLabel={t('settings.smsRecipient')}
        recipientType="tel"
        recipientPlaceholder="+15555550100"
        sendLabel={t('settings.smsSend')}
      />
    </>
  );
}

function TestPanel({ title, helpText, endpoint, recipientLabel, recipientType, recipientPlaceholder, sendLabel }) {
  const t = useT();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const onSend = async (e) => {
    e.preventDefault();
    setResult(null); setBusy(true);
    try {
      await api.post(endpoint, { to });
      setResult({ ok: true, message: t('settings.sentCheck', { to }) });
    } catch (e) {
      setResult({ ok: false, message: e.data?.error || e.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="muted" style={{ marginBottom: 8 }}>{helpText}</div>
      <form onSubmit={onSend} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label>{recipientLabel}</label>
          <input
            type={recipientType}
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder={recipientPlaceholder}
            required
          />
        </div>
        <button type="submit" disabled={busy || !to}>{busy ? t('common.sending') : sendLabel}</button>
      </form>
      {result && (
        <div style={{ marginTop: 8, color: result.ok ? 'var(--success)' : 'var(--danger)' }}>
          {result.message}
        </div>
      )}
    </div>
  );
}
