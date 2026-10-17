/**
 * The UFO's route drawn like a dotted line on an illustrated map, so the deployment path reads at a glance:
 *
 *   - sky dots along the orbit: small paper-white dots before the hatch opens, bigger sun-yellow dots over the jump
 *     window, faded once the ship has passed them;
 *   - ground dots under the window: where a straight drop would land.
 *
 * One THREE.Points draw call with a fixed on-screen dot size and an ink edge. Rebuilt once per route.
 */
import * as THREE from 'three';
import { routeFrame, ufoAngle, type GameWorld } from '@graao/game-core';
import type { UfoRouteMsg } from '@graao/shared';

const VERTEX = /* glsl */ `
attribute float aAngle;
attribute float aKind; // 0 before the window, 1 window, 2 ground track
uniform float uShip;
uniform float uPixel;
varying float vKind;
varying float vAlpha;
void main() {
  vKind = aKind;
  float passed = aAngle < uShip - 0.012 ? 1.0 : 0.0;
  vAlpha = mix(1.0, aKind > 1.5 ? 0.35 : 0.18, passed);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aKind > 1.5 ? 6.0 : aKind > 0.5 ? 9.0 : 5.5;
  gl_PointSize = size * uPixel;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
varying float vKind;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  vec3 fill = vKind > 1.5 ? vec3(1.0, 0.93, 0.62) : vKind > 0.5 ? vec3(1.0, 0.83, 0.43) : vec3(0.98, 0.95, 0.89);
  vec3 ink = vec3(0.165, 0.13, 0.19);
  vec3 col = mix(fill, ink, smoothstep(0.55, 0.7, r));
  gl_FragColor = vec4(col, vAlpha * uOpacity);
  #include <colorspace_fragment>
}
`;

export class UfoRoutePath {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private route: UfoRouteMsg | null = null;

  constructor(private readonly world: GameWorld) {
    this.points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        name: 'UFO/Route',
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uShip: { value: -10 }, uPixel: { value: 1 }, uOpacity: { value: 1 } },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.visible = false;
  }

  /** Builds the dots for a route (sky from start to a little past the window, ground under the window). */
  setRoute(r: UfoRouteMsg): void {
    if (this.route && JSON.stringify(this.route) === JSON.stringify(r)) return;
    this.route = r;
    const f = routeFrame(r);
    const a0 = ufoAngle(r, r.t0);
    const aOpen = ufoAngle(r, r.open);
    const aClose = ufoAngle(r, r.close);
    const pos: number[] = [];
    const angle: number[] = [];
    const kind: number[] = [];
    const at = (a: number, radius: number) => {
      const c = Math.cos(a) * radius;
      const s = Math.sin(a) * radius;
      return { x: f.c.x * c + f.h.x * s, y: f.c.y * c + f.h.y * s, z: f.c.z * c + f.h.z * s };
    };
    const step = (1.4 * Math.PI) / 180;
    for (let a = a0; a <= aClose + step * 4; a += step) {
      const p = at(a, f.radius);
      pos.push(p.x, p.y, p.z);
      angle.push(a);
      kind.push(a >= aOpen && a <= aClose ? 1 : 0);
    }
    // Ground track under the window, slightly denser.
    for (let a = aOpen; a <= aClose; a += step * 0.7) {
      const d = at(a, 1);
      const g = this.world.terrain.surfaceAt(d);
      pos.push(g.x + d.x * 0.8, g.y + d.y * 0.8, g.z + d.z * 0.8);
      angle.push(a);
      kind.push(2);
    }
    const geo = this.points.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aAngle', new THREE.Float32BufferAttribute(angle, 1));
    geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    geo.computeBoundingSphere();
  }

  /** Per frame: where the ship is now (dots behind it fade), overall opacity, device pixel ratio. */
  update(serverNow: number, opacity: number, pixelRatio: number): void {
    const r = this.route;
    this.points.visible = !!r && opacity > 0.01;
    if (!r) return;
    const u = this.points.material.uniforms;
    u.uShip!.value = ufoAngle(r, serverNow);
    u.uOpacity!.value = opacity;
    u.uPixel!.value = pixelRatio;
  }
}
