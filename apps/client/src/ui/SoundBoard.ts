/**
 * Painel de sons (`?sons`): todos os sons do jogo por categoria, tocados pelo mixer de verdade (os mesmos barramentos,
 * volumes e variações da partida), sem carregar o mundo. Serve para ouvir o banco (docs/audio/SOUND_DESIGN.md) e
 * compará-lo com o som sintetizado de antes.
 */
import { GRAAudioManager, type Cue, type StepAction, type StepSurface } from '../audio/GRAAudioManager';
import { GRAAssetManager } from '../assets/GRAAssetManager';
import type { SfxName } from '../audio/sfxBank';

interface Item {
  label: string;
  play(audio: GRAAudioManager): void;
}

const cue = (c: Cue, label: string = c): Item => ({ label, play: (a) => void a.play(c) });

/** A sequence of cues `every` seconds apart (rajadas, passos). */
function series(label: string, c: Cue, count: number, every: number, extra: Parameters<GRAAudioManager['play']>[1] = {}): Item {
  return { label, play: (a) => { for (let i = 0; i < count; i++) a.play(c, { ...extra, delay: i * every }); } };
}

/** A bank recording on the bus WorldAudio uses for it (doors on loot, crates on weapons). */
function world(name: SfxName, label: string): Item {
  return {
    label,
    play: (a) => {
      const out = a.output(name.startsWith('door') ? 'loot' : 'weapons');
      const buf = a.sampleBuffer(name);
      if (!out || !buf) return;
      const src = out.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(out.bus);
      src.start();
    },
  };
}

const SURFACES: [StepSurface, string][] = [['grass', 'grama'], ['dirt', 'terra'], ['sand', 'areia'], ['stone', 'pedra'], ['wood', 'madeira'], ['metal', 'metal']];
const GAITS: [StepAction, string, number][] = [['walk', 'andando', 0.52], ['run', 'correndo', 0.34], ['sprint', 'disparada', 0.27]];

const GROUPS: [string, Item[]][] = [
  ['Armas', [
    cue('fire.pistol', 'Pistola'), cue('fire.smg', 'Submetralhadora'), cue('fire.rifle', 'Fuzil Kalash'),
    cue('fire.sniper', 'Fuzil de Precisão'), cue('fire.rocket', 'Lança-Foguetes'), cue('fire.petal', 'Rajada de Pétalas'),
    cue('fire.sunbeam', 'Raio de Sol'),
    series('Rajada: submetralhadora (1 s)', 'fire.smg', 11, 1 / 11), series('Rajada: fuzil (1 s)', 'fire.rifle', 6, 1 / 5.8),
    series('Rajada: Raio de Sol (1 s)', 'fire.sunbeam', 7, 1 / 7),
    { label: 'Tiro a 25 m (inimigo)', play: (a) => a.playShot('fire.rifle', 25, { threat: true, pan: 0.5 }, 1.2) },
    { label: 'Tiro a 90 m (eco)', play: (a) => a.playShot('fire.rifle', 90, { threat: true, pan: -0.4 }, 1.2) },
    { label: 'Precisão a 160 m', play: (a) => a.playShot('fire.sniper', 160, { threat: true, pan: 0.3 }, 1.5) },
    { label: 'Recarga completa (1,7 s)', play: (a) => { a.play('reload'); a.play('reload.in', { delay: 0.85 }); a.play('reload.end', { delay: 1.4 }); } },
    cue('reload', 'Pente sai'), cue('reload.in', 'Pente entra'), cue('reload.end', 'Ferrolho'), cue('empty', 'Sem munição'),
    cue('switch', 'Trocar de arma'), cue('loot.equip', 'Pegar arma'),
  ]],
  ['Acertos, dano e morte', [
    cue('hit.body', 'Acerto (corpo)'), cue('hit.crit', 'Acerto crítico'), cue('hit.shield', 'Acerto no escudo'),
    cue('hit.shieldBreak', 'Quebrou o escudo dele'), cue('hit.elim', 'Eliminação'), cue('hurt.health', 'Levei dano'),
    cue('hurt.shield', 'Dano no meu escudo'), cue('hurt.shieldBreak', 'Meu escudo quebrou'), cue('death', 'Morri'),
    cue('melee.swing', 'Soco no ar'), cue('melee.hit', 'Soco acertou'), cue('melee.wall', 'Soco na parede'),
  ]],
  ['Magias', [
    cue('ab.orb', 'Orbe'), cue('ab.dash', 'Disparada'), cue('ab.pollen', 'Pólen'), cue('ab.shield', 'Escudo'),
    cue('ab.seed', 'Semente'), cue('ab.gust', 'Rajada de vento'), cue('ab.sap', 'Seiva'), cue('ab.heal', 'Cura'),
    cue('ab.meteor', 'Meteoro (anúncio)'), cue('ab.boom', 'Meteoro (explosão)'), cue('ab.cyclone', 'Ciclone'),
    cue('ab.lance', 'Lança'), cue('ab.impact', 'Impacto'), cue('ab.area', 'Área'), cue('ab.warn', 'Aviso de magia'),
    cue('ab.denied', 'Magia negada'), cue('ult.ready', 'Supremo pronto'),
  ]],
  ['Passos', [
    ...SURFACES.flatMap(([s, name]) => GAITS.map(([g, gait, every]) => series(`${name} · ${gait}`, `step.${s}`, 6, every, { step: g, volume: 0.8 }))),
    ...SURFACES.map(([s, name]) => ({ label: `${name} · pouso`, play: (a: GRAAudioManager) => void a.play(`step.${s}`, { step: 'land', volume: 0.8 }) })),
  ]],
  ['Partida e interface', [
    { label: 'Contagem 3, 2, 1, valendo', play: (a) => { for (let i = 0; i < 3; i++) a.play('countdown', { delay: i }); a.play('go', { delay: 3 }); } },
    cue('victory', 'Vitória'), cue('defeat', 'Derrota'), cue('xp', 'Experiência'), cue('levelup', 'Subiu de nível'),
    cue('ui.click', 'Clique'), cue('ui.ready', 'Pronto'), cue('ui.swap', 'Trocar roupa'), cue('draft.lock', 'Draft: escolheu'),
    cue('draft.reveal', 'Draft: revelou'), cue('draft.lost', 'Draft: perdeu a escolha'), series('Draft: últimos segundos', 'draft.tick', 5, 1),
  ]],
  ['Saque', [
    cue('loot.near', 'Algo por perto'), cue('loot.open', 'Abrir baú'), cue('loot.reveal', 'Recompensa'), cue('loot.pickup', 'Pegar item'),
    cue('loot.ammo', 'Munição'), cue('loot.use', 'Usar item'), cue('loot.useDone', 'Item usado'), cue('loot.full', 'Sem espaço'),
  ]],
  ['Nave, movimento e água', [
    cue('ufo.open', 'Escotilha abre'), cue('ufo.jump', 'Saltar da nave'), cue('land', 'Pouso da nave'), cue('land.water', 'Pouso na água'),
    cue('splash', 'Respingo'), series('Nadando', 'swim.stroke', 4, 0.6), series('Andando na água', 'wade', 6, 0.36),
    cue('jump.air', 'Pulo duplo'), cue('gasp', 'Fôlego ao subir'),
  ]],
  ['Tormenta e criaturas', [
    cue('tormenta.warn', 'Tormenta: aviso'), series('Tormenta: relógio', 'tormenta.tick', 5, 0.5), cue('tormenta.shrink', 'Tormenta: fechando'),
    cue('tormenta.final', 'Tormenta: final'), cue('tormenta.enter', 'Entrar na Tormenta'), cue('tormenta.exit', 'Sair da Tormenta'),
    cue('tormenta.hurt', 'Dano da Tormenta'), cue('creep.windup', 'Criatura vai bater'), cue('creep.hit', 'Criatura apanha'),
    cue('creep.die', 'Criatura desmorona'),
  ]],
  ['Mundo', [
    world('door.open', 'Porta abre'), world('door.close', 'Porta fecha'), world('crate.hit', 'Caixa leva golpe'), world('crate.break', 'Caixa quebra'),
  ]],
];

