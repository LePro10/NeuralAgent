// Pure layout-tree edits. The client changes the tree and sends `layout_set`; the daemon only
// places new sessions. Ids are short random strings like the daemon's.
import type { LayoutNode, PaneContent, SplitDir, Tab, WorkspaceLayout } from "@neuralagent/protocol";

export const MAX_PANES = 16;

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);

export function newTab(title: string): Tab {
  const id = newId();
  return { id: newId(), title, root: { type: "pane", id, content: { kind: "empty" } }, focused: id };
}

export function panes(n: LayoutNode): Extract<LayoutNode, { type: "pane" }>[] {
  return n.type === "pane" ? [n] : n.children.flatMap(panes);
}

export function activeTab(l: WorkspaceLayout): Tab | undefined {
  return l.tabs.find((t) => t.id === l.active_tab) ?? l.tabs[0];
}

function mapTree(n: LayoutNode, f: (n: LayoutNode) => LayoutNode | null): LayoutNode | null {
  const m = f(n);
  if (m !== n || n.type === "pane") return m;
  const kids: LayoutNode[] = [];
  const sizes: number[] = [];
  n.children.forEach((c, i) => {
    const r = mapTree(c, f);
    if (r) {
      kids.push(r);
      sizes.push(n.sizes[i] ?? 1 / n.children.length);
    }
  });
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0]!;
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...n, children: kids, sizes: sizes.map((s) => s / sum) };
}

export function updateTab(l: WorkspaceLayout, tabId: string, f: (t: Tab) => Tab): WorkspaceLayout {
  return { ...l, tabs: l.tabs.map((t) => (t.id === tabId ? f(t) : t)) };
}

/** Splits `paneId`; the new pane gets `content` and focus. */
export function splitPane(tab: Tab, paneId: string, dir: SplitDir, content: PaneContent = { kind: "empty" }): Tab {
  if (panes(tab.root).length >= MAX_PANES) return tab;
  const nid = newId();
  const fresh: LayoutNode = { type: "pane", id: nid, content };
  const go = (n: LayoutNode): LayoutNode => {
    if (n.type === "pane") {
      return n.id === paneId ? { type: "split", id: newId(), dir, sizes: [0.5, 0.5], children: [n, fresh] } : n;
    }
    // Same direction as the parent: become a sibling, keep the others' sizes proportional.
    const i = n.children.findIndex((c) => c.type === "pane" && c.id === paneId);
    if (i >= 0 && n.dir === dir) {
      const half = (n.sizes[i] ?? 1 / n.children.length) / 2;
      const sizes = [...n.sizes];
      sizes.splice(i, 1, half, half);
      const children = [...n.children];
      children.splice(i + 1, 0, fresh);
      return { ...n, sizes, children };
    }
    return { ...n, children: n.children.map(go) };
  };
  return { ...tab, root: go(tab.root), focused: nid, zoomed: undefined };
}

/** Removes a pane; the last pane of a tab becomes empty instead. */
export function removePane(tab: Tab, paneId: string): Tab {
  const all = panes(tab.root);
  if (all.length <= 1) {
    return { ...tab, root: { type: "pane", id: all[0]?.id ?? newId(), content: { kind: "empty" } }, zoomed: undefined };
  }
  const idx = all.findIndex((p) => p.id === paneId);
  const root = mapTree(tab.root, (n) => (n.type === "pane" && n.id === paneId ? null : n))!;
  const rest = panes(root);
  const focused = tab.focused === paneId ? (rest[Math.max(0, idx - 1)] ?? rest[0])!.id : tab.focused;
  return { ...tab, root, focused, zoomed: tab.zoomed === paneId ? undefined : tab.zoomed };
}

export function setContent(tab: Tab, paneId: string, content: PaneContent): Tab {
  return { ...tab, root: mapTree(tab.root, (n) => (n.type === "pane" && n.id === paneId ? { ...n, content } : n))! };
}

export function setSizes(tab: Tab, splitId: string, sizes: number[]): Tab {
  return { ...tab, root: mapTree(tab.root, (n) => (n.type === "split" && n.id === splitId ? { ...n, sizes } : n))! };
}

/** Swaps the contents of two panes (drag a pane onto another). */
export function swapPanes(tab: Tab, a: string, b: string): Tab {
  const all = panes(tab.root);
  const ca = all.find((p) => p.id === a)?.content;
  const cb = all.find((p) => p.id === b)?.content;
  if (!ca || !cb) return tab;
  return { ...setContent(setContent(tab, a, cb), b, ca), focused: b };
}

/** Pane ids in on-screen reading order (top to bottom, left to right), for ⌘1…9 and re-arranging. */
export function order(tab: Tab): string[] {
  const out: { id: string; x: number; y: number }[] = [];
  const walk = (n: LayoutNode, x: number, y: number, w: number, h: number) => {
    if (n.type === "pane") return void out.push({ id: n.id, x, y });
    let at = 0;
    n.children.forEach((c, i) => {
      const f = n.sizes[i] ?? 1 / n.children.length;
      if (n.dir === "row") walk(c, x + at * w, y, f * w, h);
      else walk(c, x, y + at * h, w, f * h);
      at += f;
    });
  };
  walk(tab.root, 0, 0, 1, 1);
  const q = (v: number) => Math.round(v * 1000);
  return out.sort((a, b) => q(a.y) - q(b.y) || q(a.x) - q(b.x)).map((p) => p.id);
}

/** An even grid of `n` panes (rows of up to ceil(sqrt(n)) columns). */
export function gridOf(contents: PaneContent[]): LayoutNode {
  const n = Math.max(1, contents.length);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const rowNodes: LayoutNode[] = [];
  let k = 0;
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - k);
    const cells: LayoutNode[] = [];
    for (let c = 0; c < inRow; c++) cells.push({ type: "pane", id: newId(), content: contents[k++] ?? { kind: "empty" } });
    rowNodes.push(cells.length === 1 ? cells[0]! : { type: "split", id: newId(), dir: "row", sizes: cells.map(() => 1 / cells.length), children: cells });
  }
  return rowNodes.length === 1 ? rowNodes[0]! : { type: "split", id: newId(), dir: "column", sizes: rowNodes.map(() => 1 / rowNodes.length), children: rowNodes };
}

/** The layout with the tab and pane that show `sid` in front and focused, or null when they already are (or it is not shown). */
export function frontTabFor(l: WorkspaceLayout | undefined, sid: string): WorkspaceLayout | null {
  for (const t of l?.tabs ?? []) {
    const pane = panes(t.root).find((p) => p.content.kind === "terminal" && p.content.session === sid);
    if (!pane) continue;
    if (l!.active_tab === t.id && t.focused === pane.id) return null;
    return { ...l!, active_tab: t.id, tabs: l!.tabs.map((x) => (x.id === t.id ? { ...x, focused: pane.id } : x)) };
  }
  return null;
}
