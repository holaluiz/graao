/** Graao Host window: draws `HostUiState` and forwards the person's choices through the preload bridge. */
import type { HostSettings, HostUiState } from '../main/types';

interface Bridge {
  getState(): Promise<HostUiState>;
  onState(cb: (s: HostUiState) => void): () => void;
  onLog(cb: (line: string) => void): () => void;
  confirmPairing(accept: boolean): Promise<void>;
  stop(): Promise<void>;
  retry(): Promise<void>;
  dismiss(): Promise<void>;
  clearNotice(): Promise<void>;
  openRoom(): Promise<void>;
  openSite(): Promise<void>;
  download(): Promise<void>;
  checkUpdates(): Promise<void>;
  unlink(): Promise<void>;
  logs(): Promise<string[]>;
  setSettings(s: HostSettings): Promise<void>;
}

const host = (window as unknown as { graaoHost: Bridge }).graaoHost;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(text: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function fact(label: string, value: string, tone = ''): HTMLElement {
  const f = el('div', 'fact');
  if (tone) f.dataset.tone = tone;
  f.append(el('span', '', label), el('strong', '', value));
  return f;
}

const TUNNEL_LABEL: Record<string, string> = { managed: 'Endereço seguro graao', 'quick-test': 'Túnel de TESTE (trycloudflare)', 'direct-dev': 'Local (desenvolvimento)' };
const STATUS_LABEL: Record<string, string> = { LOBBY: 'Lobby', DRAFT: 'Draft de habilidades', DEPLOYMENT: 'OVNI / queda', MATCH: 'Partida', RESULTS: 'Resultados', CLOSED: 'Encerrada' };
const STEPS: [HostUiState['phase'], string][] = [
  ['STARTING_SERVER', 'Iniciando o servidor da partida'],
  ['CONNECTING_TUNNEL', 'Abrindo a conexão pública segura'],
  ['REGISTERING_ROOM', 'Publicando a sala na lista'],
];

let state: HostUiState | null = null;

function render(s: HostUiState): void {
  state = s;
  const status = $('status');
  const online = s.phase === 'READY' || s.phase === 'HOSTING';
  const working = ['PAIRING', 'STARTING_SERVER', 'CONNECTING_TUNNEL', 'REGISTERING_ROOM', 'STOPPING'].includes(s.phase);
  status.textContent = online ? 'ONLINE' : s.phase === 'ERROR' ? 'ERRO' : working ? 'PREPARANDO' : 'OFFLINE';
  status.dataset.tone = online ? 'on' : s.phase === 'ERROR' ? 'bad' : working ? 'busy' : 'off';

  const notice = $('notice');
  notice.hidden = !s.notice;
  notice.textContent = s.notice;

  const card = $('card');
  card.replaceChildren(...cardFor(s));
  ($('open-room') as HTMLButtonElement).disabled = !online;
  ($('stop') as HTMLButtonElement).disabled = !(online || (working && s.phase !== 'PAIRING' && s.phase !== 'STOPPING'));

  const update = s.app.latest && s.app.latest !== s.app.version ? ` · nova versão ${s.app.latest} disponível` : '';
  $('foot').textContent = `Graao Host ${s.app.version} · protocolo ${s.app.protocol}${update}`;
  renderTech(s);
}

function cardFor(s: HostUiState): Node[] {
  if (s.phase === 'PAIRING' && s.pairing) {
    const p = s.pairing;
    return [
      el('span', 'kicker', 'VINCULAR ESTE PC'),
      el('h2', '', `Hospedar para ${p.hostDisplayName || 'esta conta'}?`),
      el('p', '', `O site do graao pediu para este PC hospedar a sala "${p.roomName}" (${p.visibility === 'PRIVATE' ? 'privada' : 'pública'}, ${p.bots} ${p.bots === 1 ? 'bot' : 'bots'}).`),
      el('p', 'fine', 'Ao confirmar, este PC fica vinculado à conta e passa a executar as partidas que ela criar. Os amigos se conectam por um endereço seguro; seu IP não aparece para eles. Só confirme se foi você quem pediu.'),
      (() => {
        const row = el('div', 'split');
        row.append(button('VINCULAR E HOSPEDAR', () => void host.confirmPairing(true), 'btn btn-sun'), button('Cancelar', () => void host.confirmPairing(false)));
        return row;
      })(),
    ];
  }
  if (s.phase === 'PAIRING') return [el('span', 'kicker', 'PEDIDO RECEBIDO'), el('h2', '', 'Conferindo o pedido…'), el('p', '', 'Validando com o serviço central do graao.')];
  if (s.phase === 'STARTING_SERVER' || s.phase === 'CONNECTING_TUNNEL' || s.phase === 'REGISTERING_ROOM') {
    const idx = STEPS.findIndex(([p]) => p === s.phase);
    const list = el('ol', 'steps');
    STEPS.forEach(([, label], i) => {
      const li = el('li', '', label);
      li.dataset.s = i < idx ? 'done' : i === idx ? 'now' : 'next';
      list.append(li);
    });
    return [el('span', 'kicker', 'PREPARANDO A SALA'), el('h2', '', 'Quase lá'), el('p', '', 'A sala só aparece para os outros quando tudo estiver respondendo de verdade.'), list];
  }
  if (s.phase === 'STOPPING') return [el('span', 'kicker', 'ENCERRANDO'), el('h2', '', 'Encerrando a hospedagem…'), el('p', '', 'Avisando os jogadores e removendo a sala da lista.')];
  if (s.phase === 'ERROR' && s.error) {
    const row = el('div', 'split');
    if (s.error.retryable) row.append(button('TENTAR NOVAMENTE', () => void host.retry(), 'btn btn-sun'));
    if (s.error.update) row.append(button('BAIXAR ATUALIZAÇÃO', () => void host.download(), 'btn btn-sun'));
    row.append(button('Voltar', () => void host.dismiss()));
    return [el('span', 'kicker', 'NÃO DEU CERTO'), el('h2', '', s.error.title), el('p', '', s.error.message), row];
  }
  if ((s.phase === 'READY' || s.phase === 'HOSTING') && s.room) {
    const r = s.room;
    const seats = el('div', 'seats');
    for (let i = 0; i < r.maxParticipants; i++) seats.append(el('i', i < r.humanCount ? 'human' : i < r.humanCount + r.effectiveBotCount ? 'bot' : ''));
    const grid = el('div', 'grid');
    const stab = s.stability === 'boa' ? ['Boa', 'good'] : s.stability === 'atencao' ? ['Atenção', 'warn'] : s.stability === 'sobrecarregado' ? ['Sobrecarregado', 'bad'] : ['—', ''];
    grid.append(
      fact('PARTICIPANTES', `${r.humanCount} ${r.humanCount === 1 ? 'humano' : 'humanos'} + ${r.effectiveBotCount} bots`),
      fact('FASE', STATUS_LABEL[r.status] ?? r.status),
      fact('CONEXÃO', TUNNEL_LABEL[s.connection.tunnel ?? ''] ?? '—', s.connection.tunnel === 'quick-test' ? 'warn' : 'good'),
      fact('ESTABILIDADE', stab[0]!, stab[1]),
      fact('CPU DO SERVIDOR', s.metrics ? `${s.metrics.cpuPercent.toFixed(0)}%` : '—'),
      fact('MEMÓRIA', s.metrics ? `${s.metrics.rssMB} MB` : '—'),
    );
    const parts: Node[] = [
      el('span', 'kicker', r.visibility === 'PRIVATE' ? 'SALA PRIVADA' : 'SALA PÚBLICA'),
      el('h2', '', r.name),
      el('span', 'code', r.code),
      el('p', '', r.hostPresent ? 'Você está na sala. Bom jogo!' : 'Abra a sala no navegador para entrar como host.'),
      seats,
      grid,
    ];
    if (s.connection.central !== 'ok') parts.push(el('p', 'fine', 'Sem contato com o serviço central no momento: a partida continua.'));
    return parts;
  }
  return [
    el('span', 'kicker', s.phase === 'OFFLINE' ? 'HOSPEDAGEM ENCERRADA' : 'PRONTO'),
    el('h2', '', 'Nenhuma sala ativa'),
    el('p', '', 'Para hospedar, abra o graao no navegador, vá em Jogar → Criar sala e escolha "Criar e hospedar". Este aplicativo cuida do resto.'),
    el('p', 'fine', s.linked ? 'Este PC já está vinculado à sua conta.' : 'Na primeira vez, este aplicativo pede sua confirmação para vincular o PC à conta.'),
    button('ABRIR O GRAAO', () => void host.openSite(), 'btn btn-sun'),
  ];
}

async function renderTech(s: HostUiState): Promise<void> {
  const tech = $('tech');
  tech.hidden = !s.settings.devPanel;
  if (tech.hidden) return;
  const facts = $('tech-facts');
  const m = s.metrics;
  const rows: [string, string][] = [
    ['fase', s.phase],
    ['endpoint', s.connection.endpointHost || '—'],
    ['central', s.connection.central],
    ['tick', m ? `${m.tickMs} ms / ${m.tickBudgetMs} ms` : '—'],
    ['atraso do loop (p99)', m ? `${m.loopLagMs} ms` : '—'],
    ['bytes', m ? `↓ ${(m.bytesIn / 1024).toFixed(0)} KB · ↑ ${(m.bytesOut / 1024).toFixed(0)} KB` : '—'],
    ['conexões', m ? String(m.connections) : '—'],
    ['app (todos os processos)', m ? `${m.appCpuPercent}% CPU · ${m.appMemoryMB} MB` : '—'],
    ['heap do servidor', m ? `${m.heapMB} MB` : '—'],
  ];
  facts.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', '', k), el('dd', '', v)]));
}

let logLines: string[] = [];
function pushLog(line: string): void {
  logLines.push(line);
  if (logLines.length > 300) logLines = logLines.slice(-300);
  const pre = $('tech-log');
  pre.textContent = logLines.join('\n');
  pre.scrollTop = pre.scrollHeight;
}

$('open-room').addEventListener('click', () => void host.openRoom());
$('stop').addEventListener('click', () => {
  // One click must not end a match for everyone by accident: ask when friends are in the room or it already started.
  const r = state?.phase === 'READY' || state?.phase === 'HOSTING' ? state.room : null;
  const others = r ? r.humanCount - (r.hostPresent ? 1 : 0) : 0;
  if (r && (r.status !== 'LOBBY' || others > 0)) {
    const who = others > 0 ? `${others} ${others === 1 ? 'amigo está' : 'amigos estão'} na sala` : 'A partida está em andamento';
    if (!confirm(`Encerrar a hospedagem agora?\n\n${who}. A partida termina para todos e a sala sai da lista.`)) return;
  }
  void host.stop();
});
$('notice').addEventListener('click', () => void host.clearNotice());

const dialog = $('settings-dialog') as HTMLDialogElement;
const form = $('settings-form') as HTMLFormElement;
$('settings').addEventListener('click', () => {
  if (!state) return;
  for (const k of ['minimizeToTray', 'launchAtLogin', 'devPanel'] as const) (form.elements.namedItem(k) as HTMLInputElement).checked = state.settings[k];
  $('settings-info').textContent = `Versão ${state.app.version}${state.app.latest ? ` · mais recente: ${state.app.latest}` : ''} · ${state.linked ? 'PC vinculado' : 'PC não vinculado'}`;
  ($('unlink') as HTMLButtonElement).disabled = !state.linked || ['STARTING_SERVER', 'CONNECTING_TUNNEL', 'REGISTERING_ROOM', 'READY', 'HOSTING', 'STOPPING'].includes(state.phase);
  dialog.showModal();
});
form.addEventListener('submit', () => {
  const v = (k: string) => (form.elements.namedItem(k) as HTMLInputElement).checked;
  void host.setSettings({ minimizeToTray: v('minimizeToTray'), launchAtLogin: v('launchAtLogin'), devPanel: v('devPanel') }).then(async () => {
    if (v('devPanel')) logLines = await host.logs();
    pushLog('— painel técnico —');
  });
});
$('check-updates').addEventListener('click', () => void host.checkUpdates());
$('unlink').addEventListener('click', () => {
  if (confirm('Desvincular este PC? A próxima sala vai pedir confirmação de novo.')) void host.unlink();
});

host.onState(render);
host.onLog(pushLog);
void host.getState().then(async (s) => {
  render(s);
  if (s.settings.devPanel) for (const l of await host.logs()) pushLog(l);
});
