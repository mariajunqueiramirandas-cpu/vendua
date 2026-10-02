import { ArrowLeft, ArrowRight, Camera, MagicWand, Plus, Star, Trash } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { loadBitmap, prepareImage, type Crop } from '../lib/image.ts';
import { Button, IconButton } from './Button.tsx';
import { cn } from './cn.ts';
import { messageOf } from './feedback.tsx';
import { Chips, Toggle } from './fields.tsx';
import { Sheet } from './Sheet.tsx';
import { toast } from './Toast.tsx';

export interface Photo {
  url: string;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
}

const ASPECTS = { '4:3': 4 / 3, '1:1': 1 } as const;
type AspectKey = keyof typeof ASPECTS;

/**
 * Photos first (§4.6, §7): big cover, gallery to reorder (first = cover), upload
 * with crop and the storefront's aspect as the guide, a one-tap "clarear".
 */
export function PhotoField({
  photos: saved,
  onChange,
  max = 12,
  label,
  autoOpen,
  initialFile,
  aspect = '4:3',
  vtKey,
  compact,
}: {
  photos: Photo[];
  onChange: (next: Photo[]) => Promise<unknown> | void;
  max?: number;
  label: string;
  autoOpen?: boolean;
  /** a photo that arrived another way (shared from the gallery): straight to the crop */
  initialFile?: File | null;
  aspect?: AspectKey;
  /** the cover is this shared-element destination (`data-vt-dst`, app/Router.tsx) */
  vtKey?: string;
  /** a thumbnail-sized slot (a list row): the empty tile is just the camera */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // Quick taps (delete two, move twice) build on what's on screen and save one at a time,
  // newest last, so a slow response can't bring back a photo that was just removed.
  const [shown, setShown] = useState<Photo[] | null>(null);
  const photos = shown ?? saved;
  const queued = useRef<Photo[] | null>(null);
  const saving = useRef(false);
  const commit = async (next: Photo[]) => {
    setShown(next);
    queued.current = next;
    if (saving.current) return;
    saving.current = true;
    try {
      while (queued.current) {
        const n = queued.current;
        queued.current = null;
        await Promise.resolve(onChange(n)).catch(() => undefined);
      }
    } finally {
      saving.current = false;
      setShown(null);
    }
  };
  const closeCrop = useCallback(() => setFile(null), []);
  useEffect(() => {
    if (initialFile) setFile(initialFile);
  }, [initialFile]);
  useEffect(() => {
    if (autoOpen && !photos.length) input.current?.click();
    // only on first mount: "criar e adicionar foto" lands here with the picker open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cover = photos[0];
  const move = (i: number, d: -1 | 1) => {
    const n = [...photos];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x!);
    void commit(n);
  };
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
          e.target.value = '';
        }}
      />
      {cover ? (
        <div
          className="relative overflow-hidden rounded-lg bg-sunken"
          style={{ aspectRatio: ASPECTS[aspect] }}
          data-vt-dst={vtKey}
        >
          <img src={cover.url} alt={cover.alt ?? ''} className="size-full object-cover" />
          {max === 1 ? (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="t-caption absolute inset-x-0 bottom-0 min-h-10 bg-[rgb(10_16_13/0.55)] font-semibold text-white"
            >
              trocar
            </button>
          ) : (
            // Button's own `relative` would win over an `absolute` passed in (cn doesn't merge)
            <div className="absolute bottom-3 right-3">
              <Button
                variant="secondary"
                size="sm"
                icon={<Camera />}
                disabled={photos.length >= max}
                onClick={() => input.current?.click()}
              >
                adicionar foto
              </Button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-line-strong bg-sunken text-muted hover:bg-press',
            compact ? 'rounded-md' : 'rounded-lg',
          )}
          style={{ aspectRatio: ASPECTS[aspect] }}
          data-vt-dst={vtKey}
          aria-label={compact ? label : undefined}
        >
          <Camera
            weight="duotone"
            className={cn(compact ? 'size-6' : max === 1 ? 'size-8' : 'size-12')}
          />
          {compact ? null : <span className="t-label text-ink">adicionar foto</span>}
          {max > 1 ? (
            <span className="t-caption px-3 text-center">
              Da câmera ou da galeria. A gente ajusta o tamanho.
            </span>
          ) : null}
        </button>
      )}
      {max > 1 && photos.length >= 1 ? (
        <ul
          // the padding keeps the cover's ring inside the scroller, which clips it otherwise
          className="-mx-1 mt-2 flex gap-2 overflow-x-auto p-1"
          aria-label="fotos (a primeira é a capa)"
        >
          {photos.map((p, i) => (
            <li key={p.url + i} className="relative w-28 shrink-0">
              <img
                src={p.url}
                alt=""
                className={cn(
                  'aspect-[4/3] w-full rounded-sm object-cover',
                  i === 0 && 'ring-2 ring-spark',
                )}
              />
              {i === 0 ? (
                <span className="t-caption absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-spark px-1.5 font-semibold text-on-spark">
                  <Star weight="fill" className="size-3" /> capa
                </span>
              ) : null}
              <div className="mt-1 flex justify-between">
                <IconButton
                  label="mover para a esquerda"
                  size="sm"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowLeft />
                </IconButton>
                <IconButton
                  label="apagar foto"
                  size="sm"
                  onClick={() => void commit(photos.filter((_, k) => k !== i))}
                >
                  <Trash />
                </IconButton>
                <IconButton
                  label="mover para a direita"
                  size="sm"
                  disabled={i === photos.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowRight />
                </IconButton>
              </div>
            </li>
          ))}
          {photos.length < max ? (
            <li className="w-28 shrink-0">
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="grid aspect-[4/3] w-full place-items-center rounded-sm border-2 border-dashed border-line-strong text-muted hover:bg-hover"
                aria-label="adicionar outra foto"
              >
                <Plus className="size-6" />
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      <CropSheet
        file={file}
        aspect={aspect}
        onClose={closeCrop}
        onDone={async (photo) => {
          setFile(null);
          // a single photo ("trocar") replaces it
          await commit(max === 1 ? [photo] : [...photos, photo]);
        }}
      />
    </div>
  );
}

function CropSheet({
  file,
  aspect: initial,
  onClose,
  onDone,
}: {
  file: File | null;
  aspect: AspectKey;
  onClose: () => void;
  onDone: (p: Photo) => Promise<void>;
}) {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState<AspectKey>(initial);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [enhance, setEnhance] = useState(false);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [fw, setFw] = useState(320);

  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let decoded: ImageBitmap | null = null;
    setBmp(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    const u = URL.createObjectURL(file);
    setUrl(u);
    loadBitmap(file).then(
      (b) => {
        if (cancelled) return b.close();
        decoded = b;
        setBmp(b);
      },
      () => {
        if (cancelled) return;
        toast.error('Não conseguimos abrir essa foto. Tente outra.');
        close.current();
      },
    );
    return () => {
      cancelled = true;
      URL.revokeObjectURL(u);
      // a phone photo decodes to ~50 MB; iOS kills the tab after a few left open
      decoded?.close();
    };
  }, [file]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bmp]);

  const fh = fw / ASPECTS[aspect];
  // a closed bitmap (the sheet closing) reads 0 × 0
  const iw = bmp?.width || 1;
  const ih = bmp?.height || 1;
  const scale = Math.max(fw / iw, fh / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const maxX = (dw - fw) / 2;
  const maxY = (dh - fh) / 2;
  const px = Math.max(-maxX, Math.min(maxX, pan.x));
  const py = Math.max(-maxY, Math.min(maxY, pan.y));
  const left = (fw - dw) / 2 + px;
  const top = (fh - dh) / 2 + py;
  const crop: Crop = { x: -left / dw, y: -top / dh, w: fw / dw, h: fh / dh };

  const save = async () => {
    if (!bmp) return;
    setBusy(true);
    try {
      const prepared = await prepareImage(bmp, crop, { enhance });
      const up = await api.uploadMedia(prepared.blob, prepared);
      await onDone({ url: up.url, width: up.width, height: up.height, alt: null });
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!file}
      onOpenChange={(v) => !v && onClose()}
      title="Ajustar foto"
      description="Arraste para posicionar. O quadro é como a foto aparece na loja."
      footer={
        <Button size="lg" block loading={busy} disabled={!bmp} onClick={() => void save()}>
          usar esta foto
        </Button>
      }
    >
      <div className="space-y-4 pt-2">
        <div
          ref={frame}
          className="relative w-full touch-none select-none overflow-hidden rounded-lg bg-sunken ring-2 ring-spark"
          style={{ aspectRatio: ASPECTS[aspect] }}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px, py };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
          }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => setZoom((z) => Math.max(1, Math.min(4, z - e.deltaY / 500)))}
        >
          {url && bmp ? (
            <img
              src={url}
              alt="prévia do corte"
              draggable={false}
              className="absolute max-w-none"
              style={{
                width: dw,
                height: dh,
                left,
                top,
                // the preview approximates the enhance; the upload runs the real one
                filter: enhance ? 'brightness(1.08) contrast(1.06) saturate(1.04)' : undefined,
              }}
            />
          ) : (
            <div className="skeleton absolute inset-0" />
          )}
          {/* rule of thirds */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3"
          >
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="border border-white/25" />
            ))}
          </div>
        </div>
        <label className="flex items-center gap-3">
          <span className="t-label shrink-0">Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="h-11 w-full accent-(--primary)"
            aria-label="zoom"
          />
        </label>
        <Chips
          label="formato"
          value={aspect}
          onChange={setAspect}
          options={[
            { value: '4:3', label: 'cardápio (4:3)' },
            { value: '1:1', label: 'quadrada' },
          ]}
        />
        <Toggle
          checked={enhance}
          onChange={setEnhance}
          label={
            <span className="inline-flex items-center gap-2">
              <MagicWand className="size-5" /> Clarear
            </span>
          }
          description="Ajusta a luz e o branco. Não muda as cores do doce."
        />
      </div>
    </Sheet>
  );
}
