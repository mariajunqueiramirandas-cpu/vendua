import { afterAll, beforeAll, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The preview decides at import time whether it is framed with ?vendua-preview=1, so the
// frame is faked first and the module loaded under its own specifier.
const ADMIN = 'https://painel.test';
const sent: { data: unknown; target: string }[] = [];
const parent = {
  postMessage: (data: unknown, target: string) => void sent.push({ data, target }),
};
const realParent = Object.getOwnPropertyDescriptor(window, 'parent');
let preview: typeof import('../src/preview.ts');
let drafts: unknown = 'unset';
let root: Root;
let host: HTMLElement;

function Probe() {
  drafts = preview.usePreviewTemplates();
  return null;
}

function send(origin: string, data: unknown, source: unknown = parent) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as never }));
  });
}

beforeAll(async () => {
  history.replaceState(null, '', '/?vendua-preview=1');
  Object.defineProperty(window, 'parent', { configurable: true, get: () => parent });
  const fresh = '../src/preview.ts?origin-test';
  preview = (await import(fresh)) as typeof preview;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Probe />));
});

afterAll(() => {
  act(() => root.unmount());
  host.remove();
  if (realParent) Object.defineProperty(window, 'parent', realParent);
  history.replaceState(null, '', '/');
});

test('an admin origin nobody reported yet: the frame stays inert and announces nothing', () => {
  expect(preview.isPreview()).toBe(true);
  send(ADMIN, { type: 'vendua:preview', templates: {} });
  expect(drafts).toBeNull();
  expect(sent).toEqual([]);
});

test('drafts are taken only from the admin origin Core reported', () => {
  act(() => preview.setPreviewOrigin(`${ADMIN}/admin/`));
  expect(sent.at(-1)).toMatchObject({ target: ADMIN, data: { type: 'vendua:preview-ready' } });

  send('https://evil.test', { type: 'vendua:preview', templates: {} });
  expect(drafts).toBeNull();
  // right origin, but not from the parent frame
  send(ADMIN, { type: 'vendua:preview', templates: {} }, window);
  expect(drafts).toBeNull();

  send(ADMIN, { type: 'vendua:preview', templates: {} });
  expect(drafts).toEqual({});
});

test('an unusable origin turns the preview off again', () => {
  act(() => preview.setPreviewOrigin('not a url'));
  const before = sent.length;
  send(ADMIN, { type: 'vendua:preview', selected: 'hero' });
  const outline = [...document.head.querySelectorAll('style')].some((s) =>
    s.textContent?.includes('hero'),
  );
  expect(outline).toBe(false);
  expect(sent.length).toBe(before);
});