const CSS = `
.sb { position: fixed; inset: 0; overflow: auto; background: var(--paper); color: var(--ink); font-family: var(--font); user-select: none; }
.sb-in { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
.sb h1 { margin: 0 0 4px; font-size: 28px; }
.sb p { margin: 0 0 12px; opacity: 0.8; }
.sb-bar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 10px 0; background: var(--paper); border-bottom: 2px solid #0002; }
.sb-bar label { display: flex; gap: 6px; align-items: center; font-weight: 700; }
.sb h2 { margin: 22px 0 8px; font-size: 18px; }
.sb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.sb button { font: inherit; font-weight: 700; text-align: left; padding: 10px 12px; border-radius: 12px; border: 0; cursor: pointer;
  background: var(--card); color: var(--card-ink); box-shadow: 0 3px 0 var(--card-shadow); }
.sb button:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--card-shadow); }
.sb button.on { background: var(--sun); box-shadow: 0 3px 0 var(--card-sun-shadow); color: var(--ink); }
.sb-status { font-variant-numeric: tabular-nums; }
`;

export class SoundBoard {
  private readonly audio = new GRAAudioManager();

  constructor(private readonly host: HTMLElement) {}

  show(): void {
    const assets = new GRAAssetManager();
    void this.audio.loadSamples((file) => assets.url(`audio/sfx/${file}`));
    const style = document.createElement('style');
    style.textContent = CSS;
    const root = document.createElement('div');
    root.className = 'sb';
    root.innerHTML = `<div class="sb-in"><h1>Sons do graao</h1>
      <p>Cada botão toca pelo mixer do jogo (mesmos volumes e variações). Clique de novo para ouvir outra variação.</p>
      <div class="sb-bar"><label><input type="checkbox" data-old> Ouvir o som antigo (sintetizado)</label>
      <label>Volume <input type="range" min="0" max="1" step="0.05" value="0.8" data-vol></label>
      <span class="sb-status" data-status>Banco: carregando…</span></div></div>`;
    const inner = root.firstElementChild as HTMLElement;
    for (const [title, items] of GROUPS) {
      const h = document.createElement('h2');
      h.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'sb-grid';
      for (const item of items) {
        const b = document.createElement('button');
        b.textContent = item.label;
        b.addEventListener('click', () => {
          this.audio.unlock();
          item.play(this.audio);
          b.classList.add('on');
          setTimeout(() => b.classList.remove('on'), 180);
        });
        grid.append(b);
      }
      inner.append(h, grid);
    }
    root.querySelector<HTMLInputElement>('[data-old]')!.addEventListener('change', (e) => {
      this.audio.useBank = !(e.target as HTMLInputElement).checked;
    });
    root.querySelector<HTMLInputElement>('[data-vol]')!.addEventListener('input', (e) => {
      this.audio.setVolume(Number((e.target as HTMLInputElement).value));
    });
    const status = root.querySelector<HTMLElement>('[data-status]')!;
    const tick = () => {
      const s = this.audio.bankStatus();
      status.textContent = this.audio.ready ? `Banco: ${s.decoded}/${s.total} sons prontos` : 'Banco: clique em qualquer som para ligar o áudio';
      if (s.decoded < s.total) setTimeout(tick, 300);
    };
    tick();
    this.host.append(style, root);
  }
}
