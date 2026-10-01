import type { ImportLost, MenuImport } from '../../lib/api.ts';

// Words for the menu import. Core sends codes (docs/menu-import.md §4.3 `Lost`); what the
// merchant reads lives here, in their terms: what stayed behind and where to set it up.

export const PLATFORM: Record<string, string> = {
  instadelivery: 'Instadelivery',
  cardapioweb: 'Cardápio Web',
  olaclick: 'OlaClick',
  deliverydireto: 'Delivery Direto',
  takeat: 'Takeat',
  saipos: 'Saipos',
  goomer: 'Goomer',
  anotaai: 'anota.ai',
  ifood: 'iFood',
};

export const platformName = (p: string | null | undefined) => (p && PLATFORM[p]) || 'outro app';

/** Codes that mean "the product came over hidden, for you to check before showing it". */
const HIDES = new Set([
  'price_out_of_range',
  'too_many_option_groups',
  'too_many_options',
  'options_unreadable',
  'price_mismatch',
  'kit_unresolved',
  'promo_unreadable',
  'pizza_pricing',
  'pizza_sizes',
  'second_price',
  'sold_by_weight',
]);

export const hidesProduct = (l: ImportLost) => l.scope === 'product' && HIDES.has(l.code);

const q = (s: string | undefined) => (s ? `“${s}”` : 'um produto');

/** One sentence per thing that didn't come over (or came over changed). */
export function lostLine(l: ImportLost, platform: string): string {
  const from = platformName(platform);
  const s = q(l.subject);
  const d = l.detail;
  switch (l.code) {
    // ── hidden for review
    case 'price_out_of_range':
      return `${s} veio sem um preço que dê para usar.`;
    case 'too_many_option_groups':
      return `${s} tem mais de 12 grupos de opções.`;
    case 'too_many_options':
      return `${s}: o grupo ${q(d)} tem mais de 40 opções.`;
    case 'options_unreadable':
      return d
        ? `${s}: não conseguimos ler as opções de ${q(d)}.`
        : `${s}: não conseguimos ler as opções.`;
    case 'price_mismatch':
      return `${s}: com os descontos das opções, o preço podia ficar negativo.`;
    case 'kit_unresolved':
      return `O combo ${s} usa itens que não vieram. Monte o combo de novo.`;
    case 'promo_unreadable':
      return `${s} tem um desconto que não conseguimos ler. Confira o preço.`;
    case 'pizza_pricing':
      return `${s}: o jeito de cobrar os sabores${d ? ` de ${q(d)}` : ''} não tem igual aqui. Confira o preço em Opções antes de mostrar.`;
    case 'sold_by_weight':
      return `${s} é vendido por peso no ${from}. Aqui o preço é por unidade: confira antes de mostrar.`;
    case 'second_price':
      return `${s} tem dois preços no ${from}. Confira qual vale e mostre.`;
    case 'pizza_sizes':
      return `${s} tem preço por tamanho. Confira os tamanhos em Opções.`;

    // ── products and categories
    case 'hidden_items':
      return `A categoria ${s} veio vazia: os itens dela estão ocultos no ${from}. Mostre lá e importe de novo, ou cadastre aqui.${d ? ' A descrição dela também ficou de fora.' : ''}`;
    case 'empty_category':
      return `A categoria ${s} não tinha produtos.`;
    case 'category_image':
      return `A foto da categoria ${s} não vem: aqui as categorias não têm foto.`;
    case 'pizza_flavours':
      return `Em ${s}, cada sabor veio como um produto. Pizza meio a meio você monta em Opções.`;
    case 'dine_in_only':
      return `${s} é só para consumo no local e ficou de fora.`;
    case 'never_available':
      return `${s} não está à venda em nenhum dia e ficou de fora.`;
    case 'minimum_quantity':
      return `${s} pedia no mínimo ${d ?? 'algumas'} unidades. Aqui não tem mínimo por produto.`;
    case 'link_discount':
      return `${s} tinha ${d ? `${d}% de ` : ''}desconto só para quem abria o link dele. Aqui veio pelo preço do cardápio; para um desconto, crie um cupom em Marketing.`;
    case 'free_delivery':
      return `${s} tinha entrega grátis. Aqui a entrega grátis é por região, em Loja › Entrega.`;
    case 'name_shortened':
      return `O nome ${s} era comprido e foi encurtado.`;
    case 'description_shortened':
      return `A descrição de ${s} era comprida e foi encurtada.`;
    case 'tags_dropped':
      return `${s} tinha mais de 12 selos. Ficaram os 12 primeiros.`;
    case 'photos_dropped':
      return `${s} tinha mais de 12 fotos. Ficaram as 12 primeiras.`;
    case 'availability_simplified':
      return `${s} tinha horários de venda demais. Confira em Disponibilidade.`;
    case 'photo_failed':
      return `Uma foto de ${s} não veio. Ele fica com o desenho até você colocar outra.`;

    // ── the store
    case 'loyalty':
      return `O programa de pontos${d ? ` (${d} prêmios)` : ''} e o saldo dos clientes não vêm. Aqui tem o cartão fidelidade, em Marketing.`;
    case 'cashback':
      return 'O cashback não vem.';
    case 'referral':
      return 'O programa de indicação não vem.';
    case 'instagram_points':
      return 'Os pontos por seguir no Instagram não vêm.';
    case 'birthday_message':
      return 'A mensagem automática de aniversário no WhatsApp não vem.';
    case 'miss_you_message':
      return 'A mensagem de “saudade” para quem não pede há tempo não vem.';
    case 'upsell':
      return 'A sugestão de produto no fim do pedido não vem.';
    case 'time_slots':
      return `O agendamento em horários de ${d ?? 'alguns'} em ${d ?? 'alguns'} minutos não vem.`;
    case 'coupons':
      return 'Os cupons não vêm. Crie de novo em Marketing.';
    case 'night_fee':
      return 'A taxa extra da noite não vem.';
    case 'dine_in':
      return 'O consumo no local não vem: aqui é entrega e retirada.';
    case 'online_payment':
      return `O pagamento online do ${from} não vem. Para cartão online, conecte o Mercado Pago em Pagamentos.`;
    case 'payment_method':
      return `A forma de pagamento ${q(d)} não tem igual aqui e ficou de fora.`;
    case 'payment_adjustment':
      if (d === 'retirada')
        return 'O desconto para quem retira na loja não vem: aqui o desconto é por forma de pagamento, em Pagamentos.';
      return `O desconto ou acréscimo para pagar com ${d ?? 'uma forma de pagamento'} não vem igual${d === 'cartão' ? ' (aqui débito e crédito são uma forma só)' : ''}. Configure em Pagamentos.`;
    case 'pix_unreadable':
      return 'Não conseguimos ler a chave Pix. Cadastre em Pagamentos.';
    case 'pix_beneficiary_shortened':
      return `O nome de quem recebe o Pix vai até 25 letras: ${d ? q(d) : 'o nome'} foi encurtado. Confira em Pagamentos.`;
    case 'pix_city_shortened':
      return 'A cidade do Pix vai até 15 letras e foi encurtada.';
    case 'delivery_fees_unreadable':
      return 'Não conseguimos ler as taxas de entrega. Cadastre as regiões em Loja › Entrega.';
    case 'delivery_gap':
      return `No ${from}, não havia entrega na faixa até ${d ?? '?'} km, dentro da área. Aqui cada faixa por km é um círculo inteiro, então quem mora ali cai na faixa seguinte e pode pedir. Se não entrega lá, desenhe a área em Loja › Entrega.`;
    case 'delivery_fee_later':
      return `No ${from}, a taxa de entrega era combinada depois do pedido. Aqui a taxa vem da região: se você entrega, cadastre as regiões em Loja › Entrega.`;
    case 'delivery_flat_fee':
      return `No ${from}, a entrega ${d === 'grátis' ? 'era grátis' : `custava ${d ?? 'o mesmo'}`} para qualquer endereço. Aqui a entrega é por região: cadastre a sua área em Loja › Entrega.`;
    case 'free_delivery_rule':
      return `A entrega grátis do ${from} não vem. Configure por região em Loja › Entrega.`;
    case 'delivery_distance_straight_line':
      return 'As taxas por km aqui contam a distância em linha reta, não pelo caminho.';
    case 'announcement_shortened':
      return 'A mensagem de boas-vindas era comprida e foi encurtada.';
    case 'whatsapp_invalid':
      return 'O WhatsApp da loja não parecia um número com DDD e ficou de fora.';
    case 'hours_dropped':
      return 'Havia horários demais. Ficaram os 28 primeiros.';
    case 'zone_dropped':
      return `A região de entrega ${q(d)} não veio.`;
    case 'zones_dropped':
      return 'Havia regiões de entrega demais. Ficaram as 100 primeiras.';
    case 'logo_failed':
      return 'A logo não veio. Coloque em Loja › Perfil.';
    case 'cover_small':
      return `A foto de capa veio pequena${d ? ` (${d} px de largura)` : ''}. Uma foto maior fica mais bonita: troque em Aparência.`;
    case 'cover_failed':
      return 'A foto de capa não veio. Coloque em Aparência.';
    default:
      return l.subject ? `Algo de ${s} não veio.` : 'Uma configuração da loja não veio.';
  }
}

