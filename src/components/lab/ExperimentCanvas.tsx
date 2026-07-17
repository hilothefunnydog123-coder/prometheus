"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Html,
  Line,
  OrbitControls,
  RoundedBox,
  Sparkles,
  Stars,
  Trail,
} from "@react-three/drei";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  type RapierRigidBody,
  useSphericalJoint,
} from "@react-three/rapier";
import { Atom } from "lucide-react";
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementRef,
  type ReactElement,
  type RefObject,
} from "react";
import * as THREE from "three";
import type {
  DropScene as DropSceneSpec,
  ExperimentSpec,
  PendulumScene as PendulumSceneSpec,
  ProjectileScene as ProjectileSceneSpec,
  SandboxScene as SandboxSceneSpec,
} from "@/lib/contracts/experiment";
import {
  buildEvidence,
  type EvidencePoint,
  type SimulationEvidence,
} from "@/lib/physics/evidence";
import { simulateSandbox, type SandboxTrajectory } from "@/lib/physics/sandbox";

export type CameraCommand = {
  type: "zoom-in" | "zoom-out" | "reset";
  token: number;
};

type ExperimentCanvasProps = {
  spec: ExperimentSpec;
  runToken: number;
  launched: boolean;
  capturing: boolean;
  paused: boolean;
  showOutcomeGuides: boolean;
  cameraCommand: CameraCommand;
  onComplete: (evidence: SimulationEvidence) => void;
};

type VectorTuple = readonly [number, number, number];

type VisualProfile = {
  reducedMotion: boolean;
  quality: "full" | "balanced";
  showTelemetry: boolean;
};

type NavigatorWithDeviceHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

function useVisualProfile(): VisualProfile {
  const [profile, setProfile] = useState<VisualProfile>({
    reducedMotion: false,
    quality: "full",
    showTelemetry: true,
  });

  useEffect(() => {
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const update = () => {
      const device = navigator as NavigatorWithDeviceHints;
      const reducedMotion = reducedMotionQuery.matches;
      const compactViewport = window.innerWidth < 900;
      const constrainedDevice =
        (device.hardwareConcurrency > 0 && device.hardwareConcurrency <= 4) ||
        (typeof device.deviceMemory === "number" && device.deviceMemory <= 4) ||
        Boolean(device.connection?.saveData);
      setProfile({
        reducedMotion,
        quality:
          reducedMotion || compactViewport || constrainedDevice
            ? "balanced"
            : "full",
        showTelemetry: !reducedMotion && window.innerWidth >= 1440,
      });
    };
    update();
    reducedMotionQuery.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      reducedMotionQuery.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return profile;
}

function MotionTrail({
  enabled,
  width,
  length,
  color,
  children,
}: {
  enabled: boolean;
  width: number;
  length: number;
  color: string;
  children: ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Trail
      width={width}
      length={length}
      color={color}
      attenuation={(trailWidth) => trailWidth * trailWidth}
    >
      {children}
    </Trail>
  );
}

function InteractiveCameraControls({
  position,
  target,
  command,
}: {
  position: VectorTuple;
  target: VectorTuple;
  command: CameraCommand;
}) {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const appliedCommandToken = useRef<number | null>(null);
  const appliedFraming = useRef("");
  const { camera, size } = useThree();

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const aspect = size.width / Math.max(size.height, 1);
    const responsiveDistanceScale = Math.max(1, 1.45 / aspect);
    const framingKey = `${position.join(",")}|${target.join(",")}|${responsiveDistanceScale.toFixed(3)}`;
    const framingChanged = appliedFraming.current !== framingKey;
    const commandChanged = appliedCommandToken.current !== command.token;
    if (!framingChanged && !commandChanged) return;

    if (framingChanged || command.type === "reset") {
      const responsivePosition = new THREE.Vector3(
        position[0],
        position[1],
        position[2],
      );
      const responsiveTarget = new THREE.Vector3(
        target[0],
        target[1],
        target[2],
      );
      responsivePosition
        .sub(responsiveTarget)
        .multiplyScalar(responsiveDistanceScale)
        .add(responsiveTarget);
      camera.position.copy(responsivePosition);
      orbit.target.set(target[0], target[1], target[2]);
    } else {
      const offset = camera.position.clone().sub(orbit.target);
      const currentDistance = offset.length();
      const multiplier = command.type === "zoom-in" ? 0.78 : 1.28;
      const nextDistance = THREE.MathUtils.clamp(
        currentDistance * multiplier,
        2.5,
        48,
      );
      if (currentDistance > 0.001) {
        offset.setLength(nextDistance);
        camera.position.copy(orbit.target).add(offset);
      }
    }

    camera.updateProjectionMatrix();
    orbit.update();
    appliedFraming.current = framingKey;
    appliedCommandToken.current = command.token;
  }, [
    camera,
    command.token,
    command.type,
    position,
    size.height,
    size.width,
    target,
  ]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      screenSpacePanning
      zoomToCursor
      zoomSpeed={0.9}
      panSpeed={0.8}
      rotateSpeed={0.65}
      minDistance={2.5}
      maxDistance={48}
      minPolarAngle={Math.PI * 0.12}
      maxPolarAngle={Math.PI * 0.49}
      target={target}
    />
  );
}

