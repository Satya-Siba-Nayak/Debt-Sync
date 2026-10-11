/**
 * Privacy-friendly device, environment, and diagnostics context collector for bug reports.
 */

import { getRecentErrors } from './error-tracker';

export interface DeviceContext {
  os: string;
  browser: string;
  isMobile: boolean;
  isTablet?: boolean;
  screenResolution: string;
  viewportSize: string;
  pixelRatio: string;
  orientation: string;
  touchSupport: boolean;
  language: string;
  timezone: string;
  localTime: string;
  network: string;
  isPWA: boolean;
  theme: string;
  memory?: string;
  cores?: string;
  userAgent: string;
  recentErrors?: string[];
}

export function getDeviceContext(): DeviceContext {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      os: 'Unknown',
      browser: 'Unknown',
      isMobile: false,
      screenResolution: 'N/A',
      viewportSize: 'N/A',
      pixelRatio: '1x',
      orientation: 'landscape',
      touchSupport: false,
      language: 'en',
      timezone: 'UTC',
      localTime: new Date().toISOString(),
      network: 'Unknown',
      isPWA: false,
      theme: 'dark',
      userAgent: 'SSR',
    };
  }

  const ua = navigator.userAgent || '';
  const isTablet = /ipad|tablet|(android(?!.*mobile))/i.test(ua);
  const isMobile = !isTablet && /android|iphone|ipod|mobile/i.test(ua);

  // Operating System Detection
  let os = 'Unknown OS';
  if (/windows nt 10/i.test(ua)) os = 'Windows 10/11';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone/i.test(ua)) os = 'iOS (iPhone)';
  else if (/ipad/i.test(ua)) os = 'iPadOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/cros/i.test(ua)) os = 'ChromeOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  // Browser Detection
  let browser = 'Unknown Browser';
  const matchVersion = (regex: RegExp) => {
    const match = ua.match(regex);
    return match ? match[1] : '';
  };

  if (/edg\/([0-9.]+)/i.test(ua)) {
    browser = `Edge ${matchVersion(/edg\/([0-9]+)/i)}`;
  } else if (/opr\/([0-9.]+)/i.test(ua)) {
    browser = `Opera ${matchVersion(/opr\/([0-9]+)/i)}`;
  } else if (/chrome\/([0-9.]+)/i.test(ua) && !/crios/i.test(ua)) {
    browser = `Chrome ${matchVersion(/chrome\/([0-9]+)/i)}`;
  } else if (/crios\/([0-9.]+)/i.test(ua)) {
    browser = `Chrome iOS ${matchVersion(/crios\/([0-9]+)/i)}`;
  } else if (/firefox\/([0-9.]+)/i.test(ua) || /fxios\/([0-9.]+)/i.test(ua)) {
    browser = `Firefox ${matchVersion(/(?:firefox|fxios)\/([0-9]+)/i)}`;
  } else if (/safari/i.test(ua) && /version\/([0-9.]+)/i.test(ua)) {
    browser = `Safari ${matchVersion(/version\/([0-9]+)/i)}`;
  }

  // Display & Screen Specs
  const screenWidth = window.screen?.width || 0;
  const screenHeight = window.screen?.height || 0;
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const dpr = window.devicePixelRatio ? Math.round(window.devicePixelRatio * 10) / 10 : 1;
  const orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  const touchSupport = Boolean(
    navigator.maxTouchPoints && navigator.maxTouchPoints > 0
  );

  // Network & Connection Info
  let network = navigator.onLine ? 'Online' : 'Offline';
  const navConn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (navConn) {
    const type = navConn.effectiveType ? navConn.effectiveType.toUpperCase() : '';
    const downlink = navConn.downlink ? `~${navConn.downlink}Mbps` : '';
    const rtt = navConn.rtt ? `${navConn.rtt}ms RTT` : '';
    const details = [type, downlink, rtt].filter(Boolean).join(', ');
    if (details) network = `${network} (${details})`;
  }

  // PWA Standalone Detection
  const isPWA =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;

  // Active UI Theme
  const isDark = document.documentElement.classList.contains('dark') ||
    localStorage.getItem('debtsync_theme') === 'dark';
  const theme = isDark ? 'Dark Mode' : 'Light Mode';

  // System Hardware Specs
  const memory = (navigator as any).deviceMemory
    ? `~${(navigator as any).deviceMemory} GB RAM`
    : undefined;
  const cores = navigator.hardwareConcurrency
    ? `${navigator.hardwareConcurrency} Cores`
    : undefined;

  // Locale & Time
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (_) {}

  const now = new Date();
  const localTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    ` (${now.toLocaleDateString([], { month: 'short', day: 'numeric' })})`;

  const recentErrors = getRecentErrors();

  return {
    os,
    browser,
    isMobile,
    isTablet,
    screenResolution: `${screenWidth}x${screenHeight}`,
    viewportSize: `${viewportWidth}x${viewportHeight}`,
    pixelRatio: `${dpr}x`,
    orientation,
    touchSupport,
    language: navigator.language || 'en',
    timezone,
    localTime,
    network,
    isPWA,
    theme,
    memory,
    cores,
    userAgent: ua,
    recentErrors: recentErrors.length > 0 ? recentErrors : undefined,
  };
}

export function formatDeviceSummary(device: DeviceContext): string {
  const typeIcon = device.isTablet ? '📱 Tablet' : device.isMobile ? '📱 Mobile' : '💻 Desktop';
  return `${typeIcon} • ${device.os} • ${device.browser} (${device.viewportSize})`;
}
