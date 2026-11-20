import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useT } from '../i18n/index.jsx';

export default function Documents() {
  const t = useT();
  return (
    <>
      <h1>{t('docs.title')}</h1>
      <p className="muted">
        {t('docs.intro1')}<strong>{t('docs.intro2')}</strong>{t('docs.intro3')}
      </p>
      {/* Defaults are only a starting template in the site language; once
          saved, the document is shown exactly as written. */}
      <DocumentEditor kind="safety" defaultTitle={t('docs.safetyDefaultTitle')} defaultBody={t('docs.safetyDefaultBody')} />
      <DocumentEditor kind="nda" defaultTitle={t('docs.ndaDefaultTitle')} defaultBody={t('docs.ndaDefaultBody')} />
    </>
  );
}

function DocumentEditor({ kind, defaultTitle, defaultBody }) {
  const qc = useQueryClient();
  const t = useT();
  const kindLabel = kind === 'nda' ? t('docs.nda') : t('docs.safety');
  const allQ = useQuery({
    queryKey: ['documents', kind],
    queryFn: () => api.get(`/api/documents?kind=${kind}`),
  });

  const docs = allQ.data?.documents ?? [];
  const active = docs.find(d => d.active) ?? null;
  const [title, setTitle] = useState(active?.title ?? defaultTitle);
  const [body, setBody] = useState(active?.body ?? defaultBody);
  const [saved, setSaved] = useState(null);
  const [err, setErr] = useState(null);

  // When the active doc changes (e.g. after save), sync the local state.
  if (active && saved !== null && saved.id === active.id && (title !== saved.title || body !== saved.body)) {
    // user edited after save — leave it
  }

  const save = useMutation({
    mutationFn: () => api.post('/api/documents', { kind, title, body }),
    onSuccess: (r) => { setSaved(r.document); setErr(null); qc.invalidateQueries({ queryKey: ['documents', kind] }); qc.invalidateQueries({ queryKey: ['documents-active'] }); },
    onError: (e) => setErr(e.data?.error || e.message),
  });
  const disable = useMutation({
    mutationFn: () => api.delete(`/api/documents/${kind}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents', kind] }); qc.invalidateQueries({ queryKey: ['documents-active'] }); },
  });

  if (allQ.isLoading) return <div className="panel"><p className="muted">{t('docs.loading', { kind: kindLabel })}</p></div>;

  return (
    <div className="panel">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{kindLabel}</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          {active ? t('docs.activeVersion', { version: active.version }) : t('docs.notEnabled')}
          {docs.length > 0 && t(docs.length === 1 ? 'docs.versionsOne' : 'docs.versionsMany', { n: docs.length })}
        </div>
      </div>

      <label style={{ marginTop: 16 }}>{t('docs.docTitle')}</label>
      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={256} />

      <label>{t('docs.body')}</label>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={10} placeholder={t('docs.bodyPlaceholder')} />

      {err && <div className="error">{err}</div>}

      <div className="row" style={{ marginTop: 16 }}>
        <button onClick={() => save.mutate()} disabled={save.isPending || !title || !body}>
          {save.isPending ? t('common.saving') : (active ? t('docs.saveBump') : t('docs.saveEnable'))}
        </button>
        {active && (
          <button className="danger" onClick={() => disable.mutate()} disabled={disable.isPending}>
            {disable.isPending ? t('docs.disabling') : t('docs.disable')}
          </button>
        )}
      </div>

      {docs.length > 1 && (
        <details style={{ marginTop: 16 }}>
          <summary className="muted" style={{ cursor: 'pointer' }}>{t('docs.history', { n: docs.length })}</summary>
          <ul style={{ marginTop: 8 }}>
            {docs.map(d => (
              <li key={d.id} style={{ marginBottom: 4 }}>
                v{d.version}
                {d.active && <span className="badge muted" style={{ marginLeft: 8 }}>{t('common.active')}</span>}
                <span className="muted" style={{ marginLeft: 8 }}>{d.createdAt}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
