/**
 * Network test bot: joins (or creates) a graao room and runs patterns with real input commands, like a player.
 *   pnpm bot -- --code GR-7K2M [--name Bot] [--pattern circle|zigzag|idle|jumpy] [--url ws://localhost:2567] [--seconds 120]
 *   pnpm bot -- --create        (prints the new room code)
 * Match flow: --ready marks the bot READY as soon as someone else is; in the Ability Draft it picks a random free
 * ability after a short think (--pick sun_orb,wind_step,... tries those first, round by round: handy to force a
 * conflict with a human); --idle-draft never picks (the server chooses for it when time runs out).
 * UFO: --jump 2 leaves the ship 2 s after the hatch opens (without it the bot rides until it is dropped at the close).
 * Results: --lobby 3 asks to go back to the lobby 3 s after a match ends (without it the room waits for its timer).
 * Tormenta: --pattern tormenta walks to the region the Tormenta closes onto (and circles inside it).
 * Dev rooms: --create --opts '{"skipUfo":true,"tormentaPhases":[...]}' passes room options (a dev server honors the
 *   dev-only ones, see RoomCreateOptions).
 */
import { Client } from '@colyseus/sdk';
import { randomAppearance } from '@graao/game-data';
import { northTangent, tormentaEdgeMeters, tormentaTarget } from '@graao/game-core';
import {
  AIM_SCALE,
  C2S,
  CLIENT_VERSION,
  InputButton,
  MatchPhase,
  POS_SCALE,
  PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  SIM_HZ,
  WISH_SCALE,
  v3cross,
  v3normalize,
  v3rotateAxis,
  type DraftStateMsg,
  type InputCmd,
  type MatchSummaryMsg,
  type RoomStateMsg,
  type TormentaMsg,
  type UfoRouteMsg,
  type SnapshotMsg,
  type WelcomeMsg,
} from '@graao/shared';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d;
};
const url = arg('url', 'ws://localhost:2567');
const name = arg('name', 'Bot');
const pattern = arg('pattern', 'circle');
const seconds = Number(arg('seconds', '120'));

const client = new Client(url);
const options = { protocol: PROTOCOL_VERSION, client: `bot/${CLIENT_VERSION}`, name, appearance: randomAppearance() };
let roomOptions: Record<string, unknown> = {};
try {
  roomOptions = JSON.parse(arg('opts', '{}')) as Record<string, unknown>;
} catch {
  console.warn('[bot] --opts is not JSON, ignored');
}
const room = args.includes('--create') ? await client.create(ROOM_NAME, { maxPlayers: Number(arg('max', '4')), ...roomOptions, ...options }) : await client.joinById(arg('code', ''), options);

