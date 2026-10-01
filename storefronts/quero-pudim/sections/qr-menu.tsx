import { ArrowLeft, Download, Instagram, MessageCircle, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  defineSection,
  image,
  text,
  url,
  useCatalog,
  useStore,
  type SectionProps,
} from '@vendua/kernel';
import { formatBRL } from './_shared/format.ts';

/** Cardápio QR — printable A4 sheet; QR generated client-side via the `qrcode` package, Core only supplies products + contacts. */
export const schema = defineSection({
  type: 'store:qr-menu',
  settings: {
    logo: image({ default: '/brand/logo-principal.png' }),
    catalogPath: url({ default: '/catalog' }),
    title: text({ max: 60, default: '' }),
    subtitle: text({ max: 160 }),
    featuredLabel: text({ max: 40 }),
    hint: text({ max: 80 }),
    slogan: text({ max: 80 }),
    fileName: text({ max: 40, default: 'qrcode' }),
  },
});

function buildTarget(baseUrl: string, slug: string, catalogPath: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return slug ? `${base}/produto/${encodeURIComponent(slug)}` : `${base}${catalogPath}`;
}

export default function QrMenu({ settings: s }: SectionProps<typeof schema>) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { categories } = useCatalog();
  const { store } = useStore();

  const [baseUrl, setBaseUrl] = useState(() => window.location.origin);
  const [svg, setSvg] = useState('');
  const [dataUrl, setDataUrl] = useState('');
  const [qrLoading, setQrLoading] = useState(true);
  const [qrError, setQrError] = useState<string | null>(null);

  const products = useMemo(() => categories.flatMap((c) => c.products), [categories]);
  const selectedSlug = searchParams.get('produto') ?? '';
  const selected = products.find((p) => p.slug === selectedSlug) ?? null;
  const target = buildTarget(baseUrl, selectedSlug, s.catalogPath);
  const shortUrl = target.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  useEffect(() => {
    let active = true;
    setQrLoading(true);
    setQrError(null);
    Promise.all([
      QRCode.toDataURL(target, { width: 800, margin: 1, errorCorrectionLevel: 'H' }),
      QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'H' }),
    ])
      .then(([png, svgString]) => {
        if (!active) return;
        setDataUrl(png);
        setSvg(svgString);
        setQrLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setQrError('Não foi possível gerar o código QR.');
        setQrLoading(false);
      });
    return () => {
      active = false;
    };
  }, [target]);

  const instagram = store?.instagram?.replace(/^@/, '');
  const whatsapp = store?.whatsapp?.replace(/\D/g, '');
  const where = [store?.address, store?.city].filter(Boolean).join(' · ');

  return (
    <div className="qr-page">
      <header className="qr-controls" role="toolbar" aria-label="Ações do QR">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(s.catalogPath))}
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
            value={selectedSlug}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value) next.set('produto', e.target.value);
              else next.delete('produto');
              setSearchParams(next, { replace: true });
            }}
          >
            <option value="">Cardápio completo</option>
            {products.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ height: 44, maxWidth: 220 }}
            aria-label="Endereço base do link"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {dataUrl ? (
            <a
              href={dataUrl}
              download={`${s.fileName}-${selectedSlug || 'cardapio'}.png`}
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
              {selected ? (
                <div style={{ marginBottom: 8 }}>
                  {s.featuredLabel ? <span className="qr-chip">{s.featuredLabel}</span> : null}
                  <h2 className="display display-md" style={{ marginTop: 4 }}>
                    {selected.name}
                  </h2>
                  {selected.description ? (
                    <p className="small muted qr-desc">{selected.description}</p>
                  ) : null}
                  <p
                    className="display display-md"
                    style={{ color: 'var(--caramel-800)', marginTop: 4 }}
                  >
                    {selected.fromPriceCents != null ? (
                      <small style={{ fontSize: '0.5em', fontWeight: 500 }}>a partir de </small>
                    ) : null}
                    {formatBRL(selected.fromPriceCents ?? selected.basePriceCents)}
                  </p>
                </div>
              ) : (
                <div style={{ marginBottom: 8 }}>
                  <h2 className="display display-md">{s.title}</h2>
                  {s.subtitle ? <p className="small muted">{s.subtitle}</p> : null}
                </div>
              )}

              <div className="qr-box">
                {qrLoading ? (
                  <div className="qr-placeholder">Gerando QR Code…</div>
                ) : qrError ? (
                  <div className="qr-placeholder" style={{ color: 'var(--danger)' }}>
                    {qrError}
                  </div>
                ) : svg ? (
                  <div className="qr-svg" dangerouslySetInnerHTML={{ __html: svg }} />
                ) : null}
              </div>

              <p className="qr-url">{shortUrl}</p>
              {s.hint ? <p className="qr-hint">{s.hint}</p> : null}
            </div>

            <div style={{ width: '100%' }}>
              <div className="ficha-hairline" style={{ paddingTop: 12 }} />
              <p className="qr-contacts">
                {whatsapp ? (
                  <span>
                    <MessageCircle size={12} aria-hidden="true" /> WhatsApp: {whatsapp}
                  </span>
                ) : null}
                {instagram ? (
                  <span>
                    <Instagram size={12} aria-hidden="true" /> @{instagram}
                  </span>
                ) : null}
                {where ? <span>{where}</span> : null}
              </p>
              {s.slogan ? <p className="qr-slogan">{s.slogan}</p> : null}
            </div>
          </div>
        </article>
        <p className="qr-controls small muted" style={{ marginTop: 24, textAlign: 'center' }}>
          <Link to={s.catalogPath} style={{ textDecoration: 'underline' }}>
            ← Voltar ao cardápio
          </Link>
        </p>
      </div>
    </div>
  );
}
