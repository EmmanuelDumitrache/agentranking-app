"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, type ComponentRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Texture,
  TOUCH,
  Vector3,
} from "three";
import {
  arClusterCenter,
  buildAgentWorldPoints,
  computeChainCenters,
  type AgentWorldCorpusTierKey,
} from "@/lib/public-site/agent-world-layout";
import { previewForWorldDot } from "@/lib/public-site/world-dot-preview";
import {
  AGENT_WORLD_AR_CHAIN_ID,
  type AgentWorldAgentPreview,
  type AgentWorldChainCluster,
  type AgentWorldArCluster,
  type AgentWorldSnapshot,
} from "@/lib/public-site/world-types";
import { resolveChainIconUrl } from "@/lib/chain-icon-url";
import styles from "@/components/public-site/agent-world.module.css";

type Props = {
  readonly snapshot: AgentWorldSnapshot;
  readonly selectedChainId: number | null;
  readonly activeTiers: ReadonlySet<AgentWorldCorpusTierKey> | null;
  readonly onSelectChain: (chainId: number | null) => void;
  readonly onHoverPreview: (preview: AgentWorldAgentPreview | null) => void;
  readonly onCursorMove: (cursor: { readonly x: number; readonly y: number }) => void;
};

const AGENT_DOT_GREEN = "#22c55e";
const AGENT_DOT_YELLOW = "#eab308";
const AGENT_DOT_RED = "#ef4444";
const countFormatter = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

const OVERVIEW_TARGET = new Vector3(0, 0, 0);
/** Top-down galaxy view so every chain cluster is visible at once. */
const OVERVIEW_DISTANCE = 132;
const OVERVIEW_CAMERA_OFFSET = new Vector3(0, 1, 0.34).normalize();
/** Selecting a chain pans to it from a slightly lower, perspective angle. */
const CHAIN_FOCUS_DISTANCE = 16;
const CHAIN_CAMERA_OFFSET = new Vector3(0, 0.36, 1).normalize();
const LABEL_Z_INDEX_RANGE: [number, number] = [1, 0];
const LABEL_FULL_SIZE_DISTANCE = 34;

type OrbitControlsHandle = ComponentRef<typeof OrbitControls>;

function tierDotColor(tier: AgentWorldCorpusTierKey): string {
  switch (tier) {
    case "verified":
      return AGENT_DOT_GREEN;
    case "listed":
    case "unranked":
      return AGENT_DOT_YELLOW;
    case "dead":
      return AGENT_DOT_RED;
    default: {
      const exhaustive: never = tier;
      throw new Error(`Unhandled world tier: ${exhaustive}`);
    }
  }
}

let agentDotTexture: Texture | null = null;

function getAgentDotTexture(): Texture {
  if (agentDotTexture) return agentDotTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    agentDotTexture = new Texture();
    return agentDotTexture;
  }
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  agentDotTexture = new CanvasTexture(canvas);
  return agentDotTexture;
}

function isWorldClusterVisible(
  chainId: number,
  selectedChainId: number | null,
): boolean {
  return selectedChainId == null || selectedChainId === chainId;
}

