"""
graao head: the sculpted bald head (assets/characters/head-base.glb, decimated from the stylized Tripo sculpt) turned
into the data the character code builds on (apps/client/src/character/build/head-data.json):

  - the head mesh, scaled and centered so its skull matches the head the rest of the character was fitted to
    (crown to chin 0.298 m, same depth split front/back), in GAME space (meters, +Y up, facing +Z, its left on +X)
    relative to the head center;
  - per-vertex flags: neck stub (blends into the Neck/Spine2 bones), ears (hidden under long hair);
  - the skull as a radial table r(theta, phi) around the center with the ears and the nose filled in (hair, hats and
    beards are laid over this surface, so they hug the new skull);
  - face landmarks (eyes, brows, nose, mouth, ears) where the sculpt carves them, for the face decals and accessories.

    blender --background --factory-startup --python tools/blender/build_head.py -- \
        assets/characters/head-base.glb apps/client/src/character/build/head-data.json [preview_dir]

The source sculpt (2M triangles, textured) can be passed instead of head-base.glb: it is merged and decimated first
and head-base.glb is rewritten next to the output when `--base <path>` is given.
"""
import base64
import bmesh
import bpy
import json
import math
import struct
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = None
BASE_OUT = None
rest = argv[2:]
while rest:
    a = rest.pop(0)
    if a == '--base':
        BASE_OUT = rest.pop(0)
    else:
        PREVIEW = a

TARGET_TRIS = 4500
# The head the character was fitted to: crown to chin, and how the skull depth splits around the center.
HEAD_HEIGHT = 0.298
FRONT_SHARE = 0.13 / 0.269
# Radial table resolution: theta (azimuth, 0 = face, +pi/2 = the character's left) and phi (polar, 0 = crown).
NT, NP = 180, 90
Q = 50000  # mesh quantization: 1/50000 m

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in bpy.context.scene.objects:
    o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data
me.materials.clear()
for uv in list(me.uv_layers):
    me.uv_layers.remove(uv)
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
if len(me.polygons) > TARGET_TRIS * 1.2:
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.ratio = TARGET_TRIS / len(me.polygons)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    if BASE_OUT:
        bpy.ops.export_scene.gltf(filepath=BASE_OUT, export_format='GLB', use_selection=True, export_normals=False,
                                  export_texcoords=False, export_materials='NONE')
print('HEAD_TRIS', len(me.polygons), 'VERTS', len(me.vertices))

# The sculpt's lid folds and brow ledge were carved for its painted eyes: thin creases that would cut through the
# game's eye and brow decals. Smooth them away around each eye (the socket keeps its overall shape).
scale_ref = (max(v.co.z for v in me.vertices) - min(v.co.z for v in me.vertices)) / 0.98
grp = ob.vertex_groups.new(name='eyes')
for v in me.vertices:
    w = 0.0
    if v.co.y < 0:
        for sx in (1, -1):
            dx = (v.co.x - sx * 0.16 * scale_ref) / (0.15 * scale_ref)
            dz = (v.co.z - 0.53 * scale_ref) / (0.105 * scale_ref)
            d = math.sqrt(dx * dx + dz * dz)
            t = max(0.0, min(1.0, (1.0 - d) / 0.35))
            w = max(w, t * t * (3 - 2 * t))
    if w > 0:
        grp.add([v.index], w, 'REPLACE')
mod = ob.modifiers.new('eyesmooth', 'SMOOTH')
mod.vertex_group = 'eyes'
mod.factor = 0.9
mod.iterations = 14
bpy.ops.object.modifier_apply(modifier='eyesmooth')

# ------------------------------------------------------------------------------------------- normalization
# Imported glTF lands Z-up in Blender (game x = X, y = Z, z = -Y). The sculpt faces game +Z.
V = [v.co.copy() for v in me.vertices]
crown = max(v.z for v in V)
chin_v = min((v for v in V if v.y < -0.22 * (crown / 0.98)), key=lambda v: v.z)
chin = chin_v.z
S = HEAD_HEIGHT / (crown - chin)
ZC = (crown + chin) / 2
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())


def cast(o, d):
    return bvh.ray_cast(Vector(o), Vector(d).normalized())


# Depth split: the forehead and the back of the skull at brow height.
zf = ZC + 0.12 * (crown - chin)
front_y = cast((0, -5, zf), (0, 1, 0))[0].y
back_y = cast((0, 5, zf), (0, -1, 0))[0].y
YC = front_y + FRONT_SHARE * (back_y - front_y)
CENTER_B = Vector((0, YC, ZC))


