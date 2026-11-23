import { Config, ConfigProvider, Context, Effect, Schema } from "effect";
import * as A from "@talkto/api/agent";
import * as E from "@talkto/api/errors";
import * as M from "@talkto/api/models";
import * as U from "@talkto/api/updates";
import * as R from "@talkto/api/renames";
import * as Removals from "@talkto/api/removals";
import * as S from "@talkto/api/signal";
import * as W from "@talkto/api/wake";
import { adminPerMinute, deepReadUnits } from "@talkto/api/pricing";
import type { AccessContext } from "./access.js";
import type * as Budget from "./budgets/client.js";
import * as BudgetModel from "./budgets/model.js";

/**
 * Where a read arrived: an agent tool, the HTTP API, the web app's cross-server views, a hook
 * script checking a participant's signal link, or a wake counting what to announce.
 */
export type Transport = "mcp" | "http" | "dashboard" | "signal" | "wake";
/**
 * One read or poll. `participantId` is set only when the caller names itself in the request.
 * `deep` marks a search; `weight` also knows the deep HTTP operations by name.
 */
export interface Read {
  readonly operation: string;
  readonly transport: Transport;
  readonly participantId: M.ParticipantId | null;
  readonly deep?: boolean;
}
/** One admin call: a write that is not a message (docs/plan-limits.md, "Admin calls"). */
export interface AdminCall {
  readonly operation: string;
  readonly transport: Transport;
  readonly participantId: M.ParticipantId | null;
}
/**
 * Application-owned port that measures every read and poll and, when enabled, refuses reads that
 * arrive faster than the configured limits or the organization's read budget allows. Admin calls
 * pass here too, before they run, and refused sends after they fail. Messages are metered
 * elsewhere.
 */
export class Reads extends Context.Service<
  Reads,
  {
    readonly admit: (access: AccessContext, read: Read) => Effect.Effect<void, E.RateLimited>;
    /** Admit one admin call against the agent's minute and the organization's month. */
    readonly admin: (access: AccessContext, call: AdminCall) => Effect.Effect<void, E.RateLimited>;
    /**
     * Count a send that was refused as one admin call. Fails only when the agent is past its
     * minute, so a loop of refused sends slows down; the month's number never replaces the
     * send's own refusal.
     */
    readonly refused: (
      access: AccessContext,
      call: AdminCall,
    ) => Effect.Effect<void, E.RateLimited>;
  }
>()("@talkto/Reads") {}
/** Standalone and unit compositions: nothing is measured or limited. */
export const unmeasured = Reads.of({
  admit: () => Effect.void,
  admin: () => Effect.void,
  refused: () => Effect.void,
});

/**
 * Deep reads count `deepReadUnits` against the read budget: a search (any transport, the web
 * app's included), a history-archive page, and server-wide timeline, sender or feed pages. They
 * scan the search index or up to 2,000 rows across every conversation. Everything else counts 1.
 */
export const deepOperations: ReadonlySet<string> = new Set([
  "searchMessages",
  "readArchive",
  "serverTimeline",
  "serverTimelineSenders",
  "serverFeed",
  "dashboard.search",
]);
/** The units one read counts against the organization's read budget. */
export const weight = (read: Read) =>
  read.deep === true || deepOperations.has(read.operation) ? deepReadUnits : 1;
/**
 * The web app's reads per person per server a minute: a view reads a server's summary and recent
 * activity and refreshes every 3–60 seconds. After the month's read budget the ceiling drops to
 * `dashboardSlowPerMinute`; people still see their servers, refreshing less often.
 */
export const dashboardPerMinute = 60;
export const dashboardSlowPerMinute = 10;

/**
 * Per-participant reads a minute. Agents following the monitoring procedure poll every 30–60
 * seconds and follow at most four continuation pages per activation (≈10 reads a minute); the web
 * app refreshes every 3–60 seconds. 300 leaves room for a fast history recovery after compaction.
 */
