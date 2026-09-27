import { useSession } from '../lib/session.ts';

/** The store's logo (or initials) with its own accent as the ring (§4.2 — the store's own color). */
export function StoreAvatar({ size = 40 }: { size?: number }) {
  const { store } = useSession();
  const initials = store.name
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-ZÀ-Ú]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary font-display font-semibold text-on-primary"
      style={{
        width: size,
        height: size,
        boxShadow: '0 0 0 2px var(--bg), 0 0 0 4px var(--store-accent)',
        fontSize: size * 0.38,
      }}
      aria-hidden
    >
      {store.logoUrl ? (
        <img src={store.logoUrl} alt="" className="size-full object-cover" />
      ) : (
        initials || 'V'
      )}
    </span>
  );
}
