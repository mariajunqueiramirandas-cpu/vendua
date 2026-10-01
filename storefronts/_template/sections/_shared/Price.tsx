/**
 * A price set the way menus print them: the currency sign small and light, the figure in
 * tabular digits. Takes Core's already-formatted string (ProductPrice's `renderAmount`) — it only splits it.
 */
export function Price({ text, className }: { text: string; className?: string }) {
  const m = /^([^\d-]*?)\s*(-?\d.*)$/u.exec(text);
  if (!m || !m[1]) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      <span className="price-cur">{m[1]}</span>
      {m[2]}
    </span>
  );
}
