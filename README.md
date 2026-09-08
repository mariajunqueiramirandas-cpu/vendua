# Venduá

Site de apresentação implementado com **Bun, Svelte 5 e SvelteKit**, a partir de [vendua-site-kit/README.md](vendua-site-kit/README.md). O kit original permanece como referência de conteúdo e assets.

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

- Home com soluções, processo, FAQ nativa e duas visões do case.
- `/projetos/quero-pudim-gourmet/`: história, escopo e capturas originais ampliáveis.
- `/contato/`: briefing em três etapas, revisão editável, cópia e link separado para o Instagram.
- `/privacidade/`: descrição factual desta implementação, com a política final identificada como pendente.
- 404 com navegação de retorno, inclusive sem JavaScript.

As páginas são pré-renderizadas em HTML via [adapter-static do SvelteKit](https://svelte.dev/docs/kit/adapter-static). Sem JavaScript, conteúdo, capturas, FAQ, navegação e contato direto continuam disponíveis. As respostas do briefing ficam somente na memória do componente: não há backend de contato, persistência, analytics ou transmissão automática.

## Organização

- `src/lib/content/`: configuração comercial, soluções, FAQ e dados do projeto.
- `src/lib/components/`: menu, SEO, abas, modal e briefing.
- `src/routes/`: páginas públicas.
- `src/lib/styles.css`: estilos responsivos que reutilizam os tokens do kit.
- `static/assets/`: marca, decoração WebP e capturas inalteradas.
- `scripts/`: validação do conteúdo, pós-build e servidor de prévia local.
- `tests/`: testes de navegação, acessibilidade, teclado, briefing, privacidade e fallback sem JS.
- `artifacts/`: capturas do site produzidas durante os testes.

## Verificar

```sh
bunx playwright install chromium
bun run build
bun run test:e2e
bun run format:check
```

Os testes iniciam a prévia automaticamente. Verificam 320, 360, 390, 768, 1280 e 1440 px, zoom CSS de 200%, movimento reduzido, fluxo do briefing, falha da área de transferência, foco do modal, links internos e auditoria axe. A auditoria automática não substitui testes com leitor de tela ou aparelhos físicos.

## Publicação

O diretório `build/` é a entrega estática. A hospedagem deve servir `rota/index.html` para cada rota e `404.html` com status 404 para caminhos desconhecidos. Não configurar fallback de SPA para `index.html`. `bun run preview` é apenas um servidor local de verificação.

Antes de publicar:

1. Confirmar aquisição e configuração do domínio, responsável, oferta e condições de suporte com o proprietário.
2. Inventariar os dados da hospedagem e finalizar a política de privacidade em `/privacidade/`.
3. Definir `publicDomain` em `src/lib/content/site.ts` com a origem HTTPS confirmada e gerar novo build. Isso habilita canonical, Open Graph com URL absoluta, sitemap e robots para indexação. Sem domínio, robots bloqueia indexação e não são emitidas URLs fictícias.
4. Configurar HTTPS e redirecionamento para a origem canônica na hospedagem escolhida.
5. Conferir o perfil `@vendua.digital` com e sem login e testar o percurso no celular pelo Instagram.

O endereço público do case, WhatsApp e dados de identificação não foram inventados. O domínio visível nos prints não é usado como destino. Vídeo e outros cases foram omitidos por não haver conteúdo autorizado no kit. Não houve publicação ou envio de mensagens.
