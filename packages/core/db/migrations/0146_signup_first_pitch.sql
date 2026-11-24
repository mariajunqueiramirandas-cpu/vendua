-- The CRM can save default pitch fields alongside custom copy. Refresh only exact copies.
with defaults(field, old_text, new_text) as (
  values
    ('product',
      'Venduá: plataforma que coloca no ar, em poucos dias, a loja online própria de um pequeno negócio de comida, com catálogo, pedidos e pagamento integrados.',
      'A Venduá oferece uma loja online própria e um app pra cuidar do cardápio, dos pedidos, dos horários e dos pagamentos. O negócio pode compartilhar o link pelo WhatsApp ou Instagram. O cliente pede pela loja e o pedido chega no app.'),
    ('audience',
      'donos de pequenos negócios de comida no Brasil (docerias, confeitarias, marmitas, pizzarias, padarias, lanchonetes) que hoje vendem por WhatsApp, Instagram ou marketplace',
      'quem vende ou quer começar a vender comida no Brasil e precisa de um canal próprio de pedidos'),
    ('tone',
      'direto e caloroso, como um bom vendedor brasileiro no WhatsApp: mensagens curtas, português falado, zero formalidade de e-mail',
      'português brasileiro claro e acolhedor. Responda no ritmo da pessoa com uma ideia útil por mensagem'),
    ('offerRange',
      'nenhuma condição especial pré-aprovada: desconto, teste grátis, prazo ou exceção são decisão da equipe, então escale para humano',
      'as condições padrão vêm dos planos vigentes. Descontos, prazos e outras exceções precisam de confirmação da equipe'),
    ('goal',
      'entender o negócio da pessoa e levar a um próximo passo real: uma conversa curta com a equipe',
      'ajudar a pessoa a criar a própria loja na Venduá pelo cadastro online quando ela quiser começar')
)
update control_settings as pitch
set value = pitch.value || (
  select jsonb_object_agg(field, new_text)
  from defaults
  where pitch.value ->> field = old_text
)
where pitch.key = 'pitch'
  and exists (select 1 from defaults where pitch.value ->> field = old_text);
