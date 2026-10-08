// Pix "copia e cola" (BR Code, EMV QRCPS-MPM) built by Core from the store's key.
// Static by design: no PSP involved, so it works before payment capture (Phase 3).
// With an amount + txid the customer pays the exact order total, labelled by number.

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export interface PixProfile {
  key: string;
  keyType: PixKeyType;
  beneficiary: string;
  city: string;
}

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

// BR Code fields are ASCII-only; the payer's bank shows these verbatim
function ascii(s: string, max: number): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,\-/]/g, '')
    .trim()
    .slice(0, max)
    .toUpperCase();
}

/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF) — the BR Code checksum. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Normalizes a key to the form the DICT expects; null when it can't be a key of that type. */
export function normalizePixKey(key: string, type: PixKeyType): string | null {
  const k = key.trim();
  switch (type) {
    case 'cpf': {
      const d = k.replace(/\D/g, '');
      return d.length === 11 ? d : null;
    }
    case 'cnpj': {
      const d = k.replace(/\D/g, '');
      return d.length === 14 ? d : null;
    }
    case 'email':
      // the DICT caps an email key at 77 characters, and the BR Code is ASCII with a two-digit
      // length per field: a longer key makes a code every bank refuses
      return k.length <= 77 && /^[^\s@\x00-\x20\x7f-\uffff]{1,64}@[^\s@\x00-\x20\x7f-\uffff]{1,72}\.[a-z]{2,}$/i.test(k)
        ? k.toLowerCase()
        : null;
    case 'phone': {
      const d = k.replace(/\D/g, '');
      const national = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
      return national.length === 10 || national.length === 11 ? `+55${national}` : null;
    }
    case 'random':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)
        ? k.toLowerCase()
        : null;
  }
}

export function pixPayload(
  profile: PixProfile,
  opts: { amountCents?: number; txid?: string } = {},
): string {
  const account = field('00', 'br.gov.bcb.pix') + field('01', profile.key);
  const txid = (opts.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  let out =
    field('00', '01') +
    (opts.amountCents ? field('01', '12') : '') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (opts.amountCents ? field('54', (opts.amountCents / 100).toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', ascii(profile.beneficiary, 25) || 'LOJA') +
    field('60', ascii(profile.city, 15) || 'BRASIL') +
    field('62', field('05', txid));
  out += '6304';
  return out + crc16(out);
}
