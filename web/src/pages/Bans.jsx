import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import BanModal from '../components/BanModal.jsx';
import { useI18n } from '../i18n/index.jsx';

export default function Bans() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [showModal, setShowModal] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['bans', showInactive ? 'all' : 'active'],
    queryFn: () => api.get(showInactive ? '/api/bans' : '/api/bans?status=active'),
  });

  const lift = useMutation({
    mutationFn: ({ id, liftReason }) => api.post(`/api/bans/${id}/lift`, { liftReason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bans'] }),
  });

  if (isLoading) return <div>{t('common.loading')}</div>;
  const bans = data?.bans ?? [];

  return (
    <>
      <div className="row between">
        <h1>{t('bans.title')}</h1>
        <div className="row">
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            {t('bans.showInactive')}
          </label>
          <button onClick={() => setShowModal(true)}>{t('bans.add')}</button>
        </div>
      </div>

      <p className="muted">
        {t('bans.intro')}
      </p>

      {bans.length === 0 && <div className="panel"><p className="muted">{t('bans.empty')}</p></div>}

      {bans.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>{t('bans.match')}</th>
                <th>{t('common.reason')}</th>
                <th>{t('bans.created')}</th>
                <th>{t('bans.expires')}</th>
                <th>{t('common.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bans.map(b => <BanRow key={b.id} ban={b} onLift={(liftReason) => lift.mutate({ id: b.id, liftReason })} />)}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <BanModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['bans'] }); }}
        />
      )}
    </>
  );
}

function BanRow({ ban, onLift }) {
  const { t, locale } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [liftReason, setLiftReason] = useState('');

  const matchSummary = ban.mode === 'email' ? <code>{ban.email}</code>
    : ban.mode === 'name' ? <span>{ban.namePattern}{ban.companyPattern ? <span className="muted"> · {ban.companyPattern}</span> : null}</span>
    : <span className="muted">{t('bans.visitorNumber', { id: ban.visitorId })}</span>;

  return (
    <tr>
      <td>
        <div><span className="badge muted">{t(`bans.mode.${ban.mode}`)}</span> {matchSummary}</div>
      </td>
      <td>{ban.reason}</td>
      <td className="muted" style={{ fontSize: 12 }}>
        {ban.createdBy?.displayName || ban.createdBy?.username}<br/>
        {shortDate(ban.createdAt, locale)}
      </td>
      <td>{ban.expiresAt ? shortDate(ban.expiresAt, locale) : <span className="muted">{t('common.permanent')}</span>}</td>
      <td>
        {ban.active
          ? <span className="badge muted">{t('common.active')}</span>
          : <span className="badge disabled">{ban.liftedAt ? t('bans.lifted') : t('bans.expired')}</span>}
      </td>
      <td style={{ textAlign: 'right' }}>
        {ban.active && !confirming && (
          <button className="secondary" onClick={() => setConfirming(true)}>{t('bans.lift')}</button>
        )}
        {ban.active && confirming && (
          <span className="row" style={{ gap: 6 }}>
            <input
              placeholder={t('bans.liftReason')}
              value={liftReason}
              onChange={e => setLiftReason(e.target.value)}
              style={{ width: 200 }}
            />
            <button className="danger" onClick={() => onLift(liftReason || null)}>{t('bans.confirmLift')}</button>
            <button className="secondary" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
          </span>
        )}
      </td>
    </tr>
  );
}

function shortDate(iso, locale) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('T') ? '' : 'Z'));
  return d.toLocaleDateString(locale);
}
