// Custom tooltip for icon-only buttons (title text isn't visible on them,
// only aria-label, so hovering needs its own affordance). Positioned above
// the target by default, arrow pointing down; flips below with the arrow
// pointing up when there's no room above the viewport, and is clamped
// horizontally so it never runs off either side either.
(function () {
  const GAP = 8;
  const MARGIN = 8;
  let bubble = null;
  let currentTarget = null;

  function ensureBubble() {
    if (bubble) return bubble;
    bubble = document.createElement('div');
    bubble.className = 'tooltip-bubble';
    bubble.setAttribute('role', 'tooltip');
    document.body.appendChild(bubble);
    return bubble;
  }

  function position(target, el) {
    const rect = target.getBoundingClientRect();
    const bubbleRect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let placement = 'top';
    let top = rect.top - bubbleRect.height - GAP;
    if (top < MARGIN) {
      placement = 'bottom';
      top = rect.bottom + GAP;
      if (top + bubbleRect.height > vh - MARGIN) {
        top = Math.max(MARGIN, vh - bubbleRect.height - MARGIN);
      }
    }

    const targetCenter = rect.left + rect.width / 2;
    let left = targetCenter - bubbleRect.width / 2;
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - bubbleRect.width - MARGIN));

    const arrowX = Math.min(Math.max(targetCenter - left, 12), bubbleRect.width - 12);

    el.dataset.placement = placement;
    el.style.setProperty('--tooltip-arrow', `${arrowX}px`);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  function show(target, textOverride) {
    const text = textOverride || target.getAttribute('data-tooltip');
    if (!text) return;
    currentTarget = target;
    const el = ensureBubble();
    el.textContent = text;
    el.classList.remove('is-visible');
    position(target, el);
    requestAnimationFrame(() => {
      if (currentTarget === target) el.classList.add('is-visible');
    });
  }

  function hide() {
    currentTarget = null;
    if (bubble) bubble.classList.remove('is-visible');
  }

  // For feedback that isn't tied to hover, e.g. a result popping up after a
  // click and fading on its own rather than waiting on mouseleave.
  function showTransient(target, text, duration) {
    show(target, text);
    setTimeout(() => {
      if (currentTarget === target) hide();
    }, duration);
  }

  window.bittyTooltip = { show, hide, showTransient };

  // mouseenter/mouseleave don't bubble, but a capture-phase listener on
  // document still receives them for every descendant on the way down, so
  // this delegates without wiring a listener onto each button individually.
  document.addEventListener('mouseenter', (e) => {
    const t = e.target.closest && e.target.closest('[data-tooltip]');
    if (t) show(t);
  }, true);
  document.addEventListener('mouseleave', (e) => {
    const t = e.target.closest && e.target.closest('[data-tooltip]');
    if (t && t === currentTarget) hide();
  }, true);
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest && e.target.closest('[data-tooltip]');
    if (t) show(t);
  });
  document.addEventListener('focusout', (e) => {
    const t = e.target.closest && e.target.closest('[data-tooltip]');
    if (t && t === currentTarget) hide();
  });
  document.addEventListener('click', hide, true);
})();
