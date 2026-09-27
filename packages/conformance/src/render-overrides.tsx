#!/usr/bin/env bun
// K15 worker: import each override a storefront registers and render it with its
// slot's canonical fixture props. Prints one JSON line: [{ key, ok, error? }].
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ComponentType } from 'react';
import { SLOT_FIXTURES } from '@vendua/ui-defaults';
import { SLOT_ALIASES } from '@vendua/kernel/config';

const dir = resolve(process.argv[2] ?? '.');
const cfg = (await import(resolve(dir, 'vendua.config.ts'))).default as {
  overrides?: Record<string, () => Promise<{ default: ComponentType<Record<string, unknown>> }>>;
};
const aliases = SLOT_ALIASES as Record<string, { to: string }>;
const results: { key: string; ok: boolean; error?: string }[] = [];
for (const [key, factory] of Object.entries(cfg.overrides ?? {})) {
  const slot = aliases[key]?.to ?? key;
  const props = (SLOT_FIXTURES as Record<string, Record<string, unknown>>)[slot];
  if (!props) {
    results.push({ key, ok: false, error: `no fixture for slot '${slot}'` });
    continue;
  }
  try {
    const C = (await factory()).default;
    const html = renderToStaticMarkup(createElement(C, props));
    results.push(
      html.length > 0
        ? { key, ok: true }
        : { key, ok: false, error: 'rendered nothing for the canonical fixture' },
    );
  } catch (e) {
    results.push({ key, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
console.log(JSON.stringify(results));
