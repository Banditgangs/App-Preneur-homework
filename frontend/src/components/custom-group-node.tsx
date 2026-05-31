import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react';

export function CustomGroupNode({ id, data, selected }: NodeProps) {
  const { setNodes, setEdges, getNodes, getEdges } = useReactFlow();
  
  const isCollapsed = data.isCollapsed || false;

  const toggleCollapse = () => {
    const nodes = getNodes();
    const edges = getEdges();
    
    // İçindeki çocukları (Child Nodes) bul
    const childNodes = nodes.filter(n => n.parentNode === id);
    const childIds = new Set(childNodes.map(n => n.id));
    
    // Çocukların görünürlüğünü (hidden) tetikle
    setNodes(nodes.map(n => {
      if (n.parentNode === id) {
        return { ...n, hidden: !isCollapsed };
      }
      return n;
    }));
    
    // Çocuklara bağlı olan bağları (Edges) da gizle/göster
    setEdges(edges.map(e => {
      if (childIds.has(e.source) || childIds.has(e.target)) {
        return { ...e, hidden: !isCollapsed };
      }
      return e;
    }));
    
    // Kendi (Parent) durumunu güncelle (isCollapsed state'i kaydet)
    setNodes(ns => ns.map(n => {
      if (n.id === id) {
        return { ...n, data: { ...n.data, isCollapsed: !isCollapsed } };
      }
      return n;
    }));
  };

  return (
    <div 
      className={`relative flex flex-col bg-slate-900/30 border-2 border-dashed ${selected ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-slate-700/80'} rounded-xl backdrop-blur-sm transition-all duration-300`} 
      style={{ 
        width: data.width, 
        height: isCollapsed ? 45 : data.height, 
        overflow: 'hidden' 
      }}
    >
      {/* ── Kapsayıcı Başlığı (Header) ── */}
      <div 
        className="flex items-center justify-between px-4 py-2.5 bg-slate-950/80 border-b border-slate-800/80 cursor-pointer hover:bg-slate-900 transition-colors z-10" 
        onClick={toggleCollapse}
      >
        <div className="flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-black text-slate-200 tracking-widest uppercase">{data.label}</span>
          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400">
             {data.childCount || 0}
          </span>
        </div>
        <button className="text-slate-400 hover:text-white transition-colors p-1 bg-slate-800/50 rounded-full">
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      
      {/* ── İçerik Alanı (Body) ── */}
      {/* Çocuklar React Flow'un parentNode matematiği ile fiziksel olarak buraya oturacaktır. */}
      
      {/* Görünmez bağlantı noktaları (Kenarların bu gruba da bağlanabilmesi için) */}
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  );
}
