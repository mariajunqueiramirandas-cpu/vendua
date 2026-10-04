import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Account } from '../../lib/api.ts';
import { parseDocument } from '../../lib/parse.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { DocumentInput, Field } from '../../ui/fields.tsx';
import { DOCUMENT_ERR } from '../auth/pending.ts';

/** A plan from before signup asked for the CPF/CNPJ: its Pix waits for one, since MP refuses
 *  the Pix that goes without it. Saving it makes Core reissue the live Pix with it. */
export const needsDocument = (a: Account | undefined) =>
  !!a?.subscription && a.subscription.method === 'pix' && !a.subscription.payerDocument;

export function DocumentGate() {
  const qc = useQueryClient();
  const [doc, setDoc] = useState('');
  const [touched, setTouched] = useState(false);
  const parsed = parseDocument(doc);
  const save = useMutation({
    mutationFn: (payerDocument: string) => api.updateSubscription({ payerDocument }),
    onSuccess: (n) => qc.setQueryData(qk.account, n),
  });
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (parsed) save.mutate(parsed);
      }}
    >
      <div>
        <p className="font-semibold">Falta o CPF ou o CNPJ da cobrança</p>
        <p className="t-body mt-1 text-muted">
          O Pix do plano vai com ele. Assim que salvar, o código aparece aqui.
        </p>
      </div>
      <Field
        label="CPF ou CNPJ"
        htmlFor="gate-doc"
        error={touched && !parsed ? DOCUMENT_ERR : save.error ? messageOf(save.error) : null}
      >
        <DocumentInput
          id="gate-doc"
          value={doc}
          invalid={touched && !parsed}
          onBlur={() => doc && setTouched(true)}
          onChange={(v) => setDoc(v)}
        />
      </Field>
      <Button type="submit" block loading={save.isPending}>
        salvar e gerar o Pix
      </Button>
    </form>
  );
}
