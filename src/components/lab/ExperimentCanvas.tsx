"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import {
  Html,
  Line,
  OrbitControls,
  RoundedBox,
  Sparkles,
  Stars,
} from "@react-three/drei";
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
  useSphericalJoint,
} from "@react-three/rapier";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Atom } from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import * as THREE from "three";
import type {
  CollisionScene as CollisionSceneSpec,
  DropScene as DropSceneSpec,
  ExperimentSpec,
  OrbitScene as OrbitSceneSpec,
  PendulumScene as PendulumSceneSpec,
  ProjectileScene as ProjectileSceneSpec,
  SpringScene as SpringSceneSpec,
} from "@/lib/contracts/experiment";
import {
  buildEvidence,
  collisionMetrics,
  type EvidencePoint,
  type SimulationEvidence,
} from "@/lib/physics/evidence";

type ExperimentCanvasProps = {
  spec: ExperimentSpec;
  runToken: number;
  launched: boolean;
  capturing: boolean;
  paused: boolean;
  onComplete: (evidence: SimulationEvidence) => void;
};

function evidencePointAt(points: EvidencePoint[], time: number): EvidencePoint {
  const last = points.at(-1)!;
  if (time <= points[0]!.time) return points[0]!;
  if (time >= last.time) return last;
  const upperIndex = points.findIndex((point) => point.time >= time);
  const upper = points[upperIndex]!;
  const lower = points[upperIndex - 1]!;
  const span = Math.max(upper.time - lower.time, Number.EPSILON);
  const mix = (time - lower.time) / span;
  const interpolate = (a?: number, b?: number) =>
    a === undefined || b === undefined
      ? undefined
      : THREE.MathUtils.lerp(a, b, mix);
  return {
    time,
    primary: THREE.MathUtils.lerp(lower.primary, upper.primary, mix),
    secondary: interpolate(lower.secondary, upper.secondary),
    tertiary: interpolate(lower.tertiary, upper.tertiary),
    primaryVelocity: interpolate(
      lower.primaryVelocity,
      upper.primaryVelocity,
    ),
    secondaryVelocity: interpolate(
      lower.secondaryVelocity,
      upper.secondaryVelocity,
    ),
  };
}

function playbackTime(
  elapsed: MutableRefObject<number>,
  duration: number,
  launched: boolean,
  paused: boolean,
  delta: number,
) {
  if (!launched) {
    elapsed.current = 0;
    return 0;
  }
  if (!paused) elapsed.current += Math.min(delta, 0.25);
  const screenDuration = Math.min(duration + 0.5, 6.2);
  return Math.min(duration, (elapsed.current / screenDuration) * duration);
}

function LabFloor({ span = 28 }: { span?: number }) {
  return (
    <>
      <RigidBody type="fixed" friction={0.9} restitution={0.1}>
        <CuboidCollider args={[span / 2, 0.12, 5]} position={[span / 4, -0.12, 0]} />
        <mesh receiveShadow position={[span / 4, -0.13, 0]}>
          <boxGeometry args={[span, 0.24, 10]} />
          <meshStandardMaterial color="#080d16" roughness={0.82} metalness={0.24} />
        </mesh>
      </RigidBody>
      <gridHelper args={[span, Math.max(14, span), "#1f8399", "#13212c"]} position={[span / 4, 0.01, 0]} />
    </>
  );
}

function MeasurementPylon({ x, height, label }: { x: number; height: number; label: string }) {
  return (
    <group position={[x, 0, -1.4]}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[0.035, height, 0.035]} />
        <meshStandardMaterial color="#24414f" emissive="#102d39" emissiveIntensity={0.5} />
      </mesh>
      {Array.from({ length: Math.floor(height) + 1 }, (_, index) => (
        <mesh key={index} position={[0.14, index, 0]}>
          <boxGeometry args={[0.28, 0.012, 0.025]} />
          <meshBasicMaterial color="#39748a" />
        </mesh>
      ))}
      <Html position={[0, height + 0.5, 0]} center distanceFactor={11}>
        <span className="scene-label">{label}</span>
      </Html>
    </group>
  );
}

