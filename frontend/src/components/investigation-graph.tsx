"use client";

import React, { useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  BackgroundVariant,
  Node,
  Edge,
  ReactFlowProvider,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { ApiGraphPayload } from '@/lib/api';
import { CustomGroupNode } from './custom-group-node';

// ── Register Custom Group Node ───────────────────────────────────────────────
const nodeTypes = { customGroup: CustomGroupNode };

// ── Fallback nodes/edges: shown before any scan is started ──────────────────
const fallbackNodes: Node[] = [
  {
    id: 'placeholder-1',
    position: { x: 250, y: 200 },
    data: { label: '🎯 Hedef bekleniyor...' },
    style: { background: '#0f172a', color: '#475569', border: '1px dashed #334155', borderRadius: '8px', padding: '10px', fontSize: '12px' },
  },
];
const fallbackEdges: Edge[] = [];

// ── Group → style mapping ────────────────────────────────────────────────────
const groupStyle: Record<string, React.CSSProperties> = {
  domain:    { background: '#0f172a', color: '#fff',     border: '2px solid #3b82f6', borderRadius: '10px', padding: '10px', fontSize: '12px', fontWeight: 600 },
  ip:        { background: '#020617', color: '#67e8f9',  border: '1px solid #0e7490', borderRadius: '8px',  padding: '10px', fontSize: '11px' },
  email:     { background: '#0a0022', color: '#c084fc',  border: '1px solid #7e22ce', borderRadius: '8px',  padding: '10px', fontSize: '11px' },
  subdomain: { background: '#1a0033', color: '#d8b4fe',  border: '2px solid #9333ea', borderRadius: '8px',  padding: '10px', fontSize: '11px', fontStyle: 'italic' },
  location:  { background: '#001a0a', color: '#86efac',  border: '2px solid #16a34a', borderRadius: '8px',  padding: '10px', fontSize: '11px' },
  api_key:   { background: '#1a0c00', color: '#fbbf24',  border: '1px solid #b45309', borderRadius: '8px',  padding: '10px', fontSize: '11px' },
  hash:      { background: '#1a0000', color: '#f87171',  border: '1px solid #b91c1c', borderRadius: '8px',  padding: '10px', fontSize: '11px' },
  commit:    { background: '#0a0f1e', color: '#94a3b8',  border: '1px solid #475569', borderRadius: '8px',  padding: '10px', fontSize: '11px' },
  unknown:   { background: '#111827', color: '#9ca3af',  border: '1px solid #374151', borderRadius: '8px',  padding: '10px', fontSize: '11px' },
  port:      { background: '#301000', color: '#fdba74',  border: '2px solid #ea580c', borderRadius: '8px',  padding: '10px', fontSize: '11px' },
  threat:    { background: '#300000', color: '#fca5a5',  border: '2px solid #dc2626', borderRadius: '8px',  padding: '12px', fontSize: '12px', fontWeight: 'bold' },
};

const groupIcon: Record<string, string> = {
  domain: '🌍', ip: '🖥️', email: '📧', subdomain: '🔍',
  location: '📍', api_key: '🔑', hash: '🔒', commit: '💾', unknown: '❓', port: '🔌', threat: '☠️'
};

// ── Edge style mapping ───────────────────────────────────────────────────────
const edgeColorMap: Record<string, string> = {
  EMAIL:    '#a855f7',
  SUBDOMAIN:'#9333ea',
  LOCATION: '#16a34a',
  IP:       '#0e7490',
  API_KEY:  '#f59e0b',
  PWD_HASH: '#ef4444',
  COMMIT:   '#64748b',
  PORT:     '#ea580c',
  THREAT:   '#dc2626',
};

// ── Layout: Arrange Parents in Circle, Children in Grid ───────────────────────
function computePositions(apiNodes: ApiGraphPayload['nodes']): {
  positions: Record<string, { x: number; y: number }>;
  dimensions: Record<string, { width: number; height: number }>;
} {
  const positions: Record<string, { x: number; y: number }> = {};
  const dimensions: Record<string, { width: number; height: number }> = {};
  
  const center = apiNodes.find(n => n.group === 'domain') || apiNodes[0];
  if (!center) return { positions, dimensions };

  positions[center.id] = { x: 400, y: 300 };

  const parents = apiNodes.filter(n => n.group === 'parent_node');
  
  // 1. Arrange Children inside Parents (Grid Relative Placement)
  parents.forEach(parent => {
    const children = apiNodes.filter(n => n.parentNode === parent.id);
    
    const cols = Math.max(1, Math.ceil(Math.sqrt(children.length)));
    const padding = 20;
    const headerHeight = 55;
    const nodeWidth = 140; 
    const nodeHeight = 40;
    const gap = 15;
    
    children.forEach((child, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Relative coordinates
      positions[child.id] = {
        x: padding + col * (nodeWidth + gap),
        y: headerHeight + padding + row * (nodeHeight + gap)
      };
    });
    
    // Calculate Parent Dimensions automatically based on children count
    const rows = Math.ceil(children.length / cols);
    dimensions[parent.id] = {
      width: children.length === 0 ? 250 : padding * 2 + cols * nodeWidth + (cols - 1) * gap,
      height: children.length === 0 ? 100 : headerHeight + padding * 2 + rows * nodeHeight + (rows - 1) * gap
    };
  });
  
  // 2. Arrange Parents + Orphans in a circle around the center domain
  const outerNodes = apiNodes.filter(n => n.id !== center.id && !n.parentNode);
  // Yarıçapı grupların büyüklüğüne göre genişletiyoruz
  const radius = Math.max(400, outerNodes.length * 150);
  
  outerNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / outerNodes.length - Math.PI / 2;
    positions[node.id] = {
      x: 400 + radius * Math.cos(angle) - (dimensions[node.id]?.width ?? 150) / 2,
      y: 300 + radius * Math.sin(angle) - (dimensions[node.id]?.height ?? 50) / 2,
    };
  });
  
  return { positions, dimensions };
}

