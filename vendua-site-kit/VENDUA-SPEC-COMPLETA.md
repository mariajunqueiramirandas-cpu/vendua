# Venduá — Especificação completa do site

# 01 — Estratégia e escopo

## Objetivo
Transformar visitas ao perfil e indicações em conversas qualificadas sobre implantação. O site deve responder rapidamente: o que a Venduá faz, para quem, como funciona e qual evidência existe.

Público inicial: pequenos negócios de alimentação, confeitaria e delivery que recebem pedidos em canais digitais e precisam conectar a experiência de compra à rotina. Não presumir que todos vivem caos operacional; a proposta também atende conveniência, apresentação e organização.

## Posicionamento
Venduá cria lojas online com a identidade de cada negócio e automações definidas a partir da sua operação. O dono gerencia produtos e pedidos; a personalização visual é trabalho contratado da Venduá. Evitar sugerir editor visual livre ou produto de autoatendimento.

Promessa editorial: **Bonito para quem compra. Prático para quem vende.**
Assinatura de marca preservada: **Seu negócio, pronto para vender.**

## Diferenciação proposta
1. Mostrar os dois lados de uma mesma compra: vitrine e gestão, com continuidade entre eles.
2. Começar pelo trabalho real de uma confeitaria de família, com contexto e autoria.
3. Demonstrar escolhas operacionais concretas — pronta-entrega, encomendas, disponibilidade — sem despejar uma lista de tecnologia.
4. Usar um contato guiado para o visitante explicar a rotina antes de discutir funcionalidades.

Não afirmar exclusividade dessas capacidades no mercado. A originalidade é da apresentação e da combinação proposta, não uma alegação de invenção técnica.

## Três ideias de experiência
### Dois lados da mesma loja
Abas “Para quem compra” e “Para quem vende”. Cada aba mostra um print real, um título e três benefícios. O contexto do projeto permanece. A transição é curta e nunca impede a leitura.
### O caminho do pedido
Três momentos editoriais: escolher, atender, organizar. Uma linha lima contínua reaparece entre seções, traduzindo conexão. No celular vira uma pequena marca vertical; não criar animação pesada acompanhando rolagem.
### Conte sua rotina
Um briefing local de três passos monta uma mensagem editável. O visitante copia e abre o Instagram para enviar. O site não afirma que enviou um lead ou fez orçamento.

## MVP
Home; case do Quero Pudim Gourmet; página de contato com briefing; página 404; infraestrutura para privacidade conforme lançamento. Sem cadastro, painel interno da Venduá, pagamentos, blog vazio, chat de IA ou painel administrativo público.

## Evolução
P1: vídeo real e novos cases autorizados; formulário com backend e fluxo de atendimento definido; métricas com configuração revisada.
P2: páginas por segmento somente após ter oferta e conteúdo próprios; proposta comercial assistida, sem preço automático antes de validar regras.

## Conversão e medição
Conversão principal desejada: conversa qualificada recebida. Clique no Instagram é apenas intenção. Se futuramente houver analytics, separar `contact_open`, `brief_copy`, `case_open`, `demo_interest`; nunca medir clique como venda ou lead confirmado. Indicadores comerciais são apurados no atendimento: origem, segmento, problema, proposta, fechamento. Sem meta numérica arbitrária.

## Evidências e limites
A avaliação fornecida descreve funcionalidades consideradas operacionais por orientação do proprietário. Não é auditoria independente. Os prints mostram a interface em um instante, não desempenho. Não há dados suficientes para prometer economia de tempo, aumento de receita, disponibilidade contínua ou integração oficial específica do WhatsApp.


---

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


---

# 03 — Copy pronta
Textos a seguir são a proposta de publicação. Observações entre colchetes são instruções e não devem aparecer no site.

## Home
**Navegação:** Soluções · Projeto real · Como funciona · Conversar
**Rótulo:** Sites personalizados + automação
**H1:** Bonito para quem compra. Prático para quem vende.
**Introdução:** Uma loja online com a identidade do seu negócio, conectada ao atendimento e à organização dos pedidos.
**CTA principal:** Conversar sobre meu negócio
**CTA secundário:** Conhecer o projeto
**Apoio:** Começando por lojas, confeitarias e delivery.

