/** Main menu (DOM): name, create/join by room code, free roam, customize, quality, camera shake. */
import { ROOM_CODE_LENGTH, ROOM_CODE_PREFIX } from '@graao/shared';
import type { Quality } from '../render/GRARenderer';

/** Camera response accessibility (shake and recoil): FULL / REDUCED / OFF. */
export type CameraResponse = 'FULL' | 'REDUCED' | 'OFF';

export interface MenuActions {
  solo(): void;
  create(name: string): void;
  join(code: string, name: string): void;
  customize(): void;
  quality(q: Quality): void;
  cameraResponse(c: CameraResponse): void;
  click(): void;
}

const QUALITY_LABEL: Record<Quality, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta' };
const RESPONSE_LABEL: Record<CameraResponse, string> = { FULL: 'Total', REDUCED: 'Reduzido', OFF: 'Desligado' };

export class Menu {
  readonly el = document.createElement('div');
  private readonly note = document.createElement('div');
  private readonly nameInput = document.createElement('input');
  private readonly codeInput = document.createElement('input');
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(private readonly actions: MenuActions, name: string, quality: Quality, response: CameraResponse) {
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
    const solo = this.btn('Explorar sozinho', () => this.actions.solo());
    const custom = this.btn('Personalizar', () => this.actions.customize());
    const row = document.createElement('div');
    row.className = 'row';
    row.append(solo, custom);
    const q = this.choiceRow('Qualidade', ['LOW', 'MEDIUM', 'HIGH'] as Quality[], quality, QUALITY_LABEL, (v) => this.actions.quality(v));
    const shake = this.choiceRow('Tremor da câmera', ['FULL', 'REDUCED', 'OFF'] as CameraResponse[], response, RESPONSE_LABEL, (v) => this.actions.cameraResponse(v));
    this.note.className = 'note';
    this.el.append(h, tag, this.nameInput, create, joinRow, row, q, shake, this.note);
  }

  private choiceRow<T extends string>(label: string, values: T[], current: T, names: Record<T, string>, onPick: (v: T) => void): HTMLElement {
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

  setNote(text: string, error = false): void {
    this.note.textContent = text;
    this.note.classList.toggle('err', error);
  }

  setBusy(busy: boolean): void {
    for (const b of this.buttons) b.disabled = busy;
  }

  show(v: boolean): void {
    this.el.hidden = !v;
  }
}
