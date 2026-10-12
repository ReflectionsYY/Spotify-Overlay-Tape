# Spotify Overlay: the transport keys - satin, slightly worn aluminium hi-fi keys like a 90s CD / cassette deck
# (matte brushed metal with grime in the grain and softened edges, not chrome), each with a printed symbol.
# They are drawn to sit FLUSH side by side in a dark slot (the page supplies the slot), so each image is just
# the key on a thin dark seam. Rendered top-down with a transparent background, twice per key: up, and
# pressed (sunk ~5 units, in its own shadow) - the page also uses the pressed render for latched keys
# (play while playing, shuffle while on), the way real deck keys stay down.
# Run:  blender.exe -b -P art/buttons.py -- <out dir>
# Writes <name>.png and <name>-down.png for: shuffle prev playpause next gear mic.  150 x 93 px = 3 px per CSS px.
import bpy, math, sys, os

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '//keys'
W, H = 150, 93                      # image px == Blender units (50 x 31 CSS px)
KW, KH, KD = 144, 87, 12            # key: nearly the full image, so neighbours meet at a thin dark seam
INK = 0.02

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene

def satin(name, shade, rough):
    """worn satin aluminium: horizontal brushing, grime settled in patches, a little edge dust"""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; L = nt.links.new
    b.inputs['Metallic'].default_value = 0.9
    tc = nt.nodes.new('ShaderNodeTexCoord')
    bm = nt.nodes.new('ShaderNodeMapping'); bm.inputs['Scale'].default_value = (0.01, 2.2, 1)
    brush = nt.nodes.new('ShaderNodeTexNoise'); brush.inputs['Scale'].default_value = 14; brush.inputs['Detail'].default_value = 10
    grime = nt.nodes.new('ShaderNodeTexNoise'); grime.inputs['Scale'].default_value = 0.08; grime.inputs['Detail'].default_value = 10; grime.inputs['Roughness'].default_value = 0.7
    gr = nt.nodes.new('ShaderNodeValToRGB'); gr.color_ramp.elements[0].position = 0.45; gr.color_ramp.elements[1].position = 0.7
    base = nt.nodes.new('ShaderNodeMix'); base.data_type = 'RGBA'
    base.inputs['A'].default_value = (0.47 * shade, 0.48 * shade, 0.50 * shade, 1); base.inputs['B'].default_value = (0.22 * shade, 0.21 * shade, 0.20 * shade, 1)
    rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = rough; rr.inputs['To Max'].default_value = rough + 0.22
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.07
    L(tc.outputs['Object'], bm.inputs['Vector']); L(bm.outputs['Vector'], brush.inputs['Vector'])
    L(tc.outputs['Object'], grime.inputs['Vector']); L(grime.outputs['Fac'], gr.inputs['Fac'])
    L(gr.outputs['Color'], base.inputs['Factor']); L(base.outputs['Result'], b.inputs['Base Color'])
    L(gr.outputs['Color'], rr.inputs['Value']); L(rr.outputs['Result'], b.inputs['Roughness'])
    L(brush.outputs['Fac'], bump.inputs['Height']); L(bump.outputs['Normal'], b.inputs['Normal'])
    return m

def flat(name, color, rough, metallic=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Metallic'].default_value = metallic; b.inputs['Roughness'].default_value = rough
    return m

def box(w, h, d, z, bevel, mat, segs=4):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z))
    o = bpy.context.object; o.scale = (w, h, d)
    bpy.ops.object.transform_apply(scale=True)
    m = o.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = segs; m.limit_method = 'ANGLE'
    o.data.materials.append(mat); bpy.ops.object.shade_smooth()
    return o

