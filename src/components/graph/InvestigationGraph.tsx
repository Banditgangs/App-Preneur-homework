"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { GraphPayload } from "../../types/osint.types";

// ssr:false is mandatory — the canvas library is browser-only
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-neutral-800 border-t-blue-500 rounded-full animate-spin" />
    </div>
  ),
});

interface Props {
  payload: GraphPayload;
  onNodeClick: (nodeId: string) => void;
}

export const InvestigationGraph = ({ payload, onNodeClick }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Explicit dimensions passed to ForceGraph2D so its canvas never overflows
  // the container and bleeds over sibling elements (the pointer-events killer).
  const [dims, setDims] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Measure immediately so first render is correct
    setDims({ width: el.clientWidth, height: el.clientHeight });

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleNodeClick = useCallback(
    (node: any) => {
      if (node && node.id) {
        onNodeClick(String(node.id));
      }
    },
    [onNodeClick]
  );

  // Enlarges the invisible pointer hit area to 20px radius — makes clicks
  // land reliably even if the user misses the 7px visual circle slightly.
  const paintNodeHitArea = useCallback(
    (node: any, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.arc(node.x, node.y, 20, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  const drawNode = useCallback((node: any, ctx: CanvasRenderingContext2D) => {
    const group: string = node.group ?? "unknown";
    const colorMap: Record<string, string> = {
      domain: "#3b82f6",
      ip: "#22c55e",
      email: "#f59e0b",
      social: "#a855f7",
    };
    const color = colorMap[group] ?? "#64748b";
    const r = 7;

    // Glow effect
    ctx.shadowBlur = 14;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Label
    ctx.font = "5px 'Inter', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textAlign = "center";
    ctx.fillText(node.label ?? node.id, node.x, node.y + r + 6);
  }, []);

  return (
    // KEY RULE: position:relative + overflow:hidden
    // This is what clips the canvas to the column width so it cannot
    // silently extend over the left/right sidebars and eat their clicks.
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      {dims.width > 0 && dims.height > 0 && (
        <ForceGraph2D
          graphData={payload}
          width={dims.width}
          height={dims.height}
          backgroundColor="#050505"
          nodeCanvasObject={drawNode}
          nodeCanvasObjectMode={() => "replace"}
          linkColor={() => "#334155"}
          linkWidth={1.5}
          onNodeClick={handleNodeClick}
          nodePointerAreaPaint={paintNodeHitArea}
          onNodeHover={(node) => {
            document.body.style.cursor = node ? "pointer" : "default";
          }}
          enableNodeDrag={true}
          cooldownTicks={80}
        />
      )}
    </div>
  );
};