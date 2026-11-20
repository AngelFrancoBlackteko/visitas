import { config } from '../config.js';
import { logger } from '../logger.js';
import { db } from '../db/index.js';
import { sendEmail, emailEnabled } from './email.js';
import { sendSms, smsEnabled } from './sms.js';
import { t } from '../i18n/index.js';

/**
 * Fire host notifications for a visit event.
 *
 * event: 'signed_in' | 'signed_out' | 'force_signed_out'
 * visit: the visit record (must have host fields populated, or host_user_id)
 * actor: user object (admin/security) for force_signed_out events; null otherwise
 *
 * Fire-and-forget by default — the caller doesn't await. Errors are logged.
 * Tests can `await notifyVisitEvent(...)` directly to drive the dispatch.
 */
export async function notifyVisitEvent(event, { visit, actor = null } = {}) {
  if (!visit) return;
  if (!emailEnabled() && !smsEnabled()) return;

  const host = loadHost(visit);
  if (!host) return;

  const subject = subjectFor(event, visit, host);
  const body = bodyFor(event, visit, actor);

  const tasks = [];
  if (emailEnabled() && wantsChannel('email', event) && host.email) {
    tasks.push(
      sendEmail({ to: host.email, subject, text: body, event })
        .catch(err => logger.error({ err: err.message, event, hostId: host.id }, 'email notify failed'))
    );
  }
  if (smsEnabled() && wantsChannel('sms', event) && host.phone) {
    tasks.push(
      sendSms({ to: host.phone, body: `${subject}\n${body}`, event })
        .catch(err => logger.error({ err: err.message, event, hostId: host.id }, 'sms notify failed'))
    );
  }
  await Promise.allSettled(tasks);
}

/** Schedule notifyVisitEvent for fire-and-forget dispatch (does not block the caller). */
export function notifyVisitEventAsync(event, payload) {
  setImmediate(() => {
    notifyVisitEvent(event, payload).catch(err => {
      logger.error({ err: err.message, event }, 'notify dispatch failed');
    });
  });
}

/**
 * Banned sign-in attempt → email + SMS to all active admin + security
 * users so the floor team can intercept the visitor at the door. Uses the
 * same per-channel events filter (event name 'signin_blocked').
 *
 * Best-effort: failures logged, never propagated.
 */
export async function notifySigninBlocked({ ban, attempt }) {
  if (!emailEnabled() && !smsEnabled()) return;

  const recipients = db.prepare(`
    SELECT id, email, phone, display_name, username
    FROM users
    WHERE active = 1 AND role IN ('admin','security')
  `).all();
  if (recipients.length === 0) return;

  const subject = t('blocked.subject', { visitor: attempt.visitorName ?? t('blocked.unknown') });
  const body = [
    t('blocked.intro'),
    '',
    t('blocked.visitor', { value: `${attempt.visitorName ?? '—'}${attempt.company ? ` (${attempt.company})` : ''}` }),
    t('blocked.email', { value: attempt.email ?? '—' }),
    t('blocked.kiosk', { value: attempt.kioskSlug ?? 'default' }),
    '',
    t('blocked.ban', { id: ban.id, mode: ban.mode }),
    t('blocked.reason', { reason: ban.reason }),
    '',
    t('blocked.action'),
  ].join('\n');

  const tasks = [];
  for (const r of recipients) {
    if (emailEnabled() && wantsChannel('email', 'signin_blocked') && r.email) {
      tasks.push(
        sendEmail({ to: r.email, subject, text: body, event: 'signin_blocked' })
          .catch(err => logger.error({ err: err.message, userId: r.id }, 'signin_blocked email failed'))
      );
    }
    if (smsEnabled() && wantsChannel('sms', 'signin_blocked') && r.phone) {
      tasks.push(
        sendSms({ to: r.phone, body: `${subject}\n${t('blocked.sms', { visitor: attempt.visitorName ?? '—', kiosk: attempt.kioskSlug ?? 'default' })}`, event: 'signin_blocked' })
          .catch(err => logger.error({ err: err.message, userId: r.id }, 'signin_blocked sms failed'))
      );
    }
  }
  await Promise.allSettled(tasks);
}

export function notifySigninBlockedAsync(payload) {
  setImmediate(() => {
    notifySigninBlocked(payload).catch(err => {
      logger.error({ err: err.message }, 'signin_blocked dispatch failed');
    });
  });
}

function loadHost(visit) {
  // Service layer returns visit.host = { id, username, displayName }, but
  // we also want email + phone for delivery. Re-query when present.
  const id = visit.host?.id ?? visit.host_user_id;
  if (!id) return null;
  return db.prepare(
    'SELECT id, username, email, display_name, phone FROM users WHERE id = ? AND active = 1',
  ).get(id);
}

function wantsChannel(channel, event) {
  const events = config.notifications?.[channel]?.events;
  if (!Array.isArray(events) || !events.length) return true;
  return events.includes(event);
}

function subjectFor(event, visit, host) {
  const hostName = host.display_name || host.username;
  const visitor = visit.visitorName ?? visit.visitor_name ?? t('notify.aVisitor');
  switch (event) {
    case 'signed_in':         return t('notify.signedIn.subject', { visitor, host: hostName });
    case 'signed_out':        return t('notify.signedOut.subject', { visitor });
    case 'force_signed_out':  return t('notify.forceSignedOut.subject', { visitor });
    default:                  return t('notify.other.subject', { event, visitor });
  }
}

function bodyFor(event, visit, actor) {
  const visitor = visit.visitorName ?? visit.visitor_name ?? t('notify.visitor');
  const company = visit.company ? t('notify.fromCompany', { company: visit.company }) : '';
  const purpose = visit.purpose ? t('notify.reason', { purpose: visit.purpose }) : null;

  const lines = [];
  switch (event) {
    case 'signed_in':
      lines.push(t('notify.signedIn.body', { visitor, company }));
      if (purpose) lines.push(purpose);
      lines.push(t('notify.signedIn.waiting'));
      break;
    case 'signed_out':
      lines.push(t('notify.signedOut.body', { visitor }));
      break;
    case 'force_signed_out': {
      const role = actor?.role ? t(`role.${actor.role}`) : '';
      const by = actor ? `${actor.display_name || actor.username} (${role})` : t('notify.reception');
      lines.push(t('notify.forceSignedOut.body', { visitor, by }));
      break;
    }
    default:
      lines.push(t('notify.other.body', { event }));
  }
  return lines.join('\n');
}
