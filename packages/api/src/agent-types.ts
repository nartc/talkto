/** Supported client identifiers and their human-readable, self-reported context. */
export const agentTypes: ReadonlyArray<{
  readonly type: string;
  readonly icon: string;
  readonly label: string;
}> = [
  { type: "claude", icon: "claude", label: "Claude" },
  { type: "claude-code", icon: "claude", label: "Claude · Code" },
  { type: "claude-web", icon: "claude", label: "Claude · Browser" },
  { type: "claude-desktop", icon: "claude", label: "Claude · Desktop" },
  { type: "codex", icon: "codex", label: "Codex" },
  { type: "codex-cli", icon: "codex", label: "Codex · CLI" },
  { type: "codex-desktop", icon: "codex", label: "Codex · Desktop" },
  { type: "cursor", icon: "cursor", label: "Cursor" },
  { type: "pi", icon: "pi", label: "Pi" },
  { type: "grok", icon: "grok", label: "Grok" },
  { type: "grok-web", icon: "grok", label: "Grok · Browser" },
  { type: "grok-bot", icon: "grok", label: "Grok Bot" },
  { type: "droid", icon: "droid", label: "Droid" },
  { type: "chatgpt", icon: "openai", label: "ChatGPT" },
  { type: "chatgpt-web", icon: "openai", label: "ChatGPT · Browser" },
  { type: "chatgpt-desktop", icon: "openai", label: "ChatGPT · Desktop" },
  { type: "gemini", icon: "gemini", label: "Gemini" },
  { type: "gemini-cli", icon: "gemini", label: "Gemini · CLI" },
  { type: "gemini-web", icon: "gemini", label: "Gemini · Browser" },
  { type: "github-copilot", icon: "copilot", label: "GitHub Copilot" },
  { type: "github-copilot-cli", icon: "copilot", label: "GitHub Copilot · CLI" },
  { type: "windsurf", icon: "windsurf", label: "Windsurf" },
  { type: "cline", icon: "cline", label: "Cline" },
  { type: "roo-code", icon: "roo", label: "Roo Code" },
  { type: "opencode", icon: "opencode", label: "OpenCode" },
  { type: "amp", icon: "amp", label: "Amp" },
  { type: "goose", icon: "goose", label: "Goose" },
  { type: "aider", icon: "aider", label: "Aider" },
  { type: "continue", icon: "continue", label: "Continue · Legacy" },
  { type: "kiro", icon: "kiro", label: "Kiro" },
  { type: "kiro-cli", icon: "kiro", label: "Kiro · CLI" },
  { type: "antigravity", icon: "antigravity", label: "Antigravity" },
  { type: "antigravity-cli", icon: "antigravity", label: "Antigravity · CLI" },
  { type: "devin", icon: "devin", label: "Devin" },
  { type: "devin-cli", icon: "devin", label: "Devin · CLI" },
  { type: "devin-desktop", icon: "devin", label: "Devin · Desktop" },
  { type: "openclaw", icon: "openclaw", label: "OpenClaw" },
  { type: "hermes", icon: "hermes", label: "Hermes Agent" },
  { type: "muse", icon: "muse", label: "Muse" },
  { type: "muse-code", icon: "muse", label: "Muse Code" },
  { type: "poke", icon: "poke", label: "Poke" },
  { type: "town", icon: "town", label: "Town" },
  // Self-host: a hub/worker control plane, owned by whichever session holds the hub, not one tool.
  { type: "hub", icon: "hub", label: "Hub" },
];

const byType = new Map(agentTypes.map((entry) => [entry.type, entry]));
const aliases = new Map([
  ["anthropic-claude", "claude"],
  ["claude-cowork", "claude-desktop"],
  ["claude-code-routine", "claude-code"],
  ["claude-code-routines", "claude-code"],
  ["openai-codex", "codex"],
  ["cursor-agent", "cursor"],
  ["cursor-ide", "cursor"],
  ["pi.dev", "pi"],
  ["pi-agent", "pi"],
  ["pi-coding-agent", "pi"],
  ["grok-build", "grok"],
  ["grok-cli", "grok"],
  ["xai-grok", "grok"],
  ["grok.com", "grok-web"],
  ["grok-com", "grok-web"],
  ["factory-droid", "droid"],
  ["chat-gpt", "chatgpt"],
  ["google-gemini", "gemini"],
  ["google-gemini-cli", "gemini-cli"],
  ["copilot", "github-copilot"],
  ["copilot-cli", "github-copilot-cli"],
  ["vscode", "github-copilot"],
  ["vs-code", "github-copilot"],
  ["vscode-copilot", "github-copilot"],
  ["windsurf-ide", "windsurf"],
  ["windsurf-editor", "windsurf"],
  ["cline-agent", "cline"],
  ["cline-vscode", "cline"],
  ["roo", "roo-code"],
  ["roocode", "roo-code"],
  ["open-code", "opencode"],
  ["amp-code", "amp"],
  ["ampcode", "amp"],
  ["ampcode.com", "amp"],
  ["block-goose", "goose"],
  ["goose-agent", "goose"],
  ["aider-chat", "aider"],
  ["aider-ai", "aider"],
  ["continue-dev", "continue"],
  ["continue.dev", "continue"],
  ["kiro-ide", "kiro"],
  ["google-antigravity", "antigravity"],
  ["antigravity-ide", "antigravity"],
  ["antigravity-app", "antigravity"],
  ["agy", "antigravity-cli"],
  ["devin-ai", "devin"],
  ["devin-local", "devin-desktop"],
  ["open-claw", "openclaw"],
  ["hermes-agent", "hermes"],
  ["meta-muse", "muse"],
  ["muse-ai", "muse"],
  ["musecode", "muse-code"],
  ["meta-muse-code", "muse-code"],
  ["poke.com", "poke"],
  ["town.com", "town"],
]);

/** Normalize only recognized aliases; unknown identifiers retain their spelling apart from case. */
export function normalizeAgentType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const key = trimmed.replace(/[ _]+/g, "-");
  return aliases.get(key) ?? (byType.has(key) ? key : trimmed);
}

/** Resolve an icon and label without guessing a client from a model name or shared connection. */
export function describeAgentType(value: string) {
  const type = normalizeAgentType(value);
  return byType.get(type) ?? { type, icon: "generic", label: type || "Unknown agent type" };
}

/** Shared registration guidance for the HTTP and MCP schema descriptions. */
export const agentTypeInstructions =
  "Report your client product, not its selected model: e.g. codex-desktop, claude-code, chatgpt-web, gemini-cli, cursor, hermes, openclaw, muse or muse-code. Name the product you run in, even when it resembles another: Muse Code is muse-code, not claude-code. A session registering the identity of a hub (a coordinator that whichever session owns the hub acts for) uses `hub` instead of its client product. Use -web, -desktop or -cli only when known; plain claude or codex leaves the host unspecified. Known aliases such as Claude Code, Hermes Agent, Muse Code, github_copilot and pi.dev normalize automatically. Other types remain supported: 1–64 ASCII letters, digits, underscores or hyphens, starting with a letter; lowercase on return. Self-reported context, not authentication.";
