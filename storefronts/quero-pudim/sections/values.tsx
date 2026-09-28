import { defineSection, list, select, text, type SectionProps } from '@vendua/kernel';
import { ICON_NAMES, ICONS } from './_shared/icons.ts';
import { Reveal } from './_shared/Reveal.tsx';

export const schema = defineSection({
  type: 'store:values',
  settings: {
    items: list(
      {
        icon: select(ICON_NAMES, { default: 'heart' }),
        title: text({ max: 60, default: '' }),
        description: text({ max: 140, default: '' }),
      },
      { max: 4 },
    ),
  },
});

export default function Values({ settings }: SectionProps<typeof schema>) {
  const items = settings.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="container values">
      <Reveal as="ul" className="values-grid">
        {items.map((v) => {
          const Icon = ICONS[v.icon];
          return (
            <li key={v.title}>
              <span className="value-badge">
                <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <div>
                <p className="value-title">{v.title}</p>
                <p className="value-desc">{v.description}</p>
              </div>
            </li>
          );
        })}
      </Reveal>
    </section>
  );
}
