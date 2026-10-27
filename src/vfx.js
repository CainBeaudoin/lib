// GPU-instanced VFX: muzzle flashes, explosions, impacts, lasers, shields,
// trails, portals and pickup bursts. One draw call per sprite texture.
//
//   const vfx = new VFX(scene, { spriteBase: 'assets/vfx/sprites/' });
//   await vfx.init();
//   vfx.explosion(pos);            // fire-and-forget
//   const s = vfx.shield(mech);    // persistent handle: s.hit(point), s.dispose()
//   // every frame:
//   vfx.update(dt, camera);
import * as THREE from 'three';

const SPRITES = [
  'muzzle_01', 'muzzle_02', 'muzzle_03', 'muzzle_05', 'fire_01', 'fire_02', 'flame_03', 'flame_05',
  'smoke_01', 'smoke_04', 'smoke_07', 'spark_01', 'spark_04', 'spark_05', 'circle_02', 'circle_05',
  'light_01', 'light_03', 'star_06', 'magic_02', 'magic_05', 'twirl_01', 'twirl_02', 'scorch_02', 'trace_01',
];

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const randDir = (out = new THREE.Vector3()) => out.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();

// ---------------------------------------------------------------------------
// Instanced camera-facing particle pool (one per texture + blend mode)
class ParticlePool {
  constructor(texture, additive, max = 1500) {
    this.max = max;
    this.count = 0;
    this.p = []; // particle state objects, reused
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    this.aOffset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iOffset', this.aOffset);
    g.setAttribute('iSize', this.aSize);
    g.setAttribute('iRot', this.aRot);
    g.setAttribute('iColor', this.aColor);
    g.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: /* glsl */`
        attribute vec3 iOffset; attribute vec2 iSize; attribute float iRot; attribute vec4 iColor;
        varying vec2 vUv; varying vec4 vColor;
        void main() {
          vUv = uv; vColor = iColor;
          vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
          float c = cos(iRot), s = sin(iRot);
          vec2 p = mat2(c, s, -s, c) * (position.xy * iSize);
          mv.xy += p;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, vUv);
          float a = t.a * vColor.a;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor.rgb * t.rgb * a${additive ? ' * 1.8, 0.0' : ', a'}); // additive is boosted into bloom range
        }`,
      transparent: true,
      depthWrite: false,
      // premultiplied output: additive = One/One, smoke = One/OneMinusSrcAlpha
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  // o: { pos, vel, life, size:[start,end], stretch, rot, spin, color:[r,g,b], color2, alpha:[start,peak,end], drag, gravity }
  emit(o) {
    if (this.count >= this.max) return;
    let s = this.p[this.count];
    if (!s) s = this.p[this.count] = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), c0: new THREE.Color(), c1: new THREE.Color() };
    this.count++;
    s.pos.copy(o.pos);
    if (o.vel) s.vel.copy(o.vel); else s.vel.set(0, 0, 0);
    s.age = 0; s.life = o.life ?? 1;
    s.s0 = o.size?.[0] ?? 1; s.s1 = o.size?.[1] ?? s.s0;
    s.stretch = o.stretch ?? 1;
    s.rot = o.rot ?? Math.random() * Math.PI * 2; s.spin = o.spin ?? 0;
    s.c0.set(o.color ?? 0xffffff); s.c1.set(o.color2 ?? o.color ?? 0xffffff);
    s.a = o.alpha ?? [1, 1, 0];
    s.drag = o.drag ?? 0; s.gravity = o.gravity ?? 0;
    s.delay = o.delay ?? 0;
  }

  update(dt) {
    const c = new THREE.Color();
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.p[i];
      if (s.delay > 0) { s.delay -= dt; }
      else {
        s.age += dt;
        if (s.age >= s.life) continue; // dead: skip (compaction below)
        s.vel.y -= s.gravity * dt;
        s.vel.multiplyScalar(Math.max(0, 1 - s.drag * dt));
        s.pos.addScaledVector(s.vel, dt);
        s.rot += s.spin * dt;
      }
      // compact live particles to the front
      if (n !== i) { const t = this.p[n]; this.p[n] = s; this.p[i] = t; }
      const k = s.delay > 0 ? 0 : s.age / s.life;
      const size = s.s0 + (s.s1 - s.s0) * k;
      const alpha = s.delay > 0 ? 0 : (k < 0.15 ? THREE.MathUtils.lerp(s.a[0], s.a[1], k / 0.15) : THREE.MathUtils.lerp(s.a[1], s.a[2], (k - 0.15) / 0.85));
      c.copy(s.c0).lerp(s.c1, k);
      this.aOffset.setXYZ(n, s.pos.x, s.pos.y, s.pos.z);
      this.aSize.setXY(n, size, size * s.stretch);
      this.aRot.setX(n, s.rot);
      this.aColor.setXYZW(n, c.r, c.g, c.b, alpha);
      n++;
    }
    this.count = n;
    this.mesh.geometry.instanceCount = n;
    this.aOffset.needsUpdate = this.aSize.needsUpdate = this.aRot.needsUpdate = this.aColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
