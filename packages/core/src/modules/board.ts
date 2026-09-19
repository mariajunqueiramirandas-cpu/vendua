/**
 * board module — the Founder CRM staff board (docs/roadmap.md, Phase 1).
 * One self-contained HTML/CSS/vanilla-JS document served by Core inside the
 * /control/v1 surface: no separate app, no external assets. It graduates into
 * the Control Plane in Phase 4 — spare and functional is the bar here.
 */
/** Unauthenticated GET — a one-field form POSTing `key` to /control/v1/board.
 *  POST (not a URL param) so the shared secret never lands in access logs,
 *  browser history, or a bookmark. */
export function boardLoginHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Venduá — Leads</title>
<style>
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #faf7f2; color: #1c1917; display: grid; place-items: center; min-height: 100vh; }
  form { background: #fff; border: 1px solid #e7e0d8; border-radius: 10px; padding: 24px; display: flex; gap: 8px; align-items: center; }
  input { padding: 8px 10px; border: 1px solid #d6cec4; border-radius: 8px; font: inherit; font-size: 13px; min-width: 240px; }
  button { padding: 8px 14px; border: 0; border-radius: 8px; background: #1c1917; color: #fff; font: inherit; font-size: 13px; cursor: pointer; }
  label { font-size: 13px; font-weight: 600; }
</style>
</head>
<body>
<form method="post" action="/control/v1/board">
  <label for="key">Chave</label>
  <input id="key" name="key" type="password" autocomplete="off" required autofocus>
  <button type="submit">Entrar</button>
</form>
</body>
</html>`;
}

export function boardHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Venduá — Leads</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #faf7f2; color: #1c1917; }
  header { padding: 16px 20px; border-bottom: 1px solid #e7e0d8; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  form#add { display: flex; flex-wrap: wrap; gap: 8px; }
  form#add input { padding: 7px 10px; border: 1px solid #d6cec4; border-radius: 8px; font: inherit; font-size: 13px; }
  form#add input[name=name] { min-width: 200px; }
  form#add input { min-width: 130px; }
  button { padding: 7px 12px; border: 0; border-radius: 8px; background: #1c1917; color: #fff; font: inherit; font-size: 13px; cursor: pointer; }
  button.ghost { background: transparent; color: #44403c; border: 1px solid #d6cec4; }
  button:disabled { opacity: 0.35; cursor: default; }
  main { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 16px 20px; align-items: start; }
  .col { background: #f3efe9; border: 1px solid #e7e0d8; border-radius: 10px; padding: 10px; }
  .col h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #57534e; margin: 0 0 10px; }
  .col h2 .n { float: right; font-weight: 400; }
  .card { background: #fff; border: 1px solid #e7e0d8; border-radius: 8px; padding: 10px; margin-bottom: 8px; }
  .card .biz { font-weight: 600; font-size: 14px; }
  .card .who { font-size: 13px; color: #57534e; }
  .card .contact { font-size: 12px; color: #78716c; margin-top: 4px; overflow-wrap: anywhere; }
  .card .notes { font-size: 12px; color: #57534e; margin-top: 6px; border-top: 1px dashed #e7e0d8; padding-top: 6px; white-space: pre-wrap; }
  .card .notes .at { color: #a8a29e; font-size: 11px; }
  .card .actions { display: flex; gap: 6px; margin-top: 8px; }
  .card .actions button { font-size: 12px; padding: 5px 9px; }
  .empty { font-size: 12px; color: #a8a29e; text-align: center; padding: 12px 0; }
  #err { color: #b91c1c; font-size: 13px; padding: 8px 20px; display: none; }
</style>
</head>
<body>
<header>
  <h1>Venduá — intake de lojistas</h1>
  <form id="add">
    <input name="name" placeholder="Nome *" required>
    <input name="businessName" placeholder="Negócio">
    <input name="phone" placeholder="Telefone">
    <input name="email" placeholder="E-mail">
    <input name="instagram" placeholder="Instagram">
    <input name="city" placeholder="Cidade">
    <input name="source" placeholder="Origem">
    <button type="submit">Adicionar</button>
  </form>
</header>
<div id="err"></div>
<main id="board"></main>
<script>
const STATES = [
  ['lead', 'Lead'],
  ['contacted', 'Contatado'],
  ['invited', 'Convidado'],
  ['live', 'Live'],
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
// x-vendua-staff: the CSRF marker the API requires on cookie-authenticated
// mutations (a custom header can't be sent cross-site without a preflight
// this API never answers).
const api = (path, opts = {}, idemKey) =>
  fetch('/control/v1' + path, {
    credentials: 'include',
    ...opts,
    headers: {
      'content-type': 'application/json',
      'x-vendua-staff': '1',
      ...(idemKey ? { 'idempotency-key': idemKey } : {}),
      ...(opts.headers ?? {}),
    },
  });

async function load() {
  const res = await api('/leads');
  if (!res.ok) {
    document.getElementById('err').style.display = 'block';
    document.getElementById('err').textContent =
      'Acesso negado — recarregue e informe a chave.';
    return;
  }
  const { leads } = await res.json();
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (const [state, label] of STATES) {
    const col = document.createElement('section');
    col.className = 'col';
    const cards = leads.filter((l) => l.state === state);
    col.innerHTML = '<h2>' + esc(label) + '<span class="n">' + cards.length + '</span></h2>';
    for (const l of cards) col.appendChild(card(l));
    if (!cards.length) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = '—';
      col.appendChild(d);
    }
    board.appendChild(col);
  }
}

function card(l) {
  const el = document.createElement('div');
  el.className = 'card';
  const contact = [l.phone, l.email, l.instagram, l.city].filter(Boolean).join(' · ');
  el.innerHTML =
    '<div class="biz">' + esc(l.businessName || l.name) + '</div>' +
    (l.businessName ? '<div class="who">' + esc(l.name) + '</div>' : '') +
    (contact ? '<div class="contact">' + esc(contact) + '</div>' : '') +
    '<div class="notes">' +
      '<span class="at">' + l.notes.length + ' nota(s)</span>' +
      l.notes.map((n) => '<div><span class="at">' + esc(n.at.slice(0, 10)) + '</span> ' + esc(n.body) + '</div>').join('') +
    '</div>' +
    '<div class="actions"></div>';
  const actions = el.querySelector('.actions');
  const i = STATES.findIndex(([s]) => s === l.state);
  if (i < STATES.length - 1) {
    const next = document.createElement('button');
    next.textContent = '→ ' + STATES[i + 1][1];
    // PATCH converges (setting the same state twice is a no-op), so no
    // idempotency key — POST creates/appends claim one.
    next.onclick = async () => {
      const res = await api('/leads/' + l.id, {
        method: 'PATCH',
        body: JSON.stringify({ state: STATES[i + 1][0] }),
      });
      if (res.ok) load();
    };
    actions.appendChild(next);
  }
  const note = document.createElement('button');
  note.className = 'ghost';
  note.textContent = '+ nota';
  note.onclick = async () => {
    const body = prompt('Nota para ' + (l.businessName || l.name) + ':');
    if (!body || !body.trim()) return;
    const res = await api(
      '/leads/' + l.id + '/notes',
      { method: 'POST', body: JSON.stringify({ body: body.trim() }) },
      crypto.randomUUID(),
    );
    if (res.ok) load();
  };
  actions.appendChild(note);
  return el;
}

document.getElementById('add').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  const body = {};
  for (const [k, v] of Object.entries(data)) if (String(v).trim()) body[k] = String(v).trim();
  const res = await api(
    '/leads',
    { method: 'POST', body: JSON.stringify(body) },
    crypto.randomUUID(),
  );
  if (res.ok) {
    e.target.reset();
    load();
  }
};

load();
</script>
</body>
</html>`;
}
