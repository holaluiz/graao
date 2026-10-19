/**
 * A bot's way through the map: follows a path of the shared navigation graph (game-core nav.ts) toward its goal, one
 * point at a time, with the real character motor doing the walking (so houses, railings and water still stop it).
 * Replans when the goal moves, when the path runs out and when the bot stops making progress; jumps when it is stuck
 * against something low, then tries another way.
 */
import type { NavGraph } from '@graao/game-core';
import { v3dot, v3normalize, v3projectOnPlane, type Vec3 } from '@graao/shared';

/** A path point counts as reached this close (m, along the ground) when the bot is on its level. */
const REACH = 0.9;
const REPLAN_MS = 2500;
/** No progress toward the current point for this long: jump; twice as long: plan again around it. */
const STUCK_MS = 900;

export interface NavStep {
  /** Where to steer now (a path point), or null: no path, head straight for the goal. */
  point: Vec3 | null;
  /** Stuck against something: a jump may get over it. */
  stuck: boolean;
  /** Points left on the path (0 when steering straight). */
  left: number;
}

export class BotNavigator {
  private path: Vec3[] = [];
  private i = 0;
  private goal: Vec3 | null = null;
  private plannedAt = -Infinity;
  private progressAt = 0;
  private best = Infinity;
  /** Plans that failed in a row (no path): wait longer before the next try. */
  private misses = 0;

  /** Drops the current path (a new kind of goal). */
  reset(): void {
    this.path = [];
    this.i = 0;
    this.goal = null;
    this.plannedAt = -Infinity;
  }

  next(nav: NavGraph, pos: Vec3, goal: Vec3, now: number): NavStep {
    const up = v3normalize(pos);
    const moved = !this.goal || dist(goal, this.goal) > 4;
    const due = now - this.plannedAt > REPLAN_MS * (1 + Math.min(this.misses, 4));
    // Close to the goal with the path walked: head straight for it (no plan back to the last node).
    const near = dist(pos, goal) < 3;
    const exhausted = this.i >= this.path.length;
    if (moved || (due && !near) || (exhausted && !near && now - this.plannedAt > 600)) this.plan(nav, pos, goal, now);
    if (!this.path.length) return { point: null, stuck: false, left: 0 };
    // Advance past every point already reached (on the same level).
    while (this.i < this.path.length) {
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
    const p = this.path[this.i]!;
    const d = dist(p, pos);
    if (d < this.best - 0.25) {
      this.best = d;
      this.progressAt = now;
    }
    const stuckFor = now - this.progressAt;
    if (stuckFor > STUCK_MS * 2.5) {
      // Give the point up: plan again from where the bot is (the graph may know another way).
      this.plan(nav, pos, goal, now);
      return { point: this.path[this.i] ?? null, stuck: true, left: this.path.length - this.i };
    }
    return { point: p, stuck: stuckFor > STUCK_MS, left: this.path.length - this.i };
  }

  private plan(nav: NavGraph, pos: Vec3, goal: Vec3, now: number): void {
    this.goal = { ...goal };
    this.plannedAt = now;
    this.progressAt = now;
    this.best = Infinity;
    const path = nav.path(pos, goal);
    if (!path) {
      this.misses++;
      this.path = [];
      this.i = 0;
      return;
    }
    this.misses = 0;
    this.path = path;
    // The first point is the node nearest the bot: skip it when the bot is already past it toward the second.
    this.i = path.length > 1 && dist(pos, path[1]!) < dist(path[0]!, path[1]!) ? 1 : 0;
  }
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
