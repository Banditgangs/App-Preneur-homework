export interface ScanRequest {
  target: string;
}

export interface GraphNode {
  id: string;
  label: string;
  group?: string;
  [key: string]: any; // Esnek OSINT verileri için
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  [key: string]: any;
}

export interface GraphPayload {
  nodes: GraphNode[];
  links: GraphEdge[];
}