export class VFX {
  constructor(scene, { spriteBase = new URL('../assets/vfx/sprites/', import.meta.url).href, lights = 4 } = {}) {
    this.scene = scene;
    this.base = spriteBase.endsWith('/') ? spriteBase : spriteBase + '/';
    this.textures = {};
    this.pools = new Map();
    this.root = new THREE.Group();
    this.root.name = 'VFX';
    scene.add(this.root);
    this.effects = new Set(); // objects with update(dt, camera) -> false when finished
    // Fixed pool of flash lights: changing light count forces shader recompiles,
    // so they are allocated once and only intensity is animated.
    this.lights = Array.from({ length: lights }, () => {
      const l = new THREE.PointLight(0xffaa55, 0, 8, 2);
      l.userData.t = 0; l.userData.dur = 1; l.userData.peak = 0;
      this.root.add(l);
      return l;
    });
    this._light = 0;
  }

  async init() {
    const loader = new THREE.TextureLoader();
    await Promise.all(SPRITES.map(async (n) => {
      const t = await loader.loadAsync(this.base + n + '.png');
      t.colorSpace = THREE.SRGBColorSpace;
      this.textures[n] = t;
    }));
    return this;
  }

  pool(name, additive = true) {
    const key = name + (additive ? '+' : '');
    let p = this.pools.get(key);
    if (!p) {
      p = new ParticlePool(this.textures[name], additive);
      this.pools.set(key, p);
      this.root.add(p.mesh);
    }
    return p;
  }

  flash(pos, color = 0xffaa55, intensity = 30, duration = 0.15, distance = 8) {
    const l = this.lights[this._light++ % this.lights.length];
    l.position.copy(pos); l.color.set(color); l.distance = distance;
    l.userData.t = 0; l.userData.dur = duration; l.userData.peak = intensity;
    l.intensity = intensity;
  }

  update(dt, camera) {
    for (const l of this.lights) {
      if (l.intensity <= 0) continue;
      l.userData.t += dt;
      const k = l.userData.t / l.userData.dur;
      l.intensity = k >= 1 ? 0 : l.userData.peak * (1 - k) * (1 - k);
    }
    for (const e of this.effects) if (e.update(dt, camera) === false) { this.effects.delete(e); e.dispose?.(); }
    for (const p of this.pools.values()) p.update(dt);
  }

  // ------------------------------------------------------------------ effects

