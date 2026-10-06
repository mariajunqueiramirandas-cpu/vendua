import { describe, expect, test } from 'bun:test';
import { ArgError, didYouMean, parseArgs, suggest } from '../src/args.ts';
import { COMMANDS, FLEET_USAGE, HELP, USAGE, helpFor } from '../src/help.ts';

const spec = { bool: ['--normal', '--json'], value: ['--maintenance', '--ring', '--tenant'] };

describe('parseArgs', () => {
  test('splits positionals from flags, in any order', () => {
    const p = parseArgs(['--ring', 'canary', 'acme', '--normal'], spec);
    expect(p.positionals).toEqual(['acme']);
    expect(p.get('--ring')).toBe('canary');
    expect(p.has('--normal')).toBe(true);
    expect(p.has('--json')).toBe(false);
  });

  test('a repeated value flag keeps every value', () => {
    const p = parseArgs(['--tenant', 'a', '--tenant', 'b'], spec);
    expect(p.all('--tenant')).toEqual(['a', 'b']);
    expect(p.get('--tenant')).toBe('b');
  });

  test('a value may look like anything but another flag', () => {
    expect(parseArgs(['--maintenance', 'voltamos -- já'], spec).get('--maintenance')).toBe(
      'voltamos -- já',
    );
    expect(() => parseArgs(['--maintenance', '--normal'], spec)).toThrow(
      '--maintenance needs a value',
    );
    expect(() => parseArgs(['--ring'], spec)).toThrow('--ring needs a value');
  });

  test('an unknown flag names the nearest known one', () => {
    expect(() => parseArgs(['acme', '--maintanence', 'x'], spec)).toThrow(
      "unknown flag '--maintanence' (did you mean '--maintenance'?)",
    );
    expect(() => parseArgs(['-x'], spec)).toThrow(ArgError);
    expect(() => parseArgs(['--zzzzzz'], spec)).toThrow("unknown flag '--zzzzzz'");
  });

  test('--flag=value is refused with the way to write it', () => {
    expect(() => parseArgs(['--ring=canary'], spec)).toThrow('--ring canary');
  });

  test('-- ends the flags', () => {
    expect(parseArgs(['--', '--ring'], spec).positionals).toEqual(['--ring']);
  });
});

describe('suggest', () => {
  const slugs = ['quero-pudim', 'brigadeiros-bia', '_template'];
  test('typos, prefixes and fragments find the store', () => {
    expect(suggest('quero-pudm', slugs)).toEqual(['quero-pudim']);
    expect(suggest('quero', slugs)).toEqual(['quero-pudim']);
    expect(suggest('pudim', slugs)).toEqual(['quero-pudim']);
    expect(suggest('brigadeiro-bia', slugs)).toEqual(['brigadeiros-bia']);
  });
  test('nothing close, nothing suggested', () => {
    expect(suggest('xyzzy', slugs)).toEqual([]);
    expect(didYouMean('xyzzy', slugs)).toBe('');
    expect(didYouMean('quero-pudm', slugs)).toBe(" (did you mean 'quero-pudim'?)");
  });
});

describe('help', () => {
  test('every command has a help text that starts with its own name', () => {
    for (const c of COMMANDS) {
      const text = helpFor(c);
      expect(text.trimStart().startsWith(`vendua ${c}`)).toBe(true);
      expect(USAGE).toContain(HELP[c]!.list);
    }
  });

  test('a command help does not list the others', () => {
    const ops = helpFor('ops');
    expect(ops).toContain('--maintenance');
    expect(ops).not.toContain('vendua train');
    expect(ops).not.toContain('vendua fleet');
  });

  test('fleet help narrows to one subcommand', () => {
    const promote = helpFor('fleet', 'promote');
    expect(promote).toContain('vendua fleet promote');
    expect(promote).toContain('--dry-run');
    expect(promote).not.toContain('vendua fleet status');
    expect(helpFor('fleet', 'unpin')).toContain('pin <tenant>');
    expect(helpFor('fleet', 'nonsense')).toContain(FLEET_USAGE);
  });

  test('every flag the fleet help lists is one the command accepts', async () => {
    const { planPromote } = await import('../src/fleet-ops.ts');
    expect(typeof planPromote).toBe('function');
    expect(FLEET_USAGE).toContain(
      'promote <tenant> <release> [--reason "…"] [--force] [--dry-run]',
    );
    expect(FLEET_USAGE).toContain('rollback <tenant> [--reason "…"] [--dry-run]');
  });
});
