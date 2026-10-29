// Game sound effects on top of the CC0 Kenney sound packs in assets/audio.
// Named presets pick a random variant and jitter pitch so repeats don't sound robotic;
// pass a position for 3D (distance-attenuated) sound.
//
//   const sfx = new SoundBoard(camera, { base: './assets/' });
//   sfx.play('laser', { position: muzzlePos });
//   sfx.play('click');                       // 2D UI sound
//   sfx.play('audio/sci-fi/doorOpen_001');   // any sound id from the manifest (.ogg implied)
//   sfx.play('audio/rocket/rocket_engine.wav'); // other formats: include the extension
import * as THREE from 'three';

// dir, file prefix, count, first index, zero padding (Kenney packs differ)
const fam = (dir, prefix, count, start = 0, pad = 3) =>
  Array.from({ length: count }, (_, i) => `audio/${dir}/${prefix}${String(start + i).padStart(pad, '0')}`);

export const SFX_PRESETS = {
  laser:       fam('sci-fi', 'laserSmall_', 5),
  laserHeavy:  fam('sci-fi', 'laserLarge_', 5),
  laserRetro:  fam('sci-fi', 'laserRetro_', 5),
  blaster:     fam('digital', 'laser', 9, 1, 0),
  zap:         fam('digital', 'zap', 2, 1, 0),
  explosion:   fam('sci-fi', 'explosionCrunch_', 5),
  explosionBig: fam('sci-fi', 'lowFrequency_explosion_', 2),
  impactMetal: fam('impact', 'impactMetal_medium_', 5),
  impactHeavy: fam('impact', 'impactPlate_heavy_', 5),
  punch:       fam('impact', 'impactPunch_medium_', 5),
  shield:      fam('sci-fi', 'forceField_', 5),
  thruster:    fam('sci-fi', 'thrusterFire_', 5),
  doorOpen:    fam('sci-fi', 'doorOpen_', 3),
  doorClose:   fam('sci-fi', 'doorClose_', 3),
  powerUp:     fam('digital', 'powerUp', 12, 1, 0),
  phaseJump:   fam('digital', 'phaseJump', 5, 1, 0),
  footstep:    fam('impact', 'footstep_concrete_', 5),
  footstepMetal: fam('impact', 'impactMetal_light_', 5),
  click:       fam('interface', 'click_', 5, 1),
  select:      fam('interface', 'select_', 8, 1),
  confirm:     fam('interface', 'confirmation_', 4, 1),
  error:       fam('interface', 'error_', 8, 1),
  glitch:      fam('interface', 'glitch_', 4, 1),
  // cars
  engineStart: ['audio/car/Car_Engine_Start_Up', 'audio/car/Car2_Engine_Start_Up', 'audio/car-extra/generic_car_startengine.wav'],
  engineStop:  ['audio/car/Car_Engine_Turning_Off', 'audio/car/Car2_Engine_Turning_Off'],
  accelerate:  ['audio/car/Car_Acceleration', 'audio/car/Car_Acceleration_2', 'audio/car-acceleration/acceleration.wav'],
  skid:        ['audio/racing/skid'],
  crash:       ['audio/racing/impact', ...fam('impact', 'impactPlate_heavy_', 3)],
  horn:        ['audio/car/Car_Horn'],
  carDoorOpen: ['audio/car/Car_Door_Open', 'audio/car-extra/door_opening.wav'],
  carDoorClose: ['audio/car/Car_Door_Close', 'audio/car-extra/door_closing.wav'],
  trunk:       ['audio/car/Car_Trunk_Open', 'audio/car/Car_Hood_Open'],
  handbrake:   ['audio/car/Car_Parking_Brake'],
  blinker:     ['audio/car-extra/blinker01.wav'],
  rocket:      ['audio/rocket/rocket_engine.wav'],
};

// Looping engine ids for EngineSound (see vehicle.js)
export const ENGINE_LOOPS = {
  car: 'audio/car/Car_Engine_Loop', car2: 'audio/car/Car2_Engine_Loop', truck: 'audio/car/Car_Engine_Loop_2',
  kart: 'audio/racing/engine', motorcycle: 'audio/racing/engine-motorcycle',
  race0: 'audio/engine-loops/engine_0.wav', race1: 'audio/engine-loops/engine_1.wav', race2: 'audio/engine-loops/engine_2.wav',
  race3: 'audio/engine-loops/engine_3.wav', race4: 'audio/engine-loops/engine_4.wav', race5: 'audio/engine-loops/engine_5.wav',
};

export class SoundBoard {
  constructor(camera, { base = new URL('../assets/', import.meta.url).href, volume = 0.8, voices = 12 } = {}) {
    this.base = base.endsWith('/') ? base : base + '/';
    this.listener = new THREE.AudioListener();
    this.listener.setMasterVolume(volume);
    camera.add(this.listener);
    this.loader = new THREE.AudioLoader();
    this.buffers = new Map();
    // Fixed voice pools: oldest voice is reused when all are busy
    this.voices2d = Array.from({ length: voices }, () => new THREE.Audio(this.listener));
    this.voices3d = Array.from({ length: voices }, () => {
      const a = new THREE.PositionalAudio(this.listener);
      a.setRefDistance(3); a.setRolloffFactor(1.2); a.setDistanceModel('inverse');
      const holder = new THREE.Object3D(); holder.add(a);
      return a;
    });
    this.next2d = 0; this.next3d = 0;
    this.scene = null;
  }

  // 3D voices need to live in the scene to get a world position
  attach(scene) {
    this.scene = scene;
    for (const v of this.voices3d) scene.add(v.parent);
    return this;
  }

  set volume(v) { this.listener.setMasterVolume(v); }

  load(id) {
    if (!this.buffers.has(id)) this.buffers.set(id, this.loader.loadAsync(this.base + id + (/\.(ogg|wav|mp3)$/.test(id) ? '' : '.ogg')));
    return this.buffers.get(id);
  }

  preload(names = Object.keys(SFX_PRESETS)) {
    return Promise.all(names.flatMap((n) => (SFX_PRESETS[n] ?? [n]).map((id) => this.load(id))));
  }

  async play(name, { position = null, volume = 1, pitch = 0.08, rate = 1 } = {}) {
    const ids = SFX_PRESETS[name] ?? [name];
    const id = ids[Math.floor(Math.random() * ids.length)];
    if (this.listener.context.state === 'suspended') {
      // browsers only allow audio after the first click/tap; skip (don't queue) until then
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
      this.listener.context.resume();
    }
    const buffer = await this.load(id);
    const spatial = position && this.scene;
    const voice = spatial ? this.voices3d[this.next3d++ % this.voices3d.length] : this.voices2d[this.next2d++ % this.voices2d.length];
    if (voice.isPlaying) voice.stop();
    if (spatial) voice.parent.position.copy(position);
    voice.setBuffer(buffer);
    voice.setVolume(volume);
    voice.setPlaybackRate(rate * (1 + (Math.random() * 2 - 1) * pitch));
    voice.play();
    return voice;
  }
}