def to_game(p):
    """Blender point → game space relative to the head center (meters)."""
    return ((p.x) * S, (p.z - ZC) * S, (YC - p.y) * S)


def game_dir_to_b(d):
    return Vector((d[0], -d[2], d[1]))


print('NORMALIZE', json.dumps({'scale': S, 'crown': crown, 'chin': chin, 'zc': ZC, 'yc': YC}))

# ------------------------------------------------------------------------------------------- skull table


def dir_of(theta, phi):
    return (math.sin(phi) * math.sin(theta), math.cos(phi), math.sin(phi) * math.cos(theta))


def radial(theta, phi):
    d = game_dir_to_b(dir_of(theta, phi))
    h = cast(CENTER_B, d)
    return (h[0] - CENTER_B).length * S if h[0] is not None else None


thetas = [-math.pi + 2 * math.pi * i / NT for i in range(NT)]
phis = [math.pi * j / NP for j in range(NP + 1)]
# Sampled at twice the resolution; each node keeps the highest skin around it (±half a cell), so the bilinear surface
# never dips under a facet between nodes (thin shells like a shaved side sit only ~2 mm over the skin).
fine = [[radial(-math.pi + math.pi * i / NT, math.pi * j / (2 * NP)) for i in range(2 * NT)] for j in range(2 * NP + 1)]
for j in range(2 * NP + 1):
    for i in range(2 * NT):
        if fine[j][i] is None:
            fine[j][i] = fine[j - 1][i]
R = [[max(fine[min(2 * NP, max(0, 2 * j + dj))][(2 * i + di) % (2 * NT)] for dj in (-1, 0, 1) for di in (-1, 0, 1)) for i in range(NT)] for j in range(NP + 1)]


def harmonic(grid, mask, iters=700, omega=1.9):
    """Fills masked cells with the harmonic interpolation of the rest (theta wraps, phi clamps; over-relaxed)."""
    g = [row[:] for row in grid]
    cells = [(j, i) for j in range(NP + 1) for i in range(NT) if mask[j][i]]
    for _ in range(iters):
        for j, i in cells:
            up = g[max(0, j - 1)][i]
            dn = g[min(NP, j + 1)][i]
            avg = (up + dn + g[j][(i - 1) % NT] + g[j][(i + 1) % NT]) / 4
            g[j][i] += omega * (avg - g[j][i])
    return g


DEG = math.pi / 180


def boxes():
    """Angular boxes where protrusions may sit: both ears, the nose."""
    out = []
    for sgn in (1, -1):
        out.append(lambda t, p, s=sgn: EAR_BOX(s * t, p))
    out.append(lambda t, p: abs(t) < 18 * DEG and 94 * DEG < p < 122 * DEG)
    return out


def EAR_BOX(t, p):
    """Where the left ear sits (azimuth, polar): measured on the sculpt (top ≈ 118°/94°, lobe ≈ 114°/124°)."""
    return 88 * DEG < t < 145 * DEG and 80 * DEG < p < 136 * DEG


protrusion = [[False] * NT for _ in range(NP + 1)]
for box in boxes():
    mask = [[box(thetas[i], phis[j]) for i in range(NT)] for j in range(NP + 1)]
    fill = harmonic(R, mask)
    for j in range(NP + 1):
        for i in range(NT):
            if mask[j][i] and R[j][i] - fill[j][i] > 0.0035:
                protrusion[j][i] = True
# Dilate by one cell so the fill starts on the skull, not on the ear root.
grown = [row[:] for row in protrusion]
for j in range(NP + 1):
    for i in range(NT):
        if protrusion[j][i]:
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                jj = min(NP, max(0, j + dj))
                grown[jj][(i + di) % NT] = True
SKULL = harmonic(R, grown)

