'use client';

import { createClient } from '@/lib/supabase/client';

// Public VAPID key (safe to expose - it only identifies the sender).
// Must match the VAPID_PUBLIC_KEY secret used by the `notify` Edge Function.
const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  'BAappeQMSJcmdlAHkW1knf1UqElx2ZueW3g8EY_SMeadn0g4cUMytyQdpvU9ZTvHoEuBkDHrA6BE360-NcW0X6c';

export type PushResult = { ok: true } | { ok: false; reason: string };

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  // navigator.serviceWorker.ready never resolves if no SW is registered
  // (e.g. localhost, where the app deliberately unregisters it), so race a timeout.
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/**
 * Subscribes this browser to background push and registers it for the signed-in
 * user. Requires Notification permission to already be 'granted'.
 */
export async function subscribeToPush(): Promise<PushResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (Notification.permission !== 'granted') return { ok: false, reason: 'permission' };

  try {
    const reg = await getRegistration();
    if (!reg) return { ok: false, reason: 'service-worker-unavailable' };

    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }

    const json = sub.toJSON();
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!json.endpoint || !p256dh || !auth) return { ok: false, reason: 'invalid-subscription' };

    const supabase = createClient();
    const { data, error } = await supabase.rpc('register_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent,
    });

    if (error || !data?.success) {
      return { ok: false, reason: error?.message || data?.error || 'register-failed' };
    }
    return { ok: true };
  } catch (err: any) {
    // A subscription created with an old/different VAPID key throws on re-subscribe:
    // drop it so the next attempt creates a fresh one.
    try {
      const reg = await getRegistration();
      const stale = await reg?.pushManager.getSubscription();
      await stale?.unsubscribe();
    } catch (_) {}
    return { ok: false, reason: err?.message || 'subscribe-failed' };
  }
}

/** Removes this device's push subscription (used on sign-out and "turn off"). */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;

    const endpoint = sub.endpoint;
    try {
      const supabase = createClient();
      await supabase.rpc('unregister_push_subscription', { p_endpoint: endpoint });
    } catch (_) {}
    await sub.unsubscribe();
  } catch (err) {
    console.warn('Failed to unsubscribe from push:', err);
  }
}

/**
 * Silent re-sync for users who already granted permission: keeps the device
 * registered to the *current* account (covers account switches / expired subs).
 * Throttled to once per browser session per user.
 */
export async function syncPushSubscription(userId: string): Promise<void> {
  if (!isPushSupported() || Notification.permission !== 'granted' || !userId) return;
  const key = `debtsync_push_synced_${userId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch (_) {}
  await subscribeToPush();
}/** Checks if this browser currently has an active Web Push subscription. */
export async function isPushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return Boolean(sub);
  } catch (_) {
    return false;
  }
}