**Faixa:** Da primeira escolha à organização do pedido.
Escolher — Uma vitrine clara para conhecer seus produtos.
Atender — Informações da loja para apoiar a conversa.
Organizar — Pedidos conectados à rotina de quem prepara.

### Projeto real
**Rótulo:** Feito para uma rotina de verdade
**H2:** Dois lados da mesma loja.
**Texto:** No Quero Pudim Gourmet, a experiência de quem compra encontra a organização de quem faz os doces.
**Aba 1:** Para quem compra
**Título:** O cuidado da marca começa na vitrine.
**Texto:** Identidade própria, cardápio e um caminho claro até o pedido.
**Benefícios:** Visual personalizado · Escolha de produtos · Retirada e entrega
**Legenda:** Página inicial do Quero Pudim Gourmet. Captura fornecida pelo responsável pelo projeto.
**Aba 2:** Para quem vende
**Título:** A operação também faz parte do projeto.
**Texto:** Um painel reúne atalhos para acompanhar pedidos, estoque e produção.
**Benefícios:** Pedidos · Disponibilidade · Rotina de produção
**Legenda:** Visão geral da gestão do Quero Pudim Gourmet. Dados do momento da captura.
**Link:** Conheça o Quero Pudim Gourmet

### Soluções
**H2:** O que faz sentido para o seu negócio?
**Loja online:** Seu catálogo em uma experiência feita para a sua marca. Produtos, escolhas e pedidos organizados em um site personalizado.
**Atendimento conectado:** Automações no WhatsApp para apoiar dúvidas e etapas do atendimento, conforme as necessidades e integrações do projeto.
**Gestão da rotina:** Recursos para acompanhar pedidos e disponibilidade, considerando como seu negócio trabalha.
**Nota:** Funcionalidades e integrações são definidas na proposta de cada projeto.

### Processo
**H2:** Primeiro, entendemos sua rotina.
01 — Conversa: Você conta o que vende e como atende hoje.
02 — Proposta: Definimos o escopo, o investimento e o prazo.
03 — Criação: Desenvolvemos, configuramos e testamos a solução.
04 — Lançamento: Colocamos o projeto em operação e alinhamos o acompanhamento contratado.

### FAQ
**O site pode ter a identidade da minha marca?** Sim. O visual é personalizado para o seu negócio e faz parte do escopo de criação.
**Vou conseguir gerenciar produtos e pedidos?** Os recursos de gestão são definidos no projeto. Na demonstração, mostramos como funciona a rotina do lojista.
**Preciso contratar todas as funcionalidades?** Não. A proposta considera suas necessidades e a compatibilidade entre os recursos escolhidos.
**Quanto custa e quanto tempo leva?** Investimento e prazo dependem do escopo. A conversa inicial ajuda a definir uma proposta adequada ao projeto.
**Posso ver funcionando?** Sim. Peça uma demonstração pelo direct da Venduá.

### Encerramento
**H2:** Como os pedidos chegam até você hoje?
**Texto:** Conte sua rotina. Vamos conversar sobre uma solução que faça sentido para o seu negócio.
**CTA:** Começar a conversa
**Rodapé:** Venduá — Seu negócio, pronto para vender.
**Link social:** Instagram · @vendua.digital

## Case: Quero Pudim Gourmet
**Rótulo:** Projeto / Loja online e operação
**H1:** Quero Pudim Gourmet: da vitrine à cozinha.
**Resumo:** Uma loja de pudins de família foi o ponto de partida para conectar identidade, compra, atendimento e gestão.

**H2:** O projeto começou perto.
A primeira loja do portfólio da Venduá é a confeitaria da mãe do Vini. O trabalho parte de uma rotina concreta: apresentar os doces, receber pedidos e organizar o que precisa ser preparado.

**H2:** Uma vitrine com o cuidado da marca.
O site apresenta a identidade do Quero Pudim Gourmet e conduz o cliente pelo catálogo e pela compra. A experiência considera os produtos e as opções oferecidas pela loja.

**H2:** Cada tipo de pedido tem sua rotina.
Pronta-entrega e encomendas pedem regras diferentes. O projeto contempla disponibilidade, antecedência e organização dos pedidos para apoiar a operação.

**H2:** O trabalho continua depois da compra.
Atendimento no WhatsApp e ferramentas de gestão complementam a loja online. O painel reúne pedidos, estoque e atalhos da rotina de produção.

