# Fourth wave: cars, racing and road props, plus car sounds. All CC0.
# Kenney Starter Kit Racing (GitHub), Quaternius Car Pack + Public Transport (OpenGameArt),
# Rgsdev Free Low Poly Vehicles, Mehrasaur 3D Vehicles, Lyricsz 20 cars, Daniel Quevedo
# Low Poly Vehicles, and OpenGameArt CC0 car sounds (ggbot, domasx2, looneybits, mikeask, theminesareshakin).
# Usage: python3 tools/build_4.py <download dir> <lib dir>
import os, sys, glob, shutil

DL, LIB = sys.argv[1], sys.argv[2]
A = os.path.join(LIB, "assets")
X = os.path.join(DL, "x")

def put(srcs, dest, rename=lambda n: n, note=None):
    d = os.path.join(A, dest); os.makedirs(d, exist_ok=True)
    for f in sorted(srcs):
        base, ext = os.path.splitext(os.path.basename(f))
        shutil.copy(f, os.path.join(d, rename(base).replace(" ", "_") + ext.lower()))
    if note: open(os.path.join(d, "License.txt"), "w").write(note)
    return d

def cc0(who, url): return f"{who} — CC0 1.0 Universal (public domain). {url}\n"

R = os.path.join(DL, "racing")
k = cc0("Kenney (Starter Kit Racing)", "https://github.com/KenneyNL/Starter-Kit-Racing")
for dest, pat in (("vehicles/racing", "vehicle-*.glb"), ("environment/race-track", "[td][re]*.glb")):
    d = put(glob.glob(f"{R}/models/{pat}"), dest, note=k)
    os.makedirs(f"{d}/Textures", exist_ok=True); shutil.copy(f"{R}/models/Textures/colormap.png", f"{d}/Textures/")
put(glob.glob(f"{R}/audio/*.ogg"), "audio/racing", note=k)

q = cc0("Quaternius", "https://opengameart.org/content/lowpoly-cars")
put(glob.glob(f"{X}/Car20Pack/Car Pack/FBX/*.fbx"), "vehicles/classic", note=q)
pt = f"{X}/Public20Transport_0/Public Transport/FBX"
put([f for f in glob.glob(f"{pt}/*.fbx") if "Traffic" not in f], "vehicles/classic",
    rename=lambda n: "Taxi2" if n == "Taxi" else n)
put(glob.glob(f"{pt}/Traffic*.fbx"), "props/road", note=q)

rg = f"{X}/free_low_poly_vehicles_pack_by_rgsdev/Free Low Poly Vehicles Pack by Rgsdev"
d = put([f for f in glob.glob(f"{rg}/*/*.fbx")], "vehicles/cars")
shutil.copy(f"{rg}/License.txt", d)
put(glob.glob(f"{X}/vehicle_pack/dist/fbx/*.fbx"), "vehicles/city", note=cc0("Mehrasaur", "https://opengameart.org/content/3d-vehicles-pack"))
put(glob.glob(f"{X}/cars20withanimation_0/GLTF/*.glb"), "vehicles/toon",
    rename=lambda n: "Car_%02d" % int(n[4:]), note=cc0("Lyricsz", "https://opengameart.org/content/ultimate-3d-car-assets-pack-w-interiors-and-animations"))
qv = f"{X}/VehiclesFBXformat"
dq = cc0("Daniel Quevedo", "https://opengameart.org/content/low-poly-vehicles-pack")
put([f"{qv}/{n}.fbx" for n in ("Bus", "Jeep", "Pickup", "Sedan", "Wagon")], "vehicles/basic", note=dq)
put([f"{qv}/{n}.fbx" for n in ("Cone", "StopSign", "StreetLamp")], "props/road-basic", note=dq)

O = os.path.join(DL, "oga2")
put(glob.glob(f"{X}/psx_style_cars_by_ggbot_august2023/Sound effects/*.ogg"), "audio/car",
    note=cc0("ggbotnet", "https://opengameart.org/content/car-sound-effects-pack-low-quality"))
put(glob.glob(f"{O}/racing-car-engine-sound-loops/*.wav"), "audio/engine-loops",
    rename=lambda n: "engine_" + n.split("_")[1], note=cc0("domasx2", "https://opengameart.org/content/racing-car-engine-sound-loops"))
put(glob.glob(f"{O}/car-engine-start-01/*.wav") + glob.glob(f"{O}/cardoorsfx/*.wav") + glob.glob(f"{O}/car-blinker-sfx/*.wav"),
    "audio/car-extra", note=cc0("looneybits", "https://opengameart.org/users/looneybits"))
put(glob.glob(f"{O}/car-acceleration/*.wav"), "audio/car-acceleration", rename=lambda n: "acceleration",
    note=cc0("mikeask", "https://opengameart.org/content/car-acceleration"))
put(glob.glob(f"{O}/rocket-engine/*.wav"), "audio/rocket", rename=lambda n: "rocket_engine",
    note=cc0("theminesareshakin", "https://opengameart.org/content/rocket-engine"))
print("done")
