/**
 * Network test bot: joins (or creates) a graao room and runs patterns with real input commands, like a player.
 *   pnpm bot -- --code GR-7K2M [--name Bot] [--pattern circle|zigzag|idle|jumpy] [--url ws://localhost:2567] [--seconds 120]
 *   pnpm bot -- --create        (prints the new room code)
 * Match flow: --ready marks the bot READY as soon as someone else is; in the Ability Draft it picks a random free
 * ability after a short think (--pick sun_orb,wind_step,... tries those first, round by round: handy to force a
 * conflict with a human); --idle-draft never picks (the server chooses for it when time runs out).
 */
import { Client } from '@colyseus/sdk';
import { randomAppearance } from '@graao/game-data';
import { northTangent } from '@graao/game-core';
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
  type RoomStateMsg,
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
const room = args.includes('--create') ? await client.create(ROOM_NAME, { ...options, maxPlayers: Number(arg('max', '4')) }) : await client.joinById(arg('code', ''), options);

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
room.onMessage(S2C.ROOM_STATE, (m: RoomStateMsg) => {
  const me = m.players.find((p) => p.index === index);
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
