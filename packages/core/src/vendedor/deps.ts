import type { ModelGateway } from '@vendua/agent-runtime';
import type { CepLookup } from '../modules/geo.ts';
import type { PaymentProvider } from '../modules/payments/provider.ts';
import type { Sql } from '../platform/db.ts';

// What the Vendedor's tools need from the process that runs them: set once at boot by
// `index.ts` (and by tests), read by the tools. Nothing here is per-store.

export interface VendedorDeps {
  /** the pool, for calls that open their own transactions (preparePayment) */
  sql?: Sql | undefined;
  provider?: PaymentProvider | undefined;
  /** the model gateway, for the admin's suggested replies */
  gateway?: ModelGateway | undefined;
  /** signs cart session tokens; the agent's carts never leave Core, but the row needs one */
  sessionSecret: string;
  storeDomain: string;
  /** where payment providers send the shopper back (the admin's or the store's origin) */
  publicOrigin?: string | null;
  /** CEP → bairro, for delivery quotes from a CEP (ViaCEP unless a test sets one) */
  cepLookup?: CepLookup | undefined;
  /** a geocoder for typed addresses, when the store prices by distance */
  geocode?:
    | ((q: {
        street?: string;
        number?: string;
        neighborhood?: string;
        city?: string;
        cep?: string;
      }) => Promise<{ lat: number; lng: number } | null>)
    | null;
}

let deps: VendedorDeps = {
  sessionSecret: process.env.SESSION_SECRET ?? 'vendedor-dev',
  storeDomain: process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
};

export function configureVendedor(d: Partial<VendedorDeps>): void {
  deps = { ...deps, ...d };
}

export function vendedorDeps(): VendedorDeps {
  return deps;
}
