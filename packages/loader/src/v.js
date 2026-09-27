// v.js — the last-resort loader. Dependency-free, renders in Shadow DOM so no
// storefront CSS can break it. Exhaustive capabilities: poll /storefront/v1/state,
// render blocking/emergency notices while the Kernel is not mounted, render the
// per-tenant maintenance kill switch ALWAYS (even over a healthy Kernel), expose
// window.__VENDUA_LOADER__ for synthetic monitoring. Nothing else — resist growth.
(function () {
  var PING = '__VENDUA_LOADER__';
  var ID = 'vendua-loader-overlay';
  window[PING] = { status: 'ready', version: '__LOADER_VERSION__', overlay: false };

  function clear() {
    var el = document.getElementById(ID);
    if (el) el.remove();
    window[PING].overlay = false;
    window[PING].mode = undefined;
  }

  function render(mode, title, body, action) {
    var mount = document.getElementById(ID);
    if (!mount) {
      mount = document.createElement('div');
      mount.id = ID;
      var shadow = mount.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<style>:host{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(20,16,12,.82);font-family:system-ui,sans-serif}' +
        '.card{max-width:26rem;margin:1rem;padding:1.5rem 1.75rem;background:#fff;border-radius:12px;color:#1a1714;text-align:center}' +
        'h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;font-size:.9rem;line-height:1.5;color:#4a4539}' +
        'a{display:inline-block;margin-top:1rem;color:#8a4a0c;font-weight:600}</style>' +
        '<div class="card" role="alertdialog" aria-modal="true" aria-labelledby="vt"><h1 id="vt"></h1><p id="vb"></p><a id="va" style="display:none"></a></div>';
      document.documentElement.appendChild(mount);
    }
    mount.setAttribute('data-mode', mode);
    var s = mount.shadowRoot;
    s.getElementById('vt').textContent = title || 'Aviso';
    s.getElementById('vb').textContent = body || '';
    var a = s.getElementById('va');
    if (action && action.href) {
      a.textContent = action.label || 'Saiba mais';
      a.href = action.href;
      a.style.display = 'inline-block';
    } else {
      a.style.display = 'none';
    }
    window[PING].overlay = true;
    window[PING].mode = mode;
  }

  async function tick() {
    var data;
    try {
      var res = await fetch('/storefront/v1/state', { credentials: 'same-origin' });
      if (!res.ok) return;
      data = await res.json();
    } catch (e) {
      return;
    }
    window[PING].lastStateAt = Date.now();

    // kill switch: staff-set per tenant, wins over everything incl. a mounted Kernel
    var loader = data.loader || {};
    if (loader.state === 'maintenance') {
      render(
        'maintenance',
        loader.title || 'Voltamos já',
        loader.message || 'Estamos em manutenção.',
        loader.href ? { href: loader.href, label: loader.label } : null,
      );
      return;
    }

    // once the Kernel mounts it owns surfaces — yield and strip any stale overlay
    if (window.__VENDUA_KERNEL_MOUNTED__) {
      clear();
      return;
    }
    var blocking = (data.notices || []).filter(function (n) {
      return n.severity === 'blocking' || n.kind === 'emergency';
    })[0];
    if (!blocking) {
      clear();
      return;
    }
    var action = (blocking.actions || []).filter(function (x) {
      return x && x.href;
    })[0];
    render('notice', blocking.title, blocking.body, action);
  }

  tick();
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) tick();
  });
})();
