/** Appearance workshop. Edits stay in a local draft until the player chooses Save. */
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, FABRIC_COLORS, HAIR_COLORS, SKIN_TONES, randomAppearance, type ColorEntry } from '@graao/game-data';
import type { CharacterAppearance } from '@graao/shared';
import { categoryIcon } from './creatorPreviews';
import './creator.css';

interface Section { key: keyof CharacterAppearance; label: string; colors?: ColorEntry[]; note?: string; when?: (a: CharacterAppearance) => boolean }
interface Category { id: string; label: string; short: string; sections: Section[] }
const CATEGORIES: Category[] = [
  { id: 'body', label: 'Corpo', short: 'Corpo', sections: [{ key: 'bodyId', label: 'Silhueta' }, { key: 'skinId', label: 'Tom de pele', colors: SKIN_TONES }] },
  { id: 'face', label: 'Rosto', short: 'Rosto', sections: [{ key: 'faceId', label: 'Expressão' }, { key: 'beardId', label: 'Barba e bigode', note: 'A barba acompanha a cor do cabelo.' }] },
  { id: 'hair', label: 'Cabelo', short: 'Cabelo', sections: [{ key: 'hairId', label: 'Corte' }, { key: 'hairColorId', label: 'Cor do cabelo', colors: HAIR_COLORS }] },
  { id: 'top', label: 'Parte superior', short: 'Cima', sections: [{ key: 'topId', label: 'Roupa' }, { key: 'topColorId', label: 'Cor da roupa', colors: FABRIC_COLORS }] },
  { id: 'bottom', label: 'Parte inferior', short: 'Baixo', sections: [{ key: 'bottomId', label: 'Roupa' }, { key: 'bottomColorId', label: 'Cor da roupa', colors: FABRIC_COLORS }] },
  { id: 'shoes', label: 'Calçados', short: 'Calçados', sections: [{ key: 'shoesId', label: 'Modelo' }, { key: 'shoesColorId', label: 'Cor do calçado', colors: FABRIC_COLORS }] },
  { id: 'hat', label: 'Chapéus', short: 'Chapéus', sections: [{ key: 'hatId', label: 'Modelo' }, { key: 'hatColorId', label: 'Cor e detalhes', colors: FABRIC_COLORS, note: 'Em palha e couro, a cor muda a fita e os enfeites.', when: (a) => a.hatId !== 'hat.none' }] },
  { id: 'acc', label: 'Acessórios', short: 'Extras', sections: [{ key: 'accessoryId', label: 'Rosto e cabeça' }, { key: 'extraId', label: 'Corpo' }] },
];

export interface CreatorActions {
  /** Updates the existing animated character without persisting the draft. */
  preview: (appearance: CharacterAppearance) => void;
  save: (appearance: CharacterAppearance) => void;
  /** Restores the appearance present when the workshop opened and returns to its origin. */
  discard: (appearance: CharacterAppearance) => void;
  resetView: () => void;
  /** Rotation in radians and a change in camera distance, from dragging/pinching the preview or zoom buttons. */
  viewDelta?: (rotation: number, zoom: number) => void;
  sound?: (cue: 'ui.click' | 'ui.swap') => void;
}

export interface CreatorThumbnailSource {
  request(key: keyof CharacterAppearance, id: string, appearance: CharacterAppearance, signal?: AbortSignal): Promise<string>;
  setActive(on: boolean): void;
}

export function creatorGestureDelta(before: readonly { x: number; y: number }[], after: readonly { x: number; y: number }[]): { rotation: number; zoom: number } {
  if (before.length !== after.length || !after.length) return { rotation: 0, zoom: 0 };
  if (after.length === 1) return { rotation: (after[0]!.x - before[0]!.x) * .012, zoom: 0 };
  const span = (points: readonly { x: number; y: number }[]) => Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
  const previous = span(before), next = span(after);
  return { rotation: 0, zoom: previous > 4 && next > 4 ? Math.max(-.5, Math.min(.5, -Math.log(next / previous) * 2)) : 0 };
}

/** Six large swatches fit even the narrow portrait panel; every color remains available through explicit pages. */
export function creatorPalettePage<T>(colors: readonly T[], page: number, compact: boolean): { colors: T[]; page: number; pages: number } {
  const size = compact ? 6 : Math.max(1, colors.length);
  const pages = Math.max(1, Math.ceil(colors.length / size));
  const current = Math.max(0, Math.min(pages - 1, Math.floor(page)));
  return { colors: colors.slice(current * size, (current + 1) * size), page: current, pages };
}

