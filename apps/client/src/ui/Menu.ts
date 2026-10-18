import { button, Modal, node, field, focusScreen } from './components';
import '../styles/prematch.css';
export interface MenuActions {
  play(): void;
  customize(): void;
  settings(): void;
  train(): void;
  name(value: string): void;
  click(): void;
}
/** Home has one primary route: play opens the actual room browser. */
export class Menu {
  readonly el = node('section', 'menu home-menu');
  private readonly note = node('p', 'gra-feedback');
  private readonly profile = node('button', 'home-profile');
  private value: string;
  private readonly dialog = new Modal('Como você quer ser chamado?');
  constructor(actions: MenuActions, name: string) {
    this.value = name;
    this.el.setAttribute('aria-label', 'Menu principal');
    const heading = node('div', 'home-heading');
    heading.append(
      node('span', 'gra-kicker', 'ABRA O SEU PRÓXIMO CAPÍTULO'),
      node('h1', '', 'graao'),
      node('p', 'tag', 'um planetinha · armas, magia e roupas boas'),
    );
    const nav = node('nav', 'home-actions');
    for (const [text, action, primary] of [
      ['Jogar', actions.play, true],
      ['Personalizar', actions.customize, false],
      ['Configurações', actions.settings, false],
    ] as const)
      nav.append(
        button(
          text,
          () => {
            actions.click();
            action();
          },
          primary,
        ),
      );
    const train = button('Treinar sozinho ↗', () => {
      actions.click();
      actions.train();
    });
    train.classList.add('home-secondary');
    this.profile.type = 'button';
    this.profile.addEventListener('click', () => this.dialog.show());
    const input = node('input', 'field');
    input.maxLength = 16;
    input.value = name;
    input.setAttribute('autocomplete', 'nickname');
    const form = node('form', 'gra-form');
    const save = button('Salvar nome', () => {}, true);
    save.type = 'submit';
    form.append(field('Seu nome', input), save);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.setName(input.value.trim());
      actions.name(this.value);
      this.dialog.hide();
    });
    this.dialog.body.append(form);
    this.el.append(heading, nav, train, this.profile, this.note, this.dialog.el);
    this.setName(name);
  }
  name(): string {
    return this.value.trim();
  }
  setName(name: string): void {
    this.value = name;
    this.profile.textContent = `✎ ${name || 'Escolher meu nome'}`;
    const input = this.dialog.body.querySelector('input');
    if (input) input.value = name;
  }
  setProfile(_text?: string, _history?: boolean, _why = ''): void {}
  setNote(text: string, error = false): void {
    this.note.textContent = text;
    this.note.dataset.error = String(error);
  }
  setServer(_state: string, _text: string): void {}
  setBusy(busy: boolean): void {
    for (const e of this.el.querySelectorAll('button')) e.disabled = busy;
  }
  show(on: boolean): void {
    const changed = this.el.hidden === on;
    this.el.hidden = !on;
    if (!on) this.dialog.hide();
    else if (changed) focusScreen(this.el);
  }
}
