// Procedural add-on parts that size themselves to whatever they're mounted on.
// Every builder takes the host's dimensions ({ w, h, l } in metres) so one roof rack
// fits a hatchback and a bus. Parts are plain Object3Ds; userData carries behaviour:
//   userData.slot      default vehicle slot ('roof', 'hood', 'rear', 'front', 'sides', 'under')
//   userData.update    (dt, t) => void        per-frame animation (blinking lights…)
//   userData.muzzles   [Object3D]             fire points for weapons (+Z = firing direction)
//   userData.nozzles   [Object3D]             thrust points (+Z = exhaust direction)
//   userData.weapon    true for weapons (deployed by the 'combat' transform)
//
//   const rack = PARTS.roofRack(car.dims);  car.equip('roof', rack);
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const M = {
  metal: () => new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.85, roughness: 0.35 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.12 }),
  plastic: (c = 0x15171b) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.1, roughness: 0.45 }),
  paint: (c) => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
  glow: (c, i = 4) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: i, roughness: 0.4 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 }),
};

const box = (w, h, d, mat, r = Math.min(w, h, d) * 0.25) => shadow(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat));
const cyl = (r1, r2, h, mat, seg = 20) => shadow(new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat));
const tube = (len, r, mat) => shadow(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat));
function shadow(m) { m.castShadow = true; m.receiveShadow = true; return m; }
function group(name, slot, ...children) { const g = new THREE.Group(); g.name = name; g.userData.slot = slot; children.forEach((c) => g.add(c)); return g; }
function point(name, pos, lookDir = [0, 0, 1]) {
  const o = new THREE.Object3D(); o.name = name; o.position.fromArray(pos);
  o.lookAt(o.position.clone().add(new THREE.Vector3(...lookDir))); return o;
}

