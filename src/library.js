// Asset library loader: reads assets/manifest.json and loads models, materials,
// HDRIs and sprites by id, with caching and per-instance cloning.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const BINARY = /\.(glb|fbx|hdr)$/i;

export class AssetLibrary {
  // options.binarySuffix: set to '.b64.txt' when .glb/.fbx/.hdr files are hosted
  // as base64 text (for hosts that only serve web file types)
  static async load(baseUrl = new URL('../assets/', import.meta.url).href, options = {}) {
    const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    const manifest = await (await fetch(base + 'manifest.json')).json();
    return new AssetLibrary(base, manifest, options);
  }

  constructor(base, manifest, { binarySuffix = '' } = {}) {
    this.base = base;
    this.binarySuffix = binarySuffix;
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
      const buffer = await this.binary(a.path);
      const dir = this.base + a.path.slice(0, a.path.lastIndexOf('/') + 1);
      if (a.format === 'fbx') {
        const obj = this.fbx.parse(buffer, dir);
        fixFbxMaterials(obj);
        return { scene: obj, animations: obj.animations };
      }
      const g = await new Promise((resolve, reject) => this.gltf.parse(buffer, dir, resolve, reject));
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

  // Equirectangular HDR environment texture, ready for stage.setHdri()
  hdri(id) {
    return this._once('hdri:' + id, async () => {
      const d = new RGBELoader().parse(await this.binary(this.get(id).path));
      const tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
      tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.flipY = true;
      tex.needsUpdate = true;
      return tex;
    });
  }

  // Raw bytes of an asset file, decoding base64-hosted copies when configured
  async binary(path) {
    if (!this.binarySuffix || !BINARY.test(path)) {
      return (await fetch(this.base + path)).arrayBuffer();
    }
    const text = await (await fetch(this.base + path + this.binarySuffix)).text();
    const bin = atob(text.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
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

// A spread of skin and hair tones for giving base characters variety.
export const SKIN_TONES = { porcelain: 0xf3d4c1, light: 0xe8b796, tan: 0xc68642, brown: 0x8d5524, deep: 0x5a3519, ebony: 0x3b2414 };
export const HAIR_TONES = { black: 0x1b1612, brown: 0x4a2c17, auburn: 0x8a3b1e, blonde: 0xd8b26e, grey: 0x9a9a9a, white: 0xeeeeee };

// Recolor materials by name on one instance, e.g. recolor(m.object, { Skin: SKIN_TONES.tan, Hair: '#222' }).
// Materials are cloned first so other instances of the same model keep their colors.
export function recolor(object, colors) {
  const keys = Object.fromEntries(Object.entries(colors).map(([k, v]) => [k.toLowerCase(), v]));
  object.traverse((c) => {
    if (!c.isMesh) return;
    const swap = (m) => {
      const v = keys[m.name.toLowerCase()];
      if (v == null) return m;
      const out = m.userData.recolored ? m : m.clone();
      out.userData.recolored = true;
      out.color.set(v);
      return out;
    };
    c.material = Array.isArray(c.material) ? c.material.map(swap) : swap(c.material);
  });
  return object;
}
