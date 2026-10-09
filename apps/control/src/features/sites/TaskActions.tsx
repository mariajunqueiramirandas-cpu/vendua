import { useState, type ReactNode } from 'react';
import { Check, Copy, Hand, RotateCw, X } from 'lucide-react';
import { toast } from 'sonner';
import type { SiteTask } from '@/lib/api.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Textarea } from '@/components/ui/input.tsx';
import { Dialog } from '@/components/ui/overlay.tsx';
import { span, STUCK_MS } from './bits.tsx';
import { actionError, useSiteAction, type SiteAction } from './queries.ts';

const REASON_MIN = 3;
const REASON_MAX = 300;

interface Item {
  action: SiteAction;
  label: string;
  icon: typeof Check;
  /** what it does, or why not yet */
  hint: string;
  enabled: boolean;
  primary?: boolean | undefined;
}

/** The actions this task offers now — Core enforces the same rules (409 otherwise). */
function itemsFor(t: SiteTask, now: number): Item[] {
  const out: Item[] = [];
  const pr = t.prNumber ? `o PR #${t.prNumber}` : 'o PR';
  if (t.status === 'pr_open')
    out.push({
      action: 'approve',
      label: 'aprovar e publicar',
      icon: Check,
      primary: true,
      enabled: t.ci === 'success',
      hint:
        t.ci === 'success'
          ? `mescla ${pr} na main e publica o site na loja quando o deploy terminar`
          : t.ci === 'failure'
            ? 'o CI está vermelho — a routine corrige e o CI roda de novo'
            : 'espere o CI ficar verde',
    });
  const firedAgo = t.firedAt ? now - new Date(t.firedAt).getTime() : Infinity;
  if (t.status === 'escalated' || t.status === 'cancelled' || t.status === 'running') {
    const stuck = t.status !== 'running' || firedAgo >= STUCK_MS;
    out.push({
      action: 'retry',
      label: 'tentar de novo',
      icon: RotateCw,
      enabled: stuck,
      primary: t.status === 'escalated',
      hint: stuck
        ? `nova sessão do zero numa branch nova (${t.attempt + 1}ª tentativa); o PR atual fica para trás`
        : `só se a sessão parar — libera em ${span(STUCK_MS - firedAgo)}`,
    });
  }
  if (
    (t.status === 'queued' || t.status === 'escalated' || t.status === 'running') &&
    t.runner !== 'human'
  )
    out.push({
      action: 'human',
      label: 'assumir',
      icon: Hand,
      enabled: true,
      hint: 'a equipe faz o site à mão e empurra a branch; o resto segue igual',
    });
  if (!['delivered', 'cancelled', 'merged', 'firing', 'approved'].includes(t.status))
    out.push({
      action: 'cancel',
      label: 'cancelar',
      icon: X,
      enabled: true,
      hint:
        t.kind === 'revision'
          ? 'o ajuste para; o site atual continua no ar'
          : 'o pedido volta para a fila de pedidos de site',
    });
  return out;
}

const IDLE: Partial<Record<SiteTask['status'], string>> = {
  firing: 'disparando a routine…',
  approved: 'aprovado — o merge e a publicação seguem sozinhos',
  merged: 'mesclado — o site vai ao ar quando o deploy terminar',
  delivered: 'o site está no ar — nada a fazer',
};

