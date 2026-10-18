/**
 * Pieces modeled in Blender (tools/blender/build_hero.py → assets/v1/characters/hero-parts.glb): wavy hair, the
 * hoodie, cargo shorts and retro sneakers with socks. Each glTF mesh is one (body, piece, palette slot): the material
 * name is the slot, node extras carry the body id, piece id, candidate bones and body region. Geometry arrives in the
 * rig's bind pose; skin weights are computed by PartBuilder exactly like the code-built pieces.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BodyRegion } from '@graao/game-data';
import type { BoneName } from '../rig/GRARig';
import { Slot, type SlotId } from './PartBuilder';

export interface AuthoredMesh {
  slot: SlotId;
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  index: ArrayLike<number>;
  bones: BoneName[];
  region: BodyRegion | 'none';
}

export class AuthoredParts {
  private readonly pieces = new Map<string, AuthoredMesh[]>();

  get size(): number {
    return this.pieces.size;
  }

  /** Meshes of `piece` for `bodyId` (`hair.ondulado#covered` for the variant under a hat), if authored. */
  get(bodyId: string, piece: string): AuthoredMesh[] | undefined {
    return this.pieces.get(`${bodyId}|${piece}`);
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Extras sit on the node; a multi-primitive node would put them on the parent group.
      const extras = (mesh.userData.piece ? mesh.userData : mesh.parent?.userData) as { body?: string; piece?: string; bones?: string; region?: string };
      const mat = mesh.material as THREE.Material;
      const slot = (Slot as Record<string, SlotId>)[mat.name];
      if (!extras?.body || !extras.piece || slot === undefined) return;
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const index = g.getIndex() ?? new THREE.BufferAttribute(Uint32Array.from({ length: g.getAttribute('position').count }, (_, i) => i), 1);
      const key = `${extras.body}|${extras.piece}`;
      if (!this.pieces.has(key)) this.pieces.set(key, []);
      this.pieces.get(key)!.push({
        slot,
        positions: g.getAttribute('position').array,
        normals: g.getAttribute('normal').array,
        index: index.array,
        bones: (extras.bones ?? 'Hips').split(',') as BoneName[],
        region: (extras.region ?? 'none') as BodyRegion | 'none',
      });
    });
  }
}
