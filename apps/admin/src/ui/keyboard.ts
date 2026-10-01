import { useEffect } from 'react';

const TEXT_FIELD =
  'textarea, [contenteditable]:not([contenteditable=false]), input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=range], [type=color], [type=file], [type=hidden])';
const MIN_KEYBOARD = 150;

/**
 * While the on-screen keyboard is up the screen belongs to the field: `html[data-kb]` (the `kb:`
 * variant) unpins headers and step buttons and hides the tab bar and floating action bars, and
 * `--kb` is the height an overlaying keyboard covers (iOS; Chrome with resizes-content shrinks the
 * page instead), so the end of the page can still scroll above it. Focusing a field scrolls it into
 * view together with its form's actions (`data-kb-reveal`) when both fit.
 */
export function useKeyboard() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const field = () => {
      const el = document.activeElement;
      return el instanceof HTMLElement && el.matches(TEXT_FIELD) ? el : null;
    };
    // the height with no keyboard: with resizes-content innerHeight shrinks along with it
    let full = Math.max(vv.height, innerHeight);
    let t = 0;

    const reveal = () => {
      const el = field();
      if (!el) return;
      const top = vv.offsetTop + 12;
      const bottom = vv.offsetTop + vv.height - 12;
      const f = el.getBoundingClientRect();
      const actions = el.closest('form')?.querySelector('[data-kb-reveal]');
      const a = actions?.getBoundingClientRect();
      // the label above the field, then the button under it if the two fit together; else the
      // field near the top, with what comes after it in view
      const from = f.top - 32;
      const by =
        a && a.bottom - from <= bottom - top
          ? from < top
            ? from - top
            : Math.max(0, a.bottom - bottom)
          : from < top || from > top + (bottom - top) / 3
            ? from - top
            : 0;
      if (Math.abs(by) > 1) scrollBy({ top: by });
    };

    const check = (e?: Event) => {
      const typing = field();
      if (!typing) full = Math.max(vv.height, innerHeight);
      // pinch-zoom shrinks the visual viewport too, and so does Chrome's toolbar sliding back
      // in on a fast scroll up: only a text field brings up a keyboard, and it is far taller
      const on = !!typing && vv.scale <= 1.01 && full - vv.height > MIN_KEYBOARD;
      if (on !== root.hasAttribute('data-kb')) root.toggleAttribute('data-kb', on);
      const covered = on ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
      root.style.setProperty('--kb', `${covered}px`);
      // scroll events fire continuously while reveal() scrolls: only a resize may trigger it
      if (on && e?.type === 'resize') reveal();
    };
    // focus passes through <body> between two fields: look once it has landed
    const later = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        check();
        if (root.hasAttribute('data-kb')) reveal();
      }, 60);
    };

    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
    addEventListener('focusin', later);
    addEventListener('focusout', later);
    check();
    return () => {
      clearTimeout(t);
      vv.removeEventListener('resize', check);
      vv.removeEventListener('scroll', check);
      removeEventListener('focusin', later);
      removeEventListener('focusout', later);
      root.removeAttribute('data-kb');
      root.style.removeProperty('--kb');
    };
  }, []);
}
