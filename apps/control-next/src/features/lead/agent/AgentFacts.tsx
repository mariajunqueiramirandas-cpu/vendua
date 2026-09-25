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

const CONF_ERR = 'confiança precisa ser um número de 0 a 1 — ex.: 0.8';
const apiMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

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

/** '' → undefined (staff default = full confidence); NaN/out of range → null (invalid). */
function parseConf(raw: string): number | undefined | null {
  if (!raw.trim()) return undefined;
  const c = Number(raw);
  return Number.isFinite(c) && c >= 0 && c <= 1 ? c : null;
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
  const [conf, setConf] = useState(String(fact.confidence));
  const save = () => {
    const c = parseConf(conf);
    if (c === null) return onError(CONF_ERR);
    put.mutate(
      { key: fact.key, value: val.trim(), ...(c != null ? { confidence: c } : {}) },
      { onSuccess: () => setEditing(false) },
    );
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') setEditing(false);
  };
  return (
    <li className="flex items-start gap-1.5 py-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[11px] text-muted-foreground">{fact.key}</span>
          <span
            className="text-[11px] text-muted-foreground tnum"
            title={`confiança ${Math.round(fact.confidence * 100)}%`}
          >
            {Math.round(fact.confidence * 100)}%
          </span>
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
            <Input
              value={conf}
              inputMode="decimal"
              aria-label="confiança 0 a 1"
              title="confiança 0–1"
              onChange={(e) => setConf(e.target.value)}
              onKeyDown={keys}
              className="w-16 shrink-0"
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
              setConf(String(fact.confidence));
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

// Keys use snake_case like the agent writes; confidence is optional (staff defaults to full).
function FactAdd({ leadId, onError }: { leadId: string; onError: (msg: string) => void }) {
  const { put } = useFactWrites(leadId, onError);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [conf, setConf] = useState('');
  const add = () => {
    const k = key.trim();
    const v = val.trim();
    if (!k || !v) return;
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(k))
      return onError('a chave precisa ser snake_case — ex.: prefere_whatsapp');
    const c = parseConf(conf);
    if (c === null) return onError(CONF_ERR);
    put.mutate(
      { key: k, value: v, ...(c != null ? { confidence: c } : {}) },
      {
        onSuccess: () => {
          setKey('');
          setVal('');
          setConf('');
        },
      },
    );
  };
  const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && add();
  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex gap-1">
        <Input
          value={key}
          maxLength={60}
          placeholder="chave_snake_case"
          aria-label="chave do fato"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={enter}
          className="font-mono text-xs md:text-xs"
        />
        <Input
          value={conf}
          inputMode="decimal"
          placeholder="conf"
          aria-label="confiança 0 a 1"
          title="confiança 0–1 (opcional)"
          onChange={(e) => setConf(e.target.value)}
          onKeyDown={enter}
          className="w-16 shrink-0"
        />
      </div>
      <div className="flex gap-1">
        <Input
          value={val}
          maxLength={500}
          placeholder="valor — ex.: prefere whatsapp à tarde"
          aria-label="valor do fato"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={enter}
        />
        <Button
          size="icon"
          variant="outline"
          onClick={add}
          disabled={!key.trim() || !val.trim() || put.isPending}
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
    <Section title="fatos que o agente sabe">
      {isPending ? (
        <Hint>carregando…</Hint>
      ) : error && isMissing(error) ? (
        <Hint>a API ainda não expõe fatos estruturados do lead</Hint>
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
            <Hint>nenhum fato ainda — o agente grava aqui o que descobre sobre o lead</Hint>
          )}
          <FactAdd leadId={leadId} onError={setErr} />
          {err && <p className="mt-1 text-xs text-destructive-foreground">{err}</p>}
        </>
      )}
    </Section>
  );
}
