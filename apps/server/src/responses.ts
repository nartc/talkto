import type * as Errors from "@talkto/api/errors";
import { DateTime, Predicate, SchemaIssue } from "effect";
import * as Envelope from "@talkto/api/envelope";
import * as M from "@talkto/api/models";
import * as Telemetry from "./telemetry.js";

/** Report timestamp fields without exposing caller data or a whole schema failure. */
export function timestampError(issue: SchemaIssue.Issue): string | undefined {
  const failure = SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues.find(
    (item) => item.message === M.timestampInputMessage,
  );
  if (failure === undefined) return undefined;
  const field = failure.path
    ?.filter(
      (part) =>
        part === "position" || part === "time" || part === "afterTime" || part === "beforeTime",
    )
    .join(".");
  return `${field || "Timestamp"}: ${M.timestampInputMessage}`;
}

/** Construct fresh public diagnostics from trusted runtime values. */
export function metadata(origin: string, requestId = crypto.randomUUID()): Envelope.Meta {
  return {
    requestId,
    serverTime: M.Timestamp.make(DateTime.formatIso(DateTime.nowUnsafe())),
    instructions: {
      url: `${origin}/instructions`,
      text: "Full service instructions are available at this URL as plain text. Fetch them whenever you need context.",
    },
  };
}
/**
 * Render a bounded public error; raw provider failures never cross this boundary. A 5xx is
 * reported with `cause` when it is an Error (a thrown handler or server object failure).
 */
export function failure(
  status: number,
  code: Envelope.SimpleFailureCode,
  message: string,
  meta: Envelope.Meta,
  cause?: unknown,
): Response {
  if (status >= 500)
    Telemetry.failure(code, meta.requestId, Predicate.isError(cause) ? cause : undefined);
  return unreported(status, code, message, meta);
}

/** Render a bounded public error the caller has already reported at its own level, or need not. */
export function unreported(
  status: number,
  code: Envelope.SimpleFailureCode,
  message: string,
  meta: Envelope.Meta,
): Response {
  const headers = new Headers({
    "cache-control": "no-store",
    "x-request-id": meta.requestId,
    link: `<${meta.instructions.url}>; rel="help"`,
  });
  if (status === 401) headers.set("www-authenticate", 'Bearer realm="TalkTo"');
  return Response.json(Envelope.makeFailure(code, message, meta), { status, headers });
}

/** Translate shared application errors without exposing storage details. */
export const projectFailure = (error: Errors.Failure, meta: Envelope.Meta) => {
  const failure = <const C extends Envelope.SimpleFailureCode>(code: C) =>
    Envelope.makeFailure(code, error.message, meta);
  switch (error._tag) {
    case "MessageAllowanceExhausted":
      return {
        meta,
        error: {
          code: "message_allowance_exhausted" as const,
          message: error.message,
          periodEnd: error.periodEnd,
          retryable: error.retryable,
          action: error.action,
        },
      };
    case "MessagePaymentRequired":
      return {
        meta,
        error: {
          code: "message_payment_required" as const,
          message: error.message,
          periodEnd: error.periodEnd,
          retryable: error.retryable,
          action: error.action,
        },
      };
    case "SendingUnavailable":
      if (!["allocation.pending", "allocation.changed"].includes(error.operation))
        Telemetry.failure("sending_unavailable", meta.requestId, error);
      return {
        meta,
        error: {
          code: "sending_unavailable" as const,
          message: error.message,
          periodEnd: error.periodEnd,
          retryable: error.retryable,
          action: error.action,
        },
      };
    case "InvalidInput":
      return failure("invalid_input");
    case "ServerAccessDenied":
      return failure("server_unavailable");
    case "ParticipantNotFound":
      return failure("participant_not_found");
    case "ConversationNotFound":
      return failure("conversation_not_found");
    case "MessageNotFound":
      return failure("message_not_found");
    case "NameTaken":
      return failure("name_taken");
    case "IdempotencyConflict":
      return failure("idempotency_conflict");
    case "InvalidCursor":
      return failure("invalid_cursor");
    case "InvalidSearch":
      return failure("invalid_search");
    case "SelfConversation":
      return failure("self_conversation");
    case "WrongConversationKind":
      return failure("wrong_conversation_kind");
    case "ProtectedGeneral":
      return failure("protected_general");
    case "RevisionConflict":
      return failure("revision_conflict");
    case "ChannelArchived":
      return failure("channel_archived");
    case "NotConversationParticipant":
      return failure("not_conversation_participant");
    case "NotAnAgent":
    case "RenameNotAllowed":
    case "RetireNotAllowed":
      return failure("forbidden");
    case "ParticipantRemoved":
      return failure("participant_removed");
    case "StorageUnavailable":
      Telemetry.failure("storage_unavailable", meta.requestId, error);
      return failure("storage_unavailable");
    case "FilesUnavailable":
      // An absent store is a deployment fact, not an incident; only a failed store call is reported.
      if (error.reason === "failed")
        Telemetry.failure("files_unavailable", meta.requestId, error, "files");
      return failure("files_unavailable");
    case "TransferNotFound":
      return failure("transfer_not_found");
    case "TransferExpired":
      return failure("transfer_expired");
    case "TransferNotUploaded":
      return failure("transfer_not_uploaded");
    case "StoragePoolFull":
      return {
        meta,
        error: {
          code: "storage_pool_full" as const,
          message: error.message,
          retryable: error.retryable,
          action: error.action,
          limitBytes: error.limitBytes,
          reservedBytes: error.reservedBytes,
          requestedBytes: error.requestedBytes,
          nextExpiryAt: error.nextExpiryAt,
        },
      };
    case "RateLimited":
      return {
        meta,
        error: {
          code: "rate_limited" as const,
          message: error.message,
          retryable: error.retryable,
          action: error.action,
          retryAfterSeconds: error.retryAfterSeconds,
          scope: error.scope,
        },
      };
  }
};
