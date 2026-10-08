import type { Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import { PRINT_CHANNEL } from './jobs.ts';

export type DeviceSignal = 'job' | 'config' | 'revoked' | 'resync' | 'superseded';

const hubLog = log.child({ mod: 'print-hub' });

/** One LISTEN per Core process, fanned out to the open streams of each device. */
export class PrintHub {
  private listeners = new Map<string, Set<(s: DeviceSignal) => void>>();
  private started: Promise<void> | null = null;

  constructor(private sql: Sql) {}

  private ensure(): Promise<void> {
    this.started ??= this.sql
      .listen(
        PRINT_CHANNEL,
        (payload) => {
          const [, deviceId, what] = payload.split('|');
          if (!deviceId || !what) return;
          for (const fn of this.listeners.get(deviceId) ?? []) fn(what as DeviceSignal);
        },
        // (re)subscribed: a signal may have been missed meanwhile
        () => {
          for (const set of this.listeners.values()) for (const fn of set) fn('resync');
        },
      )
      .then(() => undefined)
      .catch((err) => {
        // streams still rescan on every beat; the next subscribe retries the LISTEN
        hubLog.error({ err }, 'print LISTEN failed');
        this.started = null;
      });
    return this.started;
  }

  streams(deviceId: string): number {
    return this.listeners.get(deviceId)?.size ?? 0;
  }

  /** Tell this device's other streams in this process that a newer one may have replaced them. */
  supersede(deviceId: string, keep: (s: DeviceSignal) => void) {
    for (const fn of this.listeners.get(deviceId) ?? []) if (fn !== keep) fn('superseded');
  }

  async subscribe(deviceId: string, fn: (s: DeviceSignal) => void): Promise<() => void> {
    await this.ensure();
    let set = this.listeners.get(deviceId);
    if (!set) this.listeners.set(deviceId, (set = new Set()));
    set.add(fn);
    return () => {
      const cur = this.listeners.get(deviceId);
      cur?.delete(fn);
      if (cur?.size === 0) this.listeners.delete(deviceId);
    };
  }
}
