# Game Asset Library

A drop-in Three.js asset library: **1,357 CC0 assets**:
- 853 models: base characters (unarmed people), 78 cars and trucks, race-track pieces, mechs, heroes, enemies, monsters, guns, turrets, vehicles, spaceships, pickups, environments
- 400 sound effects, including engines, skids, horns and doors
- 16 PBR materials, 8 HDRIs and 80 particle sprites

It also includes code written for this repo: a VFX system, a sound board, procedural power-ups, a "pro look" renderer preset, and a **customisation layer** (sockets, add-on parts and a vehicle rig) so assets can be combined and extended instead of being one-off models.

All third-party assets are **CC0 / public domain**: free for commercial use with no attribution. Every file's source and license is in [`assets/manifest.json`](assets/manifest.json), with a summary in [`LICENSES.md`](LICENSES.md).

## Browse it

No build step is needed. Serve the folder and open `index.html`:

```bash
python3 tools/serve.py 8790
```

(`python3 -m http.server` works too, but browsers may cache old copies of the JS modules.)

Open http://localhost:8790. The catalog has these tabs:
- **Models:** search, orbit, play animations, switch HDRIs
- **Garage:** pick any vehicle, paint it, bolt on parts, seat a driver, change the engine sound, and try combat, boost and hover modes
- **VFX:** live demo of every effect, with sound
- **Power-ups**
- **Materials**
- **Audio:** click any of the 400 sounds to hear it

Each item shows a copy-paste code snippet.

## Use it in a game

Uses Three.js `0.160.0` through an import map, the same setup as the catalog page:

```js
import { createStage } from './lib/src/stage.js';
import { AssetLibrary } from './lib/src/library.js';
import { VFX } from './lib/src/vfx.js';
import { createPowerUp } from './lib/src/powerups.js';
import { SoundBoard } from './lib/src/sfx.js';

const stage = createStage(document.body, { hdri: './lib/assets/hdri/studio_small_09.hdr' });
const lib = await AssetLibrary.load('./lib/assets/');
const vfx = await new VFX(stage.scene, { spriteBase: './lib/assets/vfx/sprites/' }).init();
const sfx = new SoundBoard(stage.camera, { base: './lib/assets/' }).attach(stage.scene);

const mech = await lib.model('mechs/George', { size: 2 });
stage.scene.add(mech.object);
mech.play('Walk');

const shield = vfx.shield(mech.object);
const pickup = createPowerUp('health');
stage.scene.add(pickup.object);

stage.renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  mech.mixer.update(dt);
  pickup.update(dt);
  vfx.update(dt, stage.camera);
  stage.render();
});

// gameplay
vfx.muzzleFlash(muzzlePos, aimDir);
vfx.laser(from, to, { color: 0xff2a4a });
vfx.explosion(hitPos, { scale: 1.5 });
sfx.play('explosion', { position: hitPos });
vfx.damageNumber(hitPos, 42);
shield.hit(hitPos);
pickup.collect(vfx);
```

### `src/stage.js`: renderer preset
Sets up HDRI image-based lighting, ACES tone mapping, soft shadows, GTAO ambient occlusion, bloom and SMAA. Also includes `stage.frame(object)` and `stage.setHdri(url)`.

### `src/library.js`: asset loader
- `lib.model(id, { size })` returns `{ object, animations, mixer, play(name) }`. Each call gives an independent clone, including skinned meshes.
- `lib.material(id, { repeat })` returns a full PBR `MeshStandardMaterial`.
- `lib.find('rifle')` and `lib.find({ group: 'mechs' })` search the manifest.
- `recolor(m.object, { Skin: SKIN_TONES.tan, Hair: HAIR_TONES.black })` recolors one instance by material name. Use it to vary the base characters.

