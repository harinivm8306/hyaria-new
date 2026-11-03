"use client";

/*
  HY-ARIA digital twin of the 3-tier aeroponic chamber (report Fig 6.3).
  Top tier: LED grow light + lettuce canopy. Middle tier: hanging roots + mist nozzles.
  Bottom tier: nutrient reservoir + pump. Everything visual is driven by `state`.
*/

import { Html, OrbitControls, RoundedBox, Lightformer, Environment } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MutableRefObject, Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  beamFragment, beamVertex, mistFragment, mistVertex, sporeFragment, sporeVertex, waterFragment, waterVertex,
} from "./shaders";

export type ChamberState = {
  mistOn: boolean;        // pump spraying now
  ledPwm: number;         // 0..100
  growth: number;         // 0..1 (days / cycle length)
  waterLevel: number;     // 0..100 %
  health: "Good" | "Watch" | "Act" | "Unknown";
  pumpFault?: boolean;
};

export type FocusKey = "overview" | "canopy" | "roots" | "reservoir" | "plants";

export type Hotspot = { id: FocusKey | string; label: string; value?: string; position: [number, number, number]; tone?: "leaf" | "mist" | "violet" | "amber" | "red" };

type StoryRef = MutableRefObject<{ progress: number }>;

const C = {
  frame: "#1b2427",
  frameEdge: "#2d3a3e",
  panel: "#9fd9c6",
  leafLight: new THREE.Color("#c4ec8c"),
  leafDeep: new THREE.Color("#2f8a3f"),
  leafSick: new THREE.Color("#c7b24a"),
  root: "#e9e4d2",
  water: { deep: new THREE.Color("#04262a"), shallow: new THREE.Color("#0e5c5a"), glow: new THREE.Color("#7fd4f0") },
  led: new THREE.Color("#c27bff"),
  mist: new THREE.Color("#cfefff"),
};

// chamber dimensions (metres-ish)
const W = 2.0, D = 1.2;
const T0 = 0, T1 = 0.9, T2 = 1.9, T3 = 2.9; // tier floors
const POTS: [number, number][] = [[-0.6, -0.22], [-0.2, 0.22], [0.2, -0.22], [0.6, 0.22]];

export const CAMERA_PRESETS: Record<FocusKey, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [4.4, 3.1, 5.0], target: [0, 1.45, 0] },
  canopy: { pos: [2.1, 3.5, 2.6], target: [0, 2.2, 0] },
  plants: { pos: [2.4, 3.05, 2.7], target: [0, 2.15, 0] },
  roots: { pos: [2.3, 1.45, 2.7], target: [0, 1.35, 0] },
  reservoir: { pos: [2.6, 0.9, 2.9], target: [0, 0.35, 0] },
};

// ---------------------------------------------------------------- utilities
function seeded(n: number) {
  let s = n * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function makeLeafGeometry(rand: () => number) {
  // lettuce leaf: narrow stalk, broad rounded blade, frilly edge that curls outward
  const g = new THREE.PlaneGeometry(1, 1, 16, 32);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const mix: number[] = [];
  const frill = 0.02 + rand() * 0.02;
  const freq = 13 + rand() * 6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * 2;           // -1..1 across
    const y = pos.getY(i) + 0.5;         // 0..1 along
    const blade = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * y - 1), 2.4)), 1 / 2.4);
    const stalk = 0.22 + 0.78 * THREE.MathUtils.smoothstep(y, 0.0, 0.32);
    const w = 0.42 * blade * stalk;
    const nx = x * w;
    const edge = Math.abs(x);
    const cup = edge * edge * 0.16 * (1 - y * 0.5);
    const curl = -y * y * 0.22;
    const wave = Math.sin(y * freq + x * 7) * frill * Math.pow(edge, 3) * (0.4 + y);
    pos.setXYZ(i, nx, y, cup + curl + wave);
    mix.push(THREE.MathUtils.smoothstep(Math.max(edge, y * 0.9), 0.15, 1.0), edge, 0);
  }
  g.setAttribute("aMix", new THREE.Float32BufferAttribute(mix, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- materials
function useLeafMaterial(healthRef: MutableRefObject<number>) {
  return useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.35 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uLight = { value: C.leafLight };
      shader.uniforms.uDeep = { value: C.leafDeep };
      shader.uniforms.uSick = { value: C.leafSick };
      shader.uniforms.uStress = { value: 0 };
      m.userData.shader = shader;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 aMix;\nvarying vec3 vMix;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMix = aMix;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uLight; uniform vec3 uDeep; uniform vec3 uSick; uniform float uStress; varying vec3 vMix;")
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          `vec3 leaf = mix(uLight, uDeep, vMix.x);
           float vein = 1.0 - smoothstep(0.0, 0.05, vMix.y);
           leaf = mix(leaf, uLight * 1.05, vein * 0.3);
           leaf = mix(leaf, uSick, uStress * smoothstep(0.35, 1.0, vMix.x));
           vec4 diffuseColor = vec4( leaf, opacity );`
        );
    };
    return m;
  }, []);
}