  muzzleFlash(pos, dir, { color = 0xffb347, scale = 1 } = {}) {
    const d = tmpV.copy(dir).normalize();
    const flash = this.pool(['muzzle_01', 'muzzle_02', 'muzzle_05'][Math.floor(Math.random() * 3)]);
    flash.emit({ pos: tmpV2.copy(pos).addScaledVector(d, 0.12 * scale), life: 0.06, size: [0.5 * scale, 0.7 * scale], color, color2: 0xff5a1f, alpha: [1, 1, 0] });
    this.pool('light_01').emit({ pos, life: 0.07, size: [0.9 * scale, 0.4 * scale], color: 0xfff1c4, alpha: [1, 1, 0] });
    for (let i = 0; i < 6; i++) {
      this.pool('spark_01').emit({
        pos, vel: tmpV2.copy(d).multiplyScalar(rand(4, 9)).add(randDir().multiplyScalar(1.5)),
        life: rand(0.08, 0.2), size: [0.06 * scale, 0.02], color: 0xffd27a, drag: 4,
      });
    }
    this.pool('smoke_04', false).emit({ pos, vel: tmpV2.copy(d).multiplyScalar(0.6).setY(0.3), life: 0.8, size: [0.15 * scale, 0.6 * scale], color: 0x8a8a8a, alpha: [0, 0.25, 0], spin: rand(-1, 1), drag: 1 });
    this.flash(pos, color, 12 * scale, 0.08, 4 * scale);
  }

  explosion(pos, { scale = 1, color = 0xff7a1a } = {}) {
    const S = scale;
    this.flash(pos, color, 80 * S, 0.45, 14 * S);
    // core flash
    this.pool('light_01').emit({ pos, life: 0.18, size: [2.5 * S, 5 * S], color: 0xfff4d6, alpha: [1, 1, 0] });
    // fireballs
    for (let i = 0; i < 14; i++) {
      this.pool(Math.random() < 0.5 ? 'fire_01' : 'flame_05').emit({
        pos: tmpV2.copy(pos).add(randDir().multiplyScalar(rand(0, 0.4) * S)),
        vel: randDir().multiplyScalar(rand(1, 3.5) * S).add(tmpV.set(0, 1.2 * S, 0)),
        life: rand(0.45, 0.9), size: [rand(1, 1.8) * S, rand(2.4, 3.4) * S],
        color: 0xffe08a, color2: color, alpha: [0.2, 1, 0], spin: rand(-2, 2), drag: 3, delay: rand(0, 0.06),
      });
    }
    // dark smoke column, after the fire
    for (let i = 0; i < 16; i++) {
      this.pool(['smoke_01', 'smoke_04', 'smoke_07'][i % 3], false).emit({
        pos: tmpV2.copy(pos).add(randDir().multiplyScalar(rand(0, 0.6) * S)),
        vel: randDir().multiplyScalar(rand(0.4, 1.6) * S).add(tmpV.set(0, rand(0.8, 1.8) * S, 0)),
        life: rand(1.8, 3.2), size: [rand(0.8, 1.2) * S, rand(2.6, 3.8) * S],
        color: 0x3a3632, color2: 0x8d8780, alpha: [0, 0.65, 0], spin: rand(-0.6, 0.6), drag: 1.4, delay: rand(0.08, 0.3),
      });
    }
    // sparks + debris embers
    for (let i = 0; i < 40; i++) {
      this.pool('spark_04').emit({
        pos, vel: randDir().multiplyScalar(rand(4, 12) * S).add(tmpV.set(0, 3 * S, 0)),
        life: rand(0.4, 1.2), size: [rand(0.08, 0.16) * S, 0.02], color: 0xffe0a0, color2: 0xff4a10, gravity: 9, drag: 1.5,
      });
    }
    // shockwave
    this.ring(pos, { color: 0xffc27a, radius: 4 * S, duration: 0.45 });
    // scorch mark on the ground
    if (pos.y < 0.6 * S) this.decal(tmpV2.set(pos.x, 0.01, pos.z), 'scorch_02', 2.6 * S, 10);
  }

