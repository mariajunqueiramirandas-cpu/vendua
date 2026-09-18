import {
  site,
  signals,
  manifesto,
  transmissions,
  ritual,
  teaserFaqs,
} from '../src/lib/content/site';

const blank = (value: string | undefined) => !value || !value.trim();

if (blank(site.brandName) || blank(site.tagline) || blank(site.instagramUrl))
  throw new Error('Configuração obrigatória do site ausente.');

let instagram: URL;
try {
  instagram = new URL(site.instagramUrl);
} catch {
  throw new Error(`site.instagramUrl inválida: "${site.instagramUrl}".`);
}
if (instagram.protocol !== 'https:' || !instagram.hostname.endsWith('instagram.com'))
  throw new Error('site.instagramUrl deve ser uma URL HTTPS do Instagram.');

if (!Array.isArray(site.emails) || site.emails.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
  throw new Error('site.emails precisa de endereços de e-mail válidos.');

if (site.publicDomain) {
  try {
    if (new URL(site.publicDomain).protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('site.publicDomain deve ser uma URL HTTPS (ou ficar vazio).');
  }
}

if (signals.length !== 3 || signals.some(([title, text]) => blank(title) || blank(text)))
  throw new Error('Os três sinais do teaser precisam de título e texto.');
if (blank(manifesto)) throw new Error('Manifesto ausente.');
if (ritual.length !== 3 || ritual.some(([title, text]) => blank(title) || blank(text)))
  throw new Error('O ritual precisa de três passos com texto.');
if (teaserFaqs.length !== 5 || teaserFaqs.some(([q, a]) => blank(q) || blank(a)))
  throw new Error('As cinco perguntas do teaser precisam de pergunta e resposta.');
if (transmissions.length !== 3) throw new Error('Três transmissões esperadas.');
for (const t of transmissions) {
  if (blank(t.id) || blank(t.title) || blank(t.text) || blank(t.detail))
    throw new Error('Transmissão incompleta.');
  if (!t.specs.length || t.specs.some(([k, v]) => blank(k) || blank(v)))
    throw new Error(`Especificações ausentes em ${t.id}.`);
}
console.log('Conteúdo do teaser validado.');
