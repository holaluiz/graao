import {
  MAX_SOLO_BOTS,
  MatchPhase,
  PROTOCOL_VERSION,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PREFIX,
  type RoomListing,
} from '@graao/shared';
import { httpBase, serverTarget } from '../net/serverTarget';
import { badge, button, field, focusScreen, Modal, node } from './components';
export interface CreateRoomSettings {
  roomName: string;
  visibility: 'public' | 'private';
  bots: number;
  hosted?: boolean;
}
export interface RoomBrowserActions {
  back(): void;
  create(settings: CreateRoomSettings): void;
  join(code: string, fallbackHosted?: boolean): void;
  click(): void;
}
const phaseLabel = (p: MatchPhase) =>
  p === MatchPhase.LOBBY || p === MatchPhase.FREE_ROAM
    ? 'Aguardando'
    : p === MatchPhase.ABILITY_DRAFT
      ? 'Escolhendo habilidades'
      : p === MatchPhase.RESULTS
        ? 'Resultados'
        : 'Em partida';
/** A real Colyseus registry. Browser-hosted private rooms remain joinable by code, not fabricated list rows. */
export class RoomBrowser {
  readonly el = node('section', 'prematch-screen room-browser');
  private readonly list = node('div', 'room-list');
  private readonly status = badge('Buscando servidor…');
  private readonly feedback = node('p', 'gra-feedback');
  private readonly pageLabel = node('span', 'page-label');
  private readonly previous = button('←', () => {
    this.page--;
    this.render();
  });
  private readonly next = button('→', () => {
    this.page++;
    this.render();
  });
  private rooms: RoomListing[] = [];
  private page = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private request: AbortController | null = null;
  private dialog: Modal | null = null;
  private online = false;
  private busy = false;
  private renderKey = '';
  playerName = '';
  hostedAvailable = false;
  constructor(private readonly actions: RoomBrowserActions) {
    this.previous.setAttribute('aria-label', 'Página anterior');
    this.next.setAttribute('aria-label', 'Próxima página');
    this.el.hidden = true;
    const panel = node('div', 'gra-panel browser-panel');
    const header = node('header', 'gra-heading');
    const title = node('div');
    title.append(node('span', 'gra-kicker', 'ENCONTRE SUA TURMA'), node('h1', '', 'Salas disponíveis'));
    header.append(title, this.status);
    const toolbar = node('div', 'gra-toolbar');
    toolbar.append(
      button('↻ Atualizar', () => void this.refresh()),
      button('Criar sala', () => this.openCreate(), true),
      button('Entrar por código', () => this.openCode()),
    );
    const foot = node('footer', 'gra-footer');
    const pages = node('div', 'gra-pages');
    pages.append(this.previous, this.pageLabel, this.next);
    foot.append(button('← Voltar', actions.back), pages);
    this.feedback.setAttribute('role', 'status');
    panel.append(
      header,
      node(
        'p',
        'screen-description',
        'Encontre uma sala. Prepare seu personagem e sua build. Depois, é hora de saltar.',
      ),
      toolbar,
      this.list,
      this.feedback,
      foot,
    );
    this.el.append(panel);
    window.addEventListener('resize', () => {
      if (this.visible && this.online) {
        this.renderKey = '';
        this.render();
      }
    });
  }
  get visible(): boolean {
    return !this.el.hidden;
  }
  closeModal(): boolean {
    if (!this.dialog?.visible) return false;
    this.dialog.hide();
    return true;
  }
  show(on: boolean): void {
    if (on === this.visible) return;
    this.el.hidden = !on;
    if (on) {
      this.renderKey = '';
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), 5000);
      focusScreen(this.el);
    } else {
      clearInterval(this.timer);
      this.request?.abort();
      this.dialog?.hide();
    }
  }
  async refresh(): Promise<void> {
    if (!this.visible || this.busy || this.request) return;
    const ctl = new AbortController();
    this.request = ctl;
    const timeout = setTimeout(() => ctl.abort(), 4500);
    if (!this.rooms.length) this.empty('Carregando salas…', 'Estamos consultando o servidor de partidas.');
    try {
      const res = await fetch(`${httpBase(serverTarget().url)}/rooms`, { cache: 'no-store', signal: ctl.signal });
      if (!res.ok) throw new Error('Servidor indisponível');
      const data = (await res.json()) as { protocol: number; rooms: RoomListing[] };
      if (!this.visible) return;
      if (data.protocol !== PROTOCOL_VERSION) {
        this.online = false;
        this.rooms = [];
        this.status.textContent = 'Versão incompatível';
        this.status.dataset.tone = 'bad';
        this.empty('Uma nova versão chegou', 'Recarregue o jogo para entrar neste servidor.');
        return;
      }
      this.online = true;
      this.status.textContent = '● Servidor disponível';
      this.status.dataset.tone = 'good';
      this.rooms = Array.isArray(data.rooms) ? data.rooms : [];
      this.render();
    } catch {
      if (this.visible) {
        this.online = false;
        this.status.textContent = 'Servidor indisponível';
        this.status.dataset.tone = 'bad';
        this.rooms = [];
        this.renderKey = '';
        this.empty('O servidor não respondeu', 'Tente atualizar. O treino sozinho continua disponível no menu.');
      }
    } finally {
      clearTimeout(timeout);
      if (this.request === ctl) this.request = null;
    }
  }
  private empty(title: string, text: string): void {
    this.renderKey = '';
    const box = node('div', 'gra-empty');
    box.append(node('span', 'empty-art', '◌'), node('h2', '', title), node('p', '', text));
    this.list.replaceChildren(box);
    this.pageLabel.textContent = '';
    this.previous.disabled = true;
    this.next.disabled = true;
  }
  private render(): void {
    if (!this.rooms.length) {
      this.empty('Nenhuma sala esperando jogadores', 'Que tal criar a primeira? Seu planetinha já está pronto.');
      return;
    }
    const size = window.innerHeight < 900 ? 3 : 5,
      pages = Math.ceil(this.rooms.length / size);
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const rows = this.rooms.slice(this.page * size, (this.page + 1) * size);
    const key = JSON.stringify(rows) + this.page;
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.list.replaceChildren();
    for (const room of rows) {
      const row = node('article', 'room-row');
      const info = node('div', 'room-row-info');
      const title = node('h2', '', room.name);
      title.title = room.name;
      info.append(title, node('p', '', `Host: ${room.hostName}${room.region ? ` · ${room.region}` : ''}`));
      const seats = node('div', 'room-row-seats');
      seats.append(
        node('strong', '', `${room.humans} ${room.humans === 1 ? 'humano' : 'humanos'}`),
        node('span', '', `+${room.botsPlanned} bots previstos · ${room.capacity} vagas`),
      );
      const enter = button('Entrar →', () => {
        this.actions.click();
        this.actions.join(room.code);
      });
      enter.disabled = !room.available;
      enter.title = room.available ? `Entrar em ${room.name}` : 'Sala cheia ou já em preparação';
      row.append(
        info,
        seats,
        badge(room.humans >= room.capacity ? 'Sala cheia' : phaseLabel(room.phase), room.available ? 'good' : ''),
        enter,
      );
      this.list.append(row);
    }
    this.pageLabel.textContent = `${this.page + 1} / ${pages}`;
    this.previous.disabled = this.page === 0;
    this.next.disabled = this.page + 1 >= pages;
  }
  private mountDialog(dialog: Modal): void {
    this.dialog?.el.remove();
    this.dialog = dialog;
    this.el.append(dialog.el);
    dialog.show();
  }
  openCreate(): void {
    const dialog = new Modal('Criar sua sala'),
      form = node('form', 'gra-form'),
      name = node('input', 'field'),
      visibility = node('select', 'field'),
      bots = node('select', 'field');
    name.maxLength = 40;
    name.value = `Sala de ${this.playerName || 'Jogador'}`;
    name.required = true;
    for (const [value, text] of [
      ['public', 'Pública · aparece na lista'],
      ['private', 'Privada · só por código'],
    ] as const) {
      const o = node('option', '', text);
      o.value = value;
      visibility.append(o);
    }
    for (let i = 0; i <= MAX_SOLO_BOTS; i++) {
      const o = node('option', '', i ? `${i} ${i === 1 ? 'bot' : 'bots'} desejados` : 'Só humanos');
      o.value = String(i);
      bots.append(o);
    }
    const submit = button('Criar sala', () => {}, true);
    submit.type = 'submit';
    const map = node('div', 'gra-map-note');
    map.append(
      badge('PLANETA GRAAO', 'blue'),
      node('p', '', 'Até 10 participantes. Humanos podem ocupar as vagas previstas para bots antes do Draft.'),
    );
    form.append(
      field('Nome da sala', name),
      field('Quem pode entrar?', visibility),
      field('Bots desejados', bots),
      map,
      submit,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.actions.create({
        roomName: name.value.trim(),
        visibility: visibility.value as 'public' | 'private',
        bots: Number(bots.value),
      });
    });
    if (!this.online && this.hostedAvailable) {
      form.append(
        button('Criar sala privada neste navegador', () =>
          this.actions.create({
            roomName: name.value.trim(),
            visibility: 'private',
            bots: Number(bots.value),
            hosted: true,
          }),
        ),
        node(
          'p',
          'gra-fine',
          'Quem cria hospeda. A sala por código fecha quando essa pessoa sair; ela não aparece na lista pública.',
        ),
      );
    }
    dialog.body.append(form);
    this.mountDialog(dialog);
  }
  openCode(): void {
    const dialog = new Modal('Entrar por código'),
      form = node('form', 'gra-form'),
      code = node('input', 'field');
    code.placeholder = 'GR-XXXX';
    code.maxLength = ROOM_CODE_PREFIX.length + ROOM_CODE_LENGTH;
    code.required = true;
    code.autocomplete = 'off';
    code.addEventListener('input', () => {
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    });
    const submit = button('Entrar na sala', () => {}, true);
    submit.type = 'submit';
    form.append(field('Código da sala', code), submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = code.value.toUpperCase();
      this.actions.join(value.startsWith(ROOM_CODE_PREFIX) ? value : ROOM_CODE_PREFIX + value, true);
    });
    dialog.body.append(form);
    this.mountDialog(dialog);
  }
  setBusy(busy: boolean): void {
    this.busy = busy;
    for (const e of this.el.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>(
      'button,input,select',
    ))
      e.disabled = busy;
    if (!busy) {
      this.renderKey = '';
      this.render();
    }
  }
  message(text: string, error = false): void {
    this.feedback.textContent = text;
    this.feedback.dataset.error = String(error);
    if (this.dialog?.visible) this.dialog.message(text, error);
  }
}
