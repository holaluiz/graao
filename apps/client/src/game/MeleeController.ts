/**
 * Local punch timing (empty hands): turns the attack button into at most one punch per interval, alternating hands.
 * A PREDICTION so a punch feels instant; the server decides whether it lands (reach, direction, walls) and refuses
 * anything faster than the interval, so honest timing here is never refused there. Holding the button keeps punching.
 */
import { MELEE } from '@graao/game-data';

export interface PunchIntent {
  seq: number;
  /** 0 left (jab), 1 right (cross). */
  hand: number;
}

/** A click this early before the next punch is allowed still punches (buffer, ms). */
const CLICK_BUFFER_MS = 180;

export class MeleeController {
  /** Time between punches (ms): MELEE.intervalMs, shortened by Velocidade de Ataque (the server's own number, from SELF). */
  intervalMs: number = MELEE.intervalMs;
  private seq = 0;
  private hand = 1;
  private lastAt = -1e9;
  private clickAt = -1e9;

  /** performance.now() of the last punch (animation, aim pose). */
  get lastPunchAt(): number {
    return this.lastAt;
  }

  reset(): void {
    this.lastAt = -1e9;
    this.clickAt = -1e9;
  }

  update(now: number, pressed: boolean, held: boolean, canPunch: boolean): PunchIntent | null {
    if (pressed) this.clickAt = now;
    if (!canPunch) return null;
    const wants = held || now - this.clickAt < CLICK_BUFFER_MS;
    if (!wants || now - this.lastAt < this.intervalMs) return null;
    this.lastAt = now;
    this.clickAt = -1e9;
    this.hand ^= 1;
    this.seq = (this.seq + 1) & 0x7fffffff;
    return { seq: this.seq, hand: this.hand };
  }
}