**Fechamento:** Este é o primeiro projeto do nosso portfólio. As funcionalidades de cada nova implantação são definidas conforme o negócio.
**CTA:** Quero conversar sobre algo assim
[Não incluir nota 9/10 da avaliação interna como prova comercial, depoimentos ou resultados não medidos. Link “Visitar loja” apenas quando o endereço público correto estiver confirmado.]

## Contato
**H1:** Conta um pouco do seu negócio.
**Intro:** Prepare uma mensagem rápida para começarmos a conversa pelo Instagram. Você poderá revisar tudo antes de enviar.
**Pergunta 1:** O que você vende?
**Opções:** Confeitaria · Alimentação e delivery · Outros produtos · Serviços
**Pergunta 2:** Como recebe pedidos hoje?
**Opções:** WhatsApp · Instagram · Site · Presencial · Outro
**Pergunta 3:** O que quer facilitar primeiro?
**Opções:** Apresentar meus produtos · Receber pedidos · Organizar a operação · Apoiar o atendimento · Ainda estou entendendo
**Campo opcional:** Quer acrescentar algum detalhe?
**Botões:** Voltar · Continuar · Revisar mensagem · Copiar mensagem · Abrir Instagram
**Apoio:** Depois de copiar, abra o Instagram e cole a mensagem no direct. Nada é enviado automaticamente.
**Atalho:** Prefiro falar direto no Instagram
**Sucesso ao copiar:** Mensagem copiada. Agora você pode colar no direct.
**Falha ao copiar:** Não foi possível copiar automaticamente. Selecione e copie o texto abaixo.

## Mensagem montada
Oi, Vini! Conheci a Venduá pelo site. Meu negócio é de {segmento}, recebo pedidos por {canais} e quero facilitar {objetivo}. {detalhe_opcional} Podemos conversar?

## 404
**H1:** Esse caminho não levou a uma página.
**Texto:** Você pode voltar ao início ou conhecer nosso primeiro projeto.
**Botões:** Voltar ao início · Ver projeto


---

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


---

# 05 — Especificação funcional e critérios de aceite

## F01 Navegação
Rotas acessíveis por URL direta. Links âncora chegam ao título correto sem ficar sob header. Menu mobile informa estado expandido, fecha por Escape e ao escolher item. Se modal, foco permanece dentro até fechamento. Aceite: teclado acessa todos os destinos, sem depender de hover.

## F02 Duas visões
Estado inicial: cliente. Escolher “Para quem vende” muda apenas imagem, título, legenda e benefícios da seção. Mantém foco na aba. Não reinicia rolagem. HTML contém ambas as visões para fallback. Aceite: cada aba mostra o print correto e pode ser selecionada por teclado; nada inventa atualização em tempo real.

## F03 Capturas
Usar PNGs originais e seus derivados WebP sem redesenho generativo. Recortar somente navegador e espaços dispensáveis, preservando a UI. Captura não deve ser um link ativo para /admin. Ampliar abre visualização, não o painel real. Aceite: valores e textos da captura permanecem fiéis, sem dados pessoais; legendas identificam contexto temporal.

## F04 Briefing local
Estado: step (1–4), segmento único, canais múltiplos, objetivo único, detalhe opcional, mensagem editável, copyStatus (idle/success/error).
Validações: segmento e objetivo obrigatórios; pelo menos um canal; detalhe máximo 500 caracteres. Mostrar erro junto ao campo, ligar aria-describedby e focar primeiro erro. Não exigir nome, telefone ou e-mail no MVP.
Voltar preserva respostas na memória da página. Atualizar a página reinicia e isso não deve surpreender: não anunciar salvamento. Não usar localStorage para essas respostas na versão inicial.
Resumo é editável. Copiar usa texto puro. Se clipboard falhar, manter textarea selecionável e mensagem de falha. “Abrir Instagram” é um link separado para https://www.instagram.com/vendua.digital/ e não transmite as respostas pela URL. Não abrir automaticamente duas janelas. O perfil pode exigir login: oferecer também o @ como texto copiável.
Sem backend: não há loading de envio, confirmação de recebimento, promessa de retorno em X horas ou gravação de contato. Aceite: nenhuma chamada de rede contém respostas; abrir canal não limpa resumo; todos os caminhos funcionam sem API comercial.