// ── Kusursuz BFS & Tehdit Odaklı (Threat-Focused) Algoritma ────────────────
function computeBlastRadiusIds(apiNodes: ApiGraphPayload['nodes'], apiEdges: ApiGraphPayload['links'], startNodeId: string): Set<string> {
  const startNode = apiNodes.find(n => n.id === startNodeId);
  const isRootDomain = startNode?.group === 'domain';

  // 1. EĞER TIKLANAN KÖK DEĞİLSE (Yatay Hareket / Lateral Movement): Standart tam yayılım
  if (!isRootDomain) {
    const newVisitedNodes = new Set<string>();
    const newVisitedEdges = new Set<string>();
    const queue = [startNodeId];
    
    newVisitedNodes.add(startNodeId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      apiEdges.forEach(edge => {
        const edgeId = `${edge.source}-${edge.target}`;
        if (edge.source === currentId && !newVisitedEdges.has(edgeId)) {
          newVisitedEdges.add(edgeId);
          if (!newVisitedNodes.has(edge.target)) {
            newVisitedNodes.add(edge.target);
            queue.push(edge.target);
          }
        }
      });

      apiNodes.forEach(node => {
        if (node.parentNode === currentId && !newVisitedNodes.has(node.id)) {
          newVisitedNodes.add(node.id);
          queue.push(node.id);
        }
      });
    }
    return new Set<string>([...newVisitedNodes, ...newVisitedEdges]);
  }

  // 2. EĞER TIKLANAN KÖK DOMAIN İSE (Akıllı Tehdit Önceliklendirme)
  const visited = new Set<string>();
  const queue = [startNodeId];
  visited.add(startNodeId);

  // Geriye dönük iz sürmek için ebeveyn haritası (Backtracking Map)
  const cameFrom = new Map<string, { nodeId: string, edgeId?: string }>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    apiEdges.forEach(edge => {
      if (edge.source === currentId) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          cameFrom.set(edge.target, { nodeId: currentId, edgeId: `${edge.source}-${edge.target}` });
          queue.push(edge.target);
        }
      }
    });

    apiNodes.forEach(node => {
      if (node.parentNode === currentId && !visited.has(node.id)) {
        visited.add(node.id);
        cameFrom.set(node.id, { nodeId: currentId }); // Sanal kenar (Edge ID yok)
        queue.push(node.id);
      }
    });
  }

  // Yüksek Riskli Düğümleri Tespit Et (Kritik filtreleme)
  const highRiskNodes = apiNodes.filter(n => {
    if (!visited.has(n.id)) return false;
    if (n.group === 'threat') return true; // Virustotal zararlı kayıtları
    if (n.group === 'port' && n.label !== '80' && n.label !== '443') return true; // Standart dışı portlar
    if (n.group === 'api_key' || n.group === 'hash') return true; // Sızıntılar
    return false;
  });

  const finalBlastRadius = new Set<string>();
  finalBlastRadius.add(startNodeId);

  // Hedeflenen yüksek riskli düğümlerden geriye doğru (root'a kadar) yolu aydınlat
  highRiskNodes.forEach(dangerNode => {
    let curr = dangerNode.id;
    while (curr !== startNodeId) {
      finalBlastRadius.add(curr);
      const step = cameFrom.get(curr);
      if (!step) break; // Kırık bağ toleransı
      if (step.edgeId) {
        finalBlastRadius.add(step.edgeId);
      }
      curr = step.nodeId;
    }
  });

  return finalBlastRadius;
}

