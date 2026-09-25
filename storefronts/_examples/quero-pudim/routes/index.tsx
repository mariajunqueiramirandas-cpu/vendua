import { Heart, Snowflake, Truck, Utensils, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCatalog, useStore } from '@vendua/kernel';
import { Price } from './_components/Price.tsx';
import { ProductFigure, type FigureVariant } from './_components/ProductFigure.tsx';
import { Skeleton } from './_components/Skeleton.tsx';

const FEATURED_LIMIT = 4;

const twoDigits = (n: number) => String(n).padStart(2, '0');

const VALUES = [
  {
    icon: Heart,
    title: 'Feito à mão, de verdade',
    description: 'Receita de família, sem atalho e sem pó.',
  },
  {
    icon: Snowflake,
    title: 'Cremoso de verdade',
    description: 'Pudim lisinho e sacolé que derrete na boca.',
  },
  { icon: Truck, title: 'Pertinho de você', description: 'Retire em Saquarema ou receba em casa.' },
];

const STEPS = [
  {
    icon: Utensils,
    title: 'Escolha seus doces',
    description: 'Monte a sacola com pudins e sacolés.',
  },
  {
    icon: ShieldCheck,
    title: 'Confirme o pedido',
    description: 'Escolha entrega ou retirada na loja.',
  },
  {
    icon: Snowflake,
    title: 'Receba geladinho',
    description: 'A gente embala com cuidado e leva até você.',
  },
];

