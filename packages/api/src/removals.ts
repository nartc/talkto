import { Schema } from "effect";
import * as M from "./models.js";

/**
 * A person removes an agent from a server on the dashboard, or restores it. A removed agent keeps
 * its participant ID, name, conversations and messages, which stay in history marked removed; every
 * agent operation naming its ID is refused with `participant_removed`, its waits end, and its signal
 * links, wakes and Auto-start are deleted. Its name stays reserved until a person renames it.
 * Restoring lets it act again; deleted links and wakes are not brought back.
 */
/** Stable MCP tool name for an agent retiring an agent, the same operation as a removal. */
export const toolName = "retire_participant";
/** Most events one listing returns. */
export const maxEvents = 100;

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
/**
 * Retire an agent on one server, the same as a person removing it on the dashboard. participantId
 * is the calling agent, supplied explicitly like on every agent operation; the connection never
 * chooses it. agentId may be the caller itself or another agent registered through the caller's
 * own person's access. `releaseName: true` (default false) first renames it to
 * `<name>-r-<first 8 characters of its id>`, which frees its name for a new registration;
 * `requestKey` keys that rename.
 */
export const RetireParticipant = Schema.Struct({
  serverId: M.ServerId,
  participantId: M.ParticipantId,
  agentId: M.ParticipantId,
  releaseName: Schema.optionalKey(Schema.Boolean),
  requestKey: Schema.optionalKey(M.RequestKey),
}).annotate(strict);
/** Parsed retirement. */
export type RetireParticipant = typeof RetireParticipant.Type;

/** What happened to the agent. */
export const Action = Schema.Literals(["removed", "restored"]);
/** Parsed action. */
export type Action = typeof Action.Type;

/**
 * One removal or restoration, for the server's Activity view. Names are current names, read when
 * the event is listed, so a later rename or account deletion shows here too.
 */
export const Event = Schema.Struct({
  sequence: M.Count,
  action: Action,
  participantId: M.ParticipantId,
  name: M.Name,
  by: Schema.Struct({ participantId: M.ParticipantId, name: M.Name }),
  at: M.Timestamp,
}).annotate({ identifier: "ParticipantRemovalEvent" });
/** Parsed event. */
export interface Event extends Schema.Schema.Type<typeof Event> {}

/**
 * The agent's current profile after the call. `changed` is false when it was already in the
 * requested state (removing a removed agent, restoring an active one), so a retry is harmless.
 */
export const Result = Schema.Struct({
  participant: M.Participant,
  changed: Schema.Boolean,
}).annotate({ identifier: "RemovalResult" });
/** Parsed result. */
export interface Result extends Schema.Schema.Type<typeof Result> {}

/** Recent removals and restorations on a server, newest first. */
export const ListInput = Schema.Struct({ limit: Schema.optionalKey(M.Limit) }).annotate({
  parseOptions: { onExcessProperty: "error" },
});
/** Parsed listing request. */
export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
/** Newest first, at most `limit` (default 25, at most 100). */
export const List = Schema.Struct({ items: Schema.Array(Event) }).annotate({
  identifier: "RemovalList",
});
/** Parsed listing. */
export interface List extends Schema.Schema.Type<typeof List> {}
