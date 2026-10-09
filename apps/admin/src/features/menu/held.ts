import { useEffect, useRef, useState } from 'react';
import { toast } from '../../ui/Toast.tsx';

/** as long as the "desfazer" toast stays up (§2.2.1) */
export const HOLD_MS = 6000;

/**
 * Undo beats confirm (§2.2.1) for deletes Core can't take back: the row goes at once and the
 * request waits behind "desfazer". Leaving the screen or the app sends what's waiting; then
 * `leaving` is true and the request must outlive the page (keepalive), like the kitchen's held
 * "pronto" (features/kitchen/data.ts).
 */
export function useHeld() {
  const held = useRef(new Map<string, { timer: number; send: (leaving: boolean) => void }>());
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const mounted = useRef(true);
  const sync = () => mounted.current && setIds(new Set(held.current.keys()));

  const fire = (id: string, leaving: boolean) => {
    const h = held.current.get(id);
    if (!h) return;
    clearTimeout(h.timer);
    held.current.delete(id);
    h.send(leaving);
    sync();
  };

  /** "desfazer" from the screen itself (a sheet covers the toast); false once it was sent */
  const cancel = (id: string) => {
    const h = held.current.get(id);
    if (!h) return false;
    clearTimeout(h.timer);
    held.current.delete(id);
    sync();
    return true;
  };

  /** hides `id` now and sends after HOLD_MS unless "desfazer" is tapped */
  const hold = (id: string, text: string, send: (leaving: boolean) => void) => {
    if (held.current.has(id)) return;
    const timer = window.setTimeout(() => fire(id, false), HOLD_MS);
    held.current.set(id, { timer, send });
    sync();
    toast(text, {
      ms: HOLD_MS,
      undo: () => {
        if (!cancel(id)) toast.error('Não deu para desfazer: já tinha sido apagado.');
      },
    });
  };

  useEffect(() => {
    mounted.current = true;
    const flush = () => [...held.current.keys()].forEach((id) => fire(id, true));
    const hidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      mounted.current = false;
      flush();
    };
    // fire only touches refs and guarded setState
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { held: ids, hold, cancel };
}
