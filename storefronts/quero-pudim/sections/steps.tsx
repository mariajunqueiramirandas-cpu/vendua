import { defineSection, list, select, text, useStore, type SectionProps } from '@vendua/kernel';
import { ICON_NAMES, ICONS } from './_shared/icons.ts';
import { Reveal } from './_shared/Reveal.tsx';
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
    <section className="container steps-section">
      <Reveal className="section-head section-head--center">
        {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
        {s.title ? <h2 className="display display-lg">{s.title}</h2> : null}
        {s.lede ? <p className="lede">{s.lede}</p> : null}
      </Reveal>
      <Reveal as="ol" className="steps">
        {(s.steps ?? []).map((step, i) => {
          const Icon = ICONS[step.icon];
          return (
            <li key={step.title}>
              <span className="step-num">{twoDigits(i + 1)}</span>
              <span className="step-badge">
                <Icon size={24} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          );
        })}
      </Reveal>
      {s.footnote ? (
        <p className="steps-note">{s.footnote.replaceAll('{city}', store?.city ?? '')}</p>
      ) : null}
    </section>
  );
}
