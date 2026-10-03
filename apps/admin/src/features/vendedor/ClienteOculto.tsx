import { ArrowClockwise, CaretRight, Lightning, ShieldCheck } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ClienteOculto as View, type ClienteOcultoResult } from '../../lib/api.ts';
import { when } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { ArtBag } from '../../ui/illustrations.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import { toast } from '../../ui/Toast.tsx';
import { ChecklistRow, ScoreRing } from '../../ui/vendedor/index.ts';

type Run = NonNullable<View['latest']>;

// Core's scenario checks (vendedor/cliente-oculto.ts); the order ones first
const ORDER_CHECKS = ['pedido certo', 'opções certas'];
const RESULT_WORD: Record<string, [ok: string, miss: string]> = {
  'chamou você quando pediram': ['chamou você', 'não chamou'],
  'fora da área, explicou com calma': ['explicou', 'não explicou'],
};
const word = (r: ClienteOcultoResult) => {
  const w = RESULT_WORD[r.check] ?? ['certo', 'errou'];
  return r.passed ? w[0] : w[1];
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** passed / total per check, in the order the board lists them */
function checks(results: ClienteOcultoResult[]) {
  const by = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    const c = by.get(r.check) ?? { passed: 0, total: 0 };
    c.total++;
    if (r.passed) c.passed++;
    by.set(r.check, c);
  }
  const rank = (k: string) => (ORDER_CHECKS.includes(k) ? 0 : 1);
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

const isRunning = (r: Run | null | undefined) =>
  !!r && (r.status === 'queued' || r.status === 'running');

export default function ClienteOculto() {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: qk.vendedor.clienteOculto,
    queryFn: api.vendedor.clienteOculto,
    // a run writes its results as it goes without a live event per scenario
    refetchInterval: (q) => (isRunning(q.state.data?.latest) ? 4000 : false),
  });
  const home = useQuery({ queryKey: qk.vendedor.home, queryFn: api.vendedor.home });
  const agent = home.data?.agent;
  const live = !!agent?.enabled && agent.coverage !== 'rehearsal';

  const run = useMutation({
    mutationFn: api.vendedor.runClienteOculto,
    onSuccess: (v) => {
      qc.setQueryData(qk.vendedor.clienteOculto, v);
      toast('Os clientes de teste começaram a pedir.');
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const latest = data?.latest ?? null;
  const running = isRunning(latest);
  const total = latest?.total ?? null;
  const header = (
    <PageHeader
      title="Cliente oculto"
      back="/vendedor"
      subtitle={
        latest?.status === 'done' && total
          ? `${total} clientes de teste pediram no seu cardápio.`
          : 'Clientes de teste pedem no seu cardápio e conferimos cada pedido.'
      }
      actions={
        data && latest && !running ? (
          <Button
            variant="secondary"
            icon={<ArrowClockwise weight="bold" />}
            loading={run.isPending}
            onClick={() => run.mutate()}
          >
            rodar de novo
          </Button>
        ) : undefined
      }
    />
  );
  if (error && !data)
    return (
      <PageBody>
        {header}
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  if (!data)
    return (
      <PageBody>
        {header}
        <SectionsSkeleton />
      </PageBody>
    );

  if (!latest)
    return (
      <PageBody>
        {header}
        <Card>
          <EmptyState
            art={<ArtBag />}
            title="Veja a nota antes de ligar"
            body="Clientes de teste pedem no seu cardápio, cada um com um pedido escondido. Comparamos item por item com o que o Duá fechar."
            action={
              <Button loading={run.isPending} onClick={() => run.mutate()}>
                rodar agora
              </Button>
            }
          />
        </Card>
      </PageBody>
    );

  const results = latest.results ?? [];
  const misses = results.filter((r) => !r.passed);
  const orders = results.filter((r) => ORDER_CHECKS.includes(r.check)).length;
  const earlier = data.history.filter((h) => h.id !== latest.id);

  return (
    <PageBody>
      {header}
      <div className="flex flex-col gap-8">
        {running ? (
          <RunningCard latest={latest} />
        ) : latest.status === 'failed' ? (
          <Notice
            tone="warning"
            title="O último teste não terminou"
            action={
              <Button
                variant="secondary"
                icon={<ArrowClockwise weight="bold" />}
                loading={run.isPending}
                onClick={() => run.mutate()}
              >
                rodar de novo
              </Button>
            }
          >
            {results.length
              ? `Parou depois de ${results.length} ${results.length === 1 ? 'cliente' : 'clientes'} de teste. Tente de novo em instantes.`
              : 'Tente de novo em instantes. Se continuar, fale com a Venduá em Ajuda.'}
          </Notice>
        ) : total === 0 ? (
          <Card>
            <EmptyState
              art={<ArtBag />}
              title="Nada para testar ainda"
              body="Os clientes de teste pedem o que está no seu cardápio. Cadastre seus produtos e rode de novo."
              action={
                <ButtonLink to="/cardapio" variant="secondary">
                  abrir o cardápio
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <Card className="p-4 md:p-5">
            <div className="flex items-center gap-4">
              <ScoreRing
                value={latest.passed ?? 0}
                total={total ?? results.length}
                label={`${latest.passed ?? 0} de ${total ?? results.length} pedidos certos`}
              />
              <div className="min-w-0">
                <p className="t-body-lg font-semibold leading-6">
                  {(latest.passed ?? 0) === 1 ? 'pedido saiu certo' : 'pedidos saíram certos'}
                </p>
                <p className="t-body mt-1 text-muted">
                  Cada cliente de teste tinha um pedido escondido. Comparamos item por item com o
                  que o Duá fechou.
                </p>
              </div>
            </div>
            <div className="mt-4">
              {orders ? (
                <ChecklistRow
                  state="done"
                  icon={ShieldCheck}
                  title="Preço certo em todos os pedidos"
                  detail="calculado pela loja"
                  value={`${orders}/${orders}`}
                />
              ) : null}
              {checks(results).map(([check, c]) => (
                <ChecklistRow
                  key={check}
                  state={c.passed === c.total ? 'done' : 'miss'}
                  title={cap(check)}
                  value={`${c.passed}/${c.total}`}
                />
              ))}
            </div>
          </Card>
        )}

        {!running && misses.length ? (
          <Section
            title={misses.length === 1 ? 'Errou 1 pedido' : `Errou ${misses.length} pedidos`}
            hint="Quase sempre é um detalhe do cardápio. Veja a conversa e ajuste o produto."
          >
            <div className="flex flex-col gap-3">
              {misses.map((r, i) => (
                <MissCard key={`${r.name}-${i}`} r={r} />
              ))}
            </div>
          </Section>
        ) : null}

        {running && results.length ? <SoFar results={results} total={total} /> : null}

        <div className="flex flex-col items-center gap-2">
          {!live && home.data ? (
            <ButtonLink
              to="/vendedor/configurar"
              variant="spark"
              block
              icon={<Lightning weight="fill" />}
              className="md:max-w-sm"
            >
              ligar o Duá
            </ButtonLink>
          ) : null}
          {!running && latest.status !== 'failed' ? (
            <Button
              variant="quiet"
              block
              icon={<ArrowClockwise weight="bold" />}
              loading={run.isPending}
              onClick={() => run.mutate()}
              className="md:hidden"
            >
              rodar de novo
            </Button>
          ) : null}
          <p className="t-caption text-center text-muted">
            {running
              ? `Começou ${when(latest.at)}.`
              : latest.trigger === 'menu_change'
                ? `Rodou sozinho depois que você mudou o cardápio, ${when(latest.at)}.`
                : `Você rodou ${when(latest.at)}.`}{' '}
            Roda de novo sozinho quando o cardápio muda.
          </p>
        </div>

        {earlier.length ? (
          <Section title="Rodadas anteriores">
            <Card as="div" className="divide-y divide-line">
              {earlier.map((h) => (
                <div key={h.id} className="flex min-h-14 items-center justify-between gap-3 px-4">
                  <span className="t-body">{cap(when(h.at))}</span>
                  <span
                    className={cn(
                      'tnum t-label',
                      h.status === 'done' && h.total && h.passed === h.total
                        ? 'text-success'
                        : 'text-muted',
                    )}
                  >
                    {h.status === 'done'
                      ? `${h.passed ?? 0} de ${h.total ?? 0} certos`
                      : h.status === 'failed'
                        ? 'não terminou'
                        : 'rodando'}
                  </span>
                </div>
              ))}
            </Card>
          </Section>
        ) : null}
      </div>
    </PageBody>
  );
}

function RunningCard({ latest }: { latest: Run }) {
  const done = latest.results?.length ?? 0;
  const total = latest.total;
  return (
    <Card className="p-4 md:p-5" aria-live="polite">
      <div className="flex items-center gap-4">
        {total ? (
          <ScoreRing
            value={done}
            total={total}
            running
            label={`${done} de ${total} clientes de teste atendidos, ainda rodando`}
          />
        ) : (
          <span
            role="img"
            aria-label="preparando os clientes de teste"
            className="grid size-28 shrink-0 place-items-center rounded-full ring-8 ring-inset ring-sunken"
          >
            <Spinner className="size-6" />
          </span>
        )}
        <div className="min-w-0">
          <span className="t-caption inline-flex h-7 items-center gap-1.5 rounded-full bg-spark-soft px-2.5 font-semibold">
            <span aria-hidden className="animate-pulse-dot size-2 rounded-full bg-ink" />
            rodando
          </span>
          <p className="t-label tnum mt-2">
            {total
              ? `testando ${Math.min(done + 1, total)} de ${total}…`
              : 'preparando os clientes de teste…'}
          </p>
          <p className="t-caption mt-1 text-muted">
            Cada um tem um pedido escondido. Comparamos item por item com o que o Duá fechar. Pode
            sair da tela: o teste continua.
          </p>
        </div>
      </div>
    </Card>
  );
}

function SoFar({ results, total }: { results: ClienteOcultoResult[]; total: number | null }) {
  const ok = results.filter((r) => r.passed).length;
  return (
    <Section
      title="Até agora"
      action={
        <span className="t-caption tnum text-muted">
          {ok} {ok === 1 ? 'certo' : 'certos'}
        </span>
      }
    >
      <Card className="px-4 py-1">
        {results.map((r, i) => (
          <ChecklistRow
            key={`${r.name}-${i}`}
            state={r.passed ? 'done' : 'miss'}
            title={r.name}
            value={word(r)}
          />
        ))}
        {total && results.length < total ? (
          <ChecklistRow state="now" title="O próximo cliente está pedindo" value="agora" />
        ) : null}
      </Card>
    </Section>
  );
}

function MissCard({ r }: { r: ClienteOcultoResult }) {
  return (
    <Card className="flex flex-col gap-2 p-4 ring-1 ring-inset ring-warning">
      <p className="font-semibold">{r.name}</p>
      <p className="t-body text-muted">
        {cap(r.check)}: {r.why}
      </p>
      {r.threadId ? (
        <ButtonLink
          to={`/vendedor/conversas/${r.threadId}`}
          variant="secondary"
          className="self-start"
        >
          ver a conversa <CaretRight weight="bold" />
        </ButtonLink>
      ) : null}
    </Card>
  );
}
