import type { Scenario, ScenarioResult } from './scenario.ts';

export interface RunCtx {
  /** The user-model id, or null when the scenario lists none. */
  model: string | null;
  /** 0-based run number under this model. */
  attempt: number;
}

export interface PassKRun {
  model: string | null;
  attempt: number;
  passed: boolean;
  failures: string[];
  result: ScenarioResult;
}

export interface PassKResult {
  scenario: string;
  k: number;
  /** pass^k: every run under every user model passed. */
  passed: boolean;
  /** Share of single runs that passed. */
  passAt1: number;
  runs: PassKRun[];
  byModel: { model: string | null; passed: boolean; passAt1: number }[];
}

/**
 * Runs the scenario k times under each listed user model (once each if none). `run` builds a
 * fresh environment per call: scripted gateways and cassettes keep a cursor.
 */
export async function passK(
  sc: Scenario,
  k: number | undefined,
  run: (sc: Scenario, ctx: RunCtx) => Promise<ScenarioResult>,
): Promise<PassKResult> {
  const n = k ?? sc.k;
  if (!Number.isInteger(n) || n < 1) throw new Error(`k must be a positive integer: ${n}`);
  const models: (string | null)[] = sc.models.length ? [...sc.models] : [null];
  const runs: PassKRun[] = [];
  for (const model of models)
    for (let attempt = 0; attempt < n; attempt++) {
      const result = await run(sc, { model, attempt });
      runs.push({ model, attempt, passed: result.passed, failures: result.failures, result });
    }
  const rate = (rs: PassKRun[]) => rs.filter((r) => r.passed).length / rs.length;
  const byModel = models.map((model) => {
    const rs = runs.filter((r) => r.model === model);
    return { model, passed: rs.every((r) => r.passed), passAt1: rate(rs) };
  });
  return {
    scenario: sc.name,
    k: n,
    passed: runs.every((r) => r.passed),
    passAt1: rate(runs),
    runs,
    byModel,
  };
}
