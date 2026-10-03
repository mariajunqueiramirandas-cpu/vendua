import type { AgentDefinition } from '../define/agent.ts';
import { BudgetExceededError } from '../model/gateway.ts';
import type { CostEstimate, Meter } from '../model/types.ts';
import type { SpendPort } from '../ports.ts';
import { addUsage, ZERO_USAGE, type Usage } from '../types.ts';
import type { ConversationState } from './state.ts';

export interface MeterInit {
  def: AgentDefinition;
  state: Readonly<ConversationState>;
  /** What this turn has spent so far, from its `model.responded` events. */
  turnUsage: Usage;
  tenantId: string;
  spend: SpendPort | undefined;
  dayStart: Date;
}

/** The one meter: per turn, per subject and per tenant, before (estimate) and after (actual). */
export function meterFor(init: MeterInit): Meter & { readonly used: Usage } {
  const b = init.def.budgets ?? {};
  let used = ZERO_USAGE;
  const check = async (extraTokens: number, extraCost: number) => {
    const turnTokens =
      init.turnUsage.inputTokens +
      init.turnUsage.outputTokens +
      used.inputTokens +
      used.outputTokens;
    const turnCost = init.turnUsage.costUsd + used.costUsd;
    if (b.tokensPerTurn !== undefined && turnTokens + extraTokens > b.tokensPerTurn)
      throw new BudgetExceededError(
        `turn tokens ${turnTokens + extraTokens} > ${b.tokensPerTurn}`,
        'turn',
      );
    if (b.costPerTurnUsd !== undefined && turnCost + extraCost > b.costPerTurnUsd)
      throw new BudgetExceededError(`turn cost over ${b.costPerTurnUsd}`, 'turn');
    if (
      b.costPerSubjectUsd !== undefined &&
      init.state.usage.costUsd + used.costUsd + extraCost > b.costPerSubjectUsd
    )
      throw new BudgetExceededError(`subject cost over ${b.costPerSubjectUsd}`, 'subject');
    if (b.tenantDaily && init.spend) {
      const limit = await init.spend.tenantDailyLimit(init.tenantId, init.def.id, b.tenantDaily);
      if (limit !== null) {
        const spent = await init.spend.tenantSpend(init.tenantId, init.def.id, init.dayStart);
        if (spent + used.costUsd + extraCost > limit)
          throw new BudgetExceededError(`tenant daily cost over ${limit}`, 'tenant');
      }
    }
  };
  return {
    get used() {
      return used;
    },
    before: (e: CostEstimate) => check(e.inputTokens + e.maxOutputTokens, e.costUsd),
    after: (u: Usage) => {
      used = addUsage(used, u);
    },
  };
}
