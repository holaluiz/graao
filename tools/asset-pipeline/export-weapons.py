import json
import struct
import io
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB_INPUT = os.path.join(ROOT, 'assets', 'weapons', 'polygon_guns.glb')
CLIENT_PUBLIC_DIR = os.path.join(ROOT, 'apps', 'client', 'public', 'assets', 'v1', 'weapons')
CLIENT_SRC_DIR = os.path.join(ROOT, 'apps', 'client', 'src', 'character')
ASSETS_DIR = os.path.join(ROOT, 'assets', 'weapons')

os.makedirs(CLIENT_PUBLIC_DIR, exist_ok=True)
os.makedirs(ASSETS_DIR, exist_ok=True)

with open(GLB_INPUT, 'rb') as f:
    glb_data = f.read()

chunk0_len, = struct.unpack_from('<I', glb_data, 12)
gltf = json.loads(glb_data[20:20 + chunk0_len].decode('utf-8'))
chunk1_offset = 20 + chunk0_len
bin_data = glb_data[chunk1_offset + 8:]

# Load textures
images = []
for i, img_def in enumerate(gltf.get('images', [])):
    bv = gltf['bufferViews'][img_def['bufferView']]
    img_bytes = bin_data[bv['byteOffset'] : bv['byteOffset'] + bv['byteLength']]
    im = Image.open(io.BytesIO(img_bytes)).convert('RGB')
    images.append(im)
print(f"Loaded {len(images)} textures from GLB")

def get_buffer(accessor_idx):
    acc = gltf['accessors'][accessor_idx]
    bv = gltf['bufferViews'][acc['bufferView']]
    offset = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    count = acc['count']
    comp_type = acc['componentType']
    type_ = acc['type']
    type_counts = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    n_comp = type_counts[type_]
    if comp_type == 5126: # float
        return np.array(struct.unpack_from(f"<{count * n_comp}f", bin_data, offset)).reshape((count, n_comp))
    elif comp_type == 5123: # unsigned short
        return np.array(struct.unpack_from(f"<{count * n_comp}H", bin_data, offset)).reshape((count, n_comp))
    elif comp_type == 5125: # unsigned int
        return np.array(struct.unpack_from(f"<{count * n_comp}I", bin_data, offset)).reshape((count, n_comp))
    else:
        raise ValueError(f"Unknown comp_type {comp_type}")

# `grip`: (z, y) in metres of the top of the pistol grip (where the web of the hand sits), centred between its front
# and back edges, measured from the rear-bottom corner of the weapon's bounding box once it is barrel +Z, top +Y.
WEAPON_CONFIGS = [
    {'id': 'sunbeam', 'mesh_idx': 63, 'name': 'Raio de Sol (Assault Rifle M63)', 'grip': (0.33, 0.17)},
    {'id': 'petal', 'mesh_idx': 61, 'name': 'Rajada de Pétalas (Tactical Shotgun M61)', 'grip': (0.40, 0.115)},
    {'id': 'pistol', 'mesh_idx': 71, 'name': 'Pistola Tática (Pistol M71)', 'grip': (0.10, 0.12)},
    {'id': 'ak47', 'mesh_idx': 79, 'name': 'Fuzil Kalash (AK-47 M79)', 'grip': (0.31, 0.13)},
    {'id': 'sniper', 'mesh_idx': 60, 'name': 'Fuzil de Precisão (Sniper M60)', 'grip': (0.35, 0.12)},
    {'id': 'smg', 'mesh_idx': 59, 'name': 'Submetralhadora (Bullpup SMG M59)', 'grip': (0.195, 0.22)},
    {'id': 'launcher', 'mesh_idx': 80, 'name': 'Lança-Foguetes (Rocket Launcher M80)', 'grip': (0.43, 0.14)},
]

processed_weapons = {}

