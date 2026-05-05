import { GraphPayload, GraphNode } from "../../types/osint.types";
import { X, Globe, Server, Mail, Share2, HelpCircle, ShieldAlert } from "lucide-react";

interface Props {
  payload: GraphPayload;
  selectedNodeId: string | null;
  onClose: () => void;
}

const TYPE_CONFIG: Record<string, { color: string; bg: string; border: string; Icon: React.ElementType; label: string }> = {
  domain: {
    color: "text-blue-300",
    bg: "bg-blue-950/60",
    border: "border-blue-700/50",
    Icon: Globe,
    label: "Domain",
  },
  ip: {
    color: "text-emerald-300",
    bg: "bg-emerald-950/60",
    border: "border-emerald-700/50",
    Icon: Server,
    label: "IP Address",
  },
  email: {
    color: "text-amber-300",
    bg: "bg-amber-950/60",
    border: "border-amber-700/50",
    Icon: Mail,
    label: "Email",
  },
  social: {
    color: "text-purple-300",
    bg: "bg-purple-950/60",
    border: "border-purple-700/50",
    Icon: Share2,
    label: "Social",
  },
};

const FALLBACK_CONFIG = {
  color: "text-slate-300",
  bg: "bg-slate-900/60",
  border: "border-slate-700/50",
  Icon: HelpCircle,
  label: "Unknown",
};

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1">{label}</p>
      <p
        className={`text-sm text-gray-200 bg-black/40 px-3 py-2 rounded border border-neutral-800 break-all ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export const NodeContextPanel = ({ payload, selectedNodeId, onClose }: Props) => {
  const node: GraphNode | undefined = payload.nodes.find(
    (n) => String(n.id) === String(selectedNodeId)
  );

  const group = node?.group ?? "unknown";
  const cfg = TYPE_CONFIG[group] ?? FALLBACK_CONFIG;
  const { Icon } = cfg;

  // Count connections for this node
  const connectionCount = payload.links.filter(
    (l) => String((l as any).source?.id ?? l.source) === String(selectedNodeId) ||
            String((l as any).target?.id ?? l.target) === String(selectedNodeId)
  ).length;

  return (
    <div
      className="h-full flex flex-col bg-neutral-900"
      style={{ animation: "slideInRight 0.2s ease-out" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 bg-neutral-950/60">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-blue-500" />
          <span className="text-xs font-bold text-neutral-300 uppercase tracking-widest">
            Node Intel
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {!node ? (
          <div className="flex flex-col items-center justify-center h-32 text-neutral-600 text-sm gap-2">
            <HelpCircle className="w-8 h-8" />
            <p>Node data not found</p>
          </div>
        ) : (
          <>
            {/* Type badge */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${cfg.bg} ${cfg.border}`}>
              <Icon className={`w-5 h-5 ${cfg.color}`} />
              <div>
                <p className={`text-xs font-bold uppercase tracking-wider ${cfg.color}`}>{cfg.label}</p>
                <p className="text-[10px] text-neutral-500 font-mono mt-0.5">group: {group}</p>
              </div>
            </div>

            {/* Fields */}
            <Field label="Identifier" value={node.label} mono />
            <Field label="Internal ID" value={String(node.id)} mono />

            {/* Connections */}
            <div>
              <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-1">Connections</p>
              <div className="flex items-center gap-2 bg-black/40 px-3 py-2 rounded border border-neutral-800">
                <span className="text-2xl font-black text-blue-400">{connectionCount}</span>
                <span className="text-xs text-neutral-500">edge{connectionCount !== 1 ? "s" : ""} in graph</span>
              </div>
            </div>

            {/* Connected edges list */}
            {connectionCount > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-widest mb-2">Relations</p>
                <div className="space-y-1.5">
                  {payload.links
                    .filter(
                      (l) =>
                        String((l as any).source?.id ?? l.source) === String(selectedNodeId) ||
                        String((l as any).target?.id ?? l.target) === String(selectedNodeId)
                    )
                    .map((l, i) => {
                      const srcId = String((l as any).source?.id ?? l.source);
                      const tgtId = String((l as any).target?.id ?? l.target);
                      const otherId = srcId === String(selectedNodeId) ? tgtId : srcId;
                      const direction = srcId === String(selectedNodeId) ? "→" : "←";
                      const otherNode = payload.nodes.find((n) => String(n.id) === otherId);
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-xs font-mono bg-black/30 px-2 py-1.5 rounded border border-neutral-800/60"
                        >
                          <span className="text-blue-500">{direction}</span>
                          <span className="text-neutral-400 truncate">{otherNode?.label ?? otherId}</span>
                          {l.label && (
                            <span className="ml-auto text-[10px] text-neutral-600 shrink-0">{l.label}</span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-950/40">
        <p className="text-[10px] text-neutral-600 font-mono text-center">
          NEXUSOSINT · PHASE 1 MVP
        </p>
      </div>
    </div>
  );
};