import { useEffect } from 'react';

export const TEXT_FIELD =
  'textarea, [contenteditable]:not([contenteditable=false]), input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=range], [type=color], [type=file], [type=hidden])';
const MIN_KEYBOARD = 150;

/**
 * What brings a focused field into view: its nearest scrolling ancestor (a sheet's body), the
 * page (null), or nothing (undefined) when it rides in a fixed or sticky bar. Scrolling the page
 * for a field that doesn't move with it only shifts the screen under it, once per resize event.
 */
function scrollerOf(el: HTMLElement): HTMLElement | null | undefined {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/auto|scroll/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
    if (s.position === 'fixed' || s.position === 'sticky') return undefined;
  }
  return null;
}

/**
 * While the on-screen keyboard is up the screen belongs to the field: `html[data-kb]` (the `kb:`
 * variant) unpins headers and step buttons and hides the tab bar and floating action bars, and
 * `--kb` is the height an overlaying keyboard covers (iOS; Chrome with resizes-content shrinks the
 * page instead), so the end of the page can still scroll above it and sheets and composers sit on
 * top of it. `--vvh` is the height left visible and `--vvt` where it starts (iOS can pan the page
 * under the keyboard), so a full-screen layer can fit it exactly. Focusing a field scrolls it into
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
    let settle = 0;

    const reveal = () => {
      const el = field();
      if (!el) return;
      const box = scrollerOf(el);
      if (box === undefined) return;
      const r = box?.getBoundingClientRect();
      const top = Math.max(vv.offsetTop, r?.top ?? -Infinity) + 12;
      const bottom = Math.min(vv.offsetTop + vv.height, r?.bottom ?? Infinity) - 12;
      const f = el.getBoundingClientRect();
      const actions = el.closest('form')?.querySelector('[data-kb-reveal]');
      const a =
        actions && box?.contains(actions) !== false ? actions.getBoundingClientRect() : null;
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
      if (Math.abs(by) > 1) (box ?? window).scrollBy({ top: by });
    };

    // iOS can leave the visual viewport panned below the page once the keyboard is gone, and
    // fixed bars (the tab bar, a sheet) stay drawn where the keyboard pushed them: line the two
    // up again
    const realign = () => {
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (field() || vv.scale > 1.01 || vv.offsetTop <= 1) return;
        const y = scrollY;
        scrollTo(scrollX, y + vv.offsetTop);
        // at the end of the page there is no room below: any scroll lets iOS let go of it
        if (scrollY === y) scrollTo(scrollX, y - 1);
      }, 350);
    };

    const check = (e?: Event) => {
      const typing = field();
      if (!typing) full = Math.max(vv.height, innerHeight);
      // pinch-zoom shrinks the visual viewport too, and so does Chrome's toolbar sliding back
      // in on a fast scroll up: only a text field brings up a keyboard, and it is far taller
      const on = !!typing && vv.scale <= 1.01 && full - vv.height > MIN_KEYBOARD;
      const was = root.hasAttribute('data-kb');
      if (on !== was) root.toggleAttribute('data-kb', on);
      const covered = on ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
      root.style.setProperty('--kb', `${covered}px`);
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vvt', `${on ? Math.round(vv.offsetTop) : 0}px`);
      if (was && !on) realign();
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
      clearTimeout(settle);
      vv.removeEventListener('resize', check);
      vv.removeEventListener('scroll', check);
      removeEventListener('focusin', later);
      removeEventListener('focusout', later);
      root.removeAttribute('data-kb');
      root.style.removeProperty('--kb');
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vvt');
    };
  }, []);
}
