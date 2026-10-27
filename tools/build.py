# Organize downloaded CC0 packs into ~/lib/assets and convert embedded .gltf -> .glb
import os, sys, json, glob, shutil, base64, struct, zipfile, subprocess
DL, LIB = sys.argv[1], sys.argv[2]
A = os.path.join(LIB, "assets")

def gltf_to_glb(src, dst):
    j = json.load(open(src))
    bufs = [base64.b64decode(b["uri"].split(",", 1)[1]) for b in j["buffers"]]
    assert len(bufs) == 1, src
    data = bufs[0] + b"\0" * (-len(bufs[0]) % 4)
    j["buffers"] = [{"byteLength": len(bufs[0])}]
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(data))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(data), 0x004E4942) + data
    open(dst, "wb").write(out)

def copy_kenney(pack, sub, dest):
    s = os.path.join(DL, "kenney", pack, "Models", sub)
    d = os.path.join(A, dest); os.makedirs(os.path.join(d, "Textures"), exist_ok=True)
    for f in glob.glob(os.path.join(s, "*.glb")): shutil.copy(f, d)
    for f in glob.glob(os.path.join(s, "Textures", "*")): shutil.copy(f, os.path.join(d, "Textures"))
    shutil.copy(os.path.join(DL, "kenney", pack, "License.txt"), d)

copy_kenney("kenney_blaster-kit_2.1", "GLB format", "weapons/blasters")
copy_kenney("kenney_space-kit", "GLTF format", "space/kit")
copy_kenney("kenney_space-station-kit", "GLB format", "environment/space-station")
copy_kenney("kenney_prototype-kit", "GLB format", "environment/prototype")

Q = os.path.join(DL, "quaternius")
for pack, dest, ext in [("animatedmech", "mechs", "gltf"), ("ultimatespaceships", "space/ships", "gltf"),
                        ("ultimategun", "weapons/guns", "fbx"), ("turretpack", "turrets", "fbx"),
                        ("animatedrobot", "characters/robot", "fbx")]:
    d = os.path.join(A, dest); os.makedirs(d, exist_ok=True)
    for f in glob.glob(os.path.join(Q, pack, "*." + ext)):
        name = os.path.splitext(os.path.basename(f))[0]
        if ext == "gltf": gltf_to_glb(f, os.path.join(d, name + ".glb"))
        else: shutil.copy(f, d)
    shutil.copy(os.path.join(Q, pack, "License.txt"), d)

# Particle sprites: transparent set, downscaled to 256px
src = os.path.join(DL, "kenney", "kenney_particle-pack", "PNG (Transparent)")
d = os.path.join(A, "vfx", "sprites"); os.makedirs(d, exist_ok=True)
for f in glob.glob(os.path.join(src, "*.png")):
    subprocess.run(["sips", "-Z", "256", f, "--out", os.path.join(d, os.path.basename(f))], capture_output=True)
shutil.copy(os.path.join(DL, "kenney", "kenney_particle-pack", "License.txt"), d)

d = os.path.join(A, "hdri"); os.makedirs(d, exist_ok=True)
for f in glob.glob(os.path.join(DL, "polyhaven", "*.hdr")): shutil.copy(f, d)

# ambientCG PBR sets -> textures/<name>/{color,normal,roughness,metalness,ao}.jpg
MAP = {"Color": "color", "NormalGL": "normal", "Roughness": "roughness", "Metalness": "metalness", "AmbientOcclusion": "ao"}
for z in glob.glob(os.path.join(DL, "ambientcg", "*.zip")):
    name = os.path.splitext(os.path.basename(z))[0]
    d = os.path.join(A, "textures", name); os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(z) as zf:
        for n in zf.namelist():
            for k, v in MAP.items():
                if n.endswith(f"_{k}.jpg"): open(os.path.join(d, v + ".jpg"), "wb").write(zf.read(n))
print("done")
