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
import { ChatCopilot } from "@/components/chat-copilot";
import { api, ApiGraphPayload } from "@/lib/api";
import { Activity, Crosshair, Loader2, Network, ScanLine, Clock, FileText, FileSpreadsheet, Menu } from "lucide-react";

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isKillChainMode, setIsKillChainMode] = useState(false);
  const [blastRadiusNode, setBlastRadiusNode] = useState<string | null>(null);
  const [timelineDate, setTimelineDate] = useState<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState(false);

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
        if (newData.is_scan_completed) {
          setIsScanning(false);
          // Geç gelen Amass/Nuclei SCAN_COMPLETED sinyallerinin hata durumunu (kırmızı ekranı) yeşile çevirmesini engelle
          setScanError((prev) => prev || newData.has_error === true);
          return;
        }
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

  // ── YENİ: Fallback Polling (Eğer WS sinyali kaçırırsa) ──────────────────────
  useEffect(() => {
    if (!activeScanId || !isScanning) return;
    
    const intervalId = setInterval(() => {
      api.fetchTargetStatus(activeScanId)
        .then((data) => {
          if (data.status === "COMPLETED") {
            console.log("[POLLING] Scan marked as COMPLETED via fallback.");
            setIsScanning(false);
            // Tüm grafik verilerini tazelemek için önbelleği geçersiz kıl
            queryClient.invalidateQueries({ queryKey: ["graph", activeScanId] });
          }
        })
        .catch((err) => console.error("Fallback polling error:", err));
    }, 5000);

    return () => clearInterval(intervalId);
  }, [activeScanId, isScanning, queryClient]);

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

  // ── YENİ: Fatal Error Fallback Koruması ────────────────────────────────────
  // Eğer DNS hatası biz WS'e bağlanmadan önce fırlatılırsa, SCAN_FAILED sinyalini kaçırırız.
  // Bu yüzden gelen Graf payload'ının içinde hata nodu olup olmadığını kontrol edip durduruyoruz.
  useEffect(() => {
    if (graphPayload?.nodes?.some(n => n.label.includes("Target Resolution Failed"))) {
      setIsScanning(false);
      setScanError(true);
    }
  }, [graphPayload]);

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

  /**
   * ROOT LAYOUT
   * ┌────────────┬──────────────────────────┬──────────────┐
   * │ Left (320) │    Center (flex-1)       │ Right (320)  │
   * │ z-10       │    position:relative     │ z-10         │
   * │            │    overflow:hidden       │              │
   * └────────────┴──────────────────────────┴──────────────┘
   */
  return (
    <div className="h-screen w-screen bg-neutral-950 text-gray-200 overflow-hidden flex flex-col md:flex-row font-sans">

      {/* ── MOBILE TOP BAR ───────────────────────────────────────────────── */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-neutral-800 bg-neutral-900 z-50 shrink-0 shadow-lg">
        <div className="flex items-center gap-2">
          <Crosshair className="w-5 h-5 text-blue-500" />
          <h1 className="text-lg font-black tracking-[0.15em] text-white">
            NEXUS<span className="text-blue-500">OSINT</span>
          </h1>
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* ── MOBILE MENU OVERLAY ─────────────────────────────────────────── */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-[55] md:hidden backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-[60] w-80 flex flex-col
          bg-neutral-900 border-r border-neutral-800
          shadow-2xl transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
          md:relative md:translate-x-0 md:shrink-0
        `}
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
            setIsScanning(true);
            setScanError(false);
            setTimelineDate(null); // KÖK ÇÖZÜM: Yeni taramada eski taramanın zaman kilitlenmesini sıfırla!
            setBlastRadiusNode(null);
            setSelectedNodeId(null);
            setIsPanelOpen(false);
            setIsMobileMenuOpen(false);
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

              {/* ── YENİ: Scan in Progress Indicator ───────────────────────── */}
              <div className={`p-4 rounded-lg border transition-all duration-500 
                ${isScanning ? "bg-blue-950/20 border-blue-900/50" : 
                  (scanError ? "bg-red-950/20 border-red-900/50" : "bg-emerald-950/20 border-emerald-900/50")}
              `}>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    {isScanning ? (
                      <div className="relative flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        <div className="absolute w-5 h-5 border-2 border-cyan-400 border-b-transparent rounded-full animate-[spin_2s_linear_infinite_reverse] opacity-50"></div>
                      </div>
                    ) : (
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 
                        ${scanError ? "bg-red-500/20 border-red-500" : "bg-emerald-500/20 border-emerald-500"}`}>
                        <span className={`text-[10px] font-black ${scanError ? "text-red-400" : "text-emerald-400"}`}>
                          {scanError ? "✕" : "✓"}
                        </span>
                      </div>
                    )}
                    <h3 className={`text-xs font-bold uppercase tracking-widest 
                      ${isScanning ? "text-blue-400 animate-pulse" : (scanError ? "text-red-400" : "text-emerald-400")}`}>
                      {isScanning ? "Scanning In Progress" : (scanError ? "Scan Complete (Failed)" : "Scan Complete")}
                    </h3>
                  </div>
                  <p className="text-[10px] text-neutral-400 font-mono leading-relaxed">
                    {isScanning 
                      ? "Deep Vulnerability Scan (Nuclei/Amass) is currently running in the background. Nodes will populate in real-time."
                      : (scanError 
                          ? "Target resolution failed or an error occurred during the background scan. Please check your input." 
                          : "All automated background OSINT and vulnerability scans have successfully finished.")}
                  </p>
                </div>
              </div>

              {/* ── YENİ TASARIM: Export Buttons ────────────────────────────────────────────── */}
              <div className="pt-5 mt-4 border-t border-slate-800/60">
                <p className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-3 flex items-center gap-2">
                  Dışa Aktarım (Export)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/export/${activeScanId}/pdf`}
                    download
                    className="group relative flex flex-col items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-br from-red-950/40 to-slate-900/40 hover:from-red-900/40 hover:to-red-950/60 border border-red-900/30 hover:border-red-500/50 transition-all duration-300 shadow-sm hover:shadow-[0_0_15px_rgba(239,68,68,0.15)] overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <FileText className="w-5 h-5 text-red-400 group-hover:scale-110 transition-transform duration-300" />
                    <span className="text-[10px] font-bold text-slate-300 group-hover:text-red-300 transition-colors tracking-wide">PDF RAPOR</span>
                  </a>

                  <a
                    href={`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/export/${activeScanId}/csv`}
                    download
                    className="group relative flex flex-col items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-br from-emerald-950/40 to-slate-900/40 hover:from-emerald-900/40 hover:to-emerald-950/60 border border-emerald-900/30 hover:border-emerald-500/50 transition-all duration-300 shadow-sm hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <FileSpreadsheet className="w-5 h-5 text-emerald-400 group-hover:scale-110 transition-transform duration-300" />
                    <span className="text-[10px] font-bold text-slate-300 group-hover:text-emerald-300 transition-colors tracking-wide">CSV VERİSİ</span>
                  </a>
                </div>
              </div>
              
              <div className="space-y-2 mt-2">
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

                {/* ── KILL-CHAIN MODE BUTTON ── */}
                <button
                  onClick={() => setIsKillChainMode(!isKillChainMode)}
                  className={
                    isKillChainMode
                      ? "w-full mt-2 bg-red-950 text-red-400 border border-red-500 py-2 rounded shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all font-semibold tracking-wide flex items-center justify-center gap-2"
                      : "w-full mt-2 bg-transparent text-slate-400 border border-slate-600 py-2 rounded hover:text-red-300 hover:border-red-900/50 transition-colors tracking-wide flex items-center justify-center gap-2"
                  }
                >
                  ☠️ Kill-Chain Path
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
            isKillChainMode={isKillChainMode}
            blastRadiusNode={blastRadiusNode}
            timelineDate={timelineDate}
          />
        )}

        {/* ── TIME-TRAVEL SLIDER UI ── */}
        {activeScanId && timelineBounds && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] md:w-full max-w-2xl z-40">
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
          <aside className="absolute right-0 top-0 h-full w-full md:w-[340px] z-50 shadow-[-10px_0_30px_rgba(0,0,0,0.5)] transition-all animate-in slide-in-from-right-8 duration-300">
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

        {/* ── CHAT COPILOT ─────────────────────────────────────────────────── */}
        <ChatCopilot activeScanId={activeScanId} />
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