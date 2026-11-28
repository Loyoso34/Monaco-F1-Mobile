// Static sun shadow for the city. The sun never moves, so the shadows of the buildings, the
// landmarks, the grandstands, the bridges, the trees and the hillside are rendered ONCE at load
// into a depth map seen from the sun (orthographic, fitted round the circuit), and the city,
// terrain and prop materials look it up per pixel: facades fall into the shade of the block
// opposite, balconies and awnings throw shadows on their walls, streets and slopes darken under
// the buildings - at the cost of a few texture reads, with nothing re-rendered per frame.
// (The car keeps its own real-time shadow; the road and barriers keep their baked vertex shade.)
import * as THREE from 'three';

export const SUN_SHADOW_LAYER = 4;
const U = { map: { value: null }, matrix: { value: new THREE.Matrix4() }, texel: { value: 1 / 2048 }, on: { value: 0 }, bias: { value: 0.0001 }, texelM: { value: 0.5 } };
let patched = false;

function patchChunks() {
  if (patched) return;
  patched = true;
  const C = THREE.ShaderChunk;
  const hook = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!C.lights_fragment_begin.includes(hook)) { console.warn('sunshadow: hook not found'); return; }
  C.lights_fragment_begin = C.lights_fragment_begin.replace(hook, hook + '\n\t\t#ifdef SUN_STATIC_SHADOW\n\t\tdirectLight.color *= sunStaticLight( geometryNormal, directLight.direction );\n\t\t#endif');
  C.lights_pars_begin = C.lights_pars_begin + `
#ifdef SUN_STATIC_SHADOW
uniform sampler2DShadow sunShadowMap;
uniform mat4 sunShadowMatrix;
uniform float sunShadowTexel;
uniform float sunShadowOn;
uniform float sunShadowBias;
uniform float sunShadowTexelM;
varying vec3 vSunW;
float sunStaticLight( vec3 nView, vec3 lView ) {
  // no lookup where the sun cannot light the surface anyway (about half of all pixels)
  if ( sunShadowOn < 0.5 || dot( nView, lView ) <= 0.0 ) return 1.0;
  vec3 nW = inverseTransformDirection( nView, viewMatrix );
  vec4 sc = sunShadowMatrix * vec4( vSunW + nW * 0.28, 1.0 );
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if ( p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0 ) return 1.0;
  // slope-scaled bias: a surface the sun grazes changes depth by tan(angle) x one texel across a
  // texel (and the filter taps reach half a texel either way) - without it, large gently sloped
  // surfaces (roofs, canopies, hillsides) shadow themselves in bands
  float ndl = dot( nView, lView ), tanA = min( sqrt( max( 0.0, 1.0 - ndl * ndl ) ) / max( ndl, 0.05 ), 3.0 );
  float z = p.z - sunShadowBias * ( 1.0 + tanA * sunShadowTexelM / 0.12 );
  // four hardware-filtered depth comparisons (each a bilinear 2 x 2 percentage-closer filter)
  // half a texel apart: soft, stable edges at the map's ~0.5 m texels for 4 texture reads
  float h = 0.5 * sunShadowTexel;
  return 0.25 * ( texture( sunShadowMap, vec3( p.xy + vec2( -h, -h ), z ) ) + texture( sunShadowMap, vec3( p.xy + vec2( h, -h ), z ) )
                + texture( sunShadowMap, vec3( p.xy + vec2( -h, h ), z ) ) + texture( sunShadowMap, vec3( p.xy + vec2( h, h ), z ) ) );
}
#endif`;
}

// a material that receives the static sun shadow (vertex shader passes the world position)
export function receiveSunShadow(material) {
  patchChunks();
  material.defines = Object.assign({}, material.defines, { SUN_STATIC_SHADOW: '' });
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(material, sh, r);
    sh.uniforms.sunShadowMap = U.map; sh.uniforms.sunShadowMatrix = U.matrix; sh.uniforms.sunShadowTexel = U.texel; sh.uniforms.sunShadowOn = U.on; sh.uniforms.sunShadowBias = U.bias; sh.uniforms.sunShadowTexelM = U.texelM;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 vSunW;\nvoid main() {')
      .replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 sw = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          sw = instanceMatrix * sw;
        #endif
        vSunW = ( modelMatrix * sw ).xyz;
      }`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
  material.customProgramCacheKey = () => (key ? key() : '') + '|sunStatic';
  material.needsUpdate = true;
}

// render the casters (objects on SUN_SHADOW_LAYER) once from the sun into a depth map fitted to
// the given world-space box
export function bakeSunShadow(renderer, scene, sunDir, box, size = 3072) {
  const sd = sunDir.clone().normalize();
  const center = box.getCenter(new THREE.Vector3());
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  cam.position.copy(center).addScaledVector(sd, 2500);
  cam.up.set(0, 1, 0);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  // fit the frustum to the box as seen from the sun
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  cam.left = x0; cam.right = x1; cam.top = y1; cam.bottom = y0; cam.near = -z1 - 50; cam.far = -z0 + 50;
  cam.updateProjectionMatrix();
  cam.layers.set(SUN_SHADOW_LAYER);
  const rt = new THREE.WebGLRenderTarget(size, size, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: true, generateMipmaps: false });
  rt.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  // sampled as a shadow sampler: the GPU compares and filters (hardware PCF)
  rt.depthTexture.compareFunction = THREE.LessEqualCompare;
  rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.LinearFilter;
  const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevOverride = scene.overrideMaterial;
  const prevBg = scene.background, prevFog = scene.fog;
  renderer.shadowMap.autoUpdate = false;
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  scene.background = null; scene.fog = null;
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  scene.overrideMaterial = prevOverride; scene.background = prevBg; scene.fog = prevFog;
  renderer.shadowMap.autoUpdate = prevAuto;
  U.map.value = rt.depthTexture;
  U.matrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  U.texel.value = 1 / size;
  U.on.value = 1;
  U.bias.value = 0.12 / (cam.far - cam.near);              // 12 cm in depth (+ the slope term)
  U.texelM.value = Math.max(x1 - x0, y1 - y0) / size;      // texel size in metres
  return { rt, camera: cam, texel: U.texelM.value };
}
