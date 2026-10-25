import {
  MAX_PLAYERS,
  MAX_SOLO_BOTS,
  MatchPhase,
  PROTOCOL_VERSION,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PREFIX,
  parseRoomListing,
  type RoomListing,
} from '@graao/shared';
import { graaoHostRooms, hostApiConfigured } from '../net/graaoHost/hostSite';
import { roomDirectory, type DirectoryStatus } from '../net/host/roomDirectory';
import { httpBase, serverTarget } from '../net/serverTarget';
import { badge, button, field, focusScreen, Modal, node } from './components';
import { roomRowsPerPage } from './RoomBrowserLayout';
import '../styles/graao-host.css';
export interface CreateRoomSettings {
  roomName: string;
  visibility: 'public' | 'private';
  bots: number;
  hosted?: boolean;
  /** Hosted by the player's Graao Host app (their PC runs the room). */
  via?: 'graao-host';
}
/**
 * Where the rooms are: a dedicated server's registry (`GET /rooms`), the live list of rooms hosted in players'
 * browsers (`roomDirectory`), or nowhere (a build without either: training only).
 */
export type RoomSource = 'server' | 'hosted' | 'none';
export interface RoomBrowserActions {
  back(): void;
  create(settings: CreateRoomSettings): void;
  /** `typed`: the player entered the code by hand (it may name a room outside this list). */
  join(code: string, typed: boolean, via?: RoomListing['via']): void;
  click(): void;
}
const phaseLabel = (room: RoomListing): string => {
  if (room.protocol !== PROTOCOL_VERSION) return 'Outra versão';
  if (room.phase === MatchPhase.LOBBY || room.phase === MatchPhase.FREE_ROAM) return room.humans >= room.capacity ? 'Sala cheia' : 'Aguardando';
  if (room.phase === MatchPhase.ABILITY_DRAFT) return 'Escolhendo habilidades';
  if (room.phase === MatchPhase.PREPARATION) return 'Preparando';
  if (room.phase === MatchPhase.RESULTS) return 'Resultados';
  return 'Em partida';
};
const unavailableReason = (room: RoomListing): string =>
  room.protocol !== PROTOCOL_VERSION
    ? 'Essa sala usa outra versão do graao. Recarregue o jogo.'
    : room.humans >= room.capacity
      ? 'Sala cheia: todas as vagas são de jogadores.'
      : 'A partida desta sala já começou. Ela volta a aceitar jogadores no lobby.';
