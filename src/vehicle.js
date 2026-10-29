// Vehicle rig: turns any car model from the library into a customisable vehicle.
// - normalises it to face +Z, sit on y=0, with a given length
// - finds the wheels and re-pivots them so they spin and steer
// - measures the body (by raycasting) to place slots: roof, hood, trunk, front, rear, sides, under, seat
// - equip()/unequip() parts in slots, paint(), a seated driver, engine sound
// - transform('combat' | 'boost' | 'hover') sequences with VFX + sound
//
//   const car = await loadVehicle(lib, 'vehicles/cars/Sports', { length: 4.2 });
//   scene.add(car.object);
//   car.equip('roof', PARTS.rocketPod(car.dims));
//   await car.addDriver(lib, 'base-characters/people/Casual_Male');
//   car.engine(sfx);                               // looping engine, pitch follows speed
//   // each frame: car.update(dt, { speed, steer });  vfx.update(dt, camera)
//   car.fire(vfx, sfx, targetPos);                 // any equipped weapon with muzzles
//   await car.transform('hover', { vfx, sfx });
import * as THREE from 'three';
import { boundsOf, fitToSize, recolor } from './library.js';
import { addSocket, attach, detach } from './sockets.js';
import { PARTS } from './parts.js';
import { ENGINE_LOOPS } from './sfx.js';

const WHEEL = /wheel|tire|tyre|rim/i;
const NOT_WHEEL = /steer|spare|wheelchair|ferris/i;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const back = (k) => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

// Per-group corrections for packs whose models don't face +Z.
// yaw: extra rotation (radians) applied after auto-orientation.
export const VEHICLE_HINTS = {};

export async function loadVehicle(lib, id, { length = 4.2, yaw = null } = {}) {
  const m = await lib.model(id);
  const group = lib.get(id)?.group;
  const v = new Vehicle(m.object, { length, yaw: yaw ?? VEHICLE_HINTS[id]?.yaw ?? VEHICLE_HINTS[group]?.yaw ?? 0 });
  v.id = id; v.animations = m.animations; v.mixer = m.mixer;
  return v;
}

export class Vehicle {
  constructor(model, { length = 4.2, yaw = 0 } = {}) {
    this.object = new THREE.Group();
    this.object.name = 'Vehicle';
    this.body = new THREE.Group();          // everything that bobs/lifts (model + parts); wheels stay in the model
    this.object.add(this.body);
    this.model = model;
    model.position.set(0, 0, 0);
    this.body.add(model);
    this.parts = {};
    this.tweens = [];
    this.t = 0;
    this.speed = 0; this.steer = 0; this.spin = 0;
    this.mode = 'drive';
    this.lift = 0;              // hover height
    this.wheelFold = 0;         // 0 = road, 1 = folded flat (hover)
    this._orient(yaw);
    fitToSize(this.model, length);
    this.model.position.y = 0;
    const b = boundsOf(this.model); // re-centre after scaling
    this.model.position.x -= (b.min.x + b.max.x) / 2;
    this.model.position.z -= (b.min.z + b.max.z) / 2;
    this.model.position.y -= b.min.y;
    this._findWheels();
    this._measure();
    this._slots();
  }

  // Long axis → Z; wheel names ("front"/"rear") decide which end is the front
  _orient(yaw) {
    const b = boundsOf(this.model).getSize(new THREE.Vector3());
    if (b.x > b.z * 1.1) this.model.rotation.y += -Math.PI / 2;
    const fronts = [], backs = [];
    this.model.updateMatrixWorld(true);
    this.model.traverse((o) => {
      if (!WHEEL.test(o.name) || NOT_WHEEL.test(o.name)) return;
      const z = boundsOf(o).getCenter(new THREE.Vector3()).z;
      if (/front|_f\b|fl|fr/i.test(o.name)) fronts.push(z); else if (/back|rear|_r\b|rl|rr/i.test(o.name)) backs.push(z);
    });
    const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    if (fronts.length && backs.length && avg(fronts) < avg(backs)) this.model.rotation.y += Math.PI;
    this.model.rotation.y += yaw;
  }

