import * as THREE from 'three';

/** Frees GPU resources under a node. Textures flagged userData.shared are kept. */
export function disposeObject(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => materials.add(x));
    else if (m) materials.add(m);
  });
  materials.forEach((mat) => {
    const uniforms = (mat as THREE.ShaderMaterial).uniforms;
    if (uniforms) {
      for (const key in uniforms) {
        const v = uniforms[key]?.value;
        if (v && (v as THREE.Texture).isTexture && !(v as THREE.Texture).userData?.shared) {
          (v as THREE.Texture).dispose();
        }
      }
    }
    mat.dispose();
  });
}