export function TaskActions({ t, now }: { t: SiteTask; now: number }) {
  const act = useSiteAction(t.id);
  const [open, setOpen] = useState<SiteAction | null>(null);
  const items = itemsFor(t, now);
  const run = (action: SiteAction, reason?: string) =>
    act.mutate({ action, reason }, { onSuccess: () => setOpen(null) });

  return (
    <Panel title="ações" flush>
      {!items.length ? (
        <p className="p-3 text-sm text-muted-foreground">
          {IDLE[t.status] ?? 'nada a fazer agora'}
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((it) => (
            <li key={it.action} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">{it.hint}</p>
              <Button
                size="sm"
                variant={
                  it.action === 'cancel'
                    ? 'destructive-outline'
                    : it.primary
                      ? 'default'
                      : 'outline'
                }
                disabled={!it.enabled || act.isPending}
                onClick={() => {
                  act.reset();
                  setOpen(it.action);
                }}
                className="max-sm:w-full sm:min-w-32"
              >
                <it.icon />
                {it.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {act.isError && !open && (
        <p role="alert" className="border-t px-3 py-2 text-xs text-destructive-foreground">
          {actionError(act.error)}
        </p>
      )}

      <ConfirmDialog
        open={open === 'approve'}
        onClose={() => setOpen(null)}
        title={`aprovar ${t.prNumber ? `o PR #${t.prNumber}` : 'o PR'}?`}
        description="O PR é mesclado na main e o design vai para a loja assim que o deploy terminar. O lojista vê o site novo."
        action="aprovar e publicar"
        pending={act.isPending}
        error={open === 'approve' && act.isError ? actionError(act.error) : null}
        onConfirm={() => run('approve')}
      />
      <ConfirmDialog
        open={open === 'retry'}
        onClose={() => setOpen(null)}
        title="tentar de novo?"
        description="Uma sessão nova começa do zero numa branch nova. O PR e a sessão atuais ficam para trás — feche-os no GitHub se ainda estiverem abertos."
        action="tentar de novo"
        pending={act.isPending}
        error={open === 'retry' && act.isError ? actionError(act.error) : null}
        onConfirm={() => run('retry')}
      />
      <ConfirmDialog
        open={open === 'human'}
        onClose={() => setOpen(null)}
        title="assumir à mão?"
        description="A routine para de mexer nesta tarefa. Empurre a branch abaixo e abra o PR a partir dela: CI, aprovação e publicação seguem como sempre."
        action="assumir"
        pending={act.isPending}
        error={open === 'human' && act.isError ? actionError(act.error) : null}
        onConfirm={() => run('human')}
      >
        <BranchBox t={t} />
      </ConfirmDialog>
      <CancelDialog
        open={open === 'cancel'}
        onClose={() => setOpen(null)}
        t={t}
        pending={act.isPending}
        error={open === 'cancel' && act.isError ? actionError(act.error) : null}
        onConfirm={(reason) => run('cancel', reason)}
      />
    </Panel>
  );
}

function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  action,
  pending,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  action: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  children?: ReactNode | undefined;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            voltar
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {pending ? 'enviando…' : action}
          </Button>
        </>
      }
    >
      {(children || error) && (
        <div className="flex flex-col gap-2">
          {children}
          {error && (
            <p role="alert" className="text-xs text-destructive-foreground">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function CancelDialog({
  open,
  onClose,
  t,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  t: SiteTask;
  pending: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= REASON_MIN;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="cancelar a tarefa?"
      description={
        t.kind === 'revision'
          ? 'O ajuste para e o site atual continua no ar.'
          : 'A tarefa para e o pedido de site volta para a fila de pedidos.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            voltar
          </Button>
          <Button
            variant="destructive"
            disabled={!ok || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? 'cancelando…' : 'cancelar tarefa'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <Field
          label="motivo"
          htmlFor="site-cancel-reason"
          hint={
            <span className="flex justify-between gap-2">
              <span>fica no histórico da tarefa</span>
              <span className="tnum">
                {reason.length}/{REASON_MAX}
              </span>
            </span>
          }
        >
          <Textarea
            id="site-cancel-reason"
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ex.: o lojista desistiu do site novo"
          />
        </Field>
        {error && (
          <p role="alert" className="text-xs text-destructive-foreground">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Where staff push when they take a task by hand: the branch, and what the PR carries. */
export function BranchBox({ t }: { t: Pick<SiteTask, 'id' | 'branch' | 'slug'> }) {
  const copy = () =>
    navigator.clipboard.writeText(t.branch).then(
      () => toast.success('branch copiada'),
      () => toast.error('não deu para copiar'),
    );
  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-muted/60 p-2.5">
      <span className="text-xs text-muted-foreground">branch</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 text-[13px] break-all select-all">{t.branch}</code>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void copy()}
          aria-label="copiar branch"
        >
          <Copy />
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">
        no PR: label <code className="text-foreground select-all">storefront:{t.slug}</code> e, no
        texto, a linha{' '}
        <code className="break-all text-foreground select-all">vendua-task:{t.id}</code>
      </span>
    </div>
  );
}
