import * as THREE from 'three';
import { clamp, damp } from './math';
import type { Input } from './Input';

export type RigMode = 'free' | 'orbit' | 'cinematic' | 'anchored';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Camera controller with four behaviours:
 * free flight (inertial WASD + drag look), orbit inspection, GSAP-driven cinematics,
 * and an anchored mode with cursor parallax used by the Gateway.
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  mode: RigMode = 'anchored';
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  /** Measured world-space velocity, whatever drives the camera. */
  worldVelocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  roll = 0;
  targetYaw = 0;
  targetPitch = 0;
  fov = 60;
  zoomFov = 60;
  private boostFov = 0;
  speed = 30;
  boost = 6;
  speedFactor = 1;
  lookTarget = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  anchor = { base: new THREE.Vector3(0, 0, 10), target: new THREE.Vector3(), parallax: new THREE.Vector2(0.4, 0.25), px: 0, py: 0 };
  orbit = {
    center: (() => new THREE.Vector3()) as () => THREE.Vector3,
    radius: 40,
    targetRadius: 30,
    theta: 0,
    phi: 0.2,
    targetTheta: 0,
    targetPhi: 0.2,
    min: 5,
    max: 400,
  };
  boosting = false;
  private lastPos = new THREE.Vector3();
  private fovApplied = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
  }

  /** Free flight from the camera's current pose, without a jump. */
  setFree() {
    this.mode = 'free';
    this.position.copy(this.camera.position);
    this.syncAnglesFromQuaternion(this.camera.quaternion);
    this.velocity.set(0, 0, 0);
  }

  syncAnglesFromQuaternion(q: THREE.Quaternion) {
    _e.setFromQuaternion(q, 'YXZ');
    this.yaw = this.targetYaw = _e.y;
    this.pitch = this.targetPitch = clamp(_e.x, -1.45, 1.45);
    this.roll = 0;
    this.quaternion.copy(q);
  }

  /** Point the free camera at a target immediately. */
  lookAtNow(target: THREE.Vector3) {
    _m.lookAt(this.position, target, UP);
    _q.setFromRotationMatrix(_m);
    this.syncAnglesFromQuaternion(_q);
    this.camera.quaternion.copy(_q);
  }

  /** Begin a cinematic from the current pose. */
  beginCinematic() {
    this.mode = 'cinematic';
    this.position.copy(this.camera.position);
    this.lookTarget.copy(this.camera.position).add(new THREE.Vector3(0, 0, -50).applyQuaternion(this.camera.quaternion));
    this.roll = 0;
  }

  enterOrbit(center: () => THREE.Vector3, radius: number, min: number, max: number) {
    const c = center();
    const rel = _v.copy(this.camera.position).sub(c);
    const r = Math.max(rel.length(), min);
    this.orbit.center = center;
    this.orbit.radius = r;
    this.orbit.targetRadius = radius;
    this.orbit.theta = this.orbit.targetTheta = Math.atan2(rel.x, rel.z);
    this.orbit.phi = Math.asin(clamp(rel.y / r, -0.99, 0.99));
    this.orbit.targetPhi = clamp(this.orbit.phi, -0.6, 0.6) * 0.5 + 0.12;
    this.orbit.min = min;
    this.orbit.max = max;
    this.quaternion.copy(this.camera.quaternion);
    this.mode = 'orbit';
  }

  update(dt: number, input: Input) {
    switch (this.mode) {
      case 'free':
        this.updateFree(dt, input);
        break;
      case 'orbit':
        this.updateOrbit(dt, input);
        break;
      case 'cinematic':
        _m.lookAt(this.position, this.lookTarget, UP);
        this.quaternion.setFromRotationMatrix(_m);
        if (this.roll !== 0) this.quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
        input.consumeLook();
        input.consumeWheel();
        break;
      case 'anchored': {
        const a = this.anchor;
        const c = input.centered(window.innerWidth, window.innerHeight);
        a.px = damp(a.px, c.x, 2.2, dt);
        a.py = damp(a.py, c.y, 2.2, dt);
        this.position.set(a.base.x + a.px * a.parallax.x, a.base.y - a.py * a.parallax.y, a.base.z);
        _m.lookAt(this.position, a.target, UP);
        this.quaternion.setFromRotationMatrix(_m);
        input.consumeLook();
        input.consumeWheel();
        break;
      }
    }

    this.camera.position.copy(this.position);
    this.camera.quaternion.copy(this.quaternion);
    if (dt > 0) this.worldVelocity.copy(this.position).sub(this.lastPos).divideScalar(dt);
    if (this.worldVelocity.lengthSq() > 1e10) this.worldVelocity.set(0, 0, 0);
    this.lastPos.copy(this.position);

    if (Math.abs(this.fovApplied - this.fov) > 1e-3) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
      this.fovApplied = this.fov;
    }
  }

  private updateFree(dt: number, input: Input) {
    const look = input.consumeLook();
    const sens = 0.0026 * (this.fov / 60);
    this.targetYaw -= look.x * sens;
    this.targetPitch = clamp(this.targetPitch - look.y * sens, -1.45, 1.45);
    this.yaw = damp(this.yaw, this.targetYaw, 14, dt);
    this.pitch = damp(this.pitch, this.targetPitch, 14, dt);
    this.roll = damp(this.roll, 0, 4, dt);
    _e.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.quaternion.setFromEuler(_e);

    const f = input.forward;
    const s = input.strafe;
    const u = input.vertical;
    const dir = new THREE.Vector3();
    dir.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion), f);
    dir.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion), s);
    dir.addScaledVector(UP, u);
    if (dir.lengthSq() > 1) dir.normalize();
    const moving = dir.lengthSq() > 1e-4;
    this.boosting = input.boost && moving;
    const max = this.speed * this.speedFactor * (this.boosting ? this.boost : 1);
    const rate = moving ? (this.boosting ? 1.6 : 2.4) : 1.8;
    this.velocity.lerp(dir.multiplyScalar(max), 1 - Math.exp(-rate * dt));
    this.position.addScaledVector(this.velocity, dt);

    const wheel = input.consumeWheel();
    if (wheel !== 0) this.zoomFov = clamp(this.zoomFov + wheel * 0.025, 22, 88);
    this.boostFov = damp(this.boostFov, this.boosting ? 14 : 0, 3, dt);
    this.fov = damp(this.fov, this.zoomFov + this.boostFov, 7, dt);
  }

  private updateOrbit(dt: number, input: Input) {
    const o = this.orbit;
    const look = input.consumeLook();
    o.targetTheta -= look.x * 0.0055;
    o.targetPhi = clamp(o.targetPhi + look.y * 0.0045, -1.35, 1.35);
    o.targetTheta += input.strafe * dt * 0.9;
    o.targetPhi = clamp(o.targetPhi + input.vertical * dt * 0.7, -1.35, 1.35);
    o.targetRadius *= Math.exp(-input.forward * dt * 1.1);
    const wheel = input.consumeWheel();
    if (wheel !== 0) o.targetRadius *= Math.exp(wheel * 0.0013);
    o.targetRadius = clamp(o.targetRadius, o.min, o.max);
    o.radius = damp(o.radius, o.targetRadius, 2.0, dt);
    o.theta = damp(o.theta, o.targetTheta, 4, dt);
    o.phi = damp(o.phi, o.targetPhi, 4, dt);
    const c = o.center();
    const cp = Math.cos(o.phi);
    this.position.set(c.x + Math.sin(o.theta) * cp * o.radius, c.y + Math.sin(o.phi) * o.radius, c.z + Math.cos(o.theta) * cp * o.radius);
    _m.lookAt(this.position, c, UP);
    _q.setFromRotationMatrix(_m);
    this.quaternion.slerp(_q, 1 - Math.exp(-5 * dt));
    this.fov = damp(this.fov, this.zoomFov, 4, dt);
  }
}