// ── Conversion helpers ───────────────────────────────────────────────────────
function toReactFlowNodes(
  apiNodes: ApiGraphPayload['nodes'], 
  isFocusMode: boolean,
  blastRadiusPath: Set<string>,
  timelineDate: number | null
): Node[] {
  const { positions, dimensions } = computePositions(apiNodes);
  const isBlastMode = blastRadiusPath.size > 0;
  
  return apiNodes.map((n) => {
    const isParent = n.group === 'parent_node';
    const childCount = apiNodes.filter(c => c.parentNode === n.id).length;
    
    // Timeline Logic with Fallback for older data
    const hasDate = !!n.discovery_date;
    const nodeDate = hasDate ? new Date(n.discovery_date as string).getTime() : 0;
    const isFuture = hasDate && timelineDate !== null && nodeDate > timelineDate;
    
    // Blast Radius & Focus Logic
    const inBlastRadius = blastRadiusPath.has(n.id);
    const isCritical = n.group === 'domain' || n.group === 'threat' || n.id === 'group_threats';
    
    let opacity = 1;
    let pointerEvents: 'auto' | 'none' = 'auto';
    
    if (isFuture) {
      opacity = 0;
      pointerEvents = 'none';
    } else if (isBlastMode) {
      opacity = inBlastRadius ? 1 : 0.15;
    } else if (isFocusMode && !isCritical) {
      opacity = 0.4;
    }
    
    const node: Node = {
      id: n.id,
      position: positions[n.id] ?? { x: 0, y: 0 },
      hidden: isFuture, // KÖK ÇÖZÜM 2: CSS Opacity yerine React Flow native hidden özelliği
      data: { 
        label: isParent ? n.label : `${groupIcon[n.group] ?? '❓'} ${n.label}`,
        width: dimensions[n.id]?.width,
        height: dimensions[n.id]?.height,
        childCount
      },
    };

    if (n.parentNode) {
      node.parentNode = n.parentNode;
      // KÖK ÇÖZÜM 1: 'node.extent = parent' kısıtlaması kaldırıldı!
      // React Flow henüz parent boyutunu ölçemediğinde çocukları 0x0 alanına sıkıştırıp yok ediyordu.
    }

    if (isParent) {
      node.type = 'customGroup';
      node.style = { zIndex: -1, opacity, pointerEvents, transition: 'all 0.5s ease' };
      if (isBlastMode && inBlastRadius) {
        node.style = { ...node.style, border: '2px dashed #ef4444', backgroundColor: 'rgba(239,68,68,0.1)' };
      }
    } else {
      let style: any = { ...(groupStyle[n.group] ?? groupStyle.unknown), opacity, pointerEvents, transition: 'all 0.5s ease' };
      if (isBlastMode && inBlastRadius) {
        style = { ...style, border: '2px solid #ef4444', boxShadow: '0 0 15px rgba(239,68,68,0.5)', background: '#450a0a' };
      }
      node.style = style;
    }

    return node;
  });
}

