import { Copy, Globe } from '@phosphor-icons/react';
import type { Account } from '../../../lib/api.ts';
import { Button } from '../../../ui/Button.tsx';
import { Card, Divided } from '../../../ui/Card.tsx';
import { copyText } from '../../../ui/CopyValue.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { Host, hostOf } from './kit.tsx';
import { DomainChip } from './status.tsx';

/** Every address the store answers on: the Venduá one and the custom domain, with its state. */
export function Addresses({ a }: { a: Account }) {
  const list = a.domains.length
    ? a.domains
    : [
        {
          host: hostOf(a.address),
          kind: 'store' as const,
          status: 'active' as const,
          primary: true,
        },
      ];
  return (
    <Card>
      <Divided>
        {list.map((d) => {
          const url = `https://${d.host}`;
          return (
            <div key={d.host} className="flex items-start gap-3 p-4">
              <Globe className="mt-0.5 size-6 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  {d.status === 'active' ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 break-words font-semibold underline underline-offset-2"
                    >
                      <Host h={d.host} />
                    </a>
                  ) : (
                    <span className="min-w-0 break-words font-semibold">
                      <Host h={d.host} />
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <DomainChip status={d.status} />
                  <span className="t-caption text-muted">
                    {d.kind === 'store' ? 'endereço Venduá' : 'domínio próprio'}
                    {d.primary && a.domains.length > 1 ? ' · principal' : ''}
                  </span>
                </div>
              </div>
              {d.status === 'active' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  icon={<Copy />}
                  aria-label={`copiar ${d.host}`}
                  onClick={() => void copyText(url).then((ok) => ok && toast('Endereço copiado'))}
                >
                  copiar
                </Button>
              ) : null}
            </div>
          );
        })}
      </Divided>
    </Card>
  );
}
