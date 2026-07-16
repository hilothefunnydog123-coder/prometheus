"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls, RoundedBox, Sparkles } from "@react-three/drei";
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
  useSphericalJoint,
} from "@react-three/rapier";
import { Atom } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type {
  DropScene as DropSceneSpec,
  ExperimentSpec,
  PendulumScene as PendulumSceneSpec,
  ProjectileScene as ProjectileSceneSpec,
  SandboxScene as SandboxSceneSpec,
} from "@/lib/contracts/experiment";
import { buildEvidence, type SimulationEvidence } from "@/lib/physics/evidence";
import { simulateSandbox, type SandboxTrajectory } from "@/lib/physics/sandbox";

type ExperimentCanvasProps = {
  spec: ExperimentSpec;
  runToken: number;
  launched: boolean;
  capturing: boolean;
  paused: boolean;
  onComplete: (evidence: SimulationEvidence) => void;
};

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

/** Camera + look-at target framing the sandbox's initial layout and floor. */
function sandboxFraming(scene: SandboxSceneSpec) {
  const xs = scene.bodies.map((body) => body.position.x);
  const ys = scene.bodies.map((body) => body.position.y);
  if (scene.hasFloor) ys.push(0);
  if (scene.centralGravity > 0) {
    xs.push(0);
    ys.push(0);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const spread = Math.max(maxX - minX, maxY - minY, 6);
  const distance = spread * 1.45 + 9;
  return {
    camera: {
      position: [centerX + spread * 0.12, centerY + spread * 0.12, distance] as [
        number,
        number,
        number,
      ],
      fov: 46,
    },
    target: [centerX, centerY, 0] as [number, number, number],
  };
}

function sampleTrajectory(trajectory: SandboxTrajectory, time: number) {
  const frames = trajectory.frames;
  const clamped = Math.max(0, Math.min(time, trajectory.duration));
  const position =
    trajectory.duration > 0
      ? (clamped / trajectory.duration) * (frames.length - 1)
      : 0;
  const lower = Math.floor(position);
  const upper = Math.min(frames.length - 1, lower + 1);
  const blend = position - lower;
  return frames[lower]!.bodies.map((body, index) => {
    const next = frames[upper]!.bodies[index]!;
    return {
      x: body.x + (next.x - body.x) * blend,
      y: body.y + (next.y - body.y) * blend,
    };
  });
}

const SANDBOX_UP = new THREE.Vector3(0, 1, 0);

function SandboxScene({
  spec,
  scene,
  launched,
  capturing,
  paused,
  onComplete,
}: {
  spec: ExperimentSpec;
  scene: SandboxSceneSpec;
  launched: boolean;
  capturing: boolean;
  paused: boolean;
  onComplete: (evidence: SimulationEvidence) => void;
}) {
  const trajectory = useMemo(() => simulateSandbox(scene), [scene]);
  const evidence = useMemo(() => buildEvidence(spec), [spec]);
  const bodyRefs = useRef<(THREE.Group | null)[]>([]);
  const springRefs = useRef<(THREE.Object3D | null)[]>([]);
  const elapsed = useRef(0);
  const completed = useRef(false);
  const midpoint = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const bodyIndexById = useMemo(() => {
    const map = new Map<string, number>();
    scene.bodies.forEach((body, index) => map.set(body.id, index));
    return map;
  }, [scene]);

  // The animation plays the exact server trajectory, time-scaled so even a
  // 20 s experiment resolves within a few seconds of wall-clock.
  const wallSeconds = Math.min(trajectory.duration, 8);
  const rate = trajectory.duration / wallSeconds;

  useEffect(() => {
    elapsed.current = 0;
    completed.current = false;
  }, [scene]);

  useFrame((_, delta) => {
    if (capturing && !paused && !completed.current) {
      elapsed.current = Math.min(
        elapsed.current + Math.min(delta, 0.05) * rate,
        trajectory.duration,
      );
    }
    const time = capturing ? elapsed.current : 0;
    const positions = sampleTrajectory(trajectory, time);
    for (let i = 0; i < positions.length; i += 1) {
      const group = bodyRefs.current[i];
      if (group) group.position.set(positions[i]!.x, positions[i]!.y, 0);
    }
    scene.springs.forEach((spring, index) => {
      const mesh = springRefs.current[index];
      if (!mesh) return;
      const a = bodyIndexById.get(spring.bodyA);
      if (a === undefined) return;
      const start = positions[a]!;
      const end =
        spring.bodyB === null
          ? spring.anchor
          : (() => {
              const b = bodyIndexById.get(spring.bodyB!);
              return b === undefined ? spring.anchor : positions[b]!;
            })();
      direction.current.set(end.x - start.x, end.y - start.y, 0);
      const length = Math.max(direction.current.length(), 1e-4);
      midpoint.current.set((start.x + end.x) / 2, (start.y + end.y) / 2, 0);
      mesh.position.copy(midpoint.current);
      mesh.scale.set(1, length, 1);
      mesh.quaternion.setFromUnitVectors(
        SANDBOX_UP,
        direction.current.divideScalar(length),
      );
    });
    if (
      capturing &&
      !completed.current &&
      elapsed.current >= trajectory.duration - 1e-6
    ) {
      completed.current = true;
      onComplete(evidence);
    }
  });

  const initial = sampleTrajectory(trajectory, launched ? 0 : 0);

  return (
    <group>
      {scene.hasFloor && (
        <>
          <mesh receiveShadow position={[0, -0.12, 0]}>
            <boxGeometry args={[60, 0.24, 12]} />
            <meshStandardMaterial color="#080d16" roughness={0.82} metalness={0.24} />
          </mesh>
          <gridHelper args={[60, 40, "#1f8399", "#13212c"]} position={[0, 0.01, 0]} />
        </>
      )}
      {scene.centralGravity > 0 && (
        <group>
          <mesh>
            <sphereGeometry args={[0.55, 32, 24]} />
            <meshStandardMaterial color="#ffce6b" emissive="#ff8a3d" emissiveIntensity={1.6} />
          </mesh>
          <pointLight color="#ffb15c" intensity={5} distance={40} />
        </group>
      )}
      {scene.springs.map((spring, index) => (
        <mesh
          key={spring.id}
          ref={(element) => {
            springRefs.current[index] = element;
          }}
        >
          <cylinderGeometry args={[0.05, 0.05, 1, 10]} />
          <meshStandardMaterial color="#7a9daf" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
      {scene.bodies.map((body, index) => {
        const visualRadius = Math.max(0.3, body.radius);
        return (
          <group
            key={body.id}
            ref={(element) => {
              bodyRefs.current[index] = element;
            }}
            position={[initial[index]!.x, initial[index]!.y, 0]}
          >
            <mesh castShadow receiveShadow>
              <sphereGeometry args={[visualRadius, 48, 36]} />
              {body.fixed ? (
                <meshStandardMaterial color={body.color} metalness={0.85} roughness={0.28} />
              ) : (
                <meshPhysicalMaterial
                  color={body.color}
                  emissive={body.color}
                  emissiveIntensity={0.5}
                  metalness={0.5}
                  roughness={0.24}
                  clearcoat={0.7}
                />
              )}
            </mesh>
            {!body.fixed && <pointLight color={body.color} intensity={2.1} distance={4.5} />}
            <Html position={[0, visualRadius + 0.55, 0]} center distanceFactor={12}>
              <div className="object-tag">
                <strong>{body.label}</strong>
                <span>{body.mass.toFixed(body.mass % 1 ? 1 : 0)} kg</span>
              </div>
            </Html>
          </group>
        );
      })}
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
  return (
    <>
      <color attach="background" args={["#050810"]} />
      <fog attach="fog" args={["#050810", 16, 46]} />
      <ambientLight intensity={0.7} color="#7ea8c0" />
      <directionalLight castShadow position={[7, 13, 8]} intensity={2.4} color="#d9f3ff" shadow-mapSize={[1024, 1024]} />
      <spotLight position={[-8, 10, 3]} intensity={90} angle={0.34} penumbra={0.8} color="#ff7138" />
      <spotLight position={[8, 9, -4]} intensity={70} angle={0.38} penumbra={0.85} color="#42d9ff" />
      <Suspense fallback={null}>
        <Physics gravity={[0, -spec.scene.gravity, 0]} timeStep={1 / 60} interpolate colliders={false} paused={paused}>
          {spec.scene.family === "drop" && <DropScene scene={spec.scene} launched={launched} />}
          {spec.scene.family === "projectile" && <ProjectileScene scene={spec.scene} launched={launched} />}
          {spec.scene.family === "pendulum" && <PendulumScene scene={spec.scene} launched={launched} />}
          {spec.scene.family === "sandbox" && (
            <SandboxScene
              spec={spec}
              scene={spec.scene}
              launched={launched}
              capturing={capturing}
              paused={paused}
              onComplete={onComplete}
            />
          )}
          {spec.scene.family !== "sandbox" && (
            <SimulationTimer active={capturing && !paused} spec={spec} onComplete={onComplete} />
          )}
          <SceneReady onReady={onReady} />
        </Physics>
      </Suspense>
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={7}
        maxDistance={28}
        minPolarAngle={Math.PI * 0.18}
        maxPolarAngle={Math.PI * 0.48}
        target={
          spec.scene.family === "sandbox"
            ? sandboxFraming(spec.scene).target
            : spec.scene.family === "projectile"
              ? [3, 2.5, 0]
              : spec.scene.family === "drop"
                ? [0, 4.25, 0]
                : [0, 3, 0]
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
    spec.scene.family === "sandbox"
      ? sandboxFraming(spec.scene).camera
      : spec.scene.family === "projectile"
        ? ({ position: [5, 8, 18], fov: 46 } as const)
        : spec.scene.family === "drop"
          ? ({ position: [6.3, 6.4, 11.4], fov: 37 } as const)
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
