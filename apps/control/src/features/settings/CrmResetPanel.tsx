import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api, type CrmResetCounts } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { Dialog } from '@/components/ui/overlay.tsx';

/** Core's CRM_RESET_WORD; the preview sends the live one */
const WORD = 'zerar crm';

const num = (n: number) => n.toLocaleString('pt-BR');
const many = (n: number, one: string, more: string) => `${num(n)} ${n === 1 ? one : more}`;

function goes(c: CrmResetCounts | undefined): string {
  const work = 'a fila, os turnos e as caçadas dos agentes';
  if (!c)
    return `todos os leads com conversas e tarefas, a agenda, a memória inteira, campanhas e briefs de descoberta; ${work}`;
  const parts = [
    `${many(c.leads, 'lead', 'leads')} com ${many(c.conversations, 'conversa', 'conversas')}` +
      (c.storeLeads
        ? ` (${c.storeLeads === 1 ? '1 virou loja' : `${num(c.storeLeads)} viraram loja`}: a loja continua)`
        : ''),
    c.meetings &&
      `${many(c.meetings, 'reunião', 'reuniões')} (o que já foi pro Google Agenda fica lá)`,
    c.memories && many(c.memories, 'memória', 'memórias'),
    c.campaigns && many(c.campaigns, 'campanha', 'campanhas'),
    c.briefs && many(c.briefs, 'brief de descoberta', 'briefs de descoberta'),
  ];
  return `${parts.filter(Boolean).join(', ')}; ${work}`;
}

const RESETS =
  'toda a configuração do agente: autonomia, voz e instruções, áudio, limites e descoberta. Ele volta desligado; ligue em Agente → Configurar quando estiver pronto';
const STAYS =
  'lojas e assinaturas, conexões (WhatsApp, Instagram, Telegram), equipe, horários de reunião e o histórico de eventos';

/** Staff zero the whole sales side: leads, agenda, memory and the agent start over. */
export function CrmResetPanel() {
  const [open, setOpen] = useState(false);
  return (
    <Panel title="começar do zero" className="border-destructive/30" flush>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        <div className="min-w-0 flex-1 basis-56">
          <div className="text-[13px] font-medium">zerar o CRM</div>
          <p className="text-xs text-muted-foreground">
            toda a parte de vendas volta do zero: leads, conversas, agenda, memória e o agente, que
            volta desligado. lojas e conexões ficam.
          </p>
        </div>
        <Button variant="destructive-outline" size="sm" onClick={() => setOpen(true)}>
          <RotateCcw />
          zerar
        </Button>
      </div>
      {open && <ConfirmDialog onClose={() => setOpen(false)} />}
    </Panel>
  );
}

function ConfirmDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  // one key per confirmation: a retry after a lost answer replays instead of running again
  const [key] = useState(() => crypto.randomUUID());
  const preview = useQuery({
    queryKey: qk.crmReset(),
    queryFn: api.crmReset,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const word = preview.data?.word ?? WORD;
  const counts = preview.data?.counts;
  const ok = typed.trim().toLowerCase().replace(/\s+/g, ' ') === word;

  const run = useMutation({
    mutationFn: () => api.resetCrm(typed, key),
    onSuccess: (res) => {
      toast.success('CRM zerado', {
        description: res.leads
          ? `${many(res.leads, 'lead apagado', 'leads apagados')} — o agente fica desligado até vocês ligarem`
          : 'o agente fica desligado até vocês ligarem',
      });
      // every screen read something that just went
      void qc.invalidateQueries();
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok && !run.isPending) run.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !run.isPending && onClose()}
      title="zerar o CRM?"
      description="Não tem desfazer."
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm">
          Hoje, Pipeline, Inbox, Agenda e Agente voltam vazios, como no primeiro dia. Quem mandar
          mensagem depois entra como lead novo, sem histórico.
        </p>
        <dl
          className="grid gap-2 rounded-lg border bg-secondary px-3 py-2.5 text-xs"
          aria-busy={preview.isPending}
        >
          <div>
            <dt className="font-medium text-destructive-foreground">apaga</dt>
            <dd className="text-muted-foreground tnum">{goes(counts)}</dd>
          </div>
          <div>
            <dt className="font-medium">volta ao padrão</dt>
            <dd className="text-muted-foreground">{RESETS}</dd>
          </div>
          <div>
            <dt className="font-medium">mantém</dt>
            <dd className="text-muted-foreground">{STAYS}</dd>
          </div>
        </dl>
        {preview.isError && (
          <p className="text-xs text-muted-foreground">
            não deu para contar agora ({errorMessage(preview.error)}) — o reset vale do mesmo jeito.
          </p>
        )}
        <Field
          label={
            <>
              digite <span className="font-mono text-foreground select-all">{word}</span> para
              confirmar
            </>
          }
          htmlFor="crm-reset-confirm"
        >
          <Input
            id="crm-reset-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={word}
            disabled={run.isPending}
            className="font-mono"
          />
        </Field>
        {run.isError && (
          <p className="text-xs text-destructive-foreground" role="alert">
            {errorMessage(run.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={run.isPending}>
            cancelar
          </Button>
          <Button type="submit" variant="destructive" disabled={!ok || run.isPending}>
            {run.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            zerar CRM
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
