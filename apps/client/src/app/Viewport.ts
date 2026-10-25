/** Match the canvas and UI to the visible browser area, including address bars and the on-screen keyboard. */
export interface ViewportReading { width: number; height: number; left: number; top: number }
interface VisualReading { width: number; height: number; offsetLeft: number; offsetTop: number; scale: number }

export function visibleViewport(width: number, height: number, visual?: VisualReading | null): ViewportReading {
  const positive = (value: number, fallback: number) => Number.isFinite(value) && value > 0 ? value : fallback;
  width = positive(width, 1); height = positive(height, 1);
  // Pinch-to-zoom belongs to the browser: do not continually shrink/reflow the game under an enlarged page.
  if (!visual || Math.abs(visual.scale - 1) > .01) return { width, height, left: 0, top: 0 };
  return {
    width: Math.min(width, positive(visual.width, width)), height: Math.min(height, positive(visual.height, height)),
    left: Number.isFinite(visual.offsetLeft) ? Math.max(0, visual.offsetLeft) : 0,
    top: Number.isFinite(visual.offsetTop) ? Math.max(0, visual.offsetTop) : 0,
  };
}

export function observeAppViewport(onResize: () => void): () => void {
  let frame = 0, previous = '';
  const apply = () => {
    frame = 0;
    const size = visibleViewport(window.innerWidth, window.innerHeight, window.visualViewport);
    const signature = `${size.width},${size.height},${size.left},${size.top}`;
    if (signature === previous) return;
    previous = signature;
    for (const key of ['width', 'height', 'left', 'top'] as const) document.documentElement.style.setProperty(`--app-${key}`, `${size[key]}px`);
    onResize();
    window.dispatchEvent(new Event('graao:viewportresize'));
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(apply); };
  window.addEventListener('resize', queue);
  window.addEventListener('orientationchange', queue);
  window.visualViewport?.addEventListener('resize', queue);
  window.visualViewport?.addEventListener('scroll', queue);
  apply();
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', queue);
    window.removeEventListener('orientationchange', queue);
    window.visualViewport?.removeEventListener('resize', queue);
    window.visualViewport?.removeEventListener('scroll', queue);
  };
}
