/**
 * A bot's way through the map: follows a path of the shared navigation graph (game-core nav.ts) toward its goal, one
 * point at a time, with the real character motor doing the walking (so houses, railings and water still stop it).
 * Replans when the goal moves, when the path runs out and when the bot stops making progress; jumps when it is stuck
 * against something low, then tries another way.
 *
 * Traversal links (docs/world/VERTICAL_BOT_NAVIGATION.md): a plan may use the map's links that this bot can do right
 * now (its traversal capabilities, the wind of an event updraft blowing, not given up on). While it takes one the
 * navigator does not replan; it waits at the start until the bot has the stamina, then watches how it ends: standing
 * at the end's level (or anywhere on foot from it) is done; back at the start is a miss (try again, a few times); any
 * other landing, or taking too long, is a failure. Two failures in a row leave the link alone for a while, so a bot
 * never loops up and down a route it cannot finish.
 *
 * A link on an event wind (a bell's updraft or corrente) is planned while that wind blows, or while a bell that wakes it
 * hangs by the link's start: there the bot walks to the bell, rings it (the room validates the ring like a person's),
 * walks back to the start and sets out.
 *
 * Walks fail too (an unrailed ramp walked off, a point it cannot get to): a walk the bot fell off (it stands well
 * under both ends) or gave up on costs more in its plans for a while, so the next plan tries another way.
 */