/** Real rooms only: the dedicated server's registry or the hosts' own live announcements, never sample lines. */
export class RoomBrowser {
  readonly el = node('section', 'prematch-screen room-browser');
  private readonly list = node('div', 'room-list');
  private readonly status = badge('Buscando salas…');
  private readonly count = node('span', 'room-count');
  private readonly feedback = node('p', 'gra-feedback');
  private readonly pageLabel = node('span', 'page-label');
  private readonly columns = node('div', 'room-columns');
  private readonly createButton = button('Criar sala', () => this.openCreate(), true);
  private readonly codeButton = button('Entrar por código', () => this.openCode());
  private readonly previous = button('←', () => {
    this.page--;
    this.render();
  });
  private readonly next = button('→', () => {
    this.page++;
    this.render();
  });
  private rooms: RoomListing[] = [];
  /** Rooms running on players' Graao Host apps (listed by the central service; merged with the other source). */
  private hostRooms: RoomListing[] = [];
  private hostTimer: ReturnType<typeof setInterval> | undefined;
  private page = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private request: AbortController | null = null;
  private unwatch: (() => void) | null = null;
  private dialog: Modal | null = null;
  private online = false;
  private busy = false;
  private renderKey = '';
  playerName = '';
  hostedAvailable = false;
  constructor(
    private readonly actions: RoomBrowserActions,
    readonly source: RoomSource,
  ) {
    this.previous.setAttribute('aria-label', 'Página anterior');
    this.next.setAttribute('aria-label', 'Próxima página');
    this.el.hidden = true;
    this.el.dataset.source = source;
    const panel = node('div', 'gra-panel browser-panel');
    const header = node('header', 'gra-heading');
    const title = node('div');
    title.append(node('span', 'gra-kicker', 'JOGAR ONLINE'), node('h1', '', 'Salas disponíveis'));
    const tags = node('div', 'gra-badges');
    tags.append(this.count, this.status);
    header.append(title, tags);
    const toolbar = node('div', 'gra-toolbar');
    toolbar.append(button('↻ Atualizar', () => this.manualRefresh()), this.createButton, this.codeButton);
    const foot = node('footer', 'gra-footer');
    const pages = node('div', 'gra-pages');
    pages.append(this.previous, this.pageLabel, this.next);
    foot.append(button('← Voltar', actions.back), pages);
    this.feedback.setAttribute('role', 'status');
    this.columns.setAttribute('aria-hidden', 'true');
    for (const text of ['Sala', 'Participantes', 'Status', 'Ping', '']) this.columns.append(node('span', '', text));
    panel.append(
      header,
      node('p', 'screen-description', 'Escolha uma sala para entrar no lobby. Lá você se prepara, escolhe suas habilidades e espera o host começar.'),
      toolbar,
      this.columns,
      this.list,
      this.feedback,
      foot,
    );
    this.el.append(panel);
    if (source === 'none' && !hostApiConfigured()) {
      this.createButton.disabled = true;
      this.codeButton.disabled = true;
    }
    const relayout = () => {
      if (this.visible && this.online) {
        this.renderKey = '';
        this.render();
      }
    };
    window.addEventListener('resize', relayout);
    window.addEventListener('graao:viewportresize', relayout);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe(this.list);
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
      this.feedback.textContent = '';
      if (this.source === 'server') {
        void this.refresh();
        this.timer = setInterval(() => void this.refresh(), 5000);
      } else if (this.source === 'hosted') {
        this.unwatch = roomDirectory.watch((rooms, status) => this.onDirectory(rooms, status));
      } else if (hostApiConfigured()) {
        this.setStatus('Buscando salas…', '');
        this.empty('Carregando salas…', 'Procurando salas hospedadas com o Graao Host.', 'loading');
      } else {
        this.setStatus('Online indisponível', 'bad');
        this.empty('Jogar online não está disponível neste build', 'Falta configurar o serviço que conecta os jogadores. Treinar sozinho continua disponível no menu.');
      }
      if (hostApiConfigured()) {
        void this.pollHostRooms();
        this.hostTimer = setInterval(() => void this.pollHostRooms(), 5000);
      }
      focusScreen(this.el);
    } else {
      clearInterval(this.hostTimer);
      clearInterval(this.timer);
      // Never show rooms from the last visit (a host may have closed meanwhile) before the first new poll answers.
      this.hostRooms = [];
      this.request?.abort();
      this.unwatch?.();
      this.unwatch = null;
      this.dialog?.hide();
    }
  }
  /** The Graao Host list (the central service): merged into whatever the primary source shows. */
  private async pollHostRooms(): Promise<void> {
    let rooms: RoomListing[];
    try {
      rooms = await graaoHostRooms();
    } catch {
      return;
    }
    if (!this.visible) return;
    const had = this.hostRooms.length > 0;
    this.hostRooms = rooms;
    if (this.source === 'none' || rooms.length) {
      this.online = true;
      if (this.source === 'none') this.setStatus('● Lista ao vivo', 'good');
      this.render();
    } else if (had) {
      // The last Graao Host room closed: drop its row now, not only when the other source changes.
      this.render();
    }
  }
  private get allRooms(): RoomListing[] {
    const seen = new Set<string>();
    return [...this.hostRooms, ...this.rooms].filter((r) => !seen.has(r.code) && !!seen.add(r.code));
  }
  private manualRefresh(): void {
    this.actions.click();
    if (hostApiConfigured()) void this.pollHostRooms();
    if (this.source === 'server') void this.refresh(true);
    else if (this.source === 'hosted') roomDirectory.refresh();
  }
  private setStatus(text: string, tone: string): void {
    this.status.textContent = text;
    this.status.dataset.tone = tone;
  }
  /** The hosts' live announcements (the list updates by itself while this screen is open). */
  private onDirectory(rooms: RoomListing[], status: DirectoryStatus): void {
    if (!this.visible) return;
    if (status === 'live') {
      this.online = true;
      this.setStatus('● Lista ao vivo', 'good');
      this.rooms = rooms;
      this.render();
    } else if (status === 'connecting') {
      this.online = false;
      this.setStatus('Buscando salas…', '');
      this.count.textContent = '';
      if (!this.rooms.length) this.empty('Carregando salas…', 'Procurando quem está esperando jogadores agora.', 'loading');
    } else {
      this.online = false;
      this.rooms = [];
      this.setStatus('Lista indisponível', 'bad');
      this.count.textContent = '';
      if (this.hostRooms.length) this.render();
      else this.empty('Não foi possível carregar as salas', 'Confira sua internet; tentamos de novo sozinhos. Você ainda pode entrar por código.', 'error');
    }
  }
  async refresh(force = false): Promise<void> {
    if (!this.visible || this.busy || (this.request && !force)) return;
    this.request?.abort();
    const ctl = new AbortController();
    this.request = ctl;
    const timeout = setTimeout(() => ctl.abort(), 4500);
    if (!this.rooms.length) this.empty('Carregando salas…', 'Consultando o servidor de partidas.', 'loading');
    try {
      const res = await fetch(`${httpBase(serverTarget().url)}/rooms`, { cache: 'no-store', signal: ctl.signal });
      if (!res.ok) throw new Error('Servidor indisponível');
      const data = (await res.json()) as { protocol: number; rooms: unknown[] };
      if (!this.visible) return;
      if (data.protocol !== PROTOCOL_VERSION) {
        this.online = false;
        this.rooms = [];
        this.setStatus('Versão incompatível', 'bad');
        this.count.textContent = '';
        this.empty('Uma nova versão chegou', 'Recarregue o jogo para entrar neste servidor.', 'error');
        return;
      }
      this.online = true;
      this.setStatus('● Servidor disponível', 'good');
      this.rooms = (Array.isArray(data.rooms) ? data.rooms : []).flatMap((r) => parseRoomListing(r) ?? []);
      this.render();
    } catch {
      if (this.visible && this.request === ctl) {
        this.online = false;
        this.setStatus('Servidor indisponível', 'bad');
        this.rooms = [];
        this.count.textContent = '';
        if (this.hostRooms.length) return this.render();
        this.empty('O servidor de salas não respondeu', this.hostedAvailable ? 'Tente atualizar. Você também pode criar uma sala neste navegador e chamar a turma pelo código.' : 'Tente atualizar. Treinar sozinho continua disponível no menu.', 'error');
      }
    } finally {
      clearTimeout(timeout);
      if (this.request === ctl) this.request = null;
    }
  }
  private empty(title: string, text: string, tone: 'empty' | 'loading' | 'error' = 'empty'): void {
    this.renderKey = '';
    const box = node('div', 'gra-empty');
    box.dataset.tone = tone;
    box.append(node('span', 'empty-art', tone === 'loading' ? '◌' : tone === 'error' ? '!' : '✦'), node('h2', '', title), node('p', '', text));
    if (tone === 'empty' && this.source !== 'none') {
      const create = button('Criar a primeira sala', () => this.openCreate(), true);
      create.disabled = this.busy;
      box.append(create);
    } else if (tone === 'error') {
      box.append(button('Tentar de novo', () => this.manualRefresh()));
    }
    this.list.replaceChildren(box);
    this.columns.hidden = true;
    this.list.setAttribute('aria-busy', String(tone === 'loading'));
    this.pageLabel.textContent = '';
    this.previous.disabled = true;
    this.next.disabled = true;
  }
  /** Rows per page from the real height, so the footer actions never leave the screen. */
  private get pageSize(): number {
    const style = getComputedStyle(this.list);
    const height = this.list.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
    return roomRowsPerPage(height, parseFloat(style.getPropertyValue('--room-row-height')) || 76, parseFloat(style.rowGap) || 0);
  }
  private render(): void {
    const all = this.allRooms;
    const open = all.filter((r) => r.available).length;
    this.count.textContent = this.online ? `${all.length} ${all.length === 1 ? 'sala' : 'salas'} · ${open} ${open === 1 ? 'aberta' : 'abertas'}` : '';
    this.count.hidden = !all.length;
    if (!all.length) {
      this.empty('Nenhuma sala esperando jogadores', 'Que tal criar a primeira? Quem cria é o host: chama a turma, escolhe os bots e começa o Draft.');
      return;
    }
    this.list.setAttribute('aria-busy', 'false');
    this.columns.hidden = false;
    const size = this.pageSize,
      pages = Math.ceil(all.length / size);
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const rows = all.slice(this.page * size, (this.page + 1) * size);
    const key = JSON.stringify(rows) + this.page + this.busy + size;
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.list.replaceChildren();
    for (const room of rows) this.list.append(this.row(room));
    this.pageLabel.textContent = `${this.page + 1} / ${pages}`;
    this.previous.disabled = this.page === 0;
    this.next.disabled = this.page + 1 >= pages;
  }
  private row(room: RoomListing): HTMLElement {
    const row = node('article', `room-row${room.available ? '' : ' room-row-closed'}`);
    row.setAttribute('aria-label', `${room.name}, host ${room.hostName}, ${room.humans} de ${room.capacity} jogadores humanos, ${phaseLabel(room)}`);
    const info = node('div', 'room-row-info');
    const title = node('h2', '', room.name);
    title.title = room.name;
    if (room.via === 'graao-host') {
      const tag = badge('GRAAO HOST', 'blue');
      tag.classList.add('host-tag');
      tag.title = 'Partida executada no PC do host pelo aplicativo Graao Host';
      title.append(tag);
    }
    info.append(title, node('p', '', `Host: ${room.hostName}${room.region ? ` · ${room.region}` : ''}`));
    const seats = node('div', 'room-row-seats');
    const pips = node('div', 'seat-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < Math.min(room.capacity, MAX_PLAYERS); i++) pips.append(node('i', i < room.humans ? 'human' : i < room.humans + room.botsPlanned ? 'bot' : ''));
    seats.append(
      pips,
      node('strong', '', `${room.humans} ${room.humans === 1 ? 'humano' : 'humanos'}${room.botsPlanned ? ` + ${room.botsPlanned} ${room.botsPlanned === 1 ? 'bot previsto' : 'bots previstos'}` : ''}`),
      node('span', '', `${room.humans + room.botsPlanned} / ${room.capacity} participantes`),
    );
    // Latency is never estimated: nothing has measured this room yet.
    const ping = node('span', 'room-row-ping', '—');
    ping.title = 'Ping ainda não medido';
    const enter = button(room.available ? 'Entrar →' : 'Indisponível', () => {
      this.actions.click();
      this.actions.join(room.code, false, room.via);
    }, room.available);
    enter.disabled = !room.available || this.busy;
    enter.title = room.available ? `Entrar em ${room.name}` : unavailableReason(room);
    row.append(info, seats, badge(phaseLabel(room), room.available ? 'good' : room.protocol !== PROTOCOL_VERSION ? 'bad' : ''), ping, enter);
    return row;
  }
  private mountDialog(dialog: Modal): void {
    this.dialog?.el.remove();
    this.dialog = dialog;
    this.el.append(dialog.el);
    dialog.show();
  }
  openCreate(): void {
    // A phone can host through the browser; the desktop Graao Host installer must not be its default action.
    const hostApp = hostApiConfigured() && !(this.source === 'hosted' && window.matchMedia('(pointer: coarse)').matches);
    if (this.source === 'none' && !hostApp) return;
    const dialog = new Modal('Criar sala'),
      form = node('form', 'gra-form room-create-form'),
      name = node('input', 'field'),
      visibility = node('select', 'field'),
      bots = node('select', 'field');
    name.maxLength = 40;
    name.value = `Sala de ${this.playerName || 'Jogador'}`;
    name.required = true;
    for (const [value, text] of [
      ['public', 'Pública · aparece na lista de salas'],
      ['private', 'Privada · só entra quem tem o código'],
    ] as const) {
      const o = node('option', '', text);
      o.value = value;
      visibility.append(o);
    }
    for (let i = 0; i <= MAX_SOLO_BOTS; i++) {
      const o = node('option', '', i ? `${i} ${i === 1 ? 'bot' : 'bots'}` : 'Nenhum · só humanos');
      o.value = String(i);
      bots.append(o);
    }
    bots.value = '0';
    const seats = node('p', 'gra-fine create-seats');
    const updateSeats = () => {
      const n = Number(bots.value);
      seats.textContent = `Você + ${n} ${n === 1 ? 'bot' : 'bots'}: ${n + 1}/${MAX_PLAYERS} participantes. Quem entrar ocupa a vaga de um bot até o Draft.`;
    };
    bots.addEventListener('change', updateSeats);
    updateSeats();
    const submit = button(hostApp ? 'Criar e hospedar' : 'Criar sala', () => {}, true);
    submit.type = 'submit';
    const map = node('div', 'gra-map-note');
    map.append(badge('MAPA · PLANETA GRAAO', 'blue'), node('p', '', 'Último de pé vence: armas, magia e a Tormenta fechando o planeta.'));
    form.append(field('Nome da sala', name), field('Visibilidade', visibility), field('Bots desejados', bots), seats, map);
    if (hostApp)
      form.append(node('p', 'gra-fine', 'A partida roda no seu PC com o aplicativo Graao Host (instalação única, só para quem hospeda). Seus amigos entram pelo navegador.'));
    else if (this.source === 'hosted')
      form.append(node('p', 'gra-fine', 'Você hospeda a sala neste navegador. Mantenha esta aba aberta: se o host sair, a sala fecha para todos.'));
    form.append(submit);
    if (hostApp && this.source === 'hosted') {
      form.append(
        button('Ou hospedar nesta aba do navegador (sem instalar)', () =>
          this.actions.create({ roomName: name.value.trim(), visibility: visibility.value as 'public' | 'private', bots: Number(bots.value), hosted: true }),
        ),
      );
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.actions.create({
        roomName: name.value.trim(),
        visibility: visibility.value as 'public' | 'private',
        bots: Number(bots.value),
        hosted: !hostApp && this.source === 'hosted',
        ...(hostApp ? { via: 'graao-host' as const } : {}),
      });
    });
    if (this.source === 'server' && !this.online && this.hostedAvailable) {
      form.append(
        button('Criar sala privada neste navegador', () =>
          this.actions.create({
            roomName: name.value.trim(),
            visibility: 'private',
            bots: Number(bots.value),
            hosted: true,
          }),
        ),
        node('p', 'gra-fine', 'O servidor não respondeu. Quem cria hospeda: a sala por código fecha quando essa pessoa sair.'),
      );
    }
    dialog.body.append(form);
    this.mountDialog(dialog);
  }
  openCode(): void {
    if (this.source === 'none' && !hostApiConfigured()) return;
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
    form.append(field('Código da sala', code), node('p', 'gra-fine', 'Salas privadas não aparecem na lista. Peça o código ao host.'), submit);
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
    // Modal.show portals its dialog into #ui so it can fill the viewport instead of a transformed menu.
    for (const root of [this.el, this.dialog?.el]) {
      if (!root) continue;
      for (const e of root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select')) e.disabled = busy;
    }
    if (!busy) {
      if (this.source === 'none' && !hostApiConfigured()) {
        this.createButton.disabled = true;
        this.codeButton.disabled = true;
      }
      this.renderKey = '';
      if (this.online) this.render();
      else this.previous.disabled = this.next.disabled = true;
    }
  }
  message(text: string, error = false): void {
    this.feedback.textContent = text;
    this.feedback.dataset.error = String(error);
    if (this.dialog?.visible) this.dialog.message(text, error);
  }
}