function DropScene({ scene, launched }: { scene: DropSceneSpec; launched: boolean }) {
  return (
    <group position={[0, 0, 0]}>
      <LabFloor span={16} />
      <MeasurementPylon x={0} height={scene.height} label={`${scene.height.toFixed(0)} m`} />
      {scene.objects.map((object, index) => {
        const x = index === 0 ? -1.45 : 1.45;
        const visualRadius = Math.max(0.68, object.radius * 1.55);
        return (
          <group key={object.id}>
            <RigidBody
              type={launched ? "dynamic" : "fixed"}
              position={[x, scene.height, 0]}
              colliders={false}
              restitution={0.08}
              linearDamping={
                (scene.airDensity *
                  object.dragCoefficient *
                  object.radius ** 2 *
                  0.38) /
                Math.max(object.mass, 0.05)
              }
              canSleep
            >
              <BallCollider args={[object.radius]} />
              <mesh castShadow receiveShadow>
                <sphereGeometry args={[visualRadius, 64, 48]} />
                <meshPhysicalMaterial
                  color={object.color}
                  emissive={object.color}
                  emissiveIntensity={0.52}
                  metalness={0.5}
                  roughness={0.24}
                  clearcoat={0.75}
                />
              </mesh>
              <pointLight color={object.color} intensity={2.8} distance={4.5} />
            </RigidBody>
            <Html position={[x, scene.height + visualRadius + 0.62, 0]} center distanceFactor={10}>
              <div className="object-tag">
                <strong>{object.mass.toFixed(object.mass % 1 ? 1 : 0)} kg</strong>
                <span>{index === 0 ? "Object A" : "Object B"}</span>
              </div>
            </Html>
          </group>
        );
      })}
      <Sparkles count={scene.airDensity > 0 ? 100 : 28} scale={[7, scene.height, 5]} size={1.2} speed={0.18} color="#5de1ff" opacity={scene.airDensity > 0 ? 0.55 : 0.16} />
    </group>
  );
}

function ProjectileBody({ scene, launched }: { scene: ProjectileSceneSpec; launched: boolean }) {
  const body = useRef<RapierRigidBody>(null);
  useEffect(() => {
    if (!launched || !body.current) return;
    const angle = (scene.launch.angleDegrees * Math.PI) / 180;
    body.current.setLinvel(
      {
        x: scene.launch.speed * Math.cos(angle),
        y: scene.launch.speed * Math.sin(angle),
        z: 0,
      },
      true,
    );
  }, [launched, scene.launch.angleDegrees, scene.launch.speed]);

  return (
    <RigidBody
      ref={body}
      type={launched ? "dynamic" : "fixed"}
      position={[0, scene.launch.height + scene.object.radius, 0]}
      colliders="ball"
      linearDamping={scene.object.dragCoefficient * 0.06}
      restitution={0.32}
      canSleep
    >
      <mesh castShadow>
        <sphereGeometry args={[scene.object.radius, 40, 28]} />
        <meshPhysicalMaterial
          color={scene.object.color}
          emissive={scene.object.color}
          emissiveIntensity={0.7}
          roughness={0.18}
          metalness={0.32}
        />
      </mesh>
      <pointLight color={scene.object.color} intensity={2.6} distance={4} />
    </RigidBody>
  );
}