function isWorldPointVisible(
  chainId: number,
  tier: AgentWorldCorpusTierKey,
  selectedChainId: number | null,
  activeTiers: ReadonlySet<AgentWorldCorpusTierKey> | null,
): boolean {
  if (!isWorldClusterVisible(chainId, selectedChainId)) return false;
  if (activeTiers != null && !activeTiers.has(tier)) return false;
  return true;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return [0.5, 0.5, 0.5];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function AgentPointField({
  snapshot,
  selectedChainId,
  activeTiers,
  onHoverPreview,
}: {
  readonly snapshot: AgentWorldSnapshot;
  readonly selectedChainId: number | null;
  readonly activeTiers: ReadonlySet<AgentWorldCorpusTierKey> | null;
  readonly onHoverPreview: (preview: AgentWorldAgentPreview | null) => void;
}) {
  const hideTimer = useRef<number | null>(null);
  const chainById = useMemo(() => {
    const map = new Map<number, AgentWorldChainCluster>();
    map.set(snapshot.arCluster.chainId, snapshot.arCluster);
    for (const chain of snapshot.chains) map.set(chain.chainId, chain);
    return map;
  }, [snapshot]);
  const previewsByChain = useMemo(() => {
    const map = new Map<number, AgentWorldAgentPreview[]>();
    for (const preview of snapshot.previews) {
      const previews = map.get(preview.chainId) ?? [];
      previews.push(preview);
      map.set(preview.chainId, previews);
    }
    return map;
  }, [snapshot.previews]);

  const { geometry, visible } = useMemo(() => {
    const points = buildAgentWorldPoints({
      chains: snapshot.chains,
      arCluster: snapshot.arCluster,
      tiers: snapshot.corpusTiers,
    });
    const visible = points.filter((point) =>
      isWorldPointVisible(point.chainId, point.tier, selectedChainId, activeTiers),
    );
    const positions = new Float32Array(visible.length * 3);
    const colors = new Float32Array(visible.length * 3);

    for (let index = 0; index < visible.length; index += 1) {
      const point = visible[index]!;
      const [r, g, b] = hexToRgb(tierDotColor(point.tier));
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
      colors[index * 3] = r;
      colors[index * 3 + 1] = g;
      colors[index * 3 + 2] = b;
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(positions, 3));
    geo.setAttribute("color", new BufferAttribute(colors, 3));
    return { geometry: geo, visible };
  }, [activeTiers, selectedChainId, snapshot]);

  const previewFromIndex = (index: number | undefined) => {
    if (index == null) return null;
    const point = visible[index];
    if (!point) return null;
    const chain = chainById.get(point.chainId);
    if (!chain) return null;
    return previewForWorldDot({
      chain,
      index: point.agentIndex,
      chainPreviews: previewsByChain.get(point.chainId) ?? [],
    });
  };

  const showPreview = (index: number | undefined) => {
    const preview = previewFromIndex(index);
    if (!preview) return;
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    onHoverPreview(preview);
  };

  const scheduleHide = () => {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      onHoverPreview(null);
      hideTimer.current = null;
    }, 140);
  };

  useEffect(() => {
    return () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <points
      geometry={geometry}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
        const hitIndex = event.index ?? event.intersections[0]?.index;
        showPreview(hitIndex);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        const hitIndex = event.index ?? event.intersections[0]?.index;
        showPreview(hitIndex);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "default";
        scheduleHide();
      }}
      onClick={(event) => {
        event.stopPropagation();
        const hitIndex = event.index ?? event.intersections[0]?.index;
        showPreview(hitIndex);
      }}
    >
      <pointsMaterial
        map={getAgentDotTexture()}
        size={0.08}
        sizeAttenuation
        vertexColors
        transparent
        depthWrite={false}
        alphaTest={0.4}
      />
    </points>
  );
}

