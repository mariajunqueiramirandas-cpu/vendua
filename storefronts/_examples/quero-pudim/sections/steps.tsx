import { defineSection, list, select, text, useStore, type SectionProps } from '@vendua/kernel';
import { ICON_NAMES, ICONS } from './_shared/icons.ts';
import { twoDigits } from './_shared/format.ts';

export const schema = defineSection({
  type: 'store:steps',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 80 }),
    lede: text({ max: 200 }),
    steps: list(
      {
        icon: select(ICON_NAMES, { default: 'utensils' }),
        title: text({ max: 60, default: '' }),
        description: text({ max: 140, default: '' }),
      },
      { max: 5 },
    ),
    footnote: text({ max: 120 }),
  },
});

export default function Steps({ settings: s }: SectionProps<typeof schema>) {
  const { store } = useStore();
  return (
    <section className="container ficha-rule" style={{ paddingBlock: '32px 64px' }}>
      <div className="section-head">
        {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
        {s.title ? <h2 className="display display-lg">{s.title}</h2> : null}
        {s.lede ? <p className="lede">{s.lede}</p> : null}
      </div>
      <ol className="steps">
        {(s.steps ?? []).map((step, i) => {
          const Icon = ICONS[step.icon];
          return (
            <li key={step.title}>
              <div className="step-head">
                <span className="ficha-num">{twoDigits(i + 1)}</span>
                <Icon className="step-icon" aria-hidden="true" />
              </div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          );
        })}
      </ol>
      {s.footnote ? (
        <p className="small muted" style={{ marginTop: 32 }}>
          {s.footnote.replaceAll('{city}', store?.city ?? '')}
        </p>
      ) : null}
    </section>
  );
}
