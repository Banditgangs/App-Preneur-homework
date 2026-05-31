"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { ScanLauncher } from "@/components/scan-launcher";
const InvestigationGraph = dynamic(
  () => import("@/components/investigation-graph").then((mod) => mod.InvestigationGraph),
  { ssr: false }
);
import { NodeContextPanel } from "@/components/node-context-panel";
import { api, ApiGraphPayload } from "@/lib/api";
import { Activity, Crosshair, Loader2, Network, ScanLine, Clock } from "lucide-react";

// QueryClient is stable — created outside the component tree so it's never recreated.
const queryClient = new QueryClient({
  defaultOptions: { 
    queries: { 
      retry: 1, 
      staleTime: 0,
      gcTime: 0, // React Query v5 için (v4 ise cacheTime: 0)
      refetchOnWindowFocus: true,
      refetchOnMount: true
    } 
  },
});

// ── Adapter: ApiGraphPayload → GraphPayload for NodeContextPanel ─────────────
// NodeContextPanel uses GraphPayload from osint.types (nodes with label/group).
// ApiGraphPayload has the same shape, so we just pass it through.
function toContextPayload(payload: ApiGraphPayload | null) {
  if (!payload) return { nodes: [], links: [] };
  return {
    nodes: payload.nodes.map((n) => ({ id: n.id, label: n.label, group: n.group })),
    links: payload.links,
  };
}

