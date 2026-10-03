import type { Clock } from '../ports.ts';

/** Time moves only when a test or a simulation says so. */
export class FakeClock implements Clock {
  private t: number;

  constructor(start: Date | string = '2026-10-03T15:00:00.000Z') {
    this.t = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.t);
  }

  advance(ms: number): void {
    this.t += ms;
  }

  set(at: Date): void {
    if (at.getTime() > this.t) this.t = at.getTime();
  }

  async sleep(ms: number): Promise<void> {
    this.advance(ms);
  }
}