function LabFloor({ span = 28 }: { span?: number }) {
  return (
    <>
      <RigidBody type="fixed" friction={0.9} restitution={0.1}>
        <CuboidCollider args={[span / 2, 0.12, 5]} position={[span / 4, -0.12, 0]} />
        {/* Dark near-mirror deck: low roughness picks up the key/rim spots as
            long streaked reflections under the falling bodies. */}
        <mesh receiveShadow position={[span / 4, -0.13, 0]}>
          <boxGeometry args={[span, 0.24, 12]} />
          <meshStandardMaterial
            color="#060a12"
            roughness={0.38}
            metalness={0.62}
            envMapIntensity={0.6}
          />
        </mesh>
      </RigidBody>
      {/* Two offset grids (fine + coarse accent) give the floor depth. */}
      <gridHelper args={[span, Math.max(28, span * 2), "#2a6f86", "#101d28"]} position={[span / 4, 0.011, 0]} />
      <gridHelper args={[span, Math.max(7, Math.round(span / 2)), "#3f9fbf", "#101d28"]} position={[span / 4, 0.012, 0]} />
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

function DropScene({
  scene,
  launched,
  motionEffects,
}: {
  scene: DropSceneSpec;
  launched: boolean;
  motionEffects: boolean;
}) {
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
              {/* Glowing motion ribbon: the bloom pass turns the trail into
                  a light streak tracing the fall in real time. */}
              <MotionTrail
                enabled={motionEffects}
                width={2.4}
                length={5}
                color={object.color}
              >
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
              </MotionTrail>
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
      <Sparkles
        count={motionEffects ? (scene.airDensity > 0 ? 72 : 22) : 12}
        scale={[7, scene.height, 5]}
        size={1.2}
        speed={motionEffects ? 0.18 : 0}
        color="#5de1ff"
        opacity={scene.airDensity > 0 ? 0.55 : 0.16}
      />
    </group>
  );
}

function ProjectileBody({
  scene,
  launched,
  motionEffects,
}: {
  scene: ProjectileSceneSpec;
  launched: boolean;
  motionEffects: boolean;
}) {
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
      {/* Comet streak: the projectile drags a bloom-lit ribbon along its arc. */}
      <MotionTrail
        enabled={motionEffects}
        width={3.2}
        length={7}
        color={scene.object.color}
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
      </MotionTrail>
      <pointLight color={scene.object.color} intensity={2.6} distance={4} />
    </RigidBody>
  );
}

