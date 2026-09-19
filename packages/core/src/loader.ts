/**
 * The last-resort loader (`v.js`) — docs/architecture/05-system-surfaces.md#the-loader-vjs.
 * ~dependency-free, renders blocking/emergency notices in Shadow DOM so no
 * storefront CSS can break it. Phase 0: served by Core in dev; production serves
 * it from cdn.vendua.com.br and it reads the edge-cached state endpoint.
 */
export const LOADER_JS = `(function () {
  var PING = '__VENDUA_LOADER__';
  window[PING] = { status: 'ready', version: 1 };
  function hostBase() {
    // In dev the storefront vite proxy passes /storefront/v1 through to Core.
    return '';
  }
  async function tick() {
    // Once the Kernel mounts it owns surfaces — the loader is the last-resort
    // path only. Yield and strip any overlay already rendered.
    if (window.__VENDUA_KERNEL_MOUNTED__) {
      var stale = document.getElementById('vendua-loader-overlay');
      if (stale) stale.remove();
      window[PING].overlay = false;
      return;
    }
    var data;
    try {
      var res = await fetch(hostBase() + '/storefront/v1/state', { credentials: 'same-origin' });
      if (!res.ok) return;
      data = await res.json();
    } catch (e) { return; }
    var blocking = (data.notices || []).filter(function (n) {
      return n.severity === 'blocking' || n.kind === 'emergency';
    })[0];
    var mount = document.getElementById('vendua-loader-overlay');
    if (!blocking) { if (mount) mount.remove(); window[PING].overlay = false; return; }
    if (!mount) {
      mount = document.createElement('div');
      mount.id = 'vendua-loader-overlay';
      var shadow = mount.attachShadow({ mode: 'open' });
      shadow.innerHTML =
        '<style>:host{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(20,16,12,.82);font-family:system-ui,sans-serif}' +
        '.card{max-width:26rem;margin:1rem;padding:1.5rem 1.75rem;background:#fff;border-radius:12px;color:#1a1714;text-align:center}' +
        'h1{font-size:1.1rem;margin:0 0 .5rem}p{margin:0;font-size:.9rem;line-height:1.5;color:#4a4539}' +
        'a{display:inline-block;margin-top:1rem;color:#b06010}</style>' +
        '<div class="card"><h1 id="vt"></h1><p id="vb"></p><a id="va" style="display:none"></a></div>';
      document.documentElement.appendChild(mount);
    }
    var s = mount.shadowRoot;
    s.getElementById('vt').textContent = blocking.title || 'Aviso';
    s.getElementById('vb').textContent = blocking.body || '';
    var action = (blocking.actions || [])[0];
    var a = s.getElementById('va');
    if (action && action.href) { a.textContent = action.label || 'Saiba mais'; a.href = action.href; a.style.display = 'inline-block'; }
    else { a.style.display = 'none'; }
    window[PING].overlay = true;
  }
  tick();
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
})();
`;
