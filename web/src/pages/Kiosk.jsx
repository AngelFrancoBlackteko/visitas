import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useBranding } from '../branding.jsx';
import { api } from '../api.js';
import SignaturePad from '../components/SignaturePad.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';
import { useT } from '../i18n/index.jsx';

const STANDARD_KEYS = new Set(['name', 'company', 'email', 'phone', 'host', 'purpose']);

export default function Kiosk() {
  const { slug = 'default' } = useParams();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');
  const { appName, logoUrl } = useBranding();
  const t = useT();
  const [stage, setStage] = useState('form');
  const [pending, setPending] = useState(null);
  const [acks, setAcks] = useState([]);
  const [photoPng, setPhotoPng] = useState(null);
  const [thankYouFor, setThankYouFor] = useState(null);
  const [submitErr, setSubmitErr] = useState(null);
  const [ndaCacheFresh, setNdaCacheFresh] = useState(false);

  const kioskQ = useQuery({
    queryKey: ['kiosk', slug],
    queryFn: () => api.get(`/api/kiosks/${slug}`),
    retry: false,
  });
  const docsQ = useQuery({
    queryKey: ['documents-active'],
    queryFn: () => api.get('/api/documents/active'),
  });
  const photoSettingQ = useQuery({
    queryKey: ['settings-photo'],
    queryFn: () => api.get('/api/settings/photo'),
  });
  const inviteQ = useQuery({
    queryKey: ['invitation', inviteToken],
    queryFn: () => api.get(`/api/invitations/${inviteToken}`),
    enabled: !!inviteToken,
    retry: false,
  });

  if (kioskQ.isLoading || docsQ.isLoading || inviteQ.isLoading || photoSettingQ.isLoading) {
    return <div className="kiosk-wrap"><div className="kiosk-card"><p className="muted">{t('common.loading')}</p></div></div>;
  }
  if (kioskQ.error) {
    return (
      <div className="kiosk-wrap">
        <div className="kiosk-card">
          <h1>{t('kiosk.unknownTitle')}</h1>
          <p>{t('kiosk.unknownBody1')}<code>{slug}</code>{t('kiosk.unknownBody2')}</p>
        </div>
      </div>
    );
  }
  // Invitation-with-error: friendly fallback (expired / used / cancelled / unknown).
  if (inviteToken && inviteQ.error) {
    return (
      <div className="kiosk-wrap">
        <div className="kiosk-card">
          <h1>{t('kiosk.inviteInvalidTitle')}</h1>
          <p className="muted">{t('kiosk.inviteInvalidBody')}</p>
          <p><a href={`/kiosk/${slug}`}>{t('kiosk.inviteContinue')}</a></p>
        </div>
      </div>
    );
  }
  const kiosk = kioskQ.data?.kiosk;
  const docs = docsQ.data?.documents ?? [];
  const safetyDoc = docs.find(d => d.kind === 'safety');
  const ndaDoc = docs.find(d => d.kind === 'nda');
  const invitation = inviteQ.data?.invitation ?? null;
  const photoEnabled = !!photoSettingQ.data?.enabled;

  // Stage order: form → photo? → safety? → nda? → submit.
  const stagesNeeded = ['form'];
  if (photoEnabled) stagesNeeded.push('photo');
  if (safetyDoc) stagesNeeded.push('safety');
  if (ndaDoc && !ndaCacheFresh) stagesNeeded.push('nda');

  const advanceFrom = (current, lookupInfo) => {
    const idx = stagesNeeded.indexOf(current);
    let next = stagesNeeded[idx + 1];
    // The NDA stage is dynamically removed on cache hit — recompute.
    if (next === 'nda' && lookupInfo?.ndaCacheFresh) next = stagesNeeded[idx + 2];
    return next;
  };

  const onFormDone = (body, lookupInfo) => {
    setPending(body);
    setAcks([]);
    setPhotoPng(null);
    setNdaCacheFresh(!!lookupInfo?.ndaCacheFresh);
    const next = advanceFrom('form', lookupInfo);
    if (next) setStage(next);
    else submit(body, [], null);
  };

  const onPhotoDone = (png) => {
    setPhotoPng(png);
    const next = advanceFrom('photo');
    if (next) setStage(next);
    else submit(pending, acks, png);
  };

  const onSafetyDone = () => {
    const updated = [...acks, { kind: 'safety', signedName: pending.visitorName }];
    setAcks(updated);
    const next = advanceFrom('safety');
    if (next) setStage(next);
    else submit(pending, updated, photoPng);
  };

  const onNdaDone = (signaturePngBase64) => {
    const updated = [...acks, {
      kind: 'nda',
      signedName: pending.visitorName,
      signaturePngBase64,
    }];
    setAcks(updated);
    submit(pending, updated, photoPng);
  };

  const submit = async (body, ackList, photo) => {
    setSubmitErr(null);
    try {
      const r = await api.post('/api/visits', {
        ...body,
        acknowledgments: ackList,
        inviteToken: inviteToken ?? undefined,
        photoPngBase64: photo ?? undefined,
      });
      setThankYouFor({ ...r.visit, _ndaCacheFresh: ndaCacheFresh });
      setStage('thanks');
      window.open(`/api/visits/badge/${r.visit.publicToken}`, '_blank', 'noopener=yes,width=480,height=320');
    } catch (e) {
      // Visitor-facing: never show raw server text (a ban refusal must stay
      // generic, and technical messages are in English).
      setSubmitErr(
        e.status === 403 ? t('kiosk.signinRefused')
          : e.status === 429 ? t('common.tooManyRequests')
          : t('kiosk.submitFailed'),
      );
      setStage('form');
    }
  };

  const onReset = () => {
    setStage('form'); setPending(null); setAcks([]); setPhotoPng(null);
    setThankYouFor(null); setSubmitErr(null); setNdaCacheFresh(false);
  };

  return (
    <div className="kiosk-wrap">
      <div className="kiosk-brand">
        {logoUrl
          ? <img src={logoUrl} alt={appName} />
          : <div className="kiosk-app-name">{appName}</div>}
        <div className="kiosk-loc muted">{kiosk?.name}</div>
        {stagesNeeded.length > 1 && stage !== 'thanks' && (
          <div className="kiosk-stepper muted">
            {t('kiosk.step', { n: stagesNeeded.indexOf(stage) + 1, total: stagesNeeded.length })}
          </div>
        )}
      </div>
      {stage === 'form' && <SignInForm kioskSlug={slug} initialErr={submitErr} invitation={invitation} onDone={onFormDone} />}
      {stage === 'photo' && (
        <PhotoStage onDone={onPhotoDone} />
      )}
      {stage === 'safety' && safetyDoc && (
        <DocumentAck doc={safetyDoc} confirmLabel={t('kiosk.safetyConfirm')} onDone={onSafetyDone} />
      )}
      {stage === 'nda' && ndaDoc && (
        <NdaSign doc={ndaDoc} visitorName={pending?.visitorName} onDone={onNdaDone} />
      )}
      {stage === 'thanks' && (
        <ThankYou visit={thankYouFor} kiosk={kiosk} onReset={onReset} />
      )}
    </div>
  );
}

