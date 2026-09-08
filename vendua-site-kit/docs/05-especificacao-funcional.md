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