/** Why a link was refused, before anything was read. */
export function startError(code: string, platform: string | null | undefined): string | null {
  if (code === 'IMPORT_BLOCKED')
    return `O ${platformName(platform)} não deixa ninguém de fora ler o cardápio. Dá para cadastrar aqui mesmo: com foto, leva um minutinho por produto.`;
  if (code === 'IMPORT_UNSUPPORTED')
    return platform
      ? `Ainda não lemos cardápios do ${platformName(platform)}. Por enquanto, só do Instadelivery.`
      : 'Esse link não parece de um cardápio que a gente lê. Por enquanto, só do Instadelivery: instadelivery.com.br/sualoja.';
  if (code === 'IMPORT_RATE_LIMITED')
    return 'Foram muitas tentativas nesta hora. Espere um pouco e tente de novo.';
  if (code === 'BAD_REQUEST') return 'Cole o link inteiro, como instadelivery.com.br/sualoja.';
  return null;
}

/** Why reading the store failed. */
export function readError(imp: MenuImport): string {
  const from = platformName(imp.platform);
  switch (imp.errorCode) {
    case 'NOT_FOUND':
      return `Não achamos essa loja no ${from}. Abra a loja no celular e copie o link da barra de endereço.`;
    case 'BLOCKED':
      return `O ${from} não deixou a gente ler a loja agora. Tente de novo mais tarde.`;
    case 'TOO_LARGE':
      return 'O cardápio é grande demais para trazer de uma vez. Fale com a gente pela Ajuda.';
    case 'TIMEOUT':
      return `O ${from} demorou demais para responder. Tente de novo em instantes.`;
    default:
      return 'A loja abriu, mas não conseguimos entender o cardápio. Conte pela Ajuda que a gente olha.';
  }
}
