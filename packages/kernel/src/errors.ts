import { useSyncExternalStore } from 'react';
import { ApiError, type Notice } from './api.ts';
import { errorCopy } from './rules/errors.ts';

// Typed error codes map to default surfaces when the storefront doesn't handle
// them (02 — hooks). A primitive with no onError lands here; so does anything a
// storefront hands to useErrorSurface().show().

export { errorCopy };

export function errorCode(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string')
    return (err as { code: string }).code;
  return 'INTERNAL';
}

let transient: Notice[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
/** codes whose server truth changed — surfaces/store refetch so the overlay appears */
export const STATUS_CODES = new Set(['STORE_PAUSED', 'STORE_CLOSED', 'TENANT_SUSPENDED']);
let onStatusChange: (() => void) | null = null;
export function setStatusRefresher(fn: (() => void) | null) {
  onStatusChange = fn;
}

export function showError(err: unknown) {
  const code = errorCode(err);
  const copy = errorCopy(code);
  const id = `error:${code}`;
  transient = [
    ...transient.filter((n) => n.id !== id),
    {
      id,
      kind: 'error',
      severity: 'warning',
      title: copy.title,
      ...(copy.body ? { body: copy.body } : {}),
      dismissible: true,
      priority: 90,
      payload: { code },
    },
  ].slice(-3);
  notify();
  setTimeout(() => dismissError(id), 8000);
  if (STATUS_CODES.has(code)) onStatusChange?.();
}

/** An informational toast on the same transient stack (e.g. "sacola recuperada"). */
export function showInfo(id: string, title: string, body?: string) {
  const key = `info:${id}`;
  transient = [
    ...transient.filter((n) => n.id !== key),
    {
      id: key,
      kind: 'info',
      severity: 'info',
      title,
      ...(body ? { body } : {}),
      dismissible: true,
      priority: 80,
    },
  ].slice(-3);
  notify();
  setTimeout(() => dismissError(key), 8000);
}

export function dismissError(id: string) {
  const next = transient.filter((n) => n.id !== id);
  if (next.length !== transient.length) {
    transient = next;
    notify();
  }
}

export function useTransientNotices(): Notice[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => transient,
    () => transient,
  );
}

/** Storefront-facing: route any caught error to the default surface. */
export function useErrorSurface(): { show: (err: unknown) => void } {
  return { show: showError };
}
