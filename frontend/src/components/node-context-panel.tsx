"use client";

import { useState, useEffect } from "react";
import { X, Shield, Clock, AlertTriangle, Globe, Hash, Tag, ChevronRight } from "lucide-react";
import { GraphPayload, GraphNode } from "@/types/osint.types";
import { api } from "@/lib/api";

interface NodeContextPanelProps {
  payload: GraphPayload;
  selectedNodeId: string | null;
  onClose: () => void;
  onBlastRadiusClick?: (nodeId: string) => void;
}

// Dynamically compute details based on node type and actual label data
function getDynamicNodeDetails(node: GraphNode) {
  const typeMap: Record<string, { label: string; icon: string; color: string }> = {
    domain:    { label: "Kök Alan Adı",   icon: "🌍", color: "text-blue-400"   },
    ip:        { label: "IP Adresi",      icon: "🖥️", color: "text-emerald-400"},
    email:     { label: "E-posta",        icon: "📧", color: "text-purple-400" },
    subdomain: { label: "Alt Alan Adı",   icon: "🔍", color: "text-violet-400" },
    location:  { label: "Coğrafi Konum",  icon: "📍", color: "text-fuchsia-400"},
    social:    { label: "Sosyal Medya",   icon: "🔗", color: "text-pink-400"   },
    api_key:   { label: "API Anahtarı",   icon: "🔑", color: "text-yellow-400" },
    hash:      { label: "Parola Hash",    icon: "🔒", color: "text-red-400"    },
    commit:    { label: "Git Commit",     icon: "💾", color: "text-slate-400"  },
    port:      { label: "Açık Servis",    icon: "🔌", color: "text-orange-400" },
    threat:    { label: "Zararlı Aktivite", icon: "☠️", color: "text-red-500"  },
    malicious_record: { label: "Zafiyet / Tehdit", icon: "☠️", color: "text-red-500" },
  };
  const type = typeMap[node.group ?? ""] ?? { label: "Bilinmeyen Hedef", icon: "❓", color: "text-slate-400" };

  // Default values
  let risk = { label: "BİLGİ", color: "text-blue-400", badge: "bg-blue-900/40 text-blue-400 border-blue-800" };
  let rationale = [`OSINT analizi ile tespit edildi: ${node.label}`];

  // Dynamically analyze based on node group and label content
  if (node.group === "threat" || node.group === "malicious_record") {
    const labelUpper = node.label.toUpperCase();
    if (labelUpper.includes("[CRITICAL]") || labelUpper.includes("CRITICAL:")) {
      risk = { label: "KRİTİK", color: "text-red-500", badge: "bg-red-900 text-white border-red-500 animate-pulse" };
      rationale = ["Ağ kritik seviyede tehlikede.", `Tespit Edilen Zafiyet: ${node.label}`];
    } else if (labelUpper.includes("[HIGH]") || labelUpper.includes("HIGH:")) {
      risk = { label: "YÜKSEK", color: "text-orange-500", badge: "bg-orange-900/40 text-orange-500 border-orange-800" };
      rationale = ["Yüksek riskli güvenlik açığı bulundu.", `Detay: ${node.label}`];
    } else if (labelUpper.includes("[MEDIUM]") || labelUpper.includes("MEDIUM:")) {
      risk = { label: "ORTA", color: "text-yellow-400", badge: "bg-yellow-900/40 text-yellow-400 border-yellow-800" };
      rationale = ["Orta seviye risk tespit edildi.", `Detay: ${node.label}`];
    } else if (labelUpper.includes("[LOW]") || labelUpper.includes("LOW:")) {
      risk = { label: "DÜŞÜK", color: "text-green-400", badge: "bg-green-900/40 text-green-400 border-green-800" };
      rationale = ["Düşük öncelikli yapılandırma veya bilgi sızıntısı.", `Detay: ${node.label}`];
    } else if (labelUpper.includes("[INFO]") || labelUpper.includes("INFO:")) {
      risk = { label: "BİLGİ", color: "text-blue-400", badge: "bg-blue-900/40 text-blue-400 border-blue-800" };
      rationale = ["Yalnızca bilgi amaçlı bir kayıt (Zafiyet değil).", `Açıklama: ${node.label}`];
    } else if (labelUpper.includes("TARGET RESOLUTION FAILED")) {
      risk = { label: "HATA", color: "text-slate-400", badge: "bg-slate-900/40 text-slate-400 border-slate-800" };
      rationale = ["Sistem hedefe ulaşamadı veya hedef geçersiz.", "DNS çözümleme başarısız."];
    } else {
      risk = { label: "BİLİNMEYEN", color: "text-orange-400", badge: "bg-orange-900/40 text-orange-400 border-orange-800" };
      rationale = ["Otomatik tarama tarafından zararlı kayıt olarak işaretlendi.", `Log: ${node.label}`];
    }
  } else if (node.group === "port") {
    risk = { label: "BİLGİ", color: "text-blue-400", badge: "bg-blue-900/40 text-blue-400 border-blue-800" };
    rationale = ["Hedefte açık port/servis keşfedildi.", `Servis Tespiti: ${node.label}`];
  } else if (node.group === "location") {
    risk = { label: "BİLGİ", color: "text-green-400", badge: "bg-green-900/40 text-green-400 border-green-800" };
    rationale = [`IP Geolocation API üzerinden doğrulandı: ${node.label}`];
  }

  return { type, risk, rationale };
}

