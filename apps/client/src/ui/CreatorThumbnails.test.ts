import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { APPEARANCE_OPTIONS, BODIES, DEFAULT_APPEARANCE } from '@graao/game-data';
import type { CharacterAppearance } from '@graao/shared';
import { CharacterPartLibrary } from '../character/CharacterAppearanceController';
import { AuthoredParts } from '../character/build/AuthoredParts';
import { Slot } from '../character/build/PartBuilder';
import { CreatorThumbnails, frameThumbnail, thumbnailCacheKey } from './CreatorThumbnails';

const PIECES: (keyof CharacterAppearance)[] = ['bodyId', 'faceId', 'beardId', 'hairId', 'topId', 'bottomId', 'shoesId', 'hatId', 'accessoryId', 'extraId'];

describe('real catalog photographs', () => {
  it('builds every catalog shape on both bodies with valid game palette slots and skin weights', () => {
    const parts = new CharacterPartLibrary();
    for (const body of BODIES) for (const key of PIECES) for (const option of APPEARANCE_OPTIONS[key]) {
      const appearance = { ...DEFAULT_APPEARANCE, bodyId: body.id, [key]: option.id };
      const { geometry } = parts.previewGeometry(appearance, key);
      const position = geometry.getAttribute('position');
      const slots = geometry.getAttribute('aSlot');
      const weights = geometry.getAttribute('skinWeight');
      expect(slots.count).toBe(position.count);
      expect(weights.count).toBe(position.count);
      for (let i = 0; i < position.count; i++) {
        if (!Number.isFinite(position.getX(i) + position.getY(i) + position.getZ(i))) throw new Error(`Invalid thumbnail vertex: ${option.id}`);
        if (slots.getX(i) < 0 || slots.getX(i) >= 32) throw new Error(`Invalid thumbnail palette: ${option.id}`);
      }
      geometry.dispose();
    }
  });

  it('frames actual faces and beards with a real head, without unused torso vertices', () => {
    const parts = new CharacterPartLibrary();
    for (const key of ['faceId', 'beardId'] as const) {
      const { geometry } = parts.previewGeometry(DEFAULT_APPEARANCE, key);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.y).toBeGreaterThan(1.15);
      expect(geometry.boundingBox!.max.y).toBeGreaterThan(1.55);
      expect(new Set(Array.from(geometry.getAttribute('aSlot').array))).toContain(Slot.SKIN);
      geometry.dispose();
    }
  });

  it('owns thumbnail geometry independently of the live avatar part cache', () => {
    const parts = new CharacterPartLibrary();
    const first = parts.previewGeometry(DEFAULT_APPEARANCE, 'topId').geometry;
    const expected = first.getAttribute('position').getX(0);
    first.getAttribute('position').setX(0, 500);
    first.dispose();
    const next = parts.previewGeometry(DEFAULT_APPEARANCE, 'topId').geometry;
    expect(next.getAttribute('position').getX(0)).toBe(expected);
    expect(next.getAttribute('position')).not.toBe(first.getAttribute('position'));
    next.dispose();
  });

  it('uses loaded Blender meshes instead of the procedural fallback and invalidates image keys', () => {
    const parts = new CharacterPartLibrary();
    const authored = new AuthoredParts();
    const get = vi.spyOn(authored, 'get').mockReturnValue([{
      slot: Slot.SHOES, positions: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], index: [0, 1, 2], bones: ['LeftFoot'], region: 'none',
    }]);
    const oldKey = thumbnailCacheKey('shoesId', 'shoes.retro', DEFAULT_APPEARANCE, parts.revision);
    parts.useAuthored(authored);
    const appearance = { ...DEFAULT_APPEARANCE, shoesId: 'shoes.retro' };
    const { geometry } = parts.previewGeometry(appearance, 'shoesId');
    expect(get).toHaveBeenCalledWith(appearance.bodyId, 'shoes.retro');
    expect(geometry.getAttribute('position').count).toBe(3);
    expect(thumbnailCacheKey('shoesId', 'shoes.retro', DEFAULT_APPEARANCE, parts.revision)).not.toBe(oldKey);
    geometry.dispose();
  });

  it('invalidates images for palette colors and dependency changes, while ignoring the replaced selection', () => {
    const key = thumbnailCacheKey('topId', 'top.time', DEFAULT_APPEARANCE);
    expect(thumbnailCacheKey('topId', 'top.time', { ...DEFAULT_APPEARANCE, topColorId: 'fabric.flag' })).not.toBe(key);
    expect(thumbnailCacheKey('topId', 'top.time', { ...DEFAULT_APPEARANCE, bodyId: 'body.sturdy' })).not.toBe(key);
    expect(thumbnailCacheKey('topId', 'top.time', { ...DEFAULT_APPEARANCE, topId: 'top.xadrez' })).toBe(key);
  });

  it('cancels obsolete category requests before creating any WebGL renderer', async () => {
    const raf = vi.fn(() => 1);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const thumbnails = new CreatorThumbnails(new CharacterPartLibrary());
    try {
      thumbnails.setActive(true);
      const abort = new AbortController();
      const pending = thumbnails.request('topId', DEFAULT_APPEARANCE.topId, DEFAULT_APPEARANCE, abort.signal);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      abort.abort();
      await rejected;
      expect(raf).toHaveBeenCalledOnce();
      thumbnails.setActive(false);
      expect(cancel).toHaveBeenCalledWith(1);
    } finally {
      thumbnails.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('rejects queued work when the creator closes and refuses work while hidden', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const thumbnails = new CreatorThumbnails(new CharacterPartLibrary());
    try {
      thumbnails.setActive(true);
      const pending = thumbnails.request('shoesId', DEFAULT_APPEARANCE.shoesId, DEFAULT_APPEARANCE);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      thumbnails.setActive(false);
      await rejected;
      await expect(thumbnails.request('shoesId', DEFAULT_APPEARANCE.shoesId, DEFAULT_APPEARANCE)).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      thumbnails.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('keeps projected broad hats, head shapes, socks and rear accessories inside the image', () => {
    const parts = new CharacterPartLibrary();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    for (const [key, id] of [
      ['hatId', 'hat.palha'], ['hairId', 'hair.afro'], ['hairId', 'hair.moicano'],
      ['shoesId', 'shoes.retro'], ['extraId', 'extra.mochila'], ['extraId', 'extra.bandeira'],
    ] as const) {
      const { geometry } = parts.previewGeometry({ ...DEFAULT_APPEARANCE, [key]: id }, key);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      frameThumbnail(camera, bounds, key, id);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(0.85);
        expect(Math.abs(point.y)).toBeLessThan(0.85);
      }
      geometry.dispose();
    }
  });
});
