# 04 — Sistema visual

## Direção: a fita que conecta
A fita lima representa continuidade entre vitrine, atendimento e gestão. Aparece em imagens decorativas e em pequenos conectores gráficos. Nunca vira uma linha sobre os textos. O site deve parecer o mesmo estúdio do Instagram, com mais respiro e menos efeitos.

## Paleta
| Token | Cor | Uso |
|---|---|---|
| ink | #123C32 | títulos, botões, fundo escuro |
| lime | #D9F875 | destaque sobre verde, detalhes |
| paper | #F7F4EA | fundo principal, texto sobre verde |
| text | #202923 | leitura longa |
| muted | #53635A | apoio em fundo claro |
| line | #CDD6CB | separadores, bordas decorativas |

Usar ink sobre paper/lime e paper sobre ink. Lima sobre creme não é cor de texto. Bordas de campos usam muted; line sozinho não identifica controle. Erros sempre têm texto e ícone, não dependem de vermelho.

## Tipografia
Direção: Manrope 400/600/800, carregada localmente se disponibilizada com sua licença; fallback `Arial, sans-serif`. A fonte não é incluída no pacote. A implementação deve funcionar com fallback. Evitar fontes caligráficas para a Venduá; a marca do cliente mantém sua identidade nos prints.
H1 desktop 64–80 px / 1.04; mobile 38–48 px. H2 40–52 / 1.1; mobile 30–36. Corpo 18 / 1.6, mobile mínimo 16. Labels 13–14 / 1.4. Não usar tracking negativo em parágrafos.

## Escala e superfícies
Espaçamento base: 4, 8, 12, 16, 24, 32, 48, 64, 96. Seções: 96 px desktop, 64 mobile. Container 1200 px. Border-radius: botão 999 px, campos 12 px, imagens 24 px. Uma sombra discreta em provas visuais; sem sombras em todos os cartões.

## Componentes
Header: altura aproximada 80 px, marca legível e um CTA. Sticky opcional, sem esconder foco ou âncoras.
Botão primário: ink/paper ou lime/ink, mínimo 48 px de altura, padding horizontal 24. Hover altera luminosidade discretamente; foco externo visível. Estados disabled somente durante trabalho real.
Link secundário: texto sublinhado no hover e no foco; diferenciação não baseada apenas em cor.
Abas: item ativo com fundo ink e texto paper; setas do teclado movem foco; associação explícita entre aba e painel.
FAQ: botão de largura total, indicador de expansão, conteúdo textual no DOM. Uma ou mais respostas podem permanecer abertas.
Image viewer: botão explícito de ampliar, modal com fechar e Escape, devolve foco ao acionador; zoom/pan quando necessário.
Opções do briefing: checkbox/radio nativos estilizados com rótulos completos. Estado selecionado tem check e borda.

## Layouts de referência
Home: abertura editorial creme, fita em coluna própria; prova real ampla; serviços em linhas com número pequeno; fechamento verde. Case: fundo creme quase todo, blocos alternados de texto e captura. Contato: largura de formulário 680 px, progresso simples e sem pressão comercial.

## Movimento
Transições 160–220 ms. Sem entrada obrigatória de textos ao scroll, parallax ou loop chamativo. `prefers-reduced-motion` desliga movimento não essencial. Não deixar conteúdo invisível se JavaScript falhar.

## Marca em arquivo
Os SVGs do pacote são uma reconstrução vetorial simples da direção aprovada, não reprodução matematicamente exata do logo gerado. Símbolo V com terminais arredondados. O wordmark usa texto vivo e fallback; converter em curvas apenas após fechar tipografia. Não tratar o SVG como prova de registro de marca.
