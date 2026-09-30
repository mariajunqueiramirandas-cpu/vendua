// JSON inside <script> must not be able to close the tag or open a comment/CDATA, and
// U+2028/U+2029 are line terminators to pre-ES2019 parsers.
export function scriptJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function stateScript(state: unknown): string {
  return `<script id="vendua-state">window.__VENDUA_STATE__=${scriptJson(state)}</script>`;
}

/** Inserts the state script right before the first `</head>` (unchanged when there is none). */
export function injectState(html: string, state: unknown): string {
  const at = html.search(/<\/head\s*>/i);
  if (at < 0) return html;
  return html.slice(0, at) + stateScript(state) + html.slice(at);
}
