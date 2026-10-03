import type { ToolDefinition } from './tool.ts';

/**
 * An instruction pack. The base prompt lists skills by `when` only; the statechart (`autoLoad`)
 * or the model (`load_skill`) loads the instructions when the conversation needs them, so the
 * always-on prompt stays small and the cached prefix stable.
 */
export interface SkillDefinition {
  id: string;
  /** One line: when to load it ("pizza com dois sabores"). */
  when: string;
  instructions: string;
  tools?: readonly ToolDefinition[];
  examples?: readonly string[];
  /** Statechart states that load it on entry. */
  autoLoad?: readonly string[];
}

const ID = /^[a-z][a-z0-9_-]{0,40}$/;

export function defineSkill(def: SkillDefinition): SkillDefinition {
  if (!ID.test(def.id)) throw new Error(`skill id must match ${ID}: ${def.id}`);
  if (def.when.length > 200) throw new Error(`skill ${def.id}: trigger line too long`);
  return Object.freeze({ ...def });
}
