// Shared facts and links for the marketing pages. Only things the product really does
// (research-local/site-overhaul/site-audit.md, Part B). Section copy lives in the section files.
// Internal pages are linked in their canonical slash form (/download/, /changelog/ ...): the relay answers the bare form with a
// 307, which costs a round trip on every click. `links.test.ts` fails on the bare form.

export const SITE = "https://agent.neuralhub.dev";
export const MAIL = "agent@neuralhub.dev";
export const GITHUB = "https://github.com/LePro10/NeuralAgent";
export const INSTALL_CMD = "curl -fsSL https://agent.neuralhub.dev/install.sh | sh";

/** The 13 agent CLIs in catalog order (crates/na-daemon/src/catalog.rs). `id` is the AgentGlyph engine id. */
export const AGENTS = [
  { id: "claude", name: "Claude Code", cmd: "claude" },
  { id: "codex", name: "Codex", cmd: "codex" },
  { id: "gemini", name: "Gemini CLI", cmd: "gemini" },
  { id: "antigravity", name: "Antigravity CLI", cmd: "agy" },
  { id: "cursor", name: "Cursor Agent", cmd: "agent" },
  { id: "copilot", name: "Copilot CLI", cmd: "copilot" },
  { id: "opencode", name: "OpenCode", cmd: "opencode" },
  { id: "grok", name: "Grok Build", cmd: "grok" },
  { id: "amp", name: "Amp", cmd: "amp" },
  { id: "droid", name: "Droid", cmd: "droid" },
  { id: "kimi", name: "Kimi Code", cmd: "kimi" },
  { id: "qwen", name: "Qwen Code", cmd: "qwen" },
  { id: "aider", name: "Aider", cmd: "aider" },
] as const;

/**
 * Landing sections in page order. `id` is the anchor and the <Section id>; `path` is the pane title label
 * (`agents/side-by-side`); `nav` is the label when it appears in the nav or the menu.
 */
export const SECTIONS = [
  { id: "top", path: "neuralagent/overview", nav: "" },
  { id: "product", path: "product/walkthrough", nav: "Product" },
  { id: "spec", path: "product/everything-else", nav: "" },
  { id: "security", path: "security/sealed-in-transit", nav: "Security" },
  { id: "agents", path: "agents/thirteen-clis", nav: "" },
  { id: "download", path: "download/platforms", nav: "Download" },
  { id: "faq", path: "faq/questions", nav: "" },
  { id: "start", path: "start/now", nav: "" },
] as const;

/** Nav and menu entries. `href` starting with "#" scrolls on the landing and links to "/#id" elsewhere. */
export interface NavLink {
  label: string;
  href: string;
  id?: string;
  /** Hide the text link between 880 and 1199 px, where the download button next to it says the same word. */
  hideMid?: boolean;
}
export const NAV_LINKS: NavLink[] = [
  { label: "Product", href: "#product", id: "product" },
  { label: "Live demo", href: "/demo/" },
  { label: "Security", href: "#security", id: "security" },
  { label: "Download", href: "#download", id: "download", hideMid: true },
  { label: "Changelog", href: "/changelog/" },
];

export interface FooterColumn { title: string; links: { label: string; href: string; external?: boolean }[] }
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "/#product" },
      { label: "Live demo", href: "/demo/" },
      { label: "Security", href: "/#security" },
      { label: "Agents", href: "/#agents" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    title: "Download",
    links: [
      { label: "macOS", href: "/download/" },
      { label: "Windows", href: "/download/" },
      { label: "Linux", href: "/download/" },
      { label: "Android", href: "/download/" },
      { label: "iPhone (web remote)", href: "/app/" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Changelog", href: "/changelog/" },
      { label: "GitHub", href: GITHUB, external: true },
      { label: "Web remote", href: "/app/" },
      { label: "Contact", href: `mailto:${MAIL}` },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Imprint", href: "/imprint/" },
      { label: "Privacy", href: "/privacy/" },
      { label: "Terms", href: "/terms/" },
      { label: "AGPL-3.0 licence", href: `${GITHUB}/blob/main/LICENSE`, external: true },
    ],
  },
];
