/**
 * Map editor (development only: `?editor`, docs/world/WORLD_DESIGN.md "Editor do mapa"). It edits the versioned map
 * that the client and the server both load (game-data world/planeta-graao.map.json):
 *
 * - Peças: pick a prefab, a building or a classic structure by family (COLONIAL, URBANO_BH, MODERNISTA, SERRA, BOSQUE,
 *   PROPS_BRASILEIROS, RUAS_E_TRILHAS, ESTRUTURAS) and click the planet to place it; select, move (G or the arrows),
 *   turn (Q/E), scale (+/−), raise (PageUp/PageDown), duplicate (Ctrl+D) and delete (Delete). A piece dropped on a roof
 *   or a deck keeps its height (`lift`). Every placement stands on the sphere in its own tangent frame, exactly as the
 *   game's layout puts it (game-core buildLayout runs on the edited map), buildings settle on slopes the same way.
 * - Baús: place, move and turn the chest spots of the existing loot system; each is checked like the server checks it.
 * - Waypoints: the bots' authored navigation points and their links (click places one linked to the selected one,
 *   Shift+click links or unlinks two).
 * - Colisões (C) draws the colliders around the camera: orange solid, cyan movement-only (railings), green
 *   vegetation, yellow the selection. Trilhas (T) shows the painted trails.
 * - Ctrl+Z / Ctrl+Y undo and redo; Ctrl+S validates the map (validateMap and the building sites) and saves it through
 *   the dev server (vite.config.ts), bumping `mapVersion` and stamping `editedAt`; "Baixar JSON" gives the same file.
 *
 * The camera flies over the planet: right drag turns it, middle drag (or Shift + right drag) pans, the wheel zooms,
 * WASD moves along the ground, F frames the selection. Trees, rocks and grass are the loaded world's: they rearrange
 * around moved buildings when the page reloads with the saved map.
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import {
  CHEST_REGIONS,
  GRAAO_MAP,
  KIT_BUILDINGS,
  KIT_CATEGORY_NAMES,
  KIT_PREFABS,
  PLANET,
  REGIONS,
  STRUCTURE_PREFABS,
  serializeMap,
  validateMap,
  type ChestSpotDef,
  type GraaoMap,
  type KitCategory,
  type MapPlacement,
  type MapWaypoint,
  type RegionDef,
} from '@graao/game-data';
import { GROUPS_TERRAIN_QUERY, buildLayout, buildingSite, dirToLatLon, headingTangent, latLonToDir, quatRotate, resolveChestSpot, type ColliderPrimitive, type Placement, type WorldLayout } from '@graao/game-core';
import type { Vec3 } from '@graao/shared';
import type { GraaoApp } from '../app/GraaoApp';
import { buildKitChunks, kitPrefabGeometry } from '../world/kitGeometry';
import * as G from '../world/propGeometry';
import './editor.css';

const DEG = Math.PI / 180;
const R = PLANET.radius;
const VIEW_KEY = 'graao.editor.view';
/** Kit cells (as PlanetView): Fibonacci points ≈ 45 m apart; an edit rebuilds only the cells it touches. */
const CELLS = 64;

type Mode = 'pecas' | 'baus' | 'waypoints';
type Selection = { kind: 'placement' | 'chest' | 'waypoint'; id: string } | null;
type Family = KitCategory | 'construcoes' | 'estruturas';

interface Hit {
  point: THREE.Vector3;
  dist: number;
  kind: 'terrain' | 'placement' | 'chest' | 'waypoint';
  id?: string;
}

interface Range {
  start: number;
  count: number;
  mapId: string;
}

interface CellView {
  sig: string;
  meshes: THREE.Mesh[];
}

/** Building modules (walls, slabs, foundations…) are listed only with "Mostrar módulos". */
const MODULE = /^(fundacao|embasamento|soleira|laje|pilar|parapeito|telhado|col-(cunhal|telhado|assoalho|escada-interna|puxado|faixa|parede|janela|porta|sup-)|capela-|chafariz-|bica-|pavilhao-|espelho-dagua-|deck-pavilhao|pilotis-volume|rampa-pilotis|cachoeira-|viaduto-|escada-viaduto|patamar-|sitio-|varanda-|mureta-|escada-mercado|parede-)/;

const FAMILY_NAMES: Record<Family, string> = { ...KIT_CATEGORY_NAMES, construcoes: 'CONSTRUÇÕES', estruturas: 'ESTRUTURAS' };
const FAMILIES: Family[] = ['construcoes', 'colonial', 'urbano_bh', 'modernista', 'serra', 'bosque', 'props', 'rua', 'estruturas'];
const WAYPOINT_KINDS: NonNullable<MapWaypoint['kind']>[] = ['rua', 'porta', 'escada', 'telhado', 'ponte', 'mirante', 'interior', 'trilha'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const v3of = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

function fibonacciCells(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) {
    const y = 1 - (2 * (k + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const phi = k * Math.PI * (3 - Math.sqrt(5));
    out.push(new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi)));
  }
  return out;
}

/** The region a direction belongs to (the closest whose radius contains it), as biomeAt does. */
function regionAt(dir: Vec3): RegionDef | null {
  let best: RegionDef | null = null;
  let bestT = Infinity;
  for (const r of REGIONS) {
    const d = latLonToDir(r.lat, r.lon);
    const t = Math.acos(Math.max(-1, Math.min(1, dir.x * d.x + dir.y * d.y + dir.z * d.z))) / (r.radiusDeg * DEG);
    if (t < 1 && t < bestT) {
      bestT = t;
      best = r;
    }
  }
  return best;
}

