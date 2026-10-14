// Branded HTML shell for outbound mail; email clients need table layout + inline styles (no flex/grid/CSS vars).

const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// blank line = paragraph break, single newline = <br>
const bodyHtml = (body: string): string =>
  esc(body)
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 18px 0;">${p.replaceAll(/\r?\n/g, '<br>')}</p>`)
    .join('');

const mailboxOf = (from?: string): string | null => {
  if (!from) return null;
  const mbox = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  return /^[^@\s]+@[^@\s]+$/.test(mbox) ? mbox : null;
};

export function renderReplyEmail(opts: { body: string; subject?: string; from?: string }): string {
  const subject = opts.subject?.trim();
  const mailbox = mailboxOf(opts.from);
  const footerLine = mailbox
    ? `Fale com a gente em
            <a href="mailto:${esc(mailbox)}" style="color:#123c32;text-decoration:underline;">${esc(mailbox)}</a>
            &mdash; ou responda este e-mail, cai direto na nossa caixa de entrada.`
    : 'Responda a este e-mail &mdash; cai direto na nossa caixa de entrada.';
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${subject ? esc(subject) : 'Venduá'}</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
  @media (max-width:480px) {
    .lh-pad { padding:20px 20px !important; }
    .lh-label { display:none !important; }
    .body-pad { padding-left:24px !important; padding-right:24px !important; }
  }
</style>
<!--[if mso]><style>table,td{font-family:Arial,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f7f4ea;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Venduá respondeu a sua mensagem.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f4ea;">
<tr><td align="center" style="padding:40px 16px;">

<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

  <tr>
    <td style="padding:0 4px 14px;font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#4f6a5e;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="left" style="font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#4f6a5e;">Atendimento</td>
          <td align="right" style="font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:#4f6a5e;">auto.vendua.com.br</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="background-color:#efe9d8;border:1px solid #d9d2ba;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="lh-pad" style="background-color:#123c32;padding:30px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td width="40" height="40" align="center" valign="middle" style="background-color:#d9f875;width:40px;height:40px;">
                        <span style="font-family:'Space Grotesk',Manrope,'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:700;color:#123c32;line-height:40px;">&#10003;</span>
                      </td>
                      <td style="padding-left:14px;font-family:'Space Grotesk',Manrope,'Segoe UI',Arial,sans-serif;font-size:30px;font-weight:700;letter-spacing:-1.5px;color:#f7f4ea;line-height:1;">vendu&aacute;</td>
                    </tr>
                  </table>
                </td>
                <td align="right" valign="middle" class="lh-label" style="font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#d9f875;">Resposta</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="height:3px;line-height:3px;font-size:0;background-color:#d9f875;">&nbsp;</td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="body-pad" style="padding:36px 40px 8px;font-family:'Space Grotesk',Manrope,'Segoe UI',Arial,sans-serif;font-size:17px;line-height:1.65;color:#123c32;">
            ${subject ? `<p style="margin:0 0 20px;font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#4f6a5e;">Re: ${esc(subject)}</p>` : ''}
            ${bodyHtml(opts.body)}
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td class="body-pad" style="padding:14px 40px 36px;">
            <p style="margin:0;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-style:italic;font-size:24px;color:#123c32;">&mdash; equipe vendu&aacute;</p>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <tr>
    <td style="padding:28px 4px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-bottom:14px;font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#4f6a5e;border-bottom:1px solid #d9d2ba;">
            vendu&aacute; &middot; commerce para quem cozinha
          </td>
        </tr>
        <tr>
          <td style="padding-top:14px;font-family:'Space Grotesk',Manrope,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.6;color:#4f6a5e;">
            ${footerLine}
          </td>
        </tr>
        <tr>
          <td style="padding-top:14px;font-family:ui-monospace,'Cascadia Mono',Consolas,monospace;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#4f6a5e;">
            <a href="https://vendua.com.br" style="color:#123c32;text-decoration:none;">vendua.com.br</a>
            &nbsp;&middot;&nbsp;
            <a href="https://www.instagram.com/vendua.digital/" style="color:#123c32;text-decoration:none;">@vendua.digital</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
