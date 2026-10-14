import { defineTool, s, ToolError, type Json } from '@vendua/agent-runtime';
import type { Sql } from '../../../platform/db.ts';
import {
  annotateResults,
  assertFetchable,
  chaseLinks,
  contactFromUrl,
  contactsFromText,
  discoveryFor,
  isBrMobilePhone,
  isMapPointer,
  isProfileHubUrl,
  mapPointerName,
  pageKey,
  resolveMapPointer,
  type ReadPage,
  type ReadPagesResult,
} from '../../../crm/channels/discovery.ts';
import { MonidBudget, monidRun } from '../../../crm/channels/monid.ts';
import { counters, str, turn, type Ctx } from './shared.ts';

// Prospect research, the same for every CRM agent that is offered it. These are `read` tools:
// they run in parallel, write nothing, and carry what they spent in their result's data
// (pageReads, monidUsd, contacts) so the turn's fold, and a replayed turn, knows the balance.

/** a live conversation can't afford a rabbit hole: reply turns read at most this many pages */
const REPLY_READ_PAGES_CAP = 2;
/** a page's text as the model reads it; the rest is nav and contacts */
const PAGE_TEXT_MAX = 12_000;
const PAGES_TEXT_TOTAL = 60_000;
const MONID_CAP_USD: Record<string, number> = { discovery: 0.25 };

type PageResult = { page: ReadPage | null; error?: string };

interface Research {
  pages: Map<string, Promise<PageResult>>;
  monid: MonidBudget;
}
const research = new Map<string, Research>();

