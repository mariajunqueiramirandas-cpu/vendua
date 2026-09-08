# 06 — Handoff de implementação

## Arquitetura proposta
Site de marketing com HTML pré-renderizado e pequenas ilhas de interação: menu, abas, ampliador e briefing. Usar o framework que o projeto já adotar; este pacote não exige fornecedor, versão ou serviço pago. Não há backend obrigatório no MVP. Separar conteúdo de apresentação para evoluir sem reescrever componentes.

## Estrutura sugerida
```
src/
  content/site.ts
  content/projects/quero-pudim-gourmet.ts
  components/Brand, Header, Footer, Button
  components/Hero, JourneyStrip, ProjectSwitch, SolutionRow
  components/ProcessSteps, FAQ, BriefBuilder, ImageViewer
  pages/index, contato, projetos/quero-pudim-gourmet, 404
public/assets/
  brand/, icons/, images/, projetos/
```

## Modelo de conteúdo
SiteConfig: brandName, tagline, instagramUrl, publicDomain opcional, contactMode.
Project: slug, name, summary, context, storefrontImage, adminImage, capabilities[], publicUrl opcional, video opcional.
Image: src, width, height, alt, caption opcional, decorative boolean.
Solution: id, title, description, icon.
FAQ: question, answer.
Brief: segment, channels[], goal, detail, composedMessage.
Não interpolar conteúdo livre como HTML. Renderizar texto e construir URL com API própria quando necessário.

## Imagens
Usar imagens geradas apenas como decoração. PNGs de origem ficam no pacote para edição e exportação; WebP é a opção inicial para entrega. Usar width/height ou aspect-ratio para reservar espaço. Hero com prioridade apenas se for o elemento visual principal; outras imagens lazy. Variantes 640, 960 e 1440 para srcset quando disponíveis. Mobile pode esconder a decoração inteira se ela competir com o CTA, sem perder conteúdo.

## Orçamento de desempenho proposto
Meta interna, a medir após implementação: payload inicial comprimido até 1 MB no mobile; JavaScript inicial até 120 KB gzip; hero WebP até 250 KB; fontes até 150 KB se carregadas. Se ultrapassar, reduzir imagens e interações antes de adicionar dependências. Não afirmar que estes valores já foram medidos no site.

## SEO editorial
Home title: Venduá | Lojas online personalizadas e automação
Home description: Lojas online com a identidade do seu negócio e automações para conectar atendimento, pedidos e operação. Conheça a Venduá.
Case title: Quero Pudim Gourmet: loja online e gestão | Venduá
Case description: Conheça o projeto do Quero Pudim Gourmet: identidade própria, experiência de compra e recursos para organizar a rotina da loja.
Contato title: Vamos conversar sobre seu negócio | Venduá
Canonical, sitemap e URLs de compartilhamento só após confirmar domínio. Não publicar dados estruturados de avaliações, preço ou estabelecimento físico não confirmados. A imagem social fornecida é institucional, não captura de interface.

## Privacidade: briefing para redação final
Antes do lançamento, inventariar logs da hospedagem, cookies, analytics, formulários, provedores e dados efetivamente tratados. Identificar responsável e canal de contato válidos. Descrever finalidade, compartilhamentos, retenção e forma de solicitar informações segundo a configuração adotada. O briefing local usa memória da página; abrir Instagram leva a terceiro. Não copiar política genérica que descreva ferramentas inexistentes. Não adicionar banner de consentimento decorativo que não controle tecnologia alguma.

## Implementação por etapas
1. Estrutura, rotas, tokens e conteúdo estático.
2. Capturas reais, imagens decorativas e marca.
3. Abas acessíveis, menu e FAQ.
4. Briefing local e falha de clipboard.
5. Ampliador e responsividade.
6. Validação e configuração final de domínio/contato.

## Prompt de partida para desenvolvimento
“Implemente o site Venduá a partir deste pacote, usando a copy e os critérios de aceite. Comece pelo conteúdo estático, depois adicione interações progressivas. Preserve os prints reais. Não invente métricas, clientes, preços ou contatos. Não exponha admin real. Entregue navegação e briefing local funcionais. Resolva rotinas de implementação autonomamente; mantenha as pendências comerciais identificadas sem preencher com dados fictícios.”
