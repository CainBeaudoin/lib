// Asset library loader: reads assets/manifest.json and loads models, materials,
// HDRIs and sprites by id, with caching and per-instance cloning.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

export class AssetLibrary {
  static async load(baseUrl = new URL('../assets/', import.meta.url).href) {
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const manifest = await (await fetch(base + 'manifest.json')).json();
    return new AssetLibrary(base, manifest);
  }

  constructor(base, manifest) {
    this.base = base;
    this.assets = manifest.assets;
    this.byId = new Map(this.assets.map((a) => [a.id, a]));
    this.gltf = new GLTFLoader();
    this.fbx = new FBXLoader();
    this.tex = new THREE.TextureLoader();
    this._cache = new Map();
  }

  url(id) { return this.base + this.get(id).path; }

  get(id) {
    const a = this.byId.get(id);
    if (!a) throw new Error(`Unknown asset: ${id}`);
    return a;
  }

  // find('blaster'), find({ type: 'model', group: 'mechs' })
  find(query = {}) {
    if (typeof query === 'string') {
      const q = query.toLowerCase();
      return this.assets.filter((a) => a.id.toLowerCase().includes(q));
    }
    return this.assets.filter((a) => Object.entries(query).every(([k, v]) => a[k] === v));
  }

  // Returns { object, animations, mixer, play(name) }. Each call is an independent clone.
  async model(id, { size = null, shadows = true } = {}) {
    const a = this.get(id);
    const src = await this._once(id, async () => {
      if (a.format === 'fbx') {
        const obj = await this.fbx.loadAsync(this.base + a.path);
        fixFbxMaterials(obj);
        return { scene: obj, animations: obj.animations };
      }
      const g = await this.gltf.loadAsync(this.base + a.path);
      return { scene: g.scene, animations: g.animations };
    });
    const object = skeletonClone(src.scene);
    if (shadows) object.traverse((c) => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });
    if (size) fitToSize(object, size);
    const mixer = src.animations.length ? new THREE.AnimationMixer(object) : null;
    let current = null;
    return {
      object, animations: src.animations, mixer,
      play(name, fade = 0.25) {
        const clip = THREE.AnimationClip.findByName(src.animations, name);
        if (!clip || !mixer) return null;
        const next = mixer.clipAction(clip);
        next.reset().fadeIn(fade).play();
        if (current && current !== next) current.fadeOut(fade);
        current = next;
        return next;
      },
    };
  }

  // PBR material from an ambientCG set: material('material/MetalPlates006', { repeat: 2 })
  async material(id, { repeat = 1, ...params } = {}) {
    const a = this.get(id);
    const load = (name, srgb = false) => {
      if (!a.maps.includes(name)) return null;
      const t = this.tex.load(this.base + a.path + name + '.jpg');
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = 8;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const metalness = load('metalness');
    return new THREE.MeshStandardMaterial({
      map: load('color', true),
      normalMap: load('normal'),
      roughnessMap: load('roughness'),
      metalnessMap: metalness,
      metalness: metalness ? 1 : 0,
      aoMap: load('ao'),
      ...params,
    });
  }

  sprite(name) {
    return this._once('sprite:' + name, async () => {
      const t = await this.tex.loadAsync(this.base + `vfx/sprites/${name}.png`);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  }

  _once(key, fn) {
    if (!this._cache.has(key)) this._cache.set(key, fn());
    return this._cache.get(key);
  }
}

// Scale an object so its largest dimension equals `size`, and sit it on y=0
export function fitToSize(object, size) {
  const box = boundsOf(object);
  const dims = box.getSize(new THREE.Vector3());
  const s = size / Math.max(dims.x, dims.y, dims.z);
  object.scale.multiplyScalar(s);
  const b2 = boundsOf(object);
  const c = b2.getCenter(new THREE.Vector3());
  object.position.x -= c.x; object.position.z -= c.z; object.position.y -= b2.min.y;
  return object;
}

// World-space bounds that account for skinned (posed) meshes
export function boundsOf(object) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object, true);
}

// FBX exports come in as Phong with odd shininess; convert to PBR so they sit
// correctly under HDRI lighting next to the glTF assets.
function fixFbxMaterials(obj) {
  obj.traverse((c) => {
    if (!c.isMesh) return;
    const conv = (m) => {
      // FBXLoader treats these exports' already-linear colors as sRGB, which
      // crushes them to near-black; undo that second conversion.
      const color = m.map ? m.color.clone() : m.color.clone().convertLinearToSRGB();
      const out = new THREE.MeshStandardMaterial({
        color, map: m.map || null, roughness: 0.55, metalness: 0.15,
        emissive: m.emissive, emissiveMap: m.emissiveMap || null,
        transparent: m.transparent, opacity: m.opacity, name: m.name,
      });
      if (/metal|steel|iron/i.test(m.name)) { out.metalness = 0.7; out.roughness = 0.35; }
      return out;
    };
    c.material = Array.isArray(c.material) ? c.material.map(conv) : conv(c.material);
  });
}
