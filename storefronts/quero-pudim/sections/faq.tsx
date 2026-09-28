import { ChevronDown } from 'lucide-react';
import { defineSection, list, text, useStore, type SectionProps } from '@vendua/kernel';
import { Reveal } from './_shared/Reveal.tsx';

export const schema = defineSection({
  type: 'store:faq',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 80, default: 'Perguntas frequentes' }),
    lede: text({ max: 200 }),
    items: list(
      {
        question: text({ max: 120, default: '' }),
        answer: text({ max: 500, default: '' }),
      },
      { max: 8 },
    ),
  },
});

export default function Faq({ settings: s }: SectionProps<typeof schema>) {
  const { store } = useStore();
  const items = (s.items ?? []).filter((i) => i.question && i.answer);
  if (items.length === 0) return null;
  const fill = (v: string) => v.replaceAll('{city}', store?.city ?? '');
  return (
    <section className="container faq">
      <Reveal className="section-head section-head--center">
        {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
        <h2 className="display display-lg">{s.title}</h2>
        {s.lede ? <p className="lede">{s.lede}</p> : null}
      </Reveal>
      <Reveal className="faq-list">
        {items.map((it) => (
          <details key={it.question} className="faq-item">
            <summary>
              <span>{fill(it.question)}</span>
              <ChevronDown size={20} aria-hidden="true" />
            </summary>
            <p>{fill(it.answer)}</p>
          </details>
        ))}
      </Reveal>
    </section>
  );
}