export const defaultParticipantPerMinute = 300;
const Settings = Schema.Struct({
  enabled: Schema.Boolean,
  participantPerMinute: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000 })),
  /** `TALKTO_READ_BUDGETS`: the organization's monthly read budget, bucket and slow lane. */
  budgets: Schema.Boolean,
  /** `TALKTO_ADMIN_BUDGETS`: admin calls per agent a minute and per organization a month. */
  adminBudgets: Schema.Boolean,
});
export interface Settings extends Schema.Schema.Type<typeof Settings> {}
/**
 * `TALKTO_READ_LIMITS=off` turns all read limiting off; measurement continues. `TALKTO_READ_BUDGETS`
 * and `TALKTO_ADMIN_BUDGETS` (both on by default) switch the plan budgets on their own, so either
 * can be turned off without a code change. The last backstop is the `ORGANIZATION_READS`
 * rate-limit binding, whose limit lives in the Wrangler configuration.
 */
export const read = Effect.fn("Reads.configure")(function* (env: Env) {
  const values = yield* Config.all({
    enabled: Config.schema(Schema.Literals(["on", "off"]), "TALKTO_READ_LIMITS").pipe(
      Config.withDefault("on"),
    ),
    participantPerMinute: Config.schema(
      Settings.fields.participantPerMinute,
      "TALKTO_PARTICIPANT_READS_PER_MINUTE",
    ).pipe(Config.withDefault(defaultParticipantPerMinute)),
    budgets: Config.schema(Schema.Literals(["on", "off"]), "TALKTO_READ_BUDGETS").pipe(
      Config.withDefault("on"),
    ),
    adminBudgets: Config.schema(Schema.Literals(["on", "off"]), "TALKTO_ADMIN_BUDGETS").pipe(
      Config.withDefault("on"),
    ),
  }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))));
  return Settings.make({
    ...values,
    enabled: values.enabled === "on",
    budgets: values.budgets === "on",
    adminBudgets: values.adminBudgets === "on",
  });
});

/**
 * Token buckets held in the server object's memory: every request for a server reaches the same
 * object, so the count is exact and costs no storage. Eviction only forgets recent history.
 */
export const makeLimiter = (perMinute: number) => {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const rate = perMinute / 60_000;
  return (key: string, at: number): number | null => {
    const prior = buckets.get(key);
    const tokens =
      prior === undefined ? perMinute : Math.min(perMinute, prior.tokens + (at - prior.at) * rate);
    if (tokens >= 1) {
      buckets.set(key, { tokens: tokens - 1, at });
      // Full buckets carry no information; drop them so idle participants cost nothing.
      if (buckets.size > 1000)
        for (const [name, bucket] of buckets)
          if (bucket.tokens + (at - bucket.at) * rate >= perMinute) buckets.delete(name);
      return null;
    }
    buckets.set(key, { tokens, at });
    return Math.max(1, Math.ceil((1 - tokens) / rate / 1000));
  };
};

/** The organization a server belongs to, as far as this server already knows it. */
export interface Owner {
  readonly accountId: string | null;
  readonly organizationId: string | null;
}
export interface Dependencies {
  readonly settings: Settings;
  /** Workers Analytics Engine dataset; absent where the deployment does not bind one. */
  readonly events: AnalyticsEngineDataset | undefined;
  /** Workers rate-limit binding used as the organization backstop; absent means no backstop. */
  readonly organizationLimit: RateLimit | undefined;
  readonly owner: () => Effect.Effect<Owner>;
  /**
   * The organization's budgets as this server spends them; null where nothing is budgeted
   * (standalone, unknown owner, owner-pilot and self-hosted organizations).
   */
  readonly budget: () => Effect.Effect<Budget.Client | null>;
  /**
   * The time the per-minute buckets refill by: `Clock.currentTimeMillis` in every deployment;
   * verification subclasses may hold it still so a burst's ceiling never depends on machine speed.
   */
  readonly now: Effect.Effect<number>;
}
const organizationRetrySeconds = 60;
/**
 * The organization backstop's refusal. Its real window is the rate-limit binding's own, not this
 * fixed time, so the Worker never remembers it (`refusals.ts`).
 */
export const backstopMessage = `The organization is reading faster than its overall limit allows. Wait ${organizationRetrySeconds} seconds, then retry the same call, and check whether an agent is polling in a loop.`;
type Outcome =
  | "allowed"
  | "participant_limited"
  | "organization_limited"
  | "budget_limited"
  | "slow_limited";
const subjectOf = (
  access: AccessContext,
  participantId: M.ParticipantId | null,
): readonly [kind: string, id: string] =>
  participantId === null ? ["grant", access.grantId] : ["participant", participantId];
