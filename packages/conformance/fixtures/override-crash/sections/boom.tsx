import { defineSection, type SectionProps } from '@vendua/kernel';

// A store section that is broken on purpose (S05) — its siblings must still render.
export const schema = defineSection({ type: 'store:boom', settings: {} });

export default function Boom(_: SectionProps<typeof schema>): never {
  throw new Error('fixture section crash');
}
