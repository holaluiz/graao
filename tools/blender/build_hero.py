"""
graao hero pieces, modeled in Blender: wavy hair, hoodie (kangaroo pocket, hood, drawstrings), cargo shorts and retro
sneakers with crew socks, fitted to the procedural body the game builds (tools/character/body-ref.json).

Every piece is authored in the rig's bind pose, in GAME space (meters, +Y up, the character facing +Z, its left on +X)
and exported as one object per (body, piece, palette slot): `body.slim|top.hoodie|TOP`. Material names are palette slot
names; custom properties carry the bones the client may weight to and the body region. The client
(character/AuthoredParts.ts) computes skin weights with the same function as the code-built parts, so authored and
procedural pieces bend alike.

    blender --background --factory-startup --python tools/blender/build_hero.py -- \
        tools/character/body-ref.json apps/client/public/assets/v1/characters/hero-parts.glb [preview_dir]
"""
import bpy
import bmesh
import json
import math
import random
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
REF = json.load(open(argv[0], encoding='utf-8'))
OUT = argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None

# Preview colors only (the game colors every slot from the character's palette).
PREVIEW_COLORS = {
    'SKIN': (0.78, 0.55, 0.38), 'INK': (0.1, 0.1, 0.12), 'HAIR': (0.1, 0.09, 0.12), 'TOP': (0.93, 0.9, 0.82),
    'TOP_ACCENT': (0.8, 0.77, 0.7), 'TOP_DETAIL': (0.99, 0.98, 0.95), 'BOTTOM': (0.2, 0.2, 0.23), 'BOTTOM_ACCENT': (0.15, 0.15, 0.17),
    'BOTTOM_DETAIL': (0.6, 0.6, 0.6), 'SHOES': (0.75, 0.15, 0.15), 'SOLE': (0.96, 0.94, 0.9), 'SHOES_DETAIL': (0.45, 0.08, 0.1),
}

TORSO_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg']


def arm_bones(side):
    return [f'{side}Shoulder', f'{side}Arm', f'{side}ForeArm', f'{side}Hand']


# --------------------------------------------------------------------------------------------- geometry helpers

def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def ring_at(rings, axis, value):
    """Linear interpolation of a ring list (dicts with p, ra, rb, n) at `value` along `axis` (clamped)."""
    asc = rings[0]['p'][axis] < rings[-1]['p'][axis]
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        va, vb = a['p'][axis], b['p'][axis]
        if (asc and va <= value <= vb) or (not asc and vb <= value <= va):
            t = (value - va) / ((vb - va) or 1)
            return {
                'p': [lerp(a['p'][k], b['p'][k], t) for k in range(3)],
                'ra': lerp(a['ra'], b['ra'], t), 'rb': lerp(a['rb'], b['rb'], t),
                'n': lerp(a.get('n', 2), b.get('n', 2), t),
            }
    first, last = rings[0], rings[-1]
    before = value < first['p'][axis] if asc else value > first['p'][axis]
    r = dict(first if before else last)
    r.setdefault('n', 2)
    return r


def mirror(rings):
    return [dict(r, p=[-r['p'][0], r['p'][1], r['p'][2]]) for r in rings]


