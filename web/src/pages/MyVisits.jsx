import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import PushAlerts from '../components/PushAlerts.jsx';
import { useI18n, durationSince } from '../i18n/index.jsx';

// A host's whole view of visitas.world: who is here to see them, and the
// switch for alerts on this device.
export default function MyVisits() {
  const { t, locale } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['visits', 'mine'],
    queryFn: () => api.get('/api/visits/mine'),
    refetchInterval: 30_000,
  });
  const visits = data?.visits ?? [];
  const here = visits.filter(v => v.status === 'on_site');
  const gone = visits.filter(v => v.status !== 'on_site');

  return (
    <>
      <h1>{t('mine.title')}</h1>
      <PushAlerts />

      {isLoading && <div className="panel"><p className="muted">{t('common.loading')}</p></div>}

      {!isLoading && (
        <div className="panel">
          <h2>{t('mine.here')}</h2>
          {here.length === 0
            ? <p className="muted">{t('mine.nobody')}</p>
            : <VisitList visits={here} t={t} locale={locale} onSite />}
        </div>
      )}

      {gone.length > 0 && (
        <div className="panel">
          <h2>{t('mine.left')}</h2>
          <VisitList visits={gone} t={t} locale={locale} />
        </div>
      )}
    </>
  );
}

function VisitList({ visits, t, locale, onSite = false }) {
  return (
    <ul className="my-visits" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {visits.map(v => (
        <li key={v.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border, #ddd)' }}>
          <strong>{v.visitorName}</strong>
          {v.company ? <span className="muted"> · {v.company}</span> : null}
          <div className="muted" style={{ fontSize: 14 }}>
            {onSite
              ? t('mine.arrived', { time: formatTime(v.signedInAt, locale), ago: durationSince(t, v.signedInAt) })
              : t('mine.leftAt', { time: formatTime(v.signedOutAt, locale) })}
            {v.purpose ? ` · ${v.purpose}` : ''}
            {v.kioskName ? ` · ${v.kioskName}` : ''}
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatTime(iso, locale) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
