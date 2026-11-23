import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("every known client resolves to a bundled glyph; host context is explicit and custom types stay generic", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());
  const { AgentIcon } = await vite.ssrLoadModule("/src/components.tsx");
  const { AgentSymbols } = await vite.ssrLoadModule("/src/agent-symbols.tsx");
  const { agentTypes, describeAgentType } = await vite.ssrLoadModule(
    "/../../packages/api/src/agent-types.ts",
  );
  const symbols = renderToStaticMarkup(createElement(AgentSymbols));
  const ids = [...symbols.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "SVG masks and clips must have unique IDs");
  assert.equal(new Set(agentTypes.map((entry) => entry.icon)).size, 26);
  for (const entry of agentTypes) {
    const rendered = renderToStaticMarkup(createElement(AgentIcon, { type: entry.type }));
    assert.ok(rendered.includes(`href="#agent-${entry.icon}"`));
    assert.ok(ids.includes(`agent-${entry.icon}`), `Missing ${entry.icon} symbol`);
    assert.ok(rendered.includes(`aria-label="${entry.label}"`));
  }
  assert.equal(describeAgentType("Claude Code").label, "Claude · Code");
  assert.equal(describeAgentType("claude_web").label, "Claude · Browser");
  assert.equal(describeAgentType("codex desktop").label, "Codex · Desktop");
  assert.equal(describeAgentType("ChatGPT Web").icon, "openai");
  assert.equal(describeAgentType("continue.dev").label, "Continue · Legacy");
  assert.equal(describeAgentType("claude").label, "Claude");
  assert.equal(describeAgentType("Grok Build").icon, "grok");
  assert.equal(describeAgentType("factory_droid").label, "Droid");
  for (const [submitted, type] of [
    ["Hermes Agent", "hermes"],
    ["hermes_agent", "hermes"],
    ["OpenClaw", "openclaw"],
    ["open claw", "openclaw"],
    ["Antigravity", "antigravity"],
    ["Antigravity CLI", "antigravity-cli"],
    ["agy", "antigravity-cli"],
    ["Devin", "devin"],
    ["Devin CLI", "devin-cli"],
    ["Devin Desktop", "devin-desktop"],
    ["ChatGPT", "chatgpt"],
    ["Poke", "poke"],
    ["Town", "town"],
    ["Hub", "hub"],
    ["Muse Code", "muse-code"],
    ["muse_code", "muse-code"],
    ["muse", "muse"],
    ["Muse", "muse"],
    ["meta_muse", "muse"],
    ["VS Code", "github-copilot"],
    ["Grok Bot", "grok-bot"],
    ["grok.com", "grok-web"],
    ["Claude Cowork", "claude-desktop"],
  ])
    assert.equal(describeAgentType(submitted).type, type, submitted);
  for (const value of [
    "my-claude-agent",
    "claude-3-7-sonnet",
    "openai",
    "cluade",
    "pi-custom",
    "__proto__",
    "toString",
    "",
  ]) {
    const profile = describeAgentType(value);
    assert.equal(profile.icon, "generic");
    assert.ok(
      renderToStaticMarkup(createElement(AgentIcon, { type: value })).includes(
        'href="#agent-generic"',
      ),
    );
  }
});

/*
  Every tool the agent guide sets up has a docs page (apps/docs/src/agents.ts;
  apps/docs/test/docs-copy.test.mjs fails when a guide section has none), and every page names the
  agentType values the guide gives that tool. Each value must be canonical, named in the guide's
  "Access and identity" section and drawn in the dashboard with that tool's own mark: the Setup
  page's mark for the page, as a dashboard symbol. A new tool fails here until it has all three.
*/
test("every agent in the guide registers as a known type that shows its own mark", async (t) => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  t.after(() => vite.close());
  const { AgentIcon } = await vite.ssrLoadModule("/src/components.tsx");
  const { AgentSymbols } = await vite.ssrLoadModule("/src/agent-symbols.tsx");
  const { agentPages } = await vite.ssrLoadModule("/../docs/src/agents.ts");
  const { agentTypes, describeAgentType, normalizeAgentType } = await vite.ssrLoadModule(
    "/../../packages/api/src/agent-types.ts",
  );
  const symbols = renderToStaticMarkup(createElement(AgentSymbols));
  const guide = await readFile(
    new URL("../../server/src/instructions.md", import.meta.url),
    "utf8",
  );
  const identity = guide.slice(
    guide.indexOf("\n## Access and identity\n"),
    guide.indexOf("\n## Channels and direct chats\n"),
  );
  assert.ok(identity.length > 0, "the guide's Access and identity section");
  // The dashboard draws ChatGPT with OpenAI's Blossom, its `openai` symbol; other marks share IDs.
  const dashboardIcon = (mark) => (mark === "chatgpt" ? "openai" : mark);
  for (const page of agentPages) {
    if (page.group === "other") {
      assert.deepEqual(page.agentTypes, [], `${page.name} is any tool, with no type of its own`);
      continue;
    }
    assert.ok(page.agentTypes.length > 0, `${page.name} names no agentType`);
    for (const type of page.agentTypes) {
      assert.equal(normalizeAgentType(type), type, `${page.name}: ${type} is canonical`);
      const profile = describeAgentType(type);
      assert.equal(profile.icon, dashboardIcon(page.mark), `${page.name}: ${type} shows its mark`);
      assert.ok(symbols.includes(`id="agent-${profile.icon}"`), `Missing ${profile.icon} symbol`);
      const icon = renderToStaticMarkup(createElement(AgentIcon, { type }));
      assert.ok(icon.includes(`href="#agent-${profile.icon}"`), `${type} renders its symbol`);
      assert.ok(identity.includes(`\`${type}\``), `the guide gives ${page.name} \`${type}\``);
    }
  }
  for (const entry of agentTypes)
    assert.ok(identity.includes(`\`${entry.type}\``), `the guide names ${entry.type}`);
});