function ProjectileScene({ scene, launched }: { scene: ProjectileSceneSpec; launched: boolean }) {
  const angle = (scene.launch.angleDegrees * Math.PI) / 180;
  const vx = scene.launch.speed * Math.cos(angle);
  const vy = scene.launch.speed * Math.sin(angle);
  const flight = (vy + Math.sqrt(vy ** 2 + 2 * scene.gravity * scene.launch.height)) / scene.gravity;
  const range = vx * flight;
  const arc = useMemo(
    () =>
      Array.from({ length: 26 }, (_, index) => {
        const t = (flight * index) / 25;
        return new THREE.Vector3(vx * t, Math.max(0, scene.launch.height + vy * t - 0.5 * scene.gravity * t ** 2), -0.1);
      }),
    [flight, scene.gravity, scene.launch.height, vx, vy],
  );
  const target = scene.targetDistance ?? range;
  return (
    <group position={[-8, 0, 0]}>
      <LabFloor span={34} />
      <ProjectileBody scene={scene} launched={launched} />
      {!launched && <Line points={arc} color="#ff8a3d" transparent opacity={0.28} dashed dashScale={0.8} lineWidth={1.2} />}
      <group position={[target, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh castShadow>
          <torusGeometry args={[0.92, 0.12, 20, 64]} />
          <meshStandardMaterial color="#5de1ff" emissive="#5de1ff" emissiveIntensity={2.4} />
        </mesh>
        <pointLight color="#5de1ff" intensity={2} distance={5} />
      </group>
      <Html position={[target, 1.4, 0]} center distanceFactor={12}>
        <span className="scene-label">target · {target.toFixed(0)} m</span>
      </Html>
      <group position={[0, 0.6, -0.6]} rotation={[0, 0, angle]}>
        <mesh>
          <boxGeometry args={[2.3, 0.08, 0.08]} />
          <meshBasicMaterial color="#ff8a3d" transparent opacity={0.58} />
        </mesh>
      </group>
    </group>
  );
}

function DynamicPendulum({ scene }: { scene: PendulumSceneSpec }) {
  const anchor = useRef<RapierRigidBody>(null!);
  const bob = useRef<RapierRigidBody>(null!);
  const angle = (scene.releaseAngleDegrees * Math.PI) / 180;
  const x = Math.sin(angle) * scene.length;
  const y = 5.7 - Math.cos(angle) * scene.length;
  useSphericalJoint(anchor, bob, [
    [0, 0, 0],
    [0, scene.length, 0],
  ]);
  return (
    <>
      <RigidBody ref={anchor} type="fixed" colliders={false} position={[0, 5.7, 0]} />
      <RigidBody
        ref={bob}
        position={[x, y, 0]}
        colliders={false}
        linearDamping={scene.damping}
        angularDamping={scene.damping * 0.4}
        canSleep={false}
      >
        <BallCollider args={[scene.bob.radius]} />
        <mesh position={[0, scene.length / 2, 0]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, scene.length, 10]} />
          <meshStandardMaterial color="#7a9daf" metalness={0.8} roughness={0.25} />
        </mesh>
        <mesh castShadow>
          <sphereGeometry args={[scene.bob.radius, 42, 30]} />
          <meshPhysicalMaterial
            color={scene.bob.color}
            emissive={scene.bob.color}
            emissiveIntensity={0.48}
            metalness={0.48}
            roughness={0.2}
            clearcoat={0.8}
          />
        </mesh>
        <pointLight color={scene.bob.color} intensity={1.7} distance={4} />
      </RigidBody>
    </>
  );
}

function StaticPendulum({ scene }: { scene: PendulumSceneSpec }) {
  const angle = (scene.releaseAngleDegrees * Math.PI) / 180;
  const x = Math.sin(angle) * scene.length;
  const y = 5.7 - Math.cos(angle) * scene.length;
  return (
    <group>
      <Line points={[[0, 5.7, 0], [x, y, 0]]} color="#7a9daf" lineWidth={1.2} />
      <mesh position={[x, y, 0]} castShadow>
        <sphereGeometry args={[scene.bob.radius, 42, 30]} />
        <meshPhysicalMaterial color={scene.bob.color} emissive={scene.bob.color} emissiveIntensity={0.48} metalness={0.48} roughness={0.2} />
      </mesh>
    </group>
  );
}

function PendulumScene({ scene, launched }: { scene: PendulumSceneSpec; launched: boolean }) {
  return (
    <group>
      <LabFloor span={14} />
      <RoundedBox args={[5.4, 0.28, 0.4]} position={[0, 5.85, 0]} radius={0.12} castShadow>
        <meshStandardMaterial color="#1b3342" metalness={0.72} roughness={0.22} />
      </RoundedBox>
      <RoundedBox args={[0.25, 5.8, 0.3]} position={[-2.55, 2.9, 0]} radius={0.08}>
        <meshStandardMaterial color="#132531" metalness={0.64} />
      </RoundedBox>
      <RoundedBox args={[0.25, 5.8, 0.3]} position={[2.55, 2.9, 0]} radius={0.08}>
        <meshStandardMaterial color="#132531" metalness={0.64} />
      </RoundedBox>
      <mesh position={[0, 5.72, 0]}>
        <sphereGeometry args={[0.11, 22, 16]} />
        <meshStandardMaterial color="#ff8a3d" emissive="#ff8a3d" emissiveIntensity={2} />
      </mesh>
      {launched ? <DynamicPendulum scene={scene} /> : <StaticPendulum scene={scene} />}
      <Html position={[0, 6.45, 0]} center distanceFactor={11}>
        <span className="scene-label">{scene.length.toFixed(1)} m · {scene.bob.mass.toFixed(1)} kg</span>
      </Html>
    </group>
  );
}

function SpringScene({
  spec,
  scene,
  launched,
  paused,
}: {
  spec: ExperimentSpec;
  scene: SpringSceneSpec;
  launched: boolean;
  paused: boolean;
}) {
  const evidence = useMemo(() => buildEvidence(spec), [spec]);
  const elapsed = useRef(0);
  const body = useRef<THREE.Group>(null);
  const coil = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const anchorX = -4.2;
  const visualScale = 0.72;
  const coilPoints = useMemo(
    () =>
      Array.from({ length: 120 }, (_, index) => {
        const ratio = index / 119;
        const taper = Math.sin(Math.PI * ratio);
        return new THREE.Vector3(
          ratio,
          Math.sin(ratio * Math.PI * 24) * 0.25 * taper,
          Math.cos(ratio * Math.PI * 24) * 0.25 * taper,
        );
      }),
    [],
  );

  useFrame((_, delta) => {
    const time = playbackTime(
      elapsed,
      evidence.duration,
      launched,
      paused,
      delta,
    );
    const sample = evidencePointAt(evidence.points, time);
    const length = Math.max(
      0.45,
      (scene.restLength + sample.primary) * visualScale,
    );
    if (body.current) {
      body.current.position.x = anchorX + length;
      body.current.rotation.x += paused ? 0 : delta * 0.18;
      body.current.rotation.y += paused ? 0 : delta * 0.32;
    }
    if (coil.current) coil.current.scale.x = length;
    if (halo.current) {
      const pulse = 1 + 0.08 * Math.sin(time * 7);
      halo.current.scale.setScalar(pulse);
    }
  });

  const initialLength = (scene.restLength + scene.amplitude) * visualScale;
  return (
    <group position={[0, 2.6, 0]}>
      <LabFloor span={18} />
      <RoundedBox
        args={[0.58, 5.2, 2.2]}
        position={[anchorX - 0.3, 0, 0]}
        radius={0.18}
        castShadow
      >
        <meshPhysicalMaterial
          color="#101d2a"
          metalness={0.88}
          roughness={0.22}
          clearcoat={0.8}
        />
      </RoundedBox>
      <group
        ref={coil}
        position={[anchorX, 0, 0]}
        scale={[initialLength, 1, 1]}
      >
        <Line
          points={coilPoints}
          color="#63e7ff"
          lineWidth={2.2}
          transparent
          opacity={0.94}
        />
        <pointLight
          color="#5de1ff"
          intensity={4}
          distance={5}
          position={[0.5, 0, 0]}
        />
      </group>
      <group ref={body} position={[anchorX + initialLength, 0, 0]}>
        <RoundedBox args={[1.35, 1.35, 1.35]} radius={0.28} castShadow>
          <meshPhysicalMaterial
            color={scene.body.color}
            emissive={scene.body.color}
            emissiveIntensity={0.58}
            metalness={0.72}
            roughness={0.15}
            clearcoat={1}
          />
        </RoundedBox>
        <mesh ref={halo} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.02, 0.035, 12, 72]} />
          <meshBasicMaterial
            color="#ffb06f"
            transparent
            opacity={0.72}
            toneMapped={false}
          />
        </mesh>
        <pointLight color={scene.body.color} intensity={5} distance={6} />
      </group>
      <Line
        points={[
          [-4.2, -1.15, 0],
          [5.4, -1.15, 0],
        ]}
        color="#284554"
        lineWidth={2}
      />
      {Array.from({ length: 17 }, (_, index) => (
        <mesh key={index} position={[-4 + index * 0.58, -1.15, 0]}>
          <boxGeometry args={[0.025, 0.18, 0.6]} />
          <meshBasicMaterial
            color={index % 4 === 0 ? "#ff8a3d" : "#266074"}
          />
        </mesh>
      ))}
      <Html position={[0.2, 2.05, 0]} center distanceFactor={12}>
        <span className="scene-label">
          k {scene.springConstant.toFixed(0)} N/m ·{" "}
          {scene.body.mass.toFixed(1)} kg
        </span>
      </Html>
      <Sparkles
        count={55}
        scale={[11, 4, 4]}
        size={1.4}
        speed={0.22}
        color="#5de1ff"
        opacity={0.34}
      />
    </group>
  );
}

