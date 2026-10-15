import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, type PlaceSuggestion } from '../lib/api.ts';
import { qk } from '../lib/query.ts';
import { cn } from './cn.ts';

/** "Ponte Preta, Campinas – SP" */
export function placeWhere(s: PlaceSuggestion) {
  const city = s.city ? (s.state ? `${s.city} – ${s.state}` : s.city) : null;
  return [s.neighborhood, city].filter(Boolean).join(', ');
}

/**
 * Streets Core finds for what is typed in an address field (OpenStreetMap through Photon), as an
 * ARIA 1.2 combobox: spread `input` on the field, call `typing(value)` from its onChange (only
 * typing asks: a value filled from elsewhere stays quiet), and render `list` under it. The list
 * sits in the flow, so a scrolling sheet never clips it.
 */
export function useStreetSuggest(onPick: (s: PlaceSuggestion) => void, enabled = true) {
  const listId = useId();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closing.current), []);
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);
  const found = useQuery({
    queryKey: qk.places(q),
    queryFn: () => api.places(q),
    enabled: enabled && q.length >= 3,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const places = enabled && typed.trim().length >= 3 ? (found.data?.places ?? []) : [];
  const shown = open && places.length > 0;
  useEffect(() => setActive(-1), [found.data]);

  const pick = (s: PlaceSuggestion) => {
    setOpen(false);
    setActive(-1);
    setTyped('');
    onPick(s);
  };
  const input = {
    role: 'combobox' as const,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': shown,
    'aria-controls': listId,
    ...(shown && active >= 0 ? { 'aria-activedescendant': `${listId}-${active}` } : {}),
    onFocus: () => clearTimeout(closing.current),
    // a tap on a row lands before the list goes away
    onBlur: () => {
      closing.current = setTimeout(() => setOpen(false), 150);
    },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
      if (!places.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
        const n = places.length;
        setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
      } else if (e.key === 'Enter' && shown && active >= 0) {
        e.preventDefault();
        pick(places[active]!);
      } else if (e.key === 'Escape' && shown) {
        // a sheet around the field stays open: Escape only closes the list
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    },
  };
  const list = (
    <div hidden={!shown} className="rounded-md bg-surface ring-1 ring-line depth-2">
      <ul id={listId} role="listbox" aria-label="Ruas" className="p-1">
        {places.map((s, i) => (
          <li
            key={`${s.street}|${s.number}|${s.neighborhood}|${s.city}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(s)}
            className={cn(
              'flex min-h-12 cursor-pointer flex-col justify-center rounded-sm px-3 py-2',
              i === active && 'bg-sunken',
            )}
          >
            <span className="font-semibold">
              {s.number ? `${s.street}, ${s.number}` : s.street}
            </span>
            {placeWhere(s) ? <span className="t-caption text-muted">{placeWhere(s)}</span> : null}
          </li>
        ))}
      </ul>
      <p className="t-caption px-4 pb-2 text-right text-muted" aria-hidden="true">
        © OpenStreetMap
      </p>
    </div>
  );
  return {
    input,
    list,
    typing: (v: string) => {
      setTyped(v);
      setOpen(true);
    },
    reset: () => {
      setTyped('');
      setOpen(false);
    },
  };
}