function ZoomScaledHtml({
  position,
  children,
}: {
  readonly position: [number, number, number];
  readonly children: ReactNode;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const { camera } = useThree();
  const worldPos = useMemo(
    () => new Vector3(position[0], position[1], position[2]),
    [position],
  );

  useFrame(() => {
    const node = nodeRef.current;
    if (!node) return;
    const dist = camera.position.distanceTo(worldPos);
    const scale = Math.max(0.38, Math.min(1, dist / LABEL_FULL_SIZE_DISTANCE));
    node.style.transform = `scale(${scale})`;
    node.style.transformOrigin = "center center";
  });

  return (
    <Html
      position={position}
      center
      zIndexRange={LABEL_Z_INDEX_RANGE}
      pointerEvents="auto"
    >
      <div ref={nodeRef}>{children}</div>
    </Html>
  );
}

function WorldClusterLabel({
  name,
  count,
  icon,
  fallback,
  dimmed,
  onSelect,
}: {
  readonly name: string;
  readonly count: number;
  readonly icon: string;
  readonly fallback: string;
  readonly dimmed: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={styles.clusterLabel}
      style={{ pointerEvents: "auto", opacity: dimmed ? 0.28 : 1 }}
    >
      {icon ? (
        <Image
          src={icon}
          alt=""
          width={18}
          height={18}
          className={styles.clusterLabelIcon}
          unoptimized
        />
      ) : (
        <span className={styles.clusterLabelFallback}>{fallback}</span>
      )}
      <span className={styles.clusterLabelName}>{name}</span>
      <span className={styles.clusterLabelCount}>{countFormatter.format(count)}</span>
    </button>
  );
}

function ArClusterLabel({
  cluster,
  dimmed,
  onSelect,
}: {
  readonly cluster: AgentWorldArCluster;
  readonly dimmed: boolean;
  readonly onSelect: () => void;
}) {
  const position = arClusterCenter();

  return (
    <ZoomScaledHtml position={position}>
      <WorldClusterLabel
        name={cluster.shortName}
        count={cluster.listedCount}
        icon="/ar-mark.png"
        fallback="AR"
        dimmed={dimmed}
        onSelect={onSelect}
      />
    </ZoomScaledHtml>
  );
}

function CameraFocusController({
  snapshot,
  selectedChainId,
  controlsRef,
}: {
  readonly snapshot: AgentWorldSnapshot;
  readonly selectedChainId: number | null;
  readonly controlsRef: React.RefObject<OrbitControlsHandle | null>;
}) {
  const { camera, gl } = useThree();
  const reducedMotion = useReducedMotion();
  const centers = useMemo(() => computeChainCenters(snapshot.chains), [snapshot.chains]);
  const focusTarget = useRef(new Vector3());
  const focusDistance = useRef(OVERVIEW_DISTANCE);
  const focusDirection = useRef(OVERVIEW_CAMERA_OFFSET.clone());
  const isFocusing = useRef(false);

  useEffect(() => {
    const isAr = selectedChainId === AGENT_WORLD_AR_CHAIN_ID;
    let center: [number, number, number] | null = null;
    if (isAr) {
      center = arClusterCenter();
    } else if (selectedChainId != null) {
      center = centers.get(selectedChainId) ?? null;
    }
    focusTarget.current.copy(
      center ? new Vector3(center[0], center[1], center[2]) : OVERVIEW_TARGET,
    );
    focusDistance.current =
      selectedChainId == null ? OVERVIEW_DISTANCE : CHAIN_FOCUS_DISTANCE;
    focusDirection.current.copy(
      selectedChainId == null ? OVERVIEW_CAMERA_OFFSET : CHAIN_CAMERA_OFFSET,
    );
    isFocusing.current = true;
  }, [centers, selectedChainId]);

  useEffect(() => {
    const element = gl.domElement;
    const stopFocusing = () => {
      isFocusing.current = false;
    };
    element.addEventListener("wheel", stopFocusing, { passive: true });
    element.addEventListener("touchmove", stopFocusing, { passive: true });
    element.addEventListener("pointerdown", stopFocusing);
    return () => {
      element.removeEventListener("wheel", stopFocusing);
      element.removeEventListener("touchmove", stopFocusing);
      element.removeEventListener("pointerdown", stopFocusing);
    };
  }, [gl]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls || !isFocusing.current) return;

    const lerpFactor = reducedMotion ? 1 : 0.09;
    controls.target.lerp(focusTarget.current, lerpFactor);

    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() > 0.001) {
      focusDirection.current.copy(offset.normalize());
    }

    const currentDistance = offset.length();
    const nextDistance =
      currentDistance + (focusDistance.current - currentDistance) * lerpFactor;
    camera.position.copy(controls.target).add(
      focusDirection.current.clone().multiplyScalar(nextDistance),
    );
    controls.update();

    const targetDone = controls.target.distanceTo(focusTarget.current) < 0.12;
    const distanceDone = Math.abs(currentDistance - focusDistance.current) < 0.2;
    if (targetDone && distanceDone) {
      isFocusing.current = false;
    }
  });

  return null;
}

function ChainLabel({
  chain,
  position,
  dimmed,
  onSelect,
}: {
  readonly chain: AgentWorldChainCluster;
  readonly position: [number, number, number];
  readonly dimmed: boolean;
  readonly onSelect: () => void;
}) {
  const icon = resolveChainIconUrl(chain.chainId, chain.icon);

  return (
    <ZoomScaledHtml position={position}>
      <WorldClusterLabel
        name={chain.name}
        count={chain.listedCount}
        icon={icon}
        fallback={chain.shortName.slice(0, 3).toUpperCase()}
        dimmed={dimmed}
        onSelect={onSelect}
      />
    </ZoomScaledHtml>
  );
}