## F05 FAQ
Estado expandido associado ao botão, perguntas continuam indexáveis. Sem navegação de página ao expandir. Aceite: operável por Tab, Enter e Espaço.

## F06 Mídia opcional
Se vídeo existir, exibir poster real, controles, legenda textual e duração informativa. Sem autoplay com áudio. Se faltar, omitir componente inteiro. Aceite: nenhuma URL de arquivo inexistente ou player quebrado.

## F07 Erros e estados vazios
404 tem retorno. Falha de imagem conserva legenda e texto, além de alt útil. Se conteúdo de case não estiver configurado, falhar no build em vez de exibir cliente fictício. Contato direto sempre disponível como alternativa ao briefing.

## F08 Configuração de publicação
publicDomain: vazio até confirmado; instagramUrl: endereço confirmado acima; publicCaseUrl: opcional e vazio; whatsappNumber: vazio; analyticsEnabled: false; contactMode: instagram.
Não usar opensaga.xyz automaticamente como destino de marketing só por aparecer nos prints. Não criar número de WhatsApp, e-mail, CNPJ ou endereço fictícios.

## F09 Acessibilidade, requisitos do projeto
Alvo de contraste: texto normal 4.5:1, texto grande 3:1; foco visível, alvos mínimos 44×44 px. Alt vazio nas esculturas decorativas. Capturas têm descrição do propósito e legenda; texto comercial não fica só em imagens. Documento pt-BR, um H1 por página e níveis de títulos coerentes. Zoom 200% sem perder controles. Esses são critérios internos de implementação; validar manualmente além de ferramenta automática.


---

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


---

# 07 — Validação e lançamento

## Checklist verificável
| Área | Verificação | Resultado esperado |
|---|---|---|
| Marca | Buscar “Quero Pudim” em textos públicos | Nome completo Quero Pudim Gourmet; original do print preservado |
| Navegação | Abrir rotas e links diretamente | Sem links mortos, âncoras corretas |
| Mobile | 360, 390 e 768 px | Sem overflow, CTA acessível, textos legíveis |
| Desktop | 1280 e 1440 px | Container e hierarquia preservados |
| Teclado | Percorrer menu, abas, FAQ, briefing e modal | Ordem lógica, foco visível e restaurado |
| Zoom | 200% | Conteúdo e controles utilizáveis |
| Movimento | Redução de movimento ativa | Sem transições não essenciais |
| Briefing | Completar, voltar, revisar | Dados preservados enquanto página permanece aberta |
| Clipboard | Negar permissão ou indisponibilizar API | Texto copiável manualmente e erro compreensível |
| Privacidade | Inspecionar chamadas de rede no briefing | Respostas não enviadas automaticamente |
| Mídia | Conferir arquivos e proporções | Sem imagem esticada ou vídeo inexistente |
| Case | Comparar com prints originais | Sem alteração de métricas, identidade ou UI |
| Contato | Abrir perfil com e sem login | Link válido, @ disponível como alternativa |
| Sem JS | Desabilitar scripts | Proposta, case e contato ainda acessíveis |
| SEO | Ver title, description e canonical | Domínio confirmado, conteúdo específico |

## Portões comerciais
Confirmar escopo que pode ser oferecido hoje, nome do responsável, domínio adquirido e endereço correto da loja se houver link externo. Decidir política e canal de suporte antes de anunciá-los. Conferir que captura não contém dados pessoais. Não inserir logos de clientes adicionais sem projeto real.

## Portões técnicos
Build sem falhas, assets resolvidos, 404 configurado, HTTPS da hospedagem, redirecionamento canônico, ausência de segredos no bundle, proteções apropriadas no eventual backend futuro. Não incluir credenciais do projeto Quero Pudim Gourmet.

## Depois de publicar
Testar pelo celular a partir do link do Instagram. Confirmar que o caminho de contato termina em conversa possível. Registrar dúvidas reais dos primeiros visitantes e revisar copy. Substituir prints quando a interface mudar; anexar data e contexto no inventário. Avaliar inclusão de vídeo real antes de adicionar mais decoração.

## O que este pacote valida
Coerência dos documentos, inventário de assets e arquivos locais. Não valida desempenho de site, rotas implementadas, APIs, aquisição do domínio ou resultados comerciais, pois não há site implementado neste escopo.


---

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
