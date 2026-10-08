import { CheckCircle, Question, XCircle } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.ts';
import { Button } from '../../../ui/Button.tsx';
import { Spinner } from '../../../ui/Spinner.tsx';
import { Field, TextInput } from '../../../ui/fields.tsx';
import { Chip, Host } from './kit.tsx';

function useDebounced<T>(v: T, ms: number) {
  const [x, setX] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setX(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return x;
}

/** the label the owner means: no suffix, no www (Core normalizes the rest) */
const labelOf = (q: string) =>
  q
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\.com\.br$|\.com$|\.br$/, '');

/** A .com.br name, checked live as it's typed, plus Core's suggestions from the store's name. */
export function DomainSearch({ onPick }: { onPick: (host: string) => void }) {
  const [q, setQ] = useState('');
  const term = useDebounced(labelOf(q), 300);
  const on = term.length >= 2;
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['domain-search', term],
    queryFn: () => api.searchDomains(term),
    enabled: on,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const show = on && labelOf(q).length >= 2;
  return (
    <div className="space-y-3">
      <Field label="Nome do domínio" htmlFor="domain-q">
        <div className="relative">
          <TextInput
            id="domain-q"
            type="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={63}
            placeholder="sualoja"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pr-24"
          />
          <span
            aria-hidden
            className="t-body-lg lg:text-[0.9375rem] pointer-events-none absolute inset-y-0 right-4 flex items-center gap-2 text-muted"
          >
            {isFetching && show ? <Spinner className="size-4" /> : null}
            .com.br
          </span>
        </div>
      </Field>

      <div aria-live="polite">
        {!show ? null : isError && !data ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="t-body text-muted">Não deu para procurar agora.</p>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              tentar de novo
            </Button>
          </div>
        ) : data ? (
          <>
            {!data.purchase ? (
              <p className="t-body mb-3 text-muted">
                Agora não dá para registrar domínios por aqui. Tente de novo mais tarde.
              </p>
            ) : null}
            <ul className="divide-y divide-line rounded-md ring-1 ring-line">
              {data.results.map((r) => (
                <li key={r.host} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className="min-w-0 flex-1 basis-40 break-words font-semibold">
                    <Host h={r.host} />
                  </span>
                  <span className="flex items-center gap-2">
                    {r.available === true ? (
                      <Chip tone="success" icon={CheckCircle}>
                        disponível
                      </Chip>
                    ) : r.available === false ? (
                      <Chip tone="neutral" icon={XCircle}>
                        já registrado
                      </Chip>
                    ) : (
                      <Chip tone="warning" icon={Question}>
                        não deu para conferir
                      </Chip>
                    )}
                    {r.available === true && data.purchase ? (
                      <Button aria-label={`escolher ${r.host}`} onClick={() => onPick(r.host)}>
                        escolher
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
