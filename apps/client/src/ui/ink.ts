/**
 * Hand-drawn cards for the DOM UI (the Messenger buttons): every button is a slightly crooked white quad with a hard
 * slate shadow, tilted a hair off true. CSS draws the card (`::before`) and its shadow (`::after`) from per-element
 * corner offsets (`--j1…--j8`) and a tilt (`--tilt`) set here; hovering re-draws the quad so the lines "boil".
 */
const INK_SELECTOR = '.btn, .tab, .opt, .swatch, .ink-btn, .creator, .ink-card';

/** Gives `el` its own crooked corners and tilt (`amp` = max corner offset in px). */
export function inkify(el: HTMLElement, amp = 3.2): void {
  for (let i = 1; i <= 8; i++) el.style.setProperty(`--j${i}`, `${(Math.random() * amp).toFixed(1)}px`);
  if (!el.classList.contains('creator')) el.style.setProperty('--tilt', `${((Math.random() - 0.5) * 2.2).toFixed(2)}deg`);
}

/** Inks every matching element under `root`, now and as they are added; re-draws a card when the pointer enters it. */
export function autoInk(root: HTMLElement): void {
  const inkAll = (n: ParentNode) => {
    if (n instanceof HTMLElement && n.matches(INK_SELECTOR)) inkify(n);
    n.querySelectorAll?.<HTMLElement>(INK_SELECTOR).forEach((e) => inkify(e));
  };
  inkAll(root);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n instanceof HTMLElement && inkAll(n));
  }).observe(root, { childList: true, subtree: true });
  root.addEventListener(
    'pointerover',
    (e) => {
      const t = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.btn, .tab, .opt, .swatch, .ink-btn');
      if (t && !t.contains(e.relatedTarget as Node | null)) inkify(t);
    },
    true,
  );
}
