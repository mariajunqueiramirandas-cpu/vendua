import { useEffect, useRef } from 'react';
import type { Zone } from '../lib/api.ts';
import 'leaflet/dist/leaflet.css';

// Delivery area on a real map (§7 ZoneMap): the store pin, a ring per radius zone and
// the drawn areas, labelled with their fee. Bairro zones are listed beside it — Core
// keeps them as names, not shapes. Leaflet only loads on Loja (its own chunk).
// With `onPolygonChange` it edits one drawn area: a tap adds a corner, a drag moves one.

export type LatLng = [number, number];

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function ZoneMap({
  center,
  zones,
  onPick,
  polygon,
  onPolygonChange,
  className,
  label,
}: {
  center: { latitude: number; longitude: number } | null;
  zones: Zone[];
  onPick?: ((p: { latitude: number; longitude: number }) => void) | undefined;
  /** the area being drawn ([lat, lng] corners, ring not closed) */
  polygon?: LatLng[] | undefined;
  onPolygonChange?: ((p: LatLng[]) => void) | undefined;
  className?: string;
  label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import('leaflet').Map | null>(null);
  const layer = useRef<import('leaflet').LayerGroup | null>(null);
  const edit = useRef<import('leaflet').LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const shape = useRef({ polygon, onPolygonChange });
  shape.current = { polygon, onPolygonChange };
  const editing = !!onPolygonChange;

  useEffect(() => {
    let dead = false;
    let ro: ResizeObserver | null = null;
    void import('leaflet').then((L) => {
      if (dead || !el.current || map.current) return;
      const c: [number, number] = center ? [center.latitude, center.longitude] : [-22.93, -42.51];
      const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(
        c,
        center ? 13 : 11,
      );
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap',
      }).addTo(m);
      m.on('click', (e) => {
        const s = shape.current;
        if (s.onPolygonChange) {
          if ((s.polygon?.length ?? 0) >= 200) return;
          s.onPolygonChange([...(s.polygon ?? []), [round6(e.latlng.lat), round6(e.latlng.lng)]]);
          return;
        }
        pick.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng });
      });
      map.current = m;
      layer.current = L.layerGroup().addTo(m);
      edit.current = L.layerGroup().addTo(m);
      // inside a sheet the box settles after the slide-in: re-measure
      ro = new ResizeObserver(() => m.invalidateSize());
      ro.observe(el.current);
      draw(L);
      drawEdit(L, true);
    });
    return () => {
      dead = true;
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // mount once; draw() below follows the data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colors = () => {
    const css = getComputedStyle(document.documentElement);
    return {
      ink: css.getPropertyValue('--primary').trim() || '#123c32',
      spark: css.getPropertyValue('--spark').trim() || '#d9f875',
      paper: css.getPropertyValue('--surface').trim() || '#fffdf8',
    };
  };

  const draw = (L: typeof import('leaflet')) => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const { ink, spark, paper } = colors();
    const bounds = L.latLngBounds([]);
    const shapes = zones
      .filter((z) => z.kind === 'polygon' && z.polygon && z.polygon.length >= 3 && z.active)
      .map((z) => ({ z, ring: z.polygon! }));
    for (const { z, ring } of shapes) {
      L.polygon(ring, {
        color: ink,
        weight: 2,
        dashArray: editing ? '4 6' : undefined,
        fillColor: spark,
        fillOpacity: editing ? 0.06 : 0.14,
        interactive: !editing,
      })
        .bindTooltip(z.name, { sticky: true })
        .addTo(g);
      for (const p of ring) bounds.extend(p);
    }
    if (center) {
      const c: [number, number] = [center.latitude, center.longitude];
      const radius = zones
        .filter((z) => z.kind === 'radius' && z.maxDistanceKm && z.active)
        .sort((a, b) => b.maxDistanceKm! - a.maxDistanceKm!);
      for (const z of radius) {
        L.circle(c, {
          radius: z.maxDistanceKm! * 1000,
          color: ink,
          weight: 2,
          dashArray: editing ? '4 6' : undefined,
          fillColor: spark,
          fillOpacity: editing ? 0.05 : 0.12,
          interactive: !editing,
        })
          .bindTooltip(`${z.name}: até ${z.maxDistanceKm} km`, { sticky: true })
          .addTo(g);
      }
      L.circleMarker(c, {
        radius: 9,
        color: paper,
        weight: 3,
        fillColor: ink,
        fillOpacity: 1,
        interactive: !editing,
      })
        .bindTooltip('sua loja')
        .addTo(g);
      if (radius[0]) bounds.extend(L.latLng(c).toBounds(radius[0].maxDistanceKm! * 2000));
      else bounds.extend(c);
    }
    if (editing) return; // the editor frames its own area once
    if (!bounds.isValid()) return;
    // just the store pin: a street-level view around it
    if (bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < 1)
      map.current?.setView(bounds.getCenter(), 14);
    else map.current?.fitBounds(bounds.pad(0.1), { animate: false });
  };

  const drawEdit = (L: typeof import('leaflet'), first = false) => {
    const g = edit.current;
    if (!g) return;
    g.clearLayers();
    const ring = shape.current.polygon ?? [];
    if (!shape.current.onPolygonChange) return;
    const { ink, spark, paper } = colors();
    const outline =
      ring.length >= 3
        ? L.polygon(ring, { color: ink, weight: 3, fillColor: spark, fillOpacity: 0.3 })
        : L.polyline(ring, { color: ink, weight: 3 });
    outline.addTo(g);
    ring.forEach((p, i) => {
      const dot = L.marker(p, {
        draggable: true,
        keyboard: false,
        title: `ponto ${i + 1}`,
        icon: L.divIcon({
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          // a 28px hit area around a 16px dot: easy to grab with a thumb
          html: `<span style="display:grid;place-items:center;width:28px;height:28px;cursor:grab"><span style="width:16px;height:16px;border-radius:9999px;background:${i === 0 ? spark : paper};border:3px solid ${ink}"></span></span>`,
        }),
      });
      dot.on('drag', () => {
        const ll = dot.getLatLng();
        const next = ring.map((q, k) => (k === i ? ([ll.lat, ll.lng] as LatLng) : q));
        (outline as import('leaflet').Polyline).setLatLngs(next);
      });
      dot.on('dragend', () => {
        const ll = dot.getLatLng();
        shape.current.onPolygonChange?.(
          ring.map((q, k) => (k === i ? ([round6(ll.lat), round6(ll.lng)] as LatLng) : q)),
        );
      });
      dot.addTo(g);
    });
    if (first) {
      if (ring.length >= 2)
        map.current?.fitBounds(L.latLngBounds(ring).pad(0.25), { animate: false });
      else if (center) map.current?.setView([center.latitude, center.longitude], 14);
    }
  };

  useEffect(() => {
    void import('leaflet').then((L) => draw(L));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.latitude, center?.longitude, JSON.stringify(zones)]);

  useEffect(() => {
    void import('leaflet').then((L) => drawEdit(L));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(polygon), editing]);

  return (
    <div
      ref={el}
      role="application"
      // a drag on the map moves the map (or a corner), never the sheet around it
      data-vaul-no-drag=""
      aria-label={
        label ??
        (editing
          ? 'mapa: toque para marcar os cantos da área de entrega'
          : onPick
            ? 'mapa: toque para marcar onde fica a loja'
            : 'mapa da área de entrega')
      }
      className={className ?? 'h-72 w-full overflow-hidden rounded-lg ring-1 ring-line'}
    />
  );
}
