/** Persistent, authoritative spell geometry and private reconnaissance. No gameplay is inferred from particles. */
import * as THREE from 'three';
import { abilityCloudVolume, castOrigin, createAbilityBarrier, type AbilityCloudVolume, type GamePhysics } from '@graao/game-core';
import { ABILITIES, isAbilityId, type AbilityDefinition } from '@graao/game-data';
import { DIR_SCALE, POS_SCALE, type AbilityEntityView, type AbilityRevealMsg, type AbilityStateMsg } from '@graao/shared';
import '../../styles/ability-world.css';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.IcosahedronGeometry(1, 1);
const RING = new THREE.TorusGeometry(1, .075, 5, 32);
const SPIKE = new THREE.ConeGeometry(.17, .65, 5);
const POLE = new THREE.CylinderGeometry(.06, .1, 1, 6);
const EDGES = new THREE.EdgesGeometry(BOX);
const WING = new THREE.ConeGeometry(1, 1, 3);
const INK = new THREE.LineBasicMaterial({ color: '#2a2130' });
const MAX_ENTITIES = 128;
const MAX_MARKERS = 96;

const vector = (at: [number, number, number], scale = POS_SCALE) => new THREE.Vector3(at[0] / scale, at[1] / scale, at[2] / scale);

export function abilityEntityFrame(view: AbilityEntityView): { center: THREE.Vector3; up: THREE.Vector3; side: THREE.Vector3; forward: THREE.Vector3 } {
  const center = vector(view.at);
  const up = center.clone().normalize();
  const forward = view.dir ? vector(view.dir, DIR_SCALE) : new THREE.Vector3(0, 0, 1);
  forward.addScaledVector(up, -forward.dot(up));
  if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0).addScaledVector(up, -up.x);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();
  return { center, up, forward, side: new THREE.Vector3().crossVectors(up, forward).normalize() };
}

interface EntityObject { view: AbilityEntityView; root: THREE.Group; signature: string; collider?: { dispose(): void }; cloud?: AbilityCloudVolume }
interface MarkerObject { root: THREE.Object3D; until: number }
interface BearingObject { direction: THREE.Vector3; el: HTMLElement; until: number }
interface AttachmentObject { root: THREE.Group; character: THREE.Object3D; until: number; rope?: THREE.Line; anchor?: THREE.Vector3 }

