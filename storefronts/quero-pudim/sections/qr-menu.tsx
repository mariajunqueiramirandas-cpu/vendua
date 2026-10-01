import { ArrowLeft, Download, Instagram, MessageCircle, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  QrCode,
  cardState,
  defineSection,
  image,
  priceDisplay,
  qrSvg,
  text,
  useLinks,
  useMenu,
  useMoney,
  useStore,
  type SectionProps,
} from '@vendua/kernel';

/** Cardápio QR — printable A4 sheet. The link is the store's public URL (Core's `publicUrl`), the
 *  code the Kernel's encoder; Core supplies the products and contacts. */
export const schema = defineSection({
  type: 'store:qr-menu',
  settings: {
    logo: image({ default: '/brand/logo-principal.png' }),
    title: text({ max: 60, default: '' }),
    subtitle: text({ max: 160 }),
    featuredLabel: text({ max: 40 }),
    hint: text({ max: 80 }),
    slogan: text({ max: 80 }),
    fileName: text({ max: 40, default: 'qrcode' }),
  },
});

const PNG_SIZE = 800;

/** The same code as a PNG, for the download link. */
async function pngOf(value: string): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(value, { size: PNG_SIZE }))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PNG_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, PNG_SIZE, PNG_SIZE);
  return canvas.toDataURL('image/png');
}

export default function QrMenu({ settings: s }: SectionProps<typeof schema>) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { categories, loading } = useMenu();
  const { store } = useStore();
  const links = useLinks();
  const money = useMoney();
  const { whatsapp, instagram } = links.contacts;

  const products = useMemo(() => categories.flatMap((c) => c.products), [categories]);
  const selectedSlug = searchParams.get('produto') ?? '';
  const selected = products.find((p) => p.slug === selectedSlug) ?? null;
  // a product link waits for the menu; an unknown slug prints the menu, not a dead page
  const waiting = loading && selectedSlug !== '' && !selected;
  const target = links.absolute(selected ? links.product(selected.slug) : links.catalog);
  const shortUrl = target.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const cut = shortUrl.indexOf('/');
  const price = selected ? priceDisplay(selected) : null;

  const [png, setPng] = useState<{ value: string; url: string } | null>(null);
  useEffect(() => {
    if (waiting) return;
    let active = true;
    pngOf(target).then(
      (url) => active && setPng({ value: target, url }),
      () => active && setPng(null),
    );
    return () => {
      active = false;
    };
  }, [target, waiting]);

  const where = [store?.address, store?.city].filter(Boolean).join(' · ');

  return (
    <div className="qr-page">
      <header className="qr-controls" role="toolbar" aria-label="Ações do QR">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(links.catalog))}
        >
          <ArrowLeft size={16} aria-hidden="true" /> Voltar
        </button>
        <div className="qr-controls-mid">
          <label htmlFor="qr-produto" className="small" style={{ fontWeight: 500 }}>
            Doce:
          </label>
          <select
            id="qr-produto"
            className="input"
            style={{ height: 44, maxWidth: 260 }}
            value={selected?.slug ?? ''}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value) next.set('produto', e.target.value);
              else next.delete('produto');
              setSearchParams(next, { replace: true });
            }}
          >
            <option value="">Cardápio completo</option>
            {categories.map((c) => (
              <optgroup key={c.id} label={c.name}>
                {c.products.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {cardState(p, null).soldOut ? `${p.name} (esgotado)` : p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {png && png.value === target ? (
            <a
              href={png.url}
              download={`${s.fileName}-${selected?.slug || 'cardapio'}.png`}
              className="btn btn-ghost"
            >
              <Download size={16} aria-hidden="true" /> Baixar PNG
            </a>
          ) : null}
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" /> Imprimir (A4)
          </button>
        </div>
      </header>

      <div className="qr-stage">
        <article className="qr-sheet" aria-label="Cardápio para impressão A4">
          <div className="qr-sheet-inner">
            <div style={{ textAlign: 'center' }}>
              <img src={s.logo} alt={store?.name ?? ''} className="qr-logo" />
              {store?.tagline ? <p className="qr-tagline">{store.tagline}</p> : null}
              <div className="qr-divider" aria-hidden="true">
                <span />◆<span />
              </div>
            </div>

            <div style={{ textAlign: 'center' }}>
              {selected && price ? (
                <div style={{ marginBottom: 8 }}>
                  {s.featuredLabel ? <span className="qr-chip">{s.featuredLabel}</span> : null}
                  <h2 className="display display-md" style={{ marginTop: 4 }}>
                    {selected.name}
                  </h2>
                  {selected.description ? (
                    <p className="small muted qr-desc">{selected.description}</p>
                  ) : null}
                  <p className="display display-md qr-price" data-form={price.form}>
                    {price.struckCents !== null ? (
                      <s className="qr-was">{money(price.struckCents)}</s>
                    ) : null}
                    {price.form === 'from' ? <small className="qr-from">a partir de </small> : null}
                    {money(price.cents)}
                  </p>
                  {price.promoLabel ? (
                    <p className="qr-promo">Promoção · {price.promoLabel}</p>
                  ) : null}
                </div>
              ) : (
                <div style={{ marginBottom: 8 }}>
                  <h2 className="display display-md">{s.title}</h2>
                  {s.subtitle ? <p className="small muted">{s.subtitle}</p> : null}
                </div>
              )}

              <div className="qr-box">
                {waiting ? (
                  <div className="qr-placeholder">Gerando QR Code…</div>
                ) : (
                  <div className="qr-svg">
                    <QrCode value={target} title={`QR Code: ${shortUrl}`} />
                  </div>
                )}
              </div>

              {/* host and path wrap as units on a narrow sheet, never at a hyphen */}
              <p className="qr-url">
                {cut > 0 ? (
                  <>
                    <span>{shortUrl.slice(0, cut)}</span>
                    <span>{shortUrl.slice(cut)}</span>
                  </>
                ) : (
                  shortUrl
                )}
              </p>
              {s.hint ? <p className="qr-hint">{s.hint}</p> : null}
            </div>

            <div style={{ width: '100%' }}>
              <div className="ficha-hairline" style={{ paddingTop: 12 }} />
              <p className="qr-contacts">
                {whatsapp ? (
                  <span>
                    <MessageCircle size={12} aria-hidden="true" /> WhatsApp: {whatsapp.display}
                  </span>
                ) : null}
                {instagram ? (
                  <span>
                    <Instagram size={12} aria-hidden="true" /> @{instagram.handle}
                  </span>
                ) : null}
                {where ? <span>{where}</span> : null}
              </p>
              {s.slogan ? <p className="qr-slogan">{s.slogan}</p> : null}
            </div>
          </div>
        </article>
        <p className="qr-controls small muted" style={{ marginTop: 24, textAlign: 'center' }}>
          <Link to={links.catalog} style={{ textDecoration: 'underline' }}>
            ← Voltar ao cardápio
          </Link>
        </p>
      </div>
    </div>
  );
}
