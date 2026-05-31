// frontend/src/lib/api.ts

const API_BASE_URL = "http://localhost:8000/api";

export interface TargetCreate {
  target_value: string;
  is_monitored: boolean;
}

export interface TargetResponse {
  id: string;
  target_value: string;
  is_monitored: boolean;
  created_at: string;
  updated_at: string;
}

// ── Graph payload types (matches backend GraphPayloadResponse) ─────────────
export interface ApiGraphNode {
  id: string;
  label: string;
  group: string;
  parentNode?: string;
  discovery_date?: string;
}

export interface ApiGraphEdge {
  source: string;
  target: string;
  label: string;
}

export interface ApiGraphPayload {
  nodes: ApiGraphNode[];
  links: ApiGraphEdge[];
}

export const api = {
  /** Veritabanına yeni hedef ekleyen fonksiyon */
  createTarget: async (data: TargetCreate): Promise<TargetResponse> => {
    const response = await fetch(`${API_BASE_URL}/targets/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error("Hedef eklenirken bir hata oluştu");
    return response.json();
  },

  /** Belirli bir hedefin OSINT graf verisini çeker */
  fetchTargetGraph: async (targetId: string): Promise<ApiGraphPayload> => {
    // KÖK NEDEN ÇÖZÜMÜ: Next.js ve Tarayıcı önbelleğini (cache) kırarak her zaman taze veri al
    const response = await fetch(`${API_BASE_URL}/targets/${targetId}/graph`, { cache: 'no-store' });
    if (!response.ok) throw new Error("Graf verisi alınamadı");
    return response.json();
  },
};