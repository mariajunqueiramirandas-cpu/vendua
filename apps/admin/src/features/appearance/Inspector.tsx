import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CursorClick,
  Eye,
  EyeSlash,
  Palette,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react';
import { DEFAULT_TOKENS } from '@vendua/templates';
import type { ReactNode } from 'react';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Colors } from './Colors.tsx';
import { fieldsFor, sectionName } from './fields.ts';
import { SettingsEditor } from './SettingsEditor.tsx';
import { tplLabel, type Editor } from './useEditor.ts';

/**
 * What's selected, ready to edit: a part's copy and photos, or the store's colours.
 * `onBack` is the panel on phones and tablets, where it replaces the list; on desktop it
 * sits in its own column and closes instead.
 */
export function Inspector({
  ed,
  origin,
  logoUrl,
  previewShown,
  onBack,
  onAdd,
}: {
  ed: Editor;
  origin: string;
  logoUrl: string | null;
  /** with no live preview, the colours show their own sample */
  previewShown: boolean;
  onBack?: () => void;
  onAdd: () => void;
}) {
  const close = onBack ?? (() => ed.setSel(null));
  const sel = ed.sel;

  if (sel?.kind === 'style')
    return (
      <div className="space-y-5">
        <Head
          over="Loja toda"
          title="Cores e cantos"
          onBack={onBack}
          onClose={close}
          note="Você vê na prévia na hora. Os clientes veem depois de publicar."
        />
        {ed.tokens ? (
          <Colors
            value={ed.tokens}
            onChange={ed.setTokens}
            logoUrl={logoUrl}
            sample={!previewShown}
          />
        ) : (
          <div className="space-y-3">
            <p className="t-body text-muted">Carregando as cores atuais da sua loja pela prévia…</p>
            <Button variant="secondary" onClick={() => ed.setTokens(DEFAULT_TOKENS)}>
              começar de uma paleta nova
            </Button>
          </div>
        )}
      </div>
    );

  const sec = ed.selected;
  if (sel?.kind === 'section' && sec) {
    const list = ed.drafts[sel.tpl].sections;
    const i = list.findIndex((x) => x.id === sec.id);
    return (
      <div className="space-y-5">
        <Head
          over={sel.tpl === 'layout' ? 'Em todas as páginas' : `Página ${tplLabel(sel.tpl)}`}
          title={sectionName(sec.type)}
          onBack={onBack}
          onClose={close}
        />
        {sec.disabled ? (
          <div className="flex items-center gap-3 rounded-md bg-warning-soft p-3 text-warning">
            <EyeSlash className="size-5 shrink-0" />
            <p className="t-body min-w-0 flex-1 text-ink">Escondida: os clientes não veem.</p>
            <Button size="sm" variant="secondary" onClick={() => ed.toggle(sel.tpl, sec.id)}>
              mostrar
            </Button>
          </div>
        ) : null}
        <SettingsEditor
          grouped
          origin={origin}
          idPrefix={sec.id}
          fields={fieldsFor(sec.type, sec.settings)}
          value={sec.settings ?? {}}
          onChange={(v) => ed.setSettings(sel.tpl, sec.id, v)}
        />
        <div className="space-y-3 border-t border-line pt-5">
          <h3 className="t-caption font-semibold uppercase tracking-wide text-muted">Na página</h3>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowUp />}
              disabled={i <= 0}
              onClick={() => ed.move(sel.tpl, sec.id, -1)}
            >
              subir
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<ArrowDown />}
              disabled={i < 0 || i >= list.length - 1}
              onClick={() => ed.move(sel.tpl, sec.id, 1)}
            >
              descer
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={sec.disabled ? <Eye /> : <EyeSlash />}
              onClick={() => ed.toggle(sel.tpl, sec.id)}
            >
              {sec.disabled ? 'mostrar' : 'esconder'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              icon={<Trash />}
              onClick={() => ed.remove(sel.tpl, sec.id)}
            >
              tirar da página
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <span className="grid size-14 place-items-center rounded-full bg-spark-soft text-on-spark noite:text-spark">
        <CursorClick className="size-7" />
      </span>
      <div className="space-y-1.5">
        <h2 className="t-title-2">O que você quer mudar?</h2>
        <p className="t-body text-muted">
          Toque em qualquer parte da prévia, ou escolha na lista. Cada mudança aparece na hora.
        </p>
      </div>
      <div className="grid gap-2">
        <Button
          variant="secondary"
          block
          icon={<Palette />}
          onClick={() => ed.setSel({ kind: 'style' })}
        >
          mudar as cores
        </Button>
        <Button variant="secondary" block icon={<Plus />} onClick={onAdd}>
          adicionar uma parte
        </Button>
      </div>
      <p className="t-caption border-t border-line pt-4 text-muted">
        Nada muda para os clientes até você tocar em <strong className="text-ink">publicar</strong>.
        Dá para desfazer qualquer mudança.
      </p>
    </div>
  );
}

function Head({
  over,
  title,
  note,
  onBack,
  onClose,
}: {
  over: string;
  title: string;
  note?: ReactNode;
  onBack?: (() => void) | undefined;
  onClose: () => void;
}) {
  return (
    <header className="flex items-start gap-1">
      {onBack ? (
        <IconButton label="voltar à lista" className="-ml-2 -mt-1 shrink-0" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="t-caption text-muted">{over}</p>
        <h2 className="t-title-2">{title}</h2>
        {note ? <p className="t-caption mt-1 text-muted">{note}</p> : null}
      </div>
      {!onBack ? (
        <IconButton label="fechar" size="sm" className="-mr-2 -mt-1 shrink-0" onClick={onClose}>
          <X />
        </IconButton>
      ) : null}
    </header>
  );
}