function ProjectileScene({
  scene,
  launched,
  showOutcomeGuides,
  motionEffects,
}: {
  scene: ProjectileSceneSpec;
  launched: boolean;
  showOutcomeGuides: boolean;
  motionEffects: boolean;
}) {
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
      <ProjectileBody
        scene={scene}
        launched={launched}
        motionEffects={motionEffects}
      />
      {showOutcomeGuides && <Line points={arc} color="#ff8a3d" transparent opacity={0.28} dashed dashScale={0.8} lineWidth={1.2} />}
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

function DynamicPendulum({
  scene,
  motionEffects,
}: {
  scene: PendulumSceneSpec;
  motionEffects: boolean;
}) {
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
        {/* Pendulum bob paints its swing arc as a fading light ribbon. */}
        <MotionTrail
          enabled={motionEffects}
          width={2.2}
          length={6}
          color={scene.bob.color}
        >
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
        </MotionTrail>
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

function PendulumScene({
  scene,
  launched,
  motionEffects,
}: {
  scene: PendulumSceneSpec;
  launched: boolean;
  motionEffects: boolean;
}) {
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
      {launched ? (
        <DynamicPendulum scene={scene} motionEffects={motionEffects} />
      ) : (
        <StaticPendulum scene={scene} />
      )}
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

function experimentFraming(spec: ExperimentSpec) {
  if (spec.scene.family === "sandbox") {
    const framing = sandboxFraming(spec.scene);
    return {
      position: framing.camera.position as VectorTuple,
      target: framing.target as VectorTuple,
      fov: framing.camera.fov,
    };
  }
  if (spec.scene.family === "projectile") {
    return {
      position: [5, 8, 18] as VectorTuple,
      target: [3, 2.5, 0] as VectorTuple,
      fov: 46,
    };
  }
  if (spec.scene.family === "drop") {
    return {
      position: [6.3, 6.4, 11.4] as VectorTuple,
      target: [0, 4.25, 0] as VectorTuple,
      fov: 37,
    };
  }
  return {
    position: [8, 7, 13] as VectorTuple,
    target: [0, 3, 0] as VectorTuple,
    fov: 44,
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
  motionEffects,
  onComplete,
}: {
  spec: ExperimentSpec;
  scene: SandboxSceneSpec;
  launched: boolean;
  capturing: boolean;
  paused: boolean;
  motionEffects: boolean;
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
            {body.fixed ? (
              <mesh castShadow receiveShadow>
                <sphereGeometry args={[visualRadius, 48, 36]} />
                <meshStandardMaterial color={body.color} metalness={0.85} roughness={0.28} />
              </mesh>
            ) : (
              /* Every free body traces its trajectory as a glowing ribbon. */
              <MotionTrail
                enabled={motionEffects}
                width={2.6}
                length={6}
                color={body.color}
              >
                <mesh castShadow receiveShadow>
                  <sphereGeometry args={[visualRadius, 48, 36]} />
                  <meshPhysicalMaterial
                    color={body.color}
                    emissive={body.color}
                    emissiveIntensity={0.5}
                    metalness={0.5}
                    roughness={0.24}
                    clearcoat={0.7}
                  />
                </mesh>
              </MotionTrail>
            )}
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

/**
 * Live telemetry: a shared clock written inside the render loop and read by
 * a DOM overlay. All streaming happens through refs and direct DOM writes so
 * the 60 Hz feed never triggers a React render.
 */
type TelemetryClock = { t: number; running: boolean };

type TelemetryChannelKey =
  | "primary"
  | "secondary"
  | "tertiary"
  | "primaryVelocity"
  | "secondaryVelocity";

type TelemetryChannel = {
  key: TelemetryChannelKey;
  label: string;
  unit: string;
  color: string;
};

function telemetryChannels(spec: ExperimentSpec): TelemetryChannel[] {
  const scene = spec.scene;
  if (scene.family === "drop") {
    const [a, b] = scene.objects;
    return [
      { key: "primary", label: "ALT A", unit: "m", color: a.color },
      { key: "secondary", label: "ALT B", unit: "m", color: b.color },
      { key: "primaryVelocity", label: "VEL A", unit: "m/s", color: a.color },
      { key: "secondaryVelocity", label: "VEL B", unit: "m/s", color: b.color },
    ];
  }
  if (scene.family === "projectile") {
    return [
      { key: "primary", label: "X POS", unit: "m", color: scene.object.color },
      { key: "secondary", label: "ALT", unit: "m", color: "#5de1ff" },
      { key: "tertiary", label: "SPEED", unit: "m/s", color: "#ff8a3d" },
    ];
  }
  if (scene.family === "pendulum") {
    return [
      { key: "primary", label: "θ ANGLE", unit: "deg", color: scene.bob.color },
      { key: "secondary", label: "ARC VEL", unit: "m/s", color: "#5de1ff" },
      { key: "tertiary", label: "ΣE MECH", unit: "J", color: "#ff8a3d" },
    ];
  }
  // Sandbox evidence tracks the first two declared bodies.
  const [first, second] = scene.bodies;
  if (!first) return [];
  if (second) {
    return [
      { key: "primary", label: `${first.label} Y`.toUpperCase(), unit: "m", color: first.color },
      { key: "secondary", label: `${second.label} Y`.toUpperCase(), unit: "m", color: second.color },
      { key: "primaryVelocity", label: "VEL 1", unit: "m/s", color: first.color },
      { key: "secondaryVelocity", label: "VEL 2", unit: "m/s", color: second.color },
    ];
  }
  return [
    { key: "primary", label: `${first.label} Y`.toUpperCase(), unit: "m", color: first.color },
    { key: "secondary", label: "SPEED", unit: "m/s", color: "#5de1ff" },
  ];
}

function channelNumber(point: EvidencePoint, key: TelemetryChannelKey) {
  const value = point[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function channelValueAt(
  points: EvidencePoint[],
  key: TelemetryChannelKey,
  t: number,
) {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  if (t <= first.time) return channelNumber(first, key);
  if (t >= last.time) return channelNumber(last, key);
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (points[mid]!.time <= t) low = mid;
    else high = mid;
  }
  const before = points[low]!;
  const after = points[high]!;
  const beforeValue = channelNumber(before, key);
  const afterValue = channelNumber(after, key);
  if (beforeValue === null || afterValue === null) {
    return beforeValue ?? afterValue;
  }
  const span = after.time - before.time;
  if (span <= 0) return afterValue;
  return beforeValue + ((afterValue - beforeValue) * (t - before.time)) / span;
}

function formatTelemetryValue(value: number | null) {
  if (value === null) return "--";
  const magnitude = Math.abs(value);
  if (magnitude >= 10_000 || (magnitude > 0 && magnitude < 0.01)) {
    return value.toExponential(1);
  }
  if (magnitude >= 1000) return value.toFixed(0);
  if (magnitude >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function TelemetryProbe({
  spec,
  clock,
  active,
}: {
  spec: ExperimentSpec;
  clock: RefObject<TelemetryClock>;
  active: boolean;
}) {
  const scaled = spec.scene.family === "sandbox";
  const rate = useMemo(() => {
    if (!scaled) return 1;
    const duration = buildEvidence(spec).duration;
    return duration > 0 ? duration / Math.min(duration, 8) : 1;
  }, [scaled, spec]);
  useEffect(() => {
    clock.current.t = 0;
  }, [clock]);
  useFrame((_, delta) => {
    clock.current.running = active;
    if (!active) return;
    // Sandbox scenes replay a server trajectory time-scaled to <=8 s of wall
    // clock; mirror that so the HUD reads the same simulation time the scene
    // is showing. Other families use the SimulationTimer's wall-time clamp.
    clock.current.t += scaled
      ? Math.min(delta, 0.05) * rate
      : Math.min(delta, 0.25);
  });
  return null;
}

const TELEMETRY_CHART_WIDTH = 416;
const TELEMETRY_CHART_HEIGHT = 104;
const TELEMETRY_LOG_LIMIT = 22;

function TelemetryHud({
  spec,
  launched,
  completed,
  paused,
  clock,
  updateIntervalMs,
}: {
  spec: ExperimentSpec;
  launched: boolean;
  completed: boolean;
  paused: boolean;
  clock: RefObject<TelemetryClock>;
  updateIntervalMs: number;
}) {
  const evidence = useMemo<SimulationEvidence | null>(() => {
    try {
      return buildEvidence(spec);
    } catch {
      return null;
    }
  }, [spec]);
  const channels = useMemo(() => telemetryChannels(spec), [spec]);
  const timeRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const valueRefs = useRef<(HTMLElement | null)[]>([]);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const chart = useMemo(() => {
    if (!evidence || evidence.points.length < 2 || evidence.duration <= 0) {
      return null;
    }
    const plotted = channels.slice(0, 2);
    let min = Infinity;
    let max = -Infinity;
    for (const point of evidence.points) {
      for (const channel of plotted) {
        const value = channelNumber(point, channel.key);
        if (value === null) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const pad = Math.max((max - min) * 0.08, 1e-6);
    min -= pad;
    max += pad;
    const toX = (t: number) => (t / evidence.duration) * TELEMETRY_CHART_WIDTH;
    const toY = (value: number) =>
      TELEMETRY_CHART_HEIGHT -
      ((value - min) / (max - min)) * TELEMETRY_CHART_HEIGHT;
    const paths = plotted.map((channel) => {
      const path = new Path2D();
      let started = false;
      for (const point of evidence.points) {
        const value = channelNumber(point, channel.key);
        if (value === null) continue;
        const x = toX(point.time);
        const y = toY(value);
        if (started) path.lineTo(x, y);
        else {
          path.moveTo(x, y);
          started = true;
        }
      }
      return { channel, path, plotted: started };
    });
    return { paths, toX, toY };
  }, [channels, evidence]);

  useEffect(() => {
    if (!evidence) return;
    let frame = 0;
    let lastDraw = -Infinity;
    let lastLoggedT = -1;
    let logLines: string[] = [];
    const duration = evidence.duration;
    const draw = (now: number) => {
      if (now - lastDraw < updateIntervalMs) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastDraw = now;
      const rawT = clock.current.t;
      const t = Math.min(rawT, duration);
      const done = completed || (launched && rawT >= duration);
      if (statusRef.current) {
        statusRef.current.textContent = completed
          ? "CAPTURED"
          : paused
            ? "PAUSED"
            : done
              ? "CAPTURED"
              : "STREAMING";
        statusRef.current.dataset.state = completed
          ? "done"
          : paused
            ? "paused"
            : done
              ? "done"
              : "live";
      }
      if (timeRef.current) {
        timeRef.current.textContent = t.toFixed(2);
      }
      const values = channels.map((channel) =>
        channelValueAt(evidence.points, channel.key, t),
      );
      values.forEach((value, index) => {
        const node = valueRefs.current[index];
        if (node) node.textContent = formatTelemetryValue(value);
      });

      const canvas = chartRef.current;
      const context = canvas?.getContext("2d");
      if (canvas && context && chart) {
        context.clearRect(0, 0, TELEMETRY_CHART_WIDTH, TELEMETRY_CHART_HEIGHT);
        context.strokeStyle = "rgba(140, 176, 196, 0.14)";
        context.lineWidth = 1;
        for (let line = 1; line < 4; line += 1) {
          const y = (TELEMETRY_CHART_HEIGHT / 4) * line;
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(TELEMETRY_CHART_WIDTH, y);
          context.stroke();
        }
        const revealX = completed
          ? TELEMETRY_CHART_WIDTH
          : Math.max(0, chart.toX(t));
        context.save();
        context.beginPath();
        context.rect(0, 0, revealX, TELEMETRY_CHART_HEIGHT);
        context.clip();
        for (const { channel, path, plotted } of chart.paths) {
          if (!plotted) continue;
          context.strokeStyle = channel.color;
          context.globalAlpha = 0.92;
          context.lineWidth = 2.4;
          context.stroke(path);
          context.globalAlpha = 1;
        }
        context.restore();
        if (launched) {
          const cursorX = chart.toX(t);
          context.strokeStyle = "rgba(233, 244, 250, 0.4)";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(cursorX, 0);
          context.lineTo(cursorX, TELEMETRY_CHART_HEIGHT);
          context.stroke();
          const headChannel = chart.paths[0]?.channel;
          const headValue = headChannel
            ? channelValueAt(evidence.points, headChannel.key, t)
            : null;
          if (headChannel && headValue !== null) {
            context.fillStyle = headChannel.color;
            context.shadowColor = headChannel.color;
            context.shadowBlur = 12;
            context.beginPath();
            context.arc(cursorX, chart.toY(headValue), 4.5, 0, Math.PI * 2);
            context.fill();
            context.shadowBlur = 0;
          }
        }
      }

      const shouldLog =
        launched && !paused && !done && t - lastLoggedT >= 0.12;
      if (shouldLog && logRef.current) {
        lastLoggedT = t;
        const row = values
          .map((value) => formatTelemetryValue(value).padStart(8))
          .join("");
        logLines.unshift(`+${t.toFixed(2).padStart(5)}s${row}`);
        if (logLines.length > TELEMETRY_LOG_LIMIT) {
          logLines = logLines.slice(0, TELEMETRY_LOG_LIMIT);
        }
        logRef.current.textContent = logLines.join("\n");
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [
    channels,
    chart,
    clock,
    completed,
    evidence,
    launched,
    paused,
    updateIntervalMs,
  ]);

  if (!evidence || channels.length === 0) return null;
  return (
    <div
      className="telemetry-hud"
      data-testid="live-telemetry"
      data-telemetry-state={completed ? "captured" : "streaming"}
      aria-hidden="true"
    >
      <header className="telemetry-head">
        <i className="telemetry-pulse" />
        <span>LIVE TELEMETRY</span>
        <b ref={statusRef} data-state={completed ? "done" : "live"}>
          {completed ? "CAPTURED" : "STREAMING"}
        </b>
      </header>
      <div className="telemetry-grid">
        <span className="telemetry-cell telemetry-time">
          <small>T+</small>
          <b ref={timeRef}>0.00</b>
          <em>s</em>
        </span>
        {channels.map((channel, index) => (
          <span key={channel.key} className="telemetry-cell">
            <small style={{ color: channel.color }}>{channel.label}</small>
            <b
              ref={(node) => {
                valueRefs.current[index] = node;
              }}
            >
              --
            </b>
            <em>{channel.unit}</em>
          </span>
        ))}
      </div>
      <canvas
        ref={chartRef}
        className="telemetry-chart"
        width={TELEMETRY_CHART_WIDTH}
        height={TELEMETRY_CHART_HEIGHT}
      />
      <div ref={logRef} className="telemetry-log">
        awaiting run data…
      </div>
    </div>
  );
}

function World({
  spec,
  runToken,
  launched,
  capturing,
  paused,
  showOutcomeGuides,
  cameraCommand,
  onComplete,
  onReady,
  telemetry,
  visualProfile,
}: ExperimentCanvasProps & {
  onReady: () => void;
  telemetry: RefObject<TelemetryClock>;
  visualProfile: VisualProfile;
}) {
  const framing = useMemo(() => experimentFraming(spec), [spec]);
  const motionEffects =
    visualProfile.quality === "full" && !visualProfile.reducedMotion;
  return (
    <>
      <color attach="background" args={["#04060d"]} />
      <fog attach="fog" args={["#04060d", 18, 52]} />
      {/* Deep-space backdrop: a slow-drifting starfield reads as an
          observatory rather than an empty void. Cheap, additive glow. */}
      <Stars
        radius={120}
        depth={60}
        count={visualProfile.quality === "full" ? 1600 : 650}
        factor={4}
        saturation={0}
        fade
        speed={visualProfile.reducedMotion ? 0 : motionEffects ? 0.45 : 0.1}
      />
      {/* Ambient dust motes drifting through the whole lab volume. */}
      <Sparkles
        count={visualProfile.quality === "full" ? 48 : 16}
        scale={[26, 14, 18]}
        position={[0, 6, 0]}
        size={1.6}
        speed={motionEffects ? 0.1 : 0}
        color="#8ea4ff"
        opacity={0.35}
      />
      <hemisphereLight args={["#9fd0ff", "#0a1220", 0.55]} />
      <ambientLight intensity={0.55} color="#7ea8c0" />
      <directionalLight castShadow position={[7, 13, 8]} intensity={2.6} color="#d9f3ff" shadow-mapSize={[1024, 1024]} />
      {/* Warm key and cool rim frame every object with a two-tone edge glow. */}
      <spotLight position={[-8, 10, 3]} intensity={120} angle={0.34} penumbra={0.85} color="#ff7138" />
      <spotLight position={[8, 9, -4]} intensity={95} angle={0.38} penumbra={0.9} color="#42d9ff" />
      <pointLight position={[0, 2, 9]} intensity={26} distance={26} color="#8ea4ff" />
      <Suspense fallback={null}>
        <Physics key={`${spec.id}-${runToken}-${launched ? "live" : "ready"}`} gravity={[0, -spec.scene.gravity, 0]} timeStep={1 / 60} interpolate colliders={false} paused={paused}>
          {spec.scene.family === "drop" && (
            <DropScene
              scene={spec.scene}
              launched={launched}
              motionEffects={motionEffects}
            />
          )}
          {spec.scene.family === "projectile" && (
            <ProjectileScene
              scene={spec.scene}
              launched={launched}
              showOutcomeGuides={showOutcomeGuides}
              motionEffects={motionEffects}
            />
          )}
          {spec.scene.family === "pendulum" && (
            <PendulumScene
              scene={spec.scene}
              launched={launched}
              motionEffects={motionEffects}
            />
          )}
          {spec.scene.family === "sandbox" && (
            <SandboxScene
              spec={spec}
              scene={spec.scene}
              launched={launched}
              capturing={capturing}
              paused={paused}
              motionEffects={motionEffects}
              onComplete={onComplete}
            />
          )}
          {spec.scene.family !== "sandbox" && (
            <SimulationTimer active={capturing && !paused} spec={spec} onComplete={onComplete} />
          )}
          <TelemetryProbe spec={spec} clock={telemetry} active={capturing && !paused} />
          <SceneReady onReady={onReady} />
        </Physics>
      </Suspense>
      <InteractiveCameraControls
        position={framing.position}
        target={framing.target}
        command={cameraCommand}
      />
      {/* Cinematic grade: soft bloom on every emissive, a whisper of lens
          fringing, and a vignette to seat the scene in the panel. */}
      {motionEffects && (
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={0.9}
            luminanceThreshold={0.35}
            luminanceSmoothing={0.85}
            mipmapBlur
            radius={0.7}
          />
          <ChromaticAberration
            blendFunction={BlendFunction.NORMAL}
            offset={[0.0006, 0.0009]}
            radialModulation={false}
            modulationOffset={0}
          />
          <Vignette eskil={false} offset={0.18} darkness={0.72} />
        </EffectComposer>
      )}
    </>
  );
}

export function ExperimentCanvas({
  spec,
  runToken,
  launched,
  capturing,
  paused,
  showOutcomeGuides,
  cameraCommand,
  onComplete,
}: ExperimentCanvasProps) {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const telemetryClock = useRef<TelemetryClock>({ t: 0, running: false });
  const visualProfile = useVisualProfile();
  const telemetryVisible =
    visualProfile.showTelemetry && (launched || showOutcomeGuides);

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

  const framing = experimentFraming(spec);
  const camera = { position: framing.position, fov: framing.fov };
  return (
    <>
      <Canvas
        className="experiment-canvas"
        data-outcome-guides={showOutcomeGuides ? "revealed" : "hidden"}
        data-camera-command={`${cameraCommand.type}-${cameraCommand.token}`}
        data-visual-quality={visualProfile.quality}
        data-motion-effects={
          visualProfile.reducedMotion ? "reduced" : "standard"
        }
        dpr={visualProfile.quality === "full" ? [1, 1.35] : 1}
        camera={camera}
        shadows={visualProfile.quality === "full" ? "percentage" : false}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.12,
        }}
        aria-label={`Interactive 3D simulation: ${spec.title}`}
      >
        <World
          spec={spec}
          runToken={runToken}
          launched={launched}
          capturing={capturing}
          paused={paused}
          showOutcomeGuides={showOutcomeGuides}
          cameraCommand={cameraCommand}
          onComplete={onComplete}
          onReady={() => setSceneReady(true)}
          telemetry={telemetryClock}
          visualProfile={visualProfile}
        />
      </Canvas>
      {telemetryVisible && (
        <TelemetryHud
          key={`${spec.id}-${runToken}`}
          spec={spec}
          launched={launched}
          completed={showOutcomeGuides}
          paused={paused}
          clock={telemetryClock}
          updateIntervalMs={visualProfile.quality === "full" ? 0 : 120}
        />
      )}
      {!sceneReady && (
        <div className="canvas-loading" role="status">
          <Atom className="loading-atom" size={34} aria-hidden="true" />
          <p>Calibrating the physics world</p>
        </div>
      )}
    </>
  );
}
