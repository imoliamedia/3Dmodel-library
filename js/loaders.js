import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';

export const EXTENSIONS = ['stl', '3mf', 'obj'];
export const MAX_PREVIEW_BYTES = 150 * 1024 * 1024; // above this we skip automatic parsing

export const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
export const isModelFile = (name) => EXTENSIONS.includes(extOf(name));

const defaultMaterial = () => new THREE.MeshStandardMaterial({
  color: 0x6aa0ff, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide,
});

/**
 * Parse a stored file into a Y-up THREE.Group sitting on y=0 and centred on x/z.
 * Slicer files are Z-up, so everything is rotated -90deg around X.
 * Returns { object, dims } where dims = { w, d, h } in model units (mm).
 */
export async function parseModel(blob, ext, { mtl = '' } = {}) {
  let content;
  if (ext === 'stl') {
    const geo = new STLLoader().parse(await blob.arrayBuffer());
    // Many exporters write zeroed normals, so always recompute (gives flat shading per triangle).
    geo.computeVertexNormals();
    content = new THREE.Mesh(geo, defaultMaterial());
  } else if (ext === 'obj') {
    const loader = new OBJLoader();
    if (mtl) {
      // Only the colours are used: texture maps would need extra files, so drop those lines.
      const materials = new MTLLoader().parse(mtl.replace(/^\s*(map_|bump|disp|decal|refl)\S*.*$/gim, ''), '');
      materials.preload();
      loader.setMaterials(materials);
    }
    content = loader.parse(await blob.text());
    content.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.geometry.getAttribute('normal')) o.geometry.computeVertexNormals();
      const hasColors = !!o.geometry.getAttribute('color');
      if (mtl) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.side = THREE.DoubleSide; });
      } else if (hasColors) {
        o.material = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide,
        });
      } else {
        o.material = defaultMaterial();
      }
    });
  } else if (ext === '3mf') {
    content = new ThreeMFLoader().parse(await blob.arrayBuffer());
    content.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        m.side = THREE.DoubleSide;
        // plain white means "no colour assigned" in most files: use the library colour instead
        if (!m.vertexColors && !m.map && m.color?.getHex() === 0xffffff) m.color.set(0x6aa0ff);
      });
    });
  } else {
    throw new Error(`Unsupported format: ${ext}`);
  }

  const zUp = new THREE.Group();
  zUp.add(content);
  zUp.rotation.x = -Math.PI / 2;
  zUp.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(zUp);
  if (box.isEmpty()) throw new Error('Empty model');
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const object = new THREE.Group();
  object.add(zUp);
  zUp.position.set(-center.x, -box.min.y, -center.z);
  object.updateMatrixWorld(true);

  return { object, dims: { w: size.x, d: size.z, h: size.y } };
}

/** Many slicer-made 3MF files embed a preview image. Returns a Blob or null. */
export async function extract3mfThumbnail(blob) {
  try {
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
      filter: (f) => /thumbnail[^/]*\.(png|jpe?g)$/i.test(f.name),
    });
    const names = Object.keys(files);
    if (!names.length) return null;
    // prefer the plain thumbnail over plate_1_small and similar variants
    names.sort((a, b) => files[b].length - files[a].length);
    const best = names[0];
    const type = /\.jpe?g$/i.test(best) ? 'image/jpeg' : 'image/png';
    return new Blob([files[best]], { type });
  } catch {
    return null;
  }
}

export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6270, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-4, 2, -3);
  scene.add(fill);
}

/** Position the camera so the whole object fits. Returns the target point. */
export function fitCamera(camera, object, dir = new THREE.Vector3(1, 0.8, 1)) {
  const box = new THREE.Box3().setFromObject(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (sphere.radius / Math.sin(Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect)) / 2)) * 1.05;
  camera.position.copy(sphere.center).addScaledVector(dir.clone().normalize(), dist);
  camera.near = Math.max(dist / 1000, 0.01);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(sphere.center);
  return sphere.center;
}

export function disposeObject(object) {
  object.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}
