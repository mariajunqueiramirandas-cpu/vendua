import { afterEach, describe, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Calendar } from '@vendua/ui-defaults';

// The encomenda calendar (ui-defaults `Calendar`, used by checkout.SchedulePicker).

let root: Root | null = null;
let el: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
});

const AVAILABLE = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-06'];

async function mountCalendar(initial?: string) {
  const picked: string[] = [];
  function Host() {
    const [v, setV] = useState<string | undefined>(initial);
    return (
      <Calendar
        available={AVAILABLE}
        value={v}
        onChange={(d) => {
          picked.push(d);
          setV(d);
        }}
        label="Data da encomenda"
      />
    );
  }
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => root!.render(<Host />));
  return picked;
}
const day = (d: string) => document.querySelector(`[data-date="${d}"]`) as HTMLButtonElement;
const month = () => document.querySelector('.v-calendar-month')?.textContent;
const key = async (target: HTMLElement, k: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

describe('Calendar', () => {
  test('opens on the first bookable month; only bookable days select', async () => {
    const picked = await mountCalendar();
    expect(month()).toContain('Setembro de 2026');
    expect(document.querySelector('[role="grid"]')?.getAttribute('aria-label')).toContain(
      'Data da encomenda',
    );
    expect(day('2026-09-28').getAttribute('aria-disabled')).toBe('true');
    await act(async () => day('2026-09-28').click());
    expect(picked).toEqual([]);
    await act(async () => day('2026-09-30').click());
    expect(picked).toEqual(['2026-09-30']);
    expect(day('2026-09-30').getAttribute('aria-pressed')).toBe('true');
    // exactly one tab stop
    expect(document.querySelectorAll('.v-calendar-day[tabindex="0"]')).toHaveLength(1);
  });

  test('month navigation is bounded by the bookable window', async () => {
    await mountCalendar();
    const [prev, next] = [...document.querySelectorAll('.v-calendar-nav')] as HTMLButtonElement[];
    expect(prev!.disabled).toBe(true);
    await act(async () => next!.click());
    expect(month()).toContain('Outubro de 2026');
    expect(next!.disabled).toBe(true);
    expect(day('2026-10-06').getAttribute('aria-disabled')).toBeNull();
  });

  test('keyboard: arrows move focus (through unavailable days), PageDown changes month, Enter picks', async () => {
    const picked = await mountCalendar('2026-09-30');
    day('2026-09-30').focus();
    await key(day('2026-09-30'), 'ArrowRight');
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-10-01');
    expect(month()).toContain('Outubro de 2026');
    await key(day('2026-10-01'), 'ArrowRight');
    await key(day('2026-10-02'), 'ArrowRight');
    // 3 out is not bookable but still focusable; Enter does nothing there
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-10-03');
    await key(day('2026-10-03'), 'Enter');
    expect(picked).toEqual([]);
    await key(day('2026-10-03'), 'ArrowUp');
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-09-29');
    await key(day('2026-09-29'), 'PageDown');
    // clamped to the last bookable day
    expect(document.activeElement?.getAttribute('data-date')).toBe('2026-10-06');
    await key(day('2026-10-06'), 'Enter');
    expect(picked).toEqual(['2026-10-06']);
  });
});