### Base characters
75 rigged, animated people with no weapons, for crowds, NPCs and players. All are Quaternius CC0.
- `base-characters/people`: 46 stylized characters, including casual, chef, doctor, suit, worker, cowboy, kimono, pirate, viking, knight, ninja, wizard and witch, many with male and female versions. Each has 16–17 clips: idle, walk, run, jump, sit, pick up, carry, punch, hit and death. Their original skin is a dark silhouette style; use `recolor` to give them real skin tones.
- `base-characters/modular`: 21 men and women, including adventurer, beach, casual, farmer, formal, king, punk, sci-fi, suit, SWAT and worker. Each has 24 clips. The pistols and sword that came with a few of them were removed.
- `base-characters/simple`: 8 plain men and women in casual clothes, shirts, suits and dresses (FBX).

### `src/vfx.js`: effects
Effects: `explosion`, `muzzleFlash`, `impact`, `laser`, `lightning` (branching arcs), `emp`, `teleport`, `chargeUp`, `healAura`, `hitFlash`, `damageNumber`, `ring`, `decal`, `pickupBurst`, `shield` (hex fresnel bubble with hit ripples), `trail` (ribbon), `portal`.

Particles are GPU-instanced, with one draw call per sprite texture. Flash lights come from a fixed pool, so firing effects never triggers shader recompiles.

### `src/sfx.js`: sound board
`sfx.play(name, { position })` plays a 3D sound, or a 2D one when no position is given. Each call picks a random variant and slightly varies the pitch so repeats don't sound identical. Presets include `laser`, `laserHeavy`, `blaster`, `zap`, `explosion`, `explosionBig`, `impactMetal`, `punch`, `shield`, `thruster`, `doorOpen`, `powerUp`, `phaseJump`, `footstep`, `click`, `select`, `confirm`, `error` and `glitch`. Any sound id from the manifest also works.

### Building on top of assets: sockets, parts and vehicles
Assets don't have to be one-off models. Three layers let you combine them:

**`src/sockets.js`: mount points on anything.** `autoSockets(obj)` adds `top/bottom/front/back/left/right/center` sockets from the bounds, plus `handR/handL/head/spine` on rigged characters. `attach(obj, 'handR', gun, { size: 0.6 })` mounts a part; it follows animated bones. `addSocket(obj, 'muzzle', { position })` adds your own.

```js
autoSockets(mech.object);
attach(mech.object, 'handR', (await lib.model('weapons/guns/AssaultRifle2_1')).object, { size: 0.9 });
attach(hero.object, 'head', (await lib.model('space/kit/satelliteDish')).object, { size: 0.3 });
```

**`src/parts.js`: procedural add-ons that size themselves to the host.** Parts include `roofRack`, `cargoBox`, `luggage`, `lightBar` (blinking), `spoiler`, `hoodScoop`, `bullBar`, `underglow`, `rocketPod` (fires missiles) and `boosters`. Each one takes the host's `{ w, h, l }`, so the same rack fits a hatchback and a bus.

**`src/vehicle.js`: turns any car model into a rig.**
- `loadVehicle(lib, id)` faces the car along +Z and finds its wheels, so they spin and steer. Single-mesh cars are split by their wheel materials.
- It raycasts the body to place slots: `roof`, `hood`, `trunk`, `front`, `rear`, `sides`, `under` and `seat`.

```js
const car = await loadVehicle(lib, 'vehicles/cars/Sports', { length: 4.2 });
scene.add(car.object);
car.equip('roof', PARTS.rocketPod(car.dims));
car.equip('hood', (await lib.model('turrets/Laser_MachineGun')).object, { size: car.dims.w * 0.4, weapon: true });
car.paint(0x1b56c9);
await car.addDriver(lib, 'base-characters/people/Casual_Male');   // any base character, seated
car.engine(sfx, 'race2');                // looping engine; pitch follows speed
car.update(dt, { speed, steer });        // every frame
car.fire(vfx, sfx, target);              // every equipped weapon: missiles or tracer bursts
await car.transform('combat', { vfx, sfx });   // weapons rise out of the body
await car.transform('boost',  { vfx, sfx });   // side boosters slide out and fire
await car.transform('hover',  { vfx, sfx });   // wheels fold flat, car lifts on thrusters (call again to land)
```

New effects for these features: `vfx.thrust(pos, dir)` (one frame of engine flame) and `vfx.missile(from, to)`. New sound presets: `engineStart`, `engineStop`, `accelerate`, `skid`, `crash`, `horn`, `carDoorOpen`, `carDoorClose`, `trunk`, `handbrake`, `blinker` and `rocket`, plus `ENGINE_LOOPS` for `car.engine()`.