function CollisionBody({
  object,
  objectRef,
}: {
  object: CollisionSceneSpec["objects"][number];
  objectRef: RefObject<THREE.Group | null>;
}) {
  return (
    <group ref={objectRef} position={[0, 1.05, 0]}>
      <mesh castShadow>
        <sphereGeometry args={[Math.max(0.58, object.radius), 56, 40]} />
        <meshPhysicalMaterial
          color={object.color}
          emissive={object.color}
          emissiveIntensity={0.72}
          metalness={0.64}
          roughness={0.14}
          clearcoat={1}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry
          args={[Math.max(0.72, object.radius * 1.18), 0.045, 12, 72]}
        />
        <meshBasicMaterial color={object.color} toneMapped={false} />
      </mesh>
      <pointLight color={object.color} intensity={4.5} distance={5} />
    </group>
  );
}

function CollisionScene({
  spec,
  scene,
  launched,
  paused,
}: {
  spec: ExperimentSpec;
  scene: CollisionSceneSpec;
  launched: boolean;
  paused: boolean;
}) {
  const evidence = useMemo(() => buildEvidence(spec), [spec]);
  const metrics = useMemo(() => collisionMetrics(scene), [scene]);
  const elapsed = useRef(0);
  const bodyA = useRef<THREE.Group>(null);
  const bodyB = useRef<THREE.Group>(null);
  const impact = useRef<THREE.Group>(null);
  const impactMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const maximumExtent = Math.max(
    scene.trackLength / 2,
    ...evidence.points.flatMap((point) => [
      Math.abs(point.primary),
      Math.abs(point.secondary ?? 0),
    ]),
  );
  const sceneScale = Math.min(1, 7.5 / maximumExtent);

  useFrame((_, delta) => {
    const time = playbackTime(
      elapsed,
      evidence.duration,
      launched,
      paused,
      delta,
    );
    const sample = evidencePointAt(evidence.points, time);
    if (bodyA.current) {
      bodyA.current.position.x = sample.primary * sceneScale;
      bodyA.current.rotation.z -=
        paused ? 0 : delta * (sample.primaryVelocity ?? 0);
    }
    if (bodyB.current) {
      bodyB.current.position.x = (sample.secondary ?? 0) * sceneScale;
      bodyB.current.rotation.z -=
        paused ? 0 : delta * (sample.secondaryVelocity ?? 0);
    }
    const impactAge = time - metrics.collisionTime;
    const visible = impactAge >= 0 && impactAge < 0.65;
    if (impact.current) {
      impact.current.visible = visible;
      impact.current.scale.setScalar(0.4 + Math.max(0, impactAge) * 3.8);
    }
    if (impactMaterial.current) {
      impactMaterial.current.opacity = visible
        ? Math.max(0, 0.9 - impactAge * 1.3)
        : 0;
    }
  });

  return (
    <group>
      <LabFloor span={20} />
      <RoundedBox
        args={[17, 0.25, 1.55]}
        position={[0, 0.25, 0]}
        radius={0.12}
        castShadow
      >
        <meshPhysicalMaterial
          color="#0c1a25"
          metalness={0.86}
          roughness={0.2}
          clearcoat={0.6}
        />
      </RoundedBox>
      <Line
        points={[
          [-8.2, 0.48, -0.54],
          [8.2, 0.48, -0.54],
        ]}
        color="#267287"
        lineWidth={2}
      />
      <Line
        points={[
          [-8.2, 0.48, 0.54],
          [8.2, 0.48, 0.54],
        ]}
        color="#267287"
        lineWidth={2}
      />
      <CollisionBody object={scene.objects[0]} objectRef={bodyA} />
      <CollisionBody object={scene.objects[1]} objectRef={bodyB} />
      <group ref={impact} visible={false} position={[0, 1.05, 0]}>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <ringGeometry args={[0.55, 0.68, 64]} />
          <meshBasicMaterial
            ref={impactMaterial}
            color="#fff1d2"
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
        <pointLight color="#fff0be" intensity={8} distance={6} />
      </group>
      <Html position={[0, 3.25, 0]} center distanceFactor={12}>
        <span className="scene-label">
          momentum rail · restitution {scene.restitution.toFixed(2)}
        </span>
      </Html>
      <Sparkles
        count={48}
        scale={[18, 4, 5]}
        size={1.1}
        speed={0.3}
        color="#a8f3ff"
        opacity={0.3}
      />
    </group>
  );
}