// ─── Inner workspace (needs React Query context) ─────────────────────────────
function WorkspaceContent() {
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [blastRadiusNode, setBlastRadiusNode] = useState<string | null>(null);
  const [timelineDate, setTimelineDate] = useState<number | null>(null);

  const queryClient = useQueryClient();

  // ── Fetch INITIAL graph data from backend ─────────────────────────────────────
  const query = useQuery<ApiGraphPayload>({
    queryKey: ["graph", activeScanId],
    queryFn: () => api.fetchTargetGraph(activeScanId!),
    enabled: !!activeScanId,
    // refetchInterval: 3000 -> SİLİNDİ! Artık hantal Polling yok.
  });

  // ── YENİ: Gerçek Zamanlı (Real-Time) WebSocket Bağlantısı ────────────────────
  useEffect(() => {
    if (!activeScanId) return;

    const wsUrl = process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL.replace(/^http/, "ws")
      : "ws://localhost:8000";
      
    // FastAPI'ye WS üzerinden bağlan
    const ws = new WebSocket(`${wsUrl}/api/targets/ws/${activeScanId}`);

    ws.onmessage = (event) => {
      try {
        const newData = JSON.parse(event.data);
        // HİBRİT MİMARİ: Gelen JSON'u doğrudan React Query'nin Cache'ine enjekte et!
        queryClient.setQueryData(["graph", activeScanId], newData);
      } catch (error) {
        console.error("WebSocket message parsing error:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return () => {
      ws.close();
    };
  }, [activeScanId, queryClient]);

  const graphPayload: ApiGraphPayload | null = useMemo(
    () => query.data ?? null,
    [query.data]
  );

  // ── TIMELINE CALCULATION ──
  const timelineBounds = useMemo(() => {
    if (!graphPayload || !graphPayload.nodes || graphPayload.nodes.length === 0) return null;
    
    let minTime = Infinity;
    let maxTime = -Infinity;
    
    graphPayload.nodes.forEach(n => {
      if (n.discovery_date) {
        const time = new Date(n.discovery_date).getTime();
        if (time < minTime) minTime = time;
        if (time > maxTime) maxTime = time;
      }
    });
    
    if (minTime === Infinity) return null;
    return { min: minTime, max: maxTime };
  }, [graphPayload]);

  // Set initial timeline date to max when data loads
  useEffect(() => {
    if (timelineBounds && timelineDate === null) {
      setTimelineDate(timelineBounds.max);
    }
  }, [timelineBounds, timelineDate]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setIsPanelOpen(true);
    // Seçim değiştiğinde eğer blast mode açıksa sıfırlamalı mıyız? İsteğe bağlı. Şimdilik kalsın.
  }, []);

  const handleClosePanel = useCallback(() => {
    setIsPanelOpen(false);
    setSelectedNodeId(null);
    setBlastRadiusNode(null); // Paneli kapatınca blast radius'u temizle
  }, []);

  return (
    /**
     * ROOT LAYOUT
     * ┌────────────┬──────────────────────────┬──────────────┐
     * │ Left (320) │    Center (flex-1)       │ Right (320)  │
     * │ z-10       │    position:relative     │ z-10         │
     * │            │    overflow:hidden       │              │
     * └────────────┴──────────────────────────┴──────────────┘
     */
    <div className="h-screen w-screen bg-neutral-950 text-gray-200 overflow-hidden flex font-sans">

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <aside
        className="
          w-80 shrink-0 flex flex-col
          bg-neutral-900 border-r border-neutral-800
          shadow-2xl z-10 relative
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
          <ScanLauncher onScanStarted={(id) => {
            setActiveScanId(id);
            setTimelineDate(null); // KÖK ÇÖZÜM: Yeni taramada eski taramanın zaman kilitlenmesini sıfırla!
            setBlastRadiusNode(null);
            setSelectedNodeId(null);
            setIsPanelOpen(false);
          }} />

          {/* Loading status */}
          {query.isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 p-6 border border-neutral-800 rounded-lg bg-black/50">
              <div className="w-8 h-8 border-4 border-neutral-800 border-t-blue-500 rounded-full animate-spin" />
              <p className="text-xs font-mono text-blue-400 animate-pulse tracking-widest">
                EXTRACTING DATA...
              </p>
            </div>
          )}

          {/* Error */}
          {query.isError && (
            <div className="p-4 border border-red-800/50 rounded-lg bg-red-950/30 text-xs text-red-400 font-mono">
              Graf verisi alınamadı. Backend çalışıyor mu?
            </div>
          )}

          {/* ── Graph Summary — real node/edge counts ─────────────────────── */}
          {graphPayload && !query.isLoading && (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest flex items-center gap-2">
                  <Activity className="w-3 h-3" /> Graph Summary
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/40 border border-neutral-800 rounded p-3 text-center">
                    <p className="text-2xl font-black text-blue-400">
                      {graphPayload.nodes.length}
                    </p>
                    <p className="text-[10px] text-neutral-600 uppercase tracking-wider">Nodes</p>
                  </div>
                  <div className="bg-black/40 border border-neutral-800 rounded p-3 text-center">
                    <p className="text-2xl font-black text-blue-400">
                      {graphPayload.links.length}
                    </p>
                    <p className="text-[10px] text-neutral-600 uppercase tracking-wider">Edges</p>
                  </div>
                </div>
              </div>

              {/* ── Export Buttons ────────────────────────────────────────────── */}
              <div className="space-y-2 pt-2 border-t border-neutral-800/50">
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/export/${activeScanId}/pdf`}
                  download
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded bg-red-900/40 text-red-400 hover:bg-red-900/60 border border-red-900/50 transition-colors text-xs font-bold tracking-wider"
                >
                  📄 PDF RAPORU AL
                </a>
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/export/${activeScanId}/csv`}
                  download
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded bg-emerald-900/40 text-emerald-400 hover:bg-emerald-900/60 border border-emerald-900/50 transition-colors text-xs font-bold tracking-wider"
                >
                  📊 CSV OLARAK DIŞA AKTAR
                </a>
                
                {/* ── FOCUS MODE BUTTON ── */}
                <button
                  onClick={() => setIsFocusMode(!isFocusMode)}
                  className={
                    isFocusMode
                      ? "w-full mt-4 bg-slate-800 text-cyan-400 border border-cyan-500 py-2 rounded shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all font-semibold tracking-wide"
                      : "w-full mt-4 bg-transparent text-slate-400 border border-slate-600 py-2 rounded hover:text-slate-200 transition-colors tracking-wide"
                  }
                >
                  🎯 Odak Modu
                </button>
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
      <main className="flex-1 relative overflow-hidden bg-[#050505]">

        {/* EMPTY STATE */}
        {!activeScanId && (
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

        {/* LOADING OVERLAY */}
        {activeScanId && query.isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none select-none z-10">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
            <p className="text-xs font-mono text-blue-400 animate-pulse tracking-widest uppercase">
              Building Intelligence Graph...
            </p>
          </div>
        )}

        {/* GRAPH — mounted as soon as scan starts, updates when payload arrives */}
        {activeScanId && (
          <InvestigationGraph
            key={activeScanId} // <-- KÖK ÇÖZÜM: Target değiştiğinde React Flow DOM'dan silinip SIFIRDAN çizilecek
            payload={graphPayload ?? {}}
            onNodeClick={handleNodeClick}
            isFocusMode={isFocusMode}
            blastRadiusNode={blastRadiusNode}
            timelineDate={timelineDate}
          />
        )}

        {/* ── TIME-TRAVEL SLIDER UI ── */}
        {activeScanId && timelineBounds && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl z-40">
            <div className="bg-black/60 backdrop-blur-md border border-slate-800 p-4 rounded-xl shadow-[0_0_30px_rgba(0,0,0,0.8)] flex flex-col gap-2">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 tracking-widest uppercase">
                <span>İlk Keşif: {new Date(timelineBounds.min).toLocaleDateString()}</span>
                <span className="text-cyan-400 flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  Zaman Çizelgesi
                </span>
                <span>Şu An: {new Date(timelineBounds.max).toLocaleDateString()}</span>
              </div>
              
              <input
                type="range"
                min={timelineBounds.min}
                max={timelineBounds.max}
                step={1} // KÖK ÇÖZÜM: 1 Saatlik step kilitlenmeye yol açıyordu, 1 milisaniye olarak değiştirildi
                value={timelineDate ?? timelineBounds.max}
                onChange={(e) => setTimelineDate(Number(e.target.value))}
                disabled={timelineBounds.min === timelineBounds.max}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />
              
              <div className="text-center mt-1">
                <span className="px-3 py-1 bg-cyan-950/40 border border-cyan-900/50 text-cyan-400 rounded text-[11px] font-mono shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                  Gösterilen Zaman: {timelineDate ? new Date(timelineDate).toLocaleString() : 'Yükleniyor...'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(59,130,246,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────── */}
        {isPanelOpen && selectedNodeId && (
          <aside className="absolute right-0 top-0 h-full w-80 z-50 shadow-2xl">
            <NodeContextPanel
              payload={toContextPayload(graphPayload)}
              selectedNodeId={selectedNodeId}
              onClose={handleClosePanel}
              onBlastRadiusClick={(id) => {
                // Toggle blast radius
                if (blastRadiusNode === id) {
                  setBlastRadiusNode(null);
                } else {
                  setBlastRadiusNode(id);
                }
              }}
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