function SignInForm({ kioskSlug, initialErr, invitation, onDone }) {
  const formQ = useQuery({ queryKey: ['visitor-form'], queryFn: () => api.get('/api/visitor-form') });
  const hostsQ = useQuery({ queryKey: ['hosts'], queryFn: () => api.get('/api/hosts'), enabled: !invitation });
  const [values, setValues] = useState(() => invitation
    ? { name: invitation.visitorName, company: invitation.company || '', email: invitation.email || '', phone: invitation.phone || '', purpose: invitation.purpose || '' }
    : {}
  );
  const [hostQuery, setHostQuery] = useState('');
  const [hostId, setHostId] = useState(invitation?.host?.id ?? null);
  const [err, setErr] = useState(initialErr);
  const [lookup, setLookup] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const t = useT();

  if (formQ.isLoading || hostsQ.isLoading) {
    return <div className="kiosk-card"><p className="muted">{t('common.loading')}</p></div>;
  }
  if (formQ.error || hostsQ.error) {
    return <div className="kiosk-card"><p className="error">{t('kiosk.loadFailed')}</p></div>;
  }

  const fields = formQ.data?.fields ?? [];
  const hosts = hostsQ.data?.hosts ?? [];

  const set = (k, v) => setValues(p => ({ ...p, [k]: v }));

  const onEmailBlur = async () => {
    const email = values.email?.trim();
    if (!email || !email.includes('@')) return;
    setLookingUp(true);
    try {
      const r = await api.post('/api/visitors/lookup', { email });
      setLookup(r.visitor);
      // Pre-fill any fields the visitor hasn't already typed something into.
      // The lookup only returns the name (no contact data, see server).
      setValues(p => ({
        name: p.name || r.visitor.name || '',
        ...p,
      }));
    } catch {
      // 404 = first-timer; ignore quietly.
      setLookup(null);
    } finally {
      setLookingUp(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    setErr(null);

    for (const f of fields) {
      if (!f.required) continue;
      if (f.type === 'host-typeahead') {
        if (!hostId && !invitation) { setErr(t('kiosk.selectHost')); return; }
      } else if (!values[f.key] || String(values[f.key]).trim() === '') {
        setErr(t('kiosk.fillIn', { field: f.label })); return;
      }
    }

    const extra = {};
    for (const [k, v] of Object.entries(values)) {
      if (!STANDARD_KEYS.has(k)) extra[k] = v;
    }

    onDone({
      visitorName: values.name?.trim() ?? '',
      company: values.company?.trim() || null,
      email: values.email?.trim() || null,
      phone: values.phone?.trim() || null,
      hostUserId: hostId,
      purpose: values.purpose?.trim() || null,
      fields: extra,
      kioskSlug,
    }, lookup);
  };

  return (
    <form className="kiosk-card kiosk-form" onSubmit={onSubmit}>
      <h1>{invitation
        ? t('kiosk.welcomeName', { name: invitation.visitorName?.split(' ')[0] || t('common.visitor') })
        : t('kiosk.welcome')}</h1>
      {invitation && (
        <div className="kiosk-welcomeback">
          <strong>{t('kiosk.expected')}</strong> {t('kiosk.expectedHost', { host: invitation.host?.displayName })}
          {invitation.expectedAt ? t('kiosk.expectedAt', { time: invitation.expectedAt }) : null}{t('kiosk.expectedConfirm')}
        </div>
      )}
      {!invitation && <p>{t('kiosk.intro')}</p>}

      {lookup && (
        <div className="kiosk-welcomeback">
          <strong>{t('kiosk.welcomeBack', { name: lookup.name?.split(' ')[0] || t('common.visitor') })}</strong>{t('kiosk.welcomeBackBody')}
          {lookup.ndaCacheFresh && <div style={{ marginTop: 4, fontSize: 13 }}>{t('kiosk.ndaOnFile', { version: lookup.ndaCacheVersion })}</div>}
        </div>
      )}
      {lookingUp && <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{t('kiosk.checking')}</div>}

      {fields.map(f => {
        if (f.type === 'host-typeahead') {
          if (invitation) {
            // Locked: visitor was pre-booked with this host.
            return (
              <div key={f.key} style={{ marginTop: 16 }}>
                <label>{f.label}</label>
                <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10 }}>
                  <span>{invitation.host?.displayName}</span>
                  <span className="badge muted">{t('kiosk.preBooked')}</span>
                </div>
              </div>
            );
          }
          return (
            <HostPicker
              key={f.key} field={f} hosts={hosts}
              query={hostQuery} setQuery={setHostQuery}
              hostId={hostId} setHostId={setHostId}
            />
          );
        }
        return (
          <FieldInput
            key={f.key}
            field={f}
            value={values[f.key] ?? ''}
            onChange={(v) => set(f.key, v)}
            onBlur={f.key === 'email' && !invitation ? onEmailBlur : undefined}
          />
        );
      })}

      {err && <div className="error" role="alert">{err}</div>}
      <div style={{ marginTop: 24 }}>
        <button type="submit" className="kiosk-cta">{t('kiosk.continue')}</button>
      </div>
      <div style={{ marginTop: 16, fontSize: 14 }}>
        <Link to="/kiosk/signout" className="muted">{t('kiosk.alreadySignedIn')}</Link>
      </div>
    </form>
  );
}

