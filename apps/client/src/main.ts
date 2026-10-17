/**
 * Boot: the HTML shell (logo + real progress) is already painted. This tiny entry loads the engine chunk with a
 * dynamic import, reports real progress, waits for ENTER (unlocks audio), then reveals the live world.
 */
import './styles/main.css';
import './styles/draft.css';

const bar = document.getElementById('boot-bar') as HTMLElement;
const status = document.getElementById('boot-status') as HTMLElement;
const enter = document.getElementById('boot-enter') as HTMLButtonElement;
const boot = document.getElementById('boot') as HTMLElement;

export function setProgress(fraction: number, label?: string): void {
  bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (label) status.textContent = label;
}

function fail(e: unknown): void {
  console.error(e);
  status.classList.add('err');
  status.textContent = `Algo rasgou o papel: ${(e as Error)?.message ?? e}`;
}

async function start(): Promise<void> {
  if (!document.createElement('canvas').getContext('webgl2')) {
    fail(new Error('este navegador não tem WebGL2. O graao precisa do Chrome ou do Edge no computador.'));
    return;
  }
  setProgress(0.04, 'Carregando o motor…');
  const { GraaoApp } = await import('./app/GraaoApp');
  setProgress(0.12, 'Misturando pigmentos…');
  const app = new GraaoApp(document.getElementById('game') as HTMLCanvasElement, document.getElementById('ui') as HTMLElement);
  if (import.meta.env.DEV) (window as unknown as { __graao: unknown }).__graao = app;
  await app.load((f, label) => setProgress(0.12 + f * 0.86, label));
  setProgress(1, 'Pronto');
  enter.hidden = false;
  enter.focus();
  // ?auto skips the ENTER click (development and automated tests).
  if (!new URLSearchParams(location.search).has('auto')) {
    await new Promise<void>((resolve) => enter.addEventListener('click', () => resolve(), { once: true }));
  }
  app.unlockAudio();
  app.start();
  boot.classList.add('reveal');
  setTimeout(() => boot.remove(), 1200);
}

start().catch(fail);
