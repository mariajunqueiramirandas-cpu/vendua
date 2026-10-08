import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { DesignSpec, SiteMotion } from '@/lib/api.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';

const MOTION: Record<SiteMotion, string> = {
  none: 'nenhum',
  subtle: 'discreto',
  expressive: 'marcante',
};

const HEX = /^#[0-9a-f]{6}$/i;
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

function Swatch({ hex, main }: { hex: string; main?: boolean | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={
          main
            ? 'size-6 shrink-0 rounded-md border border-border-strong shadow-card'
            : 'size-5 shrink-0 rounded-md border border-border-strong'
        }
        // the owner's colour itself: the one place a hex value is the content
        style={{ backgroundColor: hex }}
      />
      <span className="text-xs text-muted-foreground uppercase tnum">{hex}</span>
    </span>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((x, i) => (
        <li key={i} className="flex gap-1.5">
          <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/60" />
          <span className="min-w-0">{x}</span>
        </li>
      ))}
    </ul>
  );
}

function host(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Duá's brief, as staff read it: what the routine was told to build. */
export function SpecView({ spec, note }: { spec: DesignSpec | null; note: string | null }) {
  const brand = spec?.brand;
  const exp = spec?.experience;
  const palette = brand?.palette;
  const primary = text(palette?.primary);
  const accents = list(palette?.accents).filter((h) => HEX.test(h));
  const refs = Array.isArray(brand?.references)
    ? brand.references.filter((r) => typeof r?.url === 'string' && /^https:\/\//.test(r.url))
    : [];
  const personality = list(brand?.personality);
  const mustHave = list(exp?.mustHave);
  const differentials = list(exp?.differentials);
  const avoid = list(exp?.avoid);

  return (
    <Panel title="o pedido" aside="o que o Duá passou para o site">
      {note && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2">
          <p className="text-xs font-medium text-warning-foreground">ajuste pedido pelo lojista</p>
          <p className="mt-0.5 text-sm whitespace-pre-wrap">{note}</p>
        </div>
      )}
      {!spec ? (
        <p className="text-sm text-muted-foreground">sem briefing</p>
      ) : (
        <dl className="flex flex-col divide-y">
          {text(spec.summary) && (
            <Row label="ideia">
              <span className="text-[15px] leading-snug">{spec.summary}</span>
            </Row>
          )}
          {personality.length > 0 && (
            <Row label="jeito">
              <span className="flex flex-wrap gap-1">
                {personality.map((p) => (
                  <Badge key={p} variant="default">
                    {p}
                  </Badge>
                ))}
              </span>
            </Row>
          )}
          <Row label="cores">
            {primary || accents.length ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {primary && HEX.test(primary) && <Swatch hex={primary} main />}
                {accents.map((h, i) => (
                  <Swatch key={`${h}-${i}`} hex={h} />
                ))}
              </span>
            ) : null}
            {text(palette?.notes) && (
              <p className="mt-1 text-xs text-muted-foreground">{palette?.notes}</p>
            )}
            {!primary && !accents.length && !text(palette?.notes) && (
              <span className="text-muted-foreground">as da marca</span>
            )}
          </Row>
          {text(brand?.typography) && <Row label="letras">{brand?.typography}</Row>}
          {exp?.motion && <Row label="movimento">{MOTION[exp.motion] ?? exp.motion}</Row>}
          {mustHave.length > 0 && (
            <Row label="não pode faltar">
              <Bullets items={mustHave} />
            </Row>
          )}
          {differentials.length > 0 && (
            <Row label="diferenciais">
              <Bullets items={differentials} />
            </Row>
          )}
          {avoid.length > 0 && (
            <Row label="evitar">
              <Bullets items={avoid} />
            </Row>
          )}
          {refs.length > 0 && (
            <Row label="referências">
              <ul className="flex flex-col gap-1">
                {refs.map((r, i) => (
                  <li key={i} className="min-w-0">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 font-medium underline-offset-4 hover:underline"
                    >
                      <span className="truncate">{host(r.url)}</span>
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    </a>
                    {text(r.note) && (
                      <span className="block text-xs text-muted-foreground">{r.note}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {text(spec.copy?.tone) && <Row label="tom">{spec.copy.tone}</Row>}
        </dl>
      )}
    </Panel>
  );
}