export class MapEditor {
  private map: GraaoMap;
  private readonly baseVersion: number;
  private dirty = false;
  private readonly undoStack: string[] = [];
  private readonly redoStack: string[] = [];
  private layout!: WorldLayout;
  private readonly root = new THREE.Group();
  private readonly kitGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();
  private readonly overlay = new THREE.Group();
  private readonly cells = new Map<number, CellView>();
  private readonly cellDirs = fibonacciCells(CELLS);
  private readonly structs = new Map<string, { sig: string; mesh: THREE.InstancedMesh }>();
  private readonly ranges = new Map<THREE.Object3D, Range[]>();
  private readonly structGeo = new Map<string, THREE.BufferGeometry>();
  private readonly ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.45, depthWrite: false });
  private ghost: THREE.Object3D | null = null;
  private colliderLines: THREE.LineSegments | null = null;
  private selectionLines: THREE.LineSegments | null = null;
  private trailLines: THREE.Group | null = null;
  private colliderCenter: THREE.Vector3 | null = null;

  private mode: Mode = 'pecas';
  private family: Family = 'construcoes';
  private search = '';
  private showModules = false;
  private placing: string | null = null;
  private grabbing = false;
  private placeYaw = 0;
  private sel: Selection = null;
  private showColliders = false;
  private showTrails = true;
  private rebuildPending = true;
  private markersPending = true;
  private overlayPending = true;
  private lastHover = 0;
  private hover: Hit | null = null;

  // Camera: a target on the ground, a heading (clockwise from north), a pitch and a distance.
  private readonly target = new THREE.Vector3();
  private heading = 0;
  private pitch = 38;
  private dist = 40;
  private readonly keys = new Set<string>();
  private readonly mouse = new THREE.Vector2();
  private mouseInCanvas = false;
  private drag: { kind: 'rotate' | 'pan'; x: number; y: number } | null = null;
  private lastT = 0;
  private readonly raycaster = new THREE.Raycaster();

  // DOM.
  private readonly ui = el('div', 'map-editor');
  private readonly list = el('div', 'me-list');
  private readonly inspector = el('div', 'me-inspector');
  private readonly status = el('div', 'me-status');
  private readonly title = el('div', 'me-title');
  private readonly report = el('div', 'me-report');
  private readonly toastEl = el('div', 'me-toast');
  private toastTimer = 0;

  constructor(private readonly app: GraaoApp) {
    this.map = JSON.parse(JSON.stringify(GRAAO_MAP)) as GraaoMap;
    this.map.waypoints ??= [];
    this.map.trails ??= [];
    this.baseVersion = this.map.mapVersion;
  }

  // ------------------------------------------------------------------------------------------------ start

  start(): void {
    const app = this.app;
    (document.getElementById('ui') as HTMLElement).style.display = 'none';
    app.input.enabled = false;
    app.character.root.visible = false;
    app.interactives.view.group.visible = false;
    app.loot.view.group.visible = false;
    // The loaded world's kit and classic structures give way to the editor's own copy of the map.
    const planet = app.planet;
    for (const m of planet.kitMeshes) planet.group.remove(m);
    for (const c of [...planet.group.children]) {
      if ((c as THREE.Mesh).material === planet.kitWaterMaterial) planet.group.remove(c);
      if (/^props:(house|tower|giant_tree|arch|crystal_cluster|floating_shard|lamp|well|wall)/.test(c.name)) planet.group.remove(c);
    }
    this.root.name = 'map-editor';
    this.root.add(this.kitGroup, this.markerGroup, this.overlay);
    app.r.scene.add(this.root);
    this.restoreView();
    this.buildUi();
    this.bindInput();
    this.rebuild();
    app.r.renderer.setAnimationLoop((t) => this.frame(t));
    window.addEventListener('beforeunload', (e) => {
      this.saveView();
      if (this.dirty) e.preventDefault();
    });
    (window as unknown as { __editor: MapEditor }).__editor = this;
  }

  // ------------------------------------------------------------------------------------------------ frame

  private frame(t: number): void {
    const dt = Math.min(0.1, this.lastT ? (t - this.lastT) / 1000 : 0.016);
    this.lastT = t;
    if (this.rebuildPending) this.rebuild();
    if (this.markersPending) this.buildMarkers();
    this.moveCamera(dt);
    this.placeCamera();
    if (this.overlayPending || (this.showColliders && (!this.colliderCenter || this.colliderCenter.distanceTo(this.target) > 8))) this.buildOverlay();
    if ((this.placing || this.grabbing) && this.mouseInCanvas && t - this.lastHover > 50) {
      this.lastHover = t;
      this.updateHover();
    }
    const app = this.app;
    const time = t / 1000;
    app.r.updateSun(this.target, time);
    app.planet.update(time, this.target, app.r.sunDir);
    const orbit = app.r.setAltitude(R);
    app.planet.setOrbit(orbit, app.r.sunDir, app.r.camera.position.length() - R);
    app.planet.cullHorizon(app.r.camera.position);
    app.r.render();
  }

  // ------------------------------------------------------------------------------------------------ camera

  private restoreView(): void {
    type View = { lat: number; lon: number; heading: number; pitch: number; dist: number };
    let v: View | null = null;
    try {
      v = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? 'null') as View | null;
    } catch {
      v = null;
    }
    const lat = v?.lat ?? 8;
    const lon = v?.lon ?? 0;
    this.heading = v?.heading ?? 0;
    this.pitch = v?.pitch ?? 38;
    this.dist = v?.dist ?? 45;
    this.target.copy(v3of(this.app.world.terrain.surfaceAt(latLonToDir(lat, lon))));
  }

  private saveView(): void {
    const { lat, lon } = dirToLatLon(this.target);
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ lat, lon, heading: this.heading, pitch: this.pitch, dist: this.dist }));
    } catch {
      /* private mode: the view is not remembered */
    }
  }

  private frameAxes(): { up: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3 } {
    const up = this.target.clone().normalize();
    const f = headingTangent(up, this.heading);
    const fwd = new THREE.Vector3(f.x, f.y, f.z);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    return { up, fwd, right };
  }

  private moveCamera(dt: number): void {
    if (!this.keys.size) return;
    const { fwd, right } = this.frameAxes();
    const speed = THREE.MathUtils.clamp(this.dist * 0.9, 6, 90) * (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.5 : 1);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW')) move.add(fwd);
    if (this.keys.has('KeyS')) move.sub(fwd);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (move.lengthSq() < 1e-6) return;
    this.moveTarget(move.normalize().multiplyScalar(speed * dt));
  }

  private moveTarget(delta: THREE.Vector3): void {
    const p = this.target.clone().add(delta).normalize();
    this.target.copy(v3of(this.app.world.terrain.surfaceAt(p)));
  }

  private placeCamera(): void {
    const { up, fwd } = this.frameAxes();
    const cam = this.app.r.camera;
    const p = this.pitch * DEG;
    cam.position.copy(this.target).addScaledVector(fwd, -Math.cos(p) * this.dist).addScaledVector(up, Math.sin(p) * this.dist + 1.2);
    cam.up.copy(up);
    cam.lookAt(this.target.clone().addScaledVector(up, 1.2));
    if (cam.fov !== 55) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
  }

  private focusSelection(): void {
    const p = this.selectionPoint();
    if (!p) return;
    this.target.copy(v3of(this.app.world.terrain.surfaceAt(p.clone().normalize())));
    this.dist = Math.min(this.dist, 30);
  }

  // ------------------------------------------------------------------------------------------------ edits

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(this.map));
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private changed(what: 'layout' | 'markers' | 'both' = 'layout'): void {
    this.dirty = true;
    if (what !== 'markers') this.rebuildPending = true;
    if (what !== 'layout') this.markersPending = true;
    this.overlayPending = true;
    this.refreshTitle();
    this.renderInspector();
  }

  private undo(redo = false): void {
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    const snap = from.pop();
    if (!snap) return;
    to.push(JSON.stringify(this.map));
    this.map = JSON.parse(snap) as GraaoMap;
    if (this.sel && !this.findSelected()) this.sel = null;
    this.changed('both');
    this.toast(redo ? 'Refeito' : 'Desfeito');
  }

  private placementById(id: string): MapPlacement | undefined {
    return this.map.placements.find((p) => p.id === id);
  }

  private findSelected(): MapPlacement | ChestSpotDef | MapWaypoint | undefined {
    if (!this.sel) return undefined;
    const id = this.sel.id;
    if (this.sel.kind === 'placement') return this.placementById(id);
    if (this.sel.kind === 'chest') return this.map.chestSpots.find((c) => c.id === id);
    return this.map.waypoints!.find((w) => w.id === id);
  }

  private uniqueId(base: string, taken: (id: string) => boolean): string {
    const clean = base.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    for (let n = 1; ; n++) {
      const id = `${clean}-${n}`;
      if (!taken(id)) return id;
    }
  }

  /** Height above the terrain of a world point (m). */
  private heightAbove(p: THREE.Vector3): number {
    const d = p.clone().normalize();
    return p.length() - (R + this.app.world.terrain.heightAt(d));
  }

  private addPlacement(prefab: string, hit: Hit): void {
    const dir = hit.point.clone().normalize();
    const { lat, lon } = dirToLatLon(dir);
    const region = regionAt(dir)?.key ?? 'trilhas';
    const id = this.uniqueId(`${region}-${prefab}`, (x) => !!this.placementById(x));
    const p: MapPlacement = { id, prefab, lat: round(lat, 5), lon: round(lon, 5), yaw: round(this.placeYaw, 2), region };
    const h = this.heightAbove(hit.point);
    if (KIT_PREFABS[prefab] && hit.kind === 'placement' && h > 0.2) p.lift = round(h, 3);
    this.pushUndo();
    this.map.placements.push(p);
    this.sel = { kind: 'placement', id };
    this.changed();
    this.toast(`${id} colocado`);
  }

  private addChest(hit: Hit): void {
    const dir = hit.point.clone().normalize();
    const { lat, lon } = dirToLatLon(dir);
    const r = regionAt(dir);
    const region = r && CHEST_REGIONS.some((c) => c.name === r.name) ? r.name : 'Trilhas';
    const id = this.uniqueId(`${r?.key ?? 'trilha'}-bau`, (x) => this.map.chestSpots.some((c) => c.id === x));
    const h = this.heightAbove(hit.point);
    const c: ChestSpotDef = { id, region, lat: round(lat, 5), lon: round(lon, 5), hint: 'novo ponto de baú (editor)', yaw: round(this.placeYaw, 1) };
    if (hit.kind === 'placement' && h > 0.3) {
      c.surface = 'prop';
      c.height = round(h, 2);
    }
    this.pushUndo();
    this.map.chestSpots.push(c);
    this.sel = { kind: 'chest', id };
    this.changed('markers');
  }

  private addWaypoint(hit: Hit): void {
    const dir = hit.point.clone().normalize();
    const { lat, lon } = dirToLatLon(dir);
    const region = regionAt(dir)?.key ?? 'trilhas';
    const id = this.uniqueId(`wp-${region}`, (x) => this.map.waypoints!.some((w) => w.id === x));
    const h = this.heightAbove(hit.point);
    const w: MapWaypoint = { id, lat: round(lat, 5), lon: round(lon, 5), links: [], region, kind: h > 0.6 ? 'telhado' : 'rua' };
    if (h > 0.25) w.height = round(h, 2);
    this.pushUndo();
    const prev = this.sel?.kind === 'waypoint' ? this.map.waypoints!.find((x) => x.id === this.sel!.id) : undefined;
    if (prev) {
      prev.links.push(id);
      w.links.push(prev.id);
    }
    this.map.waypoints!.push(w);
    this.sel = { kind: 'waypoint', id };
    this.changed('markers');
  }

  private toggleLink(a: string, b: string): void {
    if (a === b) return;
    const wa = this.map.waypoints!.find((w) => w.id === a);
    const wb = this.map.waypoints!.find((w) => w.id === b);
    if (!wa || !wb) return;
    this.pushUndo();
    const linked = wa.links.includes(b) || wb.links.includes(a);
    wa.links = wa.links.filter((l) => l !== b);
    wb.links = wb.links.filter((l) => l !== a);
    if (!linked) {
      wa.links.push(b);
      wb.links.push(a);
    }
    this.changed('markers');
    this.toast(linked ? `${a} ✕ ${b}` : `${a} ↔ ${b}`);
  }

  /** Moves the selection to a hit point (grab) or by a tangent offset (arrows). */
  private moveSelectionTo(point: THREE.Vector3, onProp: boolean): void {
    const s = this.findSelected();
    if (!s) return;
    const dir = point.clone().normalize();
    const { lat, lon } = dirToLatLon(dir);
    s.lat = round(lat, 5);
    s.lon = round(lon, 5);
    const h = this.heightAbove(point);
    if (this.sel!.kind === 'placement') {
      const p = s as MapPlacement;
      if (KIT_PREFABS[p.prefab] && onProp && h > 0.2) p.lift = round(h, 3);
      else if (onProp === false && p.lift && !KIT_BUILDINGS[p.prefab]) delete p.lift;
      this.changed();
    } else if (this.sel!.kind === 'chest') {
      const c = s as ChestSpotDef;
      if (onProp && h > 0.3) {
        c.surface = 'prop';
        c.height = round(h, 2);
      } else {
        delete c.surface;
        delete c.height;
      }
      this.changed('markers');
    } else {
      const w = s as MapWaypoint;
      if (h > 0.25) w.height = round(h, 2);
      else delete w.height;
      this.changed('markers');
    }
  }

  private nudge(dx: number, dz: number): void {
    const p = this.selectionPoint();
    if (!p) return;
    const { fwd, right } = this.frameAxes();
    this.pushUndo();
    const q = p.clone().addScaledVector(right, dx).addScaledVector(fwd, dz);
    const s = this.findSelected()!;
    const { lat, lon } = dirToLatLon(q.normalize());
    s.lat = round(lat, 5);
    s.lon = round(lon, 5);
    this.changed(this.sel!.kind === 'placement' ? 'layout' : 'markers');
  }

  private turn(deg: number): void {
    const s = this.findSelected();
    if (this.placing || !s || this.sel!.kind === 'waypoint') {
      // Nothing to turn: the next placement's rotation.
      this.placeYaw = (this.placeYaw + deg + 360) % 360;
      this.updateGhost();
      if (!this.sel) this.renderInspector();
      return;
    }
    this.pushUndo();
    const o = s as MapPlacement | ChestSpotDef;
    o.yaw = round((((o.yaw ?? 0) + deg) % 360 + 360) % 360, 2);
    this.changed(this.sel!.kind === 'placement' ? 'layout' : 'markers');
  }

  private rescale(f: number): void {
    if (this.sel?.kind !== 'placement') return;
    const p = this.placementById(this.sel.id)!;
    const k = KIT_PREFABS[p.prefab];
    const range: [number, number] = k?.scale ?? (STRUCTURE_PREFABS[p.prefab] ? [0.5, 2] : [1, 1]);
    const s = THREE.MathUtils.clamp(round((p.scale ?? 1) * f, 3), range[0], range[1]);
    if (s === (p.scale ?? 1)) {
      this.toast(range[0] === range[1] ? 'Esta peça tem escala fixa' : `Escala entre ${range[0]} e ${range[1]}`);
      return;
    }
    this.pushUndo();
    if (Math.abs(s - 1) < 1e-6) delete p.scale;
    else p.scale = s;
    this.changed();
  }

  private raise(dh: number): void {
    const s = this.findSelected();
    if (!s) return;
    this.pushUndo();
    if (this.sel!.kind === 'placement') {
      const p = s as MapPlacement;
      const l = round((p.lift ?? 0) + dh, 3);
      if (Math.abs(l) < 1e-6) delete p.lift;
      else p.lift = l;
      this.changed();
    } else {
      const o = s as ChestSpotDef | MapWaypoint;
      const h = Math.max(0, round((o.height ?? 0) + dh, 2));
      o.height = h;
      if (this.sel!.kind === 'chest') (o as ChestSpotDef).surface = h > 0 ? 'prop' : 'terrain';
      this.changed('markers');
    }
  }

  private duplicate(): void {
    const s = this.findSelected();
    if (!s || !this.sel) return;
    this.pushUndo();
    const { right } = this.frameAxes();
    const at = this.selectionPoint()!.clone().addScaledVector(right, 2.5).normalize();
    const { lat, lon } = dirToLatLon(at);
    if (this.sel.kind === 'placement') {
      const p = { ...(s as MapPlacement), lat: round(lat, 5), lon: round(lon, 5) };
      p.id = this.uniqueId(p.id.replace(/-\d+$/, ''), (x) => !!this.placementById(x));
      this.map.placements.push(p);
      this.sel = { kind: 'placement', id: p.id };
      this.changed();
    } else if (this.sel.kind === 'chest') {
      const c = { ...(s as ChestSpotDef), lat: round(lat, 5), lon: round(lon, 5) };
      c.id = this.uniqueId(c.id.replace(/-\d+$/, ''), (x) => this.map.chestSpots.some((q) => q.id === x));
      this.map.chestSpots.push(c);
      this.sel = { kind: 'chest', id: c.id };
      this.changed('markers');
    } else {
      const w = { ...(s as MapWaypoint), lat: round(lat, 5), lon: round(lon, 5), links: [(s as MapWaypoint).id] };
      w.id = this.uniqueId(w.id.replace(/-\d+$/, ''), (x) => this.map.waypoints!.some((q) => q.id === x));
      (s as MapWaypoint).links.push(w.id);
      this.map.waypoints!.push(w);
      this.sel = { kind: 'waypoint', id: w.id };
      this.changed('markers');
    }
  }

  private remove(): void {
    if (!this.sel || !this.findSelected()) return;
    this.pushUndo();
    const id = this.sel.id;
    if (this.sel.kind === 'placement') {
      this.map.placements = this.map.placements.filter((p) => p.id !== id);
      this.sel = null;
      this.changed();
    } else if (this.sel.kind === 'chest') {
      this.map.chestSpots = this.map.chestSpots.filter((c) => c.id !== id);
      this.sel = null;
      this.changed('markers');
    } else {
      this.map.waypoints = this.map.waypoints!.filter((w) => w.id !== id);
      for (const w of this.map.waypoints) w.links = w.links.filter((l) => l !== id);
      this.sel = null;
      this.changed('markers');
    }
    this.toast(`${id} apagado`);
  }

  // ------------------------------------------------------------------------------------------------ world views

  private cellOf(up: Vec3): number {
    let best = 0;
    let bd = -2;
    for (let i = 0; i < this.cellDirs.length; i++) {
      const c = this.cellDirs[i]!;
      const d = c.x * up.x + c.y * up.y + c.z * up.z;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Resolves the edited map (no scatter) and rebakes the cells and structures whose placements changed. */
  private rebuild(): void {
    this.rebuildPending = false;
    const app = this.app;
    this.layout = buildLayout(app.world.terrain, { includeVisual: true, scatter: false }, this.map);
    const json = new Map(this.map.placements.map((p) => [p.id, JSON.stringify(p)]));
    const byCell = new Map<number, Placement[]>();
    const structures: Placement[] = [];
    for (const p of this.layout.placements) {
      if (p.kind !== 'kit') {
        structures.push(p);
        continue;
      }
      const c = this.cellOf(p.up);
      (byCell.get(c) ?? byCell.set(c, []).get(c)!).push(p);
    }
    for (const c of new Set([...byCell.keys(), ...this.cells.keys()])) {
      const list = byCell.get(c) ?? [];
      const sig = [...new Set(list.map((p) => p.mapId!))].sort().map((id) => json.get(id)).join('\n');
      const old = this.cells.get(c);
      if (old && old.sig === sig) continue;
      if (old) for (const m of old.meshes) this.disposeMesh(m);
      if (!list.length) {
        this.cells.delete(c);
        continue;
      }
      const meshes: THREE.Mesh[] = [];
      const water = list.filter((p) => KIT_PREFABS[p.prefab!]?.material === 'water');
      const solid = list.filter((p) => KIT_PREFABS[p.prefab!]?.material !== 'water');
      for (const [items, mat] of [[solid, app.planet.kitMaterial], [water, app.planet.kitWaterMaterial]] as const) {
        if (!items.length) continue;
        const baked = buildKitChunks(items, mat, () => 0, { allRefs: true });
        for (const mesh of baked.meshes) {
          if (mat === app.planet.kitWaterMaterial) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.renderOrder = 9;
          }
          this.kitGroup.add(mesh);
          meshes.push(mesh);
          this.ranges.set(mesh, []);
        }
        for (const ref of baked.refs.values()) this.ranges.get(ref.mesh)!.push({ start: ref.start, count: ref.count, mapId: ref.placement.mapId! });
        for (const mesh of baked.meshes) this.ranges.get(mesh)!.sort((a, b) => a.start - b.start);
      }
      this.cells.set(c, { sig, meshes });
    }
    // Classic structures: one instanced mesh each (they are few).
    const seen = new Set<string>();
    for (const p of structures) {
      const id = p.mapId!;
      seen.add(id);
      const sig = json.get(id) ?? '';
      const old = this.structs.get(id);
      if (old && old.sig === sig) continue;
      if (old) this.disposeMesh(old.mesh);
      const mesh = this.structureMesh(p);
      mesh.userData.mapId = id;
      this.kitGroup.add(mesh);
      this.structs.set(id, { sig, mesh });
    }
    for (const [id, s] of this.structs) {
      if (seen.has(id)) continue;
      this.disposeMesh(s.mesh);
      this.structs.delete(id);
    }
    this.overlayPending = true;
    this.refreshTitle();
  }

  private disposeMesh(m: THREE.Object3D): void {
    this.kitGroup.remove(m);
    this.ranges.delete(m);
    if (m instanceof THREE.Mesh && !(m instanceof THREE.InstancedMesh)) m.geometry.dispose();
  }

  private structureGeometry(p: Placement): { g: THREE.BufferGeometry; mat: THREE.Material } {
    const planet = this.app.planet;
    const key = p.kind === 'house' ? `house:${p.variant % 3}` : p.kind;
    let g = this.structGeo.get(key);
    if (!g) {
      switch (p.kind) {
        case 'house': g = G.houseGeometry(p.variant % 3); break;
        case 'tower': g = G.towerGeometry(); break;
        case 'giant_tree': g = G.giantTreeGeometry(); break;
        case 'arch': g = G.archGeometry(); break;
        case 'crystal_cluster': g = G.crystalClusterGeometry(); break;
        case 'floating_shard': g = G.floatingShardGeometry(); break;
        case 'lamp': g = G.lampGeometry(); break;
        case 'well': g = G.wellGeometry(); break;
        default: g = G.wallGeometry(); break;
      }
      g = g.clone();
      g.setAttribute('instanceFade', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
      this.structGeo.set(key, g);
    }
    const mat = p.kind === 'giant_tree' ? planet.foliageMaterial : p.kind === 'crystal_cluster' ? planet.crystalMaterial : planet.propMaterial;
    return { g, mat };
  }

  private structureMesh(p: Placement): THREE.InstancedMesh {
    const { g, mat } = this.structureGeometry(p);
    const mesh = new THREE.InstancedMesh(g, mat, 1);
    const m = new THREE.Matrix4().makeBasis(v3of(p.side), v3of(p.up), v3of(p.forward)).scale(new THREE.Vector3(p.scale, p.scale, p.scale)).setPosition(p.position.x, p.position.y, p.position.z);
    mesh.setMatrixAt(0, m);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  /** Chest spots (gold boxes, red when the server would refuse them) and waypoints (cyan balls, their links). */
  private buildMarkers(): void {
    this.markersPending = false;
    for (const c of [...this.markerGroup.children]) {
      this.markerGroup.remove(c);
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) c.geometry.dispose();
    }
    const world = this.app.world;
    const chestGeo = new THREE.BoxGeometry(0.9, 0.6, 0.6).translate(0, 0.3, 0);
    for (const def of this.map.chestSpots) {
      const spot = resolveChestSpot(world, def);
      const selected = this.sel?.kind === 'chest' && this.sel.id === def.id;
      const mat = new THREE.MeshBasicMaterial({ color: selected ? 0xffffff : spot.ok ? 0xf2c14e : 0xe0473a });
      const mesh = new THREE.Mesh(chestGeo, mat);
      const up = v3of(spot.up);
      const f = v3of(spot.forward);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeBasis(new THREE.Vector3().crossVectors(up, f), up, f).setPosition(spot.pos.x, spot.pos.y, spot.pos.z);
      mesh.userData = { chest: def.id };
      this.markerGroup.add(mesh);
    }
    const ballGeo = new THREE.IcosahedronGeometry(0.35, 1);
    const pos = new Map<string, THREE.Vector3>();
    for (const w of this.map.waypoints!) {
      const p = this.waypointPoint(w);
      pos.set(w.id, p);
      const selected = this.sel?.kind === 'waypoint' && this.sel.id === w.id;
      const mesh = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: selected ? 0xffffff : 0x4fd6e8 }));
      mesh.position.copy(p).addScaledVector(p.clone().normalize(), 0.35);
      mesh.userData = { waypoint: w.id };
      this.markerGroup.add(mesh);
    }
    const seg: number[] = [];
    for (const w of this.map.waypoints!) {
      const a = pos.get(w.id)!;
      for (const l of w.links) {
        const b = pos.get(l);
        if (!b || l < w.id) continue;
        const ua = a.clone().normalize();
        const ub = b.clone().normalize();
        seg.push(a.x + ua.x * 0.35, a.y + ua.y * 0.35, a.z + ua.z * 0.35, b.x + ub.x * 0.35, b.y + ub.y * 0.35, b.z + ub.z * 0.35);
      }
    }
    if (seg.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      this.markerGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4fd6e8, depthTest: false, transparent: true })));
    }
  }

  private waypointPoint(w: MapWaypoint): THREE.Vector3 {
    const d = latLonToDir(w.lat, w.lon);
    return v3of(d).multiplyScalar(R + this.app.world.terrain.heightAt(d) + (w.height ?? 0));
  }

  /** Collider wireframes near the camera, the selection's colliders and the painted trails. */
  private buildOverlay(): void {
    this.overlayPending = false;
    for (const l of [this.colliderLines, this.selectionLines]) {
      if (!l) continue;
      this.overlay.remove(l);
      l.geometry.dispose();
    }
    this.colliderLines = null;
    this.selectionLines = null;
    if (this.showColliders) {
      this.colliderCenter = this.target.clone();
      const pos: number[] = [];
      const col: number[] = [];
      const range = Math.max(30, Math.min(70, this.dist * 1.4));
      const near = (p: Placement) => v3of(p.position).distanceTo(this.target) < range + p.radius;
      const kit = this.layout.placements.filter((p) => p.colliders.length && near(p));
      const wild = this.app.world.layout.placements.filter((p) => p.kind !== 'kit' && !p.mapId && p.colliders.length && near(p));
      for (const p of kit) addColliderLines(p, pos, col, (c) => (c.block === 'move' ? [0.31, 0.84, 0.91] : [0.98, 0.55, 0.2]));
      for (const p of wild) addColliderLines(p, pos, col, () => [0.45, 0.85, 0.35]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      this.colliderLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
      this.overlay.add(this.colliderLines);
    }
    if (this.sel?.kind === 'placement') {
      const pos: number[] = [];
      const col: number[] = [];
      for (const p of this.layout.placements) if (p.mapId === this.sel.id) addColliderLines(p, pos, col, () => [1, 0.93, 0.3]);
      const mp = this.placementById(this.sel.id);
      if (mp) {
        // A ring on the ground and an arrow along the placement's front.
        const up = latLonToDir(mp.lat, mp.lon);
        const base = v3of(this.app.world.terrain.surfaceAt(up)).addScaledVector(v3of(up), (mp.lift ?? 0) + 0.08);
        const f = v3of(headingTangent(up, mp.yaw));
        const s = new THREE.Vector3().crossVectors(v3of(up), f);
        const r = 1.2;
        for (let i = 0; i < 24; i++) {
          const a0 = (i / 24) * Math.PI * 2;
          const a1 = ((i + 1) / 24) * Math.PI * 2;
          const p0 = base.clone().addScaledVector(f, Math.cos(a0) * r).addScaledVector(s, Math.sin(a0) * r);
          const p1 = base.clone().addScaledVector(f, Math.cos(a1) * r).addScaledVector(s, Math.sin(a1) * r);
          pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
          col.push(1, 0.93, 0.3, 1, 0.93, 0.3);
        }
        const tip = base.clone().addScaledVector(f, 2.6);
        pos.push(base.x, base.y, base.z, tip.x, tip.y, tip.z);
        col.push(1, 1, 1, 1, 1, 1);
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        this.selectionLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
        this.selectionLines.renderOrder = 20;
        this.overlay.add(this.selectionLines);
      }
    }
    if (this.trailLines) {
      this.overlay.remove(this.trailLines);
      this.trailLines.traverse((o) => (o as THREE.Line).geometry?.dispose());
      this.trailLines = null;
    }
    if (this.showTrails && this.map.trails!.length) {
      this.trailLines = new THREE.Group();
      const terrain = this.app.world.terrain;
      for (const t of this.map.trails!) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < t.points.length - 1; i++) {
          const a = v3of(latLonToDir(t.points[i]![0], t.points[i]![1]));
          const b = v3of(latLonToDir(t.points[i + 1]![0], t.points[i + 1]![1]));
          const n = Math.max(2, Math.ceil(a.angleTo(b) * R));
          for (let k = i ? 1 : 0; k <= n; k++) {
            const d = a.clone().lerp(b, k / n).normalize();
            pts.push(v3of(terrain.surfaceAt(d)).addScaledVector(d, 0.15));
          }
        }
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe0904a }));
        line.userData.trail = t.id;
        this.trailLines.add(line);
      }
      this.overlay.add(this.trailLines);
    }
    this.updateGhost();
  }

  // ------------------------------------------------------------------------------------------------ picking

  private pick(e?: { clientX: number; clientY: number }, o: { skipSelected?: boolean; terrainOnly?: boolean } = {}): Hit | null {
    const canvas = this.app.r.canvas;
    const rect = canvas.getBoundingClientRect();
    if (e) this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const cam = this.app.r.camera;
    this.raycaster.setFromCamera(this.mouse, cam);
    const ray = this.raycaster.ray;
    let best: Hit | null = null;
    const t = this.app.world.physics.castRay(ray.origin, ray.direction, 2000, GROUPS_TERRAIN_QUERY);
    if (t) best = { point: ray.origin.clone().addScaledVector(ray.direction, t.toi), dist: t.toi, kind: 'terrain' };
    if (o.terrainOnly) return best;
    const targets: THREE.Object3D[] = [...this.kitGroup.children];
    if (this.markerGroup.visible) targets.push(...this.markerGroup.children.filter((c) => c instanceof THREE.Mesh));
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      if (best && h.distance >= best.dist) break;
      const obj = h.object;
      let hit: Hit | null = null;
      if (obj.userData.chest) hit = { point: h.point, dist: h.distance, kind: 'chest', id: obj.userData.chest as string };
      else if (obj.userData.waypoint) hit = { point: h.point, dist: h.distance, kind: 'waypoint', id: obj.userData.waypoint as string };
      else if (obj.userData.mapId) hit = { point: h.point, dist: h.distance, kind: 'placement', id: obj.userData.mapId as string };
      else {
        const list = this.ranges.get(obj);
        const v = h.face ? h.face.a : -1;
        if (list && v >= 0) {
          let lo = 0;
          let hi = list.length - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (list[mid]!.start <= v) lo = mid;
            else hi = mid - 1;
          }
          const r = list[lo];
          if (r && v < r.start + r.count) hit = { point: h.point, dist: h.distance, kind: 'placement', id: r.mapId };
        }
      }
      if (!hit) continue;
      if (o.skipSelected && this.sel && hit.id === this.sel.id) continue;
      best = hit;
      break;
    }
    return best;
  }

  private selectionPoint(): THREE.Vector3 | null {
    const s = this.findSelected();
    if (!s) return null;
    const d = latLonToDir(s.lat, s.lon);
    const h = this.sel!.kind === 'placement' ? ((s as MapPlacement).lift ?? 0) : ((s as ChestSpotDef).height ?? 0);
    return v3of(d).multiplyScalar(R + this.app.world.terrain.heightAt(d) + h);
  }

  private updateHover(): void {
    this.hover = this.pick(undefined, { skipSelected: this.grabbing });
    if (this.grabbing && this.hover) {
      this.moveSelectionTo(this.hover.point, this.hover.kind === 'placement');
      return;
    }
    this.updateGhost();
  }

  private updateGhost(): void {
    if (this.ghost) {
      this.root.remove(this.ghost);
      this.ghost = null;
    }
    const id = this.placing;
    if (!id || !this.hover) return;
    const group = new THREE.Group();
    const addPrefab = (pid: string, x: number, y: number, z: number, yaw: number) => {
      const g = kitPrefabGeometry(pid);
      if (!g.getAttribute('position')) return;
      const m = new THREE.Mesh(g, this.ghostMaterial);
      m.position.set(x, y, z);
      m.rotation.y = -yaw * DEG;
      group.add(m);
    };
    if (KIT_PREFABS[id]) addPrefab(id, 0, 0, 0, 0);
    else if (KIT_BUILDINGS[id]) for (const p of KIT_BUILDINGS[id]!.pieces) addPrefab(p.prefab, p.x, p.y ?? 0, p.z, p.yaw ?? 0);
    else if (STRUCTURE_PREFABS[id]) {
      const kind = STRUCTURE_PREFABS[id]!.kind;
      const fake = { kind, variant: 0 } as unknown as Placement;
      group.add(new THREE.Mesh(this.structureGeometry(fake).g, this.ghostMaterial));
    }
    const up = this.hover.point.clone().normalize();
    const f = v3of(headingTangent(up, this.placeYaw));
    const side = new THREE.Vector3().crossVectors(up, f);
    group.matrixAutoUpdate = false;
    group.matrix.makeBasis(side, up, f).setPosition(this.hover.point);
    this.ghost = group;
    this.root.add(group);
  }

  // ------------------------------------------------------------------------------------------------ input

  private bindInput(): void {
    const canvas = this.app.r.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerenter', () => (this.mouseInCanvas = true));
    canvas.addEventListener('pointerleave', () => (this.mouseInCanvas = false));
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 2 || e.button === 1) {
        this.drag = { kind: e.button === 1 || e.shiftKey ? 'pan' : 'rotate', x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button !== 0) return;
      this.onClick(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.mouseInCanvas = true;
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        if (this.drag.kind === 'rotate') {
          this.heading = (this.heading + dx * 0.3 + 360) % 360;
          this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.25, 4, 89);
        } else {
          const { fwd, right } = this.frameAxes();
          const k = this.dist * 0.0018;
          this.moveTarget(right.multiplyScalar(-dx * k).addScaledVector(fwd, dy * k));
        }
      }
      const hit = this.pick(undefined, { terrainOnly: true });
      if (hit) {
        const { lat, lon } = dirToLatLon(hit.point.clone().normalize());
        const r = regionAt(hit.point.clone().normalize());
        this.status.textContent = `lat ${lat.toFixed(3)} · lon ${lon.toFixed(3)} · ${r?.name ?? 'campo aberto'} · altura ${this.app.world.terrain.heightAt(hit.point.clone().normalize()).toFixed(2)} m`;
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (this.drag && (e.button === 2 || e.button === 1)) this.drag = null;
      canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = THREE.MathUtils.clamp(this.dist * Math.pow(1.0015, e.deltaY), 3, 420);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private onClick(e: PointerEvent): void {
    if (this.grabbing) {
      this.grabbing = false;
      this.toast('Posição confirmada');
      this.renderInspector();
      return;
    }
    const hit = this.pick(e);
    if (!hit) return;
    if (this.placing && this.mode === 'pecas') {
      this.addPlacement(this.placing, hit);
      if (!e.shiftKey) this.setPlacing(null);
      return;
    }
    // Baús: a click anywhere but on a chest makes a new chest spot there (on the ground, a floor or a roof).
    if (this.mode === 'baus' && hit.kind !== 'chest') {
      this.addChest(hit);
      return;
    }
    if (this.mode === 'waypoints' && hit.kind !== 'waypoint') {
      this.addWaypoint(hit);
      return;
    }
    if (this.mode === 'waypoints' && hit.kind === 'waypoint' && e.shiftKey && this.sel?.kind === 'waypoint') {
      this.toggleLink(this.sel.id, hit.id!);
      return;
    }
    if (hit.kind === 'terrain') this.select(null);
    else this.select({ kind: hit.kind, id: hit.id! });
  }

  private onKey(e: KeyboardEvent): void {
    const typing = e.target instanceof HTMLElement && !!e.target.closest('input, textarea, select');
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyS') {
      e.preventDefault();
      void this.save();
      return;
    }
    if (typing) return;
    if (ctrl && e.code === 'KeyZ') {
      e.preventDefault();
      this.undo(e.shiftKey);
      return;
    }
    if (ctrl && e.code === 'KeyY') {
      e.preventDefault();
      this.undo(true);
      return;
    }
    if (ctrl && e.code === 'KeyD') {
      e.preventDefault();
      this.duplicate();
      return;
    }
    if (ctrl) return;
    const fine = e.shiftKey;
    switch (e.code) {
      case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD': case 'ShiftLeft': case 'ShiftRight':
        this.keys.add(e.code);
        return;
      case 'Escape':
        if (this.grabbing) {
          this.grabbing = false;
          this.undo();
        } else if (this.placing) this.setPlacing(null);
        else this.select(null);
        return;
      case 'Delete': case 'Backspace':
        e.preventDefault();
        this.remove();
        return;
      case 'KeyQ': this.turn(fine ? -1 : -15); return;
      case 'KeyE': this.turn(fine ? 1 : 15); return;
      case 'Equal': case 'NumpadAdd': this.rescale(1.05); return;
      case 'Minus': case 'NumpadSubtract': this.rescale(1 / 1.05); return;
      case 'PageUp': e.preventDefault(); this.raise(fine ? 0.5 : 0.1); return;
      case 'PageDown': e.preventDefault(); this.raise(fine ? -0.5 : -0.1); return;
      case 'KeyG':
        if (this.sel) {
          this.pushUndo();
          this.grabbing = true;
          this.toast('Movendo: clique para soltar, Esc cancela');
        }
        return;
      case 'KeyF': this.focusSelection(); return;
      case 'KeyC': this.setColliders(!this.showColliders); return;
      case 'KeyT':
        this.showTrails = !this.showTrails;
        this.overlayPending = true;
        return;
      case 'ArrowLeft': e.preventDefault(); this.nudge(fine ? -1 : -0.25, 0); return;
      case 'ArrowRight': e.preventDefault(); this.nudge(fine ? 1 : 0.25, 0); return;
      case 'ArrowUp': e.preventDefault(); this.nudge(0, fine ? 1 : 0.25); return;
      case 'ArrowDown': e.preventDefault(); this.nudge(0, fine ? -1 : -0.25); return;
      case 'Digit1': this.setMode('pecas'); return;
      case 'Digit2': this.setMode('baus'); return;
      case 'Digit3': this.setMode('waypoints'); return;
    }
  }

  private select(s: Selection): void {
    this.sel = s;
    this.grabbing = false;
    this.overlayPending = true;
    this.markersPending = true;
    this.renderInspector();
  }

  private setPlacing(id: string | null): void {
    this.placing = id;
    this.hover = null;
    this.updateGhost();
    this.renderList();
    if (id) this.toast(`Clique no planeta para colocar ${id} (Shift: vários, Q/E gira, Esc cancela)`);
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.setPlacing(null);
    this.markersPending = true;
    this.buildUiTabs();
    this.renderList();
  }

  private setColliders(on: boolean): void {
    this.showColliders = on;
    this.overlayPending = true;
    this.colliderButton.classList.toggle('on', on);
  }

  // ------------------------------------------------------------------------------------------------ save

  /** Problems that block a save, and warnings worth a look (buildings on slopes, refused chest spots). */
  private check(): { problems: string[]; warnings: { text: string; sel?: Selection }[] } {
    const problems = validateMap(this.map);
    const warnings: { text: string; sel?: Selection }[] = [];
    const terrain = this.app.world.terrain;
    for (const p of this.map.placements) {
      const b = KIT_BUILDINGS[p.prefab];
      if (!b) continue;
      for (const w of buildingSite(terrain, b, p).warnings) warnings.push({ text: `${p.id}: ${w}`, sel: { kind: 'placement', id: p.id } });
    }
    for (const c of this.map.chestSpots) {
      const s = resolveChestSpot(this.app.world, c);
      if (!s.ok) warnings.push({ text: `baú ${c.id}: ${s.reason}`, sel: { kind: 'chest', id: c.id } });
      else if (s.moved > 1.5) warnings.push({ text: `baú ${c.id}: o servidor o empurra ${s.moved.toFixed(1)} m`, sel: { kind: 'chest', id: c.id } });
    }
    return { problems, warnings };
  }

  private showReport(): void {
    const { problems, warnings } = this.check();
    this.report.replaceChildren();
    this.report.hidden = false;
    const head = el('div', 'me-report-head');
    head.append(el('strong', '', problems.length ? 'O mapa tem erros' : 'Mapa válido'), button('Fechar', () => (this.report.hidden = true)));
    this.report.append(head);
    for (const p of problems) this.report.append(el('div', 'me-err', p));
    if (!warnings.length && !problems.length) this.report.append(el('div', 'me-ok', 'Nenhum aviso: construções assentadas, baús aceitos pelo servidor.'));
    for (const w of warnings) {
      const row = el('div', 'me-warn', w.text);
      if (w.sel) row.addEventListener('click', () => {
        this.select(w.sel!);
        this.focusSelection();
      });
      this.report.append(row);
    }
    this.report.append(el('div', 'me-fine', 'Baús são conferidos contra as colisões do mapa carregado: recarregue depois de salvar para conferir com as mudanças.'));
  }

  private async save(): Promise<void> {
    const { problems } = this.check();
    if (problems.length) {
      this.showReport();
      this.toast('Corrija os erros antes de salvar', true);
      return;
    }
    const map: GraaoMap = { ...this.map, mapVersion: Math.max(this.map.mapVersion, this.baseVersion + 1), editedAt: new Date().toISOString() };
    const text = serializeMap(map);
    try {
      const res = await fetch('/__graao/map', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      this.map.mapVersion = map.mapVersion;
      this.map.editedAt = map.editedAt;
      this.dirty = false;
      this.refreshTitle();
      this.toast(`Mapa salvo: versão ${map.mapVersion}. Recarregue o jogo e reinicie o servidor para jogar com ele.`);
    } catch (e) {
      this.toast(`Não deu para salvar pelo servidor de desenvolvimento (${(e as Error).message}). Use Baixar JSON.`, true);
    }
  }

  private download(): void {
    const map: GraaoMap = { ...this.map, mapVersion: Math.max(this.map.mapVersion, this.baseVersion + 1), editedAt: new Date().toISOString() };
    const blob = new Blob([serializeMap(map)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'planeta-graao.map.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------------------------------------------ UI

  private readonly tabs = el('div', 'me-tabs');
  private readonly families = el('div', 'me-families');
  private readonly colliderButton = button('Colisões (C)', () => this.setColliders(!this.showColliders));

  private buildUi(): void {
    const top = el('div', 'me-top');
    top.append(
      this.title,
      button('Salvar (Ctrl+S)', () => void this.save(), true),
      button('Baixar JSON', () => this.download()),
      button('Verificar', () => this.showReport()),
      this.colliderButton,
      button('Trilhas (T)', () => {
        this.showTrails = !this.showTrails;
        this.overlayPending = true;
      }),
      button('Desfazer', () => this.undo()),
      button('Jogar', () => {
        if (this.dirty && !confirm('Há mudanças não salvas. Sair do editor mesmo assim?')) return;
        this.dirty = false;
        const q = new URLSearchParams(location.search);
        q.delete('editor');
        location.search = q.toString();
      }),
    );
    const left = el('div', 'me-left');
    const search = el('input', 'me-search') as HTMLInputElement;
    search.placeholder = 'Buscar peça…';
    search.addEventListener('input', () => {
      this.search = search.value.trim().toLowerCase();
      this.renderList();
    });
    const modules = el('label', 'me-check');
    const box = el('input') as HTMLInputElement;
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      this.showModules = box.checked;
      this.renderList();
    });
    modules.append(box, document.createTextNode(' Mostrar módulos de construção'));
    left.append(el('div', 'me-head', 'Editor do mapa'), this.tabs, this.families, search, modules, this.list);
    const help = el('div', 'me-help');
    help.textContent = 'Botão direito gira · meio/Shift+direito arrasta · roda aproxima · WASD anda · clique seleciona · G move · setas empurram · Q/E gira · +/− escala · PgUp/PgDn eleva · Ctrl+D duplica · Del apaga · F foca · Ctrl+Z desfaz';
    this.report.hidden = true;
    this.ui.append(top, left, this.inspector, this.status, help, this.report, this.toastEl);
    document.body.appendChild(this.ui);
    this.buildUiTabs();
    this.renderList();
    this.renderInspector();
    this.refreshTitle();
  }

  private buildUiTabs(): void {
    this.tabs.replaceChildren(
      ...([['pecas', 'Peças (1)'], ['baus', 'Baús (2)'], ['waypoints', 'Waypoints (3)']] as const).map(([m, label]) => {
        const b = button(label, () => this.setMode(m));
        b.classList.toggle('on', this.mode === m);
        return b;
      }),
    );
    this.families.replaceChildren(
      ...FAMILIES.map((f) => {
        const b = button(FAMILY_NAMES[f], () => {
          this.family = f;
          this.buildUiTabs();
          this.renderList();
        });
        b.classList.toggle('on', this.family === f);
        return b;
      }),
    );
    this.families.hidden = this.mode !== 'pecas';
  }

  private renderList(): void {
    this.list.replaceChildren();
    if (this.mode !== 'pecas') {
      const items = this.mode === 'baus' ? this.map.chestSpots.map((c) => ({ id: c.id, label: `${c.id} · ${c.region}`, sel: { kind: 'chest' as const, id: c.id } })) : this.map.waypoints!.map((w) => ({ id: w.id, label: `${w.id} · ${w.kind ?? 'rua'} · ${w.links.length} lig.`, sel: { kind: 'waypoint' as const, id: w.id } }));
      this.list.append(el('div', 'me-fine', this.mode === 'baus' ? 'Clique no chão, num piso ou num telhado para criar um ponto de baú. Os baús usam o sistema de loot do jogo.' : 'Clique para criar um waypoint ligado ao selecionado; Shift+clique em outro liga ou desliga os dois.'));
      for (const it of items.filter((i) => !this.search || i.label.toLowerCase().includes(this.search))) {
        const row = el('div', 'me-item', it.label);
        row.classList.toggle('on', this.sel?.id === it.id);
        row.addEventListener('click', () => {
          this.select(it.sel);
          this.focusSelection();
        });
        this.list.append(row);
      }
      return;
    }
    const entries: { id: string; name: string; kind: string }[] = [];
    if (this.family === 'construcoes') for (const b of Object.values(KIT_BUILDINGS)) entries.push({ id: b.id, name: b.name, kind: `construção · ${KIT_CATEGORY_NAMES[b.category]}` });
    else if (this.family === 'estruturas') for (const [id, s] of Object.entries(STRUCTURE_PREFABS)) entries.push({ id, name: s.name, kind: 'estrutura clássica' });
    else {
      for (const b of Object.values(KIT_BUILDINGS)) if (b.category === this.family) entries.push({ id: b.id, name: b.name, kind: 'construção' });
      for (const p of Object.values(KIT_PREFABS)) {
        if (p.category !== this.family) continue;
        if (!this.showModules && (p.length || MODULE.test(p.id))) continue;
        entries.push({ id: p.id, name: p.name, kind: p.cover });
      }
    }
    const q = this.search;
    for (const e of entries.filter((x) => !q || x.id.includes(q) || x.name.toLowerCase().includes(q))) {
      const row = el('div', 'me-item');
      row.append(el('span', 'me-item-name', e.name), el('span', 'me-item-id', `${e.id} · ${e.kind}`));
      row.classList.toggle('on', this.placing === e.id);
      row.addEventListener('click', () => this.setPlacing(this.placing === e.id ? null : e.id));
      this.list.append(row);
    }
  }

  private renderInspector(): void {
    const box = this.inspector;
    box.replaceChildren();
    const s = this.findSelected();
    if (!s || !this.sel) {
      box.append(el('div', 'me-head', 'Nada selecionado'), el('div', 'me-fine', `Rotação de colocação: ${round(this.placeYaw, 1)}° (Q/E). Clique numa peça, num baú ou num waypoint para editar.`));
      this.renderList();
      return;
    }
    const kind = this.sel.kind;
    const edit = (apply: (v: string) => void, what: 'layout' | 'markers') => (v: string) => {
      this.pushUndo();
      apply(v);
      this.changed(what);
    };
    const target = kind === 'placement' ? 'layout' : 'markers';
    box.append(el('div', 'me-head', kind === 'placement' ? 'Peça' : kind === 'chest' ? 'Ponto de baú' : 'Waypoint'));
    box.append(field('id', s.id, edit((v) => {
      const id = v.trim();
      if (!id || id === s.id) return;
      if (kind === 'placement' && this.placementById(id)) return this.toast('Esse id já existe', true);
      if (kind === 'waypoint') for (const w of this.map.waypoints!) w.links = w.links.map((l) => (l === s.id ? id : l));
      s.id = id;
      this.sel = { kind, id };
    }, target)));
    if (kind === 'placement') {
      const p = s as MapPlacement;
      const name = KIT_PREFABS[p.prefab]?.name ?? KIT_BUILDINGS[p.prefab]?.name ?? STRUCTURE_PREFABS[p.prefab]?.name ?? p.prefab;
      box.append(el('div', 'me-fine', `${name} (${p.prefab})`));
      box.append(field('região', p.region ?? '', edit((v) => {
        if (v.trim()) p.region = v.trim();
        else delete p.region;
      }, 'layout')));
    }
    box.append(field('lat', String(s.lat), edit((v) => (s.lat = round(Number(v) || 0, 5)), target)));
    box.append(field('lon', String(s.lon), edit((v) => (s.lon = round(Number(v) || 0, 5)), target)));
    if (kind !== 'waypoint') {
      const o = s as MapPlacement | ChestSpotDef;
      box.append(field('rotação °', String(o.yaw ?? 0), edit((v) => (o.yaw = round(((Number(v) || 0) % 360 + 360) % 360, 2)), target)));
    }
    if (kind === 'placement') {
      const p = s as MapPlacement;
      box.append(field('escala', String(p.scale ?? 1), edit((v) => {
        const k = KIT_PREFABS[p.prefab]?.scale ?? (STRUCTURE_PREFABS[p.prefab] ? [0.5, 2] : [1, 1]);
        const x = THREE.MathUtils.clamp(Number(v) || 1, k[0], k[1]);
        if (Math.abs(x - 1) < 1e-6) delete p.scale;
        else p.scale = x;
      }, 'layout')));
      box.append(field('elevação m', String(p.lift ?? 0), edit((v) => {
        const x = round(Number(v) || 0, 3);
        if (!x) delete p.lift;
        else p.lift = x;
      }, 'layout')));
      if (KIT_BUILDINGS[p.prefab]) {
        const site = buildingSite(this.app.world.terrain, KIT_BUILDINGS[p.prefab]!, p);
        box.append(el('div', 'me-fine', `No terreno: erguida ${site.raise.toFixed(2)} m, chão de ${site.low.toFixed(2)} a ${site.high.toFixed(2)} m; ${site.extra.length} peças de embasamento e soleira.`));
        for (const w of site.warnings) box.append(el('div', 'me-warn', w));
      }
      const k = KIT_PREFABS[p.prefab];
      if (k) box.append(el('div', 'me-fine', `Jogo: ${k.cover}${k.scale && k.scale[0] !== k.scale[1] ? ` · escala ${k.scale[0]}–${k.scale[1]}` : ''}`));
    } else if (kind === 'chest') {
      const c = s as ChestSpotDef;
      const region = el('select') as HTMLSelectElement;
      for (const r of CHEST_REGIONS) region.append(new Option(r.name, r.name, false, r.name === c.region));
      region.addEventListener('change', () => edit((v) => (c.region = v), 'markers')(region.value));
      box.append(labeled('região do loot', region));
      box.append(field('dica', c.hint, edit((v) => (c.hint = v), 'markers')));
      box.append(field('altura m (piso)', String(c.height ?? 0), edit((v) => {
        const h = Math.max(0, round(Number(v) || 0, 2));
        c.height = h;
        c.surface = h > 0 ? 'prop' : 'terrain';
      }, 'markers')));
      const covered = el('input') as HTMLInputElement;
      covered.type = 'checkbox';
      covered.checked = !!c.covered;
      covered.addEventListener('change', () => edit(() => {
        if (covered.checked) c.covered = true;
        else delete c.covered;
      }, 'markers')(''));
      box.append(labeled('sob um teto', covered));
      const spot = resolveChestSpot(this.app.world, c);
      box.append(el('div', spot.ok ? 'me-ok' : 'me-err', spot.ok ? `Aceito pelo servidor${spot.moved ? ` (empurrado ${spot.moved.toFixed(1)} m)` : ''}` : `Recusado: ${spot.reason}`));
    } else {
      const w = s as MapWaypoint;
      const kindSel = el('select') as HTMLSelectElement;
      for (const k of WAYPOINT_KINDS) kindSel.append(new Option(k, k, false, k === (w.kind ?? 'rua')));
      kindSel.addEventListener('change', () => edit((v) => (w.kind = v as MapWaypoint['kind']), 'markers')(kindSel.value));
      box.append(labeled('tipo', kindSel));
      box.append(field('altura m', String(w.height ?? 0), edit((v) => {
        const h = Math.max(0, round(Number(v) || 0, 2));
        if (h > 0) w.height = h;
        else delete w.height;
      }, 'markers')));
      const links = el('div', 'me-links');
      for (const l of w.links) {
        const row = el('div', 'me-item', `↔ ${l}`);
        row.append(button('✕', () => this.toggleLink(w.id, l)));
        links.append(row);
      }
      box.append(el('div', 'me-fine', `${w.links.length} ligações (Shift+clique em outro waypoint liga ou desliga)`), links);
    }
    const actions = el('div', 'me-actions');
    actions.append(button('Mover (G)', () => {
      this.pushUndo();
      this.grabbing = true;
    }), button('Duplicar', () => this.duplicate()), button('Focar (F)', () => this.focusSelection()), button('Apagar', () => this.remove()));
    box.append(actions);
    this.renderList();
  }

  private refreshTitle(): void {
    const m = this.map;
    this.title.textContent = `${m.mapId} v${m.mapVersion}${this.dirty ? ' • não salvo' : ''} · ${m.placements.length} peças · ${m.chestSpots.length} baús · ${m.waypoints!.length} waypoints · ${m.trails!.length} trilhas`;
  }

  private toast(text: string, error = false): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('err', error);
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), error ? 6000 : 3200);
  }
}

