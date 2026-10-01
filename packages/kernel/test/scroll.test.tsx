import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { ScrollManager } from '../src/scroll.tsx';

let nav: ReturnType<typeof useNavigate>;
let calls: number[];
let root: Root;
let host: HTMLElement;
const orig = window.scrollTo;

function Grab() {
  nav = useNavigate();
  return null;
}

beforeEach(() => {
  calls = [];
  window.scrollTo = ((o: ScrollToOptions) =>
    void calls.push(o.top ?? -1)) as typeof window.scrollTo;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/catalog']}>
        <ScrollManager />
        <Grab />
        <div id="produto-1" />
      </MemoryRouter>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.scrollTo = orig;
});

test('a new path scrolls to the top', () => {
  act(() => void nav('/sacola'));
  expect(calls.at(-1)).toBe(0);
});

test('same path, new query or a replace of filters does not move the page', () => {
  act(() => void nav('/catalog?q=flan'));
  expect(calls).toHaveLength(0);
});

test('a #hash scrolls to its element, not the top', () => {
  let scrolled = false;
  document.getElementById('produto-1')!.scrollIntoView = () => void (scrolled = true);
  act(() => void nav('/catalog#produto-1'));
  expect(scrolled).toBe(true);
  expect(calls).toHaveLength(0);
});

test('back to an unvisited position goes to the top', () => {
  act(() => void nav('/sacola'));
  calls.length = 0;
  act(() => void nav(-1));
  expect(calls.at(-1)).toBe(0);
});

test('a #hash lands smoothly and marks its element for a moment (Kernel 1.14)', async () => {
  const el = document.getElementById('produto-1')!;
  let opts: ScrollIntoViewOptions | undefined;
  el.scrollIntoView = ((o?: ScrollIntoViewOptions) => void (opts = o)) as typeof el.scrollIntoView;
  act(() => void nav('/catalog#produto-1'));
  expect(opts?.behavior).toBe('smooth');
  expect(el.hasAttribute('data-target')).toBe(true);
  await act(async () => new Promise((r) => setTimeout(r, 2100)));
  expect(el.hasAttribute('data-target')).toBe(false);
});

test('with reduced motion the #hash jump is instant', () => {
  const orig = globalThis.matchMedia;
  globalThis.matchMedia = ((q: string) => ({
    matches: q.includes('reduce'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof globalThis.matchMedia;
  try {
    // remount so the hook reads the new setting
    act(() => root.unmount());
    root = createRoot(host);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/catalog']}>
          <ScrollManager />
          <Grab />
          <div id="produto-2" />
        </MemoryRouter>,
      );
    });
    const el = document.getElementById('produto-2')!;
    let opts: ScrollIntoViewOptions | undefined;
    el.scrollIntoView = ((o?: ScrollIntoViewOptions) =>
      void (opts = o)) as typeof el.scrollIntoView;
    act(() => void nav('/catalog#produto-2'));
    expect(opts?.behavior).toBe('instant');
  } finally {
    globalThis.matchMedia = orig;
  }
});
