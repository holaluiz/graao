/**
 * Network test bot: joins (or creates) a graao room and runs patterns with real input commands, like a player.
 *   pnpm bot -- --code GR-7K2M [--name Bot] [--pattern circle|zigzag|idle|jumpy] [--url ws://localhost:2567] [--seconds 120]
 *   pnpm bot -- --create        (prints the new room code)
 */
import { Client } from '@colyseus/sdk';
import { randomAppearance } from '@graao/game-data';
import { northTangent } from '@graao/game-core';
import {
  AIM_SCALE,
  C2S,
  CLIENT_VERSION,
  InputButton,
  POS_SCALE,
  PROTOCOL_VERSION,
  ROOM_NAME,
  S2C,
  SIM_HZ,
  WISH_SCALE,
  v3cross,
  v3normalize,
  v3rotateAxis,
  type InputCmd,
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
room.onMessage(S2C.ROOM_STATE, () => {});
room.onMessage(S2C.PONG, () => {});

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
