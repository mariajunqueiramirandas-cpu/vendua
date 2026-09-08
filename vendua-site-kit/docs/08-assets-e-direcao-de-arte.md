# 08 — Assets e direção de arte

## Mapa de uso
| Arquivo/grupo | Aplicação | Tratamento |
|---|---|---|
| brand/mark-*.svg | header, favicon, assinatura | Vetorial, não rasterizar no site |
| brand/wordmark-*.svg | marca horizontal | Texto vivo; fonte local ou fallback |
| icons/*.svg | soluções, passos e UI | 24×24, stroke consistente |
| images/hero-ribbon* | coluna decorativa do hero | Sem texto sobre a escultura; alt vazio |
| images/operation-bridge* | transição operação/case | Usar no máximo uma vez por página |
| images/modular-detail* | detalhe de solução/contato | Opcional, evitar excesso visual |
| images/social-card.png | Open Graph | Exportação institucional 1200×630 |
| projetos/*original.png | edição e comprovação da fonte | Prints fornecidos, inalterados |
| projetos/*web.webp | exibição inicial do case | Mesma captura, só conversão e redução |

Todos os visuais necessários para o MVP estão neste pacote. Não é necessário adicionar banco de fotos. Vídeo real é uma melhoria futura e não está incluído.

## Assets gerados por IA
Três esculturas abstratas novas, criadas com a ferramenta de imagem. Servem à direção visual, não representam funcionalidades nem o produto em operação. Os prompts são preservados em `design/prompts-imagens.md`. PNGs originais e derivados WebP ficam juntos. Não remover informações de origem como requisito deste design.

## Assets vetoriais
Símbolo V e ícones construídos como SVG editável. O V é uma interpretação simples da identidade já usada, não reprodução exata da arte raster. Ícones: loja, conversa, pedido, engrenagem, seta, check, mais e fechar. Cor herdável nos ícones; usar inline SVG para controlar currentColor. Wordmark em arquivo tem fonte fallback — validar antes de fechar marca definitiva.

## Capturas reais
Fontes: imagens enviadas pelo usuário nesta conversa. Loja: `6b33885c-edbb-4bed-bad0-251d59a8c06c.png`; gestão: `9d9238a4-89e3-4db8-b30c-7d69ad876180.png`. O endereço de navegador não é confirmação do domínio público de lançamento. No pacote, originais são preservados; derivados para web também preservam o conteúdo. Uma futura composição pode recortar a barra de navegador sem redesenhar a interface.

## Regras de composição
Não converter painel desktop em um falso app de celular. Não gerar fotos de clientes, pedidos, métricas ou depoimentos. Não deixar pequenas letras da UI sustentarem toda a explicação: título, benefícios e legenda externos cumprem essa função. O logo Quero Pudim Gourmet dentro do print mantém sua própria paleta.

## Acessibilidade das imagens
Esculturas: alt="". Loja: “Página inicial do Quero Pudim Gourmet com apresentação dos doces e acesso ao cardápio.” Gestão: “Visão geral da gestão do Quero Pudim Gourmet com pedidos, estoque e atalhos de produção.” Prancha e social card contêm texto; seu conteúdo essencial também existe na documentação ou página.
