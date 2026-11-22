import { Camera, Trash } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { Button } from '../../ui/Button.tsx';
import { CropSheet } from '../../ui/PhotoField.tsx';
import { mediaUrl } from '../../lib/media.ts';

/**
 * The logo's answer: one row the width of the column, like every other answer, with the slot
 * the photo lands in (the app icon's square, as the store's card wears it) and the words beside
 * it. A square tile alone would sit in a corner of the column. The crop is the photo field's.
 */
export function AnswerLogo({
  url,
  onChange,
}: {
  url: string | null;
  onChange: (url: string | null) => Promise<unknown> | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const pick = () => input.current?.click();
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="logo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
          e.target.value = '';
        }}
      />
      {url ? (
        <div className="flex items-center gap-4 rounded-lg bg-surface p-3 depth-1">
          <img
            src={mediaUrl(url)}
            alt="logo da loja"
            className="size-20 shrink-0 rounded-[22%] bg-sunken object-cover ring-1 ring-line"
          />
          <div className="min-w-0 flex-1">
            <p className="t-body font-semibold">Esse é o ícone da loja.</p>
            <div className="-ml-3.5 mt-1 flex flex-wrap items-center">
              <Button variant="ghost" size="sm" icon={<Camera />} onClick={pick}>
                trocar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash />}
                className="text-muted"
                onClick={() => void onChange(null)}
              >
                tirar
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          className="flex w-full items-center gap-4 rounded-lg border-2 border-dashed border-line-strong bg-sunken p-3 text-left hover:bg-press"
        >
          <span
            aria-hidden
            className="grid size-20 shrink-0 place-items-center rounded-[22%] bg-surface text-muted ring-1 ring-line"
          >
            <Camera weight="duotone" className="size-8" />
          </span>
          <span className="min-w-0">
            <span className="t-body block font-semibold text-ink">adicionar foto</span>
            <span className="t-caption mt-0.5 block text-muted">
              Da câmera ou da galeria. A gente corta no quadrado.
            </span>
          </span>
        </button>
      )}
      <CropSheet
        file={file}
        aspect="1:1"
        onClose={() => setFile(null)}
        onDone={async (p) => {
          setFile(null);
          await onChange(p.url);
        }}
      />
    </div>
  );
}
