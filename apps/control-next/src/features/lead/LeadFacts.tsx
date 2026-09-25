import type { ReactNode } from 'react';
import { ExternalLink, MailWarning } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { EditableText } from '@/components/EditableText.tsx';
import { MoneyEdit } from '@/components/MoneyEdit.tsx';
import { TagEditor } from '@/components/TagEditor.tsx';
import { Tooltip } from '@/components/ui/controls.tsx';
import type { LeadPatch } from './queries.ts';
import { Section } from './Section.tsx';
import { Stepper } from './Stepper.tsx';
import { LeadCalls, LeadChannels } from './LeadChannels.tsx';

// stored websites are free text — linkify only values that normalize to an
// absolute http(s) URL; anything else renders as plain text
function httpUrl(raw: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex min-h-7 items-center text-xs text-muted-foreground pointer-coarse:min-h-9">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1">{children}</dd>
    </>
  );
}

const TEXT_FIELDS = [
  ['email', 'email', 'email', 'email'],
  ['instagram', 'instagram', '@perfil', 'text'],
  ['cidade', 'city', 'cidade', 'text'],
  ['segmento', 'segment', 'segmento', 'text'],
  ['origem', 'source', 'origem', 'text'],
] as const;

/** The lead's left rail (and the phone "resumo" tab): stage, facts, tags, channels, calls. */
export function LeadFacts({ lead, patch }: { lead: LeadListItem; patch: (p: LeadPatch) => void }) {
  const siteHref = lead.website ? httpUrl(lead.website) : null;
  return (
    <>
      <Section title="estágio">
        <Stepper state={lead.state} onChange={(state) => patch({ state })} />
      </Section>

      <Section title="dados">
        <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2">
          <KV label="whatsapp">
            <EditableText
              label="whatsapp"
              type="tel"
              value={lead.whatsapp}
              placeholder="+55 85 9…"
              onSave={(v) => patch({ whatsapp: v })}
            />
            {lead.whatsapp && !lead.whatsappVerified && (
              <Tooltip content="derivado do telefone — envio pode falhar">
                <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
                  não verificado
                </span>
              </Tooltip>
            )}
          </KV>
          {TEXT_FIELDS.map(([label, field, ph, type]) => (
            <KV key={field} label={label}>
              <EditableText
                label={label}
                type={type}
                value={lead[field]}
                placeholder={ph}
                onSave={(v) => patch({ [field]: v })}
              />
              {field === 'email' && lead.emailBouncedAt && (
                <Tooltip content="o último email voltou — endereço pode estar errado">
                  <MailWarning className="size-3.5 shrink-0 text-warning-foreground" />
                </Tooltip>
              )}
            </KV>
          ))}
          <KV label="site">
            <EditableText
              label="site"
              type="url"
              value={lead.website}
              placeholder="https://…"
              onSave={(v) => patch({ website: v })}
            />
            {siteHref && (
              <a
                href={siteHref}
                target="_blank"
                rel="noreferrer"
                title="abrir site"
                aria-label="abrir site"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground pointer-coarse:size-9"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </KV>
          <KV label="valor">
            <MoneyEdit cents={lead.dealValueCents} onSave={(c) => patch({ dealValueCents: c })} />
          </KV>
          {lead.discoveredVia && (
            <KV label="descoberto via">
              <span className="truncate text-sm">{lead.discoveredVia}</span>
            </KV>
          )}
        </dl>
      </Section>

      <Section title="tags">
        <TagEditor tags={lead.tags} onSave={(tags) => patch({ tags })} />
      </Section>

      <LeadChannels leadId={lead.id} />
      <LeadCalls leadId={lead.id} />
    </>
  );
}
