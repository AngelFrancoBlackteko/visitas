import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, createUser, client, adminAgent, agentFor } from './helpers.js';
import { config } from '../src/config.js';
import { setTransportForTests } from '../src/notifications/email.js';
import { setSenderForTests } from '../src/notifications/sms.js';
import { notifyVisitEvent, notifySigninBlocked } from '../src/notifications/index.js';
import { setInvitationSenderForTests, sendInvitationEmail } from '../src/notifications/invitationEmail.js';
import { createVisit } from '../src/services/visits.js';
import { setSetting } from '../src/services/settings.js';
import { messages } from '../src/i18n/messages.js';
import { defaultLanguage, t, pickLocalized, SUPPORTED_LANGUAGES } from '../src/i18n/index.js';
import webEs from '../../web/src/i18n/es.js';
import webEn from '../../web/src/i18n/en.js';

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

function expectSameShape(a, b) {
  expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(a)) {
    expect({ key: k, vars: placeholders(a[k]) }).toEqual({ key: k, vars: placeholders(b[k]) });
  }
}

describe('dictionaries', () => {
  test('server es and en have the same keys and placeholders', () => {
    expectSameShape(messages.es, messages.en);
  });

  test('web es and en have the same keys and placeholders', () => {
    expectSameShape(webEs, webEn);
  });

  test('every supported language has server messages', () => {
    for (const lang of SUPPORTED_LANGUAGES) expect(messages[lang]).toBeTruthy();
  });
});

describe('language selection', () => {
  const ORIGINAL = process.env.DEFAULT_LANGUAGE;
  afterEach(() => { process.env.DEFAULT_LANGUAGE = ORIGINAL; });

  test('Spanish is the default when DEFAULT_LANGUAGE is unset or invalid', () => {
    delete process.env.DEFAULT_LANGUAGE;
    expect(defaultLanguage()).toBe('es');
    process.env.DEFAULT_LANGUAGE = 'fr';
    expect(defaultLanguage()).toBe('es');
    process.env.DEFAULT_LANGUAGE = 'EN';
    expect(defaultLanguage()).toBe('en');
  });

  test('t() interpolates and falls back to the key', () => {
    expect(t('notify.signedOut.body', { visitor: 'Ana' }, 'es')).toBe('Ana registró su salida en el kiosco.');
    expect(t('does.not.exist', {}, 'es')).toBe('does.not.exist');
  });

  test('pickLocalized resolves objects and passes strings through', () => {
    expect(pickLocalized({ es: 'Empresa', en: 'Company' }, 'es')).toBe('Empresa');
    expect(pickLocalized({ en: 'Company' }, 'es')).toBe('Company');
    expect(pickLocalized('Same', 'es')).toBe('Same');
  });
});

describe('language setting API', () => {
  beforeEach(resetDb);

  test('branding is public and reports the active language', async () => {
    const res = await client().get('/api/settings/branding');
    expect(res.status).toBe(200);
    expect(res.body.language).toBe('en'); // test setup sets DEFAULT_LANGUAGE=en
  });

  test('admin can switch to Spanish; it shows up in branding', async () => {
    const a = await adminAgent();
    const put = await a.put('/api/settings/language').send({ language: 'es' });
    expect(put.status).toBe(200);
    expect(put.body.language).toBe('es');
    const b = await client().get('/api/settings/branding');
    expect(b.body.language).toBe('es');
  });

  test('rejects unsupported languages', async () => {
    const a = await adminAgent();
    const res = await a.put('/api/settings/language').send({ language: 'fr' });
    expect(res.status).toBe(400);
  });

  test('anonymous and security users cannot change the language', async () => {
    expect((await client().put('/api/settings/language').send({ language: 'es' })).status).toBe(401);
    createUser({ username: 'guard', password: 'GuardPass1234', role: 'security' });
    const g = await agentFor('guard', 'GuardPass1234');
    expect((await g.put('/api/settings/language').send({ language: 'es' })).status).toBe(403);
  });
});

