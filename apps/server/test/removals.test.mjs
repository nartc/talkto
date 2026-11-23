import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { start } from "./platform-harness.mjs";

const fire = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire";

/** A person signed in on the TalkTo website: session cookie and the website's Origin. */
const website = async (x, user = "user_alice") => {
  const flow = await x.browserLogin(user);
  const cookie = (await flow.callback()).headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-talkto-session="))
    .split(";")[0];
  return async (method, path, value) => {
    const response = await x.raw(path, {
      method,
      headers: { cookie, origin: "https://talkto.test", "content-type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
    });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  };
};

/** One server with Ana and Ben registered over Alice's MCP connection, and removal helpers. */
const setup = async (t, options = {}) => {
  const x = await start(t, {
    transfers: true,
    wakeKey: true,
    wakeTokens: true,
    wakeHandler: () => Response.json({ ok: true }),
    ...options,
  });
  const account = await x.account();
  const server = await x.server(account.id);
  const root = `/v1/servers/${server.id}`;
  const credential = await x.mcpToken(account.organizationId);
  const anaKey = randomUUID();
  const register = async (name, requestKey = randomUUID(), error = false) =>
    x.mcp(
      credential,
      "register_participant",
      { serverId: server.id, name, agentType: "codex", requestKey },
      error,
    );
  const first = (await register("Ana", anaKey)).data;
  const ana = first.item.id;
  const ben = (await register("Ben")).data.item.id;
  const general = first.generalConversationId;
  const call = (name, args, error = false) =>
    x.mcp(credential, name, { serverId: server.id, ...args }, error);
  const send = (participantId, body, error = false) =>
    call(
      "send_message",
      {
        participantId,
        requestKey: randomUUID(),
        target: { kind: "conversation", conversationId: general },
        body,
      },
      error,
    );
  const dashboard = await website(x);
  const remove = (participantId) =>
    dashboard("POST", `${root}/participants/${participantId}/remove`);
  const restore = (participantId) =>
    dashboard("POST", `${root}/participants/${participantId}/restore`);
  return {
    x,
    account,
    server,
    root,
    credential,
    register,
    anaKey,
    ana,
    ben,
    general,
    call,
    send,
    dashboard,
    remove,
    restore,
  };
};

test("only a person on the dashboard removes an agent, never a person, and removing twice changes nothing", async (t) => {
  const s = await setup(t);
  // Agents share their person's connection, so a bearer token cannot remove one.
  const bearer = await s.x.call(
    "user_alice",
    "POST",
    `${s.root}/participants/${s.ben}/remove`,
    undefined,
    403,
  );
  assert.equal(bearer.error.code, "forbidden");
  assert.match(bearer.error.message, /dashboard/);

  const removed = await s.remove(s.ben);
  assert.equal(removed.status, 200, removed.text);
  assert.equal(removed.json.data.changed, true);
  assert.equal(removed.json.data.participant.id, s.ben);
  assert.equal(removed.json.data.participant.name, "Ben", "the name stays");
  assert.ok(Number.isFinite(Date.parse(removed.json.data.participant.removedAt)));
  const again = await s.remove(s.ben);
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.data.changed, false);
  assert.equal(again.json.data.participant.removedAt, removed.json.data.participant.removedAt);

  // The person's own participant, created by the removal, cannot be removed.
  const me = await s.dashboard("GET", `${s.root}/people/me`);
  const person = me.json.data.participant;
  assert.equal(person.kind, "person");
  const refused = await s.remove(person.id);
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.json.error.code, "forbidden");
  const unknown = await s.remove(randomUUID());
  assert.equal(unknown.status, 404, unknown.text);
  assert.equal(unknown.json.error.code, "participant_not_found");

  // Someone without access to the server cannot remove anyone.
  const outsider = await website(s.x, "user_bob");
  const denied = await outsider("POST", `${s.root}/participants/${s.ana}/remove`);
  assert.equal(denied.status, 404, denied.text);
  assert.equal(denied.json.error.code, "server_unavailable");
});