# Ear volume: how far out the ears reach in each direction (0 where there is no ear), spread and softened so hair that
# passes over an ear swells smoothly around it. Half the skull table's resolution.
ET, EP = NT // 2, NP // 2
ear_r = [[0.0] * ET for _ in range(EP + 1)]
for j in range(NP + 1):
    for i in range(NT):
        t, p = thetas[i], phis[j]
        if EAR_BOX(abs(t), p) and R[j][i] - SKULL[j][i] > 0.002:
            jj, ii = min(EP, round(j / 2)), (i // 2) % ET
            ear_r[jj][ii] = max(ear_r[jj][ii], R[j][i])
for _ in range(3):  # dilate (max of neighbors)
    nxt = [row[:] for row in ear_r]
    for j in range(EP + 1):
        for i in range(ET):
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                jj = min(EP, max(0, j + dj))
                nxt[j][i] = max(nxt[j][i], ear_r[jj][(i + di) % ET] * 0.995)
    ear_r = nxt
for _ in range(2):  # soften
    nxt = [row[:] for row in ear_r]
    for j in range(EP + 1):
        for i in range(ET):
            vals = [ear_r[min(EP, max(0, j + dj))][(i + di) % ET] for dj in (-1, 0, 1) for di in (-1, 0, 1)]
            nxt[j][i] = sum(vals) / 9 if any(vals) else 0.0
    ear_r = nxt


def skull_r(theta, phi):
    """Bilinear lookup in the skull table (same as the client's)."""
    x = (theta + math.pi) / (2 * math.pi) * NT
    y = max(0.0, min(NP, phi / math.pi * NP))
    i0 = math.floor(x)
    tx = x - i0
    j0 = min(NP - 1, math.floor(y))
    ty = y - j0
    a = SKULL[j0][i0 % NT] * (1 - tx) + SKULL[j0][(i0 + 1) % NT] * tx
    b = SKULL[j0 + 1][i0 % NT] * (1 - tx) + SKULL[j0 + 1][(i0 + 1) % NT] * tx
    return a * (1 - ty) + b * ty


# ------------------------------------------------------------------------------------------- vertex flags
# Neck stub: an elliptic cylinder under the jaw (measured on the sculpt: axis at y≈0.05, half-width 0.17, front at
# y≈-0.12, back at y≈0.215). Its slanted cut is stretched down so it always ends inside the torso.
NECK_TOP = 0.255  # Blender Z of the jaw/neck seam
NECK_STRETCH = 1.9
flags = []
positions = []
for v in V:
    g = to_game(v)
    f = 0
    nx = v.x / 0.2
    ny = (v.y - 0.05) / (0.175 if v.y < 0.05 else 0.27)
    if v.z < NECK_TOP and nx * nx + ny * ny < 1.0:
        f |= 1
        seam = (NECK_TOP - ZC) * S
        if g[1] < seam:
            g = (g[0], seam + (g[1] - seam) * NECK_STRETCH, g[2])
    r = math.sqrt(g[0] ** 2 + g[1] ** 2 + g[2] ** 2)
    if r > 1e-6:
        phi = math.acos(max(-1, min(1, g[1] / r)))
        theta = math.atan2(g[0], g[2])
        if EAR_BOX(abs(theta), phi) and r > skull_r(theta, phi) + 0.002 and not f & 1:
            f |= 2
    flags.append(f)
    positions.append(g)

# ------------------------------------------------------------------------------------------- landmarks
# Measured on the sculpt (Blender front view: X across, Z up), where its painted features sit.


def lm(x, z):
    return [round(x * S, 5), round((z - ZC) * S, 5)]


ear_lobe = cast((2, 0.14, 0.345), (-1, 0, 0))[0]
ear_top = cast((2, 0.2, 0.54), (-1, 0, 0))[0]
ear_back = cast((0.33, 2, 0.45), (0, -1, 0))[0]
landmarks = {
    # Eye opening: center, half extents; inner and outer corners; iris center and half width.
    'eye': lm(0.155, 0.4933), 'eyeHalf': [round(0.0825 * S, 5), round(0.036 * S, 5)],
    'eyeInner': lm(0.078, 0.49), 'eyeOuter': lm(0.24, 0.525),
    'iris': lm(0.138, 0.492), 'irisHalf': [round(0.034 * S, 5), round(0.042 * S, 5)],
    'browInner': lm(0.058, 0.565), 'browOuter': lm(0.237, 0.606), 'browPeak': lm(0.15, 0.6),
    'noseTip': lm(0.0, 0.3933), 'mouth': lm(0.0, 0.301), 'mouthHalf': round(0.074 * S, 5),
    'chin': lm(0.0, chin),
    'earLobe': [round(c, 5) for c in to_game(ear_lobe)],
    'earTop': [round(c, 5) for c in to_game(ear_top)],
    'earBack': [round(c, 5) for c in to_game(ear_back)],
    'earOut': round(max(abs(p[0]) for p, f in zip(positions, flags) if f & 2), 5),
}

# ------------------------------------------------------------------------------------------- export


def b64(fmt, values):
    return base64.b64encode(struct.pack('<%d%s' % (len(values), fmt), *values)).decode('ascii')


pos_q = [int(round(c * Q)) for p in positions for c in p]
index = [i for poly in me.polygons for i in poly.vertices]
data = {
    'source': 'stylized bald head (Tripo) → tools/blender/build_head.py',
    'quant': Q,
    'positions': b64('h', pos_q),
    'index': b64('H', index),
    'flags': b64('B', flags),
    'skull': {'nt': NT, 'np': NP, 'quant': Q, 'r': b64('H', [int(round(SKULL[j][i] * Q)) for j in range(NP + 1) for i in range(NT)])},
    'ears': {'nt': ET, 'np': EP, 'quant': Q, 'r': b64('H', [int(round(ear_r[j][i] * Q)) for j in range(EP + 1) for i in range(ET)])},
    'landmarks': landmarks,
}
with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump(data, fh, separators=(',', ':'))
dev = [(R[j][i] - SKULL[j][i], round(thetas[i] / DEG), round(phis[j] / DEG)) for j in range(NP + 1) for i in range(NT)]
print('SKULL_FILLED', sum(1 for d in dev if d[0] > 0.0005), 'max', max(dev))
print('HEAD_OUT', json.dumps({'verts': len(V), 'tris': len(index) // 3, 'neck': sum(1 for f in flags if f & 1),
                              'ear': sum(1 for f in flags if f & 2), 'landmarks': landmarks}))

# ------------------------------------------------------------------------------------------- preview
if PREVIEW:
    import os
    os.makedirs(PREVIEW, exist_ok=True)
    scene = bpy.context.scene
    # Head in game orientation (z = depth), colored by flag.
    for o in list(scene.objects):
        bpy.data.objects.remove(o)
    mats = []
    for name, col in (('head', (0.85, 0.66, 0.55, 1)), ('neck', (0.4, 0.55, 0.9, 1)), ('ear', (0.9, 0.3, 0.3, 1)), ('skull', (0.3, 0.8, 0.4, 1))):
        m = bpy.data.materials.new(name)
        m.diffuse_color = col
        mats.append(m)
    hm = bpy.data.meshes.new('head')
    hm.from_pydata([(p[0], -p[2], p[1]) for p in positions], [], [tuple(poly.vertices) for poly in me.polygons])
    for m in mats[:3]:
        hm.materials.append(m)
    for poly in hm.polygons:
        fs = [flags[i] for i in poly.vertices]
        poly.material_index = 2 if all(f & 2 for f in fs) else 1 if all(f & 1 for f in fs) else 0
        poly.use_smooth = True
    ho = bpy.data.objects.new('head', hm)
    scene.collection.objects.link(ho)
    # Skull surface (offset 3 mm) as a wire cage.
    sv, sf = [], []
    for j in range(NP + 1):
        for i in range(NT):
            d = dir_of(thetas[i], phis[j])
            r = SKULL[j][i] + 0.003
            sv.append((d[0] * r, -d[2] * r, d[1] * r))
    for j in range(NP):
        for i in range(NT):
            a, b2 = j * NT + i, j * NT + (i + 1) % NT
            sf.append((a, b2, b2 + NT, a + NT))
    sm = bpy.data.meshes.new('skull')
    sm.from_pydata(sv, [], sf)
    sm.materials.append(mats[3])
    so = bpy.data.objects.new('skull', sm)
    scene.collection.objects.link(so)
    so.display_type = 'WIRE'
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 0.42
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, loc, rot, skull in (
        ('front', (0, -3, -0.03), (math.pi / 2, 0, 0), False),
        ('side', (3, 0, -0.03), (math.pi / 2, 0, math.pi / 2), False),
        ('back', (0, 3, -0.03), (math.pi / 2, 0, math.pi), False),
        ('skull_front', (0, -3, -0.03), (math.pi / 2, 0, 0), True),
        ('skull_side', (3, 0, -0.03), (math.pi / 2, 0, math.pi / 2), True),
    ):
        so.hide_render = not skull
        cam.location = loc
        cam.rotation_euler = rot
        scene.render.filepath = os.path.join(PREVIEW, f'head_{name}.png')
        bpy.ops.render.render(write_still=True)