let index = -1;
let pos = { x: 0, y: 100, z: 0 };
room.onMessage(S2C.WELCOME, (m: WelcomeMsg) => {
  index = m.index;
  console.log(`[bot] in room ${m.code} as #${index} (${name}, ${pattern})`);
});
room.onMessage(S2C.SNAPSHOT, (m: SnapshotMsg) => {
  const me = m.p.find((p) => p[0] === index);
  if (me) pos = { x: me[1] / POS_SCALE, y: me[2] / POS_SCALE, z: me[3] / POS_SCALE };
});
const autoReady = args.includes('--ready');
const idleDraft = args.includes('--idle-draft');
const wanted = arg('pick', '').split(',').filter(Boolean);
let ready = false;
const jumpAfter = args.includes('--jump') ? Number(arg('jump', '2')) : -1;
let jumpRoute: UfoRouteMsg | null = null;
const lobbyAfter = args.includes('--lobby') ? Number(arg('lobby', '3')) : -1;
let lastPhase = -1;
let tormenta: TormentaMsg | null = null;
room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => {
  const me = m.players.find((p) => p.index === index);
  if (m.tormenta && m.tormenta.k !== tormenta?.k) console.log(`[bot] tormenta phase ${m.tormenta.k}/${m.tormenta.n}`);
  tormenta = m.tormenta ?? null;
  if (m.phase !== lastPhase && m.phase === MatchPhase.RESULTS && lobbyAfter >= 0) {
    setTimeout(() => {
      room.send(C2S.RETURN_LOBBY, {});
      console.log('[bot] back to the lobby');
    }, lobbyAfter * 1000);
  }
  lastPhase = m.phase;
  if (jumpAfter >= 0 && m.ufo && me?.deploy === 1 && m.ufo.t0 !== jumpRoute?.t0) {
    jumpRoute = m.ufo;
    // Server time ≈ local time on one machine; good enough for a test bot.
    setTimeout(() => {
      room.send(C2S.UFO_JUMP, {});
      console.log('[bot] jump');
    }, Math.max(0, m.ufo.open + jumpAfter * 1000 - Date.now()));
  }
  ready = !!me?.ready;
  if (autoReady && !ready && m.phase === MatchPhase.FREE_ROAM && m.players.some((p) => p.index !== index && p.ready)) {
    room.send(C2S.READY, { r: 1 });
    console.log('[bot] ready');
  }
  if (me?.loadout?.length && m.phase === MatchPhase.MATCH) console.log(`[bot] match loadout: ${me.loadout.join(', ')}`);
});
let draftTimer: ReturnType<typeof setTimeout> | null = null;
room.onMessage(S2C.DRAFT_STATE, (m: DraftStateMsg) => {
  const seat = m.seats.find((x) => x.index === index);
  if (m.repick && m.lostTo) console.log(`[bot] lost ${m.lostTo.a} to #${m.lostTo.index}, repicking`);
  if (m.stage === 'reveal') console.log(`[bot] round ${m.round + 1}: ${m.reveal.map((r) => `#${r.index} ${r.a}${r.contested ? ' (disputada)' : ''}${r.auto ? ' (auto)' : ''}`).join(' · ')}`);
  if (idleDraft || m.stage !== 'pick' || !seat?.picking || m.mine || draftTimer) return;
  const owned = new Map(m.owners);
  const free = m.pool.filter((id) => !seat.picks.includes(id) && !(m.unique && owned.has(id)));
  const first = wanted.find((id) => free.includes(id));
  const id = first ?? free[Math.floor(Math.random() * free.length)];
  if (!id) return;
  const round = m.round;
  // Think like a person: a moment for the first choice, quicker on a repick.
  draftTimer = setTimeout(() => {
    draftTimer = null;
    room.send(C2S.DRAFT_PICK, { r: round, a: id });
  }, m.repick ? 900 : 1500 + Math.random() * 1500);
});
room.onMessage(S2C.MATCH_SUMMARY, (m: MatchSummaryMsg) => {
  console.log(`[bot] match over in ${Math.round(m.durationMs / 1000)} s: ${m.players.map((p) => `${p.placement}º ${p.name} (${p.kills} elim., ${p.damageDealt} dano)`).join(' · ')}`);
});
for (const t of [S2C.PONG, S2C.SELF, S2C.EVENTS, S2C.ABILITY_RESULT, S2C.NOTICE]) room.onMessage(t, () => {});

let seq = 1;
let t = 0;
let sent = 0;
const start = Date.now();
const timer = setInterval(() => {
  const cmds: InputCmd[] = [];
  // Real-time accumulator: exactly SIM_HZ commands per second on average, like the browser client.
  const due = Math.min(10, Math.floor(((Date.now() - start) / 1000) * SIM_HZ) - sent);
  sent += Math.max(0, due);
  for (let k = 0; k < due; k++) {
    t += 1 / SIM_HZ;
    const up = v3normalize(pos);
    let wish = northTangent(up);
    let buttons = 0;
    if (pattern === 'circle') wish = v3rotateAxis(wish, up, t * 0.7);
    else if (pattern === 'tormenta') {
      // Toward the centre of the region the Tormenta closes onto; once well inside, slow circles.
      const goal = tormenta ? tormentaTarget(tormenta) : null;
      if (goal && tormentaEdgeMeters(goal, pos) > -6) {
        const c = goal.center;
        const d = c.x * up.x + c.y * up.y + c.z * up.z;
        const flat = { x: c.x - up.x * d, y: c.y - up.y * d, z: c.z - up.z * d };
        if (Math.hypot(flat.x, flat.y, flat.z) > 1e-6) wish = v3normalize(flat);
      } else wish = v3rotateAxis(wish, up, t * 0.7);
    }
    else if (pattern === 'zigzag') wish = v3rotateAxis(wish, up, Math.sign(Math.sin(t * 1.3)) * 0.9);
    else if (pattern === 'jumpy') {
      wish = v3rotateAxis(wish, up, t * 0.5);
      if (Math.floor(t * 2) % 3 === 0) buttons |= InputButton.JUMP;
    } else wish = { x: 0, y: 0, z: 0 };
    if (pattern !== 'idle' && Math.floor(t / 4) % 2 === 1) buttons |= InputButton.SPRINT;
    const aim = v3normalize(v3cross(up, v3cross(wish, up)));
    cmds.push([seq++, Math.round(wish.x * WISH_SCALE), Math.round(wish.y * WISH_SCALE), Math.round(wish.z * WISH_SCALE), Math.round(aim.x * AIM_SCALE), Math.round(aim.y * AIM_SCALE), Math.round(aim.z * AIM_SCALE), buttons]);
  }
  if (cmds.length) room.send(C2S.PLAYER_INPUT, { i: cmds });
  if (Date.now() - start > seconds * 1000) {
    clearInterval(timer);
    void room.leave(true).then(() => process.exit(0));
  }
}, 1000 / 30);