function OrbitScene({
  spec,
  scene,
  launched,
  paused,
}: {
  spec: ExperimentSpec;
  scene: OrbitSceneSpec;
  launched: boolean;
  paused: boolean;
}) {
  const evidence = useMemo(() => buildEvidence(spec), [spec]);
  const elapsed = useRef(0);
  const satellite = useRef<THREE.Group>(null);
  const planet = useRef<THREE.Group>(null);
  const trajectoryScale = 5.25 / scene.orbitalRadius;
  const mapPosition = useCallback(
    (x: number, z: number): [number, number, number] => {
      const vector = new THREE.Vector2(
        x * trajectoryScale,
        z * trajectoryScale,
      );
      if (vector.length() > 8) vector.setLength(8);
      return [vector.x, 0.28, vector.y];
    },
    [trajectoryScale],
  );
  const path = useMemo(
    () =>
      evidence.points.map((point) =>
        mapPosition(point.primary, point.secondary ?? 0),
      ),
    [evidence.points, mapPosition],
  );
  const planetRadius = Math.max(
    0.8,
    Math.min(1.65, scene.centralRadius * trajectoryScale * 0.72),
  );

  useFrame((_, delta) => {
    const time = playbackTime(
      elapsed,
      evidence.duration,
      launched,
      paused,
      delta,
    );
    const sample = evidencePointAt(evidence.points, time);
    if (satellite.current) {
      satellite.current.position.set(
        ...mapPosition(sample.primary, sample.secondary ?? 0),
      );
      satellite.current.rotation.y += paused ? 0 : delta * 1.25;
      satellite.current.rotation.z += paused ? 0 : delta * 0.35;
    }
    if (planet.current && !paused) planet.current.rotation.y += delta * 0.08;
  });

  return (
    <group rotation={[0.08, 0, -0.08]}>
      <Stars
        radius={70}
        depth={34}
        count={1800}
        factor={3}
        saturation={0.35}
        fade
        speed={0.35}
      />
      <group ref={planet}>
        <mesh castShadow>
          <sphereGeometry args={[planetRadius, 72, 48]} />
          <meshPhysicalMaterial
            color="#0a4167"
            emissive="#0a7f9f"
            emissiveIntensity={0.42}
            roughness={0.6}
            metalness={0.08}
            clearcoat={0.42}
          />
        </mesh>
        <mesh scale={1.09}>
          <sphereGeometry args={[planetRadius, 64, 40]} />
          <meshBasicMaterial
            color="#45ddff"
            transparent
            opacity={0.14}
            side={THREE.BackSide}
            toneMapped={false}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2.25, 0, 0]}>
          <torusGeometry args={[planetRadius * 1.35, 0.025, 12, 120]} />
          <meshBasicMaterial
            color="#52dfff"
            transparent
            opacity={0.34}
            toneMapped={false}
          />
        </mesh>
        <pointLight color="#63dcff" intensity={8} distance={11} />
      </group>
      <Line
        points={path}
        color="#77ffc4"
        lineWidth={1.8}
        transparent
        opacity={launched ? 0.46 : 0.8}
      />
      <group
        ref={satellite}
        position={mapPosition(scene.orbitalRadius, 0)}
      >
        <mesh castShadow>
          <octahedronGeometry args={[0.34, 1]} />
          <meshPhysicalMaterial
            color={scene.satellite.color}
            emissive={scene.satellite.color}
            emissiveIntensity={0.8}
            metalness={0.78}
            roughness={0.14}
            clearcoat={1}
          />
        </mesh>
        <RoundedBox args={[1.45, 0.12, 0.58]} radius={0.04}>
          <meshStandardMaterial
            color="#184b72"
            emissive="#1f81ae"
            emissiveIntensity={0.58}
            metalness={0.64}
            roughness={0.24}
          />
        </RoundedBox>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.55, 0.025, 10, 64]} />
          <meshBasicMaterial color="#b3ffe1" toneMapped={false} />
        </mesh>
        <pointLight color={scene.satellite.color} intensity={5} distance={5} />
      </group>
      <Html position={[0, 3.25, 0]} center distanceFactor={12}>
        <span className="scene-label">
          orbital telemetry · {scene.initialSpeed.toFixed(1)} m/s
        </span>
      </Html>
    </group>
  );
}