test("a removed agent is refused by every agent operation with participant_removed", async (t) => {
  const s = await setup(t);
  const side = (
    await s.call("create_channel", { participantId: s.ben, name: "side", requestKey: randomUUID() })
  ).data.item;
  await s.send(s.ben, "Ben before removal");
  assert.equal((await s.remove(s.ben)).status, 200);

  const expectRemoved = (result, label) => {
    assert.equal(result.error.code, "participant_removed", `${label}: ${JSON.stringify(result)}`);
    assert.match(result.error.message, /removed from this server by a person/, label);
    assert.match(result.error.message, /restore/, label);
  };
  expectRemoved(await s.send(s.ben, "after removal", true), "send_message");
  expectRemoved(
    await s.call(
      "send_message",
      {
        participantId: s.ben,
        requestKey: randomUUID(),
        target: { kind: "direct", recipientId: s.ana },
        body: "a direct send",
      },
      true,
    ),
    "send_message direct",
  );
  expectRemoved(
    await s.call(
      "get_updates",
      {
        participantId: s.ben,
        mode: "start",
        channelIds: [s.general],
        directChats: "own",
        startAt: "beginning",
      },
      true,
    ),
    "get_updates",
  );
  expectRemoved(
    await s.call(
      "create_channel",
      { participantId: s.ben, name: "another", requestKey: randomUUID() },
      true,
    ),
    "create_channel",
  );
  expectRemoved(
    await s.call(
      "set_channel_archived",
      {
        participantId: s.ben,
        conversationId: side.id,
        archived: true,
        expectedRevision: side.revision,
      },
      true,
    ),
    "set_channel_archived",
  );
  expectRemoved(
    await s.call(
      "rename_participant",
      { participantId: s.ben, name: "ben-renamed", requestKey: randomUUID() },
      true,
    ),
    "rename_participant",
  );
  expectRemoved(
    await s.call(
      "create_signal",
      { participantId: s.ben, channelIds: [s.general], directChats: "own" },
      true,
    ),
    "create_signal",
  );
  expectRemoved(await s.call("revoke_signal", { participantId: s.ben }, true), "revoke_signal");
  expectRemoved(await s.call("list_wakes", { participantId: s.ben }, true), "list_wakes");
  expectRemoved(
    await s.call(
      "prepare_transfer",
      {
        participantId: s.ben,
        requestKey: randomUUID(),
        name: "report.pdf",
        kind: "file",
        bytes: 16,
        sha256: "0".repeat(64),
      },
      true,
    ),
    "prepare_transfer",
  );
  expectRemoved(
    await s.call("fetch_transfer", { participantId: s.ben, transferId: randomUUID() }, true),
    "fetch_transfer",
  );
  // Recovering the identity, by ID or exact name, says why it cannot continue.
  expectRemoved(await s.call("get_context", { participant: { id: s.ben } }, true), "context id");
  expectRemoved(
    await s.call("get_context", { participant: { name: "Ben" } }, true),
    "context name",
  );
  // So does retrying the original registration; the name stays reserved for a new one.
  const benKey = randomUUID();
  const fresh = (await s.register("Cal", benKey)).data.item.id;
  assert.equal((await s.remove(fresh)).status, 200);
  expectRemoved(await s.register("Cal", benKey, true), "register retry");
  const taken = await s.register("Cal", randomUUID(), true);
  assert.equal(taken.error.code, "name_taken");
  assert.match(taken.error.message, /removed/);

  // HTTP answers 403 with the same code.
  const http = await s.x.call(
    "user_alice",
    "POST",
    `${s.root}/conversations/${s.general}/messages`,
    { participantId: s.ben, requestKey: randomUUID(), body: "over HTTP" },
    403,
  );
  assert.equal(http.error.code, "participant_removed");
  // Dashboard wake settings refuse it too.
  const cadence = await s.dashboard("PUT", `${s.root}/participants/${s.ben}/wake-cadence`, {
    cadence: "right_away",
  });
  assert.equal(cadence.status, 403, cadence.text);
  assert.equal(cadence.json.error.code, "participant_removed");

  // Other agents carry on.
  await s.send(s.ana, "Ana still sends");
});