export class Creator {
  readonly el = document.createElement('section');
  /** Kept as a separate, transparent layer for the application's existing mount point. */
  readonly stage = document.createElement('div');
  readonly previewSurface = document.createElement('div');
  private readonly avatarSpace = document.createElement('div');
  private baseline: CharacterAppearance;
  private appearance: CharacterAppearance;
  private cat = CATEGORIES[0]!;
  private sectionKey: keyof CharacterAppearance = 'bodyId';
  private page = 0;
  private readonly tabs = document.createElement('nav');
  private readonly opts = document.createElement('section');
  private readonly status = document.createElement('p');
  private readonly media = window.matchMedia('(max-width: 760px), (max-height: 640px)');
  private readonly mobile = window.matchMedia('(max-width: 760px)');
  private readonly compact = window.matchMedia('(max-width: 760px), (max-height: 450px)');
  private panelMode: 'pieces' | 'colors' = 'pieces';
  private colorPage = 0;
  private thumbnailRequest: AbortController | null = null;

  constructor(appearance: CharacterAppearance, private readonly actions: CreatorActions, private readonly thumbnails: CreatorThumbnailSource) {
    this.baseline = { ...appearance };
    this.appearance = { ...appearance };
    this.el.className = 'creator-workshop';
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Personalizar personagem');
    this.stage.className = 'creator-workshop-stage';
    this.stage.hidden = true;
    const header = document.createElement('header');
    header.className = 'creator-heading';
    const heading = document.createElement('div');
    const kicker = document.createElement('span');
    kicker.className = 'creator-eyebrow';
    kicker.textContent = 'SEU PERSONAGEM';
    const title = document.createElement('h2');
    title.textContent = 'Quem é você hoje?';
    heading.append(kicker, title);
    const tools = document.createElement('div');
    tools.className = 'creator-tools';
    tools.append(
      this.button('Aleatório', () => this.set(randomAppearance(), true), 'creator-tool', 'dice'),
      this.button('Restaurar padrão', () => this.set(DEFAULT_APPEARANCE, true), 'creator-tool', 'reset'),
    );
    header.append(heading, tools);
    this.tabs.className = 'creator-categories';
    this.tabs.setAttribute('aria-label', 'Categorias de aparência');
    this.tabs.setAttribute('role', 'tablist');
    this.tabs.setAttribute('aria-orientation', this.compact.matches ? 'horizontal' : 'vertical');
    this.previewSurface.className = 'creator-preview';
    this.previewSurface.setAttribute('aria-label', 'Prévia 3D do personagem');
    this.avatarSpace.className = 'creator-avatar-space';
    this.avatarSpace.setAttribute('aria-hidden', 'true');
    const controls = document.createElement('div');
    controls.className = 'creator-view-controls';
    controls.append(this.button('Visão frontal', () => this.actions.resetView(), 'creator-tool', 'rotate'));
    const hint = document.createElement('p');
    hint.textContent = 'Arraste para girar · dois dedos ou + / − para aproximar';
    const farther = this.button('−', () => this.actions.viewDelta?.(0, .3), 'creator-tool creator-zoom');
    farther.setAttribute('aria-label', 'Afastar personagem');
    const closer = this.button('+', () => this.actions.viewDelta?.(0, -.3), 'creator-tool creator-zoom');
    closer.setAttribute('aria-label', 'Aproximar personagem');
    controls.append(farther, closer, hint);
    this.previewSurface.append(this.avatarSpace, controls);
    this.bindPreviewGestures();
    this.opts.className = 'creator-options';
    this.opts.id = 'creator-options';
    this.opts.setAttribute('role', 'tabpanel');
    const foot = document.createElement('footer');
    foot.className = 'creator-footer';
    this.status.className = 'creator-draft-status';
    this.status.setAttribute('aria-live', 'polite');
    const buttons = document.createElement('div');
    buttons.className = 'creator-save-actions';
    buttons.append(
      this.button('Descartar', () => { this.appearance = { ...this.baseline }; this.actions.discard({ ...this.baseline }); }, 'creator-button'),
      this.button('Salvar aparência', () => { this.baseline = { ...this.appearance }; this.actions.save({ ...this.appearance }); }, 'creator-button creator-primary'),
    );
    foot.append(this.status, buttons);
    this.el.append(header, this.tabs, this.previewSurface, this.opts, foot);
    this.media.addEventListener('change', () => { this.revealSelectedPage(); this.renderOptions(); });
    this.compact.addEventListener('change', () => {
      this.tabs.setAttribute('aria-orientation', this.compact.matches ? 'horizontal' : 'vertical');
      this.colorPage = 0; this.renderOptions();
    });
    this.mobile.addEventListener('change', () => {
      this.tabs.setAttribute('aria-orientation', this.compact.matches ? 'horizontal' : 'vertical');
    });
    this.renderTabs();
    this.renderOptions();
  }

