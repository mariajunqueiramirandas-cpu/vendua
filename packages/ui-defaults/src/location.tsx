import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { LatLng, SlotProps } from '@vendua/kernel';

// checkout.LocationPicker (Kernel 1.15, ADR 0024): a raster tile map under a fixed pin. The
// shopper drags the map until the pin sits on their door and confirms; Core prices that point.
// No map library: Web Mercator tiles in a grid of <img>, panned with pointer events.

const TILE = 256;
const MIN_ZOOM = 3;
const ZOOM_FOR: Record<SlotProps['checkout.LocationPicker']['precision'], number> = {
  address: 17,
  street: 16,
  postcode: 15,
  area: 14,
};
const KEY_STEP = 64;

const world = (z: number) => TILE * 2 ** z;

function project(p: LatLng, z: number) {
  const sin = Math.min(Math.max(Math.sin((p.lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((p.lng + 180) / 360) * world(z),
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world(z),
  };
}

function unproject(x: number, y: number, z: number): LatLng {
  const n = Math.PI - (2 * Math.PI * y) / world(z);
  const lng = (x / world(z)) * 360 - 180;
  return {
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    // keep longitude in range after panning across the antimeridian
    lng: ((((lng + 180) % 360) + 360) % 360) - 180,
  };
}

const tileUrl = (template: string, z: number, x: number, y: number) =>
  template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{s}', 'abc'[(x + y) % 3]!)
    .replace('{r}', '');

/** within ~1 m: the view still shows the confirmed point */
const same = (a: LatLng, b: LatLng | null) =>
  !!b && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

export function LocationPicker({
  center,
  precision,
  value,
  tiles,
  status,
  hint,
  error,
  onConfirm,
  onLocate,
  locateStatus,
}: SlotProps['checkout.LocationPicker']) {
  const maxZoom = Math.max(MIN_ZOOM, Math.min(tiles.maxZoom || 19, 20));
  const [view, setView] = useState(() => ({
    center,
    zoom: Math.min(ZOOM_FOR[precision], maxZoom),
  }));
  // a new place to look (the typed address, the device): the map moves there — the point just
  // confirmed is already in view, so confirming keeps the shopper's zoom
  useEffect(() => {
    setView((v) =>
      same(v.center, center) ? v : { center, zoom: Math.min(ZOOM_FOR[precision], maxZoom) },
    );
  }, [center.lat, center.lng, precision, maxZoom]);

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // pointers down on the map: one pans, two pinch-zoom
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; origin: { x: number; y: number } } | null>(null);
  const pinch = useRef<number | null>(null);

  const zoomBy = (d: number) =>
    setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, Math.min(maxZoom, v.zoom + d)) }));
  const panBy = (dx: number, dy: number) =>
    setView((v) => {
      const p = project(v.center, v.zoom);
      return { ...v, center: unproject(p.x + dx, p.y + dy, v.zoom) };
    });

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag.current = { x: e.clientX, y: e.clientY, origin: project(view.center, view.zoom) };
    pinch.current = spread();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) {
      const now = spread();
      if (now && pinch.current) {
        const ratio = now / pinch.current;
        if (ratio > 1.5 || ratio < 0.67) {
          zoomBy(ratio > 1 ? 1 : -1);
          pinch.current = now;
        }
      }
      return;
    }
    const d = drag.current;
    if (!d) return;
    const origin = d.origin;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setView((v) => ({ ...v, center: unproject(origin.x - dx, origin.y - dy, v.zoom) }));
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const single = pointers.current.size === 1;
    // a tap (no drag): bring the tapped spot under the pin
    if (e.type === 'pointerup' && single && d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) {
      const r = e.currentTarget.getBoundingClientRect();
      panBy(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    }
    pointers.current.delete(e.pointerId);
    pinch.current = spread();
    const rest = [...pointers.current.values()][0];
    // the finger left after a pinch pans from where it is now
    drag.current = rest ? { ...rest, origin: project(view.center, view.zoom) } : null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    if (pan[e.key]) panBy(...pan[e.key]!);
    else if (e.key === '+' || e.key === '=') zoomBy(1);
    else if (e.key === '-' || e.key === '_') zoomBy(-1);
    else return;
    e.preventDefault();
  };

  // the tiles that cover the box, positioned relative to its top-left corner
  const z = view.zoom;
  const c = project(view.center, z);
  const w = size.w || 320;
  const h = size.h || 240;
  const left = c.x - w / 2;
  const top = c.y - h / 2;
  const n = 2 ** z;
  const imgs = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
      const wrapped = ((tx % n) + n) % n;
      imgs.push(
        <img
          key={`${z}/${tx}/${ty}`}
          className="v-pin-tile"
          src={tileUrl(tiles.url, z, wrapped, ty)}
          alt=""
          draggable={false}
          decoding="async"
          // an unreachable tile leaves the map's own background, never a broken-image icon
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
          style={{ transform: `translate(${tx * TILE - left}px, ${ty * TILE - top}px)` }}
        />,
      );
    }
  }

  const moved = !same(view.center, value);
  const statusId = useId();
  const line =
    status === 'finding'
      ? 'Procurando o endereço no mapa…'
      : status === 'quoting'
        ? 'Calculando a entrega…'
        : status === 'out_of_zone'
          ? 'Esse local fica fora da área de entrega.'
          : status === 'error'
            ? 'Não deu para calcular a entrega agora. Tente confirmar de novo.'
            : status === 'confirmed' && !moved
              ? (hint ?? 'Local confirmado.')
              : 'Arraste o mapa até o pino ficar na sua porta e confirme.';
  const osm = /openstreetmap/i.test(tiles.attribution);

  return (
    <fieldset className="v-fieldset v-pin" data-part="root" data-status={status}>
      <legend className="v-legend">Confirme no mapa onde entregar</legend>
      <div
        ref={box}
        className="v-pin-map"
        data-part="map"
        role="application"
        tabIndex={0}
        aria-roledescription="mapa"
        aria-label="Mapa do local de entrega. Use as setas para mover e + ou − para aproximar."
        aria-describedby={statusId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <div className="v-pin-tiles" aria-hidden="true">
          {imgs}
        </div>
        <svg
          className="v-pin-marker"
          data-part="marker"
          data-moved={moved || undefined}
          viewBox="0 0 32 44"
          width="32"
          height="44"
          aria-hidden="true"
        >
          <path d="M16 43C16 43 30 26.6 30 15.5 30 7.5 23.7 1 16 1S2 7.5 2 15.5C2 26.6 16 43 16 43Z" />
          <circle cx="16" cy="15.5" r="5.5" />
        </svg>
        <div className="v-pin-zoom" data-part="zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-label="Aproximar"
            onClick={() => zoomBy(1)}
            disabled={z >= maxZoom}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Afastar"
            onClick={() => zoomBy(-1)}
            disabled={z <= MIN_ZOOM}
          >
            −
          </button>
        </div>
        <span
          className="v-pin-credit"
          data-part="attribution"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {osm ? (
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              {tiles.attribution}
            </a>
          ) : (
            tiles.attribution
          )}
        </span>
      </div>
      <p
        id={statusId}
        className="v-pin-status"
        role="status"
        data-part="status"
        data-tone={status === 'out_of_zone' || status === 'error' ? 'warn' : undefined}
      >
        {line}
      </p>
      {error ? (
        <p className="v-field-error" role="alert" data-part="error">
          {error}
        </p>
      ) : null}
      <div className="v-pin-actions" data-part="actions">
        <button
          type="button"
          className="v-btn v-btn-ghost"
          data-part="confirm"
          onClick={() => onConfirm(view.center)}
          disabled={status === 'quoting' || (status === 'confirmed' && !moved)}
          aria-busy={status === 'quoting' || undefined}
        >
          {status === 'confirmed' && !moved
            ? 'Local confirmado'
            : value
              ? 'Confirmar novo local'
              : 'Confirmar local'}
        </button>
        {onLocate ? (
          <button
            type="button"
            className="v-btn v-btn-ghost"
            data-part="locate"
            onClick={onLocate}
            disabled={locateStatus === 'pending'}
          >
            {locateStatus === 'pending' ? 'Localizando…' : 'Usar minha localização'}
          </button>
        ) : null}
      </div>
      {locateStatus === 'denied' ? (
        <p className="v-muted" role="status" data-part="locate-status">
          Sem acesso à localização — arraste o mapa até a sua porta.
        </p>
      ) : null}
    </fieldset>
  );
}
