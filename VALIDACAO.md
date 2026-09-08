# Verificação da implementação — 8 de setembro de 2026

Escopo: implementação do MVP descrito em `vendua-site-kit/README.md` e documentos 01–08, na raiz do workspace. Bun 1.4.2, Svelte 5, SvelteKit, adapter-static e CSS com os tokens do kit. Nenhum AGENTS.md ou convenção adicional de repositório foi encontrado. O kit original foi preservado.

## Critérios funcionais

| Critério | Evidência atual |
| --- | --- |
| F01 — navegação | Cinco destinos testados por URL direta; links internos resolvidos; âncora de soluções alcança a seção; menu mobile fecha com Escape e seleção e informa `aria-expanded`. |
| F02 — duas visões | Abas com setas e Home, seleção e foco verificados; gestão usa admin-web.webp; os dois painéis existem no HTML e ficam visíveis sem JS. |
| F03 — capturas | Quatro arquivos de captura copiados byte a byte; hashes em `artifacts/asset-integrity.json`. Originais abertos e inspecionados: sem dados de clientes identificáveis visíveis. Modal amplia o PNG, permite rolagem em tamanho original, contém Tab e restaura foco ao fechar por Escape. Nenhum link para admin real. |
| F04 — briefing | Três etapas obrigatórias, canais múltiplos, limite de 500 caracteres, erro junto ao campo com descrição e foco; retorno preserva escolhas. Revisão editável, cópia confirmada pela leitura do clipboard, falha mantém seleção manual. Reload limpa escolhas. Rede monitorada sem respostas; cookies e armazenamento local/session vazios. Link separado do Instagram contém apenas o perfil. |
| F05 — FAQ | Details/summary nativos; Enter e Espaço alternam a resposta. Conteúdo funciona sem JS. |
| F06 — mídia opcional | Vídeo ausente e componente omitido. Imagens visíveis carregaram em todas as rotas e larguras. |
| F07 — erros | HTTP 404 com HTML de recuperação em caminho desconhecido, também sem JS. Falha simulada de imagem conserva alt, legenda e contato. Conteúdo e caminhos obrigatórios são validados antes do build. |
| F08 — publicação | Configuração central mantém domínio, URL pública do case e WhatsApp vazios; analytics false e contato Instagram. Canonical e URLs absolutas não são emitidos sem domínio; robots bloqueia indexação nessa condição. |
| F09 — acessibilidade | pt-BR, um H1 por página, foco visível, elementos nativos, abas e modal por teclado. Auditoria axe sem violações no conjunto testado. Layout sem overflow em 320, 360, 390, 768, 1280 e 1440 px e zoom CSS 200%; redução de movimento verificada. |

Home segue a ordem do kit: header, hero, caminho do pedido, prova com abas, três soluções, quatro passos, cinco perguntas, encerramento e rodapé. Case preserva contexto familiar, escolhas de compra, operação e limites de escopo. Nenhum preço, prazo comercial, depoimento, métrica comercial, cliente ou contato foi inventado. Fontes externas não são carregadas; usa-se o fallback Arial previsto.

## Revisão de interface

Revisão guiada por better-interface e seus seis domínios. Inspeção dos componentes, estados e capturas geradas pelo Chromium; convenções de referência: documentos 02–05 e tokens do kit.

| Domínio | Evidências inspecionadas | Resultado |
| --- | --- | --- |
| Acessibilidade | Header, abas, modal, FAQ, briefing; teclado, árvore acessível via Playwright, axe e ausência de JS | Sem achados acionáveis no escopo testado. Leitor de tela real não verificado. |
| Layout | Cinco páginas nas seis larguras; screenshots em 390 e 1440; zoom CSS 200% | Sem overflow ou controles cortados nos testes. |
| Escrita | Textos confrontados com documento 03; opções, validações, cópia e contato confrontados com ações | Copy e limitações preservadas; erros orientam recuperação. |
| Tipografia | CSS e screenshots de home, case, contato, resumo e modal | Hierarquia e quebra natural verificadas; inputs em 16 px e apoio em aproximadamente 13 px. |
| Cores | Tokens, fundos reais identificados no CSS, auditoria axe e cálculo em `artifacts/contrast.json` | Ink/paper 11,11:1; muted/paper 5,78:1; ink/lime 10,26:1; menor par de texto de apoio calculado 5,36:1. |
| UI | Estados de seleção, foco, expansão, cópia, erro e zoom; screenshots | Controles distinguíveis e estados com sinais estáticos. Sem animação obrigatória ou autoplay. |

Sem achados de interface acionáveis após as correções verificadas. **Approve** para a cobertura inspecionada; não equivale a certificação de acessibilidade ou liberação comercial de publicação.

## Comandos e resultados

- `bun install --frozen-lockfile`: instalação reproduzível, sem mudanças.
- `bun run check`: zero erros e zero avisos do svelte-check.
- `bun run build`: HTML estático, assets e 404 gerados com sucesso.
- `bun run test:e2e`: **15 testes aprovados**, incluindo todas as larguras, teclado, briefing, falha de clipboard, ausência de JS, rede, axe, zoom, links, SEO, desempenho e falha de imagem.
- `bun run format:check`: todos os arquivos cobertos formatados.
- Comparação SHA-256: capturas públicas idênticas às respectivas fontes do kit.

Em viewport de 390 px, a soma das respostas iniciais foi **207.997 bytes**, comprimindo HTML/CSS/JS/SVG com gzip para comparação com o orçamento. JavaScript: **38.517 bytes gzip**. Hero: variante WebP 640 de 7.514 bytes; nenhuma fonte baixada e nenhum PNG original carregado antes da ampliação. Detalhamento em `artifacts/performance.json`. Medição local, sem simular latência de produção; não é resultado de Core Web Vitals nem garantia de desempenho de hospedagem.

## Limites e lançamento

Não verificados: leitor de tela real, aparelhos físicos, Safari/Firefox, zoom da interface nativa do navegador (foi usado zoom CSS), sessão autenticada e desautenticada do Instagram, infraestrutura de produção e suas regras de logs, HTTPS e redirecionamento. A presença e o destino correto do link de Instagram foram verificados localmente; nenhuma mensagem foi enviada.

Domínio adquirido, oferta comercial, suporte, identificação do responsável e política final dependem das confirmações já apontadas no kit. O endereço público da loja continua omitido. Esses itens estão documentados em `README.md`; não são preenchidos ficticiamente. Não houve deploy.