  // Single-mesh cars with wheel materials (e.g. "Tires", "Wheel"): split those triangles
  // into one mesh per corner so they can be rigged like separate wheels.
  _splitWheels() {
    let found = false;
    this.model.traverse((o) => { if (WHEEL.test(o.name) && !NOT_WHEEL.test(o.name)) found = true; });
    if (found) return;
    const meshes = [];
    this.model.traverse((o) => { if (o.isMesh && Array.isArray(o.material) && o.geometry.groups.length) meshes.push(o); });
    const inv = new THREE.Matrix4().copy(this.object.matrixWorld).invert();
    for (const mesh of meshes) {
      const wheelMats = mesh.material.map((m, i) => (WHEEL.test(m.name) && !NOT_WHEEL.test(m.name) ? i : -1)).filter((i) => i >= 0);
      if (!wheelMats.length) continue;
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const pos = g.attributes.position;
      const toRoot = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      const keep = [], corners = {};
      const v = new THREE.Vector3();
      for (const grp of g.groups) {
        const isWheel = wheelMats.includes(grp.materialIndex);
        for (let t = grp.start; t < grp.start + grp.count; t += 3) {
          if (!isWheel) { keep.push([t, grp.materialIndex]); continue; }
          v.set(0, 0, 0);
          for (let k = 0; k < 3; k++) v.add(new THREE.Vector3().fromBufferAttribute(pos, t + k).applyMatrix4(toRoot));
          const key = (v.x > 0 ? 'l' : 'r') + (v.z > 0 ? 'f' : 'b');
          (corners[key] ??= []).push([t, grp.materialIndex]);
        }
      }
      const build = (tris) => {
        const out = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(g.attributes)) {
          const arr = new attr.array.constructor(tris.length * 3 * attr.itemSize);
          tris.forEach(([t], i) => { for (let k = 0; k < 3 * attr.itemSize; k++) arr[i * 3 * attr.itemSize + k] = attr.array[t * attr.itemSize + k]; });
          out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize, attr.normalized));
        }
        let start = 0;
        tris.forEach(([, mi], i) => { if (i === tris.length - 1 || tris[i + 1][1] !== mi) { out.addGroup(start * 3, (i - start + 1) * 3, mi); start = i + 1; } });
        return out;
      };
      mesh.geometry = build(keep);
      const names = { lf: 'front_left', rf: 'front_right', lb: 'rear_left', rb: 'rear_right' };
      for (const [key, tris] of Object.entries(corners)) {
        const w = new THREE.Mesh(build(tris), mesh.material);
        w.name = `wheel_${names[key]}`; w.castShadow = true;
        mesh.add(w);
      }
    }
  }

  _findWheels() {
    this._splitWheels();
    this.wheels = [];
    const nodes = [];
    this.model.traverse((o) => {
      if (o === this.model || !WHEEL.test(o.name) || NOT_WHEEL.test(o.name)) return;
      for (let p = o.parent; p && p !== this.model; p = p.parent) if (nodes.includes(p)) return; // outermost only
      nodes.push(o);
    });
    const root = this.object;
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const size = boundsOf(this.model).getSize(new THREE.Vector3());
    for (const node of nodes) {
      const box = boundsOf(node);
      if (box.isEmpty()) continue;
      const centerW = box.getCenter(new THREE.Vector3());
      const dims = box.getSize(new THREE.Vector3());
      const parent = node.parent;
      // pivot at the wheel centre, in the parent's space, so rotation spins in place
      const pivot = new THREE.Group(); pivot.name = `pivot:${node.name}`;
      parent.add(pivot);
      pivot.position.copy(parent.worldToLocal(centerW.clone()));
      pivot.updateMatrixWorld(true);
      pivot.attach(node);
      // vehicle-space axes expressed in the pivot's parent space
      const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(root.getWorldQuaternion(new THREE.Quaternion()));
      const center = centerW.clone().applyMatrix4(rootInv);
      const axle = dims.x > size.x * 0.5; // one mesh for both wheels
      this.wheels.push({
        node, pivot, base: pivot.quaternion.clone(),
        axisX: new THREE.Vector3(1, 0, 0).applyQuaternion(pq).normalize(),
        axisY: new THREE.Vector3(0, 1, 0).applyQuaternion(pq).normalize(),
        axisZ: new THREE.Vector3(0, 0, 1).applyQuaternion(pq).normalize(),
        front: center.z > 0, side: axle ? 0 : Math.sign(center.x),
        radius: Math.max(dims.y / 2, 0.05), center,
      });
    }
  }

  // Raycast the body from above to find roof, hood and trunk heights
  _measure() {
    const box = boundsOf(this.model);
    const size = box.getSize(new THREE.Vector3());
    const ray = new THREE.Raycaster();
    const meshes = [];
    const wheelNodes = new Set(this.wheels.map((w) => w.node));
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o; p; p = p.parent) if (wheelNodes.has(p)) return;
      meshes.push(o);
    });
    const heightAt = (x, z) => {
      ray.set(new THREE.Vector3(x, box.max.y + 1, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(meshes, false)[0];
      return hit ? hit.point.y : 0;
    };
    const samples = [];
    for (let i = 0; i <= 24; i++) {
      const z = box.min.z + (i / 24) * size.z;
      samples.push({ z, y: Math.max(heightAt(0, z), heightAt(size.x * 0.2, z), heightAt(-size.x * 0.2, z)) });
    }
    const top = Math.max(...samples.map((s) => s.y));
    const roof = samples.filter((s) => s.y > top - size.y * 0.04);
    const roofZ = roof.reduce((a, s) => a + s.z, 0) / roof.length;
    const roofLen = roof.length ? roof[roof.length - 1].z - roof[0].z : size.z * 0.3;
    const frontZ = box.max.z - size.z * 0.17, rearZ = box.min.z + size.z * 0.1;
    const wheelR = this.wheels.length ? Math.max(...this.wheels.map((w) => w.radius)) : size.y * 0.18;
    this.dims = { w: size.x, h: size.y, l: size.z, roofY: top, roofZ, roofLen, wheelR,
      hoodY: heightAt(0, frontZ), hoodZ: frontZ, trunkY: heightAt(0, rearZ), trunkZ: rearZ,
      clearance: Math.min(wheelR * 0.8, size.y * 0.15), minZ: box.min.z, maxZ: box.max.z };
  }

  _slots() {
    const d = this.dims, o = this.body;
    addSocket(o, 'roof', { position: [0, d.roofY - d.h * 0.005, d.roofZ] });
    addSocket(o, 'hood', { position: [0, d.hoodY - d.h * 0.01, d.hoodZ] });
    addSocket(o, 'trunk', { position: [0, d.trunkY - d.h * 0.01, d.trunkZ] });
    addSocket(o, 'front', { position: [0, d.wheelR * 0.6, d.maxZ - d.l * 0.02] });
    addSocket(o, 'rear', { position: [0, d.wheelR, d.minZ + d.l * 0.02], rotation: [0, Math.PI, 0] });
    addSocket(o, 'sides', { position: [0, d.wheelR * 1.4, 0] });
    addSocket(o, 'under', { position: [0, d.clearance, 0] });
    // driver: left seat (+X is the vehicle's left when facing +Z), just behind the roof centre
    addSocket(o, 'seat', { position: [d.w * 0.2, d.clearance + d.h * 0.12, d.roofZ - d.roofLen * 0.05] });
  }

  get slots() { return Object.keys(this.body.userData.sockets); }

  // Mount a part in a slot (replacing what was there). Procedural parts from PARTS are
  // pre-sized; library models are fitted with `size` (defaults to a fraction of the car width).
  // weapon: mark a library model as a weapon (gets a muzzle at its front; ammo 'bullet' or 'missile').
  equip(slot, part, { size = null, offset, rotation, anchor, weapon = false, ammo = 'bullet' } = {}) {
    this.unequip(slot);
    const procedural = !!part.userData.slot;
    attach(this.body, slot, part, { size: procedural ? null : size ?? this.dims.w * 0.45, offset, rotation, anchor });
    if (weapon && !part.userData.muzzles) {
      this.object.updateMatrixWorld(true);
      const b = boundsOf(part);
      const tip = new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y + (b.max.y - b.min.y) * 0.7, b.max.z);
      const m = new THREE.Object3D(); m.name = 'muzzle';
      part.add(m); m.position.copy(part.worldToLocal(tip));
      m.quaternion.copy(part.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.body.getWorldQuaternion(new THREE.Quaternion())));
      Object.assign(part.userData, { weapon: true, muzzles: [m], ammo });
    }
    if (slot === 'under') { const pool = part.getObjectByName('glowPool'); if (pool) pool.position.y = -this.dims.clearance + 0.01; }
    part.traverse((c) => { if (c.isMesh) { c.castShadow = true; } });
    this.parts[slot] = part;
    return part;
  }

  unequip(slot) {
    const p = this.parts[slot];
    if (!p) return null;
    detach(p);
    delete this.parts[slot];
    return p;
  }

  // Recolour the body: the largest coloured, untextured, non-wheel material.
  // Pass `material` (a material name) to override the guess.
  paint(color, material = null) {
    if (material) this._paintName = material;
    if (!this._paintName) {
      const area = new Map();
      const wheelNodes = new Set(this.wheels.map((w) => w.node));
      this.model.traverse((o) => {
        if (!o.isMesh) return;
        for (let p = o; p; p = p.parent) if (wheelNodes.has(p)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const geo = o.geometry, idx = geo.index, pos = geo.attributes.position;
        const groups = geo.groups.length ? geo.groups : [{ start: 0, count: (idx ?? pos).count, materialIndex: 0 }];
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        const vi = (i) => (idx ? idx.getX(i) : i);
        for (const g of groups) {
          const m = mats[g.materialIndex ?? 0];
          if (!m || m.map || m.vertexColors || m.transparent || /glass|window|tire|tyre|wheel|rubber|light|chrome|black|seat|interior/i.test(m.name)) continue;
          const hsl = m.color.getHSL({});
          if (hsl.l < 0.08) continue;
          let sum = 0;   // surface area in world units
          for (let t = g.start; t + 2 < g.start + g.count; t += 3) {
            a.fromBufferAttribute(pos, vi(t)).applyMatrix4(o.matrixWorld);
            b.fromBufferAttribute(pos, vi(t + 1)).applyMatrix4(o.matrixWorld);
            c.fromBufferAttribute(pos, vi(t + 2)).applyMatrix4(o.matrixWorld);
            sum += b.sub(a).cross(c.sub(a)).length() / 2;
          }
          // body paint is usually the largest *coloured* surface: favour saturation over greys
          area.set(m.name, (area.get(m.name) ?? 0) + sum * (0.4 + hsl.s));
        }
      });
      this._paintName = [...area.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    if (this._paintName != null) recolor(this.model, { [this._paintName]: color });
    return this._paintName;
  }

  // Seat a base character in the driver's seat (frozen at the end of a sit animation)
  async addDriver(lib, id, { colors = null } = {}) {
    this.removeDriver();
    const m = await lib.model(id);
    if (colors) recolor(m.object, colors);
    const sit = m.animations.find((a) => /sit/i.test(a.name) && !/stand/i.test(a.name)) ?? m.animations.find((a) => /idle/i.test(a.name));
    if (sit) {
      const act = m.mixer.clipAction(sit);
      act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.play();
      m.mixer.setTime(sit.duration - 0.01);
    }
    const seatH = this.dims.h * 0.62;  // seated character height
    fitToSize(m.object, seatH);
    const holder = new THREE.Group(); holder.add(m.object);
    m.object.position.x = 0; m.object.position.z = 0; m.object.position.y = 0;
    const b = boundsOf(m.object);
    m.object.position.y -= b.min.y;
    m.object.position.z -= (b.min.z + b.max.z) / 2 - (sit ? -this.dims.h * 0.06 : 0);
    this.body.userData.sockets.seat.add(holder);
    this.driver = { ...m, holder };
    return this.driver;
  }

  removeDriver() { if (this.driver) { this.driver.holder.parent?.remove(this.driver.holder); this.driver = null; } }

  // Looping engine sound attached to the car; pitch follows speed
  engine(sfx, loop = 'car', { volume = 0.5 } = {}) {
    this.stopEngine();
    const audio = new THREE.PositionalAudio(sfx.listener);
    audio.setRefDistance(4); audio.setLoop(true); audio.setVolume(volume);
    this.object.add(audio);
    this.engineAudio = audio;
    sfx.load(ENGINE_LOOPS[loop] ?? loop).then((buf) => {
      if (this.engineAudio !== audio) return;
      audio.setBuffer(buf);
      const start = () => { if (this.engineAudio === audio && !audio.isPlaying) audio.play(); };
      if (sfx.listener.context.state === 'running') start();
      else addEventListener('pointerdown', () => sfx.listener.context.resume().then(start), { once: true });
    });
    return audio;
  }

  stopEngine() { if (this.engineAudio) { if (this.engineAudio.isPlaying) this.engineAudio.stop(); this.object.remove(this.engineAudio); this.engineAudio = null; } }

  // speed in m/s (negative = reverse), steer in radians (+ = left)
  update(dt, { speed = this.speed, steer = this.steer } = {}) {
    this.t += dt; this.speed = speed; this.steer = steer;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]; tw.t = Math.min(1, tw.t + dt / tw.dur);
      tw.fn(tw.ease(tw.t));
      if (tw.t >= 1) { this.tweens.splice(i, 1); tw.done?.(); }
    }
    const qs = new THREE.Quaternion(), qt = new THREE.Quaternion(), qf = new THREE.Quaternion();
    for (const w of this.wheels) {
      w.angle = (w.angle ?? 0) + (speed * dt / w.radius) * (1 - this.wheelFold);
      qs.setFromAxisAngle(w.axisX, w.angle);
      qt.setFromAxisAngle(w.axisY, w.front && w.side !== 0 ? steer * (1 - this.wheelFold) : 0);
      qf.setFromAxisAngle(w.axisZ, w.side * this.wheelFold * Math.PI / 2);
      w.pivot.quaternion.copy(w.base).premultiply(qf.multiply(qt)).multiply(qs);
    }
    // body: hover lift + bob, a little roll into turns
    const bob = this.lift > 0 ? Math.sin(this.t * 2.2) * 0.04 * this.lift : 0;
    this.body.position.y = this.lift * this.dims.h * 0.45 + bob;
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -steer * Math.min(Math.abs(speed) / 20, 1) * 0.06, 1 - Math.exp(-dt * 6));
    for (const p of Object.values(this.parts)) p.userData.update?.(dt, this.t);
    if (this.engineAudio?.isPlaying) this.engineAudio.setPlaybackRate(0.75 + Math.min(Math.abs(speed) / 25, 1) * 1.1);
    this._thrust?.(dt);
  }

  tween(dur, fn, { easing = ease, done } = {}) {
    return new Promise((resolve) => this.tweens.push({ t: 0, dur, fn, ease: easing, done: () => { done?.(); resolve(); } }));
  }

  // Fire every equipped weapon that has muzzles
  fire(vfx, sfx, target) {
    const shots = [];
    for (const p of Object.values(this.parts)) {
      for (const [i, m] of (p.userData.muzzles ?? []).entries()) {
        const from = m.getWorldPosition(new THREE.Vector3());
        const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(m.getWorldQuaternion(new THREE.Quaternion()));
        const to = target ? target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5)) : from.clone().addScaledVector(dir, 20).setY(0);
        if (p.userData.ammo === 'bullet') {
          // short burst of tracers
          for (let k = 0; k < 5; k++) shots.push(new Promise((res) => setTimeout(() => {
            const hit = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8));
            vfx.muzzleFlash(from, dir, { scale: 0.5 });
            vfx.laser(from, hit, { color: 0xffc46b, width: 0.025, duration: 0.06 });
            sfx?.play('blaster', { position: from, volume: 0.4 });
            res();
          }, k * 90)));
          continue;
        }
        shots.push(new Promise((res) => setTimeout(() => {
          vfx.muzzleFlash(from, dir, { scale: 0.6 });
          sfx?.play('rocket', { position: from, volume: 0.35, rate: 1.6 });
          vfx.missile(from, to, { onImpact: (p) => sfx?.play('explosion', { position: p }) }).then(res);
        }, i * 110)));
      }
    }
    return Promise.all(shots);
  }

  // Transformations that work on any car:
  //  'combat' – weapons rise out of the roof/hood (equips a rocket pod if none)
  //  'boost'  – side boosters slide out and fire for `duration` seconds
  //  'hover'  – wheels fold flat, body lifts on thrusters (call again to land)
  async transform(mode, { vfx = null, sfx = null, duration = 2.5 } = {}) {
    const pos = () => this.object.getWorldPosition(new THREE.Vector3());
    if (mode === 'combat') {
      let weapons = Object.values(this.parts).filter((p) => p.userData.weapon);
      if (!weapons.length) weapons = [this.equip('roof', PARTS.rocketPod(this.dims))];
      sfx?.play('doorOpen', { position: pos() });
      for (const w of weapons) {
        const h = w.userData.attachedTo.holder;
        const y0 = h.position.y;
        h.scale.setScalar(0.01);
        this.tween(0.9, (k) => { h.scale.setScalar(Math.max(0.01, k)); h.position.y = y0 - (1 - k) * this.dims.h * 0.25; }, { easing: back });
        if (vfx) for (let i = 0; i < 4; i++) setTimeout(() => vfx.impact(h.getWorldPosition(new THREE.Vector3()), undefined, { color: 0xffc46b, scale: 0.5 }), i * 150);
      }
      await new Promise((r) => setTimeout(r, 700));
      sfx?.play('powerUp', { position: pos() });
      return;
    }
    if (mode === 'boost') {
      const had = this.parts.sides;
      const b = had ?? this.equip('sides', PARTS.boosters(this.dims));
      const pods = b.children.filter((c) => /booster/.test(c.name));
      const x0 = pods.map((p) => p.position.x);
      if (!had) await this.tween(0.6, (k) => pods.forEach((p, i) => { p.position.x = x0[i] * (0.6 + 0.4 * k); }), { easing: back });
      sfx?.play('rocket', { position: pos(), volume: 0.6 });
      sfx?.play('accelerate', { position: pos(), volume: 0.5 });
      let left = duration;
      this._thrust = (dt) => {
        left -= dt;
        pods.forEach((p) => { p.userData.core.material.emissiveIntensity = left > 0 ? 6 + Math.random() * 3 : 0.3; });
        if (left <= 0 || !vfx) { if (left <= 0) this._thrust = null; return; }
        for (const n of b.userData.nozzles) {
          const p = n.getWorldPosition(new THREE.Vector3());
          const d = new THREE.Vector3(0, 0, 1).applyQuaternion(n.getWorldQuaternion(new THREE.Quaternion()));
          vfx.thrust(p, d, { scale: this.dims.w * 0.08 });
        }
      };
      await new Promise((r) => setTimeout(r, duration * 1000));
      return;
    }
    if (mode === 'hover') {
      const up = this.mode !== 'hover';
      this.mode = up ? 'hover' : 'drive';
      sfx?.play(up ? 'phaseJump' : 'thruster', { position: pos() });
      if (up && vfx) vfx.ring(pos(), { color: 0x66ddff, radius: this.dims.l * 0.7 });
      const f0 = this.wheelFold, l0 = this.lift;
      if (up) this._hoverGlow(vfx); else this._hoverOff?.();
      await this.tween(1.1, (k) => { this.wheelFold = f0 + ((up ? 1 : 0) - f0) * k; this.lift = l0 + ((up ? 1 : 0) - l0) * k; });
      if (!up) sfx?.play('crash', { position: pos(), volume: 0.3 });
    }
  }

  // Thruster glow under each wheel while hovering
  _hoverGlow(vfx) {
    const discs = this.wheels.map((w) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(w.radius * 0.9, 24), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x55ddff, emissiveIntensity: 5 }));
      m.rotation.x = Math.PI / 2;
      w.node.add(m);
      return m;
    });
    const prev = this._thrust;
    this._thrust = (dt) => {
      prev?.(dt);
      if (!vfx || this.mode !== 'hover') return;
      for (const w of this.wheels) {
        const p = w.pivot.getWorldPosition(new THREE.Vector3());
        vfx.thrust(p, new THREE.Vector3(0, -1, 0), { color: 0x55ddff, scale: w.radius * 0.5, smoke: false });
      }
    };
    this._hoverOff = () => { discs.forEach((d) => { d.parent?.remove(d); d.geometry.dispose(); d.material.dispose(); }); this._thrust = prev; };
  }

  dispose() { this.stopEngine(); this.object.parent?.remove(this.object); }
}
