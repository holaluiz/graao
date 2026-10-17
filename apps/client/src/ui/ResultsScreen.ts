/**
 * Results screen (DOM/CSS/SVG over the live world): VITÓRIA / DERROTA / EMPATE from the server's MATCH_SUMMARY,
 * every participant's line (placement, eliminations, damage dealt and taken, accuracy, spells, the drafted loadout),
 * the room's running score, whether the match reached this player's history, and the way out: VOLTAR AO LOBBY (the
 * room goes back once everyone asked, or when the timer ends) or SAIR DA SALA.
 *
 * Built once per summary; per frame only the timer and the "waiting for" line change (buttons stay clickable).
 * Outcome is never color-only: the title word, the crown/placement marks and the tone all say it.
 */
import { ABILITIES, isAbilityId } from '@graao/game-data';
import type { MatchSummaryMsg, PlayerPublic } from '@graao/shared';
import { ABILITY_ICONS } from './abilityIcons';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** m:ss */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface ResultsActions {
  lobby(): void;
  leave(): void;
  click(): void;
}

/** What the screen says about persistence: saved to the cloud history, a guest (nothing kept), or still unknown. */
export type SaveState = 'saved' | 'guest' | 'pending';

export class ResultsScreen {
  readonly el = el('div', 'results-screen');
  private readonly card = el('div', 'results', this.el);
  private readonly foot = el('div', 'results-foot');
  private readonly waiting = el('div', 'results-wait');
  private readonly saveEl = el('div', 'results-save');
  private readonly lobbyBtn = el('button', 'btn primary', undefined, 'Voltar ao lobby');
  private readonly leaveBtn = el('button', 'btn', undefined, 'Sair da sala');
  private shownFor = '';
  private asked = false;

  constructor(private readonly actions: ResultsActions) {
    this.el.hidden = true;
    this.lobbyBtn.addEventListener('click', () => {
      this.actions.click();
      this.askLobby();
    });
    this.leaveBtn.addEventListener('click', () => {
      this.actions.click();
      this.actions.leave();
    });
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /** ENTER on the results: same as the button. */
  askLobby(): void {
    if (this.asked || this.el.hidden) return;
    this.asked = true;
    this.lobbyBtn.disabled = true;
    this.lobbyBtn.textContent = 'Esperando os outros…';
    this.actions.lobby();
  }

  hide(): void {
    this.el.hidden = true;
    this.shownFor = '';
  }

  /** Builds the card for this summary (once; later calls only refresh the live parts). */
  show(s: MatchSummaryMsg, me: number, room: PlayerPublic[], save: SaveState): void {
    const key = `${s.code}:${s.endedAt}`;
    if (this.shownFor !== key) {
      this.shownFor = key;
      this.asked = false;
      this.build(s, me, room);
    }
    this.el.hidden = false;
    this.setSave(save);
  }

  private build(s: MatchSummaryMsg, me: number, room: PlayerPublic[]): void {
    const c = this.card;
    c.innerHTML = '';
    const mine = s.players.find((p) => p.index === me);
    const draw = s.winner < 0;
    const victory = !draw && s.winner === me;
    const winner = s.players.find((p) => p.index === s.winner);
    c.dataset.tone = draw ? 'neutral' : victory ? 'good' : mine ? 'bad' : 'neutral';
    el('div', 'results-title', c, draw ? 'EMPATE' : victory ? 'VITÓRIA!' : mine ? 'DERROTA' : 'FIM DE PARTIDA');
    const sub = draw ? 'Ninguém ficou de pé' : victory ? 'Você foi o último de pé' : `${winner?.name ?? 'Alguém'} venceu a partida`;
    el('div', 'results-sub', c, `${sub} · ${formatDuration(s.durationMs)}`);

    // Everyone's line, best placement first.
    const table = el('div', 'results-table', c);
    const head = el('div', 'rt-row rt-head', table);
    for (const h of ['', 'Jogador', 'Elim.', 'Dano', 'Sofrido', 'Precisão', 'Magias']) el('div', 'rt-cell', head, h);
    for (const p of s.players) {
      const row = el('div', `rt-row${p.index === me ? ' me' : ''}${p.won ? ' won' : ''}`, table);
      el('div', 'rt-cell rt-place', row, p.won ? '♛' : `${p.placement}º`);
      const who = el('div', 'rt-cell rt-name', row);
      el('span', '', who, p.name);
      if (p.index === me) el('span', 'rt-tag', who, 'você');
      if (p.left) el('span', 'rt-tag', who, 'saiu');
      const icons = el('span', 'rt-loadout', who);
      for (const id of p.loadout) {
        if (!isAbilityId(id)) continue;
        const def = ABILITIES[id];
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '-16 -16 32 32');
        svg.setAttribute('aria-label', def.name);
        svg.innerHTML = `<title>${def.name}</title>${ABILITY_ICONS[def.presentation.icon]}`;
        svg.style.color = def.presentation.color;
        icons.appendChild(svg);
      }
      const acc = p.shots > 0 ? `${Math.round((100 * p.hits) / p.shots)}%` : '–';
      for (const v of [String(p.kills), String(p.damageDealt), String(p.damageTaken), acc, String(p.abilitiesCast)]) el('div', 'rt-cell rt-num', row, v);
    }

    // The room's running score (players still here), e.g. "Ana 2 × 1 Beto".
    const here = room.filter((p) => p.connected);
    if (here.length >= 2) {
      const score = el('div', 'results-score', c);
      el('span', 'results-score-k', score, 'Placar da sala');
      el('span', '', score, here.map((p) => `${p.name} ${p.wins}`).join(' × '));
    }
    c.append(this.saveEl);
    const row = el('div', 'row results-actions', c);
    this.lobbyBtn.disabled = false;
    this.lobbyBtn.textContent = 'Voltar ao lobby';
    row.append(this.lobbyBtn, this.leaveBtn);
    c.append(this.waiting, this.foot);
  }

  private setSave(save: SaveState): void {
    const text = save === 'saved' ? '☁ Partida salva no seu histórico' : save === 'guest' ? 'Jogando como convidado: esta partida não vai para um histórico' : '';
    if (this.saveEl.textContent !== text) this.saveEl.textContent = text;
    this.saveEl.dataset.state = save;
  }

  /** Per frame: seconds until the room returns by itself, and who still has to ask. */
  update(secondsLeft: number, room: PlayerPublic[]): void {
    if (this.el.hidden) return;
    const here = room.filter((p) => p.connected);
    const back = here.filter((p) => p.back).length;
    const foot = `De volta ao lobby em ${Math.max(0, secondsLeft)} s · ENTER volta agora`;
    if (this.foot.textContent !== foot) this.foot.textContent = foot;
    const wait = this.asked && back < here.length ? `Esperando ${here.filter((p) => !p.back).map((p) => p.name).join(', ')} (${back}/${here.length})` : '';
    if (this.waiting.textContent !== wait) this.waiting.textContent = wait;
  }
}
