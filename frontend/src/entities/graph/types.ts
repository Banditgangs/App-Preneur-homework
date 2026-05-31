export type ScanStatus = "queued" | "running" | "completed" | "failed";

export type ScanRequest = {
  target: string;
};

export type GraphNode = {
  id: string;
  label: string;
  type: "domain" | "email" | "repository" | "leak" | "ip";
  summary: string;
  attributes: Record<string, string>;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
};

export type GraphPayload = {
  scanId: string;
  status: ScanStatus;
  nodes: GraphNode[];
  edges: GraphEdge[];
  error?: string;
};
