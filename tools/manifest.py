# Writes assets/manifest.json and LICENSES.md for every file under assets/
import os, sys, json, glob, struct
LIB = sys.argv[1]; A = os.path.join(LIB, "assets")
CC0 = "CC0-1.0"
PACKS = {
  "weapons/blasters":          ("Kenney — Blaster Kit", "Kenney", "https://kenney.nl/assets/blaster-kit"),
  "space/kit":                 ("Kenney — Space Kit", "Kenney", "https://kenney.nl/assets/space-kit"),
  "environment/space-station": ("Kenney — Space Station Kit", "Kenney", "https://kenney.nl/assets/space-station-kit"),
  "environment/prototype":     ("Kenney — Prototype Kit", "Kenney", "https://kenney.nl/assets/prototype-kit"),
  "vfx/sprites":               ("Kenney — Particle Pack", "Kenney", "https://kenney.nl/assets/particle-pack"),
  "mechs":                     ("Quaternius — Animated Mech Pack", "Quaternius", "https://quaternius.com/packs/animatedmech.html"),
  "space/ships":               ("Quaternius — Ultimate Spaceships", "Quaternius", "https://quaternius.com/packs/ultimatespaceships.html"),
  "weapons/guns":              ("Quaternius — Ultimate Gun Pack", "Quaternius", "https://quaternius.com/packs/ultimategun.html"),
  "turrets":                   ("Quaternius — Turret Pack", "Quaternius", "https://quaternius.com/packs/turretpack.html"),
  "characters/robot":          ("Quaternius — Animated Robot", "Quaternius", "https://quaternius.com/packs/animatedrobot.html"),
  "hdri":                      ("Poly Haven HDRIs", "Poly Haven", "https://polyhaven.com/hdris"),
  "textures":                  ("ambientCG PBR materials", "ambientCG", "https://ambientcg.com"),
}
def glb_anims(p):
    b = open(p, "rb").read(); n = struct.unpack("<I", b[12:16])[0]
    return [a.get("name") for a in json.loads(b[20:20+n]).get("animations", [])]
items = []
for folder, (pack, author, url) in PACKS.items():
    d = os.path.join(A, folder)
    if folder == "textures":
        for m in sorted(os.listdir(d)):
            maps = sorted(os.path.splitext(f)[0] for f in os.listdir(os.path.join(d, m)))
            items.append({"id": f"material/{m}", "type": "material", "category": "textures", "path": f"textures/{m}/", "maps": maps,
                          "pack": pack, "author": author, "source": f"https://ambientcg.com/view?id={m}", "license": CC0})
        continue
    for f in sorted(os.listdir(d)):
        name, ext = os.path.splitext(f); ext = ext[1:].lower()
        kind = {"glb": "model", "fbx": "model", "hdr": "hdri", "png": "sprite"}.get(ext)
        if not kind: continue
        it = {"id": f"{folder}/{name}", "type": kind, "category": folder.split("/")[0], "group": folder,
              "path": f"{folder}/{f}", "format": ext, "pack": pack, "author": author, "source": url, "license": CC0}
        if ext == "glb":
            an = glb_anims(os.path.join(d, f))
            if an: it["animations"] = an
        if folder == "hdri": it["source"] = f"https://polyhaven.com/a/{name}"
        items.append(it)
json.dump({"license": "All assets CC0-1.0 (public domain). No attribution required.", "count": len(items), "assets": items},
          open(os.path.join(A, "manifest.json"), "w"), indent=1)
with open(os.path.join(LIB, "LICENSES.md"), "w") as o:
    o.write("# Asset licenses\n\nEvery third-party asset in `assets/` is **CC0 1.0 (public domain)**: free for commercial use, no attribution required.\n"
            "Per-file source and license are recorded in `assets/manifest.json`; each pack folder keeps its original `License.txt`.\n\n"
            "| Folder | Pack | Author | Source | License |\n|---|---|---|---|---|\n")
    for folder, (pack, author, url) in PACKS.items():
        o.write(f"| `assets/{folder}` | {pack} | {author} | {url} | CC0 1.0 |\n")
    o.write("\nCode in `src/` (VFX, power-ups, renderer preset, loader) and `index.html` was written for this repo and is MIT licensed.\n")
print(len(items))
