/**
 * Plays one real match on a Graao Host room through its endpoint (loopback or the public tunnel) and reports what the
 * server ran: lobby → Ability Draft → preparation → UFO (jump) → landing → match with bots shooting, chests and the
 * Tormenta. The people are test clients standing still (they send real 60 Hz input commands); the bots are the
 * host's. Used by the automated E2E test and by hand:
 *
 *   pnpm exec tsx tools/hosting/gameplay-smoke.ts --url wss://<host> --code GR-XXXX --key <owner key> [--guests 1] [--bots 8]
 */
import { Client, type Room } from '@colyseus/sdk';
import { DEFAULT_APPEARANCE, randomAppearance } from '@graao/game-data';
import { northTangent } from '@graao/game-core';
import {
  AIM_SCALE,
  C2S,
  CLIENT_VERSION,
  DeployState,
  MatchPhase,
  POS_SCALE,
  PROTOCOL_VERSION,
  S2C,
  SIM_HZ,
  v3normalize,
  type DraftStateMsg,
  type EventsMsg,
  type InputCmd,
  type LootStateMsg,
  type RoomStateMsg,
  type SnapshotMsg,
} from '@graao/shared';

export interface GameplayReport {
  ok: boolean;
  phases: string[];
  draftRounds: number;
  loadout: string[];
  chests: number;
  shots: number;
  damage: number;
  eliminations: number;
  /** Match start → first weapon shot seen (ms); -1 when nobody fired. Everyone lands unarmed, so this includes looting. */
  firstShotMs: number;
  tormenta: boolean;
  participants: number;
  bots: number;
  matchMs: number;
  totalMs: number;
}

const PHASE_NAME: Record<number, string> = { 0: 'LOBBY', 1: 'ABILITY_DRAFT', 2: 'UFO', 3: 'MATCH', 4: 'RESULTS', 5: 'PREPARATION', 6: 'CLOSED', 9: 'FREE_ROAM' };

interface Seat {
  room: Room;
  index: number;
  pos: { x: number; y: number; z: number };
  state: RoomStateMsg | null;
  seq: number;
  sent: number;
}

