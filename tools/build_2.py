# Second wave of packs: Quaternius (Cyberpunk, Ultimate Space Kit, Ultimate Monsters,
# Toon Shooter), Kenney sound packs, more ambientCG materials and Poly Haven HDRIs.
# Usage: python3 tools/build_2.py <download dir> <lib dir>
import os, sys, json, glob, shutil, base64, struct, zipfile

def gltf_to_glb(src, dst):
    # same conversion as build.py: single embedded base64 buffer -> binary GLB
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

DL, LIB = sys.argv[1], sys.argv[2]
A = os.path.join(LIB, "assets")
Q = os.path.join(DL, "q2")
CC0_NOTE = "Quaternius — CC0 1.0 Universal (public domain). https://quaternius.com\n"

def convert(src_glob, dest, license_src=None, rename=lambda n: n):
    d = os.path.join(A, dest); os.makedirs(d, exist_ok=True)
    for f in sorted(glob.glob(src_glob)):
        name = rename(os.path.splitext(os.path.basename(f))[0])
        gltf_to_glb(f, os.path.join(d, name + ".glb"))
    if license_src and os.path.exists(license_src): shutil.copy(license_src, os.path.join(d, "License.txt"))
    else: open(os.path.join(d, "License.txt"), "w").write(CC0_NOTE)

sk = os.path.join(Q, "ultimatespacekit")
skl = os.path.join(sk, "License.txt")
convert(f"{sk}/Characters/GLTF/Mech_*.gltf", "mechs/space", skl)
convert(f"{sk}/Characters/GLTF/Astronaut_*.gltf", "characters/astronauts", skl)
convert(f"{sk}/Characters/GLTF/Enemy_*.gltf", "enemies/space", skl)
convert(f"{sk}/Vehicles/GLTF/*.gltf", "vehicles/space", skl)
convert(f"{sk}/Items/GLTF/*.gltf", "pickups/space", skl)
convert(f"{sk}/Environment/GLTF/*.gltf", "environment/planet", skl)

cp = os.path.join(Q, "cyberpunkgamekit")
cpl = os.path.join(cp, "License.txt")
convert(f"{cp}/Character/*.gltf", "characters/cyberpunk", cpl)
convert(f"{cp}/Enemies/Enemy_*.gltf", "enemies/cyberpunk", cpl)
convert(f"{cp}/Enemies/Turret_*.gltf", "turrets/cyberpunk", cpl)

convert(f"{Q}/toonshootergamekit/Characters/glTF/*.gltf", "characters/soldiers")

mo = os.path.join(Q, "ultimatemonsters")
for kind in ("Big", "Blob", "Flying"):
    convert(f"{mo}/{kind}/glTF/*.gltf", f"enemies/monsters-{kind.lower()}", os.path.join(mo, "License.txt"))

# Kenney sound packs -> assets/audio/<pack>/*.ogg
for z in glob.glob(os.path.join(DL, "kenney2", "*.zip")):
    pack = os.path.basename(z)[len("kenney_"):-len(".zip")].replace("-sounds", "").replace("-audio", "")
    d = os.path.join(A, "audio", pack); os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(z) as zf:
        for n in zf.namelist():
            base = os.path.basename(n)
            if n.lower().endswith(".ogg") or base == "License.txt":
                open(os.path.join(d, base), "wb").write(zf.read(n))

d = os.path.join(A, "hdri")
for f in glob.glob(os.path.join(DL, "polyhaven2", "*.hdr")): shutil.copy(f, d)

MAP = {"Color": "color", "NormalGL": "normal", "Roughness": "roughness", "Metalness": "metalness", "AmbientOcclusion": "ao"}
for z in glob.glob(os.path.join(DL, "ambientcg2", "*.zip")):
    name = os.path.splitext(os.path.basename(z))[0]
    d = os.path.join(A, "textures", name); os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(z) as zf:
        for n in zf.namelist():
            for k, v in MAP.items():
                if n.endswith(f"_{k}.jpg"): open(os.path.join(d, v + ".jpg"), "wb").write(zf.read(n))
print("done")