class Piece:
    """Accumulates faces per palette slot for one exported piece."""

    def __init__(self, body, piece, bones, region='none'):
        self.body, self.piece, self.bones, self.region = body, piece, bones, region
        self.parts = {}  # slot -> (verts, faces)

    def _buf(self, slot):
        return self.parts.setdefault(slot, ([], []))

    def tube(self, rings, slot, seg=16, ref=(1, 0, 0), cap_start='round', cap_end='round', cap_scale=0.8, ripple=None, phase=0.0, closed=False, caps=3):
        """Swept superellipse tube (same construction as PartBuilder.tube). rings: list of (center Vector, ra, rb, n)."""
        verts, faces = self._buf(slot)
        refv = Vector(ref).normalized()
        n = len(rings)
        pts = [Vector(r[0]) for r in rings]
        frames = []
        for i in range(n):
            if closed:
                a, b = pts[(i - 1) % n], pts[(i + 1) % n]
            else:
                a, b = pts[max(0, i - 1)], pts[min(n - 1, i + 1)]
            t = (b - a).normalized()
            e1 = refv - t * refv.dot(t)
            if e1.length < 1e-6:
                e1 = Vector((0, 1, 0)) - t * t.y
            e1.normalize()
            frames.append((t, e1, t.cross(e1)))

        def ring(c, f, ra, rb, ex):
            ids = []
            for k in range(seg):
                th = phase + k / seg * math.tau
                cs, sn = math.cos(th), math.sin(th)
                e = 2.0 / ex
                x = math.copysign(abs(cs) ** e, cs) * ra
                y = math.copysign(abs(sn) ** e, sn) * rb
                if ripple:
                    m = 1 + ripple[0] * math.cos(ripple[1] * th)
                    x, y = x * m, y * m
                ids.append(len(verts))
                verts.append(c + f[1] * x + f[2] * y)
            return ids

        rows = []
        start_pole = end_pole = None
        if not closed and cap_start in ('round', 'flat'):
            c0, ra0, rb0, n0 = rings[0]
            ln = min(ra0, rb0) * cap_scale if cap_start == 'round' else 0
            if cap_start == 'round':
                for j in range(caps, 0, -1):
                    phi = j / (caps + 1) * math.pi / 2
                    rows.append(ring(pts[0] - frames[0][0] * math.sin(phi) * ln, frames[0], ra0 * math.cos(phi), rb0 * math.cos(phi), n0))
            start_pole = len(verts)
            verts.append(pts[0] - frames[0][0] * ln)
        for i, (c, ra, rb, ex) in enumerate(rings):
            rows.append(ring(pts[i], frames[i], ra, rb, ex))
        if not closed and cap_end in ('round', 'flat'):
            cl, ral, rbl, nl = rings[-1]
            ln = min(ral, rbl) * cap_scale if cap_end == 'round' else 0
            if cap_end == 'round':
                for j in range(1, caps + 1):
                    phi = j / (caps + 1) * math.pi / 2
                    rows.append(ring(pts[-1] + frames[-1][0] * math.sin(phi) * ln, frames[-1], ral * math.cos(phi), rbl * math.cos(phi), nl))
            end_pole = len(verts)
            verts.append(pts[-1] + frames[-1][0] * ln)
        count = len(rows) if closed else len(rows) - 1
        for i in range(count):
            A, B = rows[i], rows[(i + 1) % len(rows)]
            for k in range(seg):
                k1 = (k + 1) % seg
                faces.append((A[k], A[k1], B[k1], B[k]))
        if start_pole is not None:
            A = rows[0]
            for k in range(seg):
                faces.append((start_pole, A[(k + 1) % seg], A[k]))
        if end_pole is not None:
            A = rows[-1]
            for k in range(seg):
                faces.append((A[k], A[(k + 1) % seg], end_pole))

    def ellipsoid(self, c, r, slot, nu=14, nv=10, rot=None):
        verts, faces = self._buf(slot)
        base = len(verts)
        rot = rot or Matrix.Identity(3)
        verts.append(Vector(c) + rot @ Vector((0, r[1], 0)))
        for j in range(1, nv):
            phi = j / nv * math.pi
            for i in range(nu):
                th = i / nu * math.tau
                d = Vector((math.sin(phi) * math.sin(th) * r[0], math.cos(phi) * r[1], math.sin(phi) * math.cos(th) * r[2]))
                verts.append(Vector(c) + rot @ d)
        verts.append(Vector(c) + rot @ Vector((0, -r[1], 0)))
        last = len(verts) - 1
        row = lambda j, i: base + 1 + (j - 1) * nu + (i % nu)
        for i in range(nu):
            faces.append((base, row(1, i), row(1, i + 1)))
        for j in range(1, nv - 1):
            for i in range(nu):
                faces.append((row(j, i), row(j + 1, i), row(j + 1, i + 1), row(j, i + 1)))
        for i in range(nu):
            faces.append((last, row(nv - 1, i + 1), row(nv - 1, i)))

    def box(self, c, size, slot, rot=None, bevel=0.0):
        """Box (optionally beveled later by a modifier on the whole slot object)."""
        verts, faces = self._buf(slot)
        base = len(verts)
        rot = rot or Matrix.Identity(3)
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        for x in (-hx, hx):
            for y in (-hy, hy):
                for z in (-hz, hz):
                    verts.append(Vector(c) + rot @ Vector((x, y, z)))
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            faces.append(tuple(base + i for i in f))


