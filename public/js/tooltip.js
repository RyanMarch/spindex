// tooltip.js - Lightweight hover tooltips for toolbar controls.
//
// Deliberately does nothing at all on touch/tablet devices: the "show after
// a hover delay" interaction only makes sense where hovering is a real,
// deliberate gesture, and matching only on screen width (a media query in
// CSS) would still leave the listeners wired up and misfiring on a
// touchscreen laptop or a mouse-less tablet with a trackpad. Gating on
// `(hover: hover) and (pointer: fine)` up front means devices without a
// precise hover-capable pointer never pay for this at all.
const HOVER_CAPABLE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const SHOW_DELAY_MS = 550;

export function initTooltips(root = document) {
  if (!HOVER_CAPABLE) return;

  let tipEl = null;
  let showTimer = null;
  let activeTarget = null;

  const createTip = () => {
    const el = document.createElement('div');
    el.className = 'app-tooltip';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    return el;
  };

  const position = (target) => {
    const rect = target.getBoundingClientRect();
    const tipRect = tipEl.getBoundingClientRect();
    const margin = 8;

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));

    let top = rect.bottom + margin;
    let placement = 'bottom';
    if (top + tipRect.height > window.innerHeight - margin) {
      top = rect.top - tipRect.height - margin;
      placement = 'top';
    }

    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
    tipEl.dataset.placement = placement;

    // The box itself can get nudged off-center to stay on screen, but the
    // little arrow should still point at the target it's actually for.
    const targetCenter = rect.left + rect.width / 2;
    const arrowMargin = 10;
    const arrowX = Math.max(arrowMargin, Math.min(targetCenter - left, tipRect.width - arrowMargin));
    tipEl.style.setProperty('--arrow-x', `${arrowX}px`);
  };

  const show = (target) => {
    const text = target.getAttribute('data-tooltip');
    if (!text) return;
    if (!tipEl) tipEl = createTip();
    tipEl.textContent = text;
    tipEl.classList.remove('visible');
    position(target);
    // Reflow between removing/adding the class so the fade-in transition
    // actually plays instead of being coalesced into a no-op.
    void tipEl.offsetWidth;
    tipEl.classList.add('visible');
  };

  const hide = () => {
    clearTimeout(showTimer);
    showTimer = null;
    activeTarget = null;
    tipEl?.classList.remove('visible');
  };

  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const target = e.target.closest('[data-tooltip]');
    if (!target || target === activeTarget) return;
    hide();
    activeTarget = target;
    showTimer = setTimeout(() => show(target), SHOW_DELAY_MS);
  });

  root.addEventListener('pointerout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target || target !== activeTarget) return;
    if (target.contains(e.relatedTarget)) return;
    hide();
  });

  root.addEventListener('pointerdown', hide);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}
