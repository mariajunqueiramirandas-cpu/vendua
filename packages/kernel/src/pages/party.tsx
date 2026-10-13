import { useEffect, useMemo, useRef, useState } from 'react';
import type { PartyInput, PartyProfile, PartyQuote } from '../api.ts';
import { errorCode, errorCopy, showError, showInfo } from '../errors.ts';
import { usePageTitle } from '../head.ts';
import { useCart, useCopy } from '../hooks.ts';
import { useNavigateTo } from '../primitives.tsx';
import { useKernel, useQuery } from '../provider.tsx';
import { KERNEL_PATHS } from '../config.ts';
import { KLink } from '../sdk/sections.tsx';

// Kernel 1.26 — Festa calculada: guests and picks → Core's quantities → the cart. The page never
// counts pieces or money: the quote and the cart are Core's.

/** where the calculator lives; a store page of the same name wins (router.tsx) */
export const PARTY_PATH = '/festa';

export function usePartyProfiles() {
  const { api } = useKernel();
  const q = useQuery('party', () => api.partyProfiles().then((r) => r.profiles));
  return { profiles: q.data ?? [], loading: q.loading && !q.data };
}

const clampInt = (v: string, lo: number, hi: number) => {
  const n = Math.floor(Number(v.replace(/\D/g, '')) || 0);
  return Math.max(lo, Math.min(hi, n));
};

function childWords(f: number): string | null {
  if (f >= 1) return null;
  if (f === 0) return 'Crianças não entram na conta.';
  if (f === 0.5) return 'Cada criança conta como meia porção.';
  return `Cada criança conta como ${Math.round(f * 100)}% de uma porção.`;
}

function initialChoices(p: PartyProfile): Record<string, string[]> {
  return Object.fromEntries(
    p.groups.map((g) => [g.id, g.required && g.products[0] ? [g.products[0].productId] : []]),
  );
}

export function PartyPage() {
  usePageTitle('Monte sua festa');
  const { profiles, loading } = usePartyProfiles();
  return (
    <main id="main" className="v-page v-party" data-vendua-page="party">
      <h1 className="v-page-title">Monte sua festa</h1>
      <p className="v-muted v-party-intro">
        Diga quantas pessoas vêm e o que servir. A loja calcula as quantidades.
      </p>
      {loading ? (
        <div className="v-skeleton-page" aria-busy="true" />
      ) : profiles.length === 0 ? (
        <div className="v-panel v-empty" data-part="empty">
          <p>Esta loja ainda não monta festas por aqui.</p>
          <KLink href="/" className="v-link-btn">
            Ver o cardápio
          </KLink>
        </div>
      ) : (
        <PartyForm profiles={profiles} />
      )}
    </main>
  );
}