# --------------------------------------------------------------------------------------------- materials & export

MATERIALS = {}


def material(slot):
    m = MATERIALS.get(slot)
    if m is None:
        m = bpy.data.materials.new(slot)
        col = PREVIEW_COLORS.get(slot, (0.7, 0.7, 0.7))
        m.diffuse_color = (*col, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*col, 1)
        MATERIALS[slot] = m
    return m


GAME_TO_BLENDER = Matrix.Rotation(math.radians(90), 4, 'X')
OBJECTS = []


def emit(piece, subdivide=0, bevel_slots=()):
    for slot, (verts, faces) in piece.parts.items():
        if not faces:
            continue
        name = f'{piece.body}|{piece.piece}|{slot}'
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in verts], [], faces)
        me.validate(clean_customdata=False)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.transform(GAME_TO_BLENDER)
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(material(slot))
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob['bones'] = ','.join(piece.bones)
        ob['region'] = piece.region
        ob['body'] = piece.body
        ob['piece'] = piece.piece
        if slot in bevel_slots:
            mod = ob.modifiers.new('bevel', 'BEVEL')
            mod.width = 0.004
            mod.segments = 2
            mod.limit_method = 'ANGLE'
        if subdivide:
            mod = ob.modifiers.new('subd', 'SUBSURF')
            mod.levels = subdivide
            mod.render_levels = subdivide
        OBJECTS.append(ob)


# --------------------------------------------------------------------------------------------- head surface

class Head:
    def __init__(self, h):
        self.c = Vector(h['center'])
        self.a, self.b, self.cz = h['a'], h['b'], h['c']

    def surface(self, d, scale=1.0):
        d = Vector(d).normalized()
        dy = d.y
        sx = 1 - 0.36 * (-dy) ** 1.75 if dy < 0 else 1 - 0.05 * dy * dy
        if d.z < 0:
            sz = 1.07 - 0.05 * max(0.0, -dy)
        else:
            sz = 1 - 0.1 * (-dy) ** 2.2 if dy < 0 else 1.0
        chin = 0.012 * max(0.0, 1 - abs(dy + 0.84) / 0.3) if dy < -0.55 else 0.0
        x = d.x * self.a * sx * scale
        y = d.y * self.b * scale
        z = (d.z * self.cz * sz + (chin * d.z if d.z > 0 else 0)) * scale
        return self.c + Vector((x, y, z))

    def normal(self, d):
        p = self.surface(d)
        q = p - self.c
        return Vector((q.x / self.a ** 2, q.y / self.b ** 2, q.z / self.cz ** 2)).normalized()


# --------------------------------------------------------------------------------------------- hair: wavy

def hairline(d):
    """Height (head-local dy) of the hairline in direction d: low at the nape, over the ears at the sides, a forehead."""
    th = math.atan2(d.x, d.z)
    k = ((1 + math.cos(th)) / 2) ** 1.3
    return -0.52 + 0.92 * k


