// Procedural power-up pickups: metal pedestal, holo beam, beveled emissive icon,
// orbiting rings, glass-like shell and rising motes. No external files.
//
//   const p = createPowerUp('health'); scene.add(p.object);
//   p.update(dt);                // every frame
//   p.collect(vfx);              // burst + hide
import * as THREE from 'three';

export const POWERUP_TYPES = {
  health: { color: 0x37ff8b, icon: crossShape },
  shield: { color: 0x3fb8ff, icon: shieldShape },
  ammo:   { color: 0xffc23a, icon: bulletShape },
  speed:  { color: 0x5cf2ff, icon: boltShape },
  damage: { color: 0xff3b4e, icon: starShape },
  energy: { color: 0xb26bff, icon: crystalShape },
};

const metal = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.9, roughness: 0.32 });
const trim = new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 1, roughness: 0.22 });

export function createPowerUp(type = 'health', { color } = {}) {
  const def = POWERUP_TYPES[type] ?? POWERUP_TYPES.health;
  const c = new THREE.Color(color ?? def.color);
  const root = new THREE.Group();
  root.name = `powerup:${type}`;

  // --- pedestal
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.16, 6), metal);
  base.position.y = 0.08;
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.06, 6), trim);
  lip.position.y = 0.19;
  const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.018, 8, 6), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 4 }));
  glowRing.rotation.x = Math.PI / 2; glowRing.rotation.z = Math.PI / 6; glowRing.position.y = 0.225;
  for (const m of [base, lip]) { m.castShadow = m.receiveShadow = true; }
  root.add(base, lip, glowRing);

  // --- holo beam
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.45, 1.4, 32, 1, true), beamMaterial(c));
  beam.position.y = 0.92;
  root.add(beam);

  // --- floating pickup
  const float = new THREE.Group();
  float.position.y = 1.05;
  root.add(float);

  const icon = new THREE.Mesh(
    new THREE.ExtrudeGeometry(def.icon(), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 4, curveSegments: 16 }),
    new THREE.MeshPhysicalMaterial({ color: c.clone().multiplyScalar(0.35), emissive: c, emissiveIntensity: 1.6, metalness: 0.2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }),
  );
  icon.geometry.center();
  icon.castShadow = true;
  float.add(icon);

  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 6), fresnelMaterial(c));
  float.add(shell);

  const rings = [0.56, 0.64].map((r, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 8, 64), i ? trim : new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 3 }));
    ring.castShadow = true;
    float.add(ring);
    return ring;
  });
  // small nodes riding the outer ring
  const nodes = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const n = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 5 }));
    const a = (i / 3) * Math.PI * 2;
    n.position.set(Math.cos(a) * 0.64, Math.sin(a) * 0.64, 0);
    nodes.add(n);
  }
  rings[1].add(nodes);

  // --- rising motes
  const MOTES = 24;
  const motePos = new Float32Array(MOTES * 3);
  const moteSeed = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) moteSeed[i] = Math.random();
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('seed', new THREE.BufferAttribute(moteSeed, 1));
  const motes = new THREE.Points(moteGeo, moteMaterial(c));
  motes.frustumCulled = false;
  root.add(motes);

  const light = new THREE.PointLight(c, 3, 3, 2);
  light.position.y = 1;
  root.add(light);

  let t = Math.random() * 10;
  let collected = false;
  return {
    object: root,
    type,
    color: c,
    get collected() { return collected; },
    update(dt) {
      t += dt;
      float.position.y = 1.05 + Math.sin(t * 2) * 0.08;
      icon.rotation.y = t * 1.4;
      rings[0].rotation.set(t * 0.9, t * 0.5, 0);
      rings[1].rotation.set(-t * 0.6, t * 0.3 + 1, t * 0.4);
      shell.material.uniforms.time.value = t;
      beam.material.uniforms.time.value = t;
      glowRing.material.emissiveIntensity = 3 + Math.sin(t * 4) * 1;
      for (let i = 0; i < MOTES; i++) {
        const k = (moteSeed[i] + t * 0.25) % 1;
        const a = moteSeed[i] * 40 + t * 0.6;
        const r = 0.25 + moteSeed[i] * 0.2;
        motePos.set([Math.cos(a) * r, 0.25 + k * 1.6, Math.sin(a) * r], i * 3);
      }
      moteGeo.attributes.position.needsUpdate = true;
      motes.material.uniforms.time.value = t;
    },
    collect(vfx) {
      if (collected) return;
      collected = true;
      const p = float.getWorldPosition(new THREE.Vector3());
      vfx?.pickupBurst(p, { color: c });
      float.visible = beam.visible = motes.visible = false;
      light.intensity = 0;
    },
    reset() { collected = false; float.visible = beam.visible = motes.visible = true; light.intensity = 3; },
  };
}