function SimulationTimer({
  active,
  spec,
  onComplete,
}: {
  active: boolean;
  spec: ExperimentSpec;
  onComplete: (evidence: SimulationEvidence) => void;
}) {
  const elapsed = useRef(0);
  const completed = useRef(false);
  const evidence = useMemo(() => buildEvidence(spec), [spec]);
  useEffect(() => {
    elapsed.current = 0;
    completed.current = false;
  }, [spec.id, spec.scene]);
  useFrame((_, delta) => {
    if (!active || completed.current) return;
    // Keep the experiment tied to real elapsed time on software-rendered or
    // low-power GPUs. A small cap still prevents a long background-tab pause
    // from instantly skipping the observation when the learner returns.
    elapsed.current += Math.min(delta, 0.25);
    if (elapsed.current >= Math.min(evidence.duration + 0.5, 6.2)) {
      completed.current = true;
      onComplete(evidence);
    }
  });
  return null;
}

function SceneReady({ onReady }: { onReady: () => void }) {
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current) return;
    reported.current = true;
    onReady();
  });
  return null;
}

function World({
  spec,
  launched,
  capturing,
  paused,
  onComplete,
  onReady,
}: Omit<ExperimentCanvasProps, "runToken"> & { onReady: () => void }) {
  const gravity: [number, number, number] =
    "gravity" in spec.scene ? [0, -spec.scene.gravity, 0] : [0, 0, 0];
  return (
    <>
      <color attach="background" args={["#050810"]} />
      <fog attach="fog" args={["#050810", 16, 46]} />
      <ambientLight intensity={0.7} color="#7ea8c0" />
      <directionalLight castShadow position={[7, 13, 8]} intensity={2.4} color="#d9f3ff" shadow-mapSize={[1024, 1024]} />
      <spotLight position={[-8, 10, 3]} intensity={90} angle={0.34} penumbra={0.8} color="#ff7138" />
      <spotLight position={[8, 9, -4]} intensity={70} angle={0.38} penumbra={0.85} color="#42d9ff" />
      <Suspense fallback={null}>
        <Physics gravity={gravity} timeStep={1 / 60} interpolate colliders={false} paused={paused}>
          {spec.scene.family === "drop" && <DropScene scene={spec.scene} launched={launched} />}
          {spec.scene.family === "projectile" && <ProjectileScene scene={spec.scene} launched={launched} />}
          {spec.scene.family === "pendulum" && <PendulumScene scene={spec.scene} launched={launched} />}
          {spec.scene.family === "spring" && (
            <SpringScene
              spec={spec}
              scene={spec.scene}
              launched={launched}
              paused={paused}
            />
          )}
          {spec.scene.family === "collision" && (
            <CollisionScene
              spec={spec}
              scene={spec.scene}
              launched={launched}
              paused={paused}
            />
          )}
          {spec.scene.family === "orbit" && (
            <OrbitScene
              spec={spec}
              scene={spec.scene}
              launched={launched}
              paused={paused}
            />
          )}
          <SimulationTimer active={capturing && !paused} spec={spec} onComplete={onComplete} />
          <SceneReady onReady={onReady} />
        </Physics>
      </Suspense>
      <EffectComposer multisampling={0}>
        <Bloom
          mipmapBlur
          intensity={0.72}
          luminanceThreshold={0.72}
          luminanceSmoothing={0.3}
        />
        <Vignette eskil={false} offset={0.18} darkness={0.58} />
      </EffectComposer>
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={7}
        maxDistance={28}
        minPolarAngle={Math.PI * 0.18}
        maxPolarAngle={Math.PI * 0.48}
        target={
          spec.scene.family === "projectile"
            ? [3, 2.5, 0]
            : spec.scene.family === "drop"
              ? [0, 4.25, 0]
              : spec.scene.family === "pendulum"
                ? [0, 3, 0]
                : spec.scene.family === "spring"
                  ? [-1.45, 2.4, 0]
                  : [0, 0.7, 0]
        }
      />
    </>
  );
}