def build_hair(body, ref, covered):
    head = Head(ref['head'])
    pc = Piece(body, 'hair.ondulado' + ('#covered' if covered else ''), ['Head', 'Neck'], 'head')
    rnd = random.Random(7)
    # Scalp: the head surface pushed out above the hairline, sunk inside below it (hidden), so the cap has no edge.
    nu, nv = 32, 20
    verts, faces = pc._buf('HAIR')
    base = len(verts)
    grid = []
    for j in range(nv + 1):
        phi = j / nv * math.pi
        row = []
        for i in range(nu):
            th = i / nu * math.tau
            d = Vector((math.sin(phi) * math.sin(th), math.cos(phi), math.sin(phi) * math.cos(th)))
            above = d.y - hairline(d)
            cut = covered and d.y > 0.12
            s = lerp(0.94, 1.07 + 0.08 * smoothstep(0.1, 0.9, d.y), smoothstep(-0.02, 0.06, above))
            if cut:
                s = 0.94
            row.append(len(verts))
            verts.append(head.surface(d, s))
            if j == 0 or j == nv:
                break
        grid.append(row)
    for j in range(nv):
        a_row, b_row = grid[j], grid[j + 1]
        for i in range(nu):
            if len(a_row) == 1:
                faces.append((a_row[0], b_row[(i + 1) % nu], b_row[i]))
            elif len(b_row) == 1:
                faces.append((a_row[i], a_row[(i + 1) % nu], b_row[0]))
            else:
                faces.append((a_row[i], a_row[(i + 1) % nu], b_row[(i + 1) % nu], b_row[i]))

    # Locks: tapered flat clumps flowing from the crown, waving and curling at the tips.
    crown = Vector((0.0, 0.8, -0.45)).normalized()
    golden = math.pi * (3 - math.sqrt(5))
    count = 110
    made = 0
    for k in range(count):
        y = 1 - (k + 0.5) / count * 1.5  # upper part of the sphere
        r = math.sqrt(max(0.0, 1 - y * y))
        th = k * golden
        d = Vector((math.cos(th) * r, y, math.sin(th) * r))
        if d.y - hairline(d) < 0.08:
            continue
        if covered and d.y > 0.05:
            continue
        flow = d - crown
        flow -= d * flow.dot(d)
        if flow.length < 1e-3:
            flow = Vector((0, 0, 1)) - d * d.z
        flow.normalize()
        front = d.z > 0.35 and abs(d.x) < 0.75
        length = (0.1 if front else 0.105 if d.y > 0.25 else 0.12) * (0.8 + rnd.random() * 0.45)
        width = 0.058 + rnd.random() * 0.02
        wave = (rnd.random() - 0.5) * 0.02
        steps = 6
        p = head.surface(d, 1.08 + 0.08 * smoothstep(0.1, 0.9, d.y))
        dirv = flow.copy()
        rings = []
        for s in range(steps + 1):
            t = s / steps
            nrm = head.normal((p - head.c).normalized())
            side = dirv.cross(nrm).normalized()
            off = side * math.sin(t * math.pi * 2.0 + k) * wave
            taper = (1 - t) ** 0.8
            # ra lies along the head normal (thickness), rb across the flow (width): flat clumps, not strings.
            rings.append((p + off + nrm * 0.006, max(0.003, 0.013 * taper + 0.004), max(0.006, width * 0.5 * (0.45 + 0.55 * taper)), 2.0))
            # Advance: follow the flow, fall with gravity, stay out of the head; tips flick outward.
            grav = Vector((0, -1, 0))
            grav -= nrm * grav.dot(nrm)
            # Messy waves: the clump swings sideways along its length and the tips kick out.
            dirv = (dirv + grav * (0.5 if not front else 0.8) + side * math.sin(t * 5.0 + k * 1.7) * 0.25).normalized()
            if t > 0.65:
                dirv = (dirv + nrm * 0.45).normalized()
            p = p + dirv * (length / steps)
            q = (p - head.c)
            dd = q.normalized()
            surf = head.surface(dd, 1.06)
            if q.length < (surf - head.c).length:
                p = surf
            if front and dd.y < 0.26 and dd.z > 0.3:
                break  # fringe stops at the brows
        if len(rings) >= 4:
            pc.tube(rings, 'HAIR', seg=5, caps=1, ref=tuple(head.normal(d)), cap_start='round', cap_end='round', cap_scale=0.6)
            made += 1
    emit(pc)
    return made


# --------------------------------------------------------------------------------------------- hoodie