/** Measure, then limit: refused reads are measured too, with the limit that refused them. */
export const make = (dependencies: Dependencies) => {
  const { settings, events, organizationLimit } = dependencies;
  const take = makeLimiter(settings.participantPerMinute);
  const dashboard = makeLimiter(dashboardPerMinute);
  const dashboardSlow = makeLimiter(dashboardSlowPerMinute);
  const admins = makeLimiter(adminPerMinute);
  const spend = (lane: BudgetModel.Lane, units: number) =>
    dependencies
      .budget()
      .pipe(
        Effect.flatMap((client) =>
          client === null
            ? Effect.succeed<Budget.Outcome>({ kind: "admitted", slow: false })
            : Effect.promise(() => client.spend(lane, units)),
        ),
      );
  const record = (
    access: AccessContext,
    read: Read,
    owner: Owner,
    subject: readonly [kind: string, id: string],
    outcome: Outcome,
  ) => {
    try {
      events?.writeDataPoint({
        indexes: [owner.accountId ?? owner.organizationId ?? access.serverId],
        blobs: [
          owner.accountId ?? "",
          owner.organizationId ?? "",
          access.serverId,
          subject[0],
          subject[1],
          read.operation,
          read.transport,
          outcome,
        ],
        doubles: [weight(read)],
      });
    } catch {
      // Measurement must never fail a read.
    }
  };
  /** One admin call against the agent's minute; `month` also spends from the organization's month. */
  const adminCall = Effect.fn("Reads.adminCall")(function* (
    access: AccessContext,
    call: AdminCall,
    refused: boolean,
  ) {
    if (!settings.adminBudgets) return;
    // Like read budgets, admin limits are a hosted plan's: owner-pilot organizations and
    // self-hosted copies (no budget to spend from) have none.
    const client = yield* dependencies.budget();
    if (client === null) return;
    const subject = subjectOf(access, call.participantId);
    const who = subject[0] === "participant" ? "participant" : "connection";
    const wait = admins(subject.join(":"), yield* dependencies.now);
    if (wait !== null)
      return yield* new E.RateLimited({
        retryable: true,
        action: "retry_after",
        retryAfterSeconds: wait,
        scope: "participant",
        message: refused
          ? `Too many refused sends: this ${who} has had ${adminPerMinute} admin calls or refused sends in the last minute on this server. Wait ${wait} seconds, read the earlier refusal, and fix its cause before sending again.`
          : `Too many admin calls: this ${who} may register, rename, change channels, signal links or wakes, or have sends refused ${adminPerMinute} times a minute on this server. Wait ${wait} seconds, then retry the same call.`,
      });
    const outcome = yield* Effect.promise(() => client.spend("admin", 1));
    // A refused send keeps its own refusal; only calls about to run are refused for the month.
    if (outcome.kind === "limited" && !refused)
      return yield* new E.RateLimited({
        retryable: true,
        action: "retry_after",
        retryAfterSeconds: outcome.retryAfterSeconds,
        scope: "organization",
        message: BudgetModel.adminMessage(outcome.terms, outcome.retryAfterSeconds),
      });
  });
  return Reads.of({
    admit: Effect.fn("Reads.admit")(function* (access, read) {
      const owner = yield* dependencies.owner();
      // Reads that do not name a participant are attributed to the caller's server grant: the
      // bucket key only, never an identity. Agents sharing a connection share that bucket.
      const subject = subjectOf(access, read.participantId);
      if (!settings.enabled) return record(access, read, owner, subject, "allowed");
      // The web app's views count in the month's read budget but never wait on the agents'
      // bucket: they are bounded per person on each server instead, more tightly once the
      // month's budget is spent. Without budgets they are measured and never refused, as before.
      if (read.transport === "dashboard") {
        if (!settings.budgets) return record(access, read, owner, subject, "allowed");
        const client = yield* dependencies.budget();
        const slow = client?.slow("dashboard") === true;
        const ceiling = slow ? dashboardSlowPerMinute : dashboardPerMinute;
        const pause = (slow ? dashboardSlow : dashboard)(
          subject.join(":"),
          yield* dependencies.now,
        );
        if (pause !== null) {
          record(access, read, owner, subject, slow ? "slow_limited" : "participant_limited");
          return yield* new E.RateLimited({
            retryable: true,
            action: "retry_after",
            retryAfterSeconds: pause,
            scope: "participant",
            message: `Too many reads from the TalkTo website: a person can refresh one server ${ceiling} times a minute${slow ? " while the organization is past its monthly read budget" : ""}. Wait ${pause} seconds.`,
          });
        }
        yield* spend("dashboard", weight(read));
        return record(access, read, owner, subject, "allowed");
      }
      const wait = take(subject.join(":"), yield* dependencies.now);
      if (wait !== null) {
        record(access, read, owner, subject, "participant_limited");
        return yield* new E.RateLimited({
          retryable: true,
          action: "retry_after",
          retryAfterSeconds: wait,
          scope: "participant",
          message: `Too many reads: this ${subject[0] === "participant" ? "participant" : "connection"} is limited to ${settings.participantPerMinute} reads a minute on this server. Wait ${wait} seconds, then retry the same call. Polling every 30–60 seconds as the monitoring procedure describes never reaches this limit.`,
        });
      }
      if (settings.budgets) {
        const outcome = yield* spend("read", weight(read));
        if (outcome.kind === "limited") {
          record(access, read, owner, subject, outcome.slow ? "slow_limited" : "budget_limited");
          return yield* new E.RateLimited({
            retryable: true,
            action: "retry_after",
            retryAfterSeconds: outcome.retryAfterSeconds,
            scope: "organization",
            message: BudgetModel.readMessage(
              outcome.terms,
              outcome.slow,
              outcome.retryAfterSeconds,
            ),
          });
        }
      }
      // The last backstop: one flat per-location limit for every organization, above every
      // plan's bucket, that holds even if the budgets fail open.
      const key = owner.accountId ?? owner.organizationId;
      if (organizationLimit !== undefined && key !== null) {
        const outcome = yield* Effect.promise(() =>
          organizationLimit.limit({ key }).catch(() => ({ success: true })),
        );
        if (!outcome.success) {
          record(access, read, owner, subject, "organization_limited");
          return yield* new E.RateLimited({
            retryable: true,
            action: "retry_after",
            retryAfterSeconds: organizationRetrySeconds,
            scope: "organization",
            message: backstopMessage,
          });
        }
      }
      record(access, read, owner, subject, "allowed");
    }),
    admin: (access, call) => adminCall(access, call, false),
    refused: (access, call) => adminCall(access, call, true),
  });
};
/**
 * The admin call an agent tool makes, or null. Sends are not admin calls; a refused send is
 * counted after it fails (`Reads.refused`).
 */
