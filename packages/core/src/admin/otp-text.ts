export type MerchantOtpPurpose = 'login' | 'signup';

const CODE_LABEL: Record<MerchantOtpPurpose, string> = {
  login: 'Seu código Venduá:',
  signup: 'Seu código para criar a loja na Venduá:',
};

export function merchantOtpText(purpose: MerchantOtpPurpose, code: string, ttlMin: number): string {
  return `${CODE_LABEL[purpose]} ${code}\n\nVale por ${ttlMin} minutos.`;
}

/** Never import a Venduá code as conversation context, even if it was pasted back to us. */
export function containsMerchantOtp(text: string): boolean {
  return Object.values(CODE_LABEL).some((label) => {
    const i = text.indexOf(label);
    return i >= 0 && /^\s*\d{6}\b/.test(text.slice(i + label.length));
  });
}
