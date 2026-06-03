"use client";

import { useState } from "react";
import { Play, Loader2, ServerCrash } from "lucide-react";
import { api } from "@/lib/api";

interface ScanLauncherProps {
  onScanStarted: (scanId: string) => void;
}

export function ScanLauncher({ onScanStarted }: ScanLauncherProps) {
  const [target, setTarget] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      // 1. Gerçek API'ye istek atıyoruz (Veritabanına kayıt)
      const newTarget = await api.createTarget({
        target_value: target,
        is_monitored: false,
      });

      // 2. Başarılı olursa API'den dönen gerçek ID'yi grafiğe gönderiyoruz
      onScanStarted(newTarget.id);
      
      // 3. Input'u temizle
      setTarget(""); 
    } catch (err: any) {
      setError(err.message || "API'ye ulaşılamadı. Backend açık mı?");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleLaunch} className="flex flex-col gap-3">
        <div className="relative">
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Hedef girin (örn: google.com)"
            disabled={isLoading}
            className="w-full bg-black/40 border border-neutral-800 text-white text-sm rounded-md px-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-neutral-600 font-mono"
          />
        </div>
        
        <button
          type="submit"
          disabled={!target.trim() || isLoading}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm font-bold uppercase tracking-widest py-3 rounded-md transition-all"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              BAŞLATILIYOR...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              TARAMAYI BAŞLAT
            </>
          )}
        </button>
      </form>

      {/* Hata Mesajı Alanı */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-red-950/30 border border-red-900/50 text-red-400 text-xs font-mono">
          <ServerCrash className="w-4 h-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}