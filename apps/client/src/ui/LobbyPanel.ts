import { MAX_PLAYERS, MAX_SOLO_BOTS, type RoomStateMsg } from '@graao/shared';
import { badge, button, focusScreen, node } from './components';
import { avatarPortrait } from './creatorPreviews';
export interface LobbyActions {
  ready(on: boolean): void;
  start(): void;
  bots(count: number): void;
  customize(): void;
  leave(): void;
  click(): void;
  notify(text: string): void;
}
const BOT_ART = '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="12" width="24" height="19" rx="7"/><path d="M20 12V6m-4 0h8M14 21h.1m11.9 0h.1M16 26h8M8 20H4m32 0h-4"/></g></svg>';
/** Ten slots and explicit host controls; planned bots have no actor, connection or combat state. */
export class LobbyPanel {
  readonly el = node('section', 'prematch-screen room-lobby');
  private readonly name = node('h1');
  private readonly host = node('p', 'screen-description');
  private readonly count = badge('0 / 10');
  private readonly code = button('', () => this.copy());
  private readonly list = node('div', 'player-slots');
  private readonly desired = node('select', 'field');
  private readonly desiredNote = node('span', 'lobby-fact-note');
  private readonly visibilityFact = node('dd');
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
  private readonly connected = badge('Conectado à sala', 'good');
  private currentCode = '';
  private mineReady = false;
  private key = '';
  constructor(private readonly actions: LobbyActions) {
    this.el.hidden = true;
    const panel = node('div', 'gra-panel lobby-panel');
    const heading = node('header', 'gra-heading');
    const title = node('div');
    title.append(node('span', 'gra-kicker', 'LOBBY DA SALA'), this.name, this.host);
    const tags = node('div', 'gra-badges');
    tags.append(this.connected, this.count, this.code);
    heading.append(title, tags);
    const content = node('div', 'lobby-content');
    const side = node('aside', 'lobby-sidebar');
    for (let i = 0; i <= MAX_SOLO_BOTS; i++) {
      const option = node('option', '', i ? `${i} ${i === 1 ? 'bot' : 'bots'}` : 'Nenhum bot');
      option.value = String(i);
      this.desired.append(option);
    }
    this.desired.setAttribute('aria-label', 'Bots desejados');
    this.desired.addEventListener('change', () => actions.bots(Number(this.desired.value)));
    const facts = node('dl', 'lobby-facts');
    const fact = (label: string, ...value: (string | HTMLElement)[]) => {
      const dd = node('dd');
      dd.append(...value);
      facts.append(node('dt', '', label), dd);
    };
    fact('Mapa', 'Planeta graao');
    fact('Modo', 'Último de pé');
    fact('Capacidade', `${MAX_PLAYERS} participantes`);
    fact('Bots desejados', this.desired, this.desiredNote);
    facts.append(node('dt', '', 'Visibilidade'), this.visibilityFact);
    side.append(
      node('div', 'map-postcard', '✦'),
      facts,
      node('p', 'gra-fine', 'Bots são vagas previstas: quem entrar ocupa a vaga de um bot até o Draft. Ninguém combate enquanto a sala se prepara.'),
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
    const capacity = room?.capacity ?? MAX_PLAYERS;
    const status = room?.canStart ? 'Pronta para começar' : players.length + planned < 2 ? 'Aguardando participantes' : 'Aguardando jogadores';
    this.name.textContent = room?.name || `Sala ${state.code}`;
    this.host.textContent = `Host: ${room?.hostName || 'Jogador'} · ${status}`;
    this.code.textContent = `⌁ ${state.code} · copiar`;
    this.code.title = 'Copiar o código da sala';
    this.count.textContent = `${players.length} ${players.length === 1 ? 'humano' : 'humanos'} + ${planned} ${planned === 1 ? 'bot' : 'bots'} · ${players.length + planned} / ${capacity}`;
    this.visibilityFact.textContent = room?.visibility === 'private' ? 'Privada · só por código' : 'Pública · aparece na lista';
    this.desired.disabled = !isHost;
    this.desired.value = String(room?.botsDesired ?? 0);
    const desired = room?.botsDesired ?? 0;
    this.desiredNote.textContent = !isHost ? 'Definido pelo host' : desired > planned ? `${planned} cabem agora; humanos têm prioridade` : '';
    this.ready.textContent = this.mineReady ? '✓ Desfazer pronto' : 'Estou pronto';
    this.ready.classList.toggle('primary', !this.mineReady);
    this.ready.setAttribute('aria-pressed', String(this.mineReady));
    this.start.hidden = !isHost;
    this.start.disabled = !room?.canStart;
    this.why.textContent = room?.canStart
      ? isHost
        ? 'Todos prontos. Você pode iniciar o Draft.'
        : 'Todos prontos. Aguardando o host iniciar o Draft.'
      : room?.startReason || 'Marque pronto quando seu personagem estiver preparado.';
    this.why.dataset.ready = String(!!room?.canStart);
    const key = JSON.stringify([
      players.map((p) => [p.index, p.name, p.ready, p.dropped, p.appearance]),
      planned,
      room?.hostSessionId,
      me,
    ]);
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren();
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = players[i];
      const bot = !p && i - players.length < planned;
      const host = !!p && room?.hostSessionId === p.sessionId;
      const slot = node(
        'article',
        `player-slot${p?.index === me ? ' player-slot-me' : ''}${bot ? ' planned-bot' : ''}${!p && !bot ? ' empty-slot' : ''}${p?.ready ? ' is-ready' : ''}`,
      );
      const number = node('span', 'slot-number', String(i + 1).padStart(2, '0'));
      const avatar = node('div', 'slot-avatar');
      if (p) avatar.innerHTML = avatarPortrait(p.appearance);
      else if (bot) avatar.innerHTML = BOT_ART;
      else avatar.textContent = '+';
      const identity = node('div', 'slot-identity');
      identity.append(
        node('strong', '', p ? `${p.name}${p.index === me ? ' (você)' : ''}` : bot ? `Bot ${String(i - players.length + 1).padStart(2, '0')}` : 'Vaga aberta'),
        node('span', '', p ? (host ? 'HOST · HUMANO' : 'JOGADOR · HUMANO') : bot ? 'BOT PREVISTO · ENTRA NO DRAFT' : 'AGUARDANDO JOGADOR'),
      );
      slot.append(
        number,
        avatar,
        identity,
        badge(
          p ? (p.dropped ? 'Reconectando' : p.ready ? 'Pronto ✓' : 'Aguardando') : bot ? 'Automático' : 'Livre',
          p ? (p.dropped ? 'bad' : p.ready ? 'good' : '') : bot ? 'blue' : '',
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
