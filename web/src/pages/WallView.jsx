import { useQuery } from '@tanstack/react-query';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';
import { useI18n, durationSince } from '../i18n/index.jsx';

/**
 * Public wall view at /active. Designed to glance at from across a room —
 * during a fire drill, on a hallway monitor, or on someone's phone in a
 * pinch. Sanitized: visitor name + host + duration. No email, phone, purpose.
 *
 * Auto-refreshes every 30s.
 */
export default function WallView() {
  const { appName, logoUrl } = useBranding();
  const { t, locale } = useI18n();
  const { data, isLoading, error } = useQuery({
    queryKey: ['visits-wall'],
    queryFn: () => api.get('/api/visits/active'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: (count, err) => err?.status !== 401 && count < 3,
  });

  const visits = data?.visits ?? [];
  const asOf = data?.asOf ? new Date(data.asOf) : new Date();
  const authRequired = error?.status === 401;

  return (
    <div className="wall-wrap">
      <header className="wall-header">
        <div className="wall-brand">
          {logoUrl
            ? <img src={logoUrl} alt={appName} />
            : <span className="wall-app-name">{appName}</span>}
        </div>
        <div className="wall-title">{t('wall.title')}</div>
        <div className="wall-asof">{t('wall.asOf', { time: asOf.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</div>
      </header>

      {isLoading && <div className="wall-empty">{t('common.loading')}</div>}
      {!isLoading && authRequired && (
        <div className="wall-empty">
          {t('wall.authRequired')}
        </div>
      )}
      {!isLoading && !authRequired && visits.length === 0 && (
        <div className="wall-empty">{t('wall.empty')}</div>
      )}

      {visits.length > 0 && (
        <ul className="wall-list">
          {visits.map(v => (
            <li key={v.id} className="wall-item">
              <span className="wall-name">{v.visitorName}</span>
              <span className="wall-host">
                {t('wall.visiting', { host: v.hostName ?? '—' })}
                {v.kioskName ? <span className="wall-kiosk muted"> · {v.kioskName}</span> : null}
              </span>
              <span className="wall-duration">{durationSince(t, v.signedInAt)}</span>
            </li>
          ))}
        </ul>
      )}

      <footer className="wall-footer muted">
        {t('wall.footer')} {t(visits.length === 1 ? 'wall.countOne' : 'wall.countMany', { n: visits.length })}
      </footer>
    </div>
  );
}

