// public /agendar page — self-contained HTML+JS template (no build step) served by app.ts
export const BOOKING_PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f7f4ea">
<title>venduá · agendar call</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --paper: #f7f4ea;
  --paper-2: #efe9d8;
  --ink: #123c32;
  --ink-2: #4f6a5e;
  --lime: #d9f875;
  --night: #0a100d;
  --line: rgba(18, 60, 50, .16);
  --sans: 'Space Grotesk', system-ui, sans-serif;
  --serif: 'Instrument Serif', Georgia, serif;
  --mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-font-smoothing: antialiased; }
body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.5;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-inline: 20px;
  padding-inline-start: max(20px, env(safe-area-inset-left));
  padding-inline-end: max(20px, env(safe-area-inset-right));
}
.wordmark {
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: .18em;
  text-transform: lowercase;
  color: var(--ink-2);
  padding-block: 22px;
}
.wordmark b { color: var(--ink); font-weight: 500; }
.card {
  width: 100%;
  max-width: 460px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding-block: 34px 30px;
  padding-inline: clamp(20px, 6vw, 30px);
  margin-block: 12px 40px;
  position: relative;
}
.card::before {
  content: '';
  position: absolute;
  inset: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  pointer-events: none;
  opacity: .5;
}
.eyebrow {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  gap: 8px;
}
.eyebrow::before {
  content: '';
  width: 6px; height: 6px;
  background: var(--lime);
  border: 1px solid var(--ink);
  border-radius: 2px;
}
h1 {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  font-size: clamp(27px, 8.5vw, 34px);
  line-height: 1.12;
  letter-spacing: -.01em;
  margin-block: 14px 8px;
}
.sub { color: var(--ink-2); font-size: 14px; }
.day { margin-block-start: 30px; }
.day-head {
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--ink-2);
  margin-block-end: 10px;
}
.slots { display: flex; flex-wrap: wrap; gap: 12px; }
.slot {
  font-family: var(--sans);
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding-block: 10px;
  padding-inline: 15px;
  cursor: pointer;
  transition: transform .12s ease, background .12s ease, border-color .12s;
}
.slot:hover { border-color: var(--ink); transform: translateY(-1px); }
.slot:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.slot.sel {
  background: var(--lime);
  border-color: var(--ink);
  transform: translateY(-1px);
}
/* sticky so the confirm action stays above the fold of the day list */
.details { margin-block-start: 30px; display: none; }
.details.show {
  display: block;
  position: sticky;
  bottom: 10px;
  bottom: calc(10px + env(safe-area-inset-bottom));
  max-height: calc(100dvh - 20px - env(safe-area-inset-bottom));
  overflow-y: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 -12px 30px rgba(18, 60, 50, .12);
}
.details .eyebrow { margin-block-end: 16px; }
.field { margin-block-end: 12px; }
.field label {
  display: block;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--ink-2);
  margin-block-end: 6px;
}
.field input {
  width: 100%;
  font: inherit;
  font-size: 16px;
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--line);
  padding-block: 9px;
  padding-inline: 12px;
  border-radius: 8px;
  transition: border-color .12s ease;
}
.field input:focus { outline: none; border-color: var(--ink); }
.field input:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.field input::placeholder { color: color-mix(in srgb, var(--ink-2) 55%, transparent); }
.confirm {
  width: 100%;
  margin-block-start: 16px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: var(--paper);
  background: var(--ink);
  border: 1px solid var(--ink);
  border-radius: 10px;
  padding-block: 13px;
  padding-inline: 18px;
  cursor: pointer;
  transition: background .12s ease;
}
.confirm:hover:not(:disabled) { background: var(--forest, #1a4f43); }
.confirm:disabled { opacity: .5; cursor: default; }
.confirm .when { font-weight: 400; opacity: .75; }
.state { padding-block: 30px 10px; }
.state p { color: var(--ink-2); font-size: 14px; }
.center { text-align: center; }
.big-time {
  font-family: var(--serif);
  font-style: italic;
  font-size: clamp(24px, 8vw, 30px);
  line-height: 1.15;
  margin-block: 14px 4px;
}
.room {
  display: inline-block;
  margin-block-start: 20px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
  background: var(--lime);
  border: 1px solid var(--ink);
  border-radius: 8px;
  padding-block: 10px;
  padding-inline: 16px;
  text-decoration: none;
}
.cancel-link {
  display: inline-block;
  margin-block-start: 24px;
  padding-block: 4px;
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: .1em;
  color: var(--ink-2);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.cancel-link:hover { color: var(--ink); }
.err {
  margin-block-start: 14px;
  font-size: 13px;
  color: #8a3b12;
  background: color-mix(in srgb, #d9a05b 18%, transparent);
  border: 1px solid color-mix(in srgb, #8a3b12 30%, transparent);
  border-radius: 8px;
  padding-block: 10px;
  padding-inline: 12px;
}
.note {
  margin-block-start: 16px;
  font-size: 13px;
  color: var(--ink);
  background: color-mix(in srgb, var(--lime) 55%, transparent);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding-block: 10px;
  padding-inline: 12px;
}
.note .cancel-link { margin-block-start: 0; padding-block: 0; }
.check { margin-block: 8px 4px; margin-inline: auto; display: block; }
.check circle { fill: var(--lime); stroke: var(--ink); }
.check path {
  stroke: var(--ink);
  stroke-dasharray: 30;
  stroke-dashoffset: 30;
  animation: draw .5s .15s ease-out forwards;
}
@keyframes draw { to { stroke-dashoffset: 0; } }
footer {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .12em;
  color: var(--ink-2);
  margin-block-start: auto;
  padding-block-end: calc(26px + env(safe-area-inset-bottom));
  opacity: .75;
}
.skel { display:flex; flex-wrap:wrap; gap:12px; }
.skel i {
  width: 68px; height: 40px; border-radius: 8px;
  background: var(--paper-2);
  animation: pulse 1.1s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: .5; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
</style>
</head>
<body>
  <div class="wordmark"><b>venduá</b>&nbsp;·&nbsp;agendar call</div>
  <main class="card" id="card"><div id="view"></div></main>
  <footer>venduá</footer>
<script>
(function () {
  var view = document.getElementById('view');
  var token = new URLSearchParams(location.search).get('t') || '';
  var state = { slots: [], sel: null, name: '', contact: '', roomConfigured: false, existing: null, leadName: '', tz: 'America/Sao_Paulo' };
  var DIAS = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
  var MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // all wall-clock display in meeting tz — never the browser tz
  function parts(iso) {
    var p = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: state.tz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    if (p.hour === '24') p.hour = '00';
    return p;
  }
  function dayKey(iso) {
    // 'YYYY-MM-DD' in the meeting tz — grouping key for the picker
    var p = parts(iso);
    return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
  }
  function tzLabel() {
    return state.tz === 'America/Sao_Paulo'
      ? 'horário de Brasília'
      : 'horário ' + state.tz.split('/').pop().replace(/_/g, ' ');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function fmtTime(iso) {
    var p = parts(iso);
    return p.hour + ':' + p.minute;
  }
  function fmtDay(iso) {
    var p = parts(iso);
    return DIAS[DOW[p.weekday]] + ' · ' + Number(p.day) + ' ' + MESES[Number(p.month) - 1];
  }
  function fmtLong(iso) {
    var p = parts(iso);
    return DIAS[DOW[p.weekday]] + ', ' + Number(p.day) + ' de ' +
      ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][Number(p.month) - 1] +
      ' · ' + fmtTime(iso);
  }
  function api(path, opts) {
    return fetch(path, opts ? {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    } : undefined).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, body: j }; });
    });
  }

  function loading() {
    view.innerHTML =
      '<div class="eyebrow">horários</div>' +
      '<h1>carregando…</h1>' +
      '<div class="skel"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
  }
  function dead(title, msg) {
    view.innerHTML =
      '<div class="eyebrow">ops</div>' +
      '<h1>' + esc(title) + '</h1>' +
      '<p class="sub">' + esc(msg) + '</p>';
  }

  function renderPicker() {
    var groups = {};
    var firstOfDay = {};
    state.slots.forEach(function (s) {
      var key = dayKey(s.start);
      if (!groups[key]) firstOfDay[key] = s.start;
      (groups[key] = groups[key] || []).push(s);
    });
    var days = Object.keys(groups).sort();
    var html =
      '<div class="eyebrow">escolha um horário</div>' +
      '<h1>oi, ' + esc(firstName(state.leadName)) + ' — vamos marcar?</h1>' +
      '<p class="sub">calls de ' + esc(String(state.slotMinutes)) + 'min · videochamada · ' +
        (state.roomConfigured ? 'o link da sala vem na confirmação' : 'sem link de sala configurado') + '</p>';
    if (state.notice) {
      html += '<div class="note">' + esc(state.notice) + '</div>';
      state.notice = null;
    }
    if (state.existing) {
      html += '<div class="note">Você já tem uma call marcada para <b>' +
        esc(fmtLong(state.existing.startsAt)) + '</b>.' +
        ' <button class="cancel-link" id="goExisting">ver / cancelar</button></div>';
    }
    if (!days.length) {
      html += '<div class="state"><p>Nenhum horário livre nas próximas duas semanas — responde a mensagem que a gente acha uma janela.</p></div>';
    }
    days.forEach(function (day) {
      html += '<div class="day"><div class="day-head"><span>' + esc(fmtDay(firstOfDay[day])) + '</span></div><div class="slots">';
      groups[day].forEach(function (s) {
        html += '<button class="slot" data-start="' + esc(s.start) + '">' + esc(fmtTime(s.start)) + '</button>';
      });
      html += '</div></div>';
    });
    html +=
      '<div class="details" id="details">' +
        '<div class="eyebrow">seus dados</div>' +
        '<div class="field"><label>seu nome</label><input id="fName" autocomplete="name" value="' + esc(state.name) + '" placeholder="como te chamamos?"></div>' +
        '<div class="field"><label>whatsapp (opcional)</label><input id="fContact" autocomplete="tel" inputmode="tel" value="' + esc(state.contact) + '" placeholder="pra te achar se precisar"></div>' +
        '<button class="confirm" id="confirm">confirmar <span class="when" id="when"></span></button>' +
        '<div id="err"></div>' +
      '</div>';
    view.innerHTML = html;
    view.querySelectorAll('.slot').forEach(function (b) {
      b.addEventListener('click', function () {
        state.sel = b.dataset.start;
        view.querySelectorAll('.slot').forEach(function (x) { x.classList.toggle('sel', x === b); });
        document.getElementById('details').classList.add('show');
        document.getElementById('when').textContent = '· ' + fmtDay(state.sel) + ' às ' + fmtTime(state.sel);
      });
    });
    var go = document.getElementById('goExisting');
    if (go) go.addEventListener('click', renderBooked);
    document.getElementById('confirm').addEventListener('click', doBook);
  }

  function firstName(n) { return (n || '').trim().split(' ')[0] || 'oi'; }

  function renderBooked() {
    var m = state.existing;
    var roomUrl = m.roomUrl || '';
    view.innerHTML =
      '<div class="eyebrow">sua call</div>' +
      '<div class="big-time">' + esc(fmtLong(m.startsAt)) + '</div>' +
      '<p class="sub">' + esc(fmtTime(m.startsAt)) + ' – ' + esc(fmtTime(m.endsAt)) + ' · ' + esc(tzLabel()) + '</p>' +
      (roomUrl ? '<a class="room" href="' + esc(roomUrl) + '" target="_blank" rel="noopener">entrar na sala →</a>' : '') +
      '<div><button class="cancel-link" id="doCancel">cancelar esta call</button></div>' +
      '<div id="err"></div>';
    document.getElementById('doCancel').addEventListener('click', doCancel);
  }

  function renderSuccess(m) {
    var roomUrl = m.roomUrl || '';
    view.innerHTML =
      '<div class="center">' +
      '<svg class="check" width="44" height="44" viewBox="0 0 44 44">' +
        '<circle cx="22" cy="22" r="21" stroke-width="1.5"/>' +
        '<path d="M14 22.5l5.5 5.5L30 17" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '</svg>' +
      '<div class="eyebrow" style="justify-content:center">marcado</div>' +
      '<div class="big-time">' + esc(fmtLong(m.startsAt)) + '</div>' +
      '<p class="sub">' +
        'até ' + esc(fmtTime(m.endsAt)) + ' · ' + esc(tzLabel()) +
        (m.roomUrl ? '' : ' · a gente manda o link da sala antes') +
      '</p>' +
      (m.roomUrl ? '<a class="room" href="' + esc(m.roomUrl) + '" target="_blank" rel="noopener">entrar na sala →</a>' : '') +
      '<div><button class="cancel-link" id="doCancel">cancelar esta call</button></div>' +
      '<div id="err"></div>' +
      '</div>';
    state.existing = m;
    document.getElementById('doCancel').addEventListener('click', doCancel);
  }

  function fail(msg) {
    var e = document.getElementById('err');
    if (e) e.innerHTML = '<div class="err">' + esc(msg) + '</div>';
  }

  function doBook() {
    var btn = document.getElementById('confirm');
    btn.disabled = true;
    api('/book/v1/book', {
      t: token,
      start: state.sel,
      name: document.getElementById('fName').value,
      contact: document.getElementById('fContact').value,
    }).then(function (r) {
      if (r.status === 200 || r.status === 201) {
        renderSuccess(r.body.meeting);
      } else if (r.status === 409) {
        btn.disabled = false;
        fail(r.body.error && r.body.error.message ? r.body.error.message : 'esse horário acabou de sair — escolhe outro');
        refresh();
      } else {
        btn.disabled = false;
        fail('não consegui marcar — tenta de novo?');
      }
    }).catch(function () { btn.disabled = false; fail('sem conexão — tenta de novo?'); });
  }

  function doCancel() {
    var btn = document.getElementById('doCancel');
    btn.disabled = true;
    // cancel the shown meeting, never the lead's next scheduled call
    api('/book/v1/cancel', { t: token, m: state.existing && state.existing.id }).then(function (r) {
      if (r.status === 200) {
        state.existing = null;
        state.notice = 'Call cancelada — quando quiser, escolhe outro horário:';
        refresh(true);
      } else if (r.status === 409) {
        fail(r.body.error && r.body.error.message ? r.body.error.message : 'cancelamento só até 12h antes');
        btn.disabled = false;
      } else {
        btn.disabled = false;
        fail('não consegui cancelar — tenta de novo?');
      }
    }).catch(function () { btn.disabled = false; fail('sem conexão — tenta de novo?'); });
  }

  function refresh(intoPicker) {
    api('/book/v1/slots?t=' + encodeURIComponent(token)).then(function (r) {
      if (r.status !== 200) {
        dead('link inválido', 'esse link não abre mais — pede um novo pra gente.');
        return;
      }
      state.leadName = r.body.leadName || '';
      state.slots = r.body.slots || [];
      state.slotMinutes = r.body.slotMinutes || 30;
      state.roomConfigured = !!r.body.roomConfigured;
      state.existing = r.body.existing || null;
      if (r.body.tz) {
        state.tz = r.body.tz;
        document.querySelector('footer').textContent = tzLabel().toLowerCase() + ' · venduá';
      }
      state.name = state.name || state.leadName;
      state.contact = state.contact || r.body.leadWhats || '';
      if (intoPicker || !state.existing) renderPicker();
      else renderBooked();
    }).catch(function () {
      dead('sem conexão', 'não consegui carregar os horários — atualiza a página?');
    });
  }

  if (!token) {
    dead('link inválido', 'esse link não abre mais — pede um novo pra gente.');
  } else {
    loading();
    refresh();
  }
})();
</script>
</body>
</html>`;
