import { readFileSync } from 'node:fs';

const page = (name: string) => readFileSync(new URL(`../pages/${name}`, import.meta.url), 'utf8');

export const UNKNOWN_STORE_HTML = page('unknown-store.html');
export const UNAVAILABLE_HTML = page('unavailable.html');