### `src/powerups.js`: procedural pickups
Six types: `health`, `shield`, `ammo`, `speed`, `damage`, `energy`. Each has a pedestal, holo beam, beveled emissive icon, orbiting rings and rising motes.

## What's inside

| Folder | Contents | Source |
|---|---|---|
| `assets/vehicles/cars` | 21 low-poly cars, police, trucks, bus, monster truck (wheels rigged) | Rgsdev |
| `assets/vehicles/toon` | 20 toon cars | Lyricsz |
| `assets/vehicles/city`, `classic`, `basic` | 32 city cars, trucks, buses, bikes, a train | Mehrasaur, Quaternius, Daniel Quevedo |
| `assets/vehicles/racing`, `environment/race-track` | 4 racing trucks, a motorcycle, 9 track pieces | Kenney |
| `assets/props/road*` | Traffic lights, signs, cones, street lamp | Quaternius, Daniel Quevedo |
| `assets/audio/car`, `racing`, `engine-loops`, `car-*`, `rocket` | 35 car sounds: engine loops, start/stop, skid, horn, doors, blinkers | ggbotnet, Kenney, domasx2, looneybits, mikeask, theminesareshakin (all CC0, OpenGameArt) |
| `assets/base-characters` | 75 rigged, unarmed people: stylized, modular and simple | Quaternius |
| `assets/mechs` | 4 animated mechs (≈20 clips each: walk, run, shoot, punch, death…) | Quaternius |
| `assets/mechs/space` | 4 animated space mechs | Quaternius |
| `assets/characters/cyberpunk`, `soldiers`, `astronauts` | Animated hero, 3 soldiers, 4 astronauts | Quaternius |
| `assets/enemies/cyberpunk`, `space` | 10 animated robot and space enemies | Quaternius |
| `assets/enemies/monsters-*` | 50 animated monsters (big, blob, flying) | Quaternius |
| `assets/vehicles/space`, `pickups/space` | 7 rovers and ships, 7 pickups | Quaternius |
| `assets/environment/planet` | 66 planet-outpost pieces: bases, rocks, plants, planets | Quaternius |
| `assets/turrets/cyberpunk` | 4 turrets | Quaternius |
| `assets/audio` | 366 sounds: sci-fi, impacts and footsteps, interface, digital | Kenney |
| `assets/characters/robot` | Animated robot (FBX) | Quaternius |
| `assets/weapons/guns` | 40 firearms: rifles, pistols, shotguns, SMGs, snipers… (FBX) | Quaternius |
| `assets/weapons/blasters` | 40 sci-fi blasters, scopes, clips, grenades, targets | Kenney |
| `assets/turrets` | 37 turrets: cannons, lasers, guns, teleporters (FBX) | Quaternius |
| `assets/space/ships` | 11 textured spaceships | Quaternius |
| `assets/space/kit` | 153 space props: craft, rockets, turrets, astronauts, terrain | Kenney |
| `assets/environment/space-station` | 97 modular station pieces | Kenney |
| `assets/environment/prototype` | 145 level blockout pieces | Kenney |
| `assets/textures` | 16 PBR sets: metals, plates, rust, concrete, tiles, asphalt, fabric, ground (1K) | ambientCG |
| `assets/hdri` | 8 HDRIs: studio, skies, sunset, night, interior | Poly Haven |
| `assets/vfx/sprites` | 80 particle sprites | Kenney |

## Adding more

All of these sources are CC0:
- Kenney: kenney.nl/assets and github.com/KenneyNL
- OpenGameArt: opengameart.org, but only items whose page says CC0; many there are CC-BY or GPL
- Quaternius: quaternius.com
- Poly Haven: polyhaven.com
- ambientCG: ambientcg.com

`tools/build.py` … `tools/build_4.py` and `tools/manifest.py` show how packs are organized. Embedded `.gltf` files are converted to `.glb`, then the manifest is regenerated. After adding files, run:

```bash
python3 tools/manifest.py .
```
