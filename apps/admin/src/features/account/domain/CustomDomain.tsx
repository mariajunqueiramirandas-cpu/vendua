import { useState } from 'react';
import type { Account } from '../../../lib/api.ts';
import { Card } from '../../../ui/Card.tsx';
import { ConnectForm } from './Connect.tsx';
import { HolderForm } from './Holder.tsx';
import { RadioRows } from './kit.tsx';
import { isOpen, OrderCard } from './Order.tsx';
import { DomainSearch } from './Search.tsx';
import { DomainSetup } from './Setup.tsx';

/**
 * Domínio próprio (ADR 0038): an order on its way, a domain being set up or live, or the start:
 * register a .com.br with the plan, or connect one the owner already has.
 */
export function CustomDomain({ a }: { a: Account }) {
  const d = a.customDomain;
  const o = a.domainOrder;
  // the order speaks until its domain is past the registry
  if (isOpen(o) && (!d || (d.source === 'included' && d.status === 'ordering')))
    return <OrderCard o={o} />;
  if (d) return <DomainSetup d={d} a={a} />;
  return <Start a={a} />;
}

type Path = 'register' | 'connect';

function Start({ a }: { a: Account }) {
  const purchase = a.domainOptions.purchase;
  const [path, setPath] = useState<Path>('register');
  const [picked, setPicked] = useState<string | null>(null);
  if (!purchase)
    return (
      <Card className="p-5">
        <ConnectForm a={a} intro />
      </Card>
    );
  return (
    <Card className="space-y-5 p-5">
      {picked ? (
        <HolderForm a={a} host={picked} onBack={() => setPicked(null)} />
      ) : (
        <>
          <RadioRows<Path>
            label="Domínio próprio"
            value={path}
            onChange={setPath}
            options={[
              {
                value: 'register',
                title: 'Registrar um domínio novo',
                detail: 'Incluso no seu plano. Fica no nome da sua empresa.',
              },
              { value: 'connect', title: 'Já tenho um domínio' },
            ]}
          />
          {path === 'register' ? (
            <DomainSearch onPick={setPicked} />
          ) : (
            <ConnectForm a={a} intro={false} />
          )}
        </>
      )}
    </Card>
  );
}