function FieldInput({ field, value, onChange, onBlur }) {
  const t = useT();
  const id = `kf-${field.key}`;
  const common = {
    id, value,
    onChange: (e) => onChange(e.target.value),
    onBlur: onBlur,
    placeholder: field.placeholder ?? '',
    required: !!field.required,
  };
  return (
    <div style={{ marginTop: 16 }}>
      <label htmlFor={id}>{field.label}{field.required && <span className="req"> *</span>}</label>
      {field.type === 'textarea'
        ? <textarea {...common} rows={3} />
        : field.type === 'select'
          ? (
            <select {...common}>
              <option value="">{field.placeholder ?? t('kiosk.chooseOne')}</option>
              {(field.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          )
          : <input type={field.type} {...common} />}
    </div>
  );
}

function HostPicker({ field, hosts, query, setQuery, hostId, setHostId }) {
  const t = useT();
  const filtered = useMemo(() => {
    if (!query.trim()) return hosts.slice(0, 20);
    const q = query.toLowerCase();
    return hosts.filter(h => h.displayName.toLowerCase().includes(q)).slice(0, 20);
  }, [hosts, query]);
  const selectedName = hosts.find(h => h.id === hostId)?.displayName;
  return (
    <div style={{ marginTop: 16 }}>
      <label>{field.label}{field.required && <span className="req"> *</span>}</label>
      {selectedName ? (
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10 }}>
          <span>{selectedName}</span>
          <button type="button" className="secondary" onClick={() => { setHostId(null); setQuery(''); }}>{t('kiosk.change')}</button>
        </div>
      ) : (
        <>
          <input
            type="text" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={field.placeholder ?? t('kiosk.typeName')} autoComplete="off"
          />
          {query && (
            <div className="host-suggestions">
              {filtered.length === 0 && <div className="muted" style={{ padding: 8 }}>{t('kiosk.noMatches')}</div>}
              {filtered.map(h => (
                <button key={h.id} type="button" className="host-suggestion"
                  onClick={() => { setHostId(h.id); setQuery(h.displayName); }}>
                  {h.displayName}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ScrollableBody({ doc, onReachedBottom }) {
  const t = useT();
  const ref = useRef(null);
  const [reached, setReached] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
      if (atBottom && !reached) {
        setReached(true);
        onReachedBottom?.();
      }
      if (el.scrollHeight <= el.clientHeight && !reached) {
        setReached(true);
        onReachedBottom?.();
      }
    };
    check();
    el.addEventListener('scroll', check);
    return () => el.removeEventListener('scroll', check);
  }, [reached, onReachedBottom]);

  return (
    <>
      <h2 style={{ margin: 0 }}>{doc.title}</h2>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{t('kiosk.version', { version: doc.version })}</div>
      <div className="doc-body" ref={ref}>
        {doc.body.split(/\n{2,}/).map((p, i) => (
          <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{p}</p>
        ))}
      </div>
      {!reached && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>{t('kiosk.scrollToContinue')}</div>}
    </>
  );
}

function PhotoStage({ onDone }) {
  const t = useT();
  return (
    <div className="kiosk-card kiosk-photo">
      <h2 style={{ margin: 0 }}>{t('kiosk.photoTitle')}</h2>
      <p className="muted" style={{ margin: '4px 0 12px', fontSize: 14 }}>
        {t('kiosk.photoBody')}
      </p>
      <PhotoCapture onChange={(png) => { if (png) onDone(png); }} />
    </div>
  );
}

function DocumentAck({ doc, confirmLabel, onDone }) {
  const [reached, setReached] = useState(false);
  return (
    <div className="kiosk-card kiosk-doc">
      <ScrollableBody doc={doc} onReachedBottom={() => setReached(true)} />
      <div style={{ marginTop: 16 }}>
        <button className="kiosk-cta" disabled={!reached} onClick={onDone}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function NdaSign({ doc, visitorName, onDone }) {
  const t = useT();
  const [reached, setReached] = useState(false);
  const [signaturePng, setSignaturePng] = useState(null);
  const canConfirm = reached && signaturePng;

  return (
    <div className="kiosk-card kiosk-doc">
      <ScrollableBody doc={doc} onReachedBottom={() => setReached(true)} />
      <div style={{ marginTop: 16 }}>
        <label>{t('kiosk.signWithFinger')} {visitorName ? <>(<span className="muted">{visitorName}</span>)</> : null}</label>
        <SignaturePad onChange={setSignaturePng} disabled={!reached} />
      </div>
      <div style={{ marginTop: 16 }}>
        <button className="kiosk-cta" disabled={!canConfirm} onClick={() => onDone(signaturePng)}>
          {t('kiosk.agreeSign')}
        </button>
      </div>
    </div>
  );
}

function ThankYou({ visit, kiosk, onReset }) {
  const t = useT();
  const timer = useRef(null);
  useEffect(() => {
    timer.current = setTimeout(onReset, 12000);
    return () => clearTimeout(timer.current);
  }, [onReset]);

  const hostName = visit?.host?.displayName || visit?.host?.username || t('kiosk.yourHost');
  const printerName = kiosk?.defaultPrinterName;
  const badgeUrl = visit?.publicToken ? `/api/visits/badge/${visit.publicToken}` : null;
  const ndaAcked = (visit?.acknowledgments ?? []).some(a => a.kind === 'nda');
  const ndaCached = visit?._ndaCacheFresh;

  return (
    <div className="kiosk-card">
      <h1>{t('kiosk.thanks', { name: visit?.visitorName?.split(' ')[0] || t('common.visitor') })}</h1>
      <p>
        {t('kiosk.toldHost1')}<strong>{hostName}</strong>{t('kiosk.toldHost2')}
      </p>
      {badgeUrl && (
        <p>
          {t('kiosk.badgePrinting')}
          {printerName ? <>{t('kiosk.badgePrintingTo')}<strong>{printerName}</strong></> : null}.
          {' '}
          <a href={badgeUrl} target="_blank" rel="noopener noreferrer">{t('kiosk.reprint')}</a>.
        </p>
      )}
      {ndaAcked && visit?.email && (
        <p className="muted" style={{ fontSize: 14 }}>
          {t('kiosk.ndaEmailed', { email: visit.email })}
        </p>
      )}
      {ndaCached && (
        <p className="muted" style={{ fontSize: 14 }}>
          {t('kiosk.ndaCached')}
        </p>
      )}
      <button onClick={onReset} className="secondary">{t('common.done')}</button>
      <div className="kiosk-stub">{t('kiosk.returning')}</div>
    </div>
  );
}
