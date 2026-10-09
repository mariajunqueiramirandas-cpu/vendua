import { Mail, MessageCircle, Phone, type LucideIcon } from 'lucide-react';
import { mailHref, telHref, waHref } from '@/lib/contact.ts';

const KIND: Record<'whatsapp' | 'tel' | 'email', { icon: LucideIcon; label: string }> = {
  whatsapp: { icon: MessageCircle, label: 'abrir no WhatsApp' },
  tel: { icon: Phone, label: 'ligar' },
  email: { icon: Mail, label: 'escrever email' },
};

const HREF = { whatsapp: waHref, tel: telHref, email: mailHref };

/** One icon link (wa.me / tel: / mailto:) next to a contact value; nothing when it can't dial. */
export function ContactLink({
  kind,
  value,
}: {
  kind: keyof typeof KIND;
  value: string | null | undefined;
}) {
  const href = HREF[kind](value);
  if (!href) return null;
  const { icon: Icon, label } = KIND[kind];
  return (
    <a
      href={href}
      {...(kind === 'whatsapp' ? { target: '_blank', rel: 'noreferrer' } : {})}
      title={label}
      aria-label={label}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground pointer-coarse:size-9"
    >
      <Icon className="size-3.5" />
    </a>
  );
}