import { BOT_TRAVERSAL, BOT_TRAVERSAL_RULES, TraversalMode } from '@graao/game-data';
import type { NavGraph, NavLink } from '@graao/game-core';
import { v3dot, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';

/** A path point counts as reached this close (m, along the ground) when the bot is on its level. */
const REACH = 0.9;
const REPLAN_MS = 2500;
/** No progress toward the current point for this long: jump; twice as long: plan again around it. */
const STUCK_MS = 900;
/** Back within this of a link's start after a try: a miss, not a failure. */
const MISS_REACH = 3;
/** Standing this far under both ends of the walk it was on: the bot fell off it. */
const FELL = 1.8;
/** A walk it fell off or gave up on costs this much more (m) for this long (ms). */
const AVOID_COST = 60;
const AVOID_MS = 60000;
/** A bell this close to an event link's start (m) is rung on the way; the detour to it and back may take this long (ms). */
const BELL_DETOUR = 8;
const BELL_MS = 9000;

export interface NavStep {
  /** Where to steer now (a path point), or null: no path, head straight for the goal. */
  point: Vec3 | null;
  /** Stuck against something: a jump may get over it. */
  stuck: boolean;
  /** Points left on the path (0 when steering straight). */
  left: number;
  /** The traversal link being taken toward `point` (absent: walking). */
  link?: NavLink;
  /** Its start, how long ago the bot set out on it (ms), and whether it is still resting for stamina at the start. */
  linkFrom?: Vec3;
  linkMs?: number;
  rest?: boolean;
  /**
   * On the way to the bell that wakes the link's wind (`ring`: its id, rung by the room once in reach), or back from it
   * to the link's start: a plain walk to `point`, no traversal yet.
   */
  stage?: 'ring' | 'back';
  ring?: number;
}

/** A bell a bot may ring: its id, where it hangs, and the event winds it wakes (indices in physics.winds). */
export interface NavBell {
  id: number;
  pos: Vec3;
  winds: readonly number[];
}

/** What the bot can do and how it stands, for planning and following traversal links. */
export interface NavContext {
  /** TraversalCap bits the bot may use on links (0: it only walks). */
  caps: number;
  stamina: number;
  grounded: boolean;
  /** Its TraversalMode now. */
  traversal: number;
  /** Is this wind (index in physics.winds) blowing now? Only asked for event winds. */
  windOn?: (wind: number) => boolean;
  /** Bells it may ring to wake an event wind (none: it only takes an event link someone else's bell woke). */
  bells?: readonly NavBell[];
}

const WALK_ONLY: NavContext = { caps: 0, stamina: 0, grounded: true, traversal: TraversalMode.NONE };

export class BotNavigator {
  private path: Vec3[] = [];
  private links: (NavLink | null)[] = [];
  private nodes: number[] = [];
  private i = 0;
  private goal: Vec3 | null = null;
  private plannedAt = -Infinity;
  private progressAt = 0;
  private best = Infinity;
  /** Plans that failed in a row (no path): wait longer before the next try. */
  private misses = 0;
  /** The link under way: when the bot set out (−1: none), whether it has left the ground since, misses so far. */
  private linkSince = -1;
  private linkAir = false;
  private linkMisses = 0;
  /** The detour to a bell for the link under way: the bell (−1: none), whether it rang (heading back), since when. */
  private bell = -1;
  private bellBack = false;
  private bellSince = 0;
  /** Failures in a row per link id, and links left alone until a time (ms). */
  private readonly failures = new Map<string, number>();
  private readonly blocked = new Map<string, number>();
  /** Walks (`a>b` node ids) it fell off or gave up on, until a time (ms). */
  private readonly avoid = new Map<string, number>();
  /** When the room last stopped it at a high edge (ms). */
  private edgeAt = -Infinity;

  /** Drops the current path (a new kind of goal). A link under way is let go of too. */
  reset(): void {
    this.path = [];
    this.links = [];
    this.nodes = [];
    this.i = 0;
    this.goal = null;
    this.plannedAt = -Infinity;
    this.linkSince = -1;
  }

  /** Is the bot taking a traversal link now (the room keeps following it instead of fighting)? */
  get linking(): boolean {
    return this.linkSince >= 0 && !!this.links[this.i];
  }

  /** The TraversalCap bits the motor should allow the bot now: the link's under way (not on a bell's detour), else none. */
  get caps(): number {
    return this.linking && this.bell < 0 ? this.links[this.i]!.caps : 0;
  }

  /** Is a link left alone now (failed too often)? */
  isBlocked(id: string, now: number): boolean {
    return (this.blocked.get(id) ?? 0) > now;
  }

  /** Walks the bot is avoiding now (node ids `a>b`). */
  avoided(now: number): string[] {
    return [...this.avoid].filter(([, until]) => until > now).map(([k]) => k);
  }

  /**
   * The room stopped the bot at a high edge (a drop no walk takes): the walk toward the current point is avoided and,
   * at most once a second, a new plan from here goes another way.
   */
  edge(now: number): void {
    if (now - this.edgeAt < 1000) return;
    this.edgeAt = now;
    this.avoidWalk(now);
    this.plannedAt = -Infinity;
  }

  /** The walk toward the current point did not work: it costs more for a while. */
  private avoidWalk(now: number): void {
    const a = this.nodes[this.i - 1];
    const b = this.nodes[this.i];
    if (a === undefined || b === undefined || a < 0 || b < 0) return;
    this.avoid.set(`${a}>${b}`, now + AVOID_MS);
  }

  next(nav: NavGraph, pos: Vec3, goal: Vec3, now: number, ctx: NavContext = WALK_ONLY): NavStep {
    if (this.linking) return this.followLink(nav, pos, goal, now, ctx);
    const up = v3normalize(pos);
    const moved = !this.goal || dist(goal, this.goal) > 4;
    const due = now - this.plannedAt > REPLAN_MS * (1 + Math.min(this.misses, 4));
    // Close to the goal with the path walked: head straight for it (no plan back to the last node).
    const near = dist(pos, goal) < 3;
    const exhausted = this.i >= this.path.length;
    if (moved || (due && !near) || (exhausted && !near && now - this.plannedAt > 600)) this.plan(nav, pos, goal, now, ctx);
    if (!this.path.length) return { point: null, stuck: false, left: 0 };
    // Advance past every point already reached (on the same level); a link's end is reached by taking the link.
    while (this.i < this.path.length && !this.links[this.i]) {
      const p = this.path[this.i]!;
      const flat = v3projectOnPlane({ x: p.x - pos.x, y: p.y - pos.y, z: p.z - pos.z }, up);
      const h = v3dot({ x: p.x - pos.x, y: p.y - pos.y, z: p.z - pos.z }, up);
      if (Math.hypot(flat.x, flat.y, flat.z) < REACH && Math.abs(h) < 1.4) {
        this.i++;
        this.best = Infinity;
        this.progressAt = now;
      } else break;
    }
    if (this.i >= this.path.length) return { point: null, stuck: false, left: 0 };
    // Fell off the walk it was on (well under both ends, standing): that walk is avoided, and a new plan from here.
    if (ctx.grounded && this.i > 0 && !this.links[this.i]) {
      const h = v3dot(pos, up);
      const ends = Math.min(v3dot(this.path[this.i - 1]!, up), v3dot(this.path[this.i]!, up));
      if (h < ends - FELL) {
        this.avoidWalk(now);
        this.plan(nav, pos, goal, now, ctx);
        return this.walkStep();
      }
    }
    // At a link's start (the point before it was reached): set out on it.
    if (this.links[this.i]) {
      this.linkSince = now;
      this.linkAir = false;
      this.linkMisses = 0;
      this.bell = -1;
      return this.followLink(nav, pos, goal, now, ctx);
    }
    const p = this.path[this.i]!;
    const d = dist(p, pos);
    if (d < this.best - 0.25) {
      this.best = d;
      this.progressAt = now;
    }
    const stuckFor = now - this.progressAt;
    if (stuckFor > STUCK_MS * 2.5) {
      // Give the point up: that walk costs more for a while, and a plan from where the bot is (another way).
      this.avoidWalk(now);
      this.plan(nav, pos, goal, now, ctx);
      return { point: this.path[this.i] ?? null, stuck: true, left: this.path.length - this.i };
    }
    return { point: p, stuck: stuckFor > STUCK_MS, left: this.path.length - this.i };
  }

  /** One step along the link under way: rest, keep going, done, a miss or a failure. */
  private followLink(nav: NavGraph, pos: Vec3, goal: Vec3, now: number, ctx: NavContext): NavStep {
    const link = this.links[this.i]!;
    const to = this.path[this.i]!;
    const from = this.path[this.i - 1] ?? nav.nodes[link.from]!.pos;
    const rule = BOT_TRAVERSAL[link.kind];
    const up = v3normalize(pos);
    const flatTo = (p: Vec3) => {
      const f = v3projectOnPlane({ x: p.x - pos.x, y: p.y - pos.y, z: p.z - pos.z }, up);
      return Math.hypot(f.x, f.y, f.z);
    };
    if (link.event && !this.linkAir) {
      const blowing = ctx.windOn?.(link.wind) ?? false;
      if (!blowing && this.bell < 0) {
        // Silent before the bot got going: ring the bell that wakes it, when one hangs by the start; else plan again
        // (no failure: nothing was tried).
        const bell = this.bellFor(nav, link, ctx);
        if (!bell) {
          this.linkSince = -1;
          this.plan(nav, pos, goal, now, ctx);
          return this.walkStep();
        }
        this.bell = bell.id;
        this.bellBack = false;
        this.bellSince = now;
      }
      if (this.bell >= 0) {
        if (blowing) this.bellBack = true;
        const bell = ctx.bells?.find((b) => b.id === this.bell);
        // The bell would not ring in time (out of reach, or gone): a failure like any other.
        if (!bell || now - this.bellSince > BELL_MS) return this.failLink(nav, link, pos, goal, now, ctx);
        this.linkSince = now;
        // Rung and back at the start: out on the link (its clock starts here). Until then a plain walk.
        if (!this.bellBack || flatTo(from) >= REACH) {
          const point = this.bellBack ? from : footUnder(bell.pos, from);
          return { point, stuck: false, left: this.path.length - this.i, link, linkFrom: from, linkMs: 0, stage: this.bellBack ? 'back' : 'ring', ...(this.bellBack ? {} : { ring: bell.id }) };
        }
        this.bell = -1;
      }
    }
    const standing = ctx.grounded && ctx.traversal === TraversalMode.NONE;
    if (!standing) this.linkAir = true;
    const level = (p: Vec3) => Math.abs(v3dot({ x: p.x - pos.x, y: p.y - pos.y, z: p.z - pos.z }, up));
    if (standing && this.linkAir) {
      // Standing again after the try: at the end's level and there (or anywhere on foot from it) is done.
      const arrived = level(to) < 1.2 && (flatTo(to) < rule.reach || this.onFootFrom(nav, pos, link.to));
      if (arrived) {
        // Done: on along the rest of the plan (a fresh plan from where a glide or a pull-up left the bot, at an edge,
        // could start from a node under it).
        this.failures.delete(link.id);
        this.linkSince = -1;
        this.i++;
        this.best = Infinity;
        this.progressAt = now;
        this.plannedAt = now;
        return this.next(nav, pos, goal, now, ctx);
      }
      if (flatTo(from) < MISS_REACH && level(from) < 1.2 && ++this.linkMisses <= BOT_TRAVERSAL_RULES.retries) this.linkAir = false;
      else return this.failLink(nav, link, pos, goal, now, ctx);
    }
    // Resting at the start until there is stamina for it (the clock starts once it sets out).
    if (standing && !this.linkAir && ctx.stamina < link.stamina) {
      this.linkSince = now;
      return { point: from, stuck: false, left: this.path.length - this.i, link, linkFrom: from, linkMs: 0, rest: true };
    }
    if (now - this.linkSince > rule.timeout * 1000) return this.failLink(nav, link, pos, goal, now, ctx);
    return { point: to, stuck: false, left: this.path.length - this.i, link, linkFrom: from, linkMs: now - this.linkSince };
  }

  /** A bell that wakes the link's wind, hanging within BELL_DETOUR of its start (null: none, or none the bot may ring). */
  private bellFor(nav: NavGraph, link: NavLink, ctx: NavContext): NavBell | null {
    if (!link.event || !ctx.bells?.length) return null;
    const start = nav.nodes[link.from]!.pos;
    return ctx.bells.find((b) => b.winds.includes(link.wind) && dist(b.pos, start) < BELL_DETOUR) ?? null;
  }

  /** Does the node nearest `pos` share a walk component with `node` (the bot is somewhere it can walk to it from)? */
  private onFootFrom(nav: NavGraph, pos: Vec3, node: number): boolean {
    const here = nav.nearest(pos, 4);
    return here >= 0 && nav.component[here] === nav.component[node];
  }

  /** A link that did not work: counted, left alone after too many in a row, and a new plan from where the bot is. */
  private failLink(nav: NavGraph, link: NavLink, pos: Vec3, goal: Vec3, now: number, ctx: NavContext): NavStep {
    this.bell = -1;
    const n = (this.failures.get(link.id) ?? 0) + 1;
    this.failures.set(link.id, n);
    if (n >= BOT_TRAVERSAL_RULES.failLimit) {
      this.blocked.set(link.id, now + BOT_TRAVERSAL_RULES.blockFor * 1000);
      this.failures.delete(link.id);
    }
    this.linkSince = -1;
    this.plan(nav, pos, goal, now, ctx);
    return this.walkStep();
  }

  private walkStep(): NavStep {
    if (this.i >= this.path.length) return { point: null, stuck: false, left: 0 };
    return { point: this.path[this.i]!, stuck: false, left: this.path.length - this.i };
  }

  private plan(nav: NavGraph, pos: Vec3, goal: Vec3, now: number, ctx: NavContext): void {
    this.goal = { ...goal };
    this.plannedAt = now;
    this.progressAt = now;
    this.best = Infinity;
    this.linkSince = -1;
    this.bell = -1;
    const allow = ctx.caps
      ? (l: NavLink) => (l.caps & ~ctx.caps) === 0 && !this.isBlocked(l.id, now) && (!l.event || (ctx.windOn?.(l.wind) ?? false) || !!this.bellFor(nav, l, ctx))
      : undefined;
    for (const [k, until] of this.avoid) if (until <= now) this.avoid.delete(k);
    const extra = this.avoid.size ? (a: number, b: number) => (this.avoid.has(`${a}>${b}`) ? AVOID_COST : 0) : undefined;
    const plan = nav.plan(pos, goal, { allow, extra });
    if (!plan) {
      this.misses++;
      this.path = [];
      this.links = [];
      this.nodes = [];
      this.i = 0;
      return;
    }
    this.misses = 0;
    this.path = plan.points;
    this.links = plan.links;
    this.nodes = plan.nodes;
    // The first point is the node nearest the bot: skip it when the bot is already past it toward the second (never
    // into a link: its start has to be reached first).
    const path = plan.points;
    this.i = path.length > 1 && !plan.links[1] && dist(pos, path[1]!) < dist(path[0]!, path[1]!) ? 1 : 0;
  }
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** The point under `p` at the radius of `level` (where a bot stands to reach something hanging over it). */
function footUnder(p: Vec3, level: Vec3): Vec3 {
  const u = v3normalize(p);
  const r = Math.hypot(level.x, level.y, level.z);
  return { x: u.x * r, y: u.y * r, z: u.z * r };
}
