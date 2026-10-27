# Game Asset Library

A drop-in Three.js asset library: **618 CC0 assets** (mechs, guns, blasters, turrets, spaceships, sci-fi environments, PBR materials, HDRIs, particle sprites) plus code written for this repo: a VFX system, procedural power-ups, and a "pro look" renderer preset.

All third-party assets are **CC0 / public domain**: free for commercial use with no attribution. Every file's source and license is in [`assets/manifest.json`](assets/manifest.json), with a summary in [`LICENSES.md`](LICENSES.md).

## Browse it

No build step is needed. Serve the folder and open `index.html`:

```bash
python3 -m http.server 8790
```

Open http://localhost:8790. The catalog has four tabs:
- **Models:** search, orbit, play animations, switch HDRIs
- **VFX:** live demo of every effect
- **Power-ups**
- **Materials**

Each item shows a copy-paste code snippet.

## Use it in a game

Uses Three.js `0.160.0` through an import map, the same setup as the catalog page:

```js
import { createStage } from './lib/src/stage.js';
import { AssetLibrary } from './lib/src/library.js';
import { VFX } from './lib/src/vfx.js';
import { createPowerUp } from './lib/src/powerups.js';

const stage = createStage(document.body, { hdri: './lib/assets/hdri/studio_small_09.hdr' });
const lib = await AssetLibrary.load('./lib/assets/');
const vfx = await new VFX(stage.scene, { spriteBase: './lib/assets/vfx/sprites/' }).init();

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
shield.hit(hitPos);
pickup.collect(vfx);
```

### `src/stage.js`: renderer preset
Sets up HDRI image-based lighting, ACES tone mapping, soft shadows, GTAO ambient occlusion, bloom and SMAA. Also includes `stage.frame(object)` and `stage.setHdri(url)`.

### `src/library.js`: asset loader
- `lib.model(id, { size })` returns `{ object, animations, mixer, play(name) }`. Each call gives an independent clone, including skinned meshes.
- `lib.material(id, { repeat })` returns a full PBR `MeshStandardMaterial`.
- `lib.find('rifle')` and `lib.find({ group: 'mechs' })` search the manifest.

### `src/vfx.js`: effects
Effects: `explosion`, `muzzleFlash`, `impact`, `laser`, `ring`, `decal`, `pickupBurst`, `shield` (hex fresnel bubble with hit ripples), `trail` (ribbon), `portal`.

Particles are GPU-instanced, with one draw call per sprite texture. Flash lights come from a fixed pool, so firing effects never triggers shader recompiles.

### `src/powerups.js`: procedural pickups
Six types: `health`, `shield`, `ammo`, `speed`, `damage`, `energy`. Each has a pedestal, holo beam, beveled emissive icon, orbiting rings and rising motes.

## What's inside

| Folder | Contents | Source |
|---|---|---|
| `assets/mechs` | 4 animated mechs (≈20 clips each: walk, run, shoot, punch, death…) | Quaternius |
| `assets/characters/robot` | Animated robot (FBX) | Quaternius |
| `assets/weapons/guns` | 40 firearms: rifles, pistols, shotguns, SMGs, snipers… (FBX) | Quaternius |
| `assets/weapons/blasters` | 40 sci-fi blasters, scopes, clips, grenades, targets | Kenney |
| `assets/turrets` | 37 turrets: cannons, lasers, guns, teleporters (FBX) | Quaternius |
| `assets/space/ships` | 11 textured spaceships | Quaternius |
| `assets/space/kit` | 153 space props: craft, rockets, turrets, astronauts, terrain | Kenney |
| `assets/environment/space-station` | 97 modular station pieces | Kenney |
| `assets/environment/prototype` | 145 level blockout pieces | Kenney |
| `assets/textures` | 6 PBR metal/concrete sets (1K) | ambientCG |
| `assets/hdri` | 4 HDRIs (studio, sky, sunset, night) | Poly Haven |
| `assets/vfx/sprites` | 80 particle sprites | Kenney |

## Adding more

All of these sources are CC0:
- Kenney: kenney.nl/assets
- Quaternius: quaternius.com
- Poly Haven: polyhaven.com
- ambientCG: ambientcg.com

`tools/build.py` and `tools/manifest.py` show how packs are organized. Embedded `.gltf` files are converted to `.glb`, then the manifest is regenerated. After adding files, run:

```bash
python3 tools/manifest.py .
```