describe('Spanish output', () => {
  let emailsSent;
  let smsSent;
  const ORIGINAL_NOTIFICATIONS = JSON.parse(JSON.stringify(config.notifications));

  beforeEach(() => {
    resetDb();
    setSetting('app.language', 'es');
    emailsSent = [];
    smsSent = [];
    setTransportForTests({ sendMail: async (m) => { emailsSent.push(m); return { messageId: 'x' }; } });
    setSenderForTests(async (m) => { smsSent.push(m); });
    config.notifications = {
      email: { enabled: true, from: 't@x', smtp: { host: 'h' }, events: [] },
      sms: { enabled: true, adapter: 'twilio', twilio: {}, events: [] },
    };
  });

  afterEach(() => {
    setTransportForTests(null);
    setSenderForTests(null);
    setInvitationSenderForTests(null);
    config.notifications = JSON.parse(JSON.stringify(ORIGINAL_NOTIFICATIONS));
  });

  test('visitor form labels and options come back in Spanish', async () => {
    const res = await client().get('/api/visitor-form');
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.fields.map(f => [f.key, f]));
    expect(byKey.name.label).toBe('Su nombre');
    expect(byKey.host.label).toBe('¿A quién viene a ver?');
    expect(byKey.purpose.options).toContain('Reunión');
    for (const f of res.body.fields) {
      expect(typeof f.label).toBe('string');
      for (const o of f.options ?? []) expect(typeof o).toBe('string');
    }
  });

  test('badge prints in Spanish', async () => {
    const host = createUser({ username: 'h1', displayName: 'Ana Anfitriona', role: 'admin' });
    const v = await client().post('/api/visits').send({ visitorName: 'Luis Visitante', hostUserId: host.id });
    expect(v.status).toBe(201);
    const res = await client().get(`/api/visits/badge/${v.body.visit.publicToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="es">');
    expect(res.text).toContain('Visita a:');
    expect(res.text).toContain('Escanee para salir');
    expect(res.text).toContain('Imprimir gafete');
    expect(res.text).not.toContain('Scan to sign out');
  });

  test('host arrival email + SMS are in Spanish', async () => {
    const host = createUser({ username: 'h1', displayName: 'Ana', email: 'ana@x.com', phone: '+525500000000', role: 'admin' });
    const visit = createVisit({ visitorName: 'Luis', company: 'ACME', purpose: 'Reunión', hostUserId: host.id });
    await notifyVisitEvent('signed_in', { visit });
    expect(emailsSent[0].subject).toBe('[visitas.world] Luis está aquí para ver a Ana');
    expect(emailsSent[0].text).toContain('Luis de ACME acaba de registrarse');
    expect(emailsSent[0].text).toContain('Motivo: Reunión');
    expect(smsSent[0].body).toContain('Le espera en recepción.');
  });

  test('force sign-out names the role in Spanish', async () => {
    const host = createUser({ username: 'h1', email: 'ana@x.com', role: 'admin' });
    const visit = createVisit({ visitorName: 'Luis', hostUserId: host.id });
    await notifyVisitEvent('force_signed_out', { visit, actor: { username: 'guard', role: 'security' } });
    expect(emailsSent[0].text).toBe('guard (seguridad) registró la salida de Luis (salida forzada).');
  });

  test('banned sign-in alert is in Spanish', async () => {
    createUser({ username: 'boss', email: 'boss@x.com', role: 'admin' });
    await notifySigninBlocked({
      ban: { id: 7, mode: 'email', reason: 'prueba' },
      attempt: { visitorName: 'Pedro', email: 'p@x.com', kioskSlug: 'default' },
    });
    const mail = emailsSent.find(m => m.to === 'boss@x.com');
    expect(mail.subject).toBe('[visitas.world] Intento de registro bloqueado — Pedro');
    expect(mail.text).toContain('Motivo: prueba');
  });

  test('invitation email is in Spanish', async () => {
    const captured = [];
    setInvitationSenderForTests(async (m) => { captured.push(m); });
    await sendInvitationEmail({
      invitation: {
        token: 'tok', email: 'v@x.com', visitorName: 'Luis', expiresAt: '2026-12-01',
        host: { displayName: 'Ana' }, expectedAt: 'martes 10 a. m.', purpose: 'Reunión',
      },
      branding: { appName: 'Corporativo' },
    });
    expect(captured[0].subject).toBe('[Corporativo] Invitación de visita — Ana');
    expect(captured[0].text).toContain('Le invitamos a visitar Corporativo.');
    expect(captured[0].text).toContain('Anfitrión: Ana');
    expect(captured[0].text).toContain('Esta invitación vence el 2026-12-01.');
  });

  test('admin test email uses the Spanish copy', async () => {
    const a = await adminAgent();
    const res = await a.post('/api/settings/email/test').send({ to: 'me@x.com' });
    expect(res.status).toBe(200);
    expect(emailsSent[0].subject).toBe('[visitas.world] Correo de prueba');
  });
});
