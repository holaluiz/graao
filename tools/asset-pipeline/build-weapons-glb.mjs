import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('d:/meus documentos/graao/assets/weapons/weapons-data.json', 'utf8'));

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('WeaponsScene');

for (const [wid, wdata] of Object.entries(data)) {
  const mesh = doc.createMesh(wid);
  const prim = doc.createPrimitive();

  // Positions
  const posArr = new Float32Array(wdata.positions.flat());
  const posAcc = doc.createAccessor(`pos_${wid}`)
    .setArray(posArr)
    .setType('VEC3')
    .setBuffer(buffer);
  prim.setAttribute('POSITION', posAcc);

  // Normals
  const normArr = new Float32Array(wdata.normals.flat());
  const normAcc = doc.createAccessor(`norm_${wid}`)
    .setArray(normArr)
    .setType('VEC3')
    .setBuffer(buffer);
  prim.setAttribute('NORMAL', normAcc);

  // Colors
  const colArr = new Float32Array(wdata.colors.flat());
  const colAcc = doc.createAccessor(`col_${wid}`)
    .setArray(colArr)
    .setType('VEC3')
    .setBuffer(buffer);
  prim.setAttribute('COLOR_0', colAcc);

  mesh.addPrimitive(prim);

  const node = doc.createNode(`weapon_${wid}`).setMesh(mesh);
  scene.addChild(node);

  const muzzleNode = doc.createNode(`muzzle_${wid}`)
    .setTranslation(wdata.muzzle);
  node.addChild(muzzleNode);
}

await MeshoptEncoder.ready;
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const glb = await io.writeBinary(doc);

fs.writeFileSync('d:/meus documentos/graao/apps/client/public/assets/v1/weapons/weapons.glb', glb);
fs.writeFileSync('d:/meus documentos/graao/assets/weapons/weapons.glb', glb);

console.log('Successfully generated weapons.glb! Size:', (glb.byteLength / 1024).toFixed(1), 'KB');
