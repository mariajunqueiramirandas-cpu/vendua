export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton${className ? ` ${className}` : ''}`} style={style} aria-hidden="true" />;
}
