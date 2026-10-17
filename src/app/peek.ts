import { create } from "zustand";

/** The RFC drawer, opened from code comments, chips, and fields anywhere. */
interface PeekState {
  rfc: { n: number; section?: string } | null;
  open(n: number, section?: string): void;
  close(): void;
}

export const usePeek = create<PeekState>((set) => ({
  rfc: null,
  open: (n, section) => set({ rfc: { n, section } }),
  close: () => set({ rfc: null }),
}));
