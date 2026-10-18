/** Main menu (DOM): name, create/join by room code, free roam, customize, profile and history, quality, frame-rate cap. */
import { MAX_SOLO_BOTS, ROOM_CODE_LENGTH, ROOM_CODE_PREFIX } from '@graao/shared';
import { FPS_CAPS, type FpsCap } from '../app/FrameLimiter';
import type { Quality } from '../render/GRARenderer';

export interface MenuActions {
  solo(bots: number): void;
  create(name: string): void;
  join(code: string, name: string): void;
  customize(): void;
  history?(): void;
  quality(q: Quality): void;
  fpsCap(c: FpsCap): void;
  click(): void;
}

const QUALITY_LABEL: Record<Quality, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta' };
const FPS_LABEL: Record<FpsCap, string> = { 30: '30', 60: '60', 120: '120', 0: 'Máximo' };

export class Menu {
  readonly el = document.createElement('div');
  private readonly note = document.createElement('div');
  private readonly nameInput = document.createElement('input');
  private readonly codeInput = document.createElement('input');
  private readonly botSelect = document.createElement('select');
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(private readonly actions: MenuActions, name: string, quality: Quality, fps: FpsCap) {
    this.el.className = 'menu';
    const h = document.createElement('h1');
    h.textContent = 'graao';
    const tag = document.createElement('p');
    tag.className = 'tag';
    tag.textContent = 'um planetinha · armas, magia e roupas boas';
    this.nameInput.className = 'field';
    this.nameInput.maxLength = 16;
    this.nameInput.placeholder = 'Seu nome';
    this.nameInput.value = name;
    this.nameInput.setAttribute('aria-label', 'Nome de exibição');
    this.nameInput.style.textTransform = 'none';
    this.nameInput.style.letterSpacing = '0.02em';

    const create = this.btn('Criar partida', () => this.actions.create(this.name()), true);
    this.codeInput.className = 'field';
    this.codeInput.placeholder = `${ROOM_CODE_PREFIX}XXXX`;
    this.codeInput.maxLength = ROOM_CODE_PREFIX.length + ROOM_CODE_LENGTH;
    this.codeInput.setAttribute('aria-label', 'Código da sala');
    this.codeInput.addEventListener('input', () => {
      let v = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (v.length > 0 && !v.startsWith('GR')) v = `${ROOM_CODE_PREFIX}${v.replace(/-/g, '')}`;
      this.codeInput.value = v;
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join.click();
    });
    const join = this.btn('Entrar', () => this.actions.join(this.codeInput.value.trim(), this.name()));
    const joinRow = document.createElement('div');
    joinRow.className = 'row';
    this.codeInput.style.flex = '1.4';
    joinRow.append(this.codeInput, join);
    const solo = this.btn('Explorar sozinho', () => this.actions.solo(Number(this.botSelect.value)));
    const soloOptions = document.createElement('label');
    soloOptions.className = 'solo-options';
    const botLabel = document.createElement('span');
    botLabel.className = 'choice-label';
    botLabel.textContent = 'Bots na partida solo';
    this.botSelect.className = 'field';
    this.botSelect.setAttribute('aria-label', 'Bots na partida solo');
    for (let count = 0; count <= MAX_SOLO_BOTS; count++) {
      const option = document.createElement('option');
      option.value = String(count);
      option.textContent = count === 0 ? 'Sem bots · exploração' : `${count} ${count === 1 ? 'bot' : 'bots'}`;
      this.botSelect.append(option);
    }
    this.botSelect.addEventListener('change', () => {
      const bots = Number(this.botSelect.value);
      solo.textContent = bots > 0 ? 'Jogar solo' : 'Explorar sozinho';
      this.setNote(bots > 0 ? 'Enfrente os bots em uma sala só sua. Requer conexão com o servidor.' : 'Explore o planeta e pratique à vontade.');
    });
    soloOptions.append(botLabel, this.botSelect);
    const custom = this.btn('Personalizar', () => this.actions.customize());
    const row = document.createElement('div');
    row.className = 'row';
    row.append(solo, custom);
    const q = this.choiceRow('Qualidade', ['LOW', 'MEDIUM', 'HIGH'] as Quality[], quality, QUALITY_LABEL, (v) => this.actions.quality(v));
    const fpsRow = this.choiceRow('Limite de FPS', [...FPS_CAPS], fps, FPS_LABEL, (v) => this.actions.fpsCap(v));
    this.note.className = 'note';
    const heading = document.createElement('div');
    heading.className = 'menu-heading';
    heading.append(h, tag);
    const play = document.createElement('div');
    play.className = 'menu-play';
    play.append(this.nameInput, create, joinRow, soloOptions, row);
    const settings = document.createElement('div');
    settings.className = 'menu-settings';
    settings.append(q, fpsRow);
    this.el.append(heading, play, settings, this.note);
  }

  private choiceRow<T extends string | number>(label: string, values: T[], current: T, names: Record<T, string>, onPick: (v: T) => void): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'choice';
    const l = document.createElement('div');
    l.className = 'choice-label';
    l.textContent = label;
    const row = document.createElement('div');
    row.className = 'row';
    for (const v of values) {
      const b = this.btn(names[v], () => {
        for (const x of row.children) (x as HTMLElement).classList.remove('primary');
        b.classList.add('primary');
        onPick(v);
      });
      b.classList.add('small');
      if (v === current) b.classList.add('primary');
      row.append(b);
    }
    wrap.append(l, row);
    return wrap;
  }

  private btn(label: string, fn: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `btn${primary ? ' primary' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => {
      this.actions.click();
      fn();
    });
    this.buttons.push(b);
    return b;
  }

  name(): string {
    return this.nameInput.value.trim();
  }

  setName(name: string): void {
    this.nameInput.value = name;
  }

  setProfile(_text?: string, _history?: boolean, _why = ''): void {
    // Profile indicator and history button removed from the menu per UI requirements.
  }

  setNote(text: string, error = false): void {
    this.note.textContent = text;
    this.note.classList.toggle('err', error);
  }

  setBusy(busy: boolean): void {
    for (const b of this.buttons) b.disabled = busy;
    this.botSelect.disabled = busy;
  }

  show(v: boolean): void {
    this.el.hidden = !v;
  }
}
