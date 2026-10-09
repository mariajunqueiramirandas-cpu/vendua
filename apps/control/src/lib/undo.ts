import { toast } from 'sonner';
import { errorMessage } from './query.ts';

/** How long a "desfazer" stays on screen. */
export const UNDO_MS = 6000;

/**
 * Undo beats confirm: the action already happened; the toast offers the way back for a few
 * seconds. `undo` is the reverse write (an ordinary mutation of its own).
 */
export function toastUndo(message: string, undo: () => Promise<unknown>) {
  toast(message, {
    duration: UNDO_MS,
    action: {
      label: 'desfazer',
      onClick: () =>
        void undo().then(
          () => toast.success('desfeito'),
          (e: unknown) => toast.error(`não deu para desfazer: ${errorMessage(e)}`),
        ),
    },
  });
}
