import { create } from "zustand";

interface UiState {
  selectedNodeId: string | null;
  isContextPanelOpen: boolean;
  setSelectedNodeId: (id: string | null) => void;
  setContextPanelOpen: (isOpen: boolean) => void;
  openNodePanel: (id: string) => void;  // convenience action
  closeNodePanel: () => void;           // convenience action
}

export const useUiStore = create<UiState>((set) => ({
  selectedNodeId: null,
  isContextPanelOpen: false,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setContextPanelOpen: (isOpen) => set({ isContextPanelOpen: isOpen }),
  openNodePanel: (id) => set({ selectedNodeId: id, isContextPanelOpen: true }),
  closeNodePanel: () => set({ isContextPanelOpen: false, selectedNodeId: null }),
}));