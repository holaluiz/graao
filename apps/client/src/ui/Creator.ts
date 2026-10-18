/**
 * CharacterCustomizer UI (DOM/CSS). Category tabs, each with one or more sections (pieces or color swatches); part
 * changes rebuild from cached geometry, color changes only update the palette — both instant, no loading screens.
 * Drag on the canvas rotates, wheel zooms (handled by the app).
 */
import { APPEARANCE_OPTIONS, FABRIC_COLORS, HAIR_COLORS, SKIN_TONES, randomAppearance, type ColorEntry } from '@graao/game-data';
import type { CharacterAppearance } from '@graao/shared';

interface Section {
  key: keyof CharacterAppearance;
  label?: string;
  /** Swatches instead of named pieces. */
  colors?: ColorEntry[];
  note?: string;
  /** Hidden when it does not apply (no hat → no hat color). */
  when?: (a: CharacterAppearance) => boolean;
}

interface Category {
  id: string;
  label: string;
  sections: Section[];
}

const CATEGORIES: Category[] = [
  { id: 'body', label: 'Corpo', sections: [{ key: 'bodyId' }, { key: 'skinId', label: 'Tom de pele', colors: SKIN_TONES }] },
  { id: 'face', label: 'Rosto', sections: [{ key: 'faceId' }, { key: 'beardId', label: 'Barba e bigode', note: 'Usa a cor do cabelo.' }] },
  { id: 'hair', label: 'Cabelo', sections: [{ key: 'hairId' }, { key: 'hairColorId', label: 'Cor', colors: HAIR_COLORS }] },
  { id: 'top', label: 'Cima', sections: [{ key: 'topId' }, { key: 'topColorId', label: 'Cor', colors: FABRIC_COLORS }] },
  { id: 'bottom', label: 'Baixo', sections: [{ key: 'bottomId' }, { key: 'bottomColorId', label: 'Cor', colors: FABRIC_COLORS }] },
  { id: 'shoes', label: 'Calçados', sections: [{ key: 'shoesId' }, { key: 'shoesColorId', label: 'Cor', colors: FABRIC_COLORS }] },
  {
    id: 'hat',
    label: 'Chapéu',
    sections: [
      { key: 'hatId' },
      {
        key: 'hatColorId',
        label: 'Cor',
        colors: FABRIC_COLORS,
        note: 'No chapéu de palha e no de cangaceiro, a cor vai na fita e nos enfeites.',
        when: (a) => a.hatId !== 'hat.none',
      },
    ],
  },
  { id: 'acc', label: 'Acessórios', sections: [{ key: 'accessoryId', label: 'Rosto e cabeça' }, { key: 'extraId', label: 'Corpo' }] },
];

const ICON = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="10" y="1.5" width="4.2" height="21" rx="2" transform="rotate(45 12 12)"/><rect x="10" y="1.5" width="4.2" height="21" rx="2" transform="rotate(-45 12 12)"/></svg>',
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M5 2.5h14a2.5 2.5 0 0 1 2.5 2.5v14a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 19V5A2.5 2.5 0 0 1 5 2.5Zm2.6 3.4a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm8.8 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm-4.4 4.4a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm8.8 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z"/></svg>',
};

export class Creator {
  readonly el = document.createElement('div');
  /** Full-screen layer with the close (X) and "surprise me" buttons over the character's head. */
  readonly stage = document.createElement('div');
  private cat = CATEGORIES[0]!;
  private readonly tabs = document.createElement('div');
  private readonly opts = document.createElement('div');
  private readonly closeBtn: HTMLButtonElement;
  private readonly diceBtn: HTMLButtonElement;

  constructor(
    private appearance: CharacterAppearance,
    private readonly onChange: (a: CharacterAppearance) => void,
    private readonly onDone: () => void,
    private readonly sound: (cue: 'ui.click' | 'ui.swap') => void = () => {},
  ) {
    this.el.className = 'creator';
    this.el.hidden = true;
    const h = document.createElement('h2');
    h.textContent = 'Quem é você hoje?';
    this.tabs.className = 'tabs';
    this.tabs.setAttribute('role', 'tablist');
    this.opts.className = 'options';
    const foot = document.createElement('div');
    foot.className = 'row';
    const done = this.button('Pronto', () => this.onDone(), true);
    foot.append(done);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Arraste para girar · role para aproximar';
    this.el.append(h, this.tabs, this.opts, foot);
    this.opts.after(hint);

    this.stage.className = 'creator-stage';
    this.stage.hidden = true;
    this.closeBtn = this.iconButton(ICON.close, 'Pronto', () => this.onDone());
    this.closeBtn.classList.add('close');
    this.diceBtn = this.iconButton(ICON.dice, 'Surpreenda-me', () => this.surprise());
    this.diceBtn.classList.add('dice');
    this.stage.append(this.closeBtn, this.diceBtn);
    this.renderTabs();
    this.renderOptions();
  }