export async function runGameplaySmoke(o: { url: string; code: string; ownerKey: string; guests?: number; bots?: number; fightMs?: number; timeoutMs?: number; log?: (s: string) => void }): Promise<GameplayReport> {
  const log = o.log ?? (() => {});
  const t0 = Date.now();
  const report: GameplayReport = { ok: false, phases: [], draftRounds: 0, loadout: [], chests: 0, shots: 0, damage: 0, eliminations: 0, firstShotMs: -1, tormenta: false, participants: 0, bots: 0, matchMs: 0, totalMs: 0 };
  const join = (name: string, extra: Record<string, unknown> = {}) =>
    new Client(o.url).joinById(o.code, { protocol: PROTOCOL_VERSION, client: `smoke/${CLIENT_VERSION}`, name, appearance: name === 'Host' ? DEFAULT_APPEARANCE : randomAppearance(), ...extra });

  const seats: Seat[] = [];
  const rooms = [await join('Host', { hostKey: o.ownerKey })];
  for (let g = 0; g < (o.guests ?? 0); g++) rooms.push(await join(`Convidado ${g + 1}`));
  let matchAt = 0;

  for (const room of rooms) {
    const seat: Seat = { room, index: -1, pos: { x: 0, y: 100, z: 0 }, state: null, seq: 1, sent: 0 };
    seats.push(seat);
    room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => {
      seat.state = m;
      seat.index = m.players.find((p) => p.sessionId === room.sessionId)?.index ?? seat.index;
      if (seat === seats[0]) {
        const name = PHASE_NAME[m.phase] ?? String(m.phase);
        if (report.phases.at(-1) !== name) {
          report.phases.push(name);
          log(`fase: ${name}`);
          if (m.phase === MatchPhase.MATCH) matchAt = Date.now();
        }
        if (m.tormenta) report.tormenta = true;
        // The largest roster seen in the match (players leaving at the end must not shrink it).
        if (m.phase === MatchPhase.MATCH) report.participants = Math.max(report.participants, m.players.filter((p) => p.inMatch).length);
        report.bots = Math.max(report.bots, m.players.filter((p) => p.bot).length);
        const me = m.players.find((p) => p.index === seat.index);
        if (me?.loadout?.length) report.loadout = [...me.loadout];
      }
      if (m.preparation && m.phase === MatchPhase.PREPARATION && !m.preparation.ready.includes(seat.index)) room.send(C2S.PREPARED, { id: m.preparation.id, ok: true });
      const me = m.players.find((p) => p.index === seat.index);
      if (m.ufo && me?.deploy === DeployState.SHIP) {
        // Jump as soon as the hatch is open (server time ≈ local time is enough here; retried on each state).
        setTimeout(() => room.send(C2S.UFO_JUMP, {}), Math.max(0, m.ufo.open - Date.now() + 300));
      }
    });
    room.onMessage(S2C.DRAFT_STATE, (m: DraftStateMsg) => {
      const mine = m.seats.find((x) => x.index === seat.index);
      if (seat === seats[0]) report.draftRounds = Math.max(report.draftRounds, Math.min(m.round + (m.stage === 'reveal' ? 1 : 0), m.rounds));
      if (m.stage !== 'pick' || !mine?.picking || m.mine) return;
      const owned = new Map(m.owners);
      const free = m.pool.filter((id) => !mine.picks.includes(id) && !(m.unique && owned.has(id)));
      if (free[0]) room.send(C2S.DRAFT_PICK, { r: m.round, a: free[(seat.index + m.round) % free.length] });
    });
    room.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
      const me = m.p.find((p) => p[0] === seat.index);
      if (me) seat.pos = { x: me[1]! / POS_SCALE, y: me[2]! / POS_SCALE, z: me[3]! / POS_SCALE };
    });
    room.onMessage(S2C.EVENTS, (m: EventsMsg) => {
      if (seat !== seats[0]) return;
      for (const e of m.ev) {
        if (e.e === 'shot') {
          report.shots++;
          if (report.firstShotMs < 0 && matchAt) report.firstShotMs = Date.now() - matchAt;
        }
        else if (e.e === 'dmg') report.damage++;
        else if (e.e === 'elim') report.eliminations++;
      }
    });
    room.onMessage(S2C.LOOT_STATE, (m: LootStateMsg) => {
      if (seat === seats[0]) report.chests = Math.max(report.chests, m.chests.length);
    });
    for (const t of [S2C.WELCOME, S2C.PONG, S2C.SELF, S2C.ABILITY_RESULT, S2C.NOTICE, S2C.MATCH_SUMMARY, S2C.LOOT_RESULT]) room.onMessage(t, () => {});
  }

  // Real-time input stream (standing still, looking north), like a browser client: exactly SIM_HZ per second.
  const inputStart = Date.now();
  const inputs = setInterval(() => {
    for (const s of seats) {
      const phase = s.state?.phase;
      if (phase !== MatchPhase.UFO && phase !== MatchPhase.MATCH) continue;
      const due = Math.min(10, Math.floor(((Date.now() - inputStart) / 1000) * SIM_HZ) - s.sent);
      s.sent += Math.max(0, due);
      const aim = northTangent(v3normalize(s.pos));
      const cmds: InputCmd[] = [];
      for (let k = 0; k < due; k++) cmds.push([s.seq++, 0, 0, 0, Math.round(aim.x * AIM_SCALE), Math.round(aim.y * AIM_SCALE), Math.round(aim.z * AIM_SCALE), 0]);
      if (cmds.length) s.room.send(C2S.PLAYER_INPUT, { i: cmds });
    }
  }, 1000 / 30);

  const until = async (pred: () => boolean, ms: number, what: string) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`tempo esgotado esperando ${what} (fases: ${report.phases.join(' → ')})`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  try {
    const host = seats[0]!;
    host.room.send(C2S.ROOM_SETTINGS, { bots: o.bots ?? 8 });
    await until(() => host.state?.phase === MatchPhase.LOBBY && host.index >= 0, 10000, 'o lobby');
    // Everyone presses "Estou pronto"; only then may the host start the Draft.
    for (const s of seats) s.room.send(C2S.READY, { r: 1 });
    await until(() => !!host.state?.room?.canStart, 10000, `a sala poder começar (${host.state?.room?.startReason ?? ''})`);
    host.room.send(C2S.START_MATCH, {});
    await until(() => host.state?.phase === MatchPhase.MATCH, o.timeoutMs ?? 120000, 'a partida');
    // Everyone lands unarmed: bots fire once they have looted a weapon, which some matches take longer than the window
    // to do. With bots, wait for the first shot and hit (bounded) instead of guessing a fixed time.
    const fightMs = o.fightMs ?? 15000;
    const wantFight = (o.bots ?? 8) > 0;
    await until(() => (Date.now() - matchAt > fightMs && (!wantFight || (report.shots > 0 && report.damage > 0))) || report.eliminations > 0, fightMs + 45000, 'o combate (primeiro tiro com dano dos bots)');
    report.matchMs = Date.now() - matchAt;
    // People here stand still: only bots shoot. Without bots the match must still run (draft, chests, Tormenta).
    const fought = (o.bots ?? 8) === 0 || (report.shots > 0 && report.damage > 0 && report.bots > 0);
    report.ok = report.draftRounds >= 4 && report.chests > 0 && report.tormenta && fought;
  } finally {
    clearInterval(inputs);
    report.totalMs = Date.now() - t0;
    await Promise.all(seats.map((s) => s.room.leave(true).catch(() => {})));
  }
  return report;
}

if (process.argv[1] && /gameplay-smoke\.ts$/.test(process.argv[1])) {
  const arg = (n: string, d = '') => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1]! : d;
  };
  const r = await runGameplaySmoke({ url: arg('url'), code: arg('code'), ownerKey: arg('key'), guests: Number(arg('guests', '0')), bots: Number(arg('bots', '8')), log: (s) => console.log(`[smoke] ${s}`) });
  console.log(JSON.stringify(r));
  process.exitCode = r.ok ? 0 : 1;
  setTimeout(() => process.exit(), 300).unref();
}