  private bindPreviewGestures(): void {
    const points = new Map<number, { x: number; y: number }>();
    const snapshot = () => [...points.values()].slice(0, 2).map((point) => ({ ...point }));
    this.avatarSpace.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try { this.avatarSpace.setPointerCapture(event.pointerId); } catch { /* A cancelled pointer needs no capture. */ }
    });
    this.avatarSpace.addEventListener('pointermove', (event) => {
      if (!points.has(event.pointerId)) return;
      event.preventDefault();
      const before = snapshot();
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const delta = creatorGestureDelta(before, snapshot());
      if (delta.rotation || delta.zoom) this.actions.viewDelta?.(delta.rotation, delta.zoom);
    });
    const release = (event: PointerEvent) => { points.delete(event.pointerId); };
    this.avatarSpace.addEventListener('pointerup', release);
    this.avatarSpace.addEventListener('pointercancel', release);
    this.avatarSpace.addEventListener('lostpointercapture', release);
    window.addEventListener('blur', () => points.clear());
    this.avatarSpace.addEventListener('wheel', (event) => {
      event.preventDefault(); this.actions.viewDelta?.(0, event.deltaY * .0025);
    }, { passive: false });
  }

  private button(label: string, fn: () => void, className: string, icon?: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', label);
    if (icon) button.innerHTML = categoryIcon(icon);
    const text = document.createElement('span');
    text.textContent = label;
    button.append(text);
    button.addEventListener('click', () => { this.actions.sound?.('ui.click'); fn(); });
    return button;
  }

  private get pageSize(): number { return this.media.matches ? 3 : 6; }
  private revealSelectedPage(): void {
    const index = APPEARANCE_OPTIONS[this.sectionKey].findIndex((o) => o.id === this.appearance[this.sectionKey]);
    this.page = Math.floor(Math.max(0, index) / this.pageSize);
  }
  private set(appearance: CharacterAppearance, reveal = false): void {
    this.actions.sound?.('ui.swap');
    this.appearance = { ...appearance };
    this.actions.preview({ ...this.appearance });
    if (reveal) this.revealSelectedPage();
    this.renderOptions();
  }
  /** Starts a new editing session from the player's saved appearance. */
  setAppearance(appearance: CharacterAppearance): void {
    this.baseline = { ...appearance };
    this.appearance = { ...appearance };
    this.revealSelectedPage();
    this.renderOptions();
  }
  private selectCategory(category: Category, focus = true): void {
    this.actions.sound?.('ui.click');
    this.cat = category;
    this.panelMode = 'pieces'; this.colorPage = 0;
    this.sectionKey = category.sections[0]!.key;
    this.revealSelectedPage();
    this.renderTabs();
    this.renderOptions();
    if (focus) this.tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }
  private renderTabs(): void {
    this.tabs.replaceChildren(...CATEGORIES.map((category, index) => {
      const button = this.button(category.label, () => this.selectCategory(category), 'creator-category', category.id);
      button.id = `creator-category-${category.id}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'creator-options');
      button.setAttribute('aria-selected', String(category === this.cat));
      button.tabIndex = category === this.cat ? 0 : -1;
      button.dataset.short = category.short;
      button.addEventListener('keydown', (event) => {
        let next: number;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % CATEGORIES.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + CATEGORIES.length - 1) % CATEGORIES.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = CATEGORIES.length - 1;
        else return;
        event.preventDefault();
        this.selectCategory(CATEGORIES[next]!, true);
      });
      return button;
    }));
  }
  private renderOptions(): void {
    this.thumbnailRequest?.abort();
    this.thumbnailRequest = this.visible ? new AbortController() : null;
    const signal = this.thumbnailRequest?.signal;
    const focused = document.activeElement instanceof HTMLElement && this.opts.contains(document.activeElement) ? document.activeElement.dataset.option : undefined;
    this.opts.setAttribute('aria-labelledby', `creator-category-${this.cat.id}`);
    const heading = document.createElement('div');
    heading.className = 'creator-option-heading';
    const title = document.createElement('h3');
    title.textContent = this.cat.label;
    const instruction = document.createElement('p');
    instruction.textContent = 'As peças reais, nas suas cores';
    heading.append(title, instruction);
    const pieces = this.cat.sections.filter((s) => !s.colors);
    const section = pieces.find((s) => s.key === this.sectionKey) ?? pieces[0]!;
    this.sectionKey = section.key;
    const colorSections = this.cat.sections.filter((s) => s.colors && (!s.when || s.when(this.appearance)));
    if (!colorSections.length) this.panelMode = 'pieces';
    this.opts.dataset.mode = this.compact.matches ? this.panelMode : 'all';
    const modes = document.createElement('div');
    modes.className = 'creator-panel-tabs';
    if (this.compact.matches && colorSections.length) {
      for (const [mode, label] of [['pieces', 'Peças'], ['colors', 'Cores']] as const) {
        const tab = this.button(label, () => { this.panelMode = mode; this.renderOptions(); }, 'creator-section-tab');
        tab.setAttribute('aria-pressed', String(this.panelMode === mode));
        modes.append(tab);
      }
    }
    const sectionTabs = document.createElement('div');
    sectionTabs.className = 'creator-section-tabs';
    sectionTabs.setAttribute('aria-label', 'Tipo de opção');
    for (const part of pieces) {
      const tab = this.button(part.label, () => { this.sectionKey = part.key; this.revealSelectedPage(); this.renderOptions(); }, 'creator-section-tab');
      tab.dataset.option = `section:${part.key}`;
      tab.setAttribute('aria-pressed', String(part.key === section.key));
      sectionTabs.append(tab);
    }
    const list = APPEARANCE_OPTIONS[section.key];
    const pages = Math.ceil(list.length / this.pageSize);
    this.page = Math.min(this.page, pages - 1);
    const grid = document.createElement('div');
    grid.className = 'creator-pieces';
    for (const option of list.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'creator-piece';
      button.title = option.name;
      button.setAttribute('aria-label', option.name);
      button.dataset.option = option.id;
      button.setAttribute('aria-pressed', String(this.appearance[section.key] === option.id));
      const image = document.createElement('span');
      image.className = 'creator-piece-art';
      image.setAttribute('aria-hidden', 'true');
      image.dataset.model = option.id;
      const empty = option.id.endsWith('.none') || option.id === 'hair.careca';
      const placeholder = document.createElement('span');
      placeholder.className = 'creator-thumbnail-placeholder';
      placeholder.textContent = empty ? 'Sem peça' : '3D';
      image.append(placeholder);
      image.dataset.state = empty ? 'empty' : 'loading';
      if (signal && !empty && this.opts.dataset.mode !== 'colors') {
        button.setAttribute('aria-busy', 'true');
        void this.thumbnails.request(section.key, option.id, { ...this.appearance }, signal).then((url) => {
          if (signal.aborted || !image.isConnected) return;
          const rendered = document.createElement('img');
          rendered.src = url;
          rendered.alt = '';
          rendered.decoding = 'async';
          rendered.draggable = false;
          image.replaceChildren(rendered);
          image.dataset.state = 'ready';
          button.setAttribute('aria-busy', 'false');
        }).catch(() => {
          if (signal.aborted || !image.isConnected) return;
          placeholder.textContent = 'Prévia indisponível';
          image.dataset.state = 'error';
          button.setAttribute('aria-busy', 'false');
        });
      }
      const label = document.createElement('span');
      label.className = 'creator-piece-name';
      label.textContent = option.name;
      const tick = document.createElement('span');
      tick.className = 'creator-piece-tick';
      tick.textContent = '✓';
      tick.setAttribute('aria-hidden', 'true');
      button.append(image, label, tick);
      button.addEventListener('click', () => this.set({ ...this.appearance, [section.key]: option.id }));
      grid.append(button);
    }
    const pagination = document.createElement('div');
    pagination.className = 'creator-pagination';
    const previous = this.button('‹', () => { this.page--; this.renderOptions(); }, 'creator-page-button');
    previous.dataset.option = 'previous-page';
    previous.setAttribute('aria-label', 'Opções anteriores');
    previous.disabled = this.page === 0;
    const position = document.createElement('span');
    position.textContent = `${this.page + 1} / ${pages}`;
    position.setAttribute('aria-label', `Página ${this.page + 1} de ${pages}`);
    const next = this.button('›', () => { this.page++; this.renderOptions(); }, 'creator-page-button');
    next.dataset.option = 'next-page';
    next.setAttribute('aria-label', 'Próximas opções');
    next.disabled = this.page === pages - 1;
    pagination.append(previous, position, next);
    pagination.hidden = pages < 2;
    const palette = document.createElement('div');
    palette.className = 'creator-palette';
    for (const colors of colorSections) {
      const label = document.createElement('p');
      label.className = 'creator-palette-label';
      const selected = colors.colors!.find((color) => color.id === this.appearance[colors.key]);
      label.textContent = `${colors.label} · ${selected?.name ?? ''}`;
      const swatches = document.createElement('div');
      swatches.className = 'creator-swatches';
      swatches.setAttribute('role', 'group');
      swatches.setAttribute('aria-label', colors.label);
      const colorView = creatorPalettePage(colors.colors!, this.colorPage, this.compact.matches);
      this.colorPage = colorView.page;
      for (const color of colorView.colors) {
        const swatch = this.button('', () => this.set({ ...this.appearance, [colors.key]: color.id }), 'creator-swatch');
        swatch.title = color.name;
        swatch.dataset.option = color.id;
        swatch.setAttribute('aria-label', color.name);
        swatch.setAttribute('aria-pressed', String(this.appearance[colors.key] === color.id));
        swatch.style.setProperty('--swatch', color.hex);
        swatch.firstElementChild!.textContent = '✓';
        swatch.firstElementChild!.setAttribute('aria-hidden', 'true');
        swatches.append(swatch);
      }
      palette.append(label, swatches);
      if (this.compact.matches && colorView.pages > 1) {
        const pages = document.createElement('div'); pages.className = 'creator-color-pages';
        const previous = this.button('‹', () => { this.colorPage--; this.renderOptions(); }, 'creator-page-button');
        previous.setAttribute('aria-label', 'Cores anteriores'); previous.disabled = this.colorPage === 0;
        const position = document.createElement('span'); position.textContent = `${this.colorPage + 1} / ${colorView.pages}`;
        const next = this.button('›', () => { this.colorPage++; this.renderOptions(); }, 'creator-page-button');
        next.setAttribute('aria-label', 'Próximas cores'); next.disabled = this.colorPage + 1 === colorView.pages;
        pages.append(previous, position, next); palette.append(pages);
      }
      if (colors.note) palette.append(this.note(colors.note));
    }
    if (section.note) palette.append(this.note(section.note));
    this.opts.replaceChildren(heading, modes, sectionTabs, grid, pagination, palette);
    const changed = (Object.keys(this.appearance) as (keyof CharacterAppearance)[]).some((key) => this.appearance[key] !== this.baseline[key]);
    this.status.textContent = changed ? 'Seu novo visual está na prévia. Salve para usar.' : 'Um visual com a sua cara.';
    if (focused) [...this.opts.querySelectorAll<HTMLButtonElement>('[data-option]')].find((button) => button.dataset.option === focused)?.focus({ preventScroll: true });
  }
  private note(text: string): HTMLParagraphElement {
    const note = document.createElement('p');
    note.className = 'creator-option-note';
    note.textContent = text;
    return note;
  }
  get visible(): boolean { return !this.el.hidden; }
  show(visible: boolean): void {
    const entering = visible && this.el.hidden;
    this.el.hidden = !visible;
    this.stage.hidden = !visible;
    this.thumbnails.setActive(visible);
    if (!visible) { this.thumbnailRequest?.abort(); this.thumbnailRequest = null; }
    if (entering) { this.appearance = { ...this.baseline }; this.revealSelectedPage(); this.renderOptions(); }
    if (entering) requestAnimationFrame(() => {
      if (!this.visible) return;
      const control = this.tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?? this.el.querySelector<HTMLButtonElement>('button:not(:disabled)');
      control?.focus({ preventScroll: true });
    });
  }
  /** The camera fits only the free avatar area, above the separate view controls. */
  previewBounds(): DOMRect { return this.avatarSpace.getBoundingClientRect(); }
  freeCenterX(view: DOMRect): number {
    if (this.el.hidden || view.width <= 0) return 0;
    const rect = this.previewBounds();
    return ((rect.left + rect.width / 2 - view.left) / view.width) * 2 - 1;
  }
  /** Presentation controls are anchored to the preview area, clear of clothes and hats. */
  layout(_headTop: number, _centerX: number, _spread: number): void {}
}