// ---------------------------------------------------------------- parts
function Frame() {
  const posts: [number, number][] = [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]];
  return (
    <group>
      {posts.map(([x, z], i) => (
        <RoundedBox key={i} args={[0.08, T3 + 0.08, 0.08]} radius={0.03} position={[x, T3 / 2, z]}>
          <meshStandardMaterial color={C.frame} roughness={0.6} metalness={0.2} />
        </RoundedBox>
      ))}
      {[T0, T1, T2, T3].map((y, i) => (
        <group key={i} position={[0, y, 0]}>
          <RoundedBox args={[W + 0.08, 0.07, 0.08]} radius={0.025} position={[0, 0, -D / 2]}><meshStandardMaterial color={C.frameEdge} roughness={0.55} /></RoundedBox>
          <RoundedBox args={[W + 0.08, 0.07, 0.08]} radius={0.025} position={[0, 0, D / 2]}><meshStandardMaterial color={C.frameEdge} roughness={0.55} /></RoundedBox>
          <RoundedBox args={[0.08, 0.07, D]} radius={0.025} position={[-W / 2, 0, 0]}><meshStandardMaterial color={C.frameEdge} roughness={0.55} /></RoundedBox>
          <RoundedBox args={[0.08, 0.07, D]} radius={0.025} position={[W / 2, 0, 0]}><meshStandardMaterial color={C.frameEdge} roughness={0.55} /></RoundedBox>
        </group>
      ))}
      {/* translucent drawer panels */}
      {[[T0, T1], [T1, T2], [T2, T3]].map(([a, b], i) => (
        <group key={i}>
          <mesh position={[0, (a + b) / 2, D / 2]}>
            <planeGeometry args={[W, b - a - 0.06]} />
            <meshPhysicalMaterial color={C.panel} transparent opacity={0.045} roughness={0.1} metalness={0} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[0, (a + b) / 2, -D / 2]}>
            <planeGeometry args={[W, b - a - 0.06]} />
            <meshPhysicalMaterial color={C.panel} transparent opacity={0.07} roughness={0.1} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[W / 2, (a + b) / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[D, b - a - 0.06]} />
            <meshPhysicalMaterial color={C.panel} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[-W / 2, (a + b) / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[D, b - a - 0.06]} />
            <meshPhysicalMaterial color={C.panel} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {/* grow board with net pots */}
      <mesh position={[0, T2 - 0.02, 0]}>
        <boxGeometry args={[W - 0.02, 0.04, D - 0.02]} />
        <meshStandardMaterial color="#20302f" roughness={0.8} />
      </mesh>
      {POTS.map(([x, z], i) => (
        <mesh key={i} position={[x, T2 - 0.03, z]}>
          <cylinderGeometry args={[0.13, 0.1, 0.12, 24, 1, true]} />
          <meshStandardMaterial color="#0f1516" roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function Plant({ x, z, seed, growthRef, stressRef }: { x: number; z: number; seed: number; growthRef: MutableRefObject<number>; stressRef: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const material = useLeafMaterial(stressRef);
  const leaves = useMemo(() => {
    const rand = seeded(seed);
    const out: { geo: THREE.BufferGeometry; angle: number; tilt: number; order: number; size: number }[] = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      out.push({
        geo: makeLeafGeometry(rand),
        angle: i * 2.39996 + rand() * 0.3,            // golden angle phyllotaxis
        tilt: 1.0 - (i / n) * 0.8 + rand() * 0.08,    // outer leaves lie flatter
        order: i / n,
        size: (1.05 - (i / n) * 0.45) * (0.9 + rand() * 0.2),
      });
    }
    return out;
  }, [seed]);

  useFrame(({ clock }) => {
    const g = growthRef.current;
    const shader = material.userData.shader;
    if (shader) shader.uniforms.uStress.value = stressRef.current;
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.children.forEach((child, i) => {
      const leaf = leaves[i];
      // inner (young) leaves appear later in the cycle
      const visible = THREE.MathUtils.clamp((g * 1.25 - (1 - leaf.order) * 0.55) * 2.2, 0, 1);
      const s = (0.14 + g * 0.5) * leaf.size * visible;
      child.scale.setScalar(Math.max(s, 0.0001));
      child.rotation.set(-leaf.tilt + Math.sin(t * 0.9 + i) * 0.03, leaf.angle, 0, "YXZ");
    });
    group.current.rotation.y = Math.sin(t * 0.3 + seed) * 0.04;
  });

  return (
    <group position={[x, T2 + 0.02, z]}>
      <group ref={group}>
        {leaves.map((l, i) => (
          <mesh key={i} geometry={l.geo} material={material} castShadow />
        ))}
      </group>
    </group>
  );
}

function Roots({ x, z, seed, growthRef }: { x: number; z: number; seed: number; growthRef: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const tubes = useMemo(() => {
    const rand = seeded(seed + 101);
    return Array.from({ length: 16 }, () => {
      const pts: THREE.Vector3[] = [];
      const ang = rand() * Math.PI * 2;
      const spread = 0.03 + rand() * 0.12;
      for (let k = 0; k <= 6; k++) {
        const f = k / 6;
        pts.push(new THREE.Vector3(
          Math.cos(ang) * spread * f + (rand() - 0.5) * 0.04 * f,
          -f,
          Math.sin(ang) * spread * f + (rand() - 0.5) * 0.04 * f,
        ));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.006 + rand() * 0.006, 5, false);
    });
  }, [seed]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const g = growthRef.current;
    group.current.scale.set(1, 0.18 + g * 0.62, 1);
    group.current.rotation.z = Math.sin(clock.elapsedTime * 0.7 + seed) * 0.03;
    group.current.rotation.x = Math.cos(clock.elapsedTime * 0.5 + seed) * 0.03;
  });

  return (
    <group ref={group} position={[x, T2 - 0.08, z]}>
      {tubes.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          <meshStandardMaterial color={C.root} roughness={0.85} emissive="#2a3a3a" emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

function Plumbing() {
  const nozzleX = [-0.6, -0.2, 0.2, 0.6];
  return (
    <group>
      {/* manifold pipe in root tier */}
      <mesh position={[0, T1 + 0.12, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, W - 0.15, 16]} />
        <meshStandardMaterial color="#d9dfdc" roughness={0.4} />
      </mesh>
      {nozzleX.map((x, i) => (
        <mesh key={i} position={[x, T1 + 0.18, 0]}>
          <coneGeometry args={[0.035, 0.08, 16]} />
          <meshStandardMaterial color="#9aa6a2" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
      {/* riser from pump */}
      <mesh position={[W / 2 - 0.18, (T0 + T1) / 2 + 0.12, -0.25]}>
        <cylinderGeometry args={[0.028, 0.028, 0.9, 12]} />
        <meshStandardMaterial color="#d9dfdc" roughness={0.4} />
      </mesh>
    </group>
  );
}

function Pump({ fault, onRef }: { fault?: boolean; onRef: MutableRefObject<number> }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!lamp.current) return;
    const on = onRef.current;
    const col = fault ? new THREE.Color("#ff6b6b") : new THREE.Color("#5fd896");
    lamp.current.emissive.copy(col);
    lamp.current.emissiveIntensity = fault ? 1.5 + Math.sin(clock.elapsedTime * 8) * 1.2 : 0.3 + on * 2.2;
  });
  return (
    <group position={[W / 2 - 0.18, T0 + 0.16, -0.25]}>
      <RoundedBox args={[0.26, 0.22, 0.2]} radius={0.04}>
        <meshStandardMaterial color="#141b1d" roughness={0.5} metalness={0.3} />
      </RoundedBox>
      <mesh position={[0, 0.06, 0.105]}>
        <circleGeometry args={[0.025, 16]} />
        <meshStandardMaterial ref={lamp} color="#0a0f10" />
      </mesh>
    </group>
  );
}

function Water({ levelRef, onRef }: { levelRef: MutableRefObject<number>; onRef: MutableRefObject<number> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uAgitation: { value: 0 },
    uDeep: { value: C.water.deep }, uShallow: { value: C.water.shallow }, uGlow: { value: C.water.glow },
  }), []);
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
    uniforms.uAgitation.value = THREE.MathUtils.lerp(uniforms.uAgitation.value, onRef.current, 0.05);
    if (mesh.current) mesh.current.position.y = T0 + 0.05 + (levelRef.current / 100) * 0.72;
  });
  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[W - 0.06, D - 0.06, 64, 40]} />
      <shaderMaterial vertexShader={waterVertex} fragmentShader={waterFragment} uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
  );
}

function Mist({ onRef }: { onRef: MutableRefObject<number> }) {
  const { gl } = useThree();
  const count = 1400;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const rand = seeded(7);
    const origin = new Float32Array(count * 3);
    const dir = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const nozzles = [-0.6, -0.2, 0.2, 0.6];
    for (let i = 0; i < count; i++) {
      const nx = nozzles[i % 4];
      origin.set([nx, T1 + 0.22, 0], i * 3);
      const a = rand() * Math.PI * 2;
      const r = 0.25 + rand() * 0.45;
      dir.set([Math.cos(a) * r, 0.6 + rand() * 0.6, Math.sin(a) * r * 0.8], i * 3);
      seed[i] = rand();
    }
    g.setAttribute("position", new THREE.BufferAttribute(origin.slice(), 3));
    g.setAttribute("aOrigin", new THREE.BufferAttribute(origin, 3));
    g.setAttribute("aDir", new THREE.BufferAttribute(dir, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uIntensity: { value: 0 }, uColor: { value: C.mist }, uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
  }), [gl]);
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
    uniforms.uIntensity.value = THREE.MathUtils.lerp(uniforms.uIntensity.value, onRef.current, 0.06);
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial vertexShader={mistVertex} fragmentShader={mistFragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function GrowLight({ ledRef }: { ledRef: MutableRefObject<number> }) {
  const bar = useRef<THREE.MeshStandardMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const beamUniforms = useMemo(() => ({ uColor: { value: C.led }, uIntensity: { value: 0 } }), []);
  const sporeUniforms = useMemo(() => ({ uTime: { value: 0 }, uColor: { value: C.led }, uIntensity: { value: 0 }, uPixelRatio: { value: 1.5 } }), []);
  const spores = useMemo(() => {
    const rand = seeded(42);
    const n = 160;
    const p = new Float32Array(n * 3);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p.set([(rand() - 0.5) * (W - 0.2), T2 + 0.15 + rand() * 0.75, (rand() - 0.5) * (D - 0.2)], i * 3);
      s[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(s, 1));
    return g;
  }, []);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, T2, 0);
    return o;
  }, []);

  useFrame(({ clock }) => {
    const k = ledRef.current; // 0..1 smoothed
    if (bar.current) bar.current.emissiveIntensity = 0.25 + k * 3.2;
    if (light.current) light.current.intensity = 0.4 + k * 5;
    if (spot.current) spot.current.intensity = k * 14;
    beamUniforms.uIntensity.value = k;
    sporeUniforms.uIntensity.value = 0.3 + k;
    sporeUniforms.uTime.value = clock.elapsedTime;
  });

  return (
    <group>
      <RoundedBox args={[W - 0.3, 0.05, 0.18]} radius={0.02} position={[0, T3 - 0.07, 0]}>
        <meshStandardMaterial ref={bar} color="#2a1b3d" emissive={C.led} emissiveIntensity={1} toneMapped={false} />
      </RoundedBox>
      <pointLight ref={light} position={[0, T3 - 0.2, 0]} color={C.led} distance={3.5} decay={1.6} />
      <primitive object={target} />
      <spotLight ref={spot} position={[0, T3 - 0.1, 0]} target={target} color={C.led} angle={0.9} penumbra={0.8} distance={3} decay={1.5} />
      <mesh position={[0, (T2 + T3) / 2 - 0.02, 0]}>
        <cylinderGeometry args={[(W - 0.3) / 2, W / 2 - 0.05, T3 - T2 - 0.1, 48, 1, true]} />
        <shaderMaterial vertexShader={beamVertex} fragmentShader={beamFragment} uniforms={beamUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
      <points geometry={spores} frustumCulled={false}>
        <shaderMaterial vertexShader={sporeVertex} fragmentShader={sporeFragment} uniforms={sporeUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </points>
    </group>
  );
}

function Sensor() {
  return (
    <group position={[-W / 2 + 0.02, T2 + 0.45, D / 2 - 0.15]}>
      <RoundedBox args={[0.05, 0.16, 0.12]} radius={0.015}>
        <meshStandardMaterial color="#3b82c4" roughness={0.5} />
      </RoundedBox>
    </group>
  );
}

// ---------------------------------------------------------------- camera
function CameraRig({ focus, story, interactive }: { focus: FocusKey; story?: StoryRef; interactive: boolean }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const desiredPos = useRef(new THREE.Vector3(...CAMERA_PRESETS[focus].pos));
  const desiredTarget = useRef(new THREE.Vector3(...CAMERA_PRESETS[focus].target));
  const lookAt = useRef(new THREE.Vector3(...CAMERA_PRESETS[focus].target));
  const settle = useRef(1);
  const tmp = useRef(new THREE.Vector3());

  useEffect(() => {
    desiredPos.current.set(...CAMERA_PRESETS[focus].pos);
    desiredTarget.current.set(...CAMERA_PRESETS[focus].target);
    settle.current = 1; // animate to the new preset, then hand control back to the user
  }, [focus]);

  useFrame((_, dt) => {
    if (story) {
      // scroll-driven path: stops line up with the chapter cards on the landing page
      const stops: [number, FocusKey][] = [[0, "overview"], [0.232, "roots"], [0.458, "reservoir"], [0.685, "canopy"], [0.911, "plants"], [1, "plants"]];
      const p = THREE.MathUtils.clamp(story.current.progress, 0, 1);
      let i = 0;
      while (i < stops.length - 2 && p > stops[i + 1][0]) i++;
      const [p0, k0] = stops[i], [p1, k1] = stops[i + 1];
      const f = THREE.MathUtils.clamp((p - p0) / Math.max(p1 - p0, 1e-4), 0, 1);
      const e = f * f * (3 - 2 * f);
      const a = CAMERA_PRESETS[k0], b = CAMERA_PRESETS[k1];
      desiredPos.current.set(...a.pos).lerp(tmp.current.set(...b.pos), e);
      desiredTarget.current.set(...a.target).lerp(tmp.current.set(...b.target), e);
      camera.position.lerp(desiredPos.current, 1 - Math.pow(0.002, dt));
      lookAt.current.lerp(desiredTarget.current, 1 - Math.pow(0.002, dt));
      camera.lookAt(lookAt.current);
      return;
    }
    if (settle.current <= 0) return;
    const k = 1 - Math.pow(0.004, dt);
    camera.position.lerp(desiredPos.current, k);
    if (interactive && controls) {
      controls.target.lerp(desiredTarget.current, k);
      controls.update();
    } else {
      lookAt.current.lerp(desiredTarget.current, k);
      camera.lookAt(lookAt.current);
    }
    if (camera.position.distanceTo(desiredPos.current) < 0.01) settle.current = 0;
  });
  return null;
}

// keeps the whole chamber in frame on tall/narrow panels (phones)
function FovFit({ base }: { base: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(size.height, 1);
    cam.fov = aspect < 1.05 ? Math.min(base * Math.min(1.25 / aspect, 1.9), 62) : base;
    cam.updateProjectionMatrix();
  }, [camera, size, base]);
  return null;
}

// ---------------------------------------------------------------- scene
function Scene({ state, focus, story, interactive, hotspots, onHotspot, reduceMotion }: ChamberProps & { reduceMotion: boolean }) {
  const growthRef = useRef(state.growth);
  const stressRef = useRef(0);
  const onRef = useRef(0);
  const ledRef = useRef(state.ledPwm / 100);
  const levelRef = useRef(state.waterLevel);
  const root = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    const k = 1 - Math.pow(0.05, dt);
    // landing story: mature plants at first, then the AI chapter replays a full cycle from seedling to harvest
    const sp = story?.current.progress ?? 0;
    const storyGrowth = story ? (sp < 0.74 ? 0.72 : THREE.MathUtils.clamp(0.08 + ((sp - 0.74) / 0.17) * 0.92, 0, 1)) : null;
    growthRef.current = THREE.MathUtils.lerp(growthRef.current, storyGrowth ?? state.growth, k);
    stressRef.current = THREE.MathUtils.lerp(stressRef.current, state.health === "Act" ? 0.8 : state.health === "Watch" ? 0.35 : 0, k);
    const mistTarget = story ? (sp > 0.1 && sp < 0.36 ? 1 : 0.2) : state.mistOn ? 1 : 0;
    onRef.current = THREE.MathUtils.lerp(onRef.current, state.pumpFault ? 0 : mistTarget, k * 2);
    const ledTarget = story ? (sp > 0.55 ? 1 : 0.5) : state.ledPwm / 100;
    ledRef.current = THREE.MathUtils.lerp(ledRef.current, ledTarget, k);
    levelRef.current = THREE.MathUtils.lerp(levelRef.current, state.waterLevel, k);
    if (root.current && !interactive && !story && !reduceMotion) root.current.rotation.y += dt * 0.08;
  });

  return (
    <>
      <fog attach="fog" args={["#06090b", 7, 16]} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#bfe9ff", "#0b1210", 0.5]} />
      <directionalLight position={[4, 6, 3]} intensity={1.1} color="#e8fff4" />
      <directionalLight position={[-5, 2, -4]} intensity={0.6} color="#7fd4f0" />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2} position={[0, 5, -6]} scale={[10, 4, 1]} color="#9fe7c5" />
        <Lightformer form="rect" intensity={1.2} position={[6, 2, 2]} scale={[3, 6, 1]} color="#c9b4ff" />
      </Environment>

      <group ref={root}>
        <Frame />
        <Plumbing />
        <Pump fault={state.pumpFault} onRef={onRef} />
        <Water levelRef={levelRef} onRef={onRef} />
        <Mist onRef={onRef} />
        <GrowLight ledRef={ledRef} />
        <Sensor />
        {POTS.map(([x, z], i) => (
          <group key={i}>
            <Plant x={x} z={z} seed={i * 17 + 3} growthRef={growthRef} stressRef={stressRef} />
            <Roots x={x} z={z} seed={i * 31 + 5} growthRef={growthRef} />
          </group>
        ))}
        {/* floor glow */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <circleGeometry args={[3.2, 64]} />
          <meshBasicMaterial color="#5fd896" transparent opacity={0.035} />
        </mesh>
        {hotspots?.map((h) => (
          <Html key={h.id} position={h.position} center distanceFactor={4.6} zIndexRange={[20, 0]}>
            <button
              onClick={() => onHotspot?.(h.id)}
              className={`hotspot hotspot-${h.tone ?? "leaf"}`}
            >
              <span className="hotspot-dot" />
              <span className="hotspot-label">{h.label}</span>
              {h.value && <span className="hotspot-value">{h.value}</span>}
            </button>
          </Html>
        ))}
      </group>

      <CameraRig focus={focus ?? "overview"} story={story} interactive={!!interactive} />
      {interactive && (
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={2.2}
          maxDistance={9}
          minPolarAngle={0.35}
          maxPolarAngle={1.62}
          target={CAMERA_PRESETS[focus ?? "overview"].target}
          autoRotate={!reduceMotion}
          autoRotateSpeed={0.35}
        />
      )}
    </>
  );
}

export type ChamberProps = {
  state: ChamberState;
  focus?: FocusKey;
  story?: StoryRef;          // landing page: scroll progress drives camera, growth, light
  interactive?: boolean;     // dashboard: orbit + zoom
  hotspots?: Hotspot[];
  onHotspot?: (id: string) => void;
  active?: boolean;          // pause rendering when off-screen
  fov?: number;              // narrower = closer framing
  className?: string;
};

export default function AeroChamber(props: ChamberProps) {
  const { active = true, className } = props;
  const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const start = CAMERA_PRESETS[props.focus ?? "overview"];
  return (
    <div className={className}>
      <Canvas
        frameloop={active ? "always" : "never"}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: start.pos, fov: props.fov ?? 38, near: 0.1, far: 50 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <Suspense fallback={null}>
          <FovFit base={props.fov ?? 38} />
          <Scene {...props} reduceMotion={!!reduceMotion} />
        </Suspense>
      </Canvas>
    </div>
  );
}
