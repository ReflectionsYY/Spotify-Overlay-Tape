# Spotify Overlay: the now-playing box frame - a bevelled, grimy gunmetal bezel in the style of Site Monsters'
# monster boxes (dark brushed metal, corner screws, small glowing strips), rendered top-down with a transparent
# centre and background so the page can 9-slice it around a box of any width (CSS border-image, 48 px slices).
# Run:  blender.exe -b -P art/frame.py -- <out.png>
# Image is 600 x 200 px = 2 px per CSS px; the rim is 14 px (7 CSS px) and everything except the plain rim sits
# inside the 48 px corners, so stretching the edges never smears a detail.
import bpy, math, sys

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '//frame.png'
W, H = 600, 200            # render size, px == Blender units
RIM, R_OUT = 14, 18        # rim width (7 CSS px), outer corner radius
DEPTH = 8

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def rounded_rect(w, h, r, seg=10):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), 0))
    return pts

def ring(name, w, h, r_out, rim, r_in, z, depth, bevel, mat):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'
    cu.extrude = depth / 2; cu.bevel_depth = bevel; cu.bevel_resolution = 4
    for pts in (rounded_rect(w, h, r_out), rounded_rect(w - 2 * rim, h - 2 * rim, r_in)):
        sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
        for p, (x, y, _) in zip(sp.points, pts): p.co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    ob = bpy.data.objects.new(name, cu); ob.location.z = z
    scene.collection.objects.link(ob); ob.data.materials.append(mat)
    return ob

