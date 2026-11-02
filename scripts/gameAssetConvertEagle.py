import bpy,json,hashlib,sys
# Run with Blender --background --factory-startup --disable-autoexec --python SCRIPT -- SOURCE OUTPUT
assert bpy.app.version[:3] == (4,3,2), "Review conversion changes before using a different Blender version"
args=sys.argv[sys.argv.index("--")+1:]
assert len(args)==2, "Supply the reviewed FBX and output GLB paths"
path=args[0]
assert hashlib.sha256(open(path,'rb').read()).hexdigest()=='c3504c8e0904eab7b14e695609a861417f089cf724b94bda821ea4a3bbc6f505'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path,use_image_search=False)
print('EAGLE_INSPECTION',json.dumps({'objects':[(o.name,o.type,len(o.data.polygons)if o.type=='MESH'else 0)for o in bpy.data.objects], 'actions':[(a.name,list(a.frame_range))for a in bpy.data.actions],'images':[i.filepath for i in bpy.data.images]}))

for material in bpy.data.materials:
 if material.use_nodes:
  for node in material.node_tree.nodes:
   if node.type=='BSDF_PRINCIPLED':
    node.inputs['Metallic'].default_value=0
    node.inputs['Roughness'].default_value=.8
    node.inputs['Specular IOR Level'].default_value=.5
bpy.ops.export_scene.gltf(filepath=args[1],export_format='GLB',export_animations=True,export_materials='EXPORT',export_extras=False)
