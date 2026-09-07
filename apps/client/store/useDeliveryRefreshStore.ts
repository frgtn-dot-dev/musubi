import { create } from "zustand";

// An invalidation signal only: no event content persists across identities.
export const useDeliveryRefreshStore = create<{
  version: number;
  refresh: () => void;
}>((set) => ({
  version: 0,
  refresh: () => set((state) => ({ version: state.version + 1 })),
}));
