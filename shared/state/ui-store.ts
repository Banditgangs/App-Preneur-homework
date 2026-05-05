"use client";

import { create } from "zustand";

type UiState = {
  selectedNodeId: string | null;
  isPanelOpen: boolean;
  setSelectedNodeId: (nodeId: string | null) => void;
  setPanelOpen: (open: boolean) => void;
  clearSelection: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  selectedNodeId: null,
  isPanelOpen: false,
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  setPanelOpen: (open) => set({ isPanelOpen: open }),
  clearSelection: () => set({ selectedNodeId: null, isPanelOpen: false }),
}));
