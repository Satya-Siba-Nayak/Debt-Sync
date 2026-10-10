/**
 * Privacy-friendly device and environment context helper for bug reports
 */
export interface DeviceContext {
  os: string;
  browser: string;
  isMobile: boolean;
  screenResolution: string;
  userAgent: string;
}

export function getDeviceContext(): DeviceContext {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      os: 'Unknown',
      browser: 'Unknown',
      isMobile: false,
      screenResolution: 'N/A',
      userAgent: 'SSR',
    };
  }

  const ua = navigator.userAgent || '';
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);

  let os = 'Unknown OS';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Unknown Browser';
  if (/edg/i.test(ua)) browser = 'Edge';
  else if (/chrome|crios/i.test(ua) && !/opr|opera/i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/opera|opr/i.test(ua)) browser = 'Opera';

  const width = window.innerWidth || window.screen?.width || 0;
  const height = window.innerHeight || window.screen?.height || 0;

  return {
    os,
    browser,
    isMobile,
    screenResolution: `${width}x${height} (${isMobile ? 'Mobile View' : 'Desktop View'})`,
    userAgent: ua,
  };
}

export function formatDeviceSummary(device: DeviceContext): string {
  return `${device.isMobile ? '📱 Mobile' : '💻 Desktop'} • ${device.os} • ${device.browser} (${device.screenResolution})`;
}
