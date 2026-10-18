import { MAX_PLAYERS, MAX_SOLO_BOTS, type RoomStateMsg } from '@graao/shared';
import { badge, button, field, focusScreen, node } from './components';
export interface LobbyActions {
  ready(on: boolean): void;
  start(): void;
  bots(count: number): void;
  customize(): void;
  leave(): void;
  click(): void;
  notify(text: string): void;
}
/** Ten slots and explicit host controls; planned bots have no actor, connection or combat state. */
export class LobbyPanel {
  readonly el = node('section', 'prematch-screen room-lobby');
  private readonly name = node('h1');
  private readonly host = node('p', 'screen-description');
  private readonly count = badge('0 / 10');
  private readonly code = button('', () => this.copy());
  private readonly list = node('div', 'player-slots');
  private readonly desired = node('select', 'field');
  private readonly ready = button(
    'Estou pronto',
    () => {
      this.actions.click();
      this.actions.ready(!this.mineReady);
    },
    true,
  );
  private readonly start = button(
    'Iniciar Draft →',
    () => {
      this.actions.click();
      this.actions.start();
    },
    true,
  );
  private readonly why = node('p', 'lobby-reason');
  private readonly visibility = badge('');
  private readonly connected = badge('Conectado à sala', 'good');
  private currentCode = '';
  private mineReady = false;
  private key = '';
  constructor(private readonly actions: LobbyActions) {
    this.el.hidden = true;
    const panel = node('div', 'gra-panel lobby-panel');
    const heading = node('header', 'gra-heading');
    const title = node('div');
    title.append(node('span', 'gra-kicker', 'SUA TURMA, SEU PLANETINHA'), this.name, this.host);
    const tags = node('div', 'gra-badges');
    tags.append(this.connected, this.count, this.visibility, this.code);
    heading.append(title, tags);
    const content = node('div', 'lobby-content');
    const side = node('aside', 'lobby-sidebar');
    side.append(
      node('div', 'map-postcard', '✦'),
      node('h2', '', 'Planeta graao'),
      node('p', '', 'Último de pé · armas e magia'),
      badge('10 participantes no máximo', 'blue'),
    );
    for (let i = 0; i <= MAX_SOLO_BOTS; i++) {
      const option = node('option', '', `${i} ${i === 1 ? 'bot desejado' : 'bots desejados'}`);
      option.value = String(i);
      this.desired.append(option);
    }
    this.desired.addEventListener('change', () => actions.bots(Number(this.desired.value)));
    side.append(
      field('Bots desejados pelo host', this.desired),
      node(
        'p',
        'gra-fine',
        'Antes do Draft, humanos substituem vagas previstas de bots. Ninguém está combatendo enquanto a sala se prepara.',
      ),
    );
    content.append(this.list, side);
    const footer = node('footer', 'lobby-actions');
    footer.append(
      this.ready,
      button('Personalizar', actions.customize),
      button('Sair da sala', actions.leave),
      this.start,
    );
    panel.append(heading, content, this.why, footer);
    this.el.append(panel);
  }
  get visible(): boolean {
    return !this.el.hidden;
  }
  show(on: boolean): void {
    const changed = on !== this.visible;
    this.el.hidden = !on;
    if (on && changed) focusScreen(this.el);
  }
  setConnection(dropped: boolean): void {
    this.connected.textContent = dropped ? 'Reconectando à sala…' : 'Conectado à sala';
    this.connected.dataset.tone = dropped ? 'bad' : 'good';
  }
  update(state: RoomStateMsg, me: number): void {
    const room = state.room;
    const players = state.players.filter((p) => p.connected).sort((a, b) => a.index - b.index);
    const mine = players.find((p) => p.index === me);
    const isHost = !!mine && room?.hostSessionId === mine.sessionId;
    this.currentCode = state.code;
    this.mineReady = !!mine?.ready;
    const planned = room?.botsPlanned ?? 0;
    this.name.textContent = room?.name || `Sala ${state.code}`;
    this.host.textContent = `Host: ${room?.hostName || 'Jogador'} · Aguardando preparação`;
    this.code.textContent = `⌁ ${state.code} · copiar`;
    this.count.textContent = `${players.length} humanos + ${planned} bots previstos / ${room?.capacity ?? MAX_PLAYERS}`;
    this.visibility.textContent = room?.visibility === 'private' ? 'Privada' : 'Pública';
    this.desired.disabled = !isHost;
    this.desired.value = String(room?.botsDesired ?? 0);
    this.ready.textContent = this.mineReady ? '✓ Desfazer pronto' : 'Estou pronto';
    this.ready.classList.toggle('primary', !this.mineReady);
    this.start.hidden = !isHost;
    this.start.disabled = !room?.canStart;
    this.why.textContent = room?.canStart
      ? isHost
        ? 'Todos prontos. Você pode iniciar o Draft.'
        : 'Todos prontos. Aguardando o host iniciar o Draft.'
      : room?.startReason || 'Marque pronto quando seu personagem estiver preparado.';
    const key = JSON.stringify([
      players.map((p) => [p.index, p.name, p.ready, p.dropped, p.appearance]),
      planned,
      room?.hostSessionId,
    ]);
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren();
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = players[i];
      const bot = !p && i - players.length < planned;
      const slot = node(
        'article',
        `player-slot${p?.index === me ? ' player-slot-me' : ''}${bot ? ' planned-bot' : ''}${!p && !bot ? ' empty-slot' : ''}`,
      );
      const number = node('span', 'slot-number', String(i + 1).padStart(2, '0'));
      const avatar = node('div', 'slot-avatar', p ? '◉' : bot ? '⚙' : '+');
      const identity = node('div', 'slot-identity');
      identity.append(
        node('strong', '', p?.name || (bot ? `Bot ${String(i - players.length + 1).padStart(2, '0')}` : 'Vaga aberta')),
      );
      identity.append(
        node(
          'span',
          '',
          p
            ? room?.hostSessionId === p.sessionId
              ? 'HOST · HUMANO'
              : 'JOGADOR · HUMANO'
            : bot
              ? 'BOT PREVISTO'
              : 'AGUARDANDO JOGADOR',
        ),
      );
      slot.append(
        number,
        avatar,
        identity,
        badge(
          p ? (p.dropped ? 'Reconectando' : p.ready ? 'Pronto ✓' : 'Aguardando') : bot ? 'Automático' : 'Livre',
          p?.ready ? 'good' : '',
        ),
      );
      this.list.append(slot);
    }
  }
  private copy(): void {
    void navigator.clipboard?.writeText(this.currentCode).then(
      () => this.actions.notify('Código copiado'),
      () => this.actions.notify(`Código: ${this.currentCode}`),
    );
  }
}
