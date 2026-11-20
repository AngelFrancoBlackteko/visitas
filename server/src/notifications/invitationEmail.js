import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { emailEnabled } from './email.js';
import { createPending, markSent, markFailed } from '../services/notificationsLog.js';
import { t, getLanguage } from '../i18n/index.js';

let testOverride = null;

/**
 * Send the invitation email. Builds a kiosk URL (using config.baseUrl) and a
 * QR code PNG (server-side render via the `qrcode` package). The QR is
 * attached as a CID so the email client renders it inline.
 *
 * Best-effort: returns silently if disabled, no email, or an error.
 */
export async function sendInvitationEmail({ invitation, branding }) {
  if (!emailEnabled() && !testOverride) return;
  if (!invitation?.email) return;

  const baseUrl = (config.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
  const kioskPath = invitation.kiosk?.slug ? `/kiosk/${invitation.kiosk.slug}` : '/kiosk/default';
  const inviteUrl = `${baseUrl}${kioskPath}?invite=${encodeURIComponent(invitation.token)}`;

  // In tests, bypass QR rendering + transport entirely — the override
  // captures the call synchronously so tests don't have to wait through
  // the qrcode import + nodemailer setup.
  if (testOverride) {
    const appName = branding?.appName || 'visitas.world';
    return testOverride({
      to: invitation.email,
      subject: t('invite.subject', { app: appName, host: invitation.host.displayName || invitation.host.username }),
      text: renderText({ invitation, inviteUrl, appName }),
      html: '<test/>',
      inviteUrl,
    });
  }

  // Lazy-load qrcode so the dependency is optional in environments that
  // don't use invitations.
  let qrPng;
  try {
    const { default: QRCode } = await import('qrcode');
    qrPng = await QRCode.toBuffer(inviteUrl, { type: 'png', margin: 1, width: 240 });
  } catch (err) {
    logger.warn({ err: err.message }, 'qrcode rendering failed; sending email without QR');
    qrPng = null;
  }

  const cid = 'visitas-invite-qr@visitas';
  const appName = branding?.appName || 'visitas.world';
  const subject = t('invite.subject', { app: appName, host: invitation.host.displayName || invitation.host.username });
  const text = renderText({ invitation, inviteUrl, appName });
  const html = renderHtml({ invitation, inviteUrl, appName, hasQr: !!qrPng, cid });

  const cfg = config.notifications.email.smtp ?? {};
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port ?? 587,
    secure: cfg.secure ?? false,
    auth: cfg.user ? { user: cfg.user, pass: config.smtpPassword } : undefined,
  });

  const logId = createPending({ kind: 'email', event: 'invitation', recipient: invitation.email, subject });
  try {
    await transporter.sendMail({
      from: config.notifications.email.from,
      to: invitation.email,
      subject,
      text,
      html,
      attachments: qrPng ? [{
        filename: 'invite-qr.png',
        content: qrPng,
        cid,
        contentType: 'image/png',
      }] : [],
    });
    markSent(logId);
    logger.info({ to: invitation.email, invitationId: invitation.id }, 'invitation email sent');
  } catch (err) {
    markFailed(logId, err);
    logger.error({ err: err.message, invitationId: invitation.id }, 'invitation email failed');
  }
}

export function setInvitationSenderForTests(fn) {
  testOverride = fn;
}

function renderText({ invitation, inviteUrl, appName }) {
  const hostName = invitation.host.displayName || invitation.host.username;
  const lines = [
    t('invite.invited', { app: appName }),
    '',
    `${t('invite.host')} ${hostName}`,
    invitation.expectedAt ? `${t('invite.expected')} ${invitation.expectedAt}` : null,
    invitation.purpose ? `${t('invite.purpose')} ${invitation.purpose}` : null,
    '',
    t('invite.onArrivalText'),
    inviteUrl,
    '',
    t('invite.expires', { date: invitation.expiresAt }),
  ].filter(l => l !== null);
  return lines.join('\n');
}

function renderHtml({ invitation, inviteUrl, appName, hasQr, cid }) {
  const hostName = escape(invitation.host.displayName || invitation.host.username);
  const expected = invitation.expectedAt ? escape(invitation.expectedAt) : null;
  const purpose = invitation.purpose ? escape(invitation.purpose) : null;
  return `<!doctype html>
<html lang="${getLanguage()}"><head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, system-ui, sans-serif; color: #111; max-width: 640px; margin: 0 auto; padding: 24px;">
  <p>${escape(t('invite.hi', { name: invitation.visitorName }))}</p>
  <p>${escape(t('invite.invited', { app: appName }))}</p>
  <table style="border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 4px 12px 4px 0; color: #666;">${escape(t('invite.host'))}</td><td style="padding: 4px 0;">${hostName}</td></tr>
    ${expected ? `<tr><td style="padding: 4px 12px 4px 0; color: #666;">${escape(t('invite.expected'))}</td><td style="padding: 4px 0;">${expected}</td></tr>` : ''}
    ${purpose ? `<tr><td style="padding: 4px 12px 4px 0; color: #666;">${escape(t('invite.purpose'))}</td><td style="padding: 4px 0;">${purpose}</td></tr>` : ''}
  </table>
  <p>${escape(t('invite.onArrivalHtml'))}</p>
  ${hasQr ? `<p style="margin: 16px 0;"><img src="cid:${cid}" alt="${escape(t('invite.qrAlt'))}" style="border: 1px solid #eee; padding: 8px; background: #fff;" /></p>` : ''}
  <p><a href="${escape(inviteUrl)}" style="display: inline-block; background: #5b9dff; color: #0e1116; padding: 10px 18px; border-radius: 8px; font-weight: 600; text-decoration: none;">${escape(t('invite.openKiosk'))}</a></p>
  <p style="color: #888; font-size: 12px; margin-top: 24px;">${escape(t('invite.expires', { date: invitation.expiresAt }))} — ${escape(appName)}</p>
</body></html>`;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
