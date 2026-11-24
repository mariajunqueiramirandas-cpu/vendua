import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import { api, ApiError, type LeadFact } from '@/lib/api.ts';
import { qk } from '@/lib/query.ts';
import { editableValueClass } from '@/components/EditableText.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useLeadFacts } from '../queries.ts';
import { Hint, Section } from '../Section.tsx';
import { FetchErr, isMissing } from './shared.tsx';

const apiMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Turns a human label ("Prefere WhatsApp") into the API's snake_case key. */
function normalizeFactKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

const prettyKey = (k: string) => k.replace(/_/g, ' ');

function useFactWrites(leadId: string, onError: (msg: string) => void) {
  const client = useQueryClient();
  const settle = () => void client.invalidateQueries({ queryKey: qk.leadFacts(leadId) });
  const put = useMutation({
    mutationFn: (v: { key: string; value: string; confidence?: number }) =>
      api.putLeadFact(leadId, v.key, {
        value: v.value,
        ...(v.confidence != null ? { confidence: v.confidence } : {}),
      }),
    onSuccess: () => onError(''),
    onError: (e) => onError(apiMsg(e, 'falha ao salvar')),
    onSettled: settle,
  });
  const del = useMutation({
    mutationFn: (key: string) => api.deleteLeadFact(leadId, key),
    onSuccess: () => onError(''),
    onError: (e) => onError(apiMsg(e, 'falha ao apagar')),
    onSettled: settle,
  });
  return { put, del };
}

function FactRow({
  leadId,
  fact,
  onError,
}: {
  leadId: string;
  fact: LeadFact;
  onError: (msg: string) => void;
}) {
  const { put, del } = useFactWrites(leadId, onError);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(fact.value);
  const save = () => {
    const v = val.trim();
    if (!v) return;
    put.mutate({ key: fact.key, value: v }, { onSuccess: () => setEditing(false) });
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') setEditing(false);
  };
  return (
    <li className="flex items-start gap-1.5 py-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[11px] font-medium text-muted-foreground" title={fact.key}>
            {prettyKey(fact.key)}
          </span>
          {fact.confidence < 1 && (
            <span
              className="text-[11px] text-muted-foreground tnum"
              title={`confiança ${Math.round(fact.confidence * 100)}%`}
            >
              {Math.round(fact.confidence * 100)}%
            </span>
          )}
          <Badge
            variant={fact.source === 'agent' ? 'agent-soft' : 'default'}
            title={
              fact.source === 'agent'
                ? 'gravado pelo agente'
                : 'anotado pela equipe — o agente lê junto'
            }
          >
            {fact.source === 'agent' ? 'agente' : 'equipe'}
          </Badge>
        </div>
        {editing ? (
          <div className="mt-1 flex gap-1">
            <Input
              autoFocus
              value={val}
              maxLength={500}
              aria-label={`valor de ${fact.key}`}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={keys}
            />
            {/* No blur-save — clicking × must not race a PUT against the DELETE. */}
            <Button size="icon" variant="outline" onClick={save} aria-label="salvar fato">
              <Check />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className={editableValueClass}
            title="clique para editar o valor"
            onClick={() => {
              setVal(fact.value);
              setEditing(true);
            }}
          >
            <span className="text-left break-words">{fact.value}</span>
          </button>
        )}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        title="apagar este fato"
        aria-label={`apagar ${fact.key}`}
        disabled={del.isPending}
        onClick={() => del.mutate(fact.key)}
      >
        <X />
      </Button>
    </li>
  );
}

function FactAdd({ leadId, onError }: { leadId: string; onError: (msg: string) => void }) {
  const { put } = useFactWrites(leadId, onError);
  const [label, setLabel] = useState('');
  const [val, setVal] = useState('');
  const add = () => {
    const k = normalizeFactKey(label);
    const v = val.trim();
    if (!k || !v) return;
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(k))
      return onError('o campo precisa começar com uma letra — ex.: prefere whatsapp');
    put.mutate(
      { key: k, value: v },
      {
        onSuccess: () => {
          setLabel('');
          setVal('');
        },
      },
    );
  };
  const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && add();
  return (
    <div className="mt-2 flex flex-col gap-1">
      <Input
        value={label}
        maxLength={60}
        placeholder="campo — ex.: prefere whatsapp"
        aria-label="campo do fato"
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={enter}
      />
      <div className="flex gap-1">
        <Input
          value={val}
          maxLength={500}
          placeholder="valor — ex.: só responde à tarde"
          aria-label="valor do fato"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={enter}
        />
        <Button
          size="icon"
          variant="outline"
          onClick={add}
          disabled={!label.trim() || !val.trim() || put.isPending}
          aria-label="gravar fato"
          title="gravar"
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

export function AgentFacts({ leadId }: { leadId: string }) {
  const { data: facts = [], isPending, error, refetch } = useLeadFacts(leadId);
  const [err, setErr] = useState('');
  return (
    <Section
      title="fatos do lead"
      actions={
        facts.length > 0 && (
          <span className="text-xs text-muted-foreground tnum">{facts.length}</span>
        )
      }
    >
      {isPending ? (
        <Hint>carregando…</Hint>
      ) : error && isMissing(error) ? (
        <Hint>fatos estruturados ainda não expostos pela API</Hint>
      ) : error ? (
        <FetchErr what="os fatos" retry={() => void refetch()} />
      ) : (
        <>
          {facts.length ? (
            <ul className="-my-1 divide-y">
              {facts.map((f) => (
                <FactRow key={f.key} leadId={leadId} fact={f} onError={setErr} />
              ))}
            </ul>
          ) : (
            <Hint>nenhum fato salvo — o agente grava aqui o que descobre sobre este lead</Hint>
          )}
          <FactAdd leadId={leadId} onError={setErr} />
          {err && <p className="mt-1 text-xs text-destructive-foreground">{err}</p>}
        </>
      )}
    </Section>
  );
}