def build_hoodie(body, ref):
    torso, arm = ref['torso'], ref['arm']
    pr = ref['proportions']
    chest = ring_at(torso, 1, 1.12)
    pc = Piece(body, 'top.hoodie', TORSO_BONES + arm_bones('Left') + arm_bones('Right'), 'torso')
    d, k = 0.03, 1.06
    hem0, hem1, top = 0.79, 0.835, 1.296

    def shell_ring(y, extra=0.0):
        r = ring_at(torso, 1, y)
        # Fabric hangs from the chest: below it the shell never follows the waist in.
        drape = 1 - smoothstep(0.86, 1.12, y)
        ra = max(r['ra'], lerp(r['ra'], chest['ra'] * 0.97, drape))
        rb = max(r['rb'], lerp(r['rb'], chest['rb'] * 1.02, drape))
        n = max(2.3, r['n'] - 0.2)
        return (Vector((r['p'][0], y, r['p'][2] + 0.004 * drape)), ra * k + d + extra, rb * k + d + extra, n)

    body_rings = [shell_ring(lerp(hem1, top, i / 22) if i < 22 else top) for i in range(23)]
    pc.tube(body_rings, 'TOP', seg=28, cap_start='open', cap_end='open')
    # Ribbed hem band (slightly drawn in).
    hem = [shell_ring(lerp(hem0, hem1 + 0.005, i / 3), 0.004) for i in range(4)]
    pc.tube(hem, 'TOP_ACCENT', seg=48, cap_start='round', cap_end='open', cap_scale=0.08, ripple=(0.012, 24))

    # Sleeves: loose to the wrist, bunched before a ribbed cuff.
    for side in ('Left', 'Right'):
        rings_src = arm if side == 'Left' else mirror(arm)
        sx = 1 if side == 'Left' else -1
        x0, x1 = pr['shoulderX'] - 0.05, pr['wristX'] - 0.035
        rings = []
        for i in range(16):
            x = lerp(x0, x1, i / 15)
            r = ring_at(rings_src, 0, sx * x)
            loose = 0.024 + 0.008 * math.sin(i / 15 * math.pi)
            bunch = 0.006 * math.sin(i * 2.4) * smoothstep(0.6, 0.95, i / 15)
            rr = max(r['ra'], 0.036) + loose + bunch
            rings.append((Vector((sx * x, r['p'][1] - 0.004 * (i / 15), r['p'][2])), rr, rr * 1.05, 2.0))
        pc.tube(rings, 'TOP', seg=16, ref=(0, 1, 0), cap_start='round', cap_end='open', cap_scale=0.4)
        cuff = []
        for i in range(4):
            x = lerp(x1 - 0.004, pr['wristX'] - 0.004, i / 3)
            r = ring_at(rings_src, 0, sx * x)
            rr = r['ra'] + 0.013
            cuff.append((Vector((sx * x, r['p'][1] - 0.004, r['p'][2])), rr, rr * 1.04, 2.0))
        pc.tube(cuff, 'TOP_ACCENT', seg=24, ref=(0, 1, 0), cap_start='open', cap_end='round', cap_scale=0.2, ripple=(0.03, 12))

    # Hood lying down: a thick roll around the neck opening, fullest at the back, plus the hood's folded bag.
    loop = []
    neck = ring_at(torso, 1, 1.29)
    for i in range(40):
        a = i / 40 * math.tau
        back = (1 - math.cos(a)) / 2  # 0 front, 1 back
        rx = neck['ra'] * k + 0.045 + 0.02 * back
        rz = neck['rb'] * k + 0.04 + 0.03 * back
        c = Vector((math.sin(a) * rx, 1.292 + 0.012 * back - 0.012 * (1 - back), neck['p'][2] + math.cos(a) * rz - 0.012 * back))
        thick = 0.022 + 0.018 * back
        loop.append((c, thick, thick * 0.8, 2.0))
    pc.tube(loop, 'TOP', seg=12, ref=(0, 1, 0), closed=True)
    back_shell = shell_ring(1.2)
    pc.ellipsoid((0, 1.215, back_shell[0].z - back_shell[2] - 0.035), (0.105, 0.085, 0.04), 'TOP', 16, 10)

    # Kangaroo pocket: a padded panel on the belly with slanted openings (its edges read as drawn seams).
    front_z = lambda y, x: shell_front(shell_ring(y), x)
    rows = []
    for j in range(6):
        y = lerp(0.85, 0.99, j / 5)
        half = lerp(0.105, 0.075, j / 5)
        rows.append([(x, y) for x in [lerp(-half, half, i / 10) for i in range(11)]])
    verts, faces = pc._buf('TOP')
    base = len(verts)
    for row in rows:
        for x, y in row:
            verts.append(Vector((x, y, front_z(y, x) + 0.008)))
    back_base = len(verts)
    for row in rows:
        for x, y in row:
            verts.append(Vector((x, y, front_z(y, x) - 0.004)))
    W = 11
    for j in range(5):
        for i in range(10):
            a, b, c2, d2 = j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i
            faces.append((base + a, base + b, base + c2, base + d2))
            faces.append((back_base + d2, back_base + c2, back_base + b, back_base + a))
    for j in range(5):  # sides
        for i in (0, 10):
            a, b = j * W + i, (j + 1) * W + i
            faces.append((base + a, base + b, back_base + b, back_base + a) if i == 0 else (base + b, base + a, back_base + a, back_base + b))
    for i in range(10):  # bottom and top
        a, b = i, i + 1
        faces.append((base + b, base + a, back_base + a, back_base + b))
        a, b = 5 * W + i, 5 * W + i + 1
        faces.append((base + a, base + b, back_base + b, back_base + a))

    # Drawstrings hanging from the neckline, with dark aglets.
    for sx in (1, -1):
        pts = []
        for i in range(8):
            t = i / 7
            y = lerp(1.272, 1.12 - 0.01 * sx, t)
            x = sx * (0.03 + 0.006 * t)
            pts.append((Vector((x, y, front_z(y, x) + 0.012 + 0.006 * math.sin(t * math.pi))), 0.0042, 0.0042, 2.0))
        pc.tube(pts, 'TOP_DETAIL', seg=8, ref=(1, 0, 0))
        tip = pts[-1][0]
        pc.tube([(tip + Vector((0, 0.004, 0)), 0.005, 0.005, 2.0), (tip - Vector((0, 0.018, 0)), 0.005, 0.005, 2.0)], 'INK', seg=8, ref=(1, 0, 0))
    emit(pc)