export const classifyAdmin = (command: A.Command): AdminCall | null => {
  const call = (participantId: M.ParticipantId | null): AdminCall => ({
    operation: command.tool,
    transport: "mcp",
    participantId,
  });
  switch (command.tool) {
    case "register_participant":
      return call(null);
    case R.toolName:
    case Removals.toolName:
    case "create_channel":
    case "set_channel_archived":
    case S.createToolName:
    case S.revokeToolName:
    case W.revokeToolName:
      return call("participantId" in command.input ? command.input.participantId : null);
    default:
      return null;
  }
};
/** Send failures that say nothing about the send itself; retrying them is expected and never counts. */
export const transientFailures: ReadonlySet<string> = new Set([
  "SendingUnavailable",
  "StorageUnavailable",
  "FilesUnavailable",
  "RateLimited",
]);
/** The read an agent tool performs, or null for tools that write or touch no history. */
export const classify = (command: A.Command): Read | null => {
  const read = (participantId: M.ParticipantId | null): Read => ({
    operation: command.tool,
    transport: "mcp",
    participantId,
  });
  switch (command.tool) {
    case U.toolName:
      return read(command.input.participantId);
    case "get_context":
      return read(
        command.input.participant !== undefined && "id" in command.input.participant
          ? command.input.participant.id
          : null,
      );
    case "read_messages":
      // A search scans the search index: a deep read, as over HTTP.
      return command.input.mode === "search" ? { ...read(null), deep: true } : read(null);
    case "read_transfer":
      return read(null);
    case "fetch_transfer":
      return read(command.input.participantId);
    default:
      return null;
  }
};
