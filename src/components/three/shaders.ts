// GLSL for the HY-ARIA chamber: mist particles, reservoir surface, LED light beam, spores.

export const mistVertex = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uPixelRatio;
  attribute float aSeed;
  attribute vec3 aOrigin;
  attribute vec3 aDir;
  varying float vAlpha;

  void main() {
    // each droplet loops on its own phase; spray rises, spreads, then drifts down
    float speed = 0.55 + fract(aSeed * 7.13) * 0.45;
    float t = fract(uTime * speed * 0.6 + aSeed);
    vec3 p = aOrigin;
    p += aDir * t * 0.9;
    p.y += t * 0.55 - t * t * 0.75;
    // turbulence
    p.x += sin(uTime * 1.7 + aSeed * 40.0 + t * 6.0) * 0.06 * t;
    p.z += cos(uTime * 1.3 + aSeed * 23.0 + t * 5.0) * 0.06 * t;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = (14.0 + fract(aSeed * 13.7) * 22.0) * (0.35 + t);
    gl_PointSize = size * uPixelRatio / -mv.z;
    vAlpha = uIntensity * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t));
  }
`;

export const mistFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * a * vAlpha * 0.55);
  }
`;

export const waterVertex = /* glsl */ `
  uniform float uTime;
  uniform float uAgitation;
  varying vec2 vUv;
  varying float vWave;
  void main() {
    vUv = uv;
    vec3 p = position;
    float w = sin(p.x * 9.0 + uTime * 1.4) * 0.5 + sin(p.y * 7.0 - uTime * 1.1) * 0.5;
    float r = sin(length(p.xy - vec2(0.45, -0.1)) * 28.0 - uTime * 6.0) * uAgitation;
    vWave = w * 0.5 + r * 0.5;
    p.z += (w * 0.006 + r * 0.01);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const waterFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uGlow;
  varying vec2 vUv;
  varying float vWave;
  void main() {
    vec2 uv = vUv * 6.0;
    // cheap caustics: two drifting sine lattices
    float c = sin(uv.x * 3.1 + uTime * 0.8 + sin(uv.y * 2.3 + uTime * 0.6)) *
              sin(uv.y * 2.7 - uTime * 0.7 + sin(uv.x * 1.9 - uTime * 0.5));
    c = pow(abs(c), 6.0);
    float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) *
                 smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
    vec3 col = mix(uDeep, uShallow, 0.35 + vWave * 0.25);
    col += uGlow * c * 0.6;
    gl_FragColor = vec4(col, 0.78 * edge + 0.1);
  }
`;

export const beamVertex = /* glsl */ `
  varying float vY;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    vY = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vY;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float facing = pow(abs(dot(vN, vView)), 1.6);
    float a = vY * vY * facing * uIntensity * 0.22;
    gl_FragColor = vec4(uColor, a);
  }
`;

export const sporeVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.25 + aSeed * 30.0) * 0.12;
    p.x += cos(uTime * 0.2 + aSeed * 17.0) * 0.1;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (6.0 + aSeed * 8.0) * uPixelRatio / -mv.z;
    vAlpha = 0.25 + 0.35 * sin(uTime * 0.8 + aSeed * 50.0) * 0.5 + 0.175;
  }
`;

export const sporeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * vAlpha * uIntensity);
  }
`;
