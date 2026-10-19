import { FPS_CAPS } from '../app/FrameLimiter';
import { normalizeGameSettings, type GameSettings } from '../app/GameSettings';
import { BINDING_ACTIONS, DEFAULT_BINDINGS, keyLabel, rebindKey, type RebindableAction } from '../game/KeyBindings';
import { button, field, Modal, node } from './components';
import './settings.css';
export type { GameSettings } from '../app/GameSettings';

export class SettingsPanel {
  private readonly modal = new Modal('Configurações', () => { this.capture = null; });
  readonly el = this.modal.el;
  private readonly content = node('div', 'settings-content');
  private readonly tabs = node('nav', 'gra-tabs');
  private readonly compact = window.matchMedia('(max-height: 640px)');
  private current = 'Vídeo';
  private page = 0;
  private capture: RebindableAction | null = null;
  private feedback = '';
  private state: GameSettings;

  constructor(state: GameSettings, private readonly update: (settings: GameSettings) => void) {
    this.state = normalizeGameSettings(state);
    this.el.classList.add('settings-panel');
    this.tabs.setAttribute('aria-label', 'Categorias de configurações');
    for (const name of ['Vídeo', 'Áudio', 'Controles', 'Teclas']) this.tabs.append(button(name, () => {
      this.capture = null;
      this.feedback = '';
      this.current = name;
      this.render();
    }));
    this.modal.body.append(this.tabs, this.content, button('Concluir', () => this.hide(), true));
    this.compact.addEventListener('change', () => { this.capture = null; this.page = 0; this.render(); });
    // Capture before gameplay and the modal's Escape/focus handlers; typing never reaches match input.
    window.addEventListener('keydown', (event) => {
      if (!this.visible || !this.capture) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      const action = this.capture;
      if (event.code === 'Escape') {
        this.capture = null;
        this.feedback = 'Alteração cancelada.';
      } else {
        const result = rebindKey(this.state.keyBindings, action, event.code);
        if (!result.ok) {
          this.feedback = result.reason === 'conflict'
            ? `${keyLabel(event.code)} já está em “${BINDING_ACTIONS.find((a) => a.id === result.conflict)!.label}”. Escolha outra tecla.`
            : result.reason === 'reserved' ? 'Essa tecla é reservada. Escolha outra.' : 'Use uma letra, número ou tecla de ação.';
        } else {
          this.state.keyBindings = result.bindings;
          this.capture = null;
          this.feedback = `Tecla alterada para ${keyLabel(event.code)}.`;
          this.emit();
        }
      }
      this.render();
      this.content.querySelector<HTMLButtonElement>(`[data-binding="${action}"]`)?.focus();
    }, true);
    this.render();
  }

  get visible(): boolean { return this.modal.visible; }
  show(): void { this.capture = null; this.feedback = ''; this.render(); this.modal.show(); }
  hide(): void { this.capture = null; this.modal.hide(); }
  setState(state: GameSettings): void { this.capture = null; this.state = normalizeGameSettings(state); this.render(); }
  private emit(): void { this.update({ ...this.state, keyBindings: { ...this.state.keyBindings } }); }

  private select(label: string, options: [string, string][], value: string, change: (value: string) => void): HTMLElement {
    const input = node('select', 'field');
    for (const [id, text] of options) { const option = node('option', '', text); option.value = id; input.append(option); }
    input.value = value;
    input.addEventListener('change', () => { change(input.value); this.emit(); });
    return field(label, input);
  }

