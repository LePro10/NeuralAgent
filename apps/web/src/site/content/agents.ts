// The 13 agent CLIs exactly as crates/na-daemon/src/catalog.rs names them (order, names, vendors, commands, install lines).
// `AGENTS` in ../content.ts has ids, names and commands; this adds what the roster needs. Facts only.
import { AGENTS } from "../content";

export interface AgentInfo {
  id: string;
  name: string;
  /** Vendor as the catalog lists it. */
  vendor: string;
  cmd: string;
  /** Install line for macOS and Linux, as in the catalog. */
  install: string;
  /** Extra line: Windows install or a requirement. */
  note?: string;
  /** True for Claude Code and Codex: exact status from hooks. */
  hooks: boolean;
}

const EXTRA: Record<string, Omit<AgentInfo, "id" | "name" | "cmd">> = {
  claude: { vendor: "Anthropic", install: "curl -fsSL https://claude.ai/install.sh | bash", hooks: true },
  codex: { vendor: "OpenAI", install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", hooks: true },
  gemini: { vendor: "Google", install: "npm install -g @google/gemini-cli", note: "Needs Node.", hooks: false },
  antigravity: { vendor: "Google", install: "curl -fsSL https://antigravity.google/cli/install.sh | bash", hooks: false },
  cursor: { vendor: "Cursor", install: "curl https://cursor.com/install -fsS | bash", hooks: false },
  copilot: { vendor: "GitHub", install: "curl -fsSL https://gh.io/copilot-install | bash", note: "Windows: winget install GitHub.Copilot", hooks: false },
  opencode: { vendor: "SST", install: "curl -fsSL https://opencode.ai/install | bash", note: "Windows: installs with npm.", hooks: false },
  grok: { vendor: "xAI", install: "curl -fsSL https://x.ai/cli/install.sh | bash", hooks: false },
  amp: { vendor: "Amp", install: "curl -fsSL https://ampcode.com/install.sh | bash", note: "Windows: installs with npm.", hooks: false },
  droid: { vendor: "Factory", install: "curl -fsSL https://app.factory.ai/cli | sh", hooks: false },
  kimi: { vendor: "Moonshot AI", install: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash", hooks: false },
  qwen: { vendor: "Alibaba", install: "npm install -g @qwen-code/qwen-code@latest", note: "Needs Node 22 or newer.", hooks: false },
  aider: { vendor: "Aider", install: "curl -LsSf https://aider.chat/install.sh | sh", note: "Bring your own model key.", hooks: false },
};

export const AGENT_INFO: AgentInfo[] = AGENTS.map((a) => ({ id: a.id, name: a.name, cmd: a.cmd, ...EXTRA[a.id]! }));

export const BYO = [
  { title: "Your own subscriptions", line: "Each CLI signs in with your own subscription or API key. No account is needed on the desktop." },
  { title: "Installed separately", line: "NeuralAgent finds the CLIs on your computer. A missing one installs into a pane in one click." },
  { title: "Anything else is a shell", line: "Any other terminal program runs as a plain shell pane." },
] as const;