function ChainLabels({
  chains,
  arCluster,
  selectedChainId,
  onSelectChain,
}: {
  readonly chains: readonly AgentWorldChainCluster[];
  readonly arCluster: AgentWorldArCluster;
  readonly selectedChainId: number | null;
  readonly onSelectChain: (chainId: number | null) => void;
}) {
  const centers = useMemo(() => computeChainCenters(chains), [chains]);

  return (
    <>
      {isWorldClusterVisible(AGENT_WORLD_AR_CHAIN_ID, selectedChainId) ? (
        <ArClusterLabel
          cluster={arCluster}
          dimmed={false}
          onSelect={() =>
            onSelectChain(
              selectedChainId === AGENT_WORLD_AR_CHAIN_ID ? null : AGENT_WORLD_AR_CHAIN_ID,
            )
          }
        />
      ) : null}
      {chains.map((chain) => {
        if (!isWorldClusterVisible(chain.chainId, selectedChainId)) return null;
        const position = centers.get(chain.chainId) ?? [0, 0, 0];
        return (
          <ChainLabel
            key={chain.chainId}
            chain={chain}
            position={position}
            dimmed={false}
            onSelect={() =>
              onSelectChain(selectedChainId === chain.chainId ? null : chain.chainId)
            }
          />
        );
      })}
    </>
  );
}

function Scene({
  snapshot,
  selectedChainId,
  activeTiers,
  onSelectChain,
  onHoverPreview,
}: Omit<Props, "onCursorMove">) {
  const reducedMotion = useReducedMotion();
  const controlsRef = useRef<OrbitControlsHandle>(null);

  return (
    <>
      <color attach="background" args={["#070b14"]} />
      <fog attach="fog" args={["#070b14", 70, 210]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[40, 30, 20]} intensity={1.1} color="#ffffff" />
      <pointLight position={[-50, -30, 30]} intensity={0.18} color="#4488ff" />
      <Stars radius={180} depth={90} count={3600} factor={3.4} saturation={0.15} fade speed={0.45} />
      <AgentPointField
        snapshot={snapshot}
        selectedChainId={selectedChainId}
        activeTiers={activeTiers}
        onHoverPreview={onHoverPreview}
      />
      <ChainLabels
        chains={snapshot.chains}
        arCluster={snapshot.arCluster}
        selectedChainId={selectedChainId}
        onSelectChain={onSelectChain}
      />
      <CameraFocusController
        snapshot={snapshot}
        selectedChainId={selectedChainId}
        controlsRef={controlsRef}
      />
      <OrbitControls
        ref={controlsRef}
        enablePan
        enableRotate
        enableZoom
        zoomSpeed={0.9}
        rotateSpeed={0.62}
        panSpeed={0.55}
        enableDamping={!reducedMotion}
        dampingFactor={0.08}
        minDistance={1.2}
        maxDistance={220}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI / 2.02}
        autoRotate={!reducedMotion && selectedChainId == null && activeTiers == null}
        autoRotateSpeed={0.22}
        makeDefault
        touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
      />
    </>
  );
}

export function AgentWorldScene({
  snapshot,
  selectedChainId,
  activeTiers,
  onSelectChain,
  onHoverPreview,
  onCursorMove,
}: Props) {
  return (
    <Canvas
      camera={{ position: [0, 122, 42], fov: 48, near: 0.05, far: 400 }}
      dpr={[1, 1.75]}
      className="h-full w-full touch-none"
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl, raycaster }) => {
        gl.domElement.style.touchAction = "none";
        raycaster.params.Points = {
          ...(raycaster.params.Points ?? { threshold: 0.08 }),
          threshold: 0.08,
        };
      }}
      onPointerMissed={() => {
        onSelectChain(null);
        onHoverPreview(null);
      }}
      onPointerMove={(event) => {
        onCursorMove({ x: event.clientX, y: event.clientY });
      }}
    >
      <Scene
        snapshot={snapshot}
        selectedChainId={selectedChainId}
        activeTiers={activeTiers}
        onSelectChain={onSelectChain}
        onHoverPreview={onHoverPreview}
      />
    </Canvas>
  );
}
