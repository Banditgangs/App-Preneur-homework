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
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      let errorMessage = "Hedef eklenirken bir hata oluştu";
      if (errorData?.detail) {
        if (Array.isArray(errorData.detail)) {
          errorMessage = errorData.detail[0].msg || errorMessage;
        } else if (typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        }
      }
      throw new Error(errorMessage);
    }
    return response.json();
  },

  /** Belirli bir hedefin OSINT graf verisini çeker */
  fetchTargetGraph: async (targetId: string): Promise<ApiGraphPayload> => {
    // KÖK NEDEN ÇÖZÜMÜ: Next.js ve Tarayıcı önbelleğini (cache) kırarak her zaman taze veri al
    const response = await fetch(`${API_BASE_URL}/targets/${targetId}/graph`, { cache: 'no-store' });
    if (!response.ok) throw new Error("Graf verisi alınamadı");
    return response.json();
  },

  /** Fallback Polling mekanizması için hedef tarama durumunu kontrol eder */
  fetchTargetStatus: async (targetId: string): Promise<{ status: string }> => {
    const response = await fetch(`${API_BASE_URL}/targets/${targetId}/status`, { cache: 'no-store' });
    if (!response.ok) throw new Error("Durum alınamadı");
    return response.json();
  },

  /** Özel bir düğüm için LLM destekli analiz gerekçesi getirir */
  fetchAiRationale: async (nodeId: string): Promise<{ rationale: string }> => {
    const response = await fetch(`${API_BASE_URL}/nodes/${nodeId}/ai-rationale`, { cache: 'no-store' });
    if (!response.ok) throw new Error("AI Analizi alınamadı");
    return response.json();
  },

  /** SOC Copilot ile sohbet eder */
  chatWithCopilot: async (targetId: string | null, messages: {role: string, content: string}[]): Promise<{ reply: string }> => {
    const response = await fetch(`${API_BASE_URL}/chat/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: targetId, messages }),
    });
    if (!response.ok) throw new Error("Chat isteği başarısız oldu");
    return response.json();
  },
};