test("removal ends a waiting get_updates call and deletes signal links and wakes; restore brings the agent back without them", async (t) => {
  const s = await setup(t);
  const start = await s.call("get_updates", {
    participantId: s.ben,
    mode: "start",
    channelIds: [s.general],
    directChats: "own",
    startAt: "now",
  });
  const link = (
    await s.call("create_signal", {
      participantId: s.ben,
      channelIds: [s.general],
      directChats: "own",
    })
  ).data.url;
  const check = async () => {
    const target = new URL(link);
    const dot = target.pathname.lastIndexOf(".");
    return (
      await s.x.raw(target.pathname.slice(0, dot), {
        headers: { authorization: `Bearer ${target.pathname.slice(dot + 1)}` },
      })
    ).status;
  };
  assert.equal(await check(), 200);
  const token = `sk-ant-oat01-${randomBytes(24).toString("base64url")}`;
  const wake = await s.dashboard("POST", `${s.root}/participants/${s.ben}/wakes`, {
    kind: "claude_routine",
    url: fire,
    token,
    channelIds: [s.general],
    directChats: "own",
  });
  assert.equal(wake.status, 200, wake.text);

  const started = Date.now();
  const waiting = s.call(
    "get_updates",
    {
      participantId: s.ben,
      mode: "poll",
      checkpoint: start.data.checkpoint,
      waitSeconds: 15,
    },
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await s.remove(s.ben)).status, 200);
  const ended = await waiting;
  assert.equal(ended.error.code, "participant_removed");
  assert.ok(Date.now() - started < 10_000, "the removal ended the wait");
  assert.equal(await check(), 404, "the signal link is gone");

  const restored = await s.restore(s.ben);
  assert.equal(restored.status, 200, restored.text);
  assert.equal(restored.json.data.changed, true);
  assert.equal(restored.json.data.participant.removedAt, undefined);
  assert.equal((await s.restore(s.ben)).json.data.changed, false, "restoring twice is harmless");
  // Same participant, same name; it acts again.
  const sent = await s.send(s.ben, "Ben is back");
  assert.equal(sent.data.item.senderId, s.ben);
  assert.equal(await check(), 404, "links are not brought back");
  const wakes = await s.call("list_wakes", { participantId: s.ben });
  assert.deepEqual(wakes.data.items, [], "wakes are not brought back");
});

test("removed agents stay in history, leave listings and counts, and their name frees only on a rename", async (t) => {
  const s = await setup(t);
  const said = await s.send(s.ben, "Ben's last words");
  assert.equal((await s.remove(s.ben)).status, 200);

  // History keeps the message; the sender is marked removed wherever it is described.
  const history = await s.x.call(
    "user_alice",
    "GET",
    `${s.root}/conversations/${s.general}/messages`,
  );
  assert.ok(history.items.some((item) => item.id === said.data.item.id));
  const sender = (
    await s.x
      .raw(`${s.root}/conversations/${s.general}/messages`, {
        headers: { authorization: `Bearer ${await s.x.token()}` },
      })
      .then((r) => r.json())
  ).included.participants.find((p) => p.id === s.ben);
  assert.ok(sender.removedAt, "the sender carries removedAt");

  // Listings leave it out by default; the removed filter and an exact name lookup find it.
  const names = async (query = "") =>
    (await s.x.call("user_alice", "GET", `${s.root}/participants${query}`)).items
      .filter((p) => p.kind !== "person")
      .map((p) => p.name);
  assert.deepEqual(await names(), ["Ana"]);
  assert.deepEqual(await names("?state=removed"), ["Ben"]);
  assert.deepEqual(await names("?state=all"), ["Ana", "Ben"]);
  assert.deepEqual(await names("?name=Ben"), ["Ben"]);
  const context = await s.call("get_context", {});
  assert.deepEqual(
    context.data.participants.items.filter((p) => p.kind !== "person").map((p) => p.name),
    ["Ana"],
    "get_context leaves removed agents out",
  );
  const summary = await s.x.call("user_alice", "GET", `${s.root}/summary`);
  assert.equal(summary.server.participantCount, 1, "agent counts leave removed agents out");
  assert.ok(summary.participants.every((p) => p.id !== s.ben));

  // A person cannot message it, but can rename it, which frees the name for a new agent.
  const chat = await s.dashboard("POST", `${s.root}/people/me/direct-chats`, {
    agentId: s.ben,
    requestKey: randomUUID(),
  });
  assert.equal(chat.status, 403, chat.text);
  assert.equal(chat.json.error.code, "participant_removed");
  const renamed = await s.dashboard("POST", `${s.root}/people/me/renames`, {
    agentId: s.ben,
    name: "Ben-removed",
    requestKey: randomUUID(),
  });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal(renamed.json.data.participant.removedAt !== undefined, true);
  const newcomer = await s.register("Ben");
  assert.notEqual(newcomer.data.item.id, s.ben);
});

