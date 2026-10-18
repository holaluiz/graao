import { FPS_CAPS, type FpsCap } from '../app/FrameLimiter';
import type { Quality } from '../render/GRARenderer';
import { button, field, Modal, node } from './components';
export interface GameSettings {
  quality: Quality;
  fpsCap: FpsCap;
  volume: number;
  sensitivity: number;
  invertY: boolean;
}
export class SettingsPanel {
  private readonly modal = new Modal('Configurações');
  readonly el = this.modal.el;
  private readonly content = node('div', 'settings-content');
  private readonly tabs = node('nav', 'gra-tabs');
  private current = 'Vídeo';
  constructor(
    private state: GameSettings,
    private readonly update: (settings: GameSettings) => void,
  ) {
    for (const name of ['Vídeo', 'Áudio', 'Controles'])
      this.tabs.append(
        button(name, () => {
          this.current = name;
          this.render();
        }),
      );
    this.modal.body.append(
      this.tabs,
      this.content,
      button('Concluir', () => this.hide(), true),
    );
    this.render();
  }
  get visible(): boolean {
    return this.modal.visible;
  }
  show(): void {
    this.modal.show();
  }
  hide(): void {
    this.modal.hide();
  }
  private select(
    label: string,
    options: [string, string][],
    value: string,
    change: (value: string) => void,
  ): HTMLElement {
    const input = node('select', 'field');
    for (const [id, text] of options) {
      const option = node('option', '', text);
      option.value = id;
      input.append(option);
    }
    input.value = value;
    input.addEventListener('change', () => {
      change(input.value);
      this.update({ ...this.state });
    });
    return field(label, input);
  }
  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    change: (value: number) => void,
  ): HTMLElement {
    const input = node('input', 'settings-slider');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      change(Number(input.value));
      this.update({ ...this.state });
    });
    return field(label, input);
  }
  private render(): void {
    for (const tab of this.tabs.querySelectorAll('button'))
      tab.setAttribute('aria-pressed', String(tab.textContent === this.current));
    this.content.replaceChildren();
    if (this.current === 'Vídeo')
      this.content.append(
        this.select(
          'Qualidade gráfica',
          [
            ['LOW', 'Baixa'],
            ['MEDIUM', 'Média'],
            ['HIGH', 'Alta'],
          ],
          this.state.quality,
          (v) => {
            this.state.quality = v as Quality;
          },
        ),
        this.select(
          'Limite de FPS',
          FPS_CAPS.map((v) => [String(v), v ? String(v) : 'Máximo · segue o monitor']),
          String(this.state.fpsCap),
          (v) => {
            this.state.fpsCap = Number(v) as FpsCap;
          },
        ),
      );
    else if (this.current === 'Áudio')
      this.content.append(
        this.slider('Volume geral', 0, 1, 0.05, this.state.volume, (v) => {
          this.state.volume = v;
        }),
      );
    else {
      const invert = node('input');
      invert.type = 'checkbox';
      invert.checked = this.state.invertY;
      invert.addEventListener('change', () => {
        this.state.invertY = invert.checked;
        this.update({ ...this.state });
      });
      this.content.append(
        this.slider('Sensibilidade do mouse', 0.0005, 0.005, 0.0001, this.state.sensitivity, (v) => {
          this.state.sensitivity = v;
        }),
        field('Inverter eixo vertical', invert),
        node(
          'p',
          'controls-guide',
          'WASD mover · Espaço saltar · Shift correr / mergulhar · Mouse mirar · Clique disparar · E/Q armas · R recarregar · 1/2/3/4 habilidades · TAB placar · ESC opções',
        ),
      );
    }
  }
}
