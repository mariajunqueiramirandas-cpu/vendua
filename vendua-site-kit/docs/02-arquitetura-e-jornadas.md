# 02 — Arquitetura e jornadas

## Rotas
| Rota | Função | CTA principal |
|---|---|---|
| `/` | Apresentar proposta e prova | Conversar sobre meu negócio |
| `/projetos/quero-pudim-gourmet` | Demonstrar projeto real | Quero conversar sobre algo assim |
| `/contato` | Preparar conversa com briefing | Copiar mensagem e abrir Instagram |
| `/privacidade` | Descrever tratamento efetivo, quando validado | Contato do responsável |
| rota inexistente | Recuperar navegação | Voltar ao início |

Navegação da home: Soluções (#solucoes), Projeto real (#projeto), Como funciona (#processo), Conversar (/contato). Wordmark volta ao início. Rodapé repete contato e identificação comercial disponível.

## Home, ordem final
1. Header discreto: marca, links, botão. Em telas estreitas, marca e botão de menu.
2. Hero dividido: texto 55%, composição visual 45%; título e CTA continuam úteis sem imagem. Eyebrow “Sites personalizados + automação”.
3. Faixa de contexto: “Da primeira escolha à organização do pedido.” Três momentos, sem contadores.
4. Dois lados da mesma loja: apresentação do case com abas e captura real; link para aprofundar. Esta é a primeira prova substancial.
5. Soluções: três linhas editoriais de largura total — Loja online, Atendimento conectado, Gestão da rotina. Evitar nove cartões iguais.
6. Processo: quatro passos de contratação, sem prometer tempo fixo.
7. FAQ: cinco dúvidas essenciais, com respostas diretas.
8. Encerramento verde com convite para explicar a rotina; rodapé.

## Case
Abertura com nome completo, contexto familiar e escopo. Print da loja com legenda. Texto sobre escolhas de compra e identidade. Print da gestão com legenda. Lista curta de capacidades confirmadas, distinguindo atendimento e operação. Nota de que escopo varia por projeto. CTA para contato. Vídeo é opcional: não deixar player vazio se não houver arquivo.

## Responsividade
Desktop: largura útil máxima 1200 px, 12 colunas, respiro 24–48 px. Hero em duas colunas. Capturas dentro de quadro amplo, sem dispositivos inclinados.
Tablet: hero com texto em cima; benefícios em duas colunas apenas quando couberem.
Mobile: uma coluna, 20 px de margem, títulos com quebra natural, CTA principal cheio. Abas permanecem em uma linha se couberem; nunca cortar rótulos. Print acompanhado de botão “Ampliar imagem”; não exigir leitura dos menus pequenos para compreender o benefício.

## Jornadas
Instagram → home → case → contato: fluxo padrão de descoberta.
Indicação → case → contato: header e CTA do case não dependem de passagem pela home.
Visitante já decidido → botão da navegação → contato: no máximo uma mudança de página.
Pessoa sem JavaScript: lê conteúdo e acessa link direto para Instagram; as duas visões do case devem ter conteúdo disponível em HTML.

## Wireframe textual de conteúdo
Hero: rótulo / título / parágrafo / dois CTAs / visual decorativo.
Case interativo: nome / introdução / abas / imagem + legenda / três benefícios / link do case.
Briefing: progresso / pergunta / opções / voltar e continuar / resumo editável / copiar / abrir canal.

Não há rolagem horizontal como requisito, carrossel automático, cursor customizado ou vídeo tocando com som.