  impact(pos, normal = new THREE.Vector3(0, 1, 0), { color = 0x7fd8ff, scale = 1 } = {}) {
    const n = tmpV.copy(normal).normalize();
    this.pool('star_06').emit({ pos, life: 0.12, size: [0.6 * scale, 1.1 * scale], color: 0xffffff, color2: color, alpha: [1, 1, 0] });
    this.pool('circle_05').emit({ pos, life: 0.25, size: [0.2 * scale, 1.2 * scale], color, alpha: [0.8, 0.6, 0] });
    for (let i = 0; i < 18; i++) {
      this.pool('spark_05').emit({
        pos, vel: tmpV2.copy(n).multiplyScalar(rand(2, 6)).add(randDir().multiplyScalar(3)).multiplyScalar(scale),
        life: rand(0.15, 0.45), size: [rand(0.05, 0.1) * scale, 0.01], color: 0xffffff, color2: color, gravity: 6, drag: 2,
      });
    }
    this.pool('smoke_01', false).emit({ pos, vel: tmpV2.copy(n).multiplyScalar(0.5), life: 0.9, size: [0.2 * scale, 0.9 * scale], color: 0x777777, alpha: [0, 0.3, 0] });
    this.flash(pos, color, 10 * scale, 0.12, 3 * scale);
  }

