/**
 * Ability text for the Draft (cards, detail panel and diagram labels), generated only from the canonical catalog in
 * `@graao/game-data`. Every fact names the effect it comes from (`path`), so a test can hold the text against the
 * effects the authoritative system really runs.
 */
import { ABILITIES, BASIC_ABILITIES, ULTIMATE_ABILITIES, type AbilityCategory, type AbilityDefinition, type AbilityEffect, type AbilityId, type DebuffKind } from '@graao/game-data';

type AreaEffect = Extract<AbilityEffect, { kind: 'area' }>;

/** pt-BR number: at most two decimals, comma separator. */
export const num = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');
const sec = (n: number) => `${num(n)} s`;
const meters = (n: number) => `${num(n)} m`;
/** A fraction as a percentage (0.3 → "30%"). */
const pct = (fraction: number) => `${num(Math.round(fraction * 1000) / 10)}%`;

export const CATEGORY_ORDER: readonly AbilityCategory[] = ['mobility', 'control', 'defense', 'exploration', 'passive', 'ultimate'];

/** Category color is a second cue: every category also has its own glyph (viewBox −8..8) and name. */
export const CATEGORY_INFO: Record<AbilityCategory, { label: string; color: string; glyph: string }> = {
  mobility: { label: 'Mobilidade', color: '#62c4aa', glyph: '<path d="M-6-5 0 0-6 5M0-5 6 0 0 5"/>' },
  control: { label: 'Controle', color: '#ad90de', glyph: '<path d="M0 0c2 0 2-3 0-3-4 0-4 6 0 6 5 0 6-9 0-9"/>' },
  defense: { label: 'Defesa', color: '#76abe2', glyph: '<path d="M0-6 6-4V0Q6 5 0 7-6 5-6 0V-4Z"/>' },
  exploration: { label: 'Exploração', color: '#e8bd55', glyph: '<path d="M-7 0Q0-7 7 0 0 7-7 0Z"/><circle r="2"/>' },
  passive: { label: 'Passiva', color: '#adb39b', glyph: '<path d="M0 0C-2-4-7-4-7 0S-2 4 0 0 7-4 7 0 2 4 0 0Z"/>' },
  ultimate: { label: 'Supremo', color: '#f1915f', glyph: '<path d="M0-7 2 -2 7-2 3 1 5 6 0 3-5 6-3 1-7-2-2-2Z"/>' },
};

/** Labels for the catalog's own tags (every tag in the catalog needs one; `ultimate`/`passive` read from the kind). */
export const TAG_LABELS: Record<string, string> = {
  projectile: 'Projétil', reveal: 'Revelação', dash: 'Avanço', mobility: 'Mobilidade', area: 'Área', slow: 'Lentidão',
  defensive: 'Defesa', defense: 'Defesa', shield: 'Escudo', trap: 'Armadilha', root: 'Imobilização', knockback: 'Empurrão',
  heal: 'Cura', damage: 'Dano', wave: 'Onda', weapon: 'Armas', resources: 'Recursos', air: 'No ar', grapple: 'Gancho',
  slide: 'Deslize', glide: 'Planar', wall: 'Parede', cloud: 'Nuvem', vision: 'Visão', noSprint: 'Sem corrida',
  silence: 'Silêncio', barrier: 'Cobertura', frontShield: 'Escudo frontal', noFire: 'Sem disparar', cleanse: 'Purificação',
  resistance: 'Resistência', trails: 'Rastros', activity: 'Atividade', loot: 'Coleta', stealth: 'Discrição', flight: 'Voo',
  beacon: 'Farol', speed: 'Velocidade', portal: 'Portal', ultimate: 'Supremo', passive: 'Passiva',
};

const STATUS_NAMES: Record<DebuffKind, string> = { slow: 'lentidão', root: 'imobilização', silence: 'silêncio', noSprint: 'impedimento de corrida' };
const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items[0] ?? '');

export interface AbilityFact {
  /** Sentence for the detail panel. */
  text: string;
  /** Short form for the card. */
  short: string;
  /** Where the fact comes from: `effects[0].onHit[0]`, or `passive`. */
  path: string;
  kind: AbilityEffect['kind'] | 'passive';
}

