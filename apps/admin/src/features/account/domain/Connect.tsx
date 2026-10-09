import { Globe } from '@phosphor-icons/react';
import { useState } from 'react';
import { api, ApiError, type Account } from '../../../lib/api.ts';
import { Button } from '../../../ui/Button.tsx';
import { messageOf } from '../../../ui/feedback.tsx';
import { Field, TextInput } from '../../../ui/fields.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { RadioRows, useAccountWrite } from './kit.tsx';
import { cleanHost, HOST_RE, isRoot } from './status.tsx';

type Method = 'ns' | 'cname';

const ERR: Record<string, string> = {
  INVALID_DOMAIN: 'Esse domínio não pode ser usado. Confira, como www.sualoja.com.br.',
  DOMAIN_NOT_ROOT: 'Para usar os servidores da Venduá, digite o domínio sem o www.',
  DELEGATION_UNAVAILABLE: 'Agora só dá para criar os registros no seu provedor.',
};

/** A domain the owner already has: by our name servers (a root) or by records at theirs. */
export function ConnectForm({ a, intro }: { a: Account; intro: boolean }) {
  const delegation = a.domainOptions.delegation;
  const [host, setHost] = useState('');
  const [method, setMethod] = useState<Method>('ns');
  const [err, setErr] = useState<string | null>(null);
  const h = cleanHost(host);
  const choose = delegation && isRoot(h);
  const add = useAccountWrite(
    (v: { host: string; method?: Method }) => api.addDomain(v.host, v.method),
    (_, v) => {
      setHost('');
      toast(
        v.method === 'ns'
          ? 'Domínio adicionado. Agora é conferir os registros.'
          : 'Domínio adicionado. Agora é criar os registros.',
      );
    },
    (e) => setErr((e instanceof ApiError && ERR[e.code]) || messageOf(e)),
  );
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!HOST_RE.test(h))
          return setErr(
            `Digite o endereço, como ${delegation ? 'sualoja.com.br' : 'www.sualoja.com.br'}.`,
          );
        setErr(null);
        add.mutate(choose ? { host: h, method } : { host: h });
      }}
      className="space-y-4"
    >
      {intro ? (
        <p className="t-body text-muted">
          Tem um domínio? Conecte aqui. Se ainda não tem, dá para registrar um no Registro.br ou em
          outro site de domínios.
        </p>
      ) : null}
      <Field label="Seu domínio" htmlFor="custom-host" error={err}>
        <TextInput
          id="custom-host"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={253}
          placeholder={delegation ? 'sualoja.com.br' : 'www.sualoja.com.br'}
          value={host}
          aria-invalid={err ? true : undefined}
          onChange={(e) => {
            setHost(e.target.value);
            setErr(null);
          }}
        />
      </Field>
      {choose ? (
        <RadioRows<Method>
          label="Como ligar o domínio"
          value={method}
          onChange={setMethod}
          options={[
            {
              value: 'ns',
              title: 'Usar os servidores da Venduá (recomendado)',
              detail: `Você troca os servidores de ${h} uma vez e a Venduá cuida do resto, inclusive do www.`,
            },
            {
              value: 'cname',
              title: 'Criar registros no meu provedor',
              detail: 'Você cria os registros no painel onde está o domínio.',
            },
          ]}
        />
      ) : null}
      <Button type="submit" loading={add.isPending} icon={<Globe />}>
        conectar domínio
      </Button>
    </form>
  );
}