  laser(from, to, { color = 0xff2a4a, width = 0.06, duration = 0.18, impact = true } = {}) {
    const len = from.distanceTo(to);
    const group = new THREE.Group();
    group.position.copy(from).lerp(to, 0.5);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpV.subVectors(to, from).normalize());
    const mat = beamMaterial(color);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.35, width * 0.35, len, 8, 1, true), mat.core);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(width * 1.6, width * 1.6, len, 16, 1, true), mat.glow);
    group.add(core, glow);
    this.root.add(group);
    if (impact) this.impact(to, tmpV.subVectors(from, to), { color, scale: 0.8 });
    this.pool('light_01').emit({ pos: from, life: duration, size: [width * 10, width * 6], color, alpha: [1, 1, 0] });
    let t = 0;
    this.effects.add({
      update: (dt) => {
        t += dt;
        const k = 1 - t / duration;
        mat.core.uniforms.opacity.value = mat.glow.uniforms.opacity.value = Math.max(0, k);
        glow.scale.set(1 + (1 - k) * 0.8, 1, 1 + (1 - k) * 0.8);
        return t < duration;
      },
      dispose: () => { this.root.remove(group); core.geometry.dispose(); glow.geometry.dispose(); mat.core.dispose(); mat.glow.dispose(); },
    });
  }

  ring(pos, { color = 0x88ccff, radius = 3, duration = 0.5 } = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.textures.circle_02, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos);
    this.root.add(m);
    let t = 0;
    this.effects.add({
      update: (dt) => {
        t += dt; const k = t / duration;
        const s = 0.2 + radius * 2 * (1 - (1 - k) ** 3);
        m.scale.set(s, s, s); m.material.opacity = (1 - k) ** 1.5;
        return k < 1;
      },
      dispose: () => { this.root.remove(m); m.geometry.dispose(); m.material.dispose(); },
    });
  }

  decal(pos, sprite, size, life = 8) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
      map: this.textures[sprite], color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    m.position.copy(pos);
    this.root.add(m);
    let t = 0;
    this.effects.add({
      update: (dt) => { t += dt; m.material.opacity = Math.min(1, (life - t) / 2) * 0.85; return t < life; },
      dispose: () => { this.root.remove(m); m.geometry.dispose(); m.material.dispose(); },
    });
  }

  pickupBurst(pos, { color = 0x5cf2ff } = {}) {
    this.flash(pos, color, 25, 0.3, 6);
    this.ring(tmpV2.copy(pos), { color, radius: 1.4, duration: 0.4 });
    this.pool('light_01').emit({ pos, life: 0.25, size: [1.5, 3], color: 0xffffff, color2: color, alpha: [1, 1, 0] });
    for (let i = 0; i < 30; i++) {
      this.pool('star_06').emit({
        pos, vel: randDir().multiplyScalar(rand(1.5, 4)).add(tmpV.set(0, 2, 0)),
        life: rand(0.5, 1), size: [rand(0.15, 0.3), 0], color: 0xffffff, color2: color, drag: 2.5, gravity: 2, spin: rand(-4, 4),
      });
    }
  }

  // Swirling portal. Returns { group, dispose() }
  portal(pos, { color = 0x9a5cff, radius = 1.2 } = {}) {
    const group = new THREE.Group();
    group.position.copy(pos);
    const layers = ['twirl_01', 'twirl_02', 'light_01'].map((name, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.2, radius * 2.2), new THREE.MeshBasicMaterial({
        map: this.textures[name], color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 - i * 0.2,
      }));
      m.position.z = i * 0.01;
      group.add(m);
      return m;
    });
    this.root.add(group);
    let t = 0, emitT = 0, alive = true;
    const normal = new THREE.Vector3();
    const handle = {
      group,
      update: (dt) => {
        t += dt; emitT += dt;
        layers.forEach((m, i) => { m.rotation.z = t * (i % 2 ? -1.2 : 1.8) * (1 + i * 0.3); m.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.04); });
        normal.set(0, 0, 1).applyQuaternion(group.quaternion);
        while (emitT > 0.02) {
          emitT -= 0.02;
          const a = Math.random() * Math.PI * 2;
          const start = tmpV.set(Math.cos(a) * radius * 1.3, Math.sin(a) * radius * 1.3, 0).applyQuaternion(group.quaternion).add(group.position);
          const inward = tmpV2.subVectors(group.position, start);
          const vel = inward.clone().multiplyScalar(1.4).add(inward.cross(normal).multiplyScalar(1.2)); // spiral in
          this.pool('spark_01').emit({ pos: start, vel, life: 0.7, size: [0.08, 0.02], color: 0xffffff, color2: color, alpha: [0, 1, 0] });
        }
        return alive;
      },
      dispose: () => { alive = false; this.root.remove(group); layers.forEach((m) => { m.geometry.dispose(); m.material.dispose(); }); },
    };
    this.effects.add(handle);
    return handle;
  }

  // Energy shield bubble around an object or position. Returns { mesh, hit(worldPoint), dispose() }
  shield(target, { radius = null, color = 0x4fc3ff } = {}) {
    let r = radius;
    const localCenter = new THREE.Vector3();
    if (target.isObject3D) {
      // measure once (skinned bounds are expensive), then follow the target
      target.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(target, true);
      target.worldToLocal(box.getCenter(localCenter));
      r ??= box.getSize(new THREE.Vector3()).length() * 0.5;
    }
    r = r || 1.5;
    const mat = shieldMaterial(color);
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 24), mat);
    mesh.renderOrder = 30;
    this.root.add(mesh);
    let alive = true, hitIdx = 0;
    const handle = {
      mesh,
      hit: (point) => {
        const local = mesh.worldToLocal(point.clone()).normalize();
        mat.uniforms.hits.value[hitIdx].set(local.x, local.y, local.z, 0);
        hitIdx = (hitIdx + 1) % 4;
        this.impact(point, tmpV.subVectors(point, mesh.position), { color, scale: 0.6 });
      },
      update: (dt) => {
        if (target.isObject3D) mesh.position.copy(localCenter).applyMatrix4(target.matrixWorld);
        else mesh.position.copy(target);
        mat.uniforms.time.value += dt;
        for (const h of mat.uniforms.hits.value) h.w += dt;
        return alive;
      },
      dispose: () => { alive = false; this.root.remove(mesh); mesh.geometry.dispose(); mat.dispose(); },
    };
    this.effects.add(handle);
    return handle;
  }

  // Ribbon trail that follows an object. Returns { mesh, dispose() }
  trail(object, { color = 0x6ae3ff, width = 0.25, length = 40 } = {}) {
    const pts = Array.from({ length }, () => object.getWorldPosition(new THREE.Vector3()));
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(length * 2 * 3);
    const fade = new Float32Array(length * 2);
    const idx = [];
    for (let i = 0; i < length; i++) { fade[i * 2] = fade[i * 2 + 1] = 1 - i / (length - 1); }
    for (let i = 0; i < length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) } },
      vertexShader: 'attribute float fade; varying float vF; varying float vSide; void main(){ vF=fade; vSide=float(gl_VertexID % 2)*2.0-1.0; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 color; varying float vF; varying float vSide; void main(){ float edge=1.0-abs(vSide); float a=vF*vF*(0.35+0.65*edge); gl_FragColor=vec4(mix(color, vec3(1.0), vF*vF*0.6)*a*1.6, 0.0);}',
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    let alive = true;
    const toCam = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
    const handle = {
      mesh,
      update: (dt, camera) => {
        pts.pop(); pts.unshift(object.getWorldPosition(new THREE.Vector3()));
        for (let i = 0; i < length; i++) {
          const p = pts[i];
          tan.subVectors(pts[Math.max(0, i - 1)], pts[Math.min(length - 1, i + 1)]);
          if (tan.lengthSq() < 1e-8) tan.set(0, 0, 1);
          toCam.subVectors(camera.position, p);
          side.crossVectors(tan, toCam).normalize().multiplyScalar(width * 0.5 * (1 - i / length));
          pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
        }
        geo.attributes.position.needsUpdate = true;
        return alive;
      },
      dispose: () => { alive = false; this.root.remove(mesh); geo.dispose(); mat.dispose(); },
    };
    this.effects.add(handle);
    return handle;
  }
}

