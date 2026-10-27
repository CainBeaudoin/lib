# Game Asset Library

A drop-in Three.js asset library: **1,228 CC0 assets**:
- 759 models: base characters (unarmed people), mechs, heroes, enemies, monsters, guns, turrets, vehicles, spaceships, pickups, environments
- 365 sound effects
- 16 PBR materials, 8 HDRIs and 80 particle sprites

It also includes code written for this repo: a VFX system, a sound board, procedural power-ups and a "pro look" renderer preset.

All third-party assets are **CC0 / public domain**: free for commercial use with no attribution. Every file's source and license is in [`assets/manifest.json`](assets/manifest.json), with a summary in [`LICENSES.md`](LICENSES.md).

## Browse it

No build step is needed. Serve the folder and open `index.html`:

```bash
python3 -m http.server 8790
```

Open http://localhost:8790. The catalog has four tabs:
- **Models:** search, orbit, play animations, switch HDRIs
- **VFX:** live demo of every effect, with sound
- **Power-ups**
- **Materials**
- **Audio:** click any of the 365 sounds to hear it

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

### `src/powerups.js`: procedural pickups
Six types: `health`, `shield`, `ammo`, `speed`, `damage`, `energy`. Each has a pedestal, holo beam, beveled emissive icon, orbiting rings and rising motes.

## What's inside

| Folder | Contents | Source |
|---|---|---|
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
- Kenney: kenney.nl/assets
- Quaternius: quaternius.com
- Poly Haven: polyhaven.com
- ambientCG: ambientcg.com

`tools/build.py`, `tools/build_2.py` and `tools/manifest.py` show how packs are organized. Embedded `.gltf` files are converted to `.glb`, then the manifest is regenerated. After adding files, run:

```bash
python3 tools/manifest.py .
```
