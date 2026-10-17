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

export class Creator {
  readonly el = document.createElement('div');
  private cat = CATEGORIES[0]!;
  private readonly tabs = document.createElement('div');
  private readonly opts = document.createElement('div');

  constructor(
    private appearance: CharacterAppearance,
    private readonly onChange: (a: CharacterAppearance) => void,
    private readonly onDone: () => void,
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
    const rnd = this.button('Surpreenda-me', () => {
      this.set(randomAppearance());
    });
    const done = this.button('Pronto', () => this.onDone(), true);
    foot.append(rnd, done);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Arraste o personagem para girar · role para aproximar';
    this.el.append(h, this.tabs, this.opts, foot);
    this.opts.after(hint);
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
          s.style.background = col.hex;
          s.setAttribute('aria-pressed', String(this.appearance[sec.key] === col.id));
          s.addEventListener('click', () => this.set({ ...this.appearance, [sec.key]: col.id }));
          grid.append(s);
        }
      } else {
        for (const o of APPEARANCE_OPTIONS[sec.key]) {
          const b = document.createElement('button');
          b.className = 'opt';
          b.textContent = o.name;
          b.setAttribute('aria-pressed', String(this.appearance[sec.key] === o.id));
          b.addEventListener('click', () => this.set({ ...this.appearance, [sec.key]: o.id }));
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
  }

  /** Horizontal center (NDC, −1…1) of the part of `view` left of the panel; 0 when the panel covers most of it. */
  freeCenterX(view: DOMRect): number {
    const r = this.el.getBoundingClientRect();
    const free = r.left - view.left;
    if (this.el.hidden || view.width <= 0 || free < view.width * 0.35) return 0;
    return free / view.width - 1;
  }
}