for cfg in WEAPON_CONFIGS:
    wid = cfg['id']
    mesh_idx = cfg['mesh_idx']
    m = gltf['meshes'][mesh_idx]
    p = m['primitives'][0]
    
    pos = get_buffer(p['attributes']['POSITION'])
    uv = get_buffer(p['attributes']['TEXCOORD_0'])
    indices = get_buffer(p['indices']) if 'indices' in p else np.arange(len(pos), dtype=np.uint32)
    
    # Get texture
    mat_idx = p.get('material')
    tex_idx = 0
    if mat_idx is not None:
        mat = gltf['materials'][mat_idx]
        tex_info = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if tex_info:
            tex_idx = gltf['textures'][tex_info['index']]['source']
            
    im = images[tex_idx]
    w, h = im.size
    im_arr = np.array(im)
    
    # Sample colors
    u = np.clip(uv[:, 0], 0, 1)
    v = np.clip(uv[:, 1], 0, 1)
    px = (u * (w - 1)).astype(int)
    py = ((1.0 - v) * (h - 1)).astype(int)
    colors = (im_arr[py, px].astype(np.float32) / 255.0) # N, 3
    
    # Same rotation as the Sketchfab root node (glTF Y-up: x, z, -y) without its scale: barrel +Z, top +Y, grip −Y.
    pos_t = np.zeros_like(pos)
    pos_t[:, 0] = pos[:, 0]
    pos_t[:, 1] = pos[:, 2]
    pos_t[:, 2] = -pos[:, 1]
    
    # Center X; Y and Z from the rear-bottom corner of the bounds (the frame `grip` is measured in)
    pos_t[:, 0] -= (np.min(pos_t[:, 0]) + np.max(pos_t[:, 0])) / 2
    pos_t[:, 1] -= np.min(pos_t[:, 1])
    pos_t[:, 2] -= np.min(pos_t[:, 2])
    
    # Bore height: the muzzle end of the weapon
    max_z = float(np.max(pos_t[:, 2]))
    barrel_y = float(np.mean(pos_t[pos_t[:, 2] > max_z - 0.03][:, 1]))
    
    # Origin at the top of the grip (where the hand holds)
    grip_z, grip_y = cfg['grip']
    pos_t[:, 1] -= grip_y
    pos_t[:, 2] -= grip_z
    
    # Compute normals from triangles
    # Unroll triangles if indexed or compute smooth face-weighted normals
    # For cel shading, face normals give that crisp low-poly polygon aesthetic!
    tris = indices.reshape((-1, 3))
    v0 = pos_t[tris[:, 0]]
    v1 = pos_t[tris[:, 1]]
    v2 = pos_t[tris[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)
    lens = np.linalg.norm(face_normals, axis=1, keepdims=True)
    lens[lens == 0] = 1.0
    face_normals /= lens
    
    # Unroll into flat non-indexed triangles for crisp stylized polygon shading:
    flat_pos = np.zeros((len(tris) * 3, 3), dtype=np.float32)
    flat_norm = np.zeros((len(tris) * 3, 3), dtype=np.float32)
    flat_col = np.zeros((len(tris) * 3, 3), dtype=np.float32)
    
    for k in range(3):
        flat_pos[k::3] = pos_t[tris[:, k]]
        flat_norm[k::3] = face_normals
        flat_col[k::3] = colors[tris[:, k]]
        
    # Muzzle position
    muzzle = [0.0, round(barrel_y - grip_y, 3), round(max_z - grip_z + 0.02, 3)]
    
    # Ink geometry: inflate each triangle outwards by 0.005
    flat_ink_pos = flat_pos + flat_norm * 0.005
    
    processed_weapons[wid] = {
        'id': wid,
        'name': cfg['name'],
        'triangles': len(tris),
        'positions': flat_pos.round(5).tolist(),
        'normals': flat_norm.round(4).tolist(),
        'colors': flat_col.round(3).tolist(),
        'inkPositions': flat_ink_pos.round(5).tolist(),
        'muzzle': muzzle,
        'bounds': {
            'min': flat_pos.min(axis=0).round(3).tolist(),
            'max': flat_pos.max(axis=0).round(3).tolist()
        }
    }
    print(f"Processed {wid}: {len(tris)} tris, muzzle={muzzle}, bounds={processed_weapons[wid]['bounds']}")

# Save JSON to assets and client
json_out = os.path.join(ASSETS_DIR, 'weapons-data.json')
with open(json_out, 'w', encoding='utf-8') as f:
    json.dump(processed_weapons, f)
print(f"Wrote {json_out} ({os.path.getsize(json_out) // 1024} KB)")

# Also create a binary packed file for minimal size and ultra fast loading
# Format per weapon:
# header: id (32 bytes str), tris (uint32), muzzle (3x float32)
# body: positions (tris*3*3 float32), colors (tris*3*3 uint8), normals (tris*3*3 int8)
# ink: ink_positions (tris*3*3 float32)
bin_path = os.path.join(CLIENT_PUBLIC_DIR, 'weapons.bin')
with open(bin_path, 'wb') as bf:
    # magic 'GRAAWEP1'
    bf.write(b'GRAAWEP1')
    bf.write(struct.pack('<I', len(processed_weapons)))
    for wid, wdata in processed_weapons.items():
        id_bytes = wid.encode('utf-8').ljust(32, b'\x00')
        tris = wdata['triangles']
        muzzle = wdata['muzzle']
        bf.write(id_bytes)
        bf.write(struct.pack('<Ifff', tris, muzzle[0], muzzle[1], muzzle[2]))
        
        pos_arr = np.array(wdata['positions'], dtype=np.float32)
        norm_arr = np.array(wdata['normals'], dtype=np.float32)
        col_arr = np.array(wdata['colors'], dtype=np.float32)
        ink_arr = np.array(wdata['inkPositions'], dtype=np.float32)
        
        bf.write(pos_arr.tobytes())
        bf.write(norm_arr.tobytes())
        bf.write(col_arr.tobytes())
        bf.write(ink_arr.tobytes())

print(f"Wrote {bin_path} ({os.path.getsize(bin_path) // 1024} KB)")

# Also generate a TypeScript file WeaponData.ts with the packed base64 binary or Float32 arrays
# so that node vitest can load it synchronously with ZERO fetch dependency!
ts_path = os.path.join(CLIENT_SRC_DIR, 'WeaponData.ts')
with open(bin_path, 'rb') as bf:
    bin_bytes = bf.read()
import base64
b64_str = base64.b64encode(bin_bytes).decode('ascii')

ts_code = f"""/**
 * Autogenerated baked weapon models from polygon_guns.glb.
 * Generated by tools/asset-pipeline/export-weapons.py.
 * Synchronous in-memory decoding allows instantaneous startup and offline unit tests.
 */
import * as THREE from 'three';
import type {{ WeaponId }} from '@graao/game-data';

export interface BakedWeapon {{
  id: WeaponId;
  triangles: number;
  muzzle: THREE.Vector3;
  body: THREE.BufferGeometry;
  ink: THREE.BufferGeometry;
}}

const B64 = '{b64_str}';

export function decodeBakedWeapons(): Record<WeaponId, BakedWeapon> {{
  const bin = Uint8Array.from(atob(B64), (c) => c.charCodeAt(0));
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  
  // Verify magic
  const magic = String.fromCharCode(...bin.subarray(0, 8));
  if (magic !== 'GRAAWEP1') throw new Error('Bad weapon binary header: ' + magic);
  
  const count = view.getUint32(8, true);
  let offset = 12;
  const out = {{}} as Record<WeaponId, BakedWeapon>;
  
  for (let i = 0; i < count; i++) {{
    let name = '';
    for (let k = 0; k < 32; k++) {{
      const b = bin[offset + k] ?? 0;
      if (b === 0) break;
      name += String.fromCharCode(b);
    }}
    offset += 32;
    const tris = view.getUint32(offset, true);
    const mx = view.getFloat32(offset + 4, true);
    const my = view.getFloat32(offset + 8, true);
    const mz = view.getFloat32(offset + 12, true);
    offset += 16;
    
    const floatsPerAttr = tris * 3 * 3;
    const byteLen = floatsPerAttr * 4;
    
    // Position
    const pos = new Float32Array(bin.buffer, bin.byteOffset + offset, floatsPerAttr);
    offset += byteLen;
    // Normal
    const norm = new Float32Array(bin.buffer, bin.byteOffset + offset, floatsPerAttr);
    offset += byteLen;
    // Color (Float32)
    const col = new Float32Array(bin.buffer, bin.byteOffset + offset, floatsPerAttr);
    offset += byteLen;
    // Ink position
    const inkPos = new Float32Array(bin.buffer, bin.byteOffset + offset, floatsPerAttr);
    offset += byteLen;
    
    const body = new THREE.BufferGeometry();
    body.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    body.setAttribute('normal', new THREE.BufferAttribute(norm.slice(), 3));
    body.setAttribute('color', new THREE.BufferAttribute(col.slice(), 3));
    body.computeBoundingSphere();
    
    const ink = new THREE.BufferGeometry();
    ink.setAttribute('position', new THREE.BufferAttribute(inkPos.slice(), 3));
    ink.computeBoundingSphere();
    
    out[name as WeaponId] = {{
      id: name as WeaponId,
      triangles: tris,
      muzzle: new THREE.Vector3(mx, my, mz),
      body,
      ink,
    }};
  }}
  return out;
}}
"""

with open(ts_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(ts_code)
print(f"Wrote {ts_path} ({os.path.getsize(ts_path) // 1024} KB)")
