import { describe, expect, it } from 'vitest';
import { TraversalCap, type NavGraph, type NavLink, type NavPlan } from '@graao/game-core';
import { BOT_TRAVERSAL_RULES, TraversalMode } from '@graao/game-data';
import type { Vec3 } from '@graao/shared';
import { BotNavigator, type NavBell, type NavContext } from './BotNav';

/**
 * A tiny graph by hand (docs/world/VERTICAL_BOT_NAVIGATION.md): A at the foot of a face, B on top of it (4 m up), C a
 * long way round on foot. The face is a traversal link A → B; an updraft link A → B rides an event wind.
 */
const A: Vec3 = { x: 0, y: 100, z: 0 };
const B: Vec3 = { x: 0, y: 104, z: -3 };
const C: Vec3 = { x: 12, y: 100, z: 0 };
const GOAL: Vec3 = { x: 0, y: 104, z: -5 };
const FACE: NavLink = { id: 'face', kind: 'escalada', from: 0, to: 1, wind: -1, event: false, caps: TraversalCap.LEDGE | TraversalCap.CLIMB, stamina: 70, cost: 10, risk: 0.3 };
const DRAFT: NavLink = { id: 'draft', kind: 'corrente', from: 0, to: 1, wind: 3, event: true, caps: TraversalCap.GLIDE, stamina: 85, cost: 5, risk: 0.3 };