export function ExperimentCanvas({ spec, runToken, launched, capturing, paused, onComplete }: ExperimentCanvasProps) {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const supported = Boolean(
      canvas.getContext("webgl2") || canvas.getContext("webgl"),
    );
    setWebglSupported(supported);
  }, []);

  useEffect(() => {
    setSceneReady(false);
  }, [spec.id]);

  if (webglSupported === null) {
    return (
      <div className="canvas-loading" role="status">
        <Atom className="loading-atom" size={34} aria-hidden="true" />
        <p>Checking the 3D laboratory</p>
      </div>
    );
  }

  if (!webglSupported) {
    return (
      <div className="canvas-fallback" role="alert">
        <strong>This browser cannot open the 3D laboratory.</strong>
        <p>Enable hardware acceleration or open Counterfactual Lab in a WebGL-capable browser.</p>
      </div>
    );
  }

  const camera =
    spec.scene.family === "projectile"
      ? ({ position: [5, 8, 18], fov: 46 } as const)
      : spec.scene.family === "drop"
        ? ({ position: [6.3, 6.4, 11.4], fov: 37 } as const)
        : spec.scene.family === "orbit"
          ? ({ position: [8.5, 8.2, 11.8], fov: 46 } as const)
          : spec.scene.family === "collision"
            ? ({ position: [9, 6.2, 14], fov: 43 } as const)
            : spec.scene.family === "spring"
              ? ({ position: [5.2, 5.3, 9.6], fov: 40 } as const)
              : ({ position: [8, 7, 13], fov: 44 } as const);
  return (
    <>
      <Canvas
        className="experiment-canvas"
        dpr={[1, 1.5]}
        camera={camera}
        shadows="percentage"
        gl={{ antialias: true, powerPreference: "high-performance" }}
        aria-label={`Interactive 3D simulation: ${spec.title}`}
      >
        <World
          key={`${spec.id}-${runToken}-${launched ? "live" : "ready"}`}
          spec={spec}
          launched={launched}
          capturing={capturing}
          paused={paused}
          onComplete={onComplete}
          onReady={() => setSceneReady(true)}
        />
      </Canvas>
      {!sceneReady && (
        <div className="canvas-loading" role="status">
          <Atom className="loading-atom" size={34} aria-hidden="true" />
          <p>Calibrating the physics world</p>
        </div>
      )}
    </>
  );
}
