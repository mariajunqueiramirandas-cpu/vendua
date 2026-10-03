import type { Agent } from '../define/agent.ts';
import { defineTool, ToolError, type ToolDefinition } from '../define/tool.ts';
import { s } from '../schema.ts';

/** Replies are a tool so the guards can see, block and explain every one. */
export const replyTool = defineTool({
  name: 'reply',
  description:
    'Envia uma mensagem ao cliente. Cite valores, horários e produtos do REGISTRO como {{id}}.',
  effect: 'send',
  input: s.object({ text: s.string({ min: 1, max: 1500 }) }),
  run: () => {
    throw new Error('reply is handled by the engine');
  },
});

export function loadSkillTool(agent: Agent): ToolDefinition | null {
  const skills = agent.def.skills ?? [];
  if (skills.length === 0) return null;
  const ids = skills.map((sk) => sk.id) as [string, ...string[]];
  return defineTool({
    name: 'load_skill',
    description: 'Carrega as instruções de uma habilidade listada quando a conversa precisar dela.',
    effect: 'read',
    input: s.object({ id: s.enum(ids) }),
    run: (ctx, input) => {
      if (ctx.state.loadedSkills.includes(input.id)) return { content: 'Já carregada.' };
      if (!skills.some((sk) => sk.id === input.id)) throw new ToolError('Habilidade desconhecida.');
      return { content: `Habilidade ${input.id} carregada.`, data: { skill: input.id } };
    },
  });
}