function fakeNav(): NavGraph & { plans: string[] } {
  const nodes = [A, B, C].map((pos) => ({ pos, up: { x: 0, y: 1, z: 0 }, h: Math.hypot(pos.x, pos.y, pos.z) - 100, water: false, raised: false, door: false }));
  const plans: string[] = [];
  const nav = {
    nodes,
    plans,
    links: [FACE, DRAFT],
    component: new Int32Array([0, 1, 0]),
    linkedComponent: new Int32Array([0, 0, 0]),
    nearest: (p: Vec3) => {
      let best = -1;
      let bd = 4;
      nodes.forEach((n, i) => {
        const d = Math.hypot(n.pos.x - p.x, n.pos.y - p.y, n.pos.z - p.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    },
    plan: (_from: Vec3, to: Vec3, q: { allow?: (l: NavLink) => boolean } = {}): NavPlan | null => {
      // The cheapest the filter allows: the updraft, then the face, then the long walk round.
      const link = [DRAFT, FACE].find((l) => q.allow?.(l));
      plans.push(link?.id ?? 'walk');
      if (link) return { points: [A, B, to], links: [null, link, null], nodes: [0, 1, -1] };
      return { points: [A, C, B, to], links: [null, null, null, null], nodes: [0, 2, 1, -1] };
    },
  };
  return nav as unknown as NavGraph & { plans: string[] };
}

const ctx = (o: Partial<NavContext> = {}): NavContext => ({ caps: TraversalCap.ALL, stamina: 100, grounded: true, traversal: TraversalMode.NONE, ...o });
const AIR = ctx({ grounded: false });
const CLIMBING = ctx({ grounded: false, traversal: TraversalMode.CLIMB });

describe('bot traversal links (BotNavigator)', () => {
  it('sets out on the face from its foot, climbs, and is done standing on top', () => {
    const nav = fakeNav();
    const bot = new BotNavigator();
    const s0 = bot.next(nav, A, GOAL, 0, ctx());
    expect(s0.link?.id).toBe('face');
    expect(s0.point).toEqual(B);
    expect(bot.linking).toBe(true);
    expect(bot.caps).toBe(TraversalCap.LEDGE | TraversalCap.CLIMB);
    // On the face: the navigator keeps the link (no replan while climbing).
    const s1 = bot.next(nav, { x: 0, y: 102, z: -0.6 }, GOAL, 1500, CLIMBING);
    expect(s1.link?.id).toBe('face');
    expect(s1.linkMs).toBe(1500);
    // Standing on top: done, walking on to the goal, the motor gets no traversal any more.
    const s2 = bot.next(nav, B, GOAL, 3000, ctx());
    expect(s2.link).toBeUndefined();
    expect(bot.linking).toBe(false);
    expect(bot.caps).toBe(0);
    expect(nav.plans).toEqual(['face']);
  });

  it('a jump short of the face lands back at its foot: a miss, tried again, not a failure', () => {
    const nav = fakeNav();
    const bot = new BotNavigator();
    bot.next(nav, A, GOAL, 0, ctx());
    bot.next(nav, { x: 0, y: 100.8, z: -0.3 }, GOAL, 300, AIR);
    const back = bot.next(nav, { x: 0.3, y: 100, z: 0.2 }, GOAL, 700, ctx());
    expect(back.link?.id).toBe('face');
    expect(bot.isBlocked('face', 700)).toBe(false);
    // Too many misses: then it counts as a failure.
    for (let k = 0; k < BOT_TRAVERSAL_RULES.retries; k++) {
      bot.next(nav, { x: 0, y: 100.8, z: -0.3 }, GOAL, 1000 + k * 500, AIR);
      bot.next(nav, { x: 0.3, y: 100, z: 0.2 }, GOAL, 1200 + k * 500, ctx());
    }
    expect(bot.linking).toBe(false);
    expect(nav.plans).toEqual(['face', 'face']);
  });

  it('rests at the foot until it has the stamina; the clock starts when it sets out', () => {
    const nav = fakeNav();
    const bot = new BotNavigator();
    const tired = bot.next(nav, A, GOAL, 0, ctx({ stamina: 40 }));
    expect(tired.rest).toBe(true);
    expect(tired.point).toEqual(A);
    // Twenty seconds of rest never time the link out.
    expect(bot.next(nav, A, GOAL, 20000, ctx({ stamina: 60 })).rest).toBe(true);
    const ready = bot.next(nav, A, GOAL, 21000, ctx({ stamina: 90 }));
    expect(ready.rest).toBeUndefined();
    expect(ready.linkMs).toBe(1000);
  });

  it('two failures in a row leave the link alone for a while: the bot walks the long way and does not loop', () => {
    const nav = fakeNav();
    const bot = new BotNavigator();
    const fallOff = (t: number) => {
      bot.next(nav, A, GOAL, t, ctx());
      bot.next(nav, { x: 0, y: 102, z: -0.6 }, GOAL, t + 500, CLIMBING);
      // Off the face and down somewhere else (6 m away): a failure.
      return bot.next(nav, { x: 6, y: 100, z: 1 }, GOAL, t + 1500, ctx());
    };
    const first = fallOff(0);
    expect(first.link).toBeUndefined();
    expect(bot.isBlocked('face', 2000)).toBe(false);
    fallOff(3000);
    expect(bot.isBlocked('face', 5000)).toBe(true);
    expect(nav.plans).toEqual(['face', 'face', 'walk']);
    // Planning again while it is blocked keeps the walk.
    const later = bot.next(nav, A, { x: 0, y: 104, z: -20 }, 9000, ctx());
    expect(later.link).toBeUndefined();
    expect(nav.plans.at(-1)).toBe('walk');
    // Long after, the face is worth a try again.
    expect(bot.isBlocked('face', 5000 + BOT_TRAVERSAL_RULES.blockFor * 1000)).toBe(false);
  });

  it('a link that takes too long fails', () => {
    const nav = fakeNav();
    const bot = new BotNavigator();
    bot.next(nav, A, GOAL, 0, ctx());
    const stuck = bot.next(nav, { x: 0, y: 101, z: -0.6 }, GOAL, 15000, CLIMBING);
    expect(stuck.link).toBeUndefined();
    expect(nav.plans).toEqual(['face', 'face']);
  });

  it('plans only what the bot can do: no traversal caps, no links; an event updraft only while its wind blows', () => {
    const nav = fakeNav();
    expect(new BotNavigator().next(nav, A, GOAL, 0, ctx({ caps: 0 })).link).toBeUndefined();
    expect(new BotNavigator().next(nav, A, GOAL, 0, ctx({ caps: TraversalCap.GLIDE })).link).toBeUndefined();
    expect(new BotNavigator().next(nav, A, GOAL, 0, ctx({ windOn: () => false })).link?.id).toBe('face');
    const riding = new BotNavigator();
    expect(riding.next(nav, A, GOAL, 0, ctx({ windOn: (w) => w === 3 })).link?.id).toBe('draft');
    expect(riding.caps).toBe(TraversalCap.GLIDE);
    // The wind falls silent before it set out: plan again (the face), no failure counted.
    expect(riding.next(nav, A, GOAL, 100, ctx({ windOn: () => false })).link).toBeUndefined();
    expect(riding.next(nav, A, GOAL, 150, ctx({ windOn: () => false })).link?.id).toBe('face');
    expect(nav.plans.slice(-2)).toEqual(['draft', 'face']);
    expect(riding.isBlocked('draft', 200)).toBe(false);
  });

  /** A bell hanging 2,2 m over the ground 2,2 m from the updraft's start: it wakes the updraft's event wind (3). */
  const BELL: NavBell = { id: 7, pos: { x: 2, y: 102.2, z: 1 }, winds: [3] };
  const UNDER_BELL: Vec3 = { x: 2, y: 100, z: 1 };

  it('an event updraft with a bell by its start: to the bell, rung, back to the start, then out on the link', () => {
    const nav = fakeNav();
    const bot = new BotNavigator();
    const silent = ctx({ windOn: () => false, bells: [BELL] });
    const blowing = ctx({ windOn: (w) => w === 3, bells: [BELL] });
    // Silent wind, but a bell that wakes it: the plan takes the updraft, and the bot first walks to the bell.
    const s0 = bot.next(nav, A, GOAL, 0, silent);
    expect(s0.link?.id).toBe('draft');
    expect(s0.stage).toBe('ring');
    expect(s0.ring).toBe(7);
    // It stands under the bell, at the start's level; no traversal while it walks there.
    expect(Math.hypot(s0.point!.x - UNDER_BELL.x, s0.point!.y - UNDER_BELL.y, s0.point!.z - UNDER_BELL.z)).toBeLessThan(0.1);
    expect(bot.caps).toBe(0);
    expect(bot.next(nav, UNDER_BELL, GOAL, 1200, silent).ring).toBe(7);
    // The room rang it (the wind blows): back to the start, no ring asked any more.
    const back = bot.next(nav, UNDER_BELL, GOAL, 1500, blowing);
    expect(back.stage).toBe('back');
    expect(back.ring).toBeUndefined();
    expect(back.point).toEqual(A);
    // At the start: out on the updraft, its clock starting there, the glider allowed.
    const out = bot.next(nav, A, GOAL, 2600, blowing);
    expect(out.link?.id).toBe('draft');
    expect(out.stage).toBeUndefined();
    expect(out.linkMs).toBe(0);
    expect(bot.caps).toBe(TraversalCap.GLIDE);
    expect(bot.next(nav, { x: 0, y: 101.5, z: -0.5 }, GOAL, 3600, ctx({ grounded: false, windOn: (w) => w === 3, bells: [BELL] })).linkMs).toBe(1000);
    expect(nav.plans).toEqual(['draft']);
  });

  it('a bell too far from the start is not planned for; one that never rings fails the link like any other try', () => {
    const nav = fakeNav();
    const far: NavBell = { ...BELL, pos: { x: 20, y: 102, z: 0 } };
    expect(new BotNavigator().next(nav, A, GOAL, 0, ctx({ windOn: () => false, bells: [far] })).link?.id).toBe('face');
    const bot = new BotNavigator();
    const silent = ctx({ windOn: () => false, bells: [BELL] });
    expect(bot.next(nav, A, GOAL, 0, silent).stage).toBe('ring');
    // Nine seconds and the wind still silent (the bell out of reach, or nobody let it ring): a failure, a new plan.
    const gaveUp = bot.next(nav, UNDER_BELL, GOAL, 9500, silent);
    expect(gaveUp.link).toBeUndefined();
    expect(gaveUp.stage).toBeUndefined();
    expect(bot.isBlocked('draft', 9500)).toBe(false);
    // The second failure in a row leaves the updraft alone: the bot climbs the face instead.
    expect(bot.next(nav, A, GOAL, 9600, silent).stage).toBe('ring');
    bot.next(nav, UNDER_BELL, GOAL, 19000, silent);
    expect(bot.isBlocked('draft', 19000)).toBe(true);
    expect(bot.next(nav, A, GOAL, 19100, silent).link?.id).toBe('face');
    expect(nav.plans.at(-1)).toBe('face');
    expect(BOT_TRAVERSAL_RULES.failLimit).toBe(2);
  });
});
