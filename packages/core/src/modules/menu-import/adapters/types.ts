import type { ImportHttp } from '../http.ts';
import type { MenuImportV1, Platform, SourceInfo } from '../doc.ts';

/** One platform (docs/menu-import.md §4.2). `match` and `map` are pure; `read` is the only I/O. */
export interface Adapter {
  platform: Platform;
  /** is this pasted URL one of my stores? */
  match(url: URL): { ref: string } | null;
  /** every host http.ts may call for this adapter; an image entry may add a path prefix */
  hosts: { api: string[]; images: string[] };
  /** reads the store through `http`, within its request budget */
  read(ref: string, http: ImportHttp): Promise<unknown>;
  /** platform JSON → Venduá document, including what was lost; allowlisted fields only */
  map(raw: unknown, source: SourceInfo): MenuImportV1;
}

export type Raw = Record<string, unknown>;

export const isRaw = (v: unknown): v is Raw =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isRaw) : []);

/** 1, "1", true → true; everything else false. */
export const flag = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

export const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
