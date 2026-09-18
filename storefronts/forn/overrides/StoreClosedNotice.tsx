import { MoonMark } from '../components/marks.tsx';
import type { Notice } from '@vendua/kernel';

/**
 * system.StoreClosedNotice override — the closed state is this store's main
 * surface, so the generic banner becomes a lit shop sign: a dark card with a
 * warm interior glow, like the light left on inside a closed padoca.
 */
export default function StoreClosedNotice(props: Record<string, unknown>) {
  const notice = props.notice as Notice | undefined;
  const onDismiss = props.onDismiss as (() => void) | undefined;
  if (!notice) return null;
  return (
    <div className="forn-sign" role="status">
      <span className="moon" aria-hidden="true">
        <MoonMark size={30} />
      </span>
      <span className="txt">
        <strong className="t">{notice.title}</strong>
        {notice.body ? <p className="b">{notice.body}</p> : null}
      </span>
      {notice.dismissible && onDismiss ? (
        <button type="button" className="x" aria-label="dispensar aviso" onClick={onDismiss}>
          ×
        </button>
      ) : null}
    </div>
  );
}
