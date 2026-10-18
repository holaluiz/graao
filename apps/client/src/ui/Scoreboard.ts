import { MatchPhase, type MatchSummaryMsg, type PlayerPublic } from '@graao/shared';
import '../styles/scoreboard.css';

export interface ScoreboardState {
  players: readonly PlayerPublic[];
  phase: MatchPhase;
  me: number;
  eliminated: ReadonlySet<number>;
  summary?: MatchSummaryMsg | null;
}

export interface ScoreboardPlayer {
  index: number;
  name: string;
  bot: boolean;
  mine: boolean;
  connected: boolean;
  participant: boolean;
  alive: boolean;
  status: string;
  kills: number;
  deaths: number;
  damage: number;
  leader: boolean;
}

/** Ranking and counters come from server room data; the final summary includes participants who left. */
export function buildScoreboard(state: ScoreboardState): { players: ScoreboardPlayer[]; alive: number; total: number; eliminated: number; leaders: string[]; mostKills: number } {
  const final = state.phase === MatchPhase.RESULTS ? state.summary : null;
  const room = new Map(state.players.map((p) => [p.index, p]));
  const indices = new Set([...room.keys(), ...(final?.players.map((p) => p.index) ?? [])]);
  const players: ScoreboardPlayer[] = [];
  for (const index of indices) {
    const p = room.get(index);
    const result = final?.players.find((line) => line.index === index);
    const participant = !!result || !!p?.inMatch;
    const connected = result?.left ? false : p?.connected ?? !result?.left;
    const alive = participant && connected && (result ? result.won : p?.alive !== false && !state.eliminated.has(index));
    players.push({
      index,
      name: result?.name ?? p?.name ?? `Jogador ${index + 1}`,
      bot: !!p?.bot,
      mine: index === state.me,
      connected,
      participant,
      alive,
      status: !connected ? 'Saiu' : !participant ? 'Espectador' : alive ? 'Vivo' : 'Eliminado',
      kills: result?.kills ?? p?.kills ?? 0,
      deaths: result?.deaths ?? p?.deaths ?? 0,
      damage: result?.damageDealt ?? p?.damageDealt ?? 0,
      leader: false,
    });
  }
  players.sort((a, b) => Number(b.participant) - Number(a.participant) || b.kills - a.kills || b.damage - a.damage || a.deaths - b.deaths || a.index - b.index);
  const mostKills = Math.max(0, ...players.filter((p) => p.participant).map((p) => p.kills));
  for (const p of players) p.leader = p.participant && mostKills > 0 && p.kills === mostKills;
  const participants = players.filter((p) => p.participant);
  const alive = participants.filter((p) => p.alive).length;
  return { players, alive, total: participants.length, eliminated: participants.length - alive, leaders: players.filter((p) => p.leader).map((p) => p.name), mostKills };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** A read-only overlay: holding Tab never releases the mouse or interrupts movement. */
export class Scoreboard {
  readonly el = el('section', 'scoreboard-screen');
  private readonly card = el('div', 'scoreboard', this.el);
  private readonly alive = el('strong', '', undefined, '0');
  private readonly total = el('strong', '', undefined, '0');
  private readonly eliminated = el('strong', '', undefined, '0');
  private readonly leader = el('div', 'sb-leader', this.card);
  private readonly table = el('div', 'sb-table', this.card);
  private readonly rows = el('div', 'sb-rows', this.table);
  private state: ScoreboardState | null = null;
  private rendered = '';

  constructor() {
    this.el.hidden = true;
    this.el.setAttribute('aria-label', 'Placar da partida');
    const header = el('div', 'sb-header');
    el('h2', '', header, 'PLACAR DA PARTIDA');
    el('span', 'sb-key', header, 'TAB');
    this.card.prepend(header);
    const counters = el('div', 'sb-counters');
    for (const [value, label] of [[this.alive, 'Vivos'], [this.total, 'Jogadores'], [this.eliminated, 'Eliminados']] as const) {
      const cell = el('div', 'sb-counter', counters);
      cell.append(value);
      el('span', '', cell, label);
    }
    header.after(counters);
    const head = el('div', 'sb-row sb-head');
    for (const [label, title] of [['#', 'Posição por eliminações'], ['Jogador', 'Jogador e situação'], ['Elim.', 'Eliminações'], ['Mortes', 'Mortes'], ['Dano', 'Dano causado']] as const) {
      const cell = el('span', '', head, label);
      cell.title = title;
    }
    this.table.prepend(head);
    el('div', 'sb-foot', this.card, 'Segure TAB para ver · solte para voltar');
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  setState(state: ScoreboardState): void {
    this.state = state;
    if (this.visible) this.render();
  }

  show(held: boolean): void {
    this.el.hidden = !held;
    if (held) this.render();
  }

  hide(): void {
    this.show(false);
  }

  private render(): void {
    if (!this.state) return;
    const model = buildScoreboard(this.state);
    const key = JSON.stringify(model);
    if (key === this.rendered) return;
    this.rendered = key;
    this.alive.textContent = String(model.alive);
    this.total.textContent = String(model.total);
    this.eliminated.textContent = String(model.eliminated);
    this.leader.textContent = model.mostKills > 0
      ? `${model.leaders.length > 1 ? 'Liderança dividida' : 'Mais eliminações'}: ${model.leaders.join(', ')} · ${model.mostKills}`
      : 'A primeira eliminação ainda está por vir';
    this.leader.title = this.leader.textContent;
    this.rows.replaceChildren();
    for (const [i, p] of model.players.entries()) {
      const row = el('div', `sb-row${p.mine ? ' sb-me' : ''}${p.leader ? ' sb-top' : ''}`, this.rows);
      row.dataset.status = p.alive ? 'alive' : p.participant ? 'out' : 'spectator';
      el('span', 'sb-rank', row, String(i + 1));
      const player = el('div', 'sb-player', row);
      const name = el('div', 'sb-name', player, p.name);
      name.title = p.name;
      el('div', 'sb-meta', player, [p.status, p.mine ? 'você' : '', p.bot ? 'bot' : '', p.leader ? '★ líder' : ''].filter(Boolean).join(' · '));
      el('span', 'sb-num', row, String(p.kills));
      el('span', 'sb-num', row, String(p.deaths));
      el('span', 'sb-num', row, String(Math.round(p.damage)));
    }
  }
}
