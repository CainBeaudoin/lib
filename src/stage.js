// "Pro look" renderer preset: HDRI image-based lighting, ACES tone mapping,
// soft shadows, ambient occlusion, bloom and anti-aliasing in one call.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DEFAULTS = {
  hdri: null,            // url to an .hdr; null = neutral studio light
  showBackground: false, // draw the HDRI as the sky
  background: 0x0b0d12,
  exposure: 1.0,
  bloom: { strength: 0.6, radius: 0.4, threshold: 0.85 },
  ao: true,
  shadows: true,
  pixelRatio: Math.min(window.devicePixelRatio, 2),
};

export function createStage(container, options = {}) {
  const o = { ...DEFAULTS, ...options, bloom: { ...DEFAULTS.bloom, ...options.bloom } };

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(o.pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = o.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.background);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  camera.position.set(3, 2, 5);

  // Key light that casts the shadows; HDRI provides the fill and reflections.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 8, 4);
  sun.castShadow = o.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -8;
  sun.shadow.camera.right = sun.shadow.camera.top = 8;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;
  scene.add(sun);

  // Shadow-catcher ground that keeps the background color
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const neutralEnv = pmrem.fromScene(studioRoom(), 0.04).texture;
  scene.environment = neutralEnv;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const aoPass = new GTAOPass(scene, camera, 1, 1);
  aoPass.enabled = o.ao;
  // GTAO only hides points/lines; also hide see-through effects (particles,
  // beams, shields) so they don't get rendered as solid occluders.
  const hideForAo = aoPass.overrideVisibility.bind(aoPass);
  aoPass.overrideVisibility = function () {
    hideForAo();
    this.scene.traverse((obj) => {
      const m = obj.material;
      if (obj.userData.noAO || (m && !Array.isArray(m) && m.transparent && !m.depthWrite)) obj.visible = false;
    });
  };
  composer.addPass(aoPass);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), o.bloom.strength, o.bloom.radius, o.bloom.threshold);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass(1, 1);
  composer.addPass(smaa);

  const stage = {
    renderer, scene, camera, composer, sun, ground, bloomPass, aoPass,
    async setHdri(url, showBackground = o.showBackground) {
      if (!url) {
        scene.environment = neutralEnv;
        scene.background = new THREE.Color(o.background);
        return;
      }
      const tex = await new RGBELoader().loadAsync(url);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const env = pmrem.fromEquirectangular(tex).texture;
      scene.environment = env;
      scene.background = showBackground ? tex : new THREE.Color(o.background);
      scene.backgroundBlurriness = 0.05;
    },
    // Make every mesh in an object cast/receive shadows
    prepare(object) {
      object.traverse((c) => {
        if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
      });
      return object;
    },
    // Frame the camera on an object
    frame(object, controls, padding = 1.4) {
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object, true);
      const size = box.getSize(new THREE.Vector3()).length();
      const center = box.getCenter(new THREE.Vector3());
      const dist = (size * padding) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      const dir = new THREE.Vector3(0.6, 0.35, 1).normalize();
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.near = dist / 100; camera.far = dist * 100; camera.updateProjectionMatrix();
      if (controls) { controls.target.copy(center); controls.update(); }
    },
    resize() {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    },
    render() { composer.render(); },
  };

  new ResizeObserver(() => stage.resize()).observe(container);
  stage.resize();
  if (o.hdri) stage.setHdri(o.hdri);
  return stage;
}

// Procedural softbox room used as the default environment (no download needed)
function studioRoom() {
  const room = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x202024, side: THREE.BackSide }));
  room.add(box);
  const panel = (w, h, intensity, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(intensity, intensity, intensity) }));
    m.position.set(...pos); m.rotation.set(...rot); room.add(m);
  };
  panel(6, 2, 6, [0, 4.9, 0], [Math.PI / 2, 0, 0]);
  panel(2, 4, 3, [-4.9, 1, 1], [0, Math.PI / 2, 0]);
  panel(3, 3, 2, [4.9, 1, -1], [0, -Math.PI / 2, 0]);
  panel(4, 1, 1.5, [0, 1, -4.9], [0, 0, 0]);
  return room;
}
