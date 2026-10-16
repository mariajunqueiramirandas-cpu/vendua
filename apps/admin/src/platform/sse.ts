import type { StreamHandlers } from './types.ts';

// Server-sent events over fetch (ADR 0044 §4): EventSource can't send an Authorization header,
// and the app has no cookie. Same wire format and named events as before; reconnecting is the
// caller's (lib/live.ts), which already decides how soon.

export function openStream(
  url: string,
  init: { headers: Record<string, string>; credentials: RequestCredentials },
  h: StreamHandlers,
): () => void {
  const ctl = new AbortController();
  let over = false;
  const finish = (status: number) => {
    if (over) return;
    over = true;
    h.closed(status);
  };
  void (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { ...init.headers, accept: 'text/event-stream' },
        credentials: init.credentials,
        cache: 'no-store',
        signal: ctl.signal,
      });
    } catch {
      return finish(0);
    }
    if (!res.ok || !res.body) {
      void res.body?.cancel().catch(() => undefined);
      return finish(res.status || 0);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    let event = '';
    let data: string[] = [];
    const line = (l: string) => {
      if (l === '') {
        if (data.length && !over) h.event(event || 'message', data.join('\n'));
        event = '';
        data = [];
        return;
      }
      if (l.startsWith(':')) return;
      const at = l.indexOf(':');
      const field = at < 0 ? l : l.slice(0, at);
      let value = at < 0 ? '' : l.slice(at + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    };
    // a CR that ended a chunk may be half of a CRLF: the LF opening the next one is skipped
    let skipLf = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += skipLf && value.startsWith('\n') ? value.slice(1) : value;
        skipLf = false;
        let i: number;
        while ((i = buf.search(/\r\n|\r|\n/)) >= 0) {
          line(buf.slice(0, i));
          const crlf = buf[i] === '\r' && buf[i + 1] === '\n';
          if (buf[i] === '\r' && i === buf.length - 1) skipLf = true;
          buf = buf.slice(i + (crlf ? 2 : 1));
        }
      }
    } catch {
      /* aborted, or the connection dropped: closed below */
    }
    finish(0);
  })();
  return () => {
    over = true;
    ctl.abort();
  };
}
