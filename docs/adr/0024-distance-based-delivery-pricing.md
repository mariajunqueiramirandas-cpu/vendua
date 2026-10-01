# ADR 0024: Delivery priced by road distance from a confirmed pin

- Status: Accepted (implemented 2026-10-01, Core migration 0073, Kernel 1.15)
- Date: 2026-10-01

## Context

Delivery fees came only from `delivery_zones`: a bairro name, a polygon drawn in the admin, or
a radius from the store measured in a straight line. In practice all three price badly:

- Core never knew where the customer was unless their phone shared its location. ViaCEP turns a
  CEP into a street and a bairro, never coordinates, so a typed address matched only by bairro
  name.
- A radius is a straight line. Across a river, a lagoon or a highway the drive can be twice as
  long, and the store charges the short price.
- Merchants maintain lists of bairros and hand-drawn shapes that drift from where they really
  deliver.

The merchant wants the fee to follow the trip: the store's location, the customer's door, the
route between them, and a price per km. Nobody wants a paid provider or a heavy server for
geocoding and routing.

## Decision

**The customer confirms the door on a map; that point is what gets priced.** Free geocoders are
weak on Brazilian house numbers, so geocoding is only used to open the map in the right area:
Core places the typed address (`GET /storefront/v1/geocode`, OpenStreetMap's public Nominatim:
1 request/second, an identifying User-Agent, cached), the shopper drags the map until the pin is
on their door, or uses the device's location, and confirms. "Lembrar meus dados" keeps the pin,
so a returning customer doesn't confirm it again. The store's own pin is set the same way in the
admin (`GET /admin/v1/geocode` from the store's address, then a tap on the map).

**Road distance from a free hosted router, with a straight-line fallback.** Core asks
OpenRouteService's free API (`ORS_API_KEY`, driving-car) for store → pin. Without a key, while
the free quota is exhausted, or when the provider fails, Core uses the straight line × 1.3
(`DETOUR_FACTOR`) and marks the distance `'estimate'`. A failure pauses calls for a minute, and
legs are cached in memory for 30 days. Routing never blocks checkout.

**One store-level price rule.** `store_settings.distance_pricing` with `delivery_base_fee_cents`,
`delivery_fee_per_km_cents` (every started km counts), `delivery_min_fee_cents`,
`delivery_max_km` and `delivery_free_over_cents`:
`fee = max(min, base + ceil(km) × per_km)`, free at or above the threshold, refused
(`OUT_OF_ZONE`) past the maximum. ETA = the store's prep time + the drive (estimated at
25 km/h without a route). It is off by default and can't be on without the store's pin.
Turning it on doesn't delete zones: they only price an address that arrives without a pin.

**Quote once, charge that quote.** The external call is made before the request's transaction
(an HTTP call never holds one open) on `POST /checkout/v1/quote`, `/cart/delivery` and
`/checkout`. `POST /cart/delivery` stores the leg on the cart (`carts.delivery_route`: from,
to, meters, seconds). Checkout prefers the stored leg when its store and pin still match to
~1 m, so the order charges the distance the shopper saw, even if the provider is down or would
now answer differently. `resolveDelivery` (`modules/geo.ts`) is the single pricing entry point
for the cart view, the quote and checkout. Distance pricing is a virtual zone
(`id: 'distance'`, `kind: 'distance'`), so the free-delivery threshold, minimum order, coupons
and order snapshot work unchanged.

**A Kernel-owned map, no map library.** The Kernel's new `checkout.LocationPicker` slot defaults
to a ~300-line raster tile map under a fixed pin: drag, tap, pinch, + / − and arrow keys. Core
hands it the tiles (`StoreProfile.distancePricing.tiles`, `MAP_TILE_URL`; OpenStreetMap's own
tiles by default), so the provider can change without a Kernel release. A vector map
(MapLibre + OpenFreeMap) would have cost ~220 KB gzip and WebGL.

## Consequences

- Prices follow the road, and merchants stop maintaining bairro lists. Existing stores see no
  change until they turn it on.
- The free services have rules: Nominatim allows 1 request/second per process (the queue gives
  up after 3 s and the map opens on the store instead); ORS's free plan has a daily quota.
  Beyond that, the estimate takes over. OpenStreetMap's tile servers discourage heavy
  commercial use, so as traffic grows, point `MAP_TILE_URL` at a commercial or self-hosted
  raster source. Each of these is one env var (`NOMINATIM_URL`, `ORS_URL`, `MAP_TILE_URL`).
- The tile server, and Nominatim through Core, see the shopper's area. The checkout already
  needed the address. The pin is stored with the cart (`carts.delivery`, and `delivery_route.to`)
  and the order like the address, and customer erasure strips it from orders (`lat`/`lng`) the
  same way.
- An order's `delivery.distanceSource` says whether its fee came from a route or the estimate.
- The control-plane copy of the commerce settings (`/control/v1/storefronts/:slug/commerce`)
  does not edit distance pricing yet; the merchant admin does.