export function NodeContextPanel({ payload, selectedNodeId, onClose, onBlastRadiusClick }: NodeContextPanelProps) {
  const selectedNode = payload?.nodes?.find((n) => n.id === selectedNodeId) ?? null;

  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    if (!selectedNodeId) {
      setAiRationale(null);
      return;
    }

    let isMounted = true;
    setIsAiLoading(true);
    setAiRationale(null);

    api.fetchAiRationale(selectedNodeId)
      .then((data) => {
        if (isMounted) {
          setAiRationale(data.rationale);
          setIsAiLoading(false);
        }
      })
      .catch((err) => {
        console.error("AI Rationale Fetch Error:", err);
        if (isMounted) {
          setIsAiLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedNodeId]);

  // ── EMPTY STATE ──────────────────────────────────────────────────────────────
  if (!selectedNode) {
    return (
      <div className="flex flex-col h-full bg-[#0a0f1e] border-l border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-black/40">
          <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500">
            İstihbarat Paneli
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Empty body */}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center select-none bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900/40 to-transparent">
          <div className="w-14 h-14 rounded-full bg-slate-900/80 border border-slate-800 flex items-center justify-center shadow-lg">
            <Globe className="w-6 h-6 text-slate-700" />
          </div>
          <p className="text-sm text-slate-600 leading-relaxed font-mono mt-2">
            Awaiting Target Selection...
          </p>
        </div>
      </div>
    );
  }

  // ── DETAIL STATE ─────────────────────────────────────────────────────────────
  const { type, risk, rationale } = getDynamicNodeDetails(selectedNode);

  // Akıllı Ayrıştırma: Port bilgisini böl (Örn: "2083/cPanel-HTTPS")
  let portNumber = "";
  let portService = "";
  if (selectedNode.group === "port" && selectedNode.label.includes("/")) {
    const parts = selectedNode.label.split("/");
    portNumber = parts[0];
    portService = parts.slice(1).join("/");
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0f1e] border-l border-slate-800 overflow-y-auto shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 shrink-0 bg-black/40">
        <span className="text-[10px] font-bold tracking-widest uppercase text-slate-500">
          Düğüm Analizi
        </span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-950/30 transition-colors"
          aria-label="Kapat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Node identity card */}
      <div className="px-5 py-5 border-b border-slate-800/60 bg-gradient-to-b from-slate-900/30 to-transparent">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-lg bg-slate-950 border border-slate-700/60 flex items-center justify-center text-2xl shrink-0 shadow-inner">
            {type.icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-bold uppercase tracking-widest ${type.color} mb-1 opacity-80`}>
              {type.label}
            </p>
            {/* Akıllı Ayrıştırma UI: Düz string yerine özel Port gösterimi */}
            {selectedNode.group === "port" && portNumber ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 rounded bg-[#1e1100] border border-orange-900/50 text-orange-400 font-mono text-sm font-bold shadow-sm">
                  {portNumber}
                </span>
                <span className="text-slate-300 text-sm font-medium tracking-wide">
                  {portService}
                </span>
              </div>
            ) : (
              <p className="text-sm font-mono text-slate-100 break-all leading-snug">
                {selectedNode.label}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Detail rows */}
      <div className="px-5 py-5 space-y-3">
        <p className="text-[10px] font-bold tracking-widest uppercase text-slate-600 mb-4 flex items-center gap-2">
          <ChevronRight className="w-3 h-3" /> İstihbarat Metrikleri
        </p>

        {/* Node ID */}
        <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-900/40 border border-slate-800/80 hover:bg-slate-900/60 transition-colors">
          <div className="flex items-center gap-2 text-slate-500">
            <Hash className="w-3.5 h-3.5" />
            <span className="text-xs">Düğüm ID</span>
          </div>
          <span className="text-xs font-mono text-slate-400 truncate max-w-[120px]" title={selectedNode.id}>
            {selectedNode.id.substring(0, 12)}...
          </span>
        </div>

        {/* Risk score - BADGE UI */}
        <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-900/40 border border-slate-800/80 hover:bg-slate-900/60 transition-colors">
          <div className="flex items-center gap-2 text-slate-500">
            <Shield className="w-3.5 h-3.5" />
            <span className="text-xs">Risk Skoru</span>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${risk.badge} shadow-sm`}>
            {risk.label}
          </span>
        </div>

        {/* Explainable Score Rationale */}
        <div className="bg-[#050505] border border-slate-800 rounded-lg p-3 mt-2 shadow-inner min-h-[80px]">
          <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500 mb-2 font-bold flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${isAiLoading ? 'bg-cyan-500 animate-pulse' : 'bg-cyan-500'}`}></span>
            Güvenilirlik Gerekçesi (AI Rationale)
          </p>
          
          {isAiLoading ? (
            <div className="space-y-2 py-1">
              <div className="h-2 bg-slate-800 rounded animate-pulse w-3/4"></div>
              <div className="h-2 bg-slate-800 rounded animate-pulse w-full"></div>
              <div className="h-2 bg-slate-800 rounded animate-pulse w-5/6"></div>
              <p className="text-[10px] text-cyan-600/70 font-mono mt-2 animate-pulse">AI is thinking...</p>
            </div>
          ) : aiRationale ? (
            <p className="text-xs text-slate-300 font-sans leading-relaxed">
              {aiRationale}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rationale.map((reason, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs text-slate-400 font-sans leading-snug">
                  <svg className="w-3.5 h-3.5 text-cyan-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Last seen */}
        <div className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-900/40 border border-slate-800/80 hover:bg-slate-900/60 transition-colors">
          <div className="flex items-center gap-2 text-slate-500">
            <Clock className="w-3.5 h-3.5" />
            <span className="text-xs">Sondaj Vakti</span>
          </div>
          <span className="text-xs font-mono text-emerald-500/80">LIVE</span>
        </div>

        {/* ── BLAST RADIUS ANALYZER BUTTON ── */}
        <div className="pt-4">
          <button
            onClick={() => onBlastRadiusClick?.(selectedNode.id)}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-xs uppercase tracking-widest transition-all duration-300 bg-red-950/40 text-red-400 border border-red-900/50 hover:bg-red-900/60 shadow-[0_0_15px_rgba(220,38,38,0.2)] hover:shadow-[0_0_20px_rgba(220,38,38,0.4)]"
          >
            <AlertTriangle className="w-4 h-4" />
            ☢️ BLAST RADİUS ANALİZİ
          </button>
        </div>
      </div>

      {/* Raw label section - TERMINAL THEME */}
      <div className="px-5 pb-6 mt-auto">
        <div className="rounded-lg bg-[#050505] border border-slate-800 p-3 shadow-[inset_0_0_10px_rgba(0,0,0,0.8)] relative overflow-hidden">
          {/* Mac-style Window Controls */}
          <div className="flex items-center gap-1.5 mb-3 opacity-80">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span className="text-[9px] uppercase tracking-[0.2em] text-slate-600 ml-2 font-bold font-sans">
              Terminal / Raw Payload
            </span>
          </div>
          
          {/* Terminal Screen */}
          <div className="font-mono text-xs text-green-400 break-all leading-relaxed bg-black/80 p-2.5 rounded border border-[#111] relative">
            <div className="absolute top-0 left-0 w-full h-full bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] pointer-events-none opacity-20"></div>
            <span className="text-slate-600 mr-2 select-none">$</span>
            <span className="text-green-300">{selectedNode.label}</span>
            <span className="inline-block w-2 h-3.5 bg-green-400 animate-pulse ml-1 align-middle opacity-80"></span>
          </div>
        </div>
      </div>
    </div>
  );
}
