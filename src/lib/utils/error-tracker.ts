/**
 * Lightweight client-side error buffer for attaching recent JavaScript exceptions to bug reports.
 * Keeps up to 5 recent client errors within the last 10 minutes.
 */

interface TrackedError {
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  timestamp: string;
}

const errorBuffer: TrackedError[] = [];
const MAX_ERRORS = 5;
const BUFFER_TTL_MS = 10 * 60 * 1000; // 10 minutes

let initialized = false;

export function initErrorTracker() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  window.addEventListener('error', (event) => {
    try {
      const message = event.message || String(event.error?.message || event.error || 'Unknown window error');
      const filename = event.filename ? event.filename.split('/').pop() : undefined;
      addError({
        message: message.slice(0, 300),
        source: filename,
        lineno: event.lineno,
        colno: event.colno,
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (_) {}
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason;
      const message = typeof reason === 'string' ? reason : reason?.message || JSON.stringify(reason) || 'Unhandled Promise Rejection';
      addError({
        message: `Promise rejection: ${message.slice(0, 300)}`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (_) {}
  });
}

function addError(err: TrackedError) {
  errorBuffer.push(err);
  if (errorBuffer.length > MAX_ERRORS) {
    errorBuffer.shift();
  }
}

export function getRecentErrors(): string[] {
  if (typeof window === 'undefined') return [];
  return errorBuffer.map((e) => {
    const loc = e.source ? ` (${e.source}:${e.lineno || 0})` : '';
    return `[${e.timestamp}] ${e.message}${loc}`;
  });
}

export function clearRecentErrors() {
  errorBuffer.length = 0;
}