def poly(scene, pts, z, mat, depth=0.6):
    """flat printed symbol from closed outlines"""
    cu = bpy.data.curves.new('ink', 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'; cu.extrude = depth / 2
    for outline in pts:
        sp = cu.splines.new('POLY'); sp.points.add(len(outline) - 1)
        for p, (x, y) in zip(sp.points, outline): p.co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    ob = bpy.data.objects.new('ink', cu); ob.location.z = z
    scene.collection.objects.link(ob); ob.data.materials.append(mat)

def tri(cx, cy, w, h, right=True):
    s = 1 if right else -1
    return [(cx - s * w / 2, cy - h / 2), (cx + s * w / 2, cy), (cx - s * w / 2, cy + h / 2)]

def rect(cx, cy, w, h):
    return [(cx - w / 2, cy - h / 2), (cx + w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), (cx - w / 2, cy + h / 2)]

def ring_pts(cx, cy, r, n=40):
    return [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]

def capsule(cx, cy, w, h, n=12):
    r = w / 2
    top = [(cx + r * math.cos(math.pi * k / n), cy + h / 2 - r + r * math.sin(math.pi * k / n)) for k in range(n + 1)]
    bot = [(cx - r * math.cos(math.pi * k / n), cy - h / 2 + r - r * math.sin(math.pi * k / n)) for k in range(n + 1)]
    return top + bot

def gear_pts(cx, cy, r_out, r_in, teeth=8):
    return [(cx + (r_out if (k % 4) in (1, 2) else r_in) * math.cos(2 * math.pi * k / (teeth * 4)),
             cy + (r_out if (k % 4) in (1, 2) else r_in) * math.sin(2 * math.pi * k / (teeth * 4))) for k in range(teeth * 4)]

def band(points, width):
    """a stroked open polyline as one polygon"""
    left, right = [], []
    for i, (x, y) in enumerate(points):
        x0, y0 = points[max(0, i - 1)]; x1, y1 = points[min(len(points) - 1, i + 1)]
        dx, dy = x1 - x0, y1 - y0; Ln = math.hypot(dx, dy) or 1
        nx, ny = -dy / Ln * width / 2, dx / Ln * width / 2
        left.append((x + nx, y + ny)); right.append((x - nx, y - ny))
    return left + right[::-1]

def symbol(name):
    if name == 'playpause': return [tri(-12, 0, 20, 24), rect(9, 0, 5.5, 22), rect(18, 0, 5.5, 22)]   # the deck's combined key
    if name == 'next':  return [tri(-8, 0, 18, 22), tri(8, 0, 18, 22), rect(19, 0, 3.5, 22)]
    if name == 'prev':  return [tri(8, 0, 18, 22, False), tri(-8, 0, 18, 22, False), rect(-19, 0, 3.5, 22)]
    if name == 'gear':  return [gear_pts(0, 0, 13, 10, 8)]
    if name == 'mic':   return [capsule(0, 5, 9.5, 17), band([(-8.5, 3), (-8.5, -2.5), (-5, -7), (5, -7), (8.5, -2.5), (8.5, 3)], 2.3), rect(0, -10.5, 2.4, 6), rect(0, -14, 12, 2.4)]
    if name == 'shuffle':
        a = [(-22, -8), (-9, -8), (5, 8), (14, 8)]; b = [(-22, 8), (-9, 8), (5, -8), (14, -8)]
        return [band(a, 3.6), band(b, 3.6), tri(19, 8, 9, 11), tri(19, -8, 9, 11)]
    return []

def render(name, pressed):
    scene = reset()
    shade = 0.7 if pressed else 1.0
    key = satin('satin', shade, 0.42 if not pressed else 0.5)
    seam = flat('seam', (0.012, 0.012, 0.014), 0.8)
    ink = flat('ink', (0.03, 0.03, 0.034) if not pressed else (0.025, 0.025, 0.028), 0.6)
    hub = satin('hub', shade * 0.95, 0.4)
    box(W - 1, H - 1, 4, -8, 3, seam, 2)                                   # thin dark seam under the key
    sink = 5 if pressed else 0
    top = KD / 2 - sink
    box(KW, KH, KD, -sink, 5.5, key, 6)                                    # softened, worn edges
    poly(scene, symbol(name), top + INK, ink)
    if name == 'gear': poly(scene, [ring_pts(0, 0, 4.6)], top + INK + 0.4, hub)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = W; cam.location = (0, 0, 120); scene.camera = cam
    for nm, loc, power, size in (('key', (-140, 120, 150), 3.4e5, 160), ('fill', (160, -90, 130), 0.9e5, 180), ('top', (0, 0, 200), 0.5e5, 220)):
        Lt = bpy.data.objects.new(nm, bpy.data.lights.new(nm, 'AREA')); Lt.data.energy = power * (0.62 if pressed else 1.0); Lt.data.size = size
        Lt.location = loc; scene.collection.objects.link(Lt)
        Lt.rotation_euler = (Lt.location.normalized() * -1).to_track_quat('-Z', 'Y').to_euler()
    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.22, 0.22, 0.24, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.4
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = os.path.join(OUT, name + ('-down' if pressed else '') + '.png')
    bpy.ops.render.render(write_still=True)
    print('WROTE', scene.render.filepath)

for n in ('shuffle', 'prev', 'playpause', 'next', 'gear', 'mic'):
    for pressed in (False, True):
        render(n, pressed)
