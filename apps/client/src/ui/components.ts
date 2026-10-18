/** Shared paper-and-ink primitives, independent of gameplay. */
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
export function button(text: string, action: () => void, primary = false): HTMLButtonElement {
  const e = node('button', `btn gra-button${primary ? ' primary' : ''}`, text);
  e.type = 'button';
  if (text === '✕') e.setAttribute('aria-label', 'Fechar');
  e.addEventListener('click', action);
  return e;
}
export function badge(text: string, tone = ''): HTMLElement {
  const e = node('span', 'gra-badge', text);
  e.dataset.tone = tone;
  return e;
}
export function field(label: string, input: HTMLElement): HTMLLabelElement {
  const e = node('label', 'gra-field');
  e.append(node('span', '', label), input);
  return e;
}
export function focusScreen(el: HTMLElement): void {
  requestAnimationFrame(() =>
    el.querySelector<HTMLElement>('[data-focus], button:not(:disabled), input, select')?.focus({ preventScroll: true }),
  );
}
export class Modal {
  readonly el = node('div', 'gra-modal');
  readonly card = node('section', 'gra-panel gra-dialog');
  readonly body = node('div', 'gra-dialog-body');
  readonly note = node('p', 'gra-feedback');
  private previous: HTMLElement | null = null;
  constructor(
    title: string,
    private readonly onClose: () => void = () => {},
  ) {
    this.el.hidden = true;
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-label', title);
    const head = node('div', 'gra-heading');
    head.append(
      node('h2', '', title),
      button('✕', () => this.hide()),
    );
    this.card.append(head, this.body, this.note);
    this.el.append(this.card);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.hide();
      }
      if (e.key !== 'Tab') return;
      const controls = [
        ...this.card.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
        ),
      ].filter((x) => x.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    });
  }
  show(): void {
    this.previous = document.activeElement as HTMLElement | null;
    this.el.hidden = false;
    focusScreen(this.el);
  }
  hide(): void {
    const was = this.visible;
    this.el.hidden = true;
    if (was) {
      this.previous?.focus({ preventScroll: true });
      this.onClose();
    }
  }
  get visible(): boolean {
    return !this.el.hidden;
  }
  message(text: string, error = false): void {
    this.note.textContent = text;
    this.note.dataset.error = String(error);
  }
}
export class Toast {
  readonly el = node('div', 'gra-toast');
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
  }
  show(text: string, error = false): void {
    clearTimeout(this.timer);
    this.el.textContent = text;
    this.el.dataset.error = String(error);
    this.el.hidden = false;
    this.timer = setTimeout(
      () => {
        this.el.hidden = true;
      },
      error ? 7000 : 3500,
    );
  }
}
