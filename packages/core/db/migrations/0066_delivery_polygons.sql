-- Model gap 6 — delivery polygons: kind='polygon' serves addresses inside `polygon`, a ring of
-- [[lat, lng], ...] (3..200 vertices, closing vertex not repeated). Vertex bounds and
-- degenerate shapes are validated in Core; the checks here keep kind and polygon coherent.

alter table delivery_zones drop constraint if exists delivery_zones_kind_check;
alter table delivery_zones
  add constraint delivery_zones_kind_check check (kind in ('neighborhood', 'radius', 'polygon'));

alter table delivery_zones add column if not exists polygon jsonb;

alter table delivery_zones drop constraint if exists delivery_zones_polygon_check;
alter table delivery_zones
  add constraint delivery_zones_polygon_check check (
    (kind = 'polygon') = (polygon is not null)
    and case
      when jsonb_typeof(polygon) = 'array' then jsonb_array_length(polygon) between 3 and 200
      else polygon is null
    end
  );
