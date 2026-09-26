import { j as n, X as c } from './index-uUNui45b.js';
function a(i) {
  if (i.type === 'link' && typeof i.href == 'string') return { label: i.label, href: i.href };
  const e = i;
  return typeof e.href == 'string' ? { label: i.label, href: e.href } : null;
}
function f(i) {
  const e = i.notice,
    l = i.onDismiss;
  if (!e) return null;
  const t =
      e.kind === 'emergency'
        ? 'blocking'
        : ['info', 'warning', 'blocking'].includes(String(e.severity))
          ? String(e.severity)
          : 'info',
    r = (e.actions ?? []).map(a).filter((s) => s != null);
  return n.jsxs('div', {
    className: 'qp-notice',
    'data-tone': t,
    role: t === 'blocking' ? 'alertdialog' : 'status',
    'aria-modal': t === 'blocking' || void 0,
    children: [
      n.jsxs('div', {
        className: 'qp-notice-body',
        children: [
          n.jsx('strong', { className: 'qp-notice-title', children: e.title }),
          e.body ? n.jsx('p', { className: 'qp-notice-text', children: e.body }) : null,
          r.length > 0
            ? n.jsx('p', {
                className: 'qp-notice-links',
                children: r.map((s, o) =>
                  n.jsx('a', { href: s.href, className: 'qp-notice-link', children: s.label }, o),
                ),
              })
            : null,
        ],
      }),
      e.dismissible && l
        ? n.jsx('button', {
            type: 'button',
            className: 'qp-notice-dismiss',
            'aria-label': 'Dispensar aviso',
            onClick: l,
            children: n.jsx(c, { size: 16, 'aria-hidden': 'true' }),
          })
        : null,
    ],
  });
}
export { f as default };
