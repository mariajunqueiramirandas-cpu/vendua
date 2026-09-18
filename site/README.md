# Venduá

Site teaser implementado com **Bun, Svelte 5 e SvelteKit**. A direção atual é misteriosa e exclusiva: o produto anterior (lojas personalizadas sob encomenda) saiu de cena e a página apresenta apenas sinais do que vem a seguir — vitrines que se constroem sozinhas. O acesso é por convite, com o direct do Instagram como única porta.

O hero e as três transmissões usam **shaders WebGL2 próprios** (utilitário `src/lib/gl.ts`, sem dependências): ruído deformado desenhando fitas lima no hero; nas transmissões, três visuais vivos — grade de células acendendo (a vitrine), linhas poligonais dobradas (a montagem) e fluxos de luz (a operação). Cada cartão é clicável e abre um modal (`<dialog>`) com a descrição críptica do sistema e uma tabela de especificações. Os canvases renderizam em resolução reduzida, pausam fora da viewport, recuperam contexto WebGL perdido, reagem ao ponteiro e viram um único quadro estático em `prefers-reduced-motion`. Sem WebGL ou sem JS, os quadros mostram o gradiente de fundo.

A página inicial usa **GSAP ScrollTrigger** para entrada mascarada do hero, barra de progresso, manifesto fixado com revelação palavra a palavra, faixa horizontal de transmissões pinada no desktop (empilhada no mobile e em movimento reduzido) com saída por dissolução, revelações em lote, acordeão animado nas perguntas e cabeçalho fixo com blur sobre o hero.

Tipografia auto-hospedada via Fontsource: **Space Grotesk** variável (títulos em caixa alta, palavras vazadas em contorno) e **Instrument Serif** itálica (palavras de acento em lima). Apenas subconjuntos latinos são baixados pelo navegador (~44 KB).

## Executar

```sh
bun install --frozen-lockfile
bun run dev
```

Desenvolvimento em `http://127.0.0.1:5173`.

```sh
bun run check
bun run build
bun run preview
```

A prévia do build fica em `http://127.0.0.1:4173`, com resposta HTTP 404 para caminhos inexistentes. Bun 1.4.2 foi usado na implementação. As versões das dependências estão fixadas no manifesto e em `bun.lock`; TypeScript 6 é usado por compatibilidade com svelte-check.

## Entrega

- Home teaser: sinal de lançamento, três pistas numeradas, manifesto pinado, transmissões com as imagens geradas do kit, ritual de acesso em três passos e perguntas crípticas.
- `/contato/`: página-porta sem formulário — um único link para o direct.
- `/privacidade/`: descrição factual desta versão (sem coleta, sem cookies); política final pendente.
- 404 com navegação de retorno, inclusive sem JavaScript.

As páginas são pré-renderizadas em HTML via [adapter-static do SvelteKit](https://svelte.dev/docs/kit/adapter-static). Sem JavaScript, conteúdo, navegação e o caminho de acesso continuam disponíveis. Não há backend de contato, formulário, persistência, analytics ou transmissão automática.

## Organização

- `src/lib/content/site.ts`: configuração e conteúdo do teaser (sinais, manifesto, transmissões, ritual, perguntas).
- `src/lib/components/`: header fixo, footer, encerramento, SEO e 404.
- `src/routes/`: páginas públicas.
- `src/lib/styles.css`: temas claro (padrão) e escuro via `data-theme` e tokens semânticos, seções e estados responsivos.
- `static/assets/`: marca, cartão social e imagens geradas (`images/`).
- `scripts/`: validação do conteúdo, pós-build e servidor de prévia local.
- `tests/`: navegação, acessibilidade, ausência de JS, orçamento e links.
- `artifacts/`: capturas do site produzidas durante os testes.

## Verificar

```sh
bunx playwright install chromium
bun run build
bun run test:e2e
bun run format:check
```

Os testes iniciam a prévia automaticamente. Verificam 320, 360, 390, 768, 1280 e 1440 px, zoom CSS de 200%, movimento reduzido, funcionamento sem JS, links internos, destino do Instagram e auditoria axe — esta última executada com movimento reduzido para auditar o estado final, não quadros de animação. A auditoria automática não substitui testes com leitor de tela ou aparelhos físicos.

## Publicação

O diretório `build/` é a entrega estática. A hospedagem deve servir `rota/index.html` para cada rota e `404.html` com status 404 para caminhos desconhecidos. Não configurar fallback de SPA para `index.html`. `bun run preview` é apenas um servidor local de verificação.

Antes de publicar:

1. Confirmar aquisição e configuração do domínio e do responsável.
2. Inventariar os dados da hospedagem e finalizar a política de privacidade em `/privacidade/`.
3. Definir `publicDomain` em `src/lib/content/site.ts` com a origem HTTPS confirmada e gerar novo build. Isso habilita canonical, Open Graph com URL absoluta, sitemap e robots para indexação. Sem domínio, robots bloqueia indexação e não são emitidas URLs fictícias.
4. Configurar HTTPS e redirecionamento para a origem canônica na hospedagem escolhida.
5. Conferir o perfil `@vendua.digital` com e sem login.

O cartão social ainda é o da fase anterior e deve ser regenerado quando houver arte nova. Não houve publicação ou envio de mensagens.