/** This turn's page cache and paid-lookup budget, alongside the shared counters. */
function researchOf(ctx: Ctx): Research {
  let r = research.get(ctx.turnId);
  if (!r) {
    const t = turn(ctx.state);
    const cap =
      t.params.monidCapUsd != null && Number.isFinite(Number(t.params.monidCapUsd))
        ? Math.min(5, Math.max(0, Number(t.params.monidCapUsd)))
        : (MONID_CAP_USD[t.kind] ?? 0.05);
    r = { pages: new Map(), monid: new MonidBudget(cap, counters(ctx).monidUsd) };
    if (research.size > 200) research.clear();
    research.set(ctx.turnId, r);
  }
  return r;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const webSearchTool = defineTool<{ query: string; purpose?: string | undefined }, Sql>({
  name: 'web_search',
  description:
    'Search the web for prospects. Results come annotated: kind=contact already carries the parsed phone/whatsapp link from the URL; kind=profile is a social root (instagram profiles are worth a read_pages: the bio carries whatsapp + link-in-bio; facebook is login-walled); kind=site is the read_pages candidate; kind=listing is a directory/ordering platform. Snippet-carried phones/emails arrive pre-parsed. Emit 2-3 different-angled queries per step: they run in parallel.',
  effect: 'read',
  input: s.object({
    query: s.string({ min: 1, max: 300 }),
    purpose: s.string({ max: 300 }).describe('why: used to rank results').optional(),
  }),
  async run(ctx: Ctx, input) {
    const provider = await discoveryFor(ctx.tx);
    const raw = await provider.search(input.query, input.purpose ?? '').catch((e) => {
      throw new ToolError(`web_search: ${errText(e)}`);
    });
    const { results, droppedDupes } = annotateResults(raw.results);
    return {
      results,
      ...(droppedDupes ? { droppedDupes } : {}),
      note: 'kind=contact já traz phone/whatsappLink da URL; kind=profile instagram vale read_pages (a bio entrega whatsapp + link-in-bio — facebook é login wall); kind=site é o que vale read_pages; listing = diretório/plataforma de pedido — evidência mais que fonte, EXCETO quando o título cita o nome do prospect pesquisado: aí read_pages vale (diretório carrega telefone/endereço). phone/email podem vir do snippet.',
    } as unknown as Json;
  },
});

export const readPagesTool = defineTool<{ urls: string[]; goal?: string | undefined }, Sql>({
  name: 'read_pages',
  description:
    "Read pages: each page's markdown text (read it: contacts hide in prose, a bio, a footer mailto), foundContacts (phone/whatsapp/email/socials parsed from links, text, meta and redirects; phoneHints = '9xxxx-xxxx' sem DDD, proof of a whatsapp to resolve) and nav (contact-ish follow-ups). Link-in-bio hubs and google-business/maps pointers are chased one hop for free (marked chasedFrom). truncated:true = cut mid-render, the contact line may be past the fold. Up to 6 urls of one prospect per call; facebook is login-walled; a repeated URL returns its cached output.",
  effect: 'read',
  input: s.object({
    urls: s
      .array(s.string({ min: 1, max: 2000 }), { min: 1, max: 6 })
      .describe('1–6 urls of the SAME prospect'),
    goal: s.string({ max: 300 }).describe('what you are looking for').optional(),
  }),
  async run(ctx: Ctx, input) {
    const c = counters(ctx);
    const cache = researchOf(ctx).pages;
    const replyBound = turn(ctx.state).kind === 'reply';
    let spent = 0;
    const spend = (n: number) => {
      c.pageReads += n;
      spent += n;
    };
    // reserve-and-charge per real fetch: named map pointers are free (in-process)
    const reserve = replyBound
      ? async (): Promise<boolean> => {
          if (c.pageReads >= REPLY_READ_PAGES_CAP) return false;
          spend(1);
          return true;
        }
      : undefined;
    const urls = input.urls.map((u) => u.trim()).filter(Boolean);
    const missOut = new Map<string, Promise<PageResult>>();
    const fetchable: string[] = [];
    const mapDirects: string[] = [];
    const queued = new Set<string>();
    for (const url of urls) {
      const id = pageKey(url) ?? url;
      // validate before the cache short-circuit: pageKey drops the scheme
      try {
        assertFetchable(url);
      } catch (e) {
        missOut.set(url, Promise.resolve({ page: null, error: errText(e) }));
        continue;
      }
      if (cache.has(id) || queued.has(id)) continue;
      queued.add(id);
      if (isMapPointer(url)) mapDirects.push(url);
      else fetchable.push(url);
    }
    // reply's bound prices fetches, not calls: all-or-nothing before any fetch issues
    if (replyBound && fetchable.length) {
      if (c.pageReads + fetchable.length > REPLY_READ_PAGES_CAP)
        throw new ToolError(
          `read_pages: limite de ${REPLY_READ_PAGES_CAP} leituras por run de reply — pergunte na conversa o que ainda faltar`,
        );
      spend(fetchable.length);
    }
    for (const url of mapDirects) {
      const key = pageKey(url);
      const p: Promise<PageResult> = resolveMapPointer(url, reserve)
        .then((page): PageResult =>
          page ? { page } : { page: null, error: 'map pointer did not resolve' },
        )
        .catch((e): PageResult => ({ page: null, error: errText(e) }))
        .then((r) => {
          // a failed resolve doesn't bank: a retry must reissue it
          if (!r.page && key) cache.delete(key);
          return r;
        });
      missOut.set(url, p);
      if (key) cache.set(key, p);
    }
    const provider = await discoveryFor(ctx.tx);
    const goal = input.goal ?? '';
    const readBatch = (list: string[]): Promise<ReadPagesResult> =>
      provider.readPages(list, goal).catch((e: unknown) => ({
        pages: [],
        errors: list.map((url) => ({ url, error: errText(e) })),
      }));
    const pageFor = (res: ReadPagesResult, key: string | null) =>
      res.pages.find((pg) => pageKey(pg.url) === key || pageKey(pg.finalUrl ?? '') === key);
    if (fetchable.length) {
      // one provider call for the whole miss batch
      const batch = readBatch(fetchable);
      for (const url of fetchable) {
        const key = pageKey(url);
        const p: Promise<PageResult> = batch.then((res) => {
          const page = pageFor(res, key);
          if (page) return { page };
          if (key) cache.delete(key);
          return {
            page: null,
            error: res.errors.find((er) => pageKey(er.url) === key)?.error ?? 'no result for url',
          };
        });
        missOut.set(url, p);
        if (key) cache.set(key, p);
      }
    }
    const pages: ReadPage[] = [];
    const errs: { url: string; error: string }[] = [];
    for (const url of urls) {
      const key = pageKey(url);
      // this url's own slot first: a rejection must never inherit a fetchable twin's page
      const p = missOut.get(url) ?? (key ? cache.get(key) : undefined);
      const out = p ? await p : null;
      if (out?.page) {
        const shared = key !== null && queued.has(key) && !missOut.has(url);
        const fromCache = key !== null && !queued.has(key);
        pages.push({ ...out.page, ...(shared || fromCache ? { cached: true } : {}) });
      } else errs.push({ url, error: out?.error ?? 'no result for url' });
    }
    // one free hop on pointer-only links (link-in-bio hubs, google-business)
    const chaseOf: { url: string; from: string }[] = [];
    const chaseSeen = new Set<string>();
    for (const pg of pages)
      for (const link of chaseLinks(pg)) {
        const id = pageKey(link) ?? link;
        if (cache.has(id) || chaseSeen.has(id)) continue;
        chaseSeen.add(id);
        chaseOf.push({ url: link, from: pg.url });
      }
    const chases: typeof chaseOf = [];
    let slots = replyBound ? Math.max(0, REPLY_READ_PAGES_CAP - c.pageReads) : Infinity;
    for (const ch of chaseOf) {
      if (chases.length >= 4) break;
      if (mapPointerName(ch.url) === null) {
        try {
          assertFetchable(ch.url);
        } catch (e) {
          errs.push({ url: ch.url, error: errText(e) });
          continue;
        }
        if (slots <= 0) continue;
        slots--;
      }
      chases.push(ch);
    }
    const hubChases = chases.filter((ch) => !isMapPointer(ch.url));
    if (hubChases.length) {
      if (replyBound) spend(hubChases.length);
      const res = await readBatch(hubChases.map((ch) => ch.url));
      for (const ch of hubChases) {
        const key = pageKey(ch.url);
        const page = pageFor(res, key);
        if (page) {
          pages.push({ ...page, chasedFrom: ch.from });
          if (key) cache.set(key, Promise.resolve({ page }));
        } else
          errs.push({
            url: ch.url,
            error: res.errors.find((er) => pageKey(er.url) === key)?.error ?? 'no result for url',
          });
      }
    }
    // maps/google-business pointers captcha the fetch provider: resolve the 302 in-process
    const mapWave = chases.filter((ch) => isMapPointer(ch.url));
    for (const pg of pages.filter((p) => p.chasedFrom))
      for (const link of chaseLinks(pg)) {
        if (!isMapPointer(link) || mapWave.length >= 6) continue;
        const id = pageKey(link) ?? link;
        if (cache.has(id) || chaseSeen.has(id)) continue;
        chaseSeen.add(id);
        mapWave.push({ url: link, from: pg.url });
      }
    for (const ch of mapWave.slice(0, 6)) {
      const key = pageKey(ch.url);
      const page = await resolveMapPointer(ch.url, reserve).catch(() => null);
      if (page) {
        pages.push({ ...page, chasedFrom: ch.from });
        if (key) cache.set(key, Promise.resolve({ page }));
      } else errs.push({ url: ch.url, error: 'map pointer did not resolve' });
    }
    // a turn's log row stays far under its 256 KB cap: the text shrinks to fit, nav and contacts stay
    const each = Math.min(PAGE_TEXT_MAX, Math.floor(PAGES_TEXT_TOTAL / Math.max(1, pages.length)));
    const shown = pages.map((p) =>
      p.text.length > each ? { ...p, text: `${p.text.slice(0, each)}\n[…]`, clipped: true } : p,
    );
    return {
      content: JSON.stringify({ pages: shown, ...(errs.length ? { errors: errs } : {}) }),
      data: { pageReads: spent, urls: pages.map((p) => p.url) },
    };
  },
});

// ── paid lookups (monid) ───────────────────────────────────────────────────

function monidKey(): string {
  const key = process.env.MONID_API_KEY;
  if (!key) throw new ToolError('MONID_API_KEY não configurada');
  return key;
}

/** Runs a paid lookup against the turn's cap; the result carries what it cost. */
async function paid<T>(
  ctx: Ctx,
  estimateUsd: number,
  call: () => Promise<{ value: T; costUsd: number }>,
): Promise<{ value: T; costUsd: number; spentUsd: number; capUsd: number }> {
  const budget = researchOf(ctx).monid;
  try {
    budget.reserve(estimateUsd);
  } catch (e) {
    throw new ToolError(errText(e));
  }
  let out: { value: T; costUsd: number };
  try {
    out = await call();
  } catch (e) {
    budget.reconcile(estimateUsd, 0);
    throw new ToolError(errText(e));
  }
  budget.reconcile(estimateUsd, out.costUsd);
  counters(ctx).monidUsd = budget.spent;
  return { ...out, spentUsd: budget.spent, capUsd: budget.cap() };
}

/** Contact values not yet banked this turn: a repeat isn't progress. */
function fresh(ctx: Ctx, vals: (string | null | undefined)[]): string[] {
  const seen = counters(ctx).seen;
  const out: string[] = [];
  for (const v of vals)
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  return out;
}

const igFrom = (o: Record<string, unknown>): string | null => {
  const m = /instagram\.com\/([\w.]+)/i.exec(JSON.stringify(o));
  return m ? `@${m[1]}` : null;
};

export const mapsLookupTool = defineTool<
  { query: string; city: string; limit?: number | undefined },
  Sql
>({
  name: 'maps_lookup',
  description:
    "Google Maps business lookup via monid (~$0.0045/result against the turn's monid cap). query='what' + city='where' → structured candidates: name, phone, whatsappLikely (true when the phone is a BR mobile: that number IS the whatsapp, carry it into the lead's whatsapp field), address, website, rating, category. The strongest open for physical segments.",
  effect: 'read',
  input: s.object({
    query: s.string({ min: 1, max: 200 }).describe("business/segment, e.g. 'padaria artesanal'"),
    city: s.string({ min: 1, max: 120 }),
    limit: s.int({ min: 1, max: 10 }).describe('max results (default 8)').optional(),
  }),
  async run(ctx: Ctx, input) {
    const apiKey = monidKey();
    const limit = input.limit ?? 8;
    const city = input.city.trim();
    const res = await paid(ctx, 0.0045 * limit, async () => {
      const r = await monidRun(
        { provider: 'apify', endpoint: '/damilo/google-maps-scraper' },
        {
          query: input.query,
          // bare city names drift to neighboring towns: anchor on Brasil unless qualified
          location: /,/.test(city) ? city : `${city}, Brasil`,
          language: 'pt',
          max_results: limit,
        },
        apiKey,
      );
      return { value: r.output, costUsd: r.costUsd || 0.0045 * r.output.length };
    });
    const candidates = res.value.map((r) => {
      const phone = str(r.phone ?? r.phoneNumber ?? r.phone_number ?? r.telefone);
      const rating = r.rating ?? r.totalScore;
      return {
        name: str(r.name ?? r.title),
        phone,
        whatsappLikely: phone ? isBrMobilePhone(phone) : false,
        address: str(r.address ?? r.fullAddress ?? r.street),
        website: str(r.website),
        instagram: igFrom(r),
        rating: typeof rating === 'number' ? rating : null,
        category: str(r.categoryName ?? r.category),
      };
    });
    const contacts = fresh(
      ctx,
      candidates.map((c) => c.phone),
    );
    return {
      candidates,
      newContacts: contacts.length,
      spentUsd: res.spentUsd,
      capUsd: res.capUsd,
      next: candidates
        .filter((c) => !c.phone)
        .slice(0, 5)
        .map((c) =>
          c.instagram
            ? `${c.name}: sem telefone — instagram_profile('${c.instagram}') ou serp "${c.name} ${city}" telefone`
            : `${c.name}: sem telefone — serp "${c.name} ${city}" telefone`,
        ),
      monidUsd: res.costUsd,
      contacts,
    };
  },
});

export const instagramProfileTool = defineTool<{ handle: string }, Sql>({
  name: 'instagram_profile',
  description:
    "Full Instagram profile via monid (~$0.003/profile). Returns the REAL complete biography (never the '…mais' truncation), externalUrl (the link-in-bio), category, followers and any public contact fields, with the bio parsed into contacts. The fix for profiles that render as shells in read_pages.",
  effect: 'read',
  input: s.object({
    handle: s.string({ min: 1, max: 100 }).describe('instagram @handle (with or without @)'),
  }),
  async run(ctx: Ctx, input) {
    const apiKey = monidKey();
    const handle = input.handle.replace(/^@/, '').trim();
    if (!handle) throw new ToolError('handle vazio');
    const res = await paid(ctx, 0.003, async () => {
      const r = await monidRun(
        { provider: 'apify', endpoint: '/apify/instagram-profile-scraper' },
        { usernames: [handle] },
        apiKey,
      );
      return { value: r.output, costUsd: r.costUsd || 0.003 * r.output.length };
    });
    const p = res.value[0];
    if (!p)
      return {
        error: `perfil @${handle} não encontrado`,
        spentUsd: res.spentUsd,
        capUsd: res.capUsd,
        monidUsd: res.costUsd,
      };
    const bio = str(p.biography) ?? '';
    const externalUrl =
      str(p.externalUrl) ?? str((p.externalUrls as { url?: string }[] | undefined)?.[0]?.url);
    const found = contactsFromText(bio);
    let extIsHub = false;
    if (externalUrl) {
      try {
        const u = new URL(externalUrl);
        const c = contactFromUrl(u);
        if (c.phone) found.phones.push(c.phone);
        if (c.whatsappLink) found.whatsappLinks.push(c.whatsappLink);
        if (c.instagram) found.instagram.push(c.instagram);
        extIsHub = isProfileHubUrl(u);
      } catch {
        /* not a url */
      }
    }
    for (const f of ['publicEmail', 'contactPhoneNumber', 'whatsappNumber'] as const) {
      const v = str(p[f]);
      if (v) (/@/.test(v) ? found.emails : found.phones).push(v);
    }
    const next: string[] = [];
    // every state that offers the paid lookups offers read_pages too
    if (extIsHub)
      next.push(
        `externalUrl é hub — read_pages("${externalUrl}") entrega os links reais (wa.me mora lá)`,
      );
    else if (externalUrl) next.push(`externalUrl="${externalUrl}" — read_pages vale`);
    if (found.phoneHints.length && !found.phones.length)
      next.push(
        `phoneHints ${found.phoneHints.join(', ')} sem DDD — serp "${handle} ${found.phoneHints[0]}" ou "<nome> <cidade>" telefone resolve`,
      );
    const contacts = fresh(ctx, [...found.phones, ...found.whatsappLinks, ...found.emails]);
    return {
      profile: {
        username: str(p.username) ?? handle,
        fullName: str(p.fullName),
        biography: bio,
        externalUrl,
        followers: typeof p.followersCount === 'number' ? p.followersCount : null,
        category: str(p.businessCategoryName),
      },
      foundContacts: found,
      newContacts: contacts.length,
      spentUsd: res.spentUsd,
      capUsd: res.capUsd,
      ...(next.length ? { next } : {}),
      monidUsd: res.costUsd,
      contacts,
    } as unknown as Json;
  },
});

export const serpTool = defineTool<{ query: string }, Sql>({
  name: 'serp',
  description:
    "One Google SERP via monid (~$0.001): the cheap follow-up round for a named prospect ('<nome> <cidade>' telefone/whatsapp). Snippets arrive phone-parsed; the result that names the prospect (even a directory: cylex, apontador, guia local) is worth a read_pages.",
  effect: 'read',
  input: s.object({ query: s.string({ min: 1, max: 300 }) }),
  async run(ctx: Ctx, input) {
    const apiKey = monidKey();
    const res = await paid(ctx, 0.001, async () => {
      const r = await monidRun(
        { provider: 'mrscraper', endpoint: '/serp/google' },
        { query: input.query, region: 'br', language: 'pt' },
        apiKey,
      );
      return { value: r.output, costUsd: r.costUsd || 0.001 };
    });
    const results = res.value.slice(0, 10).map((r) => {
      const snippet = str(r.snippet ?? r.description) ?? '';
      return {
        title: str(r.title),
        url: str(r.link ?? r.url),
        snippet: snippet.slice(0, 300),
        contacts: contactsFromText(snippet),
      };
    });
    const contacts = fresh(
      ctx,
      results.flatMap((r) => [
        ...r.contacts.phones,
        ...r.contacts.whatsappLinks,
        ...r.contacts.emails,
      ]),
    );
    return {
      results,
      newContacts: contacts.length,
      spentUsd: res.spentUsd,
      capUsd: res.capUsd,
      next: [
        'o resultado que citar o nome do prospect (mesmo diretório/guia) → read_pages — é onde telefone mora',
      ],
      monidUsd: res.costUsd,
      contacts,
    } as unknown as Json;
  },
});