  private button(label: string, fn: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `btn${primary ? ' primary' : ''}`;
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }

  private iconButton(svg: string, label: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'ink-btn';
    b.innerHTML = svg;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }

  private surprise(): void {
    this.sound('ui.swap');
    this.set(randomAppearance());
  }

  private set(a: CharacterAppearance): void {
    this.appearance = { ...a };
    this.onChange(this.appearance);
    this.renderOptions();
  }

  setAppearance(a: CharacterAppearance): void {
    this.appearance = { ...a };
    this.renderOptions();
  }

  private renderTabs(): void {
    this.tabs.replaceChildren(
      ...CATEGORIES.map((c) => {
        const t = document.createElement('button');
        t.className = 'tab';
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', String(c === this.cat));
        t.textContent = c.label;
        t.addEventListener('click', () => {
          this.sound('ui.click');
          this.cat = c;
          this.renderTabs();
          this.renderOptions();
          this.opts.scrollTop = 0;
        });
        return t;
      }),
    );
  }

  private renderOptions(): void {
    const scroll = this.opts.scrollTop;
    const out: HTMLElement[] = [];
    for (const sec of this.cat.sections) {
      if (sec.when && !sec.when(this.appearance)) continue;
      if (sec.label) {
        const label = document.createElement('div');
        label.className = 'hint section';
        label.textContent = sec.label;
        out.push(label);
      }
      const grid = document.createElement('div');
      grid.className = sec.colors ? 'swatches' : 'parts';
      if (sec.colors) {
        for (const col of sec.colors) {
          const s = document.createElement('button');
          s.className = 'swatch';
          s.title = col.name;
          s.setAttribute('aria-label', col.name);
          s.style.setProperty('--fill', col.hex);
          const selected = this.appearance[sec.key] === col.id;
          s.setAttribute('aria-pressed', String(selected));
          if (selected) s.append(document.createElement('i'));
          s.addEventListener('click', () => {
            this.sound('ui.swap');
            this.set({ ...this.appearance, [sec.key]: col.id });
          });
          grid.append(s);
        }
      } else {
        for (const o of APPEARANCE_OPTIONS[sec.key]) {
          const b = document.createElement('button');
          b.className = 'opt';
          b.textContent = o.name;
          b.setAttribute('aria-pressed', String(this.appearance[sec.key] === o.id));
          b.addEventListener('click', () => {
            this.sound('ui.swap');
            this.set({ ...this.appearance, [sec.key]: o.id });
          });
          grid.append(b);
        }
      }
      out.push(grid);
      if (sec.note) {
        const note = document.createElement('div');
        note.className = 'hint note';
        note.textContent = sec.note;
        out.push(note);
      }
    }
    this.opts.replaceChildren(...out);
    this.opts.scrollTop = scroll;
  }

  show(v: boolean): void {
    this.el.hidden = !v;
    this.stage.hidden = !v;
  }

  /**
   * Places the close and dice buttons over the character every frame: `headTop` is the top of the head on screen
   * (CSS px), `centerX` the body's screen x and `spread` the distance (px) from it to each button.
   */
  layout(headTop: number, centerX: number, spread: number): void {
    if (this.stage.hidden) return;
    const size = Math.round(Math.max(40, Math.min(58, spread * 0.4)));
    this.stage.style.setProperty('--ink-btn', `${size}px`);
    // Keep both buttons inside the free area (left of the panel when the panel leaves room).
    const panel = this.el.getBoundingClientRect();
    const maxX = panel.left > window.innerWidth * 0.35 ? panel.left - 14 : window.innerWidth - 14;
    spread = Math.max(size * 0.95, Math.min(spread, centerX - 14 - size / 2, maxX - centerX - size / 2));
    const top = Math.max(size * 0.6 + 10, headTop);
    this.closeBtn.style.translate = `${Math.round(centerX + spread - size / 2)}px ${Math.round(top - size / 2)}px`;
    this.diceBtn.style.translate = `${Math.round(centerX - spread - size / 2)}px ${Math.round(top - size / 2)}px`;
  }

  /** Horizontal center (NDC, −1…1) of the part of `view` left of the panel; 0 when the panel covers most of it. */
  freeCenterX(view: DOMRect): number {
    const r = this.el.getBoundingClientRect();
    const free = r.left - view.left;
    if (this.el.hidden || view.width <= 0 || free < view.width * 0.35) return 0;
    return free / view.width - 1;
  }
}
