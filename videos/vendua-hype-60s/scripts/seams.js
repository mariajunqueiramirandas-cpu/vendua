// Seam transitions between frames, on the main timeline (track seconds), tweening only the
// frame wrappers #el-<id>. build.sh injects this file into index.html and applies SEAM_HOLDS:
// a frame listed there stays mounted that long past its cut, holding its last state on top
// while it leaves, so the next frame starts on its beat underneath.
// SEAM_HOLDS {"01-hook": 0.26, "02-brand": 0.24, "03-loja": 0.24, "05-dua": 0.4, "07-preco": 0.2, "08-planos": 0.3}
(function () {
  const tl = window.__timelines["main"];
  const W = (id) => "#el-" + id;
  const at = (sel, from, to, t) => tl.fromTo(sel, from, Object.assign({ immediateRender: false }, to), t);

  // 3.75 · hook → brand (drop): a diagonal lime floor rises through the dark
  at(W("01-hook"), { clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 114%)" },
    { clipPath: "polygon(0% 0%, 100% 0%, 100% -14%, 0% 0%)", duration: 0.26, ease: "power3.out" }, 3.75);
  at(W("02-brand"), { scale: 1.07 }, { scale: 1, duration: 0.45, ease: "power3.out" }, 3.75);

  // 7.5 · brand → loja: a short dip, then the lime page is yanked up and the phone rises under it
  at(W("02-brand"), { y: 0, scale: 1 }, { y: 40, scale: 0.985, duration: 0.16, ease: "power2.out" }, 7.34);
  at(W("02-brand"), { y: 40, skewY: 0, filter: "blur(0px)" },
    { y: -1980, skewY: -4, filter: "blur(10px)", duration: 0.22, ease: "power2.in" }, 7.5);
  at(W("03-loja"), { y: 120 }, { y: 0, duration: 0.42, ease: "expo.out" }, 7.5);

  // 15 · loja → pedido: zoom through the sales number into the lock screen
  at(W("03-loja"), { scale: 1, filter: "blur(0px)" }, { scale: 1.08, duration: 0.22, ease: "power2.in" }, 14.78);
  at(W("03-loja"), { scale: 1.08, opacity: 1, filter: "blur(0px)" },
    { scale: 1.7, opacity: 0, filter: "blur(18px)", duration: 0.24, ease: "power2.in" }, 15);
  at(W("04-pedido"), { scale: 1.14, filter: "blur(10px)" },
    { scale: 1, filter: "blur(0px)", duration: 0.4, ease: "expo.out" }, 15);

  // 22.5 · pedido → Duá: frame 4 already irises into lime; nothing to add

  // 30 · Duá → smart: a whip pan left, both frames locked together
  at(W("05-dua"), { x: 0, filter: "blur(0px)" }, { x: -1080, filter: "blur(16px)", duration: 0.4, ease: "power4.out" }, 30);
  at(W("06-smart"), { x: 1080, filter: "blur(16px)" }, { x: 0, filter: "blur(0px)", duration: 0.4, ease: "power4.out" }, 30);

  // 37.5 · smart → preço: frame 6 whips its card up; the question keeps rising into place
  at(W("07-preco"), { y: 140, filter: "blur(12px)" }, { y: 0, filter: "blur(0px)", duration: 0.34, ease: "expo.out" }, 37.5);

  // 41.25 · preço → planos (drop): crash through the lime question onto the plan card
  at(W("07-preco"), { scale: 1, opacity: 1, filter: "blur(0px)" },
    { scale: 1.5, opacity: 0, filter: "blur(16px)", duration: 0.2, ease: "power1.out" }, 41.25);
  at(W("08-planos"), { scale: 1.08 }, { scale: 1, duration: 0.45, ease: "power3.out" }, 41.25);

  // 52.5 · planos → cta (drop): the lime closes like a shutter onto the dark end card
  at(W("08-planos"), { clipPath: "inset(0% 0% 0% 0%)" }, { clipPath: "inset(50% 0% 50% 0%)", duration: 0.34, ease: "expo.out" }, 52.5);
  at(W("09-cta"), { scale: 1.1 }, { scale: 1, duration: 0.5, ease: "power3.out" }, 52.5);
})();