test("removals and restorations are listed for the Activity view, by current names", async (t) => {
  const s = await setup(t);
  await s.remove(s.ben);
  await s.remove(s.ben);
  await s.restore(s.ben);
  const events = (await s.x.call("user_alice", "GET", `${s.root}/removals`)).items;
  assert.deepEqual(
    events.map((item) => [item.action, item.participantId, item.name]),
    [
      ["restored", s.ben, "Ben"],
      ["removed", s.ben, "Ben"],
    ],
    "a no-op removal records nothing",
  );
  const me = (await s.dashboard("GET", `${s.root}/people/me`)).json.data.participant;
  for (const item of events) {
    assert.deepEqual(item.by, { participantId: me.id, name: me.name });
    assert.ok(Number.isFinite(Date.parse(item.at)));
  }
  assert.ok(events[0].sequence > events[1].sequence);
  const limited = (await s.x.call("user_alice", "GET", `${s.root}/removals?limit=1`)).items;
  assert.equal(limited.length, 1);
});

/** An agent retires an agent over MCP, as `participantId`; `error` expects a refusal. */
const retire = (s, participantId, agentId, error = false, token = s.credential) =>
  s.x.mcp(
    token,
    "retire_participant",
    { serverId: s.server.id, participantId, agentId, requestKey: randomUUID() },
    error,
  );

test("an agent retires an agent registered through its own person's access, or itself, as a removal", async (t) => {
  const s = await setup(t);
  const retired = await retire(s, s.ana, s.ben);
  assert.equal(retired.data.changed, true);
  assert.equal(retired.data.participant.id, s.ben);
  assert.equal(retired.data.participant.name, "Ben", "the name stays");
  assert.ok(Number.isFinite(Date.parse(retired.data.participant.removedAt)));
  const refused = await s.send(s.ben, "after retirement", true);
  assert.equal(refused.error.code, "participant_removed");

  // Retiring again changes nothing; the retired agent cannot retire anyone.
  const again = await retire(s, s.ana, s.ben);
  assert.equal(again.data.changed, false);
  assert.equal(again.data.participant.removedAt, retired.data.participant.removedAt);
  const byRetired = await retire(s, s.ben, s.ana, true);
  assert.equal(byRetired.error.code, "participant_removed");
  // The Activity view lists it as a removal by the calling agent.
  const events = (await s.x.call("user_alice", "GET", `${s.root}/removals`)).items;
  assert.deepEqual(
    events.map((item) => [item.action, item.participantId, item.by.participantId]),
    [["removed", s.ben, s.ana]],
  );

  // An agent can retire itself.
  const self = await retire(s, s.ana, s.ana);
  assert.equal(self.data.changed, true);
  assert.equal(self.data.participant.id, s.ana);
  assert.ok(Number.isFinite(Date.parse(self.data.participant.removedAt)));
  const after = await s.send(s.ana, "after retiring myself", true);
  assert.equal(after.error.code, "participant_removed");
});

test("an agent cannot retire an agent registered through another person's access", async (t) => {
  const s = await setup(t);
  await s.x.control("member", s.x.member(s.account.organizationId, "user_bob"));
  await s.x.call("user_alice", "PUT", `${s.root}/access/user_bob`);
  const bobToken = await s.x.mcpToken(s.account.organizationId, "user_bob");
  const bobAgent = (
    await s.x.mcp(bobToken, "register_participant", {
      serverId: s.server.id,
      name: "Bobs-agent",
      agentType: "codex",
      requestKey: randomUUID(),
    })
  ).data.item.id;

  const refused = await retire(s, s.ana, bobAgent, true);
  assert.equal(refused.error.code, "forbidden");
  assert.match(refused.error.message, /own person's access/);
  assert.match(refused.error.message, /dashboard/);
  const reverse = await retire(s, bobAgent, s.ana, true, bobToken);
  assert.equal(reverse.error.code, "forbidden");

  // Neither target was touched.
  const sent = await s.x.mcp(bobToken, "send_message", {
    serverId: s.server.id,
    participantId: bobAgent,
    requestKey: randomUUID(),
    target: { kind: "conversation", conversationId: s.general },
    body: "Bob's agent still sends",
  });
  assert.equal(sent.data.item.senderId, bobAgent);
  await s.send(s.ana, "Ana still sends");
  const events = (await s.x.call("user_alice", "GET", `${s.root}/removals`)).items;
  assert.deepEqual(events, []);
});
