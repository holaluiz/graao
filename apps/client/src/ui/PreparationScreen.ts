import { node } from './components';
export class PreparationScreen {
  readonly el = node('section', 'prematch-screen preparation-screen');
  private readonly title = node('h1', '', 'Preparando a partida');
  private readonly detail = node('p');
  private readonly progress = node('progress');
  private readonly players = node('p', 'gra-fine');
  constructor() {
    this.el.hidden = true;
    const card = node('div', 'gra-panel preparation-card');
    this.progress.max = 3;
    this.progress.setAttribute('aria-label', 'Preparação dos recursos da partida');
    card.append(node('div', 'preparation-art', '✦'), this.title, this.detail, this.progress, this.players);
    this.el.append(card);
    this.el.setAttribute('aria-live', 'polite');
  }
  show(on: boolean): void {
    this.el.hidden = !on;
  }
  step(value: number, text: string): void {
    this.progress.value = value;
    this.detail.textContent = text;
  }
  waiting(ready: number, total: number): void {
    this.players.textContent = `${ready} de ${total} jogadores preparados · o servidor libera o OVNI quando todos estiverem prontos`;
  }
}