function effectFacts(effects: readonly AbilityEffect[], base: string, area?: AreaEffect): AbilityFact[] {
  const out: AbilityFact[] = [];
  effects.forEach((e, i) => {
    const path = `${base}[${i}]`;
    const fact = (text: string, short = text) => out.push({ text, short, path, kind: e.kind });
    const pulsing = !!area && area.pulses > 1;
    switch (e.kind) {
      case 'damage':
        fact(`${num(e.amount)} de dano${area && area.edge < 1 ? ` no centro, ${num(e.amount * area.edge)} na borda` : ''}${pulsing ? ' por pulso' : ''}`, `${num(e.amount)} de dano`);
        break;
      case 'heal':
        if (pulsing) fact(`Recupera ${num(e.amount)} de Vida por pulso, até ${num(e.amount * area!.pulses)}`, `Cura até ${num(e.amount * area!.pulses)}`);
        else fact(`Recupera ${num(e.amount)} de Vida`, `Cura ${num(e.amount)}`);
        break;
      case 'shield':
        if (pulsing) fact(`Recupera ${num(e.amount)} de escudo por pulso, até ${num(e.amount * area!.pulses)}`, `Escudo até ${num(e.amount * area!.pulses)}`);
        else fact(`Recupera ${num(e.amount)} de escudo`, `Escudo ${num(e.amount)}`);
        break;
      case 'slow':
        fact(`Lentidão de ${pct(1 - e.factor)} por ${sec(e.duration)}`, `Lentidão de ${pct(1 - e.factor)}`);
        break;
      case 'dash':
        fact(`Avança ${meters(e.distance)} na direção em que você anda, em ${sec(e.duration)}`, `Avanço de ${meters(e.distance)}`);
        break;
      case 'knockback':
        fact(area ? 'Empurra para longe do centro e levanta quem for atingido' : 'Empurra e levanta quem for atingido', 'Empurrão');
        break;
      case 'temporaryShield':
        fact(`+${num(e.amount)} de escudo temporário por até ${sec(e.duration)}`, `+${num(e.amount)} de escudo · ${sec(e.duration)}`);
        break;
      case 'status':
        switch (e.status) {
          case 'slow': {
            const amount = pct(1 - (e.factor ?? 1));
            if (pulsing) fact(`Lentidão de ${amount} enquanto estiver na área (dura ${sec(e.duration)} ao sair)`, `Lentidão de ${amount}`);
            else fact(`Lentidão de ${amount} por ${sec(e.duration)}`, `Lentidão de ${amount}`);
            break;
          }
          case 'root': fact(`Imobiliza por ${sec(e.duration)}`, `Imobiliza por ${sec(e.duration)}`); break;
          case 'silence': fact(`Silencia magias e interrompe conjurações por ${sec(e.duration)}`, `Silêncio de ${sec(e.duration)}`); break;
          case 'noSprint': fact(`Impede de correr por ${sec(e.duration)}`, `Sem correr por ${sec(e.duration)}`); break;
          case 'speed': fact(`+${pct((e.factor ?? 1) - 1)} de velocidade por ${sec(e.duration)}`, `+${pct((e.factor ?? 1) - 1)} de velocidade`); break;
        }
        break;
      case 'cleanse':
        fact(`Remove ${list(e.statuses.map((s) => STATUS_NAMES[s]))}`, 'Remove efeitos negativos');
        fact(`Novas aplicações desses efeitos duram ${pct(e.resistance)} menos por ${sec(e.duration)}`, `Resistência por ${sec(e.duration)}`);
        break;
      case 'mobility':
        switch (e.mode) {
          case 'jump':
            fact(`Um salto extra enquanto estiver no ar${e.lift !== undefined ? ` (impulso de ${num(e.lift)} m/s)` : ''}`, 'Salto extra no ar');
            break;
          case 'grapple':
            fact(`Prende uma corda numa superfície a até ${meters(e.surfaceRange ?? e.distance ?? 0)} e puxa você`, `Gancho até ${meters(e.surfaceRange ?? e.distance ?? 0)}`);
            if (e.speed !== undefined && e.duration !== undefined) fact(`Puxão a ${num(e.speed)} m/s por até ${sec(e.duration)}`);
            break;
          case 'slide':
            fact(`Desliza ${meters(e.distance ?? 0)} rente ao chão em ${sec(e.duration ?? 0)}`, `Deslize de ${meters(e.distance ?? 0)}`);
            break;
          case 'glide':
            fact(`Plana por até ${sec(e.duration ?? 0)}`, `Plana por ${sec(e.duration ?? 0)}`);
            if (e.gravityFactor !== undefined) fact(`Cai ${pct(1 - e.gravityFactor)} mais devagar`);
            if (e.airControl !== undefined) fact(`+${pct(e.airControl - 1)} de controle no ar`);
            break;
          case 'ricochet':
            fact(`Precisa de uma parede a até ${meters(e.surfaceRange ?? 0)}`, 'Impulso na parede');
            if (e.speed !== undefined) fact(`Lança você a ${num(e.speed)} m/s para longe dela`);
            break;
          case 'flight':
            fact(`Voa por até ${sec(e.duration ?? 0)}${e.speed !== undefined ? ` a ${num(e.speed)} m/s` : ''}`, `Voo de ${sec(e.duration ?? 0)}`);
            fact('Não dispara enquanto voa');
            break;
        }
        break;
      case 'barrier':
        fact(`${e.count} ${e.count > 1 ? 'coberturas destrutíveis' : 'cobertura destrutível'} com ${num(e.health)} de resistência${e.count > 1 ? ' cada' : ''}`,
          `${e.count} cobertura${e.count > 1 ? 's' : ''} de ${num(e.health)}`);
        fact(`${meters(e.width)} de largura e ${meters(e.height)} de altura · até ${sec(e.duration)}`);
        break;
      case 'reveal':
        switch (e.mode) {
          // `radius` does not bound a target reveal (the first hit is tracked), so it is not shown.
          case 'target': fact(`Revela a posição do primeiro adversário atingido por ${sec(e.duration)}`, `Revela o alvo por ${sec(e.duration)}`); break;
          case 'resources':
            fact(`Mostra baús fechados e itens a até ${meters(e.radius)} por ${sec(e.duration)}`, `Acha baús a ${meters(e.radius)}`);
            fact('Não revela adversários');
            break;
          case 'trails':
            fact(`Mostra rastros reais dos últimos ${sec(e.history ?? 0)} a até ${meters(e.radius)}`, `Rastros de ${sec(e.history ?? 0)}`);
            fact(`Os rastros ficam visíveis por ${sec(e.duration)}`);
            break;
          case 'activity':
            fact(`Indica a direção de quem atirou ou usou magia nos últimos ${sec(e.history ?? 0)}, a até ${meters(e.radius)}`, 'Direção de quem agiu');
            fact(`A indicação dura ${sec(e.duration)}`);
            break;
          case 'beacon':
            fact(`Farol destrutível com ${num(e.health ?? 0)} de resistência por ${sec(e.duration)}`, `Farol de ${meters(e.radius)}`);
            fact(`Indica adversários a até ${meters(e.radius)} a cada ${sec(e.interval ?? 1)}`);
            break;
        }
        break;
      case 'trap': {
        const nested = effectFacts(e.effects, `${path}.effects`);
        fact(`Armadilha visível de ${meters(e.radius)} de raio, ativa por até ${sec(e.duration)}`, `Armadilha de ${meters(e.radius)}`);
        out.push(...nested);
        break;
      }
      case 'cloud':
        fact(`Nuvem opaca de ${meters(e.radius)} de raio bloqueia a visão por ${sec(e.duration)}`, `Bloqueia a visão por ${sec(e.duration)}`);
        break;
      case 'wave':
        fact(`Onda de ${meters(e.width)} de largura percorre até ${meters(e.distance)} pela superfície em ${sec(e.duration)}`, `Onda de ${meters(e.distance)}`);
        fact('Empurra e levanta quem estiver no caminho');
        break;
      case 'portal':
        fact(`Dois portais por ${sec(e.duration)}, com até ${meters(e.range)} entre as pontas`, `Portais a ${meters(e.range)}`);
        fact(`Só você atravessa · ${sec(e.reentry)} entre travessias`);
        break;
      case 'frontShield':
        fact(`Bloqueia disparos num arco frontal de ${num(e.arc)}° por até ${sec(e.duration)}`, `Bloqueia disparos por ${sec(e.duration)}`);
        fact('Não dispara enquanto protege');
        break;
      case 'projectile': {
        const nested = effectFacts(e.onHit, `${path}.onHit`);
        fact(`Disparo visível a ${num(e.speed)} m/s, alcance de ${meters(e.speed * e.lifetime)}`, `Disparo de ${meters(e.speed * e.lifetime)}`);
        out.push(...nested);
        break;
      }
      case 'area': {
        const nested = effectFacts(e.effects, `${path}.effects`, e);
        const where = e.target === 'self' ? ' · afeta só você' : e.follow ? ' ao seu redor' : '';
        fact(`Área de ${meters(e.radius)} de raio${where}${e.delay > 0 ? ` · aviso de ${sec(e.delay)}` : ''}`, `Área de ${meters(e.radius)}`);
        if (e.pulses > 1) fact(`${e.pulses} pulsos em ${sec((e.pulses - 1) * e.interval)}`);
        out.push(...nested);
        break;
      }
    }
  });
  return out;
}

