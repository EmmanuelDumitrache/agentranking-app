"use client";
import { Canvas } from "@react-three/fiber";
import { Center, Clone, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import { useReducedMotion } from "motion/react";
import { Box3, Vector3 } from "three";
import { cn } from "@/lib/utils";
const MODEL_URL = "/models/robot-head.glb";
useGLTF.preload(MODEL_URL);
function GlbRobotHead() {
  const { scene } = useGLTF(MODEL_URL);
  const scale = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const size = new Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    return maxDim > 0 ? 1.55 / maxDim : 1;
  }, [scene]);
  return (
    <Center>
      <Clone object={scene} scale={scale} />
    </Center>
  );
}
function Scene({ autoRotate }: { autoRotate: boolean }) {
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[4, 5, 6]} intensity={1.25} />
      <directionalLight position={[-4, 2, -3]} intensity={0.4} />
      <pointLight position={[0, -1, 3]} intensity={0.2} color="#ffffff" />
      <GlbRobotHead />
      <OrbitControls
        autoRotate={autoRotate}
        autoRotateSpeed={0.85}
        enableDamping
        enablePan={false}
        enableZoom={false}
        dampingFactor={0.08}
        rotateSpeed={0.65}
        minPolarAngle={0.55}
        maxPolarAngle={2.55}
      />
    </>
  );
}
type RobotHeadMarkProps = {
  className?: string;
};
export function RobotHeadMark({ className }: RobotHeadMarkProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className={cn(
        "cursor-grab overflow-visible active:cursor-grabbing",
        className,
      )}
      aria-label="Interactive AgentRanking robot mark — drag to rotate"
      role="img"
      style={{
        filter: "drop-shadow(0 8px 24px rgba(0, 0, 0, 0.45))",
        touchAction: "none",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 2.75], fov: 34 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%", overflow: "visible" }}
      >
        <Suspense fallback={null}>
          <Scene autoRotate={!reduceMotion} />
        </Suspense>
      </Canvas>
    </div>
  );
}
