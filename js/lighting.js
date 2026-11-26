// Shared light balance and colour pipeline (the game and tools/carview.html use the same
// values, so model renders and the game always agree).
//
// Colour pipeline: every colour texture is tagged sRGB (decoded to linear on sampling), the
// lighting is linear, the tone mapper (below) only compresses highlights, and the output is
// encoded to sRGB for the display.
//
// Tone mapping: Khronos PBR Neutral's highlight compression (hue-preserving, a little
// desaturation only where a colour is pushed past the display range) WITHOUT its toe. The toe
// subtracts an offset taken from the darkest channel from all three channels below 0.08 - on
// the RB20's deep navy (red channel ~0.003) that removes the neutral sky / street reflection
// and leaves a saturated blue-black, and it cuts the reflections of dark glossy parts (black
// dielectric probes lost 3-10x of their 4 % Fresnel reflection). ACES Filmic, used before, has
// a per-channel toe and shoulder that crushed the navy and pushed the yellow-orange airbox
// towards pale yellow. With this curve the navy, the Red Bull red, the yellow-orange airbox and
// the white lettering come out as painted in the mid-tones; sun glints on clear coat and white
// lettering in full sun roll off smoothly.
//
// Light balance (clear afternoon in Monaco): the sun is the key light; on a horizontal
// surface the whole sky gives roughly a fifth of the sun's irradiance. PBR materials (car,
// asphalt, water) take their sky and street light from the HDR environment map, which also
// supplies their reflections, so the hemisphere light that fills the Lambert-lit city is cut
// to a small share for them (otherwise their diffuse fill is counted twice and the car looks
// flat and washed out). See envmap.js for the environment radiance.
import * as THREE from 'three';

export const LIGHT = {
  sun: 3.0,                  // directional sun (irradiance on a perpendicular surface)
  hemi: 0.80,                // sky / ground fill for the Lambert city
  hemiPBR: 0.22,             // share of that fill on materials lit by the environment map
  env: 0.95,                 // scene.environmentIntensity (outdoors)
  exposure: 1.0,
  sky: 0xcfe2ff, ground: 0x8a7f6c, sunColor: 0xfff1dc,
};

let patched = false;
// Scale the hemisphere-light irradiance on environment-lit PBR materials. Must run before the
// first material compiles (it edits the shared shader chunk once).
export function patchHemisphereForPBR(scale = LIGHT.hemiPBR) {
  if (patched) return;
  patched = true;
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const from = 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';
  if (!chunk.includes(from)) { console.warn('lighting: hemisphere chunk not found'); return; }
  THREE.ShaderChunk.lights_fragment_begin = chunk.replace(from,
    `#if defined( STANDARD ) && defined( USE_ENVMAP )
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * ${scale.toFixed(3)};
		#else
			${from}
		#endif`);
}

// Car sunlight in the shade of buildings: the sun is one light for the whole scene, so the
// facades round the car must stay sun-lit while the car drives through a building's shadow.
// Materials flagged with markCarSun() multiply the directional (sun) light by this uniform,
// driven from the baked building-shade table along the lap (scenery.js).
export const CAR_SUN = { value: 1 };
let sunPatched = false;
function patchCarSun() {
  if (sunPatched) return;
  sunPatched = true;
  const C = THREE.ShaderChunk;
  const a = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!C.lights_fragment_begin.includes(a) || !C.lights_pars_begin.includes('uniform vec3 ambientLightColor;')) { console.warn('lighting: car sun hook not found'); return; }
  C.lights_fragment_begin = C.lights_fragment_begin.replace(a, a + '\n\t\t#ifdef CAR_SUN\n\t\tdirectLight.color *= carSunScale;\n\t\t#endif');
  C.lights_pars_begin = C.lights_pars_begin.replace('uniform vec3 ambientLightColor;', 'uniform vec3 ambientLightColor;\n#ifdef CAR_SUN\nuniform float carSunScale;\n#endif');
}
export function markCarSun(material) {
  patchCarSun();
  material.defines = Object.assign({}, material.defines, { CAR_SUN: '' });
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => { sh.uniforms.carSunScale = CAR_SUN; if (prev) prev.call(material, sh, r); };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
  material.customProgramCacheKey = () => (key ? key() : '') + '|carSun';
  material.needsUpdate = true;
}

let tmPatched = false;
function patchToneMapping() {
  if (tmPatched) return;
  tmPatched = true;
  const from = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (!chunk.includes(from)) { console.warn('lighting: tone mapping chunk not found'); return; }
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(from, `vec3 CustomToneMapping( vec3 color ) {
	// PBR Neutral highlight compression without the toe offset (see js/lighting.js)
	const float StartCompression = 0.80;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}`);
}

export function setupRenderer(renderer, { toneMapping = 'neutral-notoe' } = {}) {
  patchHemisphereForPBR();
  patchToneMapping();
  patchCarSun();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : toneMapping === 'agx' ? THREE.AgXToneMapping
    : toneMapping === 'neutral' ? THREE.NeutralToneMapping : THREE.CustomToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;
}
