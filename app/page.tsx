"use client";

import { useState, useCallback } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ScanLauncher } from "../src/components/scan/ScanLauncher";
import { InvestigationGraph } from "../src/components/graph/InvestigationGraph";
import { NodeContextPanel } from "../src/components/graph/NodeContextPanel";
import * as GraphDataAdapter from "../src/lib/GraphDataAdapter";
import { mockApi } from "../src/lib/mockApi";
import { Activity, Crosshair, Network, ScanLine } from "lucide-react";

// QueryClient is stable — created outside the component tree so it's never recreated.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 1000 * 60 * 5 } },
});

// ─── Inner workspace (needs React Query context) ─────────────────────────────
function WorkspaceContent() {
  const [activeScanId, setActiveScanId] = useState<string | null>(null);

  // Local state — we don't need Zustand for the panel toggle;
  // using local state guarantees no stale-closure / hydration mismatches.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const query = useQuery({
    queryKey: ["graph", activeScanId],
    queryFn: () => mockApi.fetchGraphForScan(activeScanId!),
    enabled: !!activeScanId,
  });

  const graphPayload = query.data
    ? GraphDataAdapter.adaptGraphResponse(query.data)
    : null;

  // Stable callback — useCallback prevents InvestigationGraph from re-rendering
  // every time the parent re-renders (which would reset the force simulation).
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setIsPanelOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => {
    setIsPanelOpen(false);
    setSelectedNodeId(null);
  }, []);

  return (
    /**
     * ROOT LAYOUT
     * ┌────────────┬──────────────────────────┬──────────────┐
     * │ Left (320) │    Center (flex-1)        │ Right (320)  │
     * │ z-10       │    position:relative      │ z-10         │
     * │            │    overflow:hidden        │              │
     * └────────────┴──────────────────────────┴──────────────┘
     *
     * CRITICAL: The center column is `position:relative; overflow:hidden`.
     * ForceGraph2D's canvas is explicitly sized (width/height props) to match
     * its container via ResizeObserver inside InvestigationGraph.tsx.
     * This means the canvas NEVER leaks beyond the center column, so it can
     * never silently swallow pointer events from the sidebars.
     */
    <div className="h-screen w-screen bg-neutral-950 text-gray-200 overflow-hidden flex font-sans">

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <aside
        className="
          w-80 shrink-0 flex flex-col
          bg-neutral-900 border-r border-neutral-800
          shadow-2xl
          z-10   /* sits above the canvas column in stacking context */
          relative
        "
      >
        {/* Brand header */}
        <div className="px-6 py-5 border-b border-neutral-800 bg-gradient-to-b from-black/40">
          <div className="flex items-center gap-3 mb-1">
            <Crosshair className="w-5 h-5 text-blue-500" />
            <h1 className="text-xl font-black tracking-[0.15em] text-white">
              NEXUS<span className="text-blue-500">OSINT</span>
            </h1>
          </div>
          <p className="text-[10px] text-neutral-600 tracking-widest uppercase ml-8">
            Target Intelligence Platform
          </p>
        </div>

        {/* Scan controls */}
        <div className="p-5 flex-1 overflow-y-auto space-y-6">
          <ScanLauncher onScanStarted={setActiveScanId} />

          {/* Status */}
          {query.isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 p-6 border border-neutral-800 rounded-lg bg-black/50">
              <div className="w-8 h-8 border-4 border-neutral-800 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-xs font-mono text-blue-400 animate-pulse tracking-widest">
                EXTRACTING DATA...
              </p>
            </div>
          )}

          {query.isError && (
            <div className="p-4 border border-red-800/50 rounded-lg bg-red-950/30 text-xs text-red-400 font-mono">
              Scan pipeline error. Retry.
            </div>
          )}

          {graphPayload && !query.isLoading && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                <Activity className="w-3 h-3" /> Graph Summary
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-black/40 border border-neutral-800 rounded p-3 text-center">
                  <p className="text-2xl font-black text-blue-400">{graphPayload.nodes.length}</p>
                  <p className="text-[10px] text-neutral-600 uppercase tracking-wider">Nodes</p>
                </div>
                <div className="bg-black/40 border border-neutral-800 rounded p-3 text-center">
                  <p className="text-2xl font-black text-blue-400">{graphPayload.links.length}</p>
                  <p className="text-[10px] text-neutral-600 uppercase tracking-wider">Edges</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-black/20">
          <p className="text-[10px] text-neutral-700 font-mono flex items-center gap-1.5">
            <ScanLine className="w-3 h-3" /> Phase 1 MVP · v0.1.0
          </p>
        </div>
      </aside>

      {/* ── CENTER CANVAS ────────────────────────────────────────────────── */}
      {/*
        `position:relative` establishes a stacking context.
        `overflow:hidden` clips the ForceGraph canvas to this column.
        NO z-index here — it stays at z-index:auto (0), below the sidebars.
        The canvas inside InvestigationGraph is explicitly sized via ResizeObserver
        so it will NEVER overflow into the sidebar columns.
      */}
      <main className="flex-1 relative overflow-hidden bg-[#050505]">
        {graphPayload ? (
          <InvestigationGraph
            payload={graphPayload}
            onNodeClick={handleNodeClick}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none select-none">
            <Network className="w-16 h-16 text-neutral-800" strokeWidth={1} />
            <div className="text-center">
              <p className="text-sm tracking-[0.3em] font-mono text-neutral-700 uppercase">
                Awaiting Target Acquisition
              </p>
              <p className="text-xs text-neutral-800 font-mono mt-1">
                Enter a target in the left panel to begin
              </p>
            </div>
          </div>
        )}

        {/* Subtle grid overlay (pure CSS, pointer-events:none — never blocks clicks) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────
          Positioned ABSOLUTE inside the `position:relative` <main>.
          This means it OVERLAYS the canvas — the flex layout never changes,
          the canvas ResizeObserver is never triggered, no re-render cascade.
          z-50 keeps it above the grid overlay and the canvas.
        ──────────────────────────────────────────────────────────────────── */}
        {isPanelOpen && graphPayload && (
          <aside
            className="absolute right-0 top-0 h-full w-80 z-50 border-l border-neutral-800 shadow-2xl"
          >
            <NodeContextPanel
              payload={graphPayload}
              selectedNodeId={selectedNodeId}
              onClose={handleClosePanel}
            />
          </aside>
        )}
      </main>
    </div>
  );
}

// ─── Entry point with providers ───────────────────────────────────────────────
export default function WorkspacePage() {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceContent />
    </QueryClientProvider>
  );
}