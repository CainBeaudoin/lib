// Sockets: named mount points on any object, so assets can be combined instead of
// being one-off models. A socket is an empty Object3D; whatever is attached to it
// follows it (including animated bones).
//
//   autoSockets(mech.object);                         // top/front/back/left/right/bottom/center + hand/head bones
//   attach(mech.object, 'handR', gun.object, { size: 0.6 });
//   attach(car.object, 'top', rack, { offset: [0, 0.02, 0] });
//   addSocket(tank, 'muzzle', { position: [0, 1.2, 2.4] });
//   detach(gun.object);
import * as THREE from 'three';
import { boundsOf, fitToSize } from './library.js';

const tmp = new THREE.Vector3();

// Add a named socket. `bone` (a name or regex) parents it to a skeleton bone instead.
export function addSocket(target, name, { position = [0, 0, 0], rotation = [0, 0, 0], bone = null } = {}) {
  removeSocket(target, name);
  const s = new THREE.Object3D();
  s.name = `socket:${name}`;
  s.userData.socket = name;
  s.position.fromArray(position);
  s.rotation.set(...rotation);
  let parent = target;
  if (bone) {
    const re = bone instanceof RegExp ? bone : new RegExp(`^${bone}$`, 'i');
    target.traverse((o) => { if (o.isBone && parent === target && re.test(o.name)) parent = o; });
    if (parent === target) return null;
    // bones are often scaled by the import; keep the socket in unscaled units
    parent.updateWorldMatrix(true, false);
    s.scale.setScalar(1 / parent.getWorldScale(tmp).x * target.getWorldScale(new THREE.Vector3()).x);
  }
  parent.add(s);
  (target.userData.sockets ??= {})[name] = s;
  return s;
}

export function removeSocket(target, name) {
  const s = target.userData.sockets?.[name];
  if (s) { s.parent?.remove(s); delete target.userData.sockets[name]; }
}

export function getSocket(target, name) { return target.userData.sockets?.[name] ?? null; }
export function socketsOf(target) { return Object.keys(target.userData.sockets ?? {}); }

// Bounds-based sockets in the target's local space, plus common humanoid bones.
// Faces point outward: a part attached to 'front' has its +Z facing away from the object.
export function autoSockets(target) {
  const inv = new THREE.Matrix4().copy(target.matrixWorld).invert();
  const box = boundsOf(target).applyMatrix4(inv);
  const c = box.getCenter(new THREE.Vector3());
  const { min, max } = box;
  const faces = {
    top: [[c.x, max.y, c.z], [0, 0, 0]],
    bottom: [[c.x, min.y, c.z], [Math.PI, 0, 0]],
    front: [[c.x, c.y, max.z], [0, 0, 0]],
    back: [[c.x, c.y, min.z], [0, Math.PI, 0]],
    left: [[max.x, c.y, c.z], [0, Math.PI / 2, 0]],
    right: [[min.x, c.y, c.z], [0, -Math.PI / 2, 0]],
    center: [[c.x, c.y, c.z], [0, 0, 0]],
  };
  for (const [name, [position, rotation]] of Object.entries(faces)) addSocket(target, name, { position, rotation });
  const bones = { handR: /hand.?r|r.?hand|righthand|wrist.?r/i, handL: /hand.?l|l.?hand|lefthand|wrist.?l/i, head: /^head$|head$/i, back: /spine.?0?2|chest|upperchest/i };
  for (const [name, re] of Object.entries(bones)) {
    if (name === 'back') { if (findBone(target, re)) addSocket(target, 'spine', { bone: re }); continue; }
    if (findBone(target, re)) addSocket(target, name, { bone: re });
  }
  return socketsOf(target);
}

function findBone(target, re) {
  let hit = null;
  target.traverse((o) => { if (!hit && o.isBone && re.test(o.name)) hit = o; });
  return hit;
}

// Attach `part` to a socket. size: fit the part's largest dimension; offset/rotation: local tweak.
// anchor: which side of the part sits on the socket ('bottom' default, 'center', 'back').
export function attach(target, socket, part, { size = null, offset = [0, 0, 0], rotation = [0, 0, 0], anchor = 'bottom' } = {}) {
  const s = typeof socket === 'string' ? getSocket(target, socket) : socket;
  if (!s) throw new Error(`no socket "${socket}"`);
  detach(part);
  const holder = new THREE.Group();
  holder.name = `attached:${part.name || part.uuid}`;
  part.position.set(0, 0, 0); part.rotation.set(0, 0, 0);
  if (size) fitToSize(part, size);
  // move the part so its anchor point sits at the holder origin
  const b = boundsOf(part);
  const pc = b.getCenter(new THREE.Vector3());
  const a = anchor === 'center' ? pc : anchor === 'back' ? new THREE.Vector3(pc.x, pc.y, b.min.z) : new THREE.Vector3(pc.x, b.min.y, pc.z);
  part.position.sub(a);
  holder.add(part);
  holder.position.fromArray(offset);
  holder.rotation.set(...rotation);
  s.add(holder);
  part.userData.attachedTo = { target, socket: s.userData.socket, holder };
  return { part, holder, detach: () => detach(part) };
}

export function detach(part) {
  const info = part.userData.attachedTo;
  if (!info) return;
  info.holder.parent?.remove(info.holder);
  info.holder.remove(part);
  delete part.userData.attachedTo;
}

// Everything currently attached to a socket
export function attachedTo(target, socket) {
  const s = getSocket(target, socket);
  return s ? s.children.flatMap((h) => h.children) : [];
}
