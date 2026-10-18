import { create } from "zustand";
import { isBundledRfc } from "../data/load";

/** The RFC drawer, opened from code comments, chips, and fields anywhere. */
interface PeekState {
  rfc: { n: number; section?: string } | null;
  open(n: number, section?: string): void;
  close(): void;
}

export function rfcEditorUrl(n: number, section?: string) {
  return `https://www.rfc-editor.org/rfc/rfc${n}${section ? `#section-${section}` : ""}`;
}

export const usePeek = create<PeekState>((set) => ({
  rfc: null,
  open: (n, section) => {
    // An RFC the site does not bundle opens on rfc-editor.org from inside the
    // click, so popup blockers allow it. The drawer handles a click that comes
    // before the RFC index has loaded.
    if (isBundledRfc(n) === false) {
      window.open(rfcEditorUrl(n, section), "_blank", "noopener");
      return;
    }
    set({ rfc: { n, section } });
  },
  close: () => set({ rfc: null }),
}));
