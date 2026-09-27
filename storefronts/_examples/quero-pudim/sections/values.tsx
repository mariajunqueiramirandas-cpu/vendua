import { defineSection, list, select, text, type SectionProps } from '@vendua/kernel';
import { ICON_NAMES, ICONS } from './_shared/icons.ts';

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
    <section className="container" style={{ paddingBottom: 48 }}>
      <dl className="values-grid ficha-rule" style={{ paddingTop: 24, margin: 0 }}>
        {items.map((v) => {
          const Icon = ICONS[v.icon];
          return (
            <div key={v.title}>
              <Icon className="value-icon" strokeWidth={1.5} aria-hidden="true" />
              <dt>{v.title}</dt>
              <dd>{v.description}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
