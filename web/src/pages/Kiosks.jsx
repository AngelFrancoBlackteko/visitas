import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';

export default function Kiosks() {
  const qc = useQueryClient();
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ['kiosks'],
    queryFn: () => api.get('/api/kiosks'),
  });
  const [showNew, setShowNew] = useState(false);

  if (isLoading) return <div>{t('common.loading')}</div>;
  const kiosks = data?.kiosks ?? [];

  return (
    <>
      <div className="row between">
        <h1>{t('kiosks.title')}</h1>
        <button onClick={() => setShowNew(s => !s)}>{showNew ? t('common.cancel') : t('kiosks.add')}</button>
      </div>

      <p className="muted">
        {t('kiosks.intro1')}<code>/kiosk/&lt;slug&gt;</code>{t('kiosks.intro2')}<strong>{t('kiosks.intro3')}</strong>{t('kiosks.intro4')}
      </p>

      {showNew && <NewKiosk onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['kiosks'] }); }} />}

      <div className="panel" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t('kiosks.slug')}</th>
              <th>{t('common.name')}</th>
              <th>{t('kiosks.printerCol')}</th>
              <th>{t('kiosks.url')}</th>
              <th>{t('common.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {kiosks.map(k => (
              <KioskRow key={k.id} kiosk={k} onChanged={() => qc.invalidateQueries({ queryKey: ['kiosks'] })} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function KioskRow({ kiosk, onChanged }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(kiosk.name);
  const [printer, setPrinter] = useState(kiosk.defaultPrinterName ?? '');
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.patch(`/api/kiosks/${kiosk.slug}`, body),
    onSuccess: () => { setEditing(false); setErr(null); onChanged(); },
    onError: (e) => setErr(e.data?.error || e.message),
  });
  const dm = useMutation({
    mutationFn: () => api.delete(`/api/kiosks/${kiosk.slug}`),
    onSuccess: onChanged,
    onError: (e) => setErr(e.data?.error || e.message),
  });

  return (
    <tr>
      <td><code>{kiosk.slug}</code></td>
      <td>
        {editing
          ? <input value={name} onChange={e => setName(e.target.value)} />
          : kiosk.name}
      </td>
      <td>
        {editing
          ? <input value={printer} onChange={e => setPrinter(e.target.value)} placeholder={t('kiosks.printerPlaceholderEdit')} />
          : (kiosk.defaultPrinterName || <span className="muted">—</span>)}
      </td>
      <td><code>/kiosk/{kiosk.slug}</code></td>
      <td>{kiosk.active ? <span className="badge muted">{t('common.active')}</span> : <span className="badge disabled">{t('common.inactive')}</span>}</td>
      <td style={{ textAlign: 'right' }}>
        {editing ? (
          <span className="row">
            <button onClick={() => m.mutate({ name, defaultPrinterName: printer || null })} disabled={m.isPending}>{t('common.save')}</button>
            <button className="secondary" onClick={() => { setEditing(false); setName(kiosk.name); setPrinter(kiosk.defaultPrinterName ?? ''); }}>{t('common.cancel')}</button>
          </span>
        ) : (
          <span className="row">
            <button className="secondary" onClick={() => setEditing(true)}>{t('common.edit')}</button>
            {kiosk.slug !== 'default' && kiosk.active && (
              <button className="danger" onClick={() => dm.mutate()} disabled={dm.isPending}>{t('kiosks.deactivate')}</button>
            )}
          </span>
        )}
        {err && <div className="error" style={{ fontSize: 12 }}>{err}</div>}
      </td>
    </tr>
  );
}

function NewKiosk({ onCreated }) {
  const t = useT();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [printer, setPrinter] = useState('');
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.post('/api/kiosks', body),
    onSuccess: onCreated,
    onError: (e) => setErr(e.data?.error || e.message),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    setErr(null);
    m.mutate({ slug, name, defaultPrinterName: printer || null });
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>{t('kiosks.newTitle')}</h2>
      <label htmlFor="new-kiosk-slug">{t('kiosks.slug')} <span className="req">*</span></label>
      <input id="new-kiosk-slug" value={slug} onChange={e => setSlug(e.target.value.toLowerCase())} required pattern="[a-z0-9-]+" placeholder={t('kiosks.slugPlaceholder')} />
      <label htmlFor="new-kiosk-name">{t('kiosks.displayName')} <span className="req">*</span></label>
      <input id="new-kiosk-name" value={name} onChange={e => setName(e.target.value)} required placeholder={t('kiosks.displayNamePlaceholder')} />
      <label htmlFor="new-kiosk-printer">{t('kiosks.printerLabel')}</label>
      <input id="new-kiosk-printer" value={printer} onChange={e => setPrinter(e.target.value)} placeholder={t('kiosks.printerPlaceholder')} />
      {err && <div className="error">{err}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={m.isPending}>{m.isPending ? t('common.creating') : t('kiosks.create')}</button>
      </div>
    </form>
  );
}
