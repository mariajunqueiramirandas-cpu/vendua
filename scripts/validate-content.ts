import {
  site,
  signals,
  manifesto,
  transmissions,
  ritual,
  teaserFaqs,
} from '../src/lib/content/site';
if (!site.brandName || !site.tagline || !site.instagramUrl)
  throw new Error('Configuração obrigatória do site ausente.');
if (signals.length !== 3 || signals.some(([title, text]) => !title || !text))
  throw new Error('Os três sinais do teaser precisam de título e texto.');
if (!manifesto) throw new Error('Manifesto ausente.');
if (ritual.length !== 3 || ritual.some(([title, text]) => !title || !text))
  throw new Error('O ritual precisa de três passos com texto.');
if (!teaserFaqs.length || teaserFaqs.some(([q, a]) => !q || !a))
  throw new Error('Perguntas do teaser incompletas.');
if (transmissions.length !== 3) throw new Error('Três transmissões esperadas.');
for (const t of transmissions) {
  if (!t.id || !t.title || !t.text || !t.detail) throw new Error('Transmissão incompleta.');
  if (!t.specs.length || t.specs.some(([k, v]) => !k || !v))
    throw new Error(`Especificações ausentes em ${t.id}.`);
}
console.log('Conteúdo do teaser validado.');