// ------------------------------------------------------------------------------------------------ helpers

function button(label: string, fn: () => void, primary = false): HTMLButtonElement {
  const b = el('button', primary ? 'me-btn primary' : 'me-btn', label);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    fn();
    b.blur();
  });
  return b;
}

function labeled(label: string, input: HTMLElement): HTMLElement {
  const row = el('label', 'me-field');
  row.append(el('span', '', label), input);
  return row;
}

function field(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const input = el('input') as HTMLInputElement;
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  return labeled(label, input);
}

const BOX_EDGES = [[-1, -1, -1, 1, -1, -1], [-1, 1, -1, 1, 1, -1], [-1, -1, 1, 1, -1, 1], [-1, 1, 1, 1, 1, 1], [-1, -1, -1, -1, 1, -1], [1, -1, -1, 1, 1, -1], [-1, -1, 1, -1, 1, 1], [1, -1, 1, 1, 1, 1], [-1, -1, -1, -1, -1, 1], [1, -1, -1, 1, -1, 1], [-1, 1, -1, -1, 1, 1], [1, 1, -1, 1, 1, 1]];

/** Wireframe of a placement's colliders (as the physics builds them: game-core layout.ts) into line-segment buffers. */
function addColliderLines(p: Placement, pos: number[], col: number[], color: (c: ColliderPrimitive) => [number, number, number]): void {
  const put = (c: ColliderPrimitive, lx: number, ly: number, lz: number, rgb: [number, number, number]) => {
    let x = lx, y = ly, z = lz;
    if ('q' in c && c.q) [x, y, z] = quatRotate(c.q, x, y, z);
    if (c.type !== 'hull') {
      x += c.x;
      y += c.y;
      z += c.z;
    }
    pos.push(
      p.position.x + p.side.x * x + p.up.x * y + p.forward.x * z,
      p.position.y + p.side.y * x + p.up.y * y + p.forward.y * z,
      p.position.z + p.side.z * x + p.up.z * y + p.forward.z * z,
    );
    col.push(...rgb);
  };
  const circle = (c: ColliderPrimitive, r: number, y: number, rgb: [number, number, number], axis: 'y' | 'x' | 'z' = 'y') => {
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      for (const a of [a0, a1]) {
        const u = Math.cos(a) * r;
        const v = Math.sin(a) * r;
        if (axis === 'y') put(c, u, y, v, rgb);
        else if (axis === 'x') put(c, y, u, v, rgb);
        else put(c, u, v, y, rgb);
      }
    }
  };
  // Drawn 3 cm outside the collider, so the lines do not sink into the faces that match it.
  const e = 0.03;
  for (const c of p.colliders) {
    const rgb = color(c);
    switch (c.type) {
      case 'cuboid':
        for (const b of BOX_EDGES) {
          put(c, b[0]! * (c.hx + e), b[1]! * (c.hy + e), b[2]! * (c.hz + e), rgb);
          put(c, b[3]! * (c.hx + e), b[4]! * (c.hy + e), b[5]! * (c.hz + e), rgb);
        }
        break;
      case 'cylinder':
        circle(c, c.r + e, -c.hh - e, rgb);
        circle(c, c.r + e, c.hh + e, rgb);
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          put(c, u! * (c.r + e), -c.hh - e, v! * (c.r + e), rgb);
          put(c, u! * (c.r + e), c.hh + e, v! * (c.r + e), rgb);
        }
        break;
      case 'cone':
        circle(c, c.r + e, -c.hh - e, rgb);
        for (const [u, v] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          put(c, u! * (c.r + e), -c.hh - e, v! * (c.r + e), rgb);
          put(c, 0, c.hh + e, 0, rgb);
        }
        break;
      case 'ball':
        circle(c, c.r + e, 0, rgb, 'y');
        circle(c, c.r + e, 0, rgb, 'x');
        circle(c, c.r + e, 0, rgb, 'z');
        break;
      case 'hull': {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < c.points.length; i += 3) pts.push(new THREE.Vector3(c.points[i], c.points[i + 1], c.points[i + 2]));
        const mid = pts.reduce((a, q) => a.add(q), new THREE.Vector3()).divideScalar(Math.max(1, pts.length));
        for (const q of pts) q.add(q.clone().sub(mid).normalize().multiplyScalar(e));
        try {
          const edges = new THREE.EdgesGeometry(new ConvexGeometry(pts), 15);
          const a = edges.getAttribute('position');
          for (let i = 0; i < a.count; i++) put(c, a.getX(i), a.getY(i), a.getZ(i), rgb);
          edges.dispose();
        } catch {
          /* degenerate hull: nothing to draw */
        }
        break;
      }
    }
  }
}
