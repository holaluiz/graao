#!/usr/bin/env node
// Asset inspection report for GLB/glTF files: size, triangles, vertices, materials, textures (with dimensions),
// skins/bones and animations. Usage:
//   node tools/asset-pipeline/inspect.mjs <file-or-dir> [...more] [--bones] [--clips] [--json]
import { readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const targets = args.filter((a) => !a.startsWith('--'));
if (targets.length === 0) {
  console.error('usage: inspect.mjs <file-or-dir> [--bones] [--clips] [--json]');
  process.exit(1);
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

function collect(path) {
  const st = statSync(path);
  if (st.isDirectory()) return readdirSync(path).flatMap((f) => collect(join(path, f)));
  return ['.glb', '.gltf'].includes(extname(path).toLowerCase()) ? [path] : [];
}

function imageSize(bytes, mime) {
  if (!bytes) return null;
  if (mime === 'image/png' && bytes.length > 24) {
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    return [v.getUint32(16), v.getUint32(20)];
  }
  if (mime === 'image/jpeg') {
    for (let i = 2; i < bytes.length - 9; ) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3) return [(bytes[i + 7] << 8) | bytes[i + 8], (bytes[i + 5] << 8) | bytes[i + 6]];
      i += 2 + len;
    }
  }
  if (mime === 'image/webp' && bytes.length > 30) {
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') return [1 + (v.getUint32(24, true) & 0xffffff), 1 + (v.getUint32(27, true) & 0xffffff)];
    if (chunk === 'VP8L') {
      const b = v.getUint32(21, true);
      return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)];
    }
    if (chunk === 'VP8 ') return [v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff];
  }
  return null;
}

const reports = [];
for (const file of targets.flatMap(collect)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      const pos = prim.getAttribute('POSITION');
      const count = pos ? pos.getCount() : 0;
      vertices += count;
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : count;
      if (prim.getMode() === 4) triangles += n / 3;
    }
  }
  const textures = root.listTextures().map((t) => {
    const size = imageSize(t.getImage(), t.getMimeType());
    return { name: t.getName() || t.getURI() || '(unnamed)', mime: t.getMimeType(), size, bytes: t.getImage()?.byteLength ?? 0 };
  });
  const skins = root.listSkins().map((s) => ({ name: s.getName(), joints: s.listJoints().map((j) => j.getName()) }));
  const clips = root.listAnimations().map((a) => {
    let duration = 0;
    for (const s of a.listSamplers()) {
      const input = s.getInput();
      if (input) duration = Math.max(duration, input.getMax([0])[0]);
    }
    return { name: a.getName(), channels: a.listChannels().length, duration: Math.round(duration * 1000) / 1000 };
  });
  const report = {
    file: relative(process.cwd(), file),
    bytes: statSync(file).size,
    meshes: root.listMeshes().length,
    primitives,
    triangles,
    vertices,
    materials: root.listMaterials().length,
    textures,
    skins: skins.map((s) => ({ name: s.name, bones: s.joints.length })),
    nodes: root.listNodes().length,
    animations: clips.length,
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
  };
  if (flags.has('--bones')) report.bones = skins.map((s) => s.joints);
  if (flags.has('--clips')) report.clips = clips;
  reports.push(report);
}

if (flags.has('--json')) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const r of reports) {
    console.log(`\n${r.file}`);
    console.log(`  size        ${(r.bytes / 1024).toFixed(1)} KB`);
    console.log(`  geometry    ${r.meshes} meshes, ${r.primitives} primitives, ${r.triangles} tris, ${r.vertices} verts`);
    console.log(`  materials   ${r.materials}`);
    console.log(`  textures    ${r.textures.length}${r.textures.map((t) => `\n              ${t.name} ${t.mime} ${t.size ? t.size.join('x') : '?'} ${(t.bytes / 1024).toFixed(0)} KB`).join('')}`);
    console.log(`  skins       ${r.skins.map((s) => `${s.name || '(skin)'}: ${s.bones} bones`).join(', ') || 'none'}`);
    console.log(`  animations  ${r.animations}`);
    console.log(`  extensions  ${r.extensions.join(', ') || 'none'}`);
    if (r.bones) console.log(`  bones       ${r.bones.map((b) => b.join(' ')).join('\n              ')}`);
    if (r.clips) console.log(`  clips\n${r.clips.map((c) => `              ${c.name} (${c.duration}s, ${c.channels} ch)`).join('\n')}`);
  }
}
