import { recentMerchantOtpPurpose } from '../admin/auth.ts';
import { containsMerchantOtp } from '../admin/otp-text.ts';
import type { Sql } from '../platform/db.ts';
import { optKeyword, phoneForJid } from '../store-whatsapp/text.ts';

export type WhatsAppIntake =
  | 'conversation'
  | 'spam'
  | 'automated-reply'
  | 'code'
  | 'receipt'
  | 'login-help'
  | 'signup-help'
  | 'customer-help';

const CODE = /^\d{3}[ -]?\d{3}[?!.]?$/;
const CONTEXTUAL_CODE = /\b(?:o |meu )?codigo\s*(?:e\b)?\s*[:=-]?\s*\d{3}[ -]?\d{3}\b/;
const LABELED_CODE =
  /\bcodigo (?:de (?:acesso|login|verificacao|confirmacao)|da vendua)(?:\s+e\b)?\s*[:=-]?\s*\d{3}[ -]?\d{3}\b/;
const RECEIPT =
  /^(?:ok(?: (?:obrigad[oa]|valeu|recebi))?|obrigad[oa](?: (?:pelo codigo|recebi))?|brigad[oa]|valeu(?: (?:pelo codigo|recebi))?|recebi(?: o codigo)?|recebido|deu certo|funcionou|ja (?:recebi|consegui|entrei))$/;

const ACCOUNT =
  /\b(?:login|senha|entrar (?:no (?:painel|app)|na (?:minha )?(?:loja|conta|vendua))|(?:acessar|acesso (?:ao|a)) (?:o |meu |a |minha )?(?:painel|conta|app)|codigo (?:de (?:acesso|login|verificacao|confirmacao)|da vendua))\b/;
const PANEL_UNAVAILABLE = /\b(?:painel nao abre|nao abre (?:o |meu )?painel)\b/;
const SIGNUP = /\b(?:cadastro|criacao da loja|criar (?:a |uma |minha )?loja)\b/;
const TROUBLE =
  /\b(?:nao (?:recebi|chega|chegou|consigo|consegui|funciona|funcionou|abre|entra|aceita|(?:to|estou) (?:conseguindo|recebendo))|expirou|invalido|incorreto|erro|esqueci|perdi|redefinir|reenviar|novo codigo|outro codigo|cade (?:o |meu )?codigo|qual (?:e )?o codigo|como (?:faco para )?(?:entrar|acessar))\b/;
const CURRENT_CUSTOMER =
  /\b(?:sou cliente(?=$|[,.!]| (?:da vendua|de voces|e (?:preciso|quero|gostaria|estou|tenho))\b)|ja tenho (?:uma |a |minha )?loja (?:na vendua|com voces)\b|minha loja (?:na vendua|com voces)\b)/;
const SUPPORT = /\b(?:suporte|ajuda|problema|cancelar|cobranca|pagamento|pedido|nao consigo)\b/;
const SALES_QUESTION =
  /\b(?:quanto custa|qual (?:e )?o (?:preco|valor)|quais (?:sao )?os planos|(?:ver|agendar) (?:uma )?demo)\b/;
const OPT_OUT_REQUEST =
  /\b(?:nao quero (?:mais )?receber|parem? de (?:enviar|mandar)|me descadastr[ea])\b/;
const SHORT_CODE_QUESTION = /^(?:nao recebi(?: nada)?|nao chegou|pode reenviar)[?!.]?$/;
const AUTOMATED_REPLY =
  /(?:^|[.!?]\s+)(?:esta (?:e|foi) uma (?:mensagem|resposta) automatica|mensagem enviada automaticamente)(?=$|[.!,:])/;

function obviousSpam(text: string): boolean {
  if (!/\b(?:https?:\/\/|www\.)/.test(text)) return false;
  const startsWithCommand =
    /^(?:(?:oi|ola)[,!. ]+)?(?:clique|acesse|envie|mande|informe|compartilhe)\b/;
  if (startsWithCommand.test(text) && /\bcodigo de (?:verificacao|acesso|login)\b/.test(text))
    return true;
  return (
    /\b(?:renda garantida|lucro garantido|dinheiro facil)\b/.test(text) &&
    /(?:^|[.!?]\s+)(?:clique|acesse|invista|faca (?:um )?pix|entre no grupo)\b/.test(text)
  );
}

/** Use patterns only for narrow intents. Ordinary greetings and ambiguous messages are conversations. */
export async function inspectWhatsAppIntake(
  sql: Sql,
  m: { body: string; from: string; fromAlias?: string | null; receivedAt: Date | null },
): Promise<WhatsAppIntake> {
  if (containsMerchantOtp(m.body)) return 'code';
  const text = m.body
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (LABELED_CODE.test(text)) return 'code';
  if (optKeyword(text) === 'out' || OPT_OUT_REQUEST.test(text)) return 'conversation';
  if (obviousSpam(text)) return 'spam';
  if (AUTOMATED_REPLY.test(text)) return 'automated-reply';

  const code = CODE.test(text) || CONTEXTUAL_CODE.test(text);
  const receipt = RECEIPT.test(
    text
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  const trouble = TROUBLE.test(text);
  const signup = SIGNUP.test(text);
  const help =
    PANEL_UNAVAILABLE.test(text) ||
    (trouble && (ACCOUNT.test(text) || (signup && /\bcodigo\b/.test(text))));
  if (!code && SALES_QUESTION.test(text)) return 'conversation';
  if (help && code) return 'code';
  if (help) return signup ? 'signup-help' : 'login-help';

  const unclearHelp = (trouble && /\bcodigo\b/.test(text)) || SHORT_CODE_QUESTION.test(text);
  if (code || receipt || unclearHelp) {
    const phone = phoneForJid(m.from) ?? phoneForJid(m.fromAlias);
    const purpose =
      phone && m.receivedAt && (await recentMerchantOtpPurpose(sql, phone, m.receivedAt));
    if (purpose) {
      if (code) return 'code';
      if (receipt) return 'receipt';
      return purpose === 'signup' ? 'signup-help' : 'login-help';
    }
  }

  return CURRENT_CUSTOMER.test(text) && !/\bnao sou cliente\b/.test(text) && SUPPORT.test(text)
    ? 'customer-help'
    : 'conversation';
}

export function intakeHelpText(
  route: 'login-help' | 'signup-help' | 'customer-help',
  origin?: string | null,
): string {
  if (route === 'customer-help') {
    const help = origin
      ? `Ajuda no painel da sua loja (${origin}/admin/ajuda)`
      : 'Ajuda no painel da sua loja';
    return `Pra falar com o suporte da Venduá, entre com o número cadastrado na sua loja e abra ${help}.`;
  }
  const signup = route === 'signup-help';
  const path = signup ? '/admin/comecar' : '/admin/entrar';
  const page = signup ? 'a tela de cadastro' : 'a tela de entrada';
  const where = origin ? `${page} da Venduá (${origin}${path})` : `${page} da Venduá`;
  return `Abra ${where} e peça um novo código. Digite o código só nessa tela.`;
}
