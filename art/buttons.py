# Spotify Overlay: the transport keys - brushed-silver hi-fi buttons like a 90s CD / cassette deck, each with a
# printed symbol, sitting in a dark recessed well. Rendered top-down (same camera and light as art/frame.py) with
# a transparent background, twice per key: up, and pressed (the key sunk into its well).
# Run:  blender.exe -b -P art/buttons.py -- <out dir>
# Writes <name>.png and <name>-down.png for: shuffle prev play pause next gear mic.  156 x 96 px = 3 px per CSS px.
import bpy, math, sys, os

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '//keys'
W, H = 156, 96                      # image px == Blender units
KW, KH, KD = 132, 72, 12            # key width, height, depth
INK = 0.02

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene

def mat_metal(name, color, rough, bump=0.0, metallic=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = rough
    if bump:
        tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); nz = nt.nodes.new('ShaderNodeTexNoise'); bp = nt.nodes.new('ShaderNodeBump')
        mp.inputs['Scale'].default_value = (0.01, 2.0, 1)            # horizontal brushing
        nz.inputs['Scale'].default_value = 12; nz.inputs['Detail'].default_value = 10
        bp.inputs['Strength'].default_value = bump
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
        nt.links.new(nz.outputs['Fac'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

def box(scene, w, h, d, z, bevel, mat, segs=4):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z))
    o = bpy.context.object; o.scale = (w, h, d)
    bpy.ops.object.transform_apply(scale=True)
    m = o.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = segs; m.limit_method = 'ANGLE'
    o.data.materials.append(mat); bpy.ops.object.shade_smooth()
    return o

def poly(scene, pts, z, mat, depth=0.6):
    """flat printed symbol from a list of (x, y) outlines (each a closed polygon)"""
    cu = bpy.data.curves.new('ink', 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'; cu.extrude = depth / 2
    for outline in pts:
        sp = cu.splines.new('POLY'); sp.points.add(len(outline) - 1)
        for p, (x, y) in zip(sp.points, outline): p.co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    ob = bpy.data.objects.new('ink', cu); ob.location.z = z
    scene.collection.objects.link(ob); ob.data.materials.append(mat)
    return ob

def tri(cx, cy, w, h, right=True):
    s = 1 if right else -1
    return [(cx - s * w / 2, cy - h / 2), (cx + s * w / 2, cy), (cx - s * w / 2, cy + h / 2)]

def rect(cx, cy, w, h):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]

def ring_pts(cx, cy, r, n=40):
    return [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]

def capsule(cx, cy, w, h, n=12):
    r = w / 2; top = [(cx + r * math.cos(math.pi * k / n), cy + h / 2 - r + r * math.sin(math.pi * k / n)) for k in range(n + 1)]
    bot = [(cx - r * math.cos(math.pi * k / n), cy - h / 2 + r - r * math.sin(math.pi * k / n)) for k in range(n + 1)]
    return top + bot

def gear_pts(cx, cy, r_out, r_in, teeth=8):
    pts = []
    for k in range(teeth * 4):
        a = 2 * math.pi * k / (teeth * 4)
        r = r_out if (k % 4) in (1, 2) else r_in
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def arrow_band(points, width):
    """a stroked open polyline as one polygon (for the shuffle arrows)"""
    left, right = [], []
    for i, (x, y) in enumerate(points):
        x0, y0 = points[max(0, i - 1)]; x1, y1 = points[min(len(points) - 1, i + 1)]
        dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L * width / 2, dx / L * width / 2
        left.append((x + nx, y + ny)); right.append((x - nx, y - ny))
    return left + right[::-1]

def symbol(name):
    """outlines for each key's printed symbol, centred on the key top"""
    if name == 'play':  return [tri(3, 0, 26, 30)]
    if name == 'pause': return [rect(-7, 0, 8, 28), rect(7, 0, 8, 28)]
    if name == 'next':  return [tri(-8, 0, 20, 26), tri(9, 0, 20, 26), rect(21, 0, 4, 26)]
    if name == 'prev':  return [tri(8, 0, 20, 26, False), tri(-9, 0, 20, 26, False), rect(-21, 0, 4, 26)]
    if name == 'gear':  return [gear_pts(0, 0, 15, 11.5, 8)]
    if name == 'mic':   return [capsule(0, 6, 11, 20), arrow_band([(-10, 4), (-10, -3), (-6, -8), (6, -8), (10, -3), (10, 4)], 2.6), rect(0, -12, 2.8, 7), rect(0, -16, 14, 2.8)]
    if name == 'shuffle':
        a = [(-24, -9), (-10, -9), (6, 9), (16, 9)]
        b = [(-24, 9), (-10, 9), (6, -9), (16, -9)]
        return [arrow_band(a, 4), arrow_band(b, 4), tri(21, 9, 10, 12), tri(21, -9, 10, 12)]
    return []

def render(name, pressed):
    scene = reset()
    shade = 0.78 if pressed else 1.0                                     # a pressed key sits in its own shadow
    silver = mat_metal('silver', tuple(c * shade for c in (0.6, 0.61, 0.64)), 0.3 if not pressed else 0.38, bump=0.12)
    well = mat_metal('well', (0.03, 0.03, 0.035), 0.6, metallic=0.4)
    ink = mat_metal('ink', (0.025, 0.026, 0.03), 0.55, metallic=0.0)
    hole = mat_metal('hole', (0.6, 0.6, 0.62), 0.3, bump=0.05)
    box(scene, W - 6, H - 6, 6, -4, 5, well, 3)                          # the dark recess the key sits in
    sink = 5 if pressed else 0
    top = KD / 2 - sink
    box(scene, KW, KH, KD, -sink, 4.5, silver, 5)                        # the key
    pts = symbol(name)
    if name == 'gear':                                                   # gear: ink with a silver hub on top
        poly(scene, pts, top + INK, ink); poly(scene, [ring_pts(0, 0, 5.5)], top + INK + 0.4, hole)
    else:
        poly(scene, pts, top + INK, ink)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = W; cam.location = (0, 0, 120); scene.camera = cam
    for nm, loc, power, size in (('key', (-140, 120, 150), 4.5e5, 120), ('fill', (160, -90, 130), 1.1e5, 160), ('top', (0, 0, 200), 0.7e5, 200)):
        L = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'AREA')); L.data.energy = power * (0.7 if pressed else 1.0); L.data.size = size
        L.location = loc; scene.collection.objects.link(L)
        L.rotation_euler = (L.location.normalized() * -1).to_track_quat('-Z', 'Y').to_euler()
    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.32, 0.33, 0.36, 1)   # soft studio reflections on the silver
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.5
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = os.path.join(OUT, name + ('-down' if pressed else '') + '.png')
    bpy.ops.render.render(write_still=True)
    print('WROTE', scene.render.filepath)

for n in ('shuffle', 'prev', 'play', 'pause', 'next', 'gear', 'mic'):
    for pressed in (False, True):
        render(n, pressed)
