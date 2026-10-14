import { FileArrowUp } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';
import { num, phone } from '../../lib/format.ts';
import { useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, TextArea } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

// Clientes › Importar (0121): the list exported from the old system, a CSV file or a paste.
// Core reads it (any column order, a header or not); the sheet shows what it read before the
// import. A contact is not consent: the copy says nothing is sent to them.

const MAX_BYTES = 400_000;

export function ImportCustomersSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof api.customerImportPreview>
  > | null>(null);

  useEffect(() => {
    if (!text.trim()) return setPreview(null);
    // a slow preview for older text must not replace the newer one
    let stale = false;
    const t = setTimeout(() => {
      api.customerImportPreview(text).then(
        (r) => !stale && setPreview(r),
        () => !stale && setPreview(null),
      );
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [text]);

  const run = useMutation({
    mutationFn: () => api.importCustomers(text),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      toast(
        r.imported
          ? `${num(r.imported)} ${r.imported === 1 ? 'cliente entrou' : 'clientes entraram'} na lista.`
          : 'Todos já estavam na sua lista.',
      );
      setText('');
      setFileNote(null);
      onOpenChange(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setFileNote('Esse arquivo é grande demais. Separe em partes de até 5.000 clientes.');
      return;
    }
    setText(await f.text());
    setFileNote(f.name);
  };

  const total = preview?.total ?? 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Importar clientes"
      description="Traga a lista do app que você usava: um arquivo CSV ou nomes e telefones colados."
      wide
      footer={
        <Button
          size="lg"
          block
          disabled={!total}
          loading={run.isPending}
          onClick={() => run.mutate()}
        >
          {total
            ? `importar ${num(total)} ${total === 1 ? 'cliente' : 'clientes'}`
            : 'cole a lista acima'}
        </Button>
      }
    >
      <div className="space-y-4 pt-2">
        <input
          ref={file}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" icon={<FileArrowUp />} onClick={() => file.current?.click()}>
          escolher arquivo CSV
        </Button>
        {fileNote ? <p className="t-caption text-muted">{fileNote}</p> : null}
        <Field
          label="Ou cole a lista"
          htmlFor="imp-customers"
          helper="Um cliente por linha, com nome e WhatsApp. Ex.: “Ana Souza; (21) 99999-0000”."
        >
          <TextArea
            id="imp-customers"
            rows={6}
            maxLength={MAX_BYTES}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileNote(null);
            }}
            placeholder={'Ana Souza; (21) 99999-0000\nBruno Lima; 21 98888-7777'}
          />
        </Field>
        {preview && total ? (
          <div>
            <p className="t-label mb-2">
              Lemos {num(total)} {total === 1 ? 'cliente' : 'clientes'}
              {preview.skipped
                ? `. ${num(preview.skipped)} ${preview.skipped === 1 ? 'linha ficou' : 'linhas ficaram'} de fora, sem nome ou telefone`
                : ''}
              :
            </p>
            <ul className="divide-y divide-line rounded-md ring-1 ring-line">
              {preview.contacts.map((k) => (
                <li key={k.phone} className="flex justify-between gap-3 px-3 py-2">
                  <span className="truncate">{k.name}</span>
                  <span className="tnum shrink-0 text-muted">{phone(k.phone)}</span>
                </li>
              ))}
              {total > preview.contacts.length ? (
                <li className="t-caption px-3 py-2 text-muted">
                  e mais {num(total - preview.contacts.length)}
                </li>
              ) : null}
            </ul>
          </div>
        ) : text.trim() && preview ? (
          <p className="t-body text-muted">Ainda não achamos linhas com nome e telefone.</p>
        ) : null}
        <p className="t-caption rounded-md bg-sunken px-4 py-3 text-muted">
          Eles aparecem em Clientes, com o nome que você usava. Ninguém recebe mensagem por causa da
          importação: a Venduá só escreve para quem pede pela loja ou pede aviso.
        </p>
      </div>
    </Sheet>
  );
}
