# Third wave: unarmed, rigged "base characters" for populating games with people.
# Quaternius Ultimate Animated Character Pack, Ultimate Modular Men/Women, Animated Men/Women.
# Weapon meshes (Pistol, Sword) baked into a few modular characters are stripped.
# Usage: python3 tools/build_3.py <download dir> <lib dir>
import os, sys, json, glob, shutil, base64, struct

WEAPONS = {"Pistol", "Sword"}
SKIP = {"Cow", "Pug", "Zombie_Female", "Zombie_Male", "Goblin_Female", "Goblin_Male"}  # not people

def gltf_to_glb(src, dst):
    j = json.load(open(src))
    for n in j["nodes"]:
        if n.get("name") in WEAPONS:
            n.pop("mesh", None); n.pop("skin", None)
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
A = os.path.join(LIB, "assets", "base-characters")
CC0_NOTE = "Quaternius — CC0 1.0 Universal (public domain). https://quaternius.com\n"

def out(dest):
    d = os.path.join(A, dest); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "License.txt"), "w").write(CC0_NOTE)
    return d

d = out("people")
for f in sorted(glob.glob(f"{DL}/uac/glTF/*.gltf")):
    name = os.path.splitext(os.path.basename(f))[0]
    if name not in SKIP: gltf_to_glb(f, os.path.join(d, name + ".glb"))

d = out("modular")
for sex, pack in (("Male", "umm"), ("Female", "umw")):
    for f in sorted(glob.glob(f"{DL}/{pack}/Individual Characters/glTF/*.gltf")):
        name = os.path.splitext(os.path.basename(f))[0].replace("_", "")
        gltf_to_glb(f, os.path.join(d, f"{sex}_{name}.glb"))

d = out("simple")
for f in sorted(glob.glob(f"{DL}/amen/FBX/Smooth_*.fbx") + glob.glob(f"{DL}/awomen/FBX/Smooth_*.fbx")):
    shutil.copy(f, os.path.join(d, os.path.basename(f)[len("Smooth_"):]))
print("done")
