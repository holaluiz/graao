/**
 * CharacterCustomizer UI (DOM/CSS). Category tabs; part changes rebuild from cached geometry, color changes only
 * update the palette — both instant, no loading screens. Drag on the canvas rotates, wheel zooms (handled by the app).
 */
import { APPEARANCE_OPTIONS, FABRIC_COLORS, HAIR_COLORS, SKIN_TONES, randomAppearance, type ColorEntry } from '@graao/game-data';
import type { CharacterAppearance } from '@graao/shared';

interface Category {
  id: string;
  label: string;
  key: keyof CharacterAppearance;
  colorKey?: keyof CharacterAppearance;
  colors?: ColorEntry[];
}

const CATEGORIES: Category[] = [
  { id: 'body', label: 'Corpo', key: 'bodyId', colorKey: 'skinId', colors: SKIN_TONES },
  { id: 'face', label: 'Rosto', key: 'faceId' },
  { id: 'hair', label: 'Cabelo', key: 'hairId', colorKey: 'hairColorId', colors: HAIR_COLORS },
  { id: 'top', label: 'Parte de cima', key: 'topId', colorKey: 'topColorId', colors: FABRIC_COLORS },
  { id: 'bottom', label: 'Parte de baixo', key: 'bottomId', colorKey: 'bottomColorId', colors: FABRIC_COLORS },
  { id: 'shoes', label: 'Calçados', key: 'shoesId', colorKey: 'shoesColorId', colors: FABRIC_COLORS },
  { id: 'acc', label: 'Acessório', key: 'accessoryId' },
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
        });
        return t;
      }),
    );
  }

  private renderOptions(): void {
    const c = this.cat;
    const items: HTMLElement[] = [];
    for (const o of APPEARANCE_OPTIONS[c.key]) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = o.name;
      b.setAttribute('aria-pressed', String(this.appearance[c.key] === o.id));
      b.addEventListener('click', () => this.set({ ...this.appearance, [c.key]: o.id }));
      items.push(b);
    }
    if (c.colors && c.colorKey) {
      const label = document.createElement('div');
      label.className = 'hint';
      label.style.gridColumn = '1 / -1';
      label.textContent = c.id === 'body' ? 'Tom de pele' : 'Cor';
      items.push(label);
      for (const col of c.colors) {
        const s = document.createElement('button');
        s.className = 'swatch';
        s.title = col.name;
        s.setAttribute('aria-label', col.name);
        s.style.background = col.hex;
        s.setAttribute('aria-pressed', String(this.appearance[c.colorKey] === col.id));
        s.addEventListener('click', () => this.set({ ...this.appearance, [c.colorKey!]: col.id }));
        items.push(s);
      }
    }
    this.opts.replaceChildren(...items);
  }

  show(v: boolean): void {
    this.el.hidden = !v;
  }
}
