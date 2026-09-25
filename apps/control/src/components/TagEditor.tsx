import { useState } from 'react';
import { Check, Pencil, Plus } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { Badge } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';

const parse = (raw: string) =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Tag chips with a comma-separated inline editor. Enter/ok saves, Escape cancels. */
export function TagEditor({
  tags,
  onSave,
  placeholder = 'vip, doceria, fortaleza',
  className,
}: {
  tags: string[];
  onSave: (tags: string[]) => void;
  placeholder?: string | undefined;
  className?: string | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const start = () => {
    setVal(tags.join(', '));
    setEditing(true);
  };
  const commit = () => {
    onSave(parse(val));
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className={cn('flex flex-wrap items-center gap-1', className)}>
        {tags.map((t) => (
          <Badge key={t} variant="outline">
            {t}
          </Badge>
        ))}
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-6 pointer-coarse:size-9"
          onClick={start}
          aria-label={tags.length ? 'editar tags' : 'adicionar tags'}
          title={tags.length ? 'editar tags' : 'adicionar tags'}
        >
          {tags.length ? <Pencil /> : <Plus />}
        </Button>
        {!tags.length && <span className="text-xs text-muted-foreground/70">sem tags</span>}
      </div>
    );
  }
  return (
    <div className={cn('flex gap-1.5', className)}>
      <Input
        autoFocus
        value={val}
        aria-label="tags separadas por vírgula"
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <Button size="icon" variant="outline" onClick={commit} aria-label="salvar tags">
        <Check />
      </Button>
    </div>
  );
}
