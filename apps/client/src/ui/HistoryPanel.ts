/**
 * Match history (menu): this player's latest matches as the match server recorded them in Supabase (`my_matches`).
 * Each line says the outcome in words (never color only), who it was against, how long it lasted and the player's
 * own numbers.
 */
import type { HistoryEntry } from '@graao/database';
import { formatDuration } from './ResultsScreen';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias". */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}

export class HistoryPanel {
  readonly el = el('div', 'history');
  private readonly body = el('div', 'history-body');

  constructor(onClose: () => void) {
    this.el.hidden = true;
    const top = el('div', 'history-top', this.el);
    el('div', 'history-title', top, 'Suas partidas');
    const close = el('button', 'btn small', top, 'Fechar');
    close.addEventListener('click', onClose);
    this.el.append(this.body);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(v: boolean): void {
    this.el.hidden = !v;
  }

  message(text: string): void {
    this.body.innerHTML = '';
    el('div', 'history-empty', this.body, text);
  }

  setEntries(list: HistoryEntry[]): void {
    if (!list.length) return this.message('Nenhuma partida ainda. Crie uma sala e chame alguém!');
    this.body.innerHTML = '';
    for (const m of list) {
      const me = m.players.find((p) => p.index === m.myIndex);
      const won = m.winner >= 0 && m.winner === m.myIndex;
      const draw = m.winner < 0;
      const row = el('div', `history-row ${draw ? 'draw' : won ? 'won' : 'lost'}`, this.body);
      el('div', 'history-result', row, draw ? 'EMPATE' : won ? 'VITÓRIA' : 'DERROTA');
      const mid = el('div', 'history-mid', row);
      const others = m.players.filter((p) => p.index !== m.myIndex).map((p) => p.name);
      el('div', 'history-vs', mid, others.length ? `vs ${others.join(', ')}` : 'sozinho');
      const acc = me && me.shots > 0 ? ` · ${Math.round((100 * me.hits) / me.shots)}% precisão` : '';
      el('div', 'history-stats', mid, me ? `${me.kills} elim. · ${me.damageDealt} dano${acc} · ${formatDuration(m.durationMs)}` : formatDuration(m.durationMs));
      el('div', 'history-when', row, ago(m.endedAt));
    }
  }
}
