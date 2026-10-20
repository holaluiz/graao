import { createCharacterState, traversalOfMoveState, unpackTraversal, type CharacterState } from '@graao/game-core';
import { FACING_SCALE, MovementState, POS_SCALE, STAMINA_SCALE, SnapFlag, VEL_SCALE, type PlayerSnap } from '@graao/shared';

/**
 * The authoritative character state a snapshot tuple carries for the local player, as reconciliation rebuilds it
 * (NetSession → LocalPlayer.reconcile; docs/networking/TRAVERSAL_AUTHORITY.md): position, velocity, facing, the
 * movement flags, and the traversal mode, stamina, step timers and ledge radius. What the snapshot does not carry
 * (aim, statuses, ability movement, input edges) the caller copies from the local prediction.
 */
export function snapToCharacterState(s: PlayerSnap): CharacterState {
  const [, px, py, pz, vx, vy, vz, fx, fy, fz, , move, , flags] = s;
  const st = createCharacterState({ x: px / POS_SCALE, y: py / POS_SCALE, z: pz / POS_SCALE }, { x: fx / FACING_SCALE, y: fy / FACING_SCALE, z: fz / FACING_SCALE });
  const len = Math.hypot(st.facing.x, st.facing.y, st.facing.z) || 1;
  st.facing.x /= len;
  st.facing.y /= len;
  st.facing.z /= len;
  st.vel.x = vx / VEL_SCALE;
  st.vel.y = vy / VEL_SCALE;
  st.vel.z = vz / VEL_SCALE;
  st.grounded = (flags & SnapFlag.GROUNDED) !== 0;
  st.aiming = (flags & SnapFlag.AIMING) !== 0;
  st.diving = (flags & SnapFlag.DIVING) !== 0;
  st.airJumped = (flags & SnapFlag.AIR_JUMPED) !== 0;
  st.airTime = st.grounded ? 0 : 1;
  st.moveState = move as CharacterState['moveState'];
  st.swimming = move === MovementState.SWIM;
  // Traversal: the mode rides on moveState, stamina and the step timers on their own fields (older servers: none).
  st.traversal = traversalOfMoveState(move);
  if (s[20] !== undefined) st.stamina = s[20] / STAMINA_SCALE;
  if (s[21] !== undefined) unpackTraversal(s[21], st);
  if (s[22] !== undefined) st.ledgeR = s[22] / POS_SCALE;
  return st;
}