// ---------------------------------------------------------------------------
function beamMaterial(color) {
  const make = (inner) => new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 1 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV;
      void main(){ float f=abs(dot(vN,vV)); float a=${inner ? 'f' : 'pow(f,2.5)*0.7'};
      vec3 c=${inner ? 'mix(color, vec3(1.0), 0.85)*3.0' : 'color*2.0'}; gl_FragColor=vec4(c*a*opacity, 0.0); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  return { core: make(true), glow: make(false) };
}

function shieldMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      time: { value: 0 },
      hits: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 1, 0, 99)) },
    },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vLocal;
      void main(){ vLocal=normalize(position); vec4 mv=modelViewMatrix*vec4(position,1.0);
        vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: /* glsl */`
      uniform vec3 color; uniform float time; uniform vec4 hits[4];
      varying vec3 vN; varying vec3 vV; varying vec3 vLocal;
      // hexagon grid distance
      float hex(vec2 p){ p*=vec2(1.0,1.1547); vec2 a=mod(p,vec2(1.0,1.732))-vec2(0.5,0.866);
        vec2 b=mod(p-vec2(0.5,0.866),vec2(1.0,1.732))-vec2(0.5,0.866);
        vec2 g=dot(a,a)<dot(b,b)?a:b; vec2 q=abs(g); return 0.5-max(q.x*0.866+q.y*0.5,q.y); }
      void main(){
        float rim=pow(1.0-abs(dot(vN,vV)),2.5);
        vec2 uv=vec2(atan(vLocal.z,vLocal.x)*3.0, vLocal.y*6.0);
        float h=smoothstep(0.06,0.0,hex(uv*1.6));
        float scan=0.5+0.5*sin(vLocal.y*20.0-time*3.0);
        float ripple=0.0;
        for(int i=0;i<4;i++){ float d=acos(clamp(dot(vLocal,hits[i].xyz),-1.0,1.0)); float t=hits[i].w;
          ripple+=smoothstep(0.12,0.0,abs(d-t*2.5))*max(0.0,1.0-t*1.2)*2.0 + smoothstep(0.5,0.0,d)*max(0.0,1.0-t*3.0); }
        float a=rim*0.9 + h*(0.08+rim*0.5)*(0.6+0.4*scan) + ripple*(0.4+h);
        gl_FragColor=vec4(mix(color, vec3(1.0), clamp(ripple*0.5+rim*0.2,0.0,1.0))*a*1.4, 0.0);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}