export const PARTS = {
  // Two rails + crossbars on feet
  roofRack({ w, l }) {
    const mat = M.metal();
    const rw = w * 0.78, rl = Math.min(l * 0.42, w * 1.4), r = Math.max(0.012, w * 0.012), fh = w * 0.05;
    const g = group('Roof rack', 'roof');
    for (const s of [-1, 1]) {
      const rail = tube(rl, r * 1.3, mat); rail.rotation.x = Math.PI / 2; rail.position.set(s * rw / 2, fh, 0); g.add(rail);
      for (const e of [-1, 1]) { const foot = box(r * 4, fh, r * 6, M.plastic()); foot.position.set(s * rw / 2, fh / 2, e * rl * 0.42); g.add(foot); }
    }
    for (let i = 0; i < 3; i++) { const bar = tube(rw * 1.04, r, mat); bar.rotation.z = Math.PI / 2; bar.position.set(0, fh + r * 1.5, (i - 1) * rl * 0.38); g.add(bar); }
    g.userData.top = fh + r * 3; // where cargo sits
    return g;
  },

  // Aerodynamic cargo box on a rack
  cargoBox(dims, { color = 0x101215 } = {}) {
    const g = PARTS.roofRack(dims); g.name = 'Cargo box';
    const { w, l } = dims;
    const bw = w * 0.62, bl = Math.min(l * 0.4, w * 1.3), bh = w * 0.17;
    const shell = box(bw, bh, bl, M.paint(color), bh * 0.45);
    shell.scale.set(1, 1, 1); shell.position.y = g.userData.top + bh / 2;
    const lip = box(bw * 1.01, bh * 0.08, bl * 1.01, M.plastic(0x30333a), bh * 0.04); lip.position.y = g.userData.top + bh * 0.42;
    g.add(shell, lip);
    return g;
  },

  // Rack loaded with bags and a spare tyre
  luggage(dims) {
    const g = PARTS.roofRack(dims); g.name = 'Luggage';
    const { w } = dims, y = g.userData.top;
    const colors = [0x8a4b2a, 0x2f4f6f, 0x5b6b3a, 0x7a2e2e];
    const bags = [[-0.18, 0.28, 0.2, 0.32], [0.17, 0.24, 0.17, 0.3], [0.02, 0.2, 0.15, 0.22]];
    bags.forEach(([x, bw, bh, bl], i) => { const b = box(w * bw, w * bh, w * bl, M.plastic(colors[i]), w * 0.04); b.position.set(x * w, y + w * bh / 2, (i - 1) * w * 0.22); b.rotation.y = (i - 1) * 0.12; g.add(b); });
    const tyre = shadow(new THREE.Mesh(new THREE.TorusGeometry(w * 0.13, w * 0.05, 10, 24), M.rubber()));
    tyre.rotation.x = Math.PI / 2; tyre.position.set(0, y + w * 0.05, -w * 0.35); g.add(tyre);
    return g;
  },

  // Police/emergency light bar; blinks red/blue
  lightBar({ w }, { colors = [0xff2030, 0x2a6bff] } = {}) {
    const bw = w * 0.7, g = group('Light bar', 'roof');
    const base = box(bw, w * 0.05, w * 0.14, M.plastic(0x1b1d22)); base.position.y = w * 0.035; g.add(base);
    const lights = [];
    for (let i = 0; i < 6; i++) {
      const c = colors[i < 3 ? 0 : 1];
      const lens = box(bw / 6.6, w * 0.06, w * 0.12, M.glow(c, 0.2), w * 0.02);
      lens.position.set((i - 2.5) * bw / 6, w * 0.08, 0); g.add(lens); lights.push(lens);
    }
    g.userData.update = (dt, t) => {
      const phase = Math.floor(t * 8) % 4;
      lights.forEach((m, i) => { const on = (i < 3) === (phase < 2) && (phase % 2 === 0 || i % 2 === 0); m.material.emissiveIntensity = on ? 8 : 0.15; });
    };
    return g;
  },

  // Rear wing on two struts
  spoiler({ w }, { color = 0x111214 } = {}) {
    const g = group('Spoiler', 'trunk');
    const sh = w * 0.16;
    for (const s of [-1, 1]) { const strut = box(w * 0.025, sh, w * 0.08, M.plastic()); strut.position.set(s * w * 0.3, sh / 2, 0); strut.rotation.x = -0.25; g.add(strut); }
    const wing = box(w * 0.92, w * 0.025, w * 0.2, M.paint(color), w * 0.012); wing.position.set(0, sh, -w * 0.03); wing.rotation.x = 0.12; g.add(wing);
    for (const s of [-1, 1]) { const plate = box(w * 0.015, w * 0.1, w * 0.24, M.paint(color), w * 0.006); plate.position.set(s * w * 0.46, sh, -w * 0.03); g.add(plate); }
    return g;
  },

  // Front tubular guard
  bullBar({ w, h }) {
    const g = group('Bull bar', 'front'), mat = M.chrome(), r = w * 0.025, bh = h * 0.42;
    for (const s of [-1, 1]) { const up = tube(bh, r, mat); up.position.set(s * w * 0.3, bh / 2, w * 0.05); g.add(up); }
    for (const y of [bh * 0.55, bh]) { const cross = tube(w * 0.66, r, mat); cross.rotation.z = Math.PI / 2; cross.position.set(0, y, w * 0.05); g.add(cross); }
    const plate = box(w * 0.5, w * 0.03, w * 0.12, M.metal()); plate.position.set(0, bh * 0.15, w * 0.04); g.add(plate);
    return g;
  },

  // Neon underglow strips (best with bloom)
  underglow({ w, l }, { color = 0x00e5ff } = {}) {
    const g = group('Underglow', 'under'), mat = M.glow(color, 6);
    for (const s of [-1, 1]) { const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.03, w * 0.015, l * 0.7), mat); strip.position.set(s * w * 0.4, 0, 0); g.add(strip); }
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.3, l * 1.05), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, map: glowTexture() }));
    pool.rotation.x = -Math.PI / 2; pool.name = 'glowPool'; g.add(pool); // Vehicle drops it to the ground
    g.userData.update = (dt, t) => { mat.emissiveIntensity = 5 + Math.sin(t * 3) * 1.2; };
    return g;
  },

  // Six-tube rocket pod on a swivel; fire with vehicle.fire()
  rocketPod({ w }, { color = 0x3c4a2e } = {}) {
    const s = w * 0.42, g = group('Rocket pod', 'roof');
    g.userData.weapon = true; g.userData.ammo = 'missile';
    const base = cyl(s * 0.28, s * 0.34, s * 0.1, M.metal(), 24); base.position.y = s * 0.05; g.add(base);
    const yoke = box(s * 0.16, s * 0.3, s * 0.2, M.metal()); yoke.position.y = s * 0.24; g.add(yoke);
    const head = new THREE.Group(); head.position.y = s * 0.42; head.rotation.x = -0.12; g.add(head);
    const pod = box(s * 0.9, s * 0.5, s * 0.75, M.paint(color), s * 0.05); head.add(pod);
    const muzzles = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const x = (c - 1) * s * 0.27, y = (r - 0.5) * s * 0.24;
      const ring = shadow(new THREE.Mesh(new THREE.TorusGeometry(s * 0.09, s * 0.018, 8, 18), M.metal())); ring.position.set(x, y, s * 0.376); head.add(ring);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(s * 0.085, 18), M.plastic(0x050505)); hole.position.set(x, y, s * 0.377); head.add(hole);
      const tip = cyl(0, s * 0.06, s * 0.12, M.paint(0xb83a2a), 12); tip.rotation.x = Math.PI / 2; tip.position.set(x, y, s * 0.33); head.add(tip);
      const m = point('muzzle', [x, y, s * 0.4]); head.add(m); muzzles.push(m);
    }
    g.userData.muzzles = muzzles; g.userData.head = head;
    return g;
  },

  // Twin rocket boosters for the sides; thrust comes out of userData.nozzles
  boosters({ w, l }) {
    const g = group('Boosters', 'sides'), r = w * 0.09, len = l * 0.32;
    const nozzles = [];
    for (const s of [-1, 1]) {
      const pod = new THREE.Group(); pod.position.set(s * (w / 2 + r * 0.9), 0, -l * 0.12); pod.name = s > 0 ? 'boosterL' : 'boosterR';
      const body = cyl(r, r, len, M.paint(0xdedede), 24); body.rotation.x = Math.PI / 2; pod.add(body);
      const cone = cyl(0, r, r * 1.6, M.paint(0xc8321e), 24); cone.rotation.x = Math.PI / 2; cone.position.z = len / 2 + r * 0.8; pod.add(cone);
      const bell = cyl(r * 0.75, r * 1.05, r * 0.9, M.metal(), 24); bell.rotation.x = -Math.PI / 2; bell.position.z = -len / 2 - r * 0.4; pod.add(bell);
      const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.72, 20), M.glow(0x66ccff, 0.3)); core.rotation.y = Math.PI; core.position.z = -len / 2 - r * 0.86; pod.add(core);
      const fin = box(r * 0.12, r * 1.4, r * 2, M.paint(0xc8321e)); fin.position.set(s * r * 0.9, 0, -len * 0.35); pod.add(fin);
      const strut = box(r * 1.2, r * 0.4, len * 0.5, M.metal()); strut.position.x = -s * r * 0.9; pod.add(strut);
      const n = point('nozzle', [0, 0, -len / 2 - r * 0.9], [0, 0, -1]); pod.add(n); nozzles.push(n);
      pod.userData.core = core; g.add(pod);
    }
    g.userData.nozzles = nozzles;
    return g;
  },

  // Hood scoop
  hoodScoop({ w }, { color = 0x111214 } = {}) {
    const g = group('Hood scoop', 'hood');
    const body = box(w * 0.32, w * 0.07, w * 0.36, M.paint(color), w * 0.03); body.position.y = w * 0.03; g.add(body);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.26, w * 0.04), M.plastic(0x050505)); mouth.position.set(0, w * 0.045, w * 0.181); g.add(mouth);
    return g;
  },
};

// Default slot for each part (also in each part's userData.slot)
export const PART_SLOTS = {
  roofRack: 'roof', cargoBox: 'roof', luggage: 'roof', lightBar: 'roof', rocketPod: 'roof',
  spoiler: 'trunk', hoodScoop: 'hood', bullBar: 'front', underglow: 'under', boosters: 'sides',
};

let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (_glow = new THREE.CanvasTexture(c));
}
