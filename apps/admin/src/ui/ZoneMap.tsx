import { useEffect, useRef } from 'react';
import type { Zone } from '../lib/api.ts';
import 'leaflet/dist/leaflet.css';

// Delivery area on a real map (§7 ZoneMap): the store pin and a ring per radius
// zone, labelled with its fee. Bairro zones are listed beside it — Core keeps them
// as names, not shapes. Leaflet only loads on Loja (its own chunk).

export function ZoneMap({
  center,
  zones,
  onPick,
  className,
}: {
  center: { latitude: number; longitude: number } | null;
  zones: Zone[];
  onPick?: ((p: { latitude: number; longitude: number }) => void) | undefined;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import('leaflet').Map | null>(null);
  const layer = useRef<import('leaflet').LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    let dead = false;
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
      m.on('click', (e) => pick.current?.({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
      map.current = m;
      layer.current = L.layerGroup().addTo(m);
      draw(L);
    });
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
    // mount once; draw() below follows the data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = (L: typeof import('leaflet')) => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    if (!center) return;
    const c: [number, number] = [center.latitude, center.longitude];
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--primary').trim() || '#123c32';
    const radius = zones
      .filter((z) => z.kind === 'radius' && z.maxDistanceKm && z.active)
      .sort((a, b) => b.maxDistanceKm! - a.maxDistanceKm!);
    for (const z of radius) {
      L.circle(c, {
        radius: z.maxDistanceKm! * 1000,
        color: ink,
        weight: 2,
        fillColor: '#d9f875',
        fillOpacity: 0.12,
      })
        .bindTooltip(`${z.name}: até ${z.maxDistanceKm} km`, { sticky: true })
        .addTo(g);
    }
    L.circleMarker(c, { radius: 9, color: '#fffdf8', weight: 3, fillColor: ink, fillOpacity: 1 })
      .bindTooltip('sua loja')
      .addTo(g);
    if (radius[0])
      map.current?.fitBounds(
        L.latLng(c)
          .toBounds(radius[0].maxDistanceKm! * 2000)
          .pad(0.1),
        { animate: false },
      );
    else map.current?.setView(c, 14);
  };

  useEffect(() => {
    void import('leaflet').then((L) => draw(L));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.latitude, center?.longitude, JSON.stringify(zones)]);

  return (
    <div
      ref={el}
      role="application"
      aria-label={onPick ? 'mapa: toque para marcar onde fica a loja' : 'mapa da área de entrega'}
      className={className ?? 'h-72 w-full overflow-hidden rounded-lg ring-1 ring-line'}
    />
  );
}