function passiveFacts(def: AbilityDefinition): AbilityFact[] {
  const p = def.passive;
  if (!p) return [];
  const fact = (text: string, short = text): AbilityFact => ({ text, short, path: 'passive', kind: 'passive' });
  switch (p.type) {
    case 'outOfCombatSpeed': return [fact(`+${pct(p.factor - 1)} de velocidade de corrida após ${sec(p.delay ?? 0)} sem atirar nem sofrer dano`, `+${pct(p.factor - 1)} de corrida`)];
    case 'weaponHandling': return [fact(`${pct(1 - p.factor)} menos recuo e dispersão nas armas`, `−${pct(1 - p.factor)} de recuo`)];
    case 'weaponSwap': return [fact(`Troca de arma ${pct(1 - p.factor)} mais rápida, respeitando o tempo mínimo de equipar`, `Troca ${pct(1 - p.factor)} mais rápida`)];
    case 'scavenger': return [
      fact(`Coleta itens com ${pct(p.factor - 1)} mais alcance`, `+${pct(p.bonus ?? 0)} de munição`),
      fact(`+${pct(p.bonus ?? 0)} de munição ao coletar`),
    ];
    case 'quietSteps': return [fact(`Seus passos soam ${pct(1 - p.factor)} mais baixos para os outros`, `Passos ${pct(1 - p.factor)} mais baixos`)];
    case 'shieldRegen': return [
      fact(`Após ${sec(p.delay ?? 0)} fora de combate, regenera ${num(p.factor)} de escudo por segundo`, `Regenera escudo até ${pct(p.ceiling ?? 0.5)}`),
      fact(`Até ${pct(p.ceiling ?? 0.5)} do escudo máximo`),
    ];
    // `bonus` (fall consequences) has no consumer in the simulation, so it is not promised here.
    case 'airControl': return [fact(`+${pct(p.factor - 1)} de controle de movimento no ar`, `+${pct(p.factor - 1)} de controle no ar`)];
    case 'debuffResistance': return [fact(`Lentidões e silenciamentos duram ${pct(p.factor)} menos em você`, `−${pct(p.factor)} em lentidões`)];
  }
}