// ---------------------------------------------------------------- materials
function beamMaterial(c) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: c }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform vec3 color; uniform float time; varying vec2 vUv;
      void main(){ float fade=pow(1.0-vUv.y,2.2); float lines=0.6+0.4*sin(vUv.y*60.0-time*6.0);
      float edge=0.5+0.5*sin(vUv.x*6.2831*6.0+time); gl_FragColor=vec4(color*fade*lines*(0.25+0.15*edge),0.0);}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}

function fresnelMaterial(c) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: c }, time: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP=position; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;}',
    fragmentShader: `uniform vec3 color; uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f=pow(1.0-abs(dot(vN,vV)),3.0); float spec=pow(max(dot(reflect(-vV,vN),normalize(vec3(0.4,0.8,0.5))),0.0),40.0);
      float band=smoothstep(0.02,0.0,abs(fract(vP.y*3.0-time*0.5)-0.5)-0.47);
      gl_FragColor=vec4(color*(f*1.2+band*0.25)+vec3(spec*0.8),0.0);}`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}

function moteMaterial(c) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: c }, time: { value: 0 }, scale: { value: 60 } },
    vertexShader: `attribute float seed; uniform float time; uniform float scale; varying float vA;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); float k=fract(seed+time*0.25);
      vA=sin(k*3.14159); gl_PointSize=scale*(0.5+seed)/-mv.z; gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform vec3 color; varying float vA;
      void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d)*vA; gl_FragColor=vec4((color+vec3(0.4))*a*1.5,0.0);}`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
}

// ---------------------------------------------------------------- icon shapes (≈0.5 units)
function crossShape() {
  const s = new THREE.Shape(), a = 0.09, b = 0.26;
  s.moveTo(-a, b); s.lineTo(a, b); s.lineTo(a, a); s.lineTo(b, a); s.lineTo(b, -a); s.lineTo(a, -a);
  s.lineTo(a, -b); s.lineTo(-a, -b); s.lineTo(-a, -a); s.lineTo(-b, -a); s.lineTo(-b, a); s.lineTo(-a, a); s.closePath();
  return s;
}
function shieldShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.28); s.quadraticCurveTo(0.14, 0.2, 0.24, 0.22); s.quadraticCurveTo(0.26, -0.08, 0, -0.3);
  s.quadraticCurveTo(-0.26, -0.08, -0.24, 0.22); s.quadraticCurveTo(-0.14, 0.2, 0, 0.28);
  return s;
}
function bulletShape() {
  const s = new THREE.Shape(), w = 0.08;
  s.moveTo(-w, -0.28); s.lineTo(w, -0.28); s.lineTo(w, 0.06); s.quadraticCurveTo(w, 0.22, 0, 0.3);
  s.quadraticCurveTo(-w, 0.22, -w, 0.06); s.closePath();
  return s;
}
function boltShape() {
  const s = new THREE.Shape();
  s.moveTo(0.06, 0.3); s.lineTo(-0.16, -0.02); s.lineTo(-0.01, -0.02); s.lineTo(-0.08, -0.3);
  s.lineTo(0.16, 0.04); s.lineTo(0.01, 0.04); s.closePath();
  return s;
}
function starShape() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.12 : 0.3, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}
function crystalShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.32); s.lineTo(0.15, 0.08); s.lineTo(0.1, -0.3); s.lineTo(-0.1, -0.3); s.lineTo(-0.15, 0.08); s.closePath();
  return s;
}
