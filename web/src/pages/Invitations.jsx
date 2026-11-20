import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useI18n } from '../i18n/index.jsx';

export default function Invitations() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get('/api/invitations'),
  });
  const [showNew, setShowNew] = useState(false);

  if (isLoading) return <div>{t('common.loading')}</div>;
  const invitations = data?.invitations ?? [];

  const onChanged = () => qc.invalidateQueries({ queryKey: ['invitations'] });

  return (
    <>
      <div className="row between">
        <h1>{t('inv.title')}</h1>
        <button onClick={() => setShowNew(s => !s)}>{showNew ? t('common.cancel') : t('inv.new')}</button>
      </div>

      <p className="muted">
        {t('inv.intro')}
      </p>

      {showNew && <NewInvitation onCreated={() => { setShowNew(false); onChanged(); }} />}

      {invitations.length === 0 && <div className="panel"><p className="muted">{t('inv.empty')}</p></div>}

      {invitations.length > 0 && (
        <div className="panel" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>{t('inv.visitor')}</th>
                <th>{t('common.host')}</th>
                <th>{t('inv.expected')}</th>
                <th>{t('common.status')}</th>
                <th>{t('inv.expires')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invitations.map(inv => (
                <InvitationRow key={inv.id} inv={inv} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function InvitationRow({ inv, onChanged }) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);

  const cancel = useMutation({
    mutationFn: () => api.delete(`/api/invitations/${inv.id}`),
    onSuccess: onChanged,
  });
  const resend = useMutation({
    mutationFn: () => api.post(`/api/invitations/${inv.id}/resend`, {}),
    onSuccess: onChanged,
  });

  const inviteUrl = `${window.location.origin}${inv.kiosk?.slug ? `/kiosk/${inv.kiosk.slug}` : '/kiosk/default'}?invite=${inv.token}`;
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <tr>
      <td>
        <div>{inv.visitorName}</div>
        <div className="muted" style={{ fontSize: 12 }}>{inv.email}</div>
      </td>
      <td>{inv.host?.displayName || inv.host?.username}</td>
      <td>{inv.expectedAt || <span className="muted">—</span>}</td>
      <td>
        <span className={`badge ${inv.status === 'sent' ? 'muted' : inv.status === 'used' ? '' : 'disabled'}`}>
          {t(`inv.status.${inv.status}`)}
        </span>
      </td>
      <td>{shortDate(inv.expiresAt, locale)}</td>
      <td style={{ textAlign: 'right' }}>
        {inv.status === 'sent' && (
          <span className="row" style={{ gap: 6 }}>
            <button className="secondary" onClick={onCopy}>{copied ? t('inv.copied') : t('inv.copy')}</button>
            <button className="secondary" onClick={() => resend.mutate()} disabled={resend.isPending}>{t('inv.resend')}</button>
            <button className="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>{t('common.cancel')}</button>
          </span>
        )}
      </td>
    </tr>
  );
}

function NewInvitation({ onCreated }) {
  const { t } = useI18n();
  const hostsQ = useQuery({ queryKey: ['hosts'], queryFn: () => api.get('/api/hosts') });
  const kiosksQ = useQuery({ queryKey: ['kiosks-active'], queryFn: () => api.get('/api/kiosks?activeOnly=true') });

  const [visitorName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [hostUserId, setHostUserId] = useState('');
  const [kioskSlug, setKioskSlug] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [purpose, setPurpose] = useState('');
  const [err, setErr] = useState(null);

  const m = useMutation({
    mutationFn: (body) => api.post('/api/invitations', body),
    onSuccess: onCreated,
    onError: (e) => setErr(e.data?.error || e.message),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    setErr(null);
    if (!hostUserId) { setErr(t('inv.pickHost')); return; }
    m.mutate({
      visitorName: visitorName.trim(),
      email: email.trim(),
      company: company.trim() || null,
      phone: phone.trim() || null,
      hostUserId: Number(hostUserId),
      kioskSlug: kioskSlug || null,
      expectedAt: expectedAt || null,
      purpose: purpose.trim() || null,
    });
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>{t('inv.newTitle')}</h2>
      <label htmlFor="new-inv-name">{t('inv.visitorName')} <span className="req">*</span></label>
      <input id="new-inv-name" value={visitorName} onChange={e => setName(e.target.value)} required />
      <label htmlFor="new-inv-email">{t('inv.visitorEmail')} <span className="req">*</span></label>
      <input id="new-inv-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <label htmlFor="new-inv-company">{t('common.company')}</label>
      <input id="new-inv-company" value={company} onChange={e => setCompany(e.target.value)} />
      <label htmlFor="new-inv-phone">{t('common.phone')}</label>
      <input id="new-inv-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
      <label htmlFor="new-inv-host">{t('common.host')} <span className="req">*</span></label>
      <select id="new-inv-host" value={hostUserId} onChange={e => setHostUserId(e.target.value)} required>
        <option value="">{t('inv.chooseHost')}</option>
        {(hostsQ.data?.hosts ?? []).map(h => <option key={h.id} value={h.id}>{h.displayName}</option>)}
      </select>
      <label htmlFor="new-inv-kiosk">{t('inv.kiosk')}</label>
      <select id="new-inv-kiosk" value={kioskSlug} onChange={e => setKioskSlug(e.target.value)}>
        <option value="">{t('inv.anyKiosk')}</option>
        {(kiosksQ.data?.kiosks ?? []).map(k => <option key={k.slug} value={k.slug}>{k.name}</option>)}
      </select>
      <label htmlFor="new-inv-expected">{t('inv.expectedLabel')}</label>
      <input id="new-inv-expected" value={expectedAt} onChange={e => setExpectedAt(e.target.value)} />
      <label htmlFor="new-inv-purpose">{t('inv.purpose')}</label>
      <input id="new-inv-purpose" value={purpose} onChange={e => setPurpose(e.target.value)} />
      {err && <div className="error">{err}</div>}
      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={m.isPending}>{m.isPending ? t('common.sending') : t('inv.create')}</button>
      </div>
    </form>
  );
}

function shortDate(iso, locale) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(locale);
}
