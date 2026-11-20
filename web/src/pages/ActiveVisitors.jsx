import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import BanModal from '../components/BanModal.jsx';
import PushAlerts from '../components/PushAlerts.jsx';
import { useI18n, durationSince } from '../i18n/index.jsx';

export default function ActiveVisitors() {
  const qc = useQueryClient();
  const { t, locale } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['visits', 'on_site'],
    queryFn: () => api.get('/api/visits?status=on_site'),
    refetchInterval: 30_000,
  });

  const signOut = useMutation({
    mutationFn: (id) => api.post(`/api/visits/${id}/sign-out`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visits', 'on_site'] }),
  });

  const [confirming, setConfirming] = useState(null);
  const [banTarget, setBanTarget] = useState(null);

  return (
    <>
      <div className="row between">
        <h1>{t('active.title')}</h1>
        <div className="muted">{t('active.autoRefresh')}</div>
      </div>

      <p className="muted">
        {t('active.intro')}
      </p>

      <PushAlerts />

      {isLoading && <div className="panel"><p className="muted">{t('common.loading')}</p></div>}

      {!isLoading && data?.visits?.length === 0 && (
        <div className="panel"><p className="muted">{t('active.empty')}</p></div>
      )}

      {data?.visits?.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('common.company')}</th>
                <th>{t('common.host')}</th>
                <th>{t('active.kiosk')}</th>
                <th>{t('active.purpose')}</th>
                <th>{t('active.signedIn')}</th>
                <th>{t('active.onSite')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.visits.map(v => (
                <tr key={v.id}>
                  <td>{v.visitorName}</td>
                  <td>{v.company || <span className="muted">—</span>}</td>
                  <td>{v.host?.displayName || v.host?.username || <span className="muted">—</span>}</td>
                  <td>{v.kiosk?.name || <span className="muted">—</span>}</td>
                  <td>{v.purpose || <span className="muted">—</span>}</td>
                  <td title={v.signedInAt}>{formatTime(v.signedInAt, locale)}</td>
                  <td>{durationSince(t, v.signedInAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {confirming === v.id ? (
                      <span className="row">
                        <button className="danger" onClick={() => { signOut.mutate(v.id); setConfirming(null); }}>
                          {t('active.confirmSignOut')}
                        </button>
                        <button className="secondary" onClick={() => setConfirming(null)}>{t('common.cancel')}</button>
                      </span>
                    ) : (
                      <span className="row">
                        <button className="secondary" onClick={() => setConfirming(v.id)}>{t('active.forceSignOut')}</button>
                        <button
                          className="secondary"
                          onClick={() => setBanTarget({
                            visitorId: v.visitor?.id,
                            visitorName: v.visitorName,
                            company: v.company,
                            email: v.email,
                          })}
                        >
                          {t('common.ban')}
                        </button>
                      </span>
                    )}
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
          onSaved={() => { setBanTarget(null); qc.invalidateQueries({ queryKey: ['visits', 'on_site'] }); }}
        />
      )}
    </>
  );
}

function formatTime(iso, locale) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

