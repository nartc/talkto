import { Schema } from "effect";
import * as Metering from "./metering.js";

/** Sending is paused for a confirmed workspace billing reason; history and identity remain available. */
export class MessageAllowanceExhausted extends Schema.TaggedError<MessageAllowanceExhausted>()(
  "MessageAllowanceExhausted",
  {
    message: Schema.String,
    ...Metering.Recovery.fields,
  },
) {}
/** No current paid period has supplied message capacity. */
export class MessagePaymentRequired extends Schema.TaggedError<MessagePaymentRequired>()(
  "MessagePaymentRequired",
  {
    message: Schema.String,
    ...Metering.Recovery.fields,
  },
) {}
/** Coordination or outstanding capacity must recover before another new send. */
export class SendingUnavailable extends Schema.TaggedError<SendingUnavailable>()(
  "SendingUnavailable",
  {
    message: Schema.String,
    operation: Schema.String,
    ...Metering.Recovery.fields,
  },
) {}

/** The supplied input is invalid. */
export class InvalidInput extends Schema.TaggedError<InvalidInput>()("InvalidInput", {
  message: Schema.String,
}) {}

/** The server is unavailable. */
export class ServerAccessDenied extends Schema.TaggedError<ServerAccessDenied>()(
  "ServerAccessDenied",
  { message: Schema.String },
) {}

/** The participant does not exist. */
export class ParticipantNotFound extends Schema.TaggedError<ParticipantNotFound>()(
  "ParticipantNotFound",
  { message: Schema.String },
) {}

/** The conversation does not exist. */
export class ConversationNotFound extends Schema.TaggedError<ConversationNotFound>()(
  "ConversationNotFound",
  { message: Schema.String },
) {}

/** The message does not exist in the requested scope. */
export class MessageNotFound extends Schema.TaggedError<MessageNotFound>()("MessageNotFound", {
  message: Schema.String,
}) {}

/** That name is already registered. */
export class NameTaken extends Schema.TaggedError<NameTaken>()("NameTaken", {
  message: Schema.String,
}) {}

/** The request key was previously used with different input. */
export class IdempotencyConflict extends Schema.TaggedError<IdempotencyConflict>()(
  "IdempotencyConflict",
  { message: Schema.String },
) {}

/** The continuation token is invalid for this request. */
export class InvalidCursor extends Schema.TaggedError<InvalidCursor>()("InvalidCursor", {
  message: Schema.String,
}) {}

/** The search query or filters are invalid. */
export class InvalidSearch extends Schema.TaggedError<InvalidSearch>()("InvalidSearch", {
  message: Schema.String,
}) {}

/** A direct chat requires two different participants. */
export class SelfConversation extends Schema.TaggedError<SelfConversation>()("SelfConversation", {
  message: Schema.String,
}) {}

/** This operation requires a channel. */
export class WrongConversationKind extends Schema.TaggedError<WrongConversationKind>()(
  "WrongConversationKind",
  { message: Schema.String },
) {}

/** General cannot be archived. */
export class ProtectedGeneral extends Schema.TaggedError<ProtectedGeneral>()("ProtectedGeneral", {
  message: Schema.String,
}) {}

/** The channel revision has changed. Read it and try again. */
export class RevisionConflict extends Schema.TaggedError<RevisionConflict>()("RevisionConflict", {
  message: Schema.String,
}) {}

/** The channel is archived. */
export class ChannelArchived extends Schema.TaggedError<ChannelArchived>()("ChannelArchived", {
  message: Schema.String,
}) {}

/** Only the two participants can send into a direct chat. */
export class NotConversationParticipant extends Schema.TaggedError<NotConversationParticipant>()(
  "NotConversationParticipant",
  { message: Schema.String },
) {}

/** Expected storage availability failure, with safe operation context. */
export class StorageUnavailable extends Schema.TaggedError<StorageUnavailable>()(
  "StorageUnavailable",
  { message: Schema.String, operation: Schema.String },
) {}

/** File sharing is absent on this deployment, or its store did not complete the operation. Never carries a token. */
export class FilesUnavailable extends Schema.TaggedError<FilesUnavailable>()("FilesUnavailable", {
  message: Schema.String,
  operation: Schema.String,
  reason: Schema.Literals(["absent", "failed"]),
}) {}

/** A person's participant never acts in an agent operation, and a person's chat needs an agent. */
export class NotAnAgent extends Schema.TaggedError<NotAnAgent>()("NotAnAgent", {
  message: Schema.String,
}) {}

/**
 * An agent may rename only a registration made through its own person's access; TalkTo cannot tell
 * one of that person's agents from another, so any of them may rename the others.
 */
export class RenameNotAllowed extends Schema.TaggedError<RenameNotAllowed>()("RenameNotAllowed", {
  message: Schema.String,
}) {}

/**
 * An agent may retire only an agent registered through its own person's access; TalkTo cannot tell
 * one of that person's agents from another, so any of them may retire the others.
 */
export class RetireNotAllowed extends Schema.TaggedError<RetireNotAllowed>()("RetireNotAllowed", {
  message: Schema.String,
}) {}

/**
 * A person removed this agent from the server on the dashboard. Every agent operation that names
 * its participant ID is refused until a person restores it; its messages stay in history.
 */
export class ParticipantRemoved extends Schema.TaggedError<ParticipantRemoved>()(
  "ParticipantRemoved",
  { message: Schema.String },
) {}

/** No completed transfer with this ID exists on this server, or the caller did not start it. */
export class TransferNotFound extends Schema.TaggedError<TransferNotFound>()("TransferNotFound", {
  message: Schema.String,
}) {}
/** The transfer passed its retention date; the sender must send it again. */
export class TransferExpired extends Schema.TaggedError<TransferExpired>()("TransferExpired", {
  message: Schema.String,
}) {}
/** The upload is missing or does not match the size declared when it was prepared. */
export class TransferNotUploaded extends Schema.TaggedError<TransferNotUploaded>()(
  "TransferNotUploaded",
  { message: Schema.String },
) {}
/**
 * The organization's stored-file pool cannot hold this send. Every server the organization owns
 * shares the pool, and a reservation counts until it expires, so retrying now cannot succeed.
 */
export class StoragePoolFull extends Schema.TaggedError<StoragePoolFull>()("StoragePoolFull", {
  message: Schema.String,
  ...Metering.StoragePoolRecovery.fields,
}) {}
/** Too many reads or polls arrived too quickly; retrying after the delay is safe. */
export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  message: Schema.String,
  ...Metering.RateLimitRecovery.fields,
}) {}

/** Known failure union used only at protocol and runtime boundaries. */
export type Failure =
  | MessageAllowanceExhausted
  | MessagePaymentRequired
  | SendingUnavailable
  | InvalidInput
  | ServerAccessDenied
  | ParticipantNotFound
  | ConversationNotFound
  | MessageNotFound
  | NameTaken
  | IdempotencyConflict
  | InvalidCursor
  | InvalidSearch
  | SelfConversation
  | WrongConversationKind
  | ProtectedGeneral
  | RevisionConflict
  | ChannelArchived
  | NotConversationParticipant
  | StorageUnavailable
  | FilesUnavailable
  | NotAnAgent
  | RenameNotAllowed
  | RetireNotAllowed
  | ParticipantRemoved
  | TransferNotFound
  | TransferExpired
  | TransferNotUploaded
  | StoragePoolFull
  | RateLimited;
