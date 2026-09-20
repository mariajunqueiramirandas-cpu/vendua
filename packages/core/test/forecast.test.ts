import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  applyProbabilities,
  pipelineForecast,
  snapshotPipelineTx,
  sweepPipelineSnapshots,
} from '../src/modules/forecast.ts';
import {
  DEFAULT_FORECAST_PROBABILITIES,
  forecastProbabilities,
  validateSetting,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { migrate } from '../src/platform/db.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('applyProbabilities', () => {
  test('weight = valueCents × stage probability, rounded; total is the sum', () => {
    const out = applyProbabilities(
      {
        lead: { count: 2, valueCents: 10_000 },
        contacted: { count: 1, valueCents: 5_000 },
        invited: { count: 1, valueCents: 1_000 },
        live: { count: 1, valueCents: 9_999 },
      },
      { lead: 0.05, contacted: 0.2, invited: 0.6, live: 1 },
    );
    // lead: 10_000×.05 = 500; contacted: 5_000×.2 = 1_000; invited: 1_000×.6 = 600
    expect(out.weightedCents).toBe(500 + 1_000 + 600 + 9_999);
    expect(out.byState.lead).toEqual({
      count: 2,
      valueCents: 10_000,
      probability: 0.05,
      weightedCents: 500,
    });
    expect(out.byState.live!.weightedCents).toBe(9_999);
  });

  test('missing states default to 0; unknown probabilities ignored', () => {
    const out = applyProbabilities({ lead: { count: 1, valueCents: 100 } }, { lead: 0.5 });
    expect(out.byState.contacted).toEqual({
      count: 0,
      valueCents: 0,
      probability: 0,
      weightedCents: 0,
    });
    expect(out.weightedCents).toBe(50);
  });
});

describe('forecastProbabilities', () => {
  test('no stored row → defaults', () => {
    expect(forecastProbabilities(null)).toEqual(DEFAULT_FORECAST_PROBABILITIES);
    expect(forecastProbabilities({})).toEqual(DEFAULT_FORECAST_PROBABILITIES);
  });
  test('partial override merges over defaults', () => {
    const p = forecastProbabilities({ probabilities: { lead: 0.9, contacted: 0.05 } });
    expect(p.lead).toBe(0.9);
    expect(p.invited).toBe(0.6);
  });
  test('out-of-range and unknown keys are ignored, never poison the math', () => {
    const p = forecastProbabilities({
      probabilities: { lead: 2, contacted: -1, invited: 'x', bogus: 0.5 },
    });
    expect(p.lead).toBe(0.05);
    expect(p.contacted).toBe(0.2);
    expect(p.invited).toBe(0.6);
    expect((p as Record<string, number>).bogus).toBeUndefined();
  });
});

describe('validateSetting forecast', () => {
  test('accepts a probabilities object of known states in [0,1]', () => {
    expect(validateSetting('forecast', { probabilities: { lead: 0.1, live: 1 } })).toBeUndefined();
    expect(validateSetting('forecast', {})).toBeUndefined();
    expect(validateSetting('forecast', { probabilities: {} })).toBeUndefined();
  });
  test('rejects non-objects, unknown states, out-of-range values', () => {
    expect(code(() => validateSetting('forecast', 'x'))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('forecast', []))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('forecast', { probabilities: 'x' }))).toBe('BAD_REQUEST');
    expect(code(() => validateSetting('forecast', { probabilities: { won: 0.5 } }))).toBe(
      'BAD_REQUEST',
    );
    expect(code(() => validateSetting('forecast', { probabilities: { lead: 1.5 } }))).toBe(
      'BAD_REQUEST',
    );
    expect(code(() => validateSetting('forecast', { probabilities: { lead: -0.1 } }))).toBe(
      'BAD_REQUEST',
    );
    expect(code(() => validateSetting('forecast', { probabilities: { lead: NaN } }))).toBe(
      'BAD_REQUEST',
    );
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('pipeline snapshots (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);

  test('upsert dedupes same-day reruns — one row, refreshed values', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const first = await controlTx(sql, (tx) => snapshotPipelineTx(tx));
    const second = await controlTx(sql, (tx) => snapshotPipelineTx(tx));
    expect(second.id).toBe(first.id);
    expect(second.takenOn).toBe(first.takenOn);
    const rows = await sql<{ n: number }[]>`
      select count(*)::int n from pipeline_snapshots where taken_on = ${first.takenOn}
    `;
    expect(rows[0]!.n).toBe(1);
    // the sweep's once-a-day guard: row exists → no-op
    expect(await sweepPipelineSnapshots(sql)).toBe(false);
  });

  test('snapshot + trend round-trip through pipelineForecast', async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const snap = await controlTx(sql, (tx) => snapshotPipelineTx(tx));
    const fc = await pipelineForecast(sql, {});
    expect(fc.byState.live!.probability).toBe(1);
    const today = fc.trend.at(-1);
    expect(today?.takenOn).toBe(snap.takenOn);
    expect(today?.weightedCents).toBe(snap.weightedCents);
    expect(typeof today?.valueCents).toBe('number');
  });
});
