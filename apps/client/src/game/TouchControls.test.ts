import { describe, expect, it } from 'vitest';
import { TraversalMode } from '@graao/game-data';
import { jumpLabel, touchAction, type TouchContext } from './TouchControls';

const base: TouchContext = { traversal: TraversalMode.NONE, grounded: true, canGlide: false, prompt: null, wallAhead: null, alive: true };
const at = (o: Partial<TouchContext>): TouchContext => ({ ...base, ...o });

describe('touch: one contextual button for traversal and the world', () => {
  it('follows the hands first: pull up from a ledge, let go of a wall, nothing mid-mantle or on the kite', () => {
    expect(touchAction(at({ traversal: TraversalMode.HANG, grounded: false, prompt: 'Abrir baú' }))).toEqual({ label: 'SUBIR', kind: 'mantle' });
    expect(touchAction(at({ traversal: TraversalMode.CLIMB, grounded: false }))).toEqual({ label: 'SOLTAR', kind: 'drop' });
    expect(touchAction(at({ traversal: TraversalMode.MANTLE }))).toBeNull();
    expect(touchAction(at({ traversal: TraversalMode.GLIDE, grounded: false, wallAhead: 'climb' }))).toBeNull();
  });

  it('then the world (a chest, a door, a bell), then a face or an edge in reach; hidden otherwise or when dead', () => {
    expect(touchAction(at({ prompt: 'Abrir baú', wallAhead: 'climb' }))).toEqual({ label: 'ABRIR', kind: 'interact' });
    expect(touchAction(at({ prompt: 'Tocar o sino' }))!.label).toBe('TOCAR');
    expect(touchAction(at({ wallAhead: 'climb' }))).toEqual({ label: 'ESCALAR', kind: 'climb' });
    expect(touchAction(at({ wallAhead: 'ledge' }))).toEqual({ label: 'AGARRAR', kind: 'climb' });
    // A wall is grabbed with a jump from the ground; in the air the jump button already does it.
    expect(touchAction(at({ wallAhead: 'ledge', grounded: false }))).toBeNull();
    expect(touchAction(base)).toBeNull();
    expect(touchAction(at({ alive: false, prompt: 'Abrir baú' }))).toBeNull();
  });

  it('the jump button says what holding it does: jump, open the kite in a fall, gliding', () => {
    expect(jumpLabel(base)).toBe('PULAR');
    expect(jumpLabel(at({ grounded: false, canGlide: true }))).toBe('PLANAR');
    expect(jumpLabel(at({ grounded: false, canGlide: false }))).toBe('PULAR');
    expect(jumpLabel(at({ grounded: false, traversal: TraversalMode.GLIDE }))).toBe('PLANANDO');
    expect(jumpLabel(at({ grounded: false, traversal: TraversalMode.HANG, canGlide: true }))).toBe('PULAR');
  });
});
