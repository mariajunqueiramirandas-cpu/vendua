import { cn } from './cn.ts';

// Duá, the Venduá anteater and the stores' AI seller ("o Duá" in copy). Art lives in /brand/mascote (see brand/mascote/README.md); Vite
// hashes each file and the service worker precaches them, so the states work offline.
const files = import.meta.glob<string>('../../../../brand/mascote/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const url = (pose: string) => files[`../../../../brand/mascote/${pose}.webp`]!;

export type Pose =
  | 'avatar-ola'
  | 'avatar-pensando'
  | 'avatar-feliz'
  | 'avatar-ajuda'
  | 'boas-vindas'
  | 'horarios'
  | 'loja'
  | 'carinho'
  | 'seguranca'
  | 'offline'
  | 'sem-pedidos'
  | 'sem-resultados'
  | 'carregando'
  | 'erro'
  | 'personalizar'
  | 'sucesso'
  | 'publicar'
  | 'pagamento'
  | 'catalogo'
  | 'entrega';

/** Decorative by default (alt ""): the message must already be text next to it. */
export function Mascote({
  pose,
  size = 160,
  alt = '',
  className,
}: {
  pose: Pose;
  size?: number;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src={url(pose)}
      width={size}
      height={size}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn('block h-auto max-w-full select-none object-contain', className)}
    />
  );
}
