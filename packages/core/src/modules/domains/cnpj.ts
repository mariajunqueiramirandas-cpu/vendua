import type { CnpjLookup, CnpjRecord, HolderAddress } from './providers.ts';
import { readJsonCapped } from './rdap.ts';

// BrasilAPI's mirror of the Receita Federal's public CNPJ record: the registry checks the holder's
// legal name and address against it, so the purchase form starts from it.

const BASE = 'https://brasilapi.com.br/api/cnpj/v1/';
const TIMEOUT_MS = 6_000;
const MAX_BODY = 64 * 1024;

type Json = Record<string, unknown>;

const str = (v: unknown, n: number) =>
  typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, n) : '';

export function parseCnpj(body: unknown): CnpjRecord | null {
  if (!body || typeof body !== 'object') return null;
  const j = body as Json;
  const name = str(j.razao_social, 200);
  if (!name) return null;
  const kind = str(j.descricao_tipo_de_logradouro, 40);
  const street = str(j.logradouro, 200);
  const fullStreet =
    kind && !street.toUpperCase().startsWith(kind.toUpperCase()) ? `${kind} ${street}` : street;
  const city = str(j.municipio, 100);
  const state = str(j.uf, 2).toUpperCase();
  const digits = str(j.cep, 12).replace(/\D/g, '');
  const postalCode = digits && digits.length <= 8 ? digits.padStart(8, '0') : '';
  const complement = str(j.complemento, 100);
  const address: HolderAddress | null =
    street && city && /^[A-Z]{2}$/.test(state) && postalCode
      ? {
          street: fullStreet,
          number: str(j.numero, 20) || 'S/N',
          ...(complement ? { complement } : {}),
          district: str(j.bairro, 100),
          city,
          state,
          postalCode,
        }
      : null;
  return { name, address };
}

export function brasilApiCnpj(o: { fetchImpl?: typeof fetch } = {}): CnpjLookup {
  const doFetch = o.fetchImpl ?? fetch;
  return async (cnpj) => {
    const d = cnpj.replace(/[.\-/\s]/g, '');
    // BrasilAPI only knows numeric CNPJs
    if (!/^\d{14}$/.test(d)) return null;
    try {
      const res = await doFetch(`${BASE}${d}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      return parseCnpj(await readJsonCapped(res, MAX_BODY));
    } catch {
      return null;
    }
  };
}