/** Every fact the Draft can show for an ability, in catalog order. */
export function abilityFacts(def: AbilityDefinition): AbilityFact[] {
  return def.kind === 'passive' ? passiveFacts(def) : effectFacts(def.effects, 'effects');
}

const WRAPPERS = new Set<AbilityFact['kind']>(['projectile', 'area', 'trap']);
const lower = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

/** Short line for one top-level effect: what lands on the target, framed by its delivery (area, trap). */
function leadOf(def: AbilityDefinition, facts: AbilityFact[], top: number): string | undefined {
  const root = `effects[${top}]`;
  const group = facts.filter((f) => f.path === root || f.path.startsWith(`${root}.`));
  const leaf = group.find((f) => !WRAPPERS.has(f.kind));
  const wrapper = def.effects[top];
  if (!leaf) return group[0]?.short;
  if (wrapper?.kind === 'area' && wrapper.target !== 'self') return `${leaf.short} em área`;
  if (wrapper?.kind === 'trap') return `Armadilha: ${lower(leaf.short)}`;
  return leaf.short;
}

/** The card's one-line effect summary. */
export function abilityHeadline(def: AbilityDefinition): string {
  const facts = abilityFacts(def);
  if (def.kind === 'passive') return facts[0]?.short ?? '';
  // Composite abilities read best as their two leading effects (Jardim: heal + covers, Roda: cleanse + speed).
  const lead = leadOf(def, facts, 0) ?? '';
  const second = def.effects.length > 1 ? leadOf(def, facts, 1) : undefined;
  return second ? `${lead} · ${lower(second)}` : lead;
}