  private slider(label: string, min: number, max: number, step: number, value: number, change: (value: number) => void, format = (v: number) => `${Math.round(v * 100)}%`): HTMLElement {
    const input = node('input', 'settings-slider');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    const output = node('output', 'settings-value', format(value));
    const row = node('div', 'settings-range');
    row.append(input, output);
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => { change(Number(input.value)); output.textContent = format(Number(input.value)); this.emit(); });
    const root = field(label, row);
    root.classList.add('settings-field');
    return root;
  }

  private render(): void {
    for (const tab of this.tabs.querySelectorAll('button')) tab.setAttribute('aria-pressed', String(tab.textContent === this.current));
    this.el.dataset.section = this.current;
    this.content.replaceChildren();
    if (this.current === 'Vídeo') this.content.append(
      this.select('Qualidade gráfica', [['LOW', 'Baixa'], ['MEDIUM', 'Média'], ['HIGH', 'Alta']], this.state.quality, (v) => { this.state.quality = v as GameSettings['quality']; }),
      this.select('Limite de FPS', FPS_CAPS.map((v) => [String(v), v ? String(v) : 'Máximo · segue o monitor']), String(this.state.fpsCap), (v) => { this.state.fpsCap = Number(v) as GameSettings['fpsCap']; }),
    );
    else if (this.current === 'Áudio') this.content.append(
      this.slider('Volume geral', 0, 1, .05, this.state.volume, (v) => { this.state.volume = v; }),
      this.slider('Efeitos', 0, 1, .05, this.state.effectsVolume, (v) => { this.state.effectsVolume = v; }),
      this.slider('Ambiente', 0, 1, .05, this.state.ambienceVolume, (v) => { this.state.ambienceVolume = v; }),
      node('p', 'settings-help', 'Efeitos: armas, habilidades e interface. Ambiente: vento, mar e sons contínuos.'),
    );
    else if (this.current === 'Controles') {
      const invert = node('input'); invert.type = 'checkbox'; invert.checked = this.state.invertY;
      invert.addEventListener('change', () => { this.state.invertY = invert.checked; this.emit(); });
      const calm = node('input'); calm.type = 'checkbox'; calm.checked = this.state.reducedCameraMotion;
      calm.addEventListener('change', () => { this.state.reducedCameraMotion = calm.checked; this.emit(); });
      this.content.append(
        this.slider('Sensibilidade do mouse', .0005, .005, .0001, this.state.sensitivity, (v) => { this.state.sensitivity = v; }, (v) => v.toFixed(4).replace('.', ',')),
        field('Inverter eixo vertical', invert),
        this.slider('Intensidade do tremor', 0, 1, .1, this.state.shakeIntensity, (v) => { this.state.shakeIntensity = v; }, (v) => v === 0 ? 'Desligado' : `${Math.round(v * 100)}%`),
        field('Reduzir movimentos de câmera', calm),
        node('p', 'settings-help', 'Ajuste as vibrações de impactos e pousos; reduzir movimentos tira as mudanças de campo de visão em quedas e planagens. Na aba Teclas, escolha seus atalhos.'),
      );
    } else this.renderBindings();
  }

  private renderBindings(): void {
    const pageSize = this.compact.matches ? 3 : 6;
    const pages = Math.ceil(BINDING_ACTIONS.length / pageSize);
    this.page = Math.min(this.page, pages - 1);
    this.content.append(node('p', 'settings-help', 'Selecione uma ação e pressione a nova tecla. Esc cancela a alteração.'));
    const rows = node('div', 'settings-bindings');
    for (const { id, label } of BINDING_ACTIONS.slice(this.page * pageSize, (this.page + 1) * pageSize)) {
      const row = node('div', 'settings-binding');
      const key = button(this.capture === id ? 'Pressione…' : keyLabel(this.state.keyBindings[id]), () => { this.capture = id; this.feedback = ''; this.render(); });
      key.dataset.binding = id;
      key.setAttribute('aria-label', `Alterar tecla: ${label}`);
      key.setAttribute('aria-pressed', String(this.capture === id));
      row.append(node('span', '', label), key);
      rows.append(row);
    }
    const pagination = node('div', 'settings-binding-pages');
    const previous = button('←', () => { this.capture = null; this.feedback = ''; this.page--; this.render(); });
    previous.setAttribute('aria-label', 'Página anterior de teclas'); previous.disabled = this.page === 0;
    const next = button('→', () => { this.capture = null; this.feedback = ''; this.page++; this.render(); });
    next.setAttribute('aria-label', 'Próxima página de teclas'); next.disabled = this.page + 1 === pages;
    pagination.append(previous, node('span', '', `${this.page + 1} / ${pages}`), next);
    const feedback = node('p', 'settings-binding-feedback', this.capture ? this.feedback || 'Aguardando uma tecla…' : this.feedback || 'TAB: placar · ESC: opções · ← →: espectador');
    feedback.setAttribute('role', 'status');
    const reset = button('Restaurar teclas', () => {
      this.capture = null; this.state.keyBindings = { ...DEFAULT_BINDINGS }; this.feedback = 'Teclas padrão restauradas.'; this.emit(); this.render();
    });
    this.content.append(rows, pagination, feedback, reset);
  }
}