export class AbilityWorldPresentation {
  readonly root = new THREE.Group();
  mirrorCollisions = true;
  private readonly entities = new Map<number, EntityObject>();
  private readonly markers = new Map<string, MarkerObject>();
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();
  private readonly bearings: BearingObject[] = [];
  private readonly attachments = new Map<number, AttachmentObject>();
  private readonly veil = document.createElement('div');
  private readonly bearingLayer = document.createElement('div');
  private readonly right = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly physics: GamePhysics, private readonly camera: THREE.Camera, ui: HTMLElement) {
    this.root.name = 'ability-world';
    scene.add(this.root);
    this.veil.className = 'ability-cloud-veil';
    this.veil.hidden = true;
    this.bearingLayer.className = 'ability-bearings';
    ui.prepend(this.veil);
    ui.append(this.bearingLayer);
  }

  private material(color: string, reveal = false): THREE.MeshBasicMaterial {
    const key = `${color}|${reveal}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, fog: !reveal, side: THREE.DoubleSide, depthTest: !reveal, depthWrite: !reveal });
      this.materials.set(key, material);
    }
    return material;
  }

  private mesh(geometry: THREE.BufferGeometry, color: string, parent: THREE.Object3D, reveal = false): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.material(color, reveal));
    if (reveal) mesh.renderOrder = 20;
    parent.add(mesh);
    return mesh;
  }

  setState(state: AbilityStateMsg): void {
    const seen = new Set(state.entities.map((view) => view.id));
    for (const id of this.entities.keys()) if (!seen.has(id)) this.removeEntity(id);
    for (const view of state.entities) this.onEntity(view);
  }

  onEntity(view: AbilityEntityView): void {
    if (!view.at.every(Number.isFinite) || !Number.isFinite(view.endsAt)) return;
    const signature = `${view.kind}|${view.at}|${view.dir}|${view.size}|${view.radius}`;
    const old = this.entities.get(view.id);
    if (old?.signature === signature) { old.view = view; return; }
    if (old) this.removeEntity(view.id);
    if (this.entities.size >= MAX_ENTITIES) this.removeEntity(this.entities.keys().next().value!);
    const root = new THREE.Group();
    const frame = abilityEntityFrame(view);
    root.position.copy(frame.center);
    root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(frame.side, frame.up, frame.forward));
    const colors = isAbilityId(view.a) ? ABILITIES[view.a].presentation : { color: '#ffe0a0', color2: '#fff6df' };
    const radius = Math.max(.2, (view.radius ?? 100) / 100);
    const width = (view.size?.[0] ?? 300) / 100;
    const height = (view.size?.[1] ?? 220) / 100;
    const depth = (view.size?.[2] ?? 35) / 100;
    const entry: EntityObject = { root, view, signature };
    switch (view.kind) {
      case 'barrier': {
        this.mesh(BOX, colors.color2, root).scale.set(width, height, depth);
        const edges = new THREE.LineSegments(EDGES, INK);
        edges.scale.set(width * 1.005, height * 1.005, depth * 1.005);
        root.add(edges);
        // Dark folded seams distinguish a paper wall from scenery, even in LOW.
        for (const sign of [-1, 1]) {
          const fold = this.mesh(BOX, colors.color, root);
          fold.position.set(width * sign * .23, 0, depth * .51);
          fold.scale.set(.04, height, .025);
        }
        if (this.mirrorCollisions) entry.collider = createAbilityBarrier(this.physics, { ...frame, width, height, depth });
        break;
      }
      case 'cloud':
        if (this.isOpaqueCloud(view)) {
          // A closed opaque volume blocks sight at every quality level; an interior veil handles a camera inside it.
          entry.cloud = abilityCloudVolume(frame.center, radius);
          const cloud = this.mesh(SPHERE, '#e4dce3', root);
          cloud.position.y = frame.center.distanceTo(entry.cloud.center);
          cloud.scale.setScalar(entry.cloud.radius);
        } else {
          const border = this.mesh(RING, colors.color, root);
          border.rotation.x = Math.PI / 2; border.scale.setScalar(radius); border.position.y = .12;
          const puddle = this.mesh(SPHERE, colors.color2, root);
          puddle.scale.set(radius * .88, .045, radius * .88); puddle.position.y = .08;
        }
        break;
      case 'portal': {
        const outer = this.mesh(RING, colors.color, root);
        outer.scale.set(radius, radius * 1.25, radius); outer.position.y = radius * 1.25;
        const inner = this.mesh(RING, '#2a2130', root);
        inner.scale.set(radius * .86, radius * 1.1, radius * .6); inner.position.y = radius * 1.25;
        break;
      }
      case 'beacon': {
        const pole = this.mesh(POLE, '#3a4f42', root);
        pole.position.y = 1.2; pole.scale.y = 2.4;
        const light = this.mesh(SPHERE, '#ffed88', root);
        light.position.y = 2.6; light.scale.set(.45, .65, .45);
        this.mesh(RING, colors.color, root).rotation.x = Math.PI / 2;
        break;
      }
      case 'garden':
        if (view.a === 'bloom') {
          const stem = this.mesh(POLE, colors.color, root); stem.position.y = .5;
          for (let i = 0; i < 5; i++) {
            const petal = this.mesh(SPHERE, colors.color2, root);
            petal.scale.set(.3, .13, .3);
            petal.position.set(Math.cos(i * 1.26) * .27, 1.05, Math.sin(i * 1.26) * .27);
          }
          this.mesh(SPHERE, '#ffe080', root).position.y = 1.1;
          root.children[root.children.length - 1]!.scale.setScalar(.18);
          break;
        }
        for (let i = 0; i < 8; i++) {
          const angle = i / 8 * Math.PI * 2;
          const plant = this.mesh(SPIKE, i % 2 ? colors.color : colors.color2, root);
          plant.position.set(Math.cos(angle) * radius * .8, .35, Math.sin(angle) * radius * .8);
          plant.scale.set(2, 1.8, 2);
        }
        this.mesh(RING, colors.color, root).scale.setScalar(radius);
        root.children[root.children.length - 1]!.rotation.x = Math.PI / 2;
        break;
      case 'trap':
        for (let i = 0; i < 5; i++) {
          const spike = this.mesh(SPIKE, colors.color, root);
          spike.position.set(Math.cos(i * 1.26) * .45, .22, Math.sin(i * 1.26) * .45);
        }
        break;
      case 'wave': {
        const wave = this.mesh(RING, colors.color, root);
        wave.scale.set(view.size ? width / 2 : radius, .65, 1);
        wave.position.y = .5;
        break;
      }
    }
    root.userData.ability = view.a;
    this.root.add(root);
    this.entities.set(view.id, entry);
  }

  removeEntity(id: number): void {
    const entry = this.entities.get(id);
    if (!entry) return;
    entry.collider?.dispose();
    entry.root.removeFromParent();
    this.entities.delete(id);
  }

  private isOpaqueCloud(view: AbilityEntityView): boolean {
    return view.kind === 'cloud' && isAbilityId(view.a) && ABILITIES[view.a].effects.some((effect) => effect.kind === 'cloud');
  }

  /** Attachments start only after acceptance; the character's existing radial frame owns their orientation. */
  onCast(by: number, definition: AbilityDefinition, character: THREE.Object3D, now: number, direction?: { x: number; y: number; z: number }): void {
    const mobility = definition.effects.find((effect) => effect.kind === 'mobility');
    const shield = definition.effects.find((effect) => effect.kind === 'frontShield');
    if (!shield && (!mobility || !['grapple', 'glide', 'flight'].includes(mobility.mode))) return;
    this.removeAttachment(by);
    const root = new THREE.Group();
    character.add(root);
    const entry: AttachmentObject = { root, character, until: now + (shield?.duration ?? mobility?.duration ?? 1) * 1000 };
    const color = definition.presentation.color;
    if (shield) {
      const canopy = this.mesh(SPHERE, color, root);
      canopy.position.set(0, 1.25, .72); canopy.scale.set(.85, .8, .12);
      const rim = this.mesh(RING, '#2a2130', root);
      rim.position.copy(canopy.position); rim.scale.set(.85, .8, 1);
      const handle = this.mesh(POLE, '#2a2130', root);
      handle.position.set(0, 1.05, .42); handle.rotation.x = Math.PI / 2; handle.scale.y = .6;
    } else if (mobility?.mode === 'grapple' && direction) {
      const from = castOrigin(character.position, direction);
      const hit = this.physics.castRay(from, direction, definition.range);
      if (hit) {
        entry.anchor = new THREE.Vector3(from.x, from.y, from.z).addScaledVector(new THREE.Vector3(direction.x, direction.y, direction.z), hit.toi);
        const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([character.position, entry.anchor]), INK);
        this.root.add(rope); entry.rope = rope;
      }
    } else if (mobility?.mode === 'flight') {
      const kite = this.mesh(SPHERE, color, root);
      kite.position.set(0, 3.0, 0); kite.scale.set(.95, 1.35, .12);
      const tail = this.mesh(POLE, definition.presentation.color2, root);
      tail.position.y = 1.95; tail.scale.y = 1.2;
    } else {
      for (const sign of [-1, 1]) {
        const wing = this.mesh(WING, definition.presentation.color2, root);
        wing.position.set(sign * .65, 1.2, -.2); wing.rotation.z = sign * Math.PI / 2; wing.rotation.y = Math.PI / 2;
        wing.scale.set(.5, 1.2, .15);
      }
    }
    this.attachments.set(by, entry);
  }

  removeAttachment(by: number): void {
    const attachment = this.attachments.get(by);
    if (!attachment) return;
    attachment.root.removeFromParent();
    attachment.rope?.removeFromParent(); attachment.rope?.geometry.dispose();
    this.attachments.delete(by);
  }

  /** The caller must route only the server's private message for this player. Never reads opponent history. */
  onReveal(message: AbilityRevealMsg): void {
    const prefix = `${message.a}:${message.kind}:`;
    for (const [key, marker] of this.markers) if (key.startsWith(prefix)) { marker.root.removeFromParent(); this.markers.delete(key); }
    if (message.kind === 'bearing') {
      for (const bearing of this.bearings) bearing.el.remove();
      this.bearings.length = 0;
      for (const item of message.bearings.slice(0, 10)) {
        const el = document.createElement('span');
        el.className = 'ability-bearing';
        el.textContent = '▲'; el.title = 'Atividade recente nesta direção aproximada';
        this.bearingLayer.append(el);
        this.bearings.push({ el, direction: vector(item.direction, DIR_SCALE).normalize(), until: message.endsAt });
      }
      return;
    }
    const points = message.kind === 'trail'
      ? message.points.map((at, i) => ({ key: String(i), at }))
      : message.targets.map((target) => ({ key: String('index' in target ? target.index : target.id), at: target.at }));
    const color = message.kind === 'enemy' ? '#ff8d7e' : message.kind === 'loot' ? '#ffe974' : '#a5e8e5';
    for (const point of points.slice(0, MAX_MARKERS)) {
      const marker = new THREE.Group();
      marker.position.copy(vector(point.at));
      const up = marker.position.clone().normalize();
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      const ring = this.mesh(RING, color, marker, true);
      ring.rotation.x = Math.PI / 2;
      const scale = message.kind === 'trail' ? .18 : .6;
      ring.scale.setScalar(scale);
      ring.position.y = message.kind === 'enemy' ? 2.1 : .3;
      if (message.kind !== 'trail') {
        const pointer = this.mesh(SPIKE, color, marker, true);
        pointer.position.y = message.kind === 'enemy' ? 2.5 : 1.1;
        pointer.rotation.z = Math.PI;
      }
      this.root.add(marker);
      this.markers.set(`${prefix}${point.key}`, { root: marker, until: message.endsAt });
    }
    while (this.markers.size > MAX_MARKERS) {
      const key = this.markers.keys().next().value!;
      this.markers.get(key)!.root.removeFromParent(); this.markers.delete(key);
    }
  }

  update(now: number): void {
    let insideCloud = false;
    for (const [id, entry] of this.entities) {
      if (now >= entry.view.endsAt) { this.removeEntity(id); continue; }
      if (entry.cloud) {
        const { center, radius } = entry.cloud;
        const dx = this.camera.position.x - center.x, dy = this.camera.position.y - center.y, dz = this.camera.position.z - center.z;
        if (dx * dx + dy * dy + dz * dz <= radius * radius) insideCloud = true;
      }
      if (entry.view.kind === 'portal') entry.root.children[0]!.rotation.z = now / 2200;
    }
    if (this.veil.hidden === insideCloud) this.veil.hidden = !insideCloud;
    for (const [by, attachment] of this.attachments) {
      if (now >= attachment.until || !attachment.character.parent || !attachment.character.visible) { this.removeAttachment(by); continue; }
      if (attachment.rope && attachment.anchor) {
        const positions = attachment.rope.geometry.getAttribute('position');
        const hand = attachment.character.localToWorld(new THREE.Vector3(0, 1.3, .4));
        positions.setXYZ(0, hand.x, hand.y, hand.z);
        positions.setXYZ(1, attachment.anchor.x, attachment.anchor.y, attachment.anchor.z);
        positions.needsUpdate = true;
        attachment.rope.geometry.computeBoundingSphere();
      }
    }
    for (const [key, marker] of this.markers) if (now >= marker.until) { marker.root.removeFromParent(); this.markers.delete(key); }
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.camera.getWorldDirection(this.forward);
    for (let i = this.bearings.length - 1; i >= 0; i--) {
      const bearing = this.bearings[i]!;
      if (now >= bearing.until) { bearing.el.remove(); this.bearings.splice(i, 1); continue; }
      const angle = Math.atan2(bearing.direction.dot(this.right), bearing.direction.dot(this.forward));
      bearing.el.style.transform = `translate(${Math.sin(angle) * 110}px, ${-Math.cos(angle) * 35}px) rotate(${angle}rad)`;
    }
  }

  clearReveals(): void {
    for (const marker of this.markers.values()) marker.root.removeFromParent();
    this.markers.clear();
    for (const bearing of this.bearings) bearing.el.remove();
    this.bearings.length = 0;
  }

  clear(): void {
    for (const id of [...this.entities.keys()]) this.removeEntity(id);
    this.clearReveals(); this.veil.hidden = true;
    for (const by of [...this.attachments.keys()]) this.removeAttachment(by);
  }

  stats(): string { return `${this.entities.size} entidades · ${this.markers.size} revelações`; }

  dispose(): void {
    this.clear(); this.root.removeFromParent(); this.veil.remove(); this.bearingLayer.remove();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}
