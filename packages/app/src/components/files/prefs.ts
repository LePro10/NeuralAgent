// Files explorer (D67): how this device likes its folders shown (sort, hidden files, wrapping).
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Sort } from "./model";

interface FilePrefs {
  sort: Sort;
  hidden: boolean;
  /** Long lines wrap in the code viewer (phones start with wrapping on). */
  wrap: boolean | null;
  setSort: (sort: Sort) => void;
  setHidden: (hidden: boolean) => void;
  setWrap: (wrap: boolean) => void;
}

export const useFilePrefs = create<FilePrefs>()(
  persist(
    (set) => ({
      sort: { key: "name" },
      hidden: false,
      wrap: null,
      setSort: (sort) => set({ sort }),
      setHidden: (hidden) => set({ hidden }),
      setWrap: (wrap) => set({ wrap }),
    }),
    { name: "neuralagent.files" },
  ),
);
