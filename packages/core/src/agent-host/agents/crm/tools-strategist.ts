import { defineTool, s, ToolError, type Json } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import { hasMemoryTablesTx, rememberTx } from '../../../modules/agent-memory.ts';
import { discoveryBudgetTx } from '../../../crm/policy.ts';
import { crm, emitAfter, refusals, type Ctx } from './shared.ts';

// The weekly strategist's writes: the agent's standing memory and drafted discovery briefs. Both
// are staff-driven jobs only: stored text reaches every later prompt.

export const rememberTool = defineTool<
  { fact: string; scope?: 'workspace' | 'segment' | undefined; segment?: string | undefined },
  Sql
>({
  name: 'remember',
  description:
    'Persist a durable learning (agent memory, e.g. "docerias respond better at night"). scope: "workspace" (default: applies to every run) or "segment" + `segment` for a learning that only fits one niche. Deduped case-insensitively per scope/segment: repeating a learning refreshes it. Cap 200 learnings (staff-pinned items never drop); an old learning the cap drops comes back as `evicted`: fold it into a consolidated learning on a later call.',
  effect: 'write',
  input: s.object({
    fact: s.string({ min: 1, max: 500 }),
    scope: s.enum(['workspace', 'segment']).optional(),
    segment: s.string({ max: 80 }).describe('required when scope=segment').optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const scope = input.scope ?? 'workspace';
      const segment = input.segment?.trim() ?? '';
      if (scope === 'segment' && !segment)
        throw new ToolError('scope=segment needs the `segment` arg');
      const { item, evicted } = await crm(ctx, async (tx) => {
        if (!(await hasMemoryTablesTx(tx)))
          throw new ToolError('agent memory tables not deployed (migration 0035 pending)');
        return rememberTx(tx, {
          scope,
          ...(scope === 'segment' ? { segment } : {}),
          content: input.fact,
          source: 'agent',
          sourceRunId: ctx.turnId,
        });
      });
      return {
        remembered: item.content,
        scope: item.scope,
        ...(item.segment ? { segment: item.segment } : {}),
        ...(evicted.length ? { evicted } : {}),
      } as unknown as Json;
    }),
});

export const proposeBriefTool = defineTool<
  {
    name: string;
    query: string;
    segment?: string | undefined;
    city?: string | undefined;
    target?: number | undefined;
    reason: string;
  },
  Sql
>({
  name: 'propose_brief',
  description:
    'Propose a NEW discovery brief as a DISABLED draft: staff approves it on the board with one click; you never enable anything. Only propose gaps the BRIEFS list does not already cover: a segment that converts but lacks volume, a city/flavor with no brief, an angle memory says works. `reason` is the one-line justification staff reads before approving.',
  effect: 'write',
  input: s.object({
    name: s.string({ min: 1, max: 120 }).describe('short slug, e.g. "docerias fortaleza"'),
    query: s.string({ min: 1, max: 500 }).describe('the search a discovery run would execute'),
    segment: s.string({ max: 80 }).optional(),
    city: s.string({ max: 120 }).optional(),
    target: s.int({ min: 1, max: 1000 }).describe('leads per run (3–10 is normal)').optional(),
    reason: s.string({ min: 1, max: 300 }).describe('one line: why staff should approve'),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const name = input.name.trim();
      const query = input.query.trim();
      const reason = input.reason.trim();
      if (!name || !query || !reason)
        throw new ToolError(
          'propose_brief needs name + query + reason (staff approve on the rationale)',
        );
      const out = await crm(ctx, async (tx) => {
        // one lock makes dup-check + insert atomic across turns
        await tx`select pg_advisory_xact_lock(hashtext('brief-proposals'))`;
        const [dup] = await tx<{ name: string }[]>`
          select name from discovery_briefs
          where lower(name) = ${name.toLowerCase()} or lower(query) = ${query.toLowerCase()}
          limit 1`;
        if (dup) return { proposed: false, duplicate: true, existingName: dup.name };
        // budgeted auto-approval: live only when the week's spend + open work + this fits the cap
        const b = await discoveryBudgetTx(tx);
        const autoOn = b.capCents > 0 && b.spent + (b.open + 1) * b.est <= b.capCents;
        const [row] = await tx<{ id: string; name: string }[]>`
          insert into discovery_briefs (name, query, segment, city, target, enabled, created_by, note)
          values (${name}, ${query}, ${input.segment?.trim() || null}, ${input.city?.trim() || null},
                  ${input.target ?? null}, ${autoOn}, 'strategist', ${reason})
          returning id, name`;
        return {
          proposed: true,
          brief: row!,
          enabled: autoOn,
          next: autoOn
            ? 'ativado automaticamente dentro do orçamento semanal de descoberta'
            : 'rascunho desativado no quadro — staff aprova ou descarta; você nunca ativa',
        };
      });
      if (out.proposed) emitAfter(ctx, 'draft.change', out.brief?.id);
      return out as unknown as Json;
    }),
});
