import { api } from '../api.js';

// Browser side of host alerts (Web Push). Kept free of React so the
// logout path can reuse it.

export function isIos() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

/** Why this browser can't take alerts, or null when it can. */
export function unsupportedReason() {
  if (!window.isSecureContext) return 'needsHttps';
  if (isIos() && !isStandalone()) return 'iosAddToHome';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return null;
}

export async function registration() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function currentSubscription() {
  if (unsupportedReason()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/** Ask permission, subscribe this browser and register it for the signed-in user. */
export async function enableAlerts() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    const err = new Error('permission ' + permission);
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  const cfg = await api.get('/api/push/config');
  if (!cfg.enabled || !cfg.publicKey) {
    const err = new Error('push disabled');
    err.code = 'SERVER_DISABLED';
    throw err;
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array(cfg.publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // A subscription made with an older server key can't be reused.
    const same = sub.options?.applicationServerKey
      && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === key[i]);
    if (!same) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.post('/api/push/subscriptions', sub.toJSON());
  return sub;
}

/** Remove this browser from the signed-in user's devices and drop the subscription. */
export async function disableAlerts() {
  const sub = await currentSubscription();
  if (!sub) return;
  try { await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }); } finally { await sub.unsubscribe(); }
}

/** Best effort, used on sign-out so a shared device stops getting this user's alerts. */
export async function disableAlertsQuietly() {
  try { await disableAlerts(); } catch { /* signing out must not fail over this */ }
}
