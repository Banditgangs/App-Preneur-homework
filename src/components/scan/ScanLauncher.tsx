"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { mockApi } from "../../lib/mockApi";
import { Radar, Search } from "lucide-react";

interface Props {
  onScanStarted: (scanId: string) => void;
}

export const ScanLauncher = ({ onScanStarted }: Props) => {
  const [target, setTarget] = useState("");

  const mutation = useMutation({
    mutationFn: mockApi.startScan,
    onSuccess: (scanId) => {
      onScanStarted(scanId);
    },
  });

  const handleStart = () => {
    if (target.trim()) mutation.mutate({ target });
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Radar className="w-4 h-4 text-blue-500" />
          <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-widest">
            Target Acquisition
          </h3>
        </div>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600 pointer-events-none" />
            <input
              id="scan-target-input"
              type="text"
              placeholder="domain.com · 1.2.3.4 · user@mail.com"
              className="
                w-full bg-black border border-neutral-700 rounded-md
                pl-9 pr-3 py-2.5 text-sm text-gray-200 font-mono
                placeholder:text-neutral-700
                focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none
                transition-all duration-200
              "
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStart()}
              disabled={mutation.isPending}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <button
            id="start-scan-button"
            onClick={handleStart}
            disabled={mutation.isPending || !target.trim()}
            className="
              w-full relative bg-blue-600 hover:bg-blue-500
              text-white px-4 py-2.5 rounded-md text-sm font-semibold
              transition-all duration-200
              disabled:opacity-40 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-neutral-900
              overflow-hidden group
            "
          >
            {/* Shimmer on hover */}
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            <span className="relative flex items-center justify-center gap-2">
              {mutation.isPending ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Initiating...
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  Start Scan
                </>
              )}
            </span>
          </button>
        </div>
      </div>

      {mutation.isError && (
        <p className="text-xs text-red-400 font-mono bg-red-950/40 border border-red-800/50 px-3 py-2 rounded">
          Scan failed. Check target and retry.
        </p>
      )}
    </div>
  );
};