function toReactFlowEdges(
  apiEdges: ApiGraphPayload['links'], 
  apiNodes: ApiGraphPayload['nodes'], 
  isFocusMode: boolean,
  blastRadiusPath: Set<string>,
  timelineDate: number | null
): Edge[] {
  const criticalIds = new Set(apiNodes.filter(n => n.group === 'domain' || n.group === 'threat' || n.id === 'group_threats').map(n => n.id));
  const isBlastMode = blastRadiusPath.size > 0;
  
  return apiEdges.map((e) => {
    const sourceNode = apiNodes.find(n => n.id === e.source);
    const targetNode = apiNodes.find(n => n.id === e.target);
    
    const sHasDate = !!sourceNode?.discovery_date;
    const tHasDate = !!targetNode?.discovery_date;
    const sDate = sHasDate ? new Date(sourceNode!.discovery_date as string).getTime() : 0;
    const tDate = tHasDate ? new Date(targetNode!.discovery_date as string).getTime() : 0;
    
    // If either source or target has a date AND that date is from the future, hide the edge
    const isFuture = timelineDate !== null && ((sHasDate && sDate > timelineDate) || (tHasDate && tDate > timelineDate));
    
    const edgeId = `${e.source}-${e.target}`;
    const inBlastRadius = blastRadiusPath.has(edgeId);
    const isCriticalEdge = criticalIds.has(e.source) || criticalIds.has(e.target);
    
    let opacity = 1;
    if (isFuture) opacity = 0;
    else if (isBlastMode) opacity = inBlastRadius ? 1 : 0.05;
    else if (isFocusMode && !isCriticalEdge) opacity = 0.15;
    
    const stroke = isBlastMode && inBlastRadius ? '#ef4444' : (isFocusMode && !isCriticalEdge ? '#1e293b' : (edgeColorMap[e.label] ?? '#3b82f6'));
    
    const edgeStyle = (isFocusMode && !isCriticalEdge) && !inBlastRadius ? {
      style: { stroke, strokeWidth: 1, opacity, transition: 'all 0.5s ease' },
      labelStyle: { fill: '#475569', fontWeight: 400, fontSize: 9 },
      labelBgStyle: { fill: 'transparent', strokeWidth: 0 },
    } : {
      style: { stroke, strokeWidth: isBlastMode && inBlastRadius ? 3 : 2, opacity, transition: 'all 0.5s ease' },
      labelStyle: { fill: isBlastMode && inBlastRadius ? '#fca5a5' : '#cbd5e1', fontSize: 9, fontWeight: 600 },
      labelBgStyle: { fill: isBlastMode && inBlastRadius ? '#450a0a' : '#0f172a', stroke: isBlastMode && inBlastRadius ? '#ef4444' : '#1e293b', strokeWidth: 1, rx: 4, ry: 4 },
    };
    
    return {
      id: edgeId,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: isBlastMode && inBlastRadius ? true : e.label === 'PORT' || e.label === 'THREAT',
      hidden: isFuture, // Extra safety layer
      ...edgeStyle,
    };
  });
}

// ── Component ────────────────────────────────────────────────────────────────
interface InvestigationGraphProps {
  payload: ApiGraphPayload | Record<string, never>;
  onNodeClick?: (nodeId: string) => void;
  isFocusMode?: boolean;
  blastRadiusNode?: string | null;
  timelineDate?: number | null;
}

// We extract the inner component to use ReactFlow hooks
function InvestigationGraphInner({ payload, onNodeClick, isFocusMode = false, blastRadiusNode = null, timelineDate = null }: InvestigationGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(fallbackNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(fallbackEdges);

  // Sync React Flow state whenever payload arrives or changes
  useEffect(() => {
    const apiNodes = (payload as ApiGraphPayload).nodes;
    const apiEdges = (payload as ApiGraphPayload).links;

    if (Array.isArray(apiNodes) && apiNodes.length > 0) {
      // Calculate blast radius paths if active
      let blastRadiusPath = new Set<string>();
      if (blastRadiusNode) {
        blastRadiusPath = computeBlastRadiusIds(apiNodes, apiEdges ?? [], blastRadiusNode);
      }

      const freshNodes = [...toReactFlowNodes(apiNodes, isFocusMode, blastRadiusPath, timelineDate)];
      const freshEdges = [...toReactFlowEdges(apiEdges ?? [], apiNodes, isFocusMode, blastRadiusPath, timelineDate)];
      
      setNodes(freshNodes);
      setEdges(freshEdges);
    }
  }, [payload, setNodes, setEdges, isFocusMode, blastRadiusNode, timelineDate]);

  const onConnect = useCallback(
    (params: any) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <div style={{ width: '100%', height: '100vh', minHeight: '800px', backgroundColor: '#020617', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => {
          // Custom Group Node has its own click handler
          if (node.type !== 'customGroup') {
            onNodeClick?.(node.id);
          }
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode="dark"
        style={{ width: '100%', height: '100%' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#1e293b" />
        <Controls style={{ backgroundColor: '#0f172a', fill: '#fff', border: '1px solid #334155' }} />
        <MiniMap
          nodeColor={(n) => (n.id === nodes[0]?.id ? '#3b82f6' : '#1e3a8a')}
          maskColor="rgba(2, 6, 23, 0.8)"
          style={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
        />
      </ReactFlow>
    </div>
  );
}

// Wrap the inner component with ReactFlowProvider to allow access to useReactFlow hooks inside CustomGroupNode
export function InvestigationGraph(props: InvestigationGraphProps) {
  return (
    <ReactFlowProvider>
      <InvestigationGraphInner {...props} />
    </ReactFlowProvider>
  );
}