def metal(name, color, rough, bump=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Metallic'].default_value = 1.0; b.inputs['Roughness'].default_value = rough
    if bump:
        tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); nz = nt.nodes.new('ShaderNodeTexNoise'); bp = nt.nodes.new('ShaderNodeBump')
        mp.inputs['Scale'].default_value = (0.02, 1.2, 1)            # stretched noise = brushed grain
        nz.inputs['Scale'].default_value = 6; nz.inputs['Detail'].default_value = 8
        bp.inputs['Strength'].default_value = bump
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], nz.inputs['Vector'])
        nt.links.new(nz.outputs['Fac'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

def emissive(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Emission Color'].default_value = (*color, 1); b.inputs['Emission Strength'].default_value = strength
    return m

def grimy(name, color, rough):
    # worn gunmetal: grime pooled in patches, fine scratches, dust specks and patchy roughness
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; L = nt.links.new
    b.inputs['Metallic'].default_value = 0.85
    tc = nt.nodes.new('ShaderNodeTexCoord')
    grime = nt.nodes.new('ShaderNodeTexNoise'); grime.inputs['Scale'].default_value = 0.035; grime.inputs['Detail'].default_value = 12; grime.inputs['Roughness'].default_value = 0.7
    gr = nt.nodes.new('ShaderNodeValToRGB'); gr.color_ramp.elements[0].position = 0.42; gr.color_ramp.elements[1].position = 0.62
    smap = nt.nodes.new('ShaderNodeMapping'); smap.inputs['Scale'].default_value = (0.004, 0.9, 1); smap.inputs['Rotation'].default_value = (0, 0, 0.35)
    scr = nt.nodes.new('ShaderNodeTexNoise'); scr.inputs['Scale'].default_value = 3.0; scr.inputs['Detail'].default_value = 2
    sr = nt.nodes.new('ShaderNodeValToRGB'); sr.color_ramp.elements[0].position = 0.70; sr.color_ramp.elements[1].position = 0.74
    dust = nt.nodes.new('ShaderNodeTexNoise'); dust.inputs['Scale'].default_value = 1.6; dust.inputs['Detail'].default_value = 0
    dr = nt.nodes.new('ShaderNodeValToRGB'); dr.color_ramp.elements[0].position = 0.66; dr.color_ramp.elements[1].position = 0.70
    base = nt.nodes.new('ShaderNodeMix'); base.data_type = 'RGBA'; base.inputs['A'].default_value = (*color, 1); base.inputs['B'].default_value = (0.022, 0.018, 0.014, 1)
    wear = nt.nodes.new('ShaderNodeMix'); wear.data_type = 'RGBA'; wear.inputs['B'].default_value = (0.32, 0.33, 0.35, 1)
    dusty = nt.nodes.new('ShaderNodeMix'); dusty.data_type = 'RGBA'; dusty.inputs['B'].default_value = (0.20, 0.19, 0.17, 1)
    rough_mix = nt.nodes.new('ShaderNodeMapRange'); rough_mix.inputs['To Min'].default_value = rough; rough_mix.inputs['To Max'].default_value = 0.78
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35
    L(tc.outputs['Object'], grime.inputs['Vector']); L(grime.outputs['Fac'], gr.inputs['Fac'])
    L(tc.outputs['Object'], smap.inputs['Vector']); L(smap.outputs['Vector'], scr.inputs['Vector']); L(scr.outputs['Fac'], sr.inputs['Fac'])
    L(tc.outputs['Object'], dust.inputs['Vector']); L(dust.outputs['Fac'], dr.inputs['Fac'])
    L(gr.outputs['Color'], base.inputs['Factor']); L(base.outputs['Result'], wear.inputs['A']); L(sr.outputs['Color'], wear.inputs['Factor'])
    L(wear.outputs['Result'], dusty.inputs['A']); L(dr.outputs['Color'], dusty.inputs['Factor']); L(dusty.outputs['Result'], b.inputs['Base Color'])
    L(gr.outputs['Color'], rough_mix.inputs['Value']); L(rough_mix.outputs['Result'], b.inputs['Roughness'])
    L(grime.outputs['Fac'], bump.inputs['Height']); L(bump.outputs['Normal'], b.inputs['Normal'])
    return m

gun = grimy('gunmetal', (0.07, 0.075, 0.085), 0.32)
dark = metal('inner-lip', (0.025, 0.027, 0.034), 0.5, bump=0.1)
steel = metal('screw', (0.42, 0.44, 0.48), 0.25)
glow = emissive('glow', (0.56, 0.45, 1.0), 2.2)

# main bezel, then a recessed darker lip on its inner edge (the layered look of the monster boxes)
ring('bezel', W - 4, H - 4, R_OUT, RIM, 6, 0, DEPTH, 2.4, gun)
ring('lip', W - 4 - 2 * (RIM - 5), H - 4 - 2 * (RIM - 5), 8, 10, 4, -2, DEPTH - 3, 1.0, dark)

# corner screws (domed heads with a slot), centred in the rim
for sx in (-1, 1):
    for sy in (-1, 1):
        x, y = sx * (W / 2 - 2 - RIM / 2 - 3), sy * (H / 2 - 2 - RIM / 2 - 1)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=3.4, location=(x, y, DEPTH / 2 + 3.6), segments=24, ring_count=12)
        s = bpy.context.object; s.scale.z = 0.45; s.data.materials.append(steel); bpy.ops.object.shade_smooth()
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, DEPTH / 2 + 5.4))
        c = bpy.context.object; c.scale = (5.6, 1.0, 1.0); c.rotation_euler.z = math.radians(35 * sx * sy); c.data.materials.append(dark)

# short glowing strips on the top rim, tucked inside the corner slices
for sx in (-1, 1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sx * (W / 2 - 2 - 42), H / 2 - 2 - RIM / 2 + 1, DEPTH / 2 + 3.6))
    g = bpy.context.object; g.scale = (14, 1.8, 1.0); g.data.materials.append(glow)

# top-down orthographic camera, key light from the upper left, soft fill
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = W; cam.location = (0, 0, 200); scene.camera = cam
for name, loc, power, size in (('key', (-260, 220, 260), 2.6e6, 220), ('fill', (300, -160, 220), 6e5, 300), ('rim', (0, 400, 60), 4e5, 200)):
    L = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA')); L.data.energy = power; L.data.size = size
    L.location = loc; scene.collection.objects.link(L)
    d = L.location.normalized() * -1
    L.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.05, 0.07, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('WROTE', OUT)
