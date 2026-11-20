import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import BanModal from '../components/BanModal.jsx';
import { useI18n } from '../i18n/index.jsx';

export default function Visitors() {
  const qc = useQueryClient();
  const { t, locale } = useI18n();
  const [banTarget, setBanTarget] = useState(null);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ['visitors'],
    queryFn: () => api.get('/api/visitors'),
  });

  if (isLoading) return <div>{t('common.loading')}</div>;
  const visitors = data?.visitors ?? [];

  return (
    <>
      <h1>{t('visitors.title')}</h1>
      <p className="muted">
        {t('visitors.intro1')}<em>{t('visitors.intro2')}</em>{t('visitors.intro3')}
      </p>
      {visitors.length === 0 && <div className="panel"><p className="muted">{t('visitors.empty')}</p></div>}

      {visitors.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('common.email')}</th>
                <th>{t('common.company')}</th>
                <th>{t('common.phone')}</th>
                <th style={{ textAlign: 'right' }}>{t('visitors.visits')}</th>
                <th>{t('visitors.lastSeen')}</th>
                <th>{t('visitors.ndaOnFile')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visitors.map(v => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  <td>{v.email || <span className="muted">—</span>}</td>
                  <td>{v.company || <span className="muted">—</span>}</td>
                  <td>{v.phone || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.visitCount}</td>
                  <td title={v.lastSeenAt}>{relative(v.lastSeenAt, t, locale)}</td>
                  <td>
                    {v.ndaCacheFresh
                      ? <span className="badge muted" title={t('visitors.ndaSigned', { version: v.ndaCacheVersion, date: v.ndaCacheAcknowledgedAt })}>{t('visitors.ndaFresh', { version: v.ndaCacheVersion })}</span>
                      : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="secondary"
                      onClick={() => setBanTarget({ visitorId: v.id, visitorName: v.name, company: v.company, email: v.email })}
                    >
                      {t('common.ban')}
                    </button>
                    <button
                      className="danger"
                      style={{ marginLeft: 8 }}
                      onClick={() => setPurgeTarget(v)}
                      title={t('visitors.purgeTitle')}
                    >
                      {t('visitors.purge')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {banTarget && (
        <BanModal
          prefill={banTarget}
          onClose={() => setBanTarget(null)}
          onSaved={() => { setBanTarget(null); qc.invalidateQueries({ queryKey: ['visitors'] }); }}
        />
      )}

      {purgeTarget && (
        <PurgeModal
          visitor={purgeTarget}
          onClose={() => setPurgeTarget(null)}
          onPurged={() => {
            setPurgeTarget(null);
            qc.invalidateQueries({ queryKey: ['visitors'] });
          }}
        />
      )}
    </>
  );
}

function PurgeModal({ visitor, onClose, onPurged }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const expectedConfirm = visitor.email || visitor.name;

  const submit = async (e) => {
    e.preventDefault();
    if (confirm !== expectedConfirm) {
      setErr(t('visitors.typeToConfirm', { value: expectedConfirm }));
      return;
    }
    setErr(null); setBusy(true);
    try {
      const res = await fetch(`/api/visitors/${visitor.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || null }),
      });
      const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      onPurged(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{t('visitors.purgeHeading', { name: visitor.name })}</h2>
        <p className="muted">
          {t('visitors.purgeHelp1')}<strong>{t('visitors.purgeHelp2')}</strong>{t('visitors.purgeHelp3')}
        </p>
        <form onSubmit={submit}>
          <label htmlFor="purge-reason">{t('visitors.purgeReason')}</label>
          <input
            id="purge-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={t('visitors.purgeReasonPlaceholder')}
            maxLength={512}
          />
          <label htmlFor="purge-confirm" style={{ marginTop: 12 }}>
            {t('visitors.purgeConfirm1')}<code>{expectedConfirm}</code>{t('visitors.purgeConfirm2')}
          </label>
          <input
            id="purge-confirm"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="off"
          />
          {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button type="submit" className="danger" disabled={busy || confirm !== expectedConfirm}>
              {busy ? t('visitors.purging') : t('visitors.purgeButton')}
            </button>
            <button type="button" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function relative(iso, t, locale) {
  if (!iso) return '';
  const ts = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return t('visitors.justNow');
  if (mins < 60) return t('visitors.minsAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('visitors.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('visitors.daysAgo', { n: days });
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString(locale);
}