/** Longest lasting effect window (s), 0 for instantaneous abilities. Areas count the span of their pulses. */
export function abilityDuration(def: AbilityDefinition): number {
  const longest = (effects: readonly AbilityEffect[]): number => effects.reduce((max, e) => {
    switch (e.kind) {
      case 'area': return Math.max(max, e.pulses > 1 ? (e.pulses - 1) * e.interval : longest(e.effects));
      case 'projectile': return Math.max(max, longest(e.onHit));
      case 'trap': case 'temporaryShield': case 'status': case 'slow': case 'cloud': case 'barrier': case 'portal':
      case 'frontShield': case 'reveal': case 'wave': case 'cleanse':
        return Math.max(max, e.duration);
      case 'mobility': return e.mode === 'jump' ? max : Math.max(max, e.duration ?? 0);
      default: return max;
    }
  }, 0);
  const d = longest(def.effects);
  return d >= 0.5 ? d : 0;
}

export interface AbilityStat { key: 'mana' | 'cooldown' | 'range' | 'duration' | 'cast'; label: string; value: string }

/** Numbers of the stat block, straight from the definition. */
export function abilityStats(def: AbilityDefinition): AbilityStat[] {
  const passive = def.kind === 'passive';
  const duration = abilityDuration(def);
  return [
    { key: 'mana', label: 'MANA', value: passive ? 'Sem custo' : num(def.manaCost) },
    { key: 'cooldown', label: 'RECARGA', value: passive ? 'Automática' : sec(def.cooldown) },
    { key: 'range', label: 'ALCANCE', value: def.targetType === 'none' ? '—' : def.targetType === 'self' ? 'Em você' : meters(def.range) },
    { key: 'duration', label: 'DURAÇÃO', value: passive ? 'Sempre ativa' : duration ? sec(duration) : 'Instantânea' },
    { key: 'cast', label: 'CONJURAÇÃO', value: passive ? '—' : def.castTime > 0 ? sec(def.castTime) : 'Imediata' },
  ];
}

/** Catalog tags as labels (kind tags excluded: the card already names the kind). */
export function abilityTagLabels(def: AbilityDefinition): string[] {
  return [...new Set(def.tags.filter((t) => t !== 'ultimate' && t !== 'passive').map((t) => TAG_LABELS[t] ?? t))];
}

export const kindLabel = (def: AbilityDefinition): string => (def.kind === 'passive' ? 'PASSIVA' : def.slotType === 'ultimate' ? 'SUPREMO' : 'ATIVA');

const byCategory = (ids: readonly AbilityId[]) => [...ids].sort((a, b) => CATEGORY_ORDER.indexOf(ABILITIES[a].category) - CATEGORY_ORDER.indexOf(ABILITIES[b].category));

/** The two grids of the Draft: all 30 basics (grouped by category, catalog order inside) and all 10 Ultimates. */
export function draftCatalogSections(): { basic: AbilityId[]; ultimate: AbilityId[] } {
  return { basic: byCategory(BASIC_ABILITIES), ultimate: [...ULTIMATE_ABILITIES] };
}