def shell_front(ring, x):
    c, ra, rb, n = ring
    q = min(0.98, abs(x) / ra)
    return c.z + rb * (1 - q ** n) ** (1 / n)


# --------------------------------------------------------------------------------------------- cargo shorts

def build_cargo(body, ref):
    torso, leg = ref['torso'], ref['leg']
    pr = ref['proportions']
    pc = Piece(body, 'bottom.cargo', ['Hips', 'Spine', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'], 'hips')
    d, k = 0.014, 1.05
    # Seat and waist (hips part of the torso), then a waistband.
    seat = []
    for i in range(7):
        y = lerp(0.79, 0.885, i / 6)
        r = ring_at(torso, 1, y)
        seat.append((Vector((r['p'][0], y, r['p'][2])), r['ra'] * k + d + 0.006, r['rb'] * k + d + 0.004, max(2.3, r['n'] - 0.2)))
    pc.tube(seat, 'BOTTOM', seg=32, cap_start='round', cap_end='open', cap_scale=0.2)
    band = []
    for i in range(3):
        y = lerp(0.878, 0.905, i / 2)
        r = ring_at(torso, 1, y)
        band.append((Vector((r['p'][0], y, r['p'][2])), r['ra'] * k + d + 0.009, r['rb'] * k + d + 0.007, max(2.3, r['n'] - 0.2)))
    pc.tube(band, 'BOTTOM_ACCENT', seg=32, cap_start='open', cap_end='open')
    # Belt loops on the band.
    rb = ring_at(torso, 1, 0.89)
    for a in (-2.2, -0.75, 0.75, 2.2, math.pi):
        x = math.sin(a) * (rb['ra'] * k + d + 0.012)
        z = rb['p'][2] + math.cos(a) * (rb['rb'] * k + d + 0.01)
        pc.box((x, 0.89, z), (0.012, 0.036, 0.006), 'BOTTOM', Matrix.Rotation(a, 3, 'Y'))

    # Wide straight legs to just below the knee, with a turned-up hem.
    hem_y = pr['kneeY'] - 0.05
    for side in ('Left', 'Right'):
        sx = 1 if side == 'Left' else -1
        src = leg if side == 'Left' else mirror(leg)
        rings = []
        for i in range(12):
            y = lerp(pr['hipsY'] - 0.02, hem_y + 0.03, i / 11)
            r = ring_at(src, 1, y)
            rr = max(r['ra'] + 0.02, 0.075 + 0.006 * (i / 11))
            rings.append((Vector((r['p'][0] + sx * 0.006 * (i / 11), y, r['p'][2])), rr, rr * 1.02, 2.2))
        pc.tube(rings, 'BOTTOM', seg=24, cap_start='open', cap_end='open')
        last = rings[-1]
        cuff = [(last[0] + Vector((0, 0.004, 0)), last[1] + 0.004, last[2] + 0.004, 2.2), (last[0] - Vector((0, 0.03, 0)), last[1] + 0.006, last[2] + 0.006, 2.2)]
        pc.tube(cuff, 'BOTTOM', seg=24, cap_start='open', cap_end='round', cap_scale=0.12)
        # Cargo pocket on the outer thigh with its flap and button.
        r = ring_at(src, 1, 0.6)
        rr = max(r['ra'] + 0.02, 0.075 + 0.006 * 0.5)
        cx = r['p'][0] + sx * (rr + 0.006)
        pc.box((cx, 0.595, r['p'][2] + 0.004), (0.016, 0.115, 0.085), 'BOTTOM')
        pc.box((cx + sx * 0.004, 0.66, r['p'][2] + 0.004), (0.02, 0.034, 0.092), 'BOTTOM_ACCENT')
        pc.ellipsoid((cx + sx * 0.016, 0.652, r['p'][2] + 0.004), (0.004, 0.006, 0.006), 'BOTTOM_DETAIL', 8, 6)
    # Fly seam.
    r = ring_at(torso, 1, 0.83)
    pc.box((0.012, 0.83, r['p'][2] + r['rb'] * k + d + 0.006), (0.006, 0.08, 0.006), 'BOTTOM_ACCENT')
    emit(pc, bevel_slots=('BOTTOM_ACCENT',))


# --------------------------------------------------------------------------------------------- retro sneakers + socks

def build_sneakers(body, ref):
    leg = ref['leg']
    pr = ref['proportions']
    pc = Piece(body, 'shoes.retro', ['LeftFoot', 'LeftToeBase', 'LeftLeg', 'RightFoot', 'RightToeBase', 'RightLeg'], 'feet')
    for side in ('Left', 'Right'):
        sx = 1 if side == 'Left' else -1
        x = sx * pr['legSocketX']
        src = leg if side == 'Left' else mirror(leg)
        # Crew sock with a ribbed top.
        sock = []
        for i in range(7):
            y = lerp(0.07, 0.25, i / 6)
            r = ring_at(src, 1, y)
            sock.append((Vector((r['p'][0], y, r['p'][2])), r['ra'] + 0.006, r['rb'] + 0.006, 2.0))
        pc.tube(sock, 'SOLE', seg=12, ref=(1, 0, 0), cap_start='open', cap_end='open', ripple=(0.0, 1))
        top = sock[-1]
        pc.tube([(top[0] - Vector((0, 0.025, 0)), top[1] + 0.003, top[2] + 0.003, 2.0), (top[0] + Vector((0, 0.004, 0)), top[1] + 0.003, top[2] + 0.003, 2.0)],
                'SOLE', seg=14, ref=(1, 0, 0), cap_start='open', cap_end='round', cap_scale=0.15, ripple=(0.03, 12))

        # Cupsole: thick, flat-bottomed, toe spring at the front.
        def width(t):
            return lerp(0.043, 0.04, smoothstep(0, 0.35, t)) + 0.012 * smoothstep(0.35, 0.7, t) - 0.03 * smoothstep(0.86, 1.0, t) ** 2
        z0, z1 = -0.088, 0.205
        sole = []
        for i in range(14):
            t = i / 13
            z = lerp(z0, z1, t)
            lift = 0.014 * smoothstep(0.75, 1.0, t)
            sole.append((Vector((x, 0.017 + lift, z)), width(t), 0.017, 4.0))
        pc.tube(sole, 'SOLE', seg=14, ref=(1, 0, 0), cap_start='round', cap_end='round', cap_scale=0.35)
        stripe = [(c + Vector((0, 0.009, 0)), ra + 0.0015, 0.004, 4.0) for (c, ra, rb, n) in sole[1:-1]]
        pc.tube(stripe, 'SHOES_DETAIL', seg=14, ref=(1, 0, 0), cap_start='round', cap_end='round', cap_scale=0.3)

        # Upper: a high padded heel dropping to a rounded toe box.
        upper = []
        for i in range(13):
            t = i / 12
            z = lerp(-0.075, 0.19, t)
            h = lerp(0.052, 0.022, smoothstep(0.35, 1.0, t)) + 0.008 * (1 - smoothstep(0.0, 0.3, t))
            c_y = 0.034 + h
            upper.append((Vector((x, c_y + 0.006 * smoothstep(0.75, 1.0, t), z)), width(t) - 0.004, h, 2.4))
        pc.tube(upper, 'SHOES', seg=14, ref=(1, 0, 0), cap_start='round', cap_end='round', cap_scale=0.5)
        # White toe box and white mid panel, dark side wing, heel tab.
        pc.ellipsoid((x, 0.05, 0.165), (0.043, 0.026, 0.045), 'SOLE', 12, 8)
        pc.ellipsoid((x, 0.072, 0.04), (0.043, 0.036, 0.058), 'SOLE', 12, 8)
        wing = []
        for i in range(9):
            t = i / 8
            z = lerp(-0.055, 0.1, t)
            y = 0.045 + 0.03 * math.sin(t * math.pi * 0.85) * (1 - t * 0.4)
            wing.append((Vector((x + sx * (width((z - z0) / (z1 - z0)) + 0.0005), y, z)), 0.003, 0.009 * (1 - 0.6 * t) + 0.002, 2.0))
        pc.tube(wing, 'SHOES_DETAIL', seg=8, ref=(sx, 0, 0), cap_start='round', cap_end='round')
        pc.box((x, 0.09, -0.083), (0.03, 0.05, 0.01), 'SHOES_DETAIL')
        # Padded collar and tongue.
        collar = []
        for i in range(24):
            a = i / 24 * math.tau
            collar.append((Vector((x + math.sin(a) * 0.041, 0.112 - 0.012 * (1 + math.cos(a)) / 2, -0.008 + math.cos(a) * 0.05)), 0.009, 0.009, 2.0))
        pc.tube(collar, 'SOLE', seg=6, ref=(0, 1, 0), closed=True)
        tongue = [(Vector((x, lerp(0.07, 0.13, t), lerp(0.08, 0.035, t))), 0.026, 0.008, 2.6) for t in (0, 0.33, 0.66, 1.0)]
        pc.tube(tongue, 'SHOES', seg=12, ref=(1, 0, 0), cap_start='flat', cap_end='round', cap_scale=0.6)
        # Laces crossing over the instep.
        for j in range(4):
            z = 0.1 - j * 0.022
            y = 0.098 + j * 0.008
            pc.box((x, y, z), (0.034, 0.006, 0.007), 'SOLE', Matrix.Rotation((0.5 if j % 2 else -0.5) * 0.4, 3, 'Y') @ Matrix.Rotation(-0.35, 3, 'X'))
    emit(pc)


# --------------------------------------------------------------------------------------------- preview

def preview(body_prefix, ref, path_front, path_side):
    """Workbench render of the body reference with the pieces (outline on, flat colors)."""
    pc = Piece(body_prefix, 'preview.body', ['Hips'])
    verts, faces = pc._buf('SKIN')
    P = ref['positions']
    for i in range(0, len(P), 3):
        verts.append(Vector((P[i], P[i + 1], P[i + 2])))
    I = ref['indices']
    for i in range(0, len(I), 3):
        faces.append((I[i], I[i + 1], I[i + 2]))
    emit(pc)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_object_outline = True
    sh.show_cavity = True
    scene.render.resolution_x = 700
    scene.render.resolution_y = 1000
    scene.render.film_transparent = False
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 70
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, 0.86))
    for path, yaw in ((path_front, 0.35), (path_side, math.pi / 2)):
        dist = 4.0
        cam.location = Vector((math.sin(yaw) * dist, -math.cos(yaw) * dist, 0.95))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    for ob in [o for o in OBJECTS if o['piece'] == 'preview.body']:
        OBJECTS.remove(ob)
        bpy.data.objects.remove(ob)


# --------------------------------------------------------------------------------------------- main

bpy.ops.wm.read_factory_settings(use_empty=True)
stats = {}
for body in ('body.slim', 'body.sturdy'):
    ref = REF[body]
    stats[body] = {'locks': build_hair(body, ref, False)}
    build_hair(body, ref, True)
    build_hoodie(body, ref)
    build_cargo(body, ref)
    build_sneakers(body, ref)

if PREVIEW:
    import os
    os.makedirs(PREVIEW, exist_ok=True)
    keep = [o for o in OBJECTS if o['body'] == 'body.slim' and not o['piece'].endswith('#covered')]
    for o in OBJECTS:
        o.hide_render = o not in keep
    preview('body.slim', REF['body.slim'], os.path.join(PREVIEW, 'hero_front.png'), os.path.join(PREVIEW, 'hero_side.png'))
    for o in OBJECTS:
        o.hide_render = False

for o in bpy.context.scene.objects:
    o.select_set(o in OBJECTS)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_extras=True,
    export_yup=True,
    export_normals=True,
    export_texcoords=False,
    export_materials='EXPORT',
)
print('HERO_STATS', json.dumps({'objects': len(OBJECTS), 'stats': stats}))
