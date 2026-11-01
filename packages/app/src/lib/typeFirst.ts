import { useLayoutMode } from "@neuralagent/ui";

/**
 * Whether a form may put the cursor in its first field when it opens. Not on phones and touch
 * screens: there that pops the keyboard over the form before the user has seen it.
 */
export function useTypeFirst(): boolean {
  const phone = useLayoutMode() === "phone";
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return !phone && !touch;
}