export function LandingPage() {
  const { store } = useStore();
  const { categories, loading } = useCatalog();
  const featured = categories
    .flatMap((c) => c.products)
    .filter((p) => p.status === 'active')
    .slice(0, FEATURED_LIMIT);
  // combos don't exist in Core — the seeded "Kits" category carries them
  const kits = categories.find((c) => (c as { slug?: string }).slug === 'kits')?.products ?? [];
  const city = store?.city ?? 'Saquarema · RJ';

  // /#nossa-historia — BrowserRouter does not scroll to anchors on its own.
  useEffect(() => {
    if (window.location.hash !== '#nossa-historia') return;
    const el = document.getElementById('nossa-historia');
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' });
  }, []);

  return (
    <main>
      <section className="container" style={{ paddingBlock: '40px 48px' }}>
        <p className="eyebrow rise-in rise-in-1">Feito à mão em {city}</p>
        <div className="hero-grid" style={{ marginTop: 16 }}>
          <div>
            <h1 className="display display-xl rise-in rise-in-2">
              Seu dia merece
              <br />
              <em>um doce de verdade.</em>
            </h1>
            <p className="hero-sub rise-in rise-in-3">
              Pudim lisinho, sem furinho, calda dourada no ponto. Sacolé bem cremoso para o calor —
              feito à mão, para saborear sem pressa.
            </p>
            <div className="hero-cta rise-in rise-in-4">
              <Link to="/catalog" className="btn">
                Escolher meu doce
              </Link>
              <a href="#nossa-historia" className="btn-ghost">
                Nossa história
              </a>
            </div>
          </div>
          <figure className="hero-fig rise-in rise-in-3">
            <div className="print-frame">
              <div className="card-frame" style={{ aspectRatio: '4/3' }}>
                <img
                  src="/images/hero-pudim-real.webp"
                  alt="Confeiteira da Quero Pudim segurando um pudim embalado com a etiqueta da marca"
                  fetchPriority="high"
                  decoding="async"
                />
              </div>
            </div>
            <figcaption>
              <span className="fig-title">Receita de família</span>
              <span className="fig-sub">Cada um feito à mão, um por um.</span>
            </figcaption>
          </figure>
        </div>

        <dl
          className="values-grid ficha-rule"
          style={{ marginTop: 56, paddingTop: 24, marginBottom: 0 }}
        >
          {VALUES.map((v) => (
            <div key={v.title}>
              <v.icon className="value-icon" strokeWidth={1.5} aria-hidden="true" />
              <dt>{v.title}</dt>
              <dd>{v.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="container ficha-rule" style={{ paddingBlock: '32px 64px' }}>
        <div className="section-head">
          <p className="eyebrow">Ficha do dia</p>
          <h2 className="display display-lg">Direto da nossa cozinha</h2>
          <p className="lede">Pudins e sacolés escolhidos a dedo para hoje.</p>
        </div>
        {loading && featured.length === 0 ? (
          <div className="card-grid" aria-busy="true" aria-label="Carregando destaques">
            {Array.from({ length: FEATURED_LIMIT }, (_, i) => (
              <div key={i}>
                <Skeleton style={{ aspectRatio: '1', width: '100%' }} />
                <div style={{ paddingTop: 12, display: 'grid', gap: 8 }}>
                  <Skeleton style={{ height: 12, width: '40%' }} />
                  <Skeleton style={{ height: 22, width: '80%' }} />
                  <Skeleton style={{ height: 18, width: '55%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : featured.length > 0 ? (
          <ol className="card-grid">
            {featured.map((p, i) => (
              <li key={p.id}>
                <Link to={`/produto/${p.slug}`} className="card-link">
                  <div className="print-frame">
                    <div className="card-frame">
                      <div className="card-figure">
                        <ProductFigure
                          variant={
                            (p as { figureVariant?: FigureVariant }).figureVariant ?? 'default'
                          }
                          title={p.name}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="ficha-num" style={{ marginTop: 12 }}>
                    {twoDigits(i + 1)}
                  </p>
                  <h3 className="card-name">{p.name}</h3>
                  <Price cents={p.basePriceCents} className="card-price" />
                </Link>
              </li>
            ))}
          </ol>
        ) : null}
        <Link to="/catalog" className="btn" style={{ marginTop: 40 }}>
          Ver todos os doces
        </Link>
      </section>

      {kits.length > 0 ? (
        <section className="container ficha-rule" style={{ paddingBlock: '32px 64px' }}>
          <div className="section-head">
            <p className="eyebrow">Kits e promoções especiais</p>
            <h2 className="display display-lg">Combos e kits personalizáveis</h2>
            <p className="lede">
              Monte o kit com os sabores que você mais gosta — para a festa, o presente ou a
              sobremesa da semana.
            </p>
          </div>
          <ol className="card-grid">
            {kits.slice(0, FEATURED_LIMIT).map((p) => (
              <li key={p.id}>
                <Link to={`/produto/${p.slug}`} className="card-link">
                  <div className="print-frame">
                    <div className="card-frame">
                      <div className="card-figure">
                        <ProductFigure
                          variant={
                            (p as { figureVariant?: FigureVariant }).figureVariant ?? 'default'
                          }
                          title={p.name}
                        />
                      </div>
                    </div>
                  </div>
                  <p className="card-cat">Monte o seu</p>
                  <h3 className="card-name">{p.name}</h3>
                  <div className="card-foot">
                    <Price cents={p.basePriceCents} className="card-price" />
                    <span className="card-cta">Montar</span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section id="nossa-historia" className="ficha-rule" style={{ scrollMarginTop: 120 }}>
        <div className="container" style={{ paddingBlock: 64 }}>
          <p className="eyebrow" style={{ marginBottom: 24 }}>
            Da nossa cozinha para você
          </p>
          <div className="hero-grid">
            <figure className="hero-fig" style={{ order: 2 }}>
              <div className="print-frame">
                <div className="card-frame" style={{ aspectRatio: '4/3' }}>
                  <img
                    src="/images/confeiteira.jpg"
                    alt="Retrato da confeiteira da Quero Pudim sorrindo com um pudim da marca nas mãos"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </div>
            </figure>
            <div style={{ order: 1 }}>
              <h2 className="display display-lg">
                O segredo é fazer
                <br />
                <em>sem pressa.</em>
              </h2>
              <p className="hero-sub">
                Todo pudim sai da nossa cozinha em Saquarema, um por um, com receita de família e
                ingredientes escolhidos a dedo. Sem furinho, com calda dourada e aquele sabor de
                casa que a gente faz questão de manter.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="container ficha-rule" style={{ paddingBlock: '32px 64px' }}>
        <div className="section-head">
          <p className="eyebrow">Como pedir</p>
          <h2 className="display display-lg">Do pedido ao primeiro gole</h2>
          <p className="lede">Simples assim, em três passos.</p>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <div className="step-head">
                <span className="ficha-num">{twoDigits(i + 1)}</span>
                <s.icon className="step-icon" aria-hidden="true" />
              </div>
              <h3>{s.title}</h3>
              <p>{s.description}</p>
            </li>
          ))}
        </ol>
        <p className="small muted" style={{ marginTop: 32 }}>
          Entrega e retirada em {city}.
        </p>
      </section>

      <section className="ficha-rule closing">
        <div className="container" style={{ paddingBlock: 64 }}>
          <p className="eyebrow">Feito à mão em Saquarema</p>
          <h2 className="display display-lg" style={{ marginTop: 16 }}>
            Bateu a vontade?
          </h2>
          <p className="hero-sub" style={{ marginTop: 8 }}>
            O cardápio completo está logo ali.
          </p>
          <Link to="/catalog" className="btn" style={{ marginTop: 32 }}>
            Escolher meus doces
          </Link>
        </div>
      </section>
    </main>
  );
}