function PartyForm({ profiles }: { profiles: PartyProfile[] }) {
  const { api } = useKernel();
  const { cart, mutations } = useCart();
  const { vocabulary } = useCopy();
  const go = useNavigateTo();
  const [profileId, setProfileId] = useState(profiles[0]!.id);
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0]!;
  const [adults, setAdults] = useState(() =>
    Math.min(profile.maxGuests, Math.max(profile.minGuests, 20)),
  );
  const [children, setChildren] = useState(0);
  const [choices, setChoices] = useState(() => initialChoices(profile));
  const [quote, setQuote] = useState<PartyQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const asked = useRef(0);

  const pickProfile = (p: PartyProfile) => {
    setProfileId(p.id);
    setChoices(initialChoices(p));
    setAdults((a) => Math.min(p.maxGuests, Math.max(p.minGuests, a)));
  };

  const guests = adults + children;
  const missing = profile.groups.find((g) => g.required && !(choices[g.id]?.length ?? 0));
  const tooFew = guests < profile.minGuests;
  const tooMany = guests > profile.maxGuests;
  const input: PartyInput | null = useMemo(
    () =>
      missing || tooFew || tooMany
        ? null
        : {
            profileId: profile.id,
            adults,
            children,
            choices: Object.fromEntries(Object.entries(choices).filter(([, v]) => v.length)),
          },
    [profile.id, adults, children, choices, missing, tooFew, tooMany],
  );

  useEffect(() => {
    if (!input) {
      setQuote(null);
      return;
    }
    const n = ++asked.current;
    const t = setTimeout(() => {
      api.partyQuote(input).then(
        (r) => {
          if (n !== asked.current) return;
          setQuote(r.quote);
          setQuoteError(null);
        },
        (err: unknown) => {
          if (n !== asked.current) return;
          setQuote(null);
          setQuoteError(errorCopy(errorCode(err)).title);
        },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [api, input]);

  const toggle = (groupId: string, productId: string, max: number) =>
    setChoices((c) => {
      const cur = c[groupId] ?? [];
      const next = cur.includes(productId)
        ? cur.filter((x) => x !== productId)
        : cur.length < max
          ? [...cur, productId]
          : max === 1
            ? [productId]
            : cur;
      return { ...c, [groupId]: next };
    });

  const build = async () => {
    if (!input) return;
    setBuilding(true);
    try {
      const { report } = await mutations.buildParty(input);
      if (report.skipped.length)
        showInfo(
          'party',
          report.added ? 'Parte da festa foi para a sacola' : 'Nada disso está disponível agora',
          report.skipped.map((s) => errorCopy(s.code).title).join(' · '),
        );
      go(KERNEL_PATHS.cart);
    } catch (err) {
      showError(err);
    } finally {
      setBuilding(false);
    }
  };

  const bagHasOther = !!cart?.items.length && !cart.party;
  const child = childWords(profile.childFactor);

  return (
    <div className="v-party-form">
      {profiles.length > 1 ? (
        <fieldset className="v-fieldset">
          <legend className="v-legend">Que festa?</legend>
          <div className="v-party-picks" data-part="profiles">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                className="v-chip"
                aria-pressed={p.id === profile.id}
                onClick={() => pickProfile(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {profile.description ? <p className="v-muted">{profile.description}</p> : null}

      <fieldset className="v-fieldset" data-part="guests">
        <legend className="v-legend">Quantas pessoas?</legend>
        <div className="v-party-guests">
          <label className="v-field">
            <span className="v-label">Adultos</span>
            <input
              className="v-input"
              inputMode="numeric"
              value={String(adults)}
              onChange={(e) => setAdults(clampInt(e.target.value, 0, 1000))}
            />
          </label>
          <label className="v-field">
            <span className="v-label">Crianças</span>
            <input
              className="v-input"
              inputMode="numeric"
              value={String(children)}
              onChange={(e) => setChildren(clampInt(e.target.value, 0, 1000))}
            />
          </label>
        </div>
        <p className="v-muted v-party-note">
          {tooFew
            ? `Festas a partir de ${profile.minGuests} pessoas.`
            : tooMany
              ? `Até ${profile.maxGuests} pessoas por aqui. Para mais, fale com a loja.`
              : child}
        </p>
      </fieldset>

      {profile.groups.map((g) => {
        const picked = choices[g.id] ?? [];
        return (
          <fieldset key={g.id} className="v-fieldset" data-part="group">
            <legend className="v-legend">
              {g.name}{' '}
              <span className="v-muted">
                {g.perGuest.toLocaleString('pt-BR')} por pessoa ·{' '}
                {g.maxChoices === 1 ? 'escolha 1' : `escolha até ${g.maxChoices}`}
                {g.required ? '' : ' (opcional)'}
              </span>
            </legend>
            <div className="v-party-picks">
              {g.products.map((p) => (
                <button
                  key={p.productId}
                  type="button"
                  className="v-chip"
                  aria-pressed={picked.includes(p.productId)}
                  disabled={
                    !picked.includes(p.productId) &&
                    g.maxChoices > 1 &&
                    picked.length >= g.maxChoices
                  }
                  onClick={() => toggle(g.id, p.productId, g.maxChoices)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </fieldset>
        );
      })}

      <section className="v-panel v-party-result" aria-live="polite" data-part="quote">
        <h2 className="v-panel-title">
          {quote
            ? `Para ${quote.guests} ${quote.guests === 1 ? 'pessoa' : 'pessoas'}`
            : 'Sua festa'}
        </h2>
        {quote ? (
          <ul className="v-party-lines">
            {quote.lines.map((l) => (
              <li key={l.productId} className="v-party-line">
                <span className="v-party-line-name">
                  <strong className="v-num">{l.qty}×</strong> {l.name}
                </span>
                <span className="v-muted v-party-line-why">{l.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="v-muted">
            {quoteError ??
              (missing
                ? `Escolha ${missing.name.toLocaleLowerCase('pt-BR')}.`
                : tooFew || tooMany
                  ? 'Ajuste o número de pessoas.'
                  : 'Calculando…')}
          </p>
        )}
        {bagHasOther ? (
          <p className="v-muted v-party-note">
            O que já está {vocabulary.inBag} sai para dar lugar à festa.
          </p>
        ) : null}
        <button
          type="button"
          className="v-btn v-btn-accent v-btn-block"
          data-part="build"
          disabled={!quote || building}
          onClick={() => void build()}
        >
          {building ? 'Montando…' : `Colocar ${vocabulary.toBag}`}
        </button>
        <p className="v-muted v-party-note">
          {vocabulary.inBag.charAt(0).toUpperCase() + vocabulary.inBag.slice(1)} você vê o total e
          muda o que quiser. A data é escolhida ao finalizar.
        </p>
      </section>
    </div>
  );
}
