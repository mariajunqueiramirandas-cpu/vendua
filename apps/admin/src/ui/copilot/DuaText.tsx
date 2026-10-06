import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

// Duá's replies in the Copilot use a tiny markdown: **bold**, "- " bullets, line breaks and
// links to admin screens, [Pedidos](/pedidos). Built as React nodes, never as HTML: anything
// else (an outside link, a stray asterisk) is shown as the plain text it is.

const BOLD = /\*\*([^*\n]+?)\*\*/g;
const LINK = /\[([^\]\n]{1,200})\]\((\/[A-Za-z0-9\-._~%/?=&#]{0,300})\)/g;

/** An admin path the router can open; the `/admin` base Duá may have written comes off. */
export function adminPath(raw: string): string | null {
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  const p = raw.replace(/^\/admin(?=\/|$)/, '') || '/';
  return p.startsWith('/') && !p.startsWith('//') ? p : null;
}

function links(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(LINK)) {
    const to = adminPath(m[2]!);
    if (!to) continue;
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push(
      <Link
        key={`${key}l${m.index}`}
        to={to}
        className="font-semibold underline decoration-[1.5px] underline-offset-2 hover:decoration-2"
      >
        {m[1]}
      </Link>,
    );
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(BOLD)) {
    if (m.index > last) out.push(...links(s.slice(last, m.index), `${key}t${last}`));
    out.push(
      <strong key={`${key}b${m.index}`} className="font-bold">
        {links(m[1]!, `${key}b${m.index}`)}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(...links(s.slice(last), `${key}t${last}`));
  return out;
}

/** One of Duá's replies, as paragraphs and bullet lists. */
export function DuaText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const k = `p${blocks.length}`;
    blocks.push(
      <p key={k}>
        {para.map((l, i) => (
          <Fragment key={i}>
            {i ? <br /> : null}
            {inline(l, `${k}.${i}`)}
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    const k = `u${blocks.length}`;
    blocks.push(
      <ul key={k} className="flex flex-col gap-0.5">
        {list.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-current" />
            <span className="min-w-0">{inline(l, `${k}.${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-•]\s+(.+)$/.exec(line);
    if (bullet) {
      flushPara();
      list.push(bullet[1]!);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="flex flex-col gap-1.5 whitespace-normal">{blocks}</div>;
}
