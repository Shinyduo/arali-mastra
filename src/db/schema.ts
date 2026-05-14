import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  json,
  jsonb,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
  pgEnum,
  customType,
  numeric,
  bigint,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Helper for timestamptz
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// pgvector custom type
const vector = (dimensions: number) =>
  customType<{ data: number[]; driverData: unknown }>({
    dataType() {
      return `vector(${dimensions})`;
    },
  });

const tsvector = customType<{ data: string; driverData: unknown }>({
  dataType() {
    return 'tsvector';
  },
});

/***********************************
 * ENUMS (PostgreSQL enum types)
 ***********************************/


export const threadChannelEnum = pgEnum("thread_channel", [
  "email",
  "message",
  "ticket",
  "other",
  "whatsapp",
]);

export const threadStatusEnum = pgEnum("thread_status", [
  "open",
  "pending",
  "closed",
  "spam",
  "archived",
]);

export const threadTypeEnum = pgEnum("thread_type", [
  "external",
  "internal",
]);

export const messageDirectionEnum = pgEnum("message_direction", [
  "inbound",   // from customer
  "outbound",  // from your side
  "internal",  // internal note / internal-only channel
]);

export const messageStatusEnum = pgEnum("message_status", [
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const aiAnalysisStatusEnum = pgEnum("ai_analysis_status", [
  "pending",
  "should_analyze",
  "not_relevant",
  "analyzed",
]);

export const interactionTextChunkSourceTypeEnum = pgEnum(
  "interaction_text_chunk_source_type",
  [
    "audio_segment", // from transcript_segments
    "message",       // from thread_messages
    "mixed",         // spans both, if you ever do that
    "note",          // future notes, etc.
  ]
);


export const integrationAuthModeEnum = pgEnum("integration_auth_mode", [
  "oauth",
  "api_key",
  "webhook_only",
  "none",
]);

export const integrationScopeEnum = pgEnum("integration_scope", [
  "enterprise",
  "user",
]);

export const integrationSyncModeEnum = pgEnum("integration_sync_mode", [
  "webhook",
  "poll",
  "hybrid",
  "manual",
]);

export const integrationSyncStatusEnum = pgEnum("integration_sync_status", [
  "idle",
  "running",
  "healthy",
  "degraded",
  "error",
]);

export const integrationWebhookProcessStatusEnum = pgEnum(
  "integration_webhook_process_status",
  ["pending", "success", "failed"]
);


export const interactionKindEnum = pgEnum("interaction_kind", [
  "meeting",   // scheduled meetings / demos
  "call",      // voice calls
  "thread",    // email/slack/sms/whatsapp threads
  "note",      // manual notes
  "ticket",   // support tickets (freshdesk, jira, etc.)
]);



export const callDirectionEnum = pgEnum("call_direction", [
  "inbound",
  "outbound",
  "internal",
  "unknown",
]);

export const callStatusEnum = pgEnum("call_status", [
  "ringing",
  "answered",
  "completed",
  "missed",
  "voicemail",
  "failed",
  "cancelled",
  "busy",
  "unknown",
]);

export const roleScopeTypeEnum = pgEnum("role_scope_type", [
  "enterprise",
  "org_unit",
  "self",
]);

export const botSessionStateEnum = pgEnum("bot_session_state", [
  "not_started",
  "started",
  "ready",
  "joining",
  "joined_not_recording",
  "joined_recording",
  "joined_recording_permission_denied",
  "leaving",
  "post_processing",
  "ended",
  "fatal_error",
  "waiting_room",
  "cancelled",
  "deleted",
]);



// Priority enum for action items
export const actionItemPriorityEnum = pgEnum("action_item_priority", [
  "low",
  "medium",
  "high",
  "blocker",
]);

export const botTranscriptionStateEnum = pgEnum("bot_transcription_state", [
  "not_started",
  "started",
  "starting",
  "streaming",
  "completed",
  "failed",
]);

export const botRecordingStateEnum = pgEnum("bot_recording_state", [
  "not_started",
  "started",
  "starting",
  "recording",
  "completed",
  "failed",
]);

export const meetingsStateEnum = pgEnum("meetings_state", [
  "scheduled",
  "skip",
  "in_progress",
  "completed",
  "cancelled",
  "error",
  "deleted",
  "no_show",
  "bot_denied_entry",
]);

export const meetingChannelEnum = pgEnum("meeting_channel", [
  "gmeet",
  "zoom",
  "teams",
  "offline",
]);

export const recurringStateEnum = pgEnum("recurring_meetings_state", [
  "active",
  "cancelled",
]);

export const orgUnitTypeEnum = pgEnum("org_unit_type", [
  "sales",
  "cs",
  "onboarding",
  "exec",
  "marketing",
  "pre_sales",
  "support",
  "revops",
]);

// NOTE: Postgres allows a type and a table to share the same name. To avoid TS symbol conflicts, the
// variable is named calendarWebhookEnum while the underlying PG type is "calendar_webhook".
// renamed underlying PG type to avoid collision with an existing DB type
export const calendarWebhookStatusEnum = pgEnum("calendar_webhook_status", [
  "active",
  "expired",
  "error",
]);

// Add a new enum for the type column
export const meetingTypeEnum = pgEnum("meeting_type", ["external", "internal"]);

// Metrics enums
export const metricDataTypeEnum = pgEnum("metric_data_type", [
  "number",
  "percent",
  "boolean",
  "text",
  "enum",
  "json",
]);

export const metricRollupFnEnum = pgEnum("metric_rollup_fn", [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "count_distinct",
  "last_non_null",
]);

export const metricScopeKindEnum = pgEnum("metric_scope_kind", [
  "meeting",
  "participant_in_meeting"
]);

export const metricAggregationLevelEnum = pgEnum("metric_aggregation_level", [
  "self",
  "direct_reports",
  "hierarchy",
  "enterprise",
]);

export const metricGrainEnum = pgEnum("metric_grain", [
  "meeting",
  "daily",
  "user_daily",
]);


// Company lifecycle (mirrors HubSpot closely)
export const companyLifecycleStageEnum = pgEnum("company_lifecycle_stage", [
  "lead",
  "prospect",
  "customer",
  "expansion",
  "churned",
  "lost",
  "partner",
  "other",
]);

// Contact status (mirrors HubSpot)
export const contactStatusEnum = pgEnum("contact_status", [
  "lead",
  "prospect",
  "customer",
  "churned",
  "partner",
  "other",
]);

// Role in customer company (decision makers, champions, etc.)
export const contactRoleEnum = pgEnum("contact_role", [
  "decision_maker",
  "economic_buyer",
  "champion",
  "influencer",
  "user",
  "stakeholder",
  "admin",
  "other",
  "unknown",
]);

// How a contact relates to a company (one person, many roles across companies)
export const customerCompanyRelationEnum = pgEnum("customer_company_relation", [
  "employee",
  "consultant",
  "agency",
  "partner",
  "contractor",
  "other",
]);



// ============================================================
// SECTION A — NEW ENUMS
// ============================================================
 
/**
 * Which entity type a pipeline belongs to (or a stage transition log entry).
 * Extend as you add new pipeline-able entities.
 */
export const pipelineEntityTypeEnum = pgEnum("pipeline_entity_type", [
  "deal",
  "action_item",
  "ticket",
]);
 
/**
 * Top-level commercial outcome of a deal.
 * Separate from pipeline stage — a deal can be "won" and still
 * moving through an onboarding pipeline.
 */
export const dealStatusEnum = pgEnum("deal_status", [
  "open",
  "won",
  "lost",
  "cancelled",
]);
 
/**
 * What commercial motion a deal represents.
 * Matches the architecture doc §3.3.
 */
export const dealTypeEnum = pgEnum("deal_type", [
  "new_business",
  "expansion",
  "renewal",
  "upsell",
  "contraction",
  "churn_save",
]);
 
/**
 * How strictly a pipeline stage enforces completion before advancing.
 *   none — free movement, no validation
 *   soft — warn the user but allow proceeding
 *   hard — block the transition until all requirements are met
 */
export const pipelineGateModeEnum = pgEnum("pipeline_gate_mode", [
  "none",
  "soft",
  "hard",
]);
 
/**
 * Proper enum for subscription_line_item.status.
 * Replaces the raw varchar(50) on the existing stub table.
 */
export const lineItemStatusEnum = pgEnum("line_item_status", [
  "active",
  "cancelled",
  "paused",
  "pending",
]);
 
/**
 * Whether a line item is recurring (counts toward ARR) or one-time
 * (setup fee, training — arr_cents = null for these).
 */
export const subscriptionLineItemBillingTypeEnum = pgEnum("line_item_billing_type", [
  "recurring",
  "one_time",
]);
 


/***********************************
 * TABLES
 ***********************************/
export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: varchar("phone"),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamptz("email_verified_at"),
    provider: text("provider"),
    providerId: varchar("provider_id"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    tokenInvalidatedBefore: timestamptz("token_invalidated_before"),
  },
  (table) => ({
    emailUnique: uniqueIndex("app_user_email_unique").on(table.email),
    phoneUnique: uniqueIndex("app_user_phone_unique").on(table.phone),
  })
);

export const enterprise = pgTable(
  "enterprise",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    subdomain: text("subdomain").notNull(),
    domain: jsonb("domain").default([]),
    isReal: boolean("is_real").notNull().default(false), // New column for identifying real enterprises
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    subdomainUnique: uniqueIndex("enterprise_subdomain_unique").on(
      table.subdomain
    ),
  })
);

// Allow explicit any here because this table is self-referential and causes
// recursive type inference issues with DrawDB/Drizzle; narrow the scope of the
// rule to this single line.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const orgUnit: any = pgTable(
  "org_unit",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: orgUnitTypeEnum("type").notNull().default("exec"),
    parentId: uuid("parent_id").references(() => orgUnit.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUnitEnterpriseIdx: index("org_unit_enterprise_idx").on(
      table.enterpriseId
    ),
    orgUnitParentIdx: index("org_unit_parent_idx").on(table.parentId),
  })
);

export const orgUnitClosure = pgTable(
  "org_unit_closure",
  {
    ancestorId: uuid("ancestor_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),
    descendantId: uuid("descendant_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      name: "org_unit_closure_pk",
      columns: [table.ancestorId, table.descendantId],
    }),
  })
);

export const userEnterprise = pgTable(
  "user_enterprise",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    // Onboarding state stored as a single JSONB document following shape:
    // {
    //   onboarding: { step1: 'done'|'pending', step2: 'done'|'pending', step3: 'done'|'pending'|'skipped', completedOnce: boolean, completedAt?: ISOString },
    //   v: 1,
    //   updatedAt: ISOString
    // }
    onboardingJson: jsonb("onboarding_json"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userEnterpriseUserIdx: index("user_enterprise_user_idx").on(table.userId),
    userEnterpriseEnterpriseIdx: index("user_enterprise_enterprise_idx").on(
      table.enterpriseId
    ),
  })
);

export const role = pgTable(
  "role",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id").references(() => enterprise.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    priority: integer("priority"),
    uiConfig: jsonb("ui_config"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    roleEnterpriseIdx: index("role_enterprise_idx").on(table.enterpriseId),
    roleKeyUnique: uniqueIndex("role_key_unique").on(table.key),
  })
);

export const permission = pgTable(
  "permission",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    permissionResourceIdx: index("permission_resource_idx").on(table.resource),
  })
);

export const rolePermission = pgTable(
  "role_permission",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    rolePermissionRoleIdx: index("role_permission_role_idx").on(table.roleId),
    rolePermissionPermissionIdx: index("role_permission_permission_idx").on(
      table.permissionId
    ),
  })
);

export const userRoleAssignment = pgTable(
  "user_role_assignment",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    enterpriseId: uuid("enterprise_id").references(() => enterprise.id, {
      onDelete: "cascade",
    }),
    scopeType: roleScopeTypeEnum("scope_type"),
    orgUnitId: uuid("org_unit_id").references(() => orgUnit.id, {
      onDelete: "set null",
    }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userRoleAssignmentUserIdx: index("user_role_assignment_user_idx").on(
      table.userId
    ),
    userRoleAssignmentRoleIdx: index("user_role_assignment_role_idx").on(
      table.roleId
    ),
    userRoleAssignmentEnterpriseIdx: index(
      "user_role_assignment_enterprise_idx"
    ).on(table.enterpriseId),
  })
);
export const userOrgUnit = pgTable(
  "user_org_unit",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userOrgUnitUserIdx: index("user_org_unit_user_idx").on(table.userId),
    userOrgUnitOrgUnitIdx: index("user_org_unit_org_unit_idx").on(
      table.orgUnitId
    ),
    userOrgUnitEnterpriseIdx: index("user_org_unit_enterprise_idx").on(
      table.enterpriseId
    ),
  })
);
export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    interactionId: uuid("interaction_id").references(() => interactions.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    channel: meetingChannelEnum("channel"),
    joinUrl: text("join_url"),
    scheduledStartAt: timestamptz("scheduled_start_at").notNull(),
    scheduledEndAt: timestamptz("scheduled_end_at").notNull(),
    status: meetingsStateEnum("status").notNull(),
    hostUserId: uuid("host_user_id"),
    externalMeetingId: text("external_meeting_id"),
    metadata: jsonb("metadata"),
    recurringMeetingId: text("recurring_meeting_id").references(
      () => recurringMeetings.recurringMeetingId,
      { onDelete: "set null" }
    ),
    type: meetingTypeEnum("type").notNull().default("internal"),
    thumbnailUrl: text("thumbnail_url"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    meetingsEnterpriseIdx: index("meetings_enterprise_idx").on(
      table.enterpriseId
    ),
    meetingsHostUserIdx: index("meetings_host_user_idx").on(table.hostUserId),
    meetingsInteractionIdx: index("meetings_interaction_idx").on(
      table.interactionId
    ),
    meetingsExternalMeetingIdUq: unique("meetings_external_meeting_id_uq").on(
      table.externalMeetingId,
      table.enterpriseId
    ),
  })
);


export const participants = pgTable(
  "participants",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id")
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    interactionId: uuid("interaction_id").references(() => interactions.id, {
      onDelete: "cascade",
    }),
    emailId: text("email_id"),
    contactId: uuid("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    contactNumber: text("contact_number"),
    displayName: text("display_name"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    participantsMeetingIdx: index("participants_meeting_idx").on(
      table.meetingId
    ),
    participantsUserIdx: index("participants_user_idx").on(table.userId),
    // Unique constraint on interaction_id + email_id to prevent duplicate participants by email
    participantsInteractionEmailUq: unique(
      "participants_interaction_email_uq"
    ).on(
      table.interactionId,
      table.emailId
    ),

    participantsInteractionPhoneUq: unique(
      "participants_interaction_phone_uq"
    ).on(
      table.interactionId,
      table.contactNumber
    ),

    participantsContactIdx: index("participants_contact_idx").on(table.contactId),
    participantsContactInteractionIdx: index("participants_contact_interaction_idx").on(
      table.contactId,
      table.interactionId
    ),
  })
);

export const recording = pgTable(
  "recording",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id").references(() => meetings.id, {
      onDelete: "cascade",
    }),
    interactionId: uuid("interaction_id").references(() => interactions.id, {
      onDelete: "cascade",
    }),
    storageUrl: text("storage_url"),
    durationMs: integer("duration_ms"),
    status: text("status"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    recordingMeetingIdx: index("recording_meeting_idx").on(table.meetingId),
  })
);

export const transcript = pgTable(
  "transcript",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    interactionId: uuid("interaction_id").references(() => interactions.id, {
      onDelete: "cascade",
    }),
    meetingId: uuid("meeting_id").references(() => meetings.id, {
      onDelete: "cascade",
    }),
    language: text("language").notNull(),
    fullText: text("full_text"),
    searchVector: tsvector("search_vector"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    transcriptMeetingIdx: index("transcript_meeting_idx").on(table.meetingId),
    transcriptSearchGin: index("transcript_search_gin")
      .using("gin", table.searchVector),
  })
);

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    transcriptId: uuid("transcript_id")
      .notNull()
      .references(() => transcript.id, { onDelete: "cascade" }),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),
    speakerName: text("speaker_name"),
    text: text("text"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // The original schema's index name referenced a non-existent column; indexing transcript_id here.
    transcriptSegmentsTranscriptIdx: index(
      "transcript_segments_transcript_idx"
    ).on(table.transcriptId),
  })
);

export const transcriptChunkEmbedding = pgTable(
  "transcript_chunk_embedding",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    transcriptId: uuid("transcript_id").references(() => transcript.id, {
      onDelete: "cascade",
    }),
    chunkIndex: integer("chunk_index"),
    text: text("text"),
    embedding: vector(1536)("embedding"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    transcriptChunkEmbeddingTranscriptIdx: index(
      "transcript_chunk_embedding_transcript_idx"
    ).on(table.transcriptId),
  })
);

export const botSession = pgTable(
  "bot_session",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    vendorBotId: text("vendor_bot_id"),
    state: botSessionStateEnum("state").notNull().default("not_started"),
    transcriptionState: botTranscriptionStateEnum("transcription_state")
      .notNull()
      .default("not_started"),
    recordingState: botRecordingStateEnum("recording_state")
      .notNull()
      .default("not_started"),
    error: text("error"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    botSessionMeetingIdx: index("bot_session_meeting_idx").on(table.meetingId),
    uniqueMeetingId: uniqueIndex("bot_session_meeting_id_unique").on(
      table.meetingId
    ),
  })
);

export const botWebhook = pgTable(
  "bot_webhook",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    rawBody: jsonb("raw_body").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    vendorBotId: text("vendor_bot_id").notNull(),
  },
  (table) => ({
    // Index on vendor_bot_id as per the FK reference in the original schema
    botWebhookVendorIdx: index("bot_webhook_vendor_bot_id_idx").on(
      table.vendorBotId
    ),
  })
);

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id")
      .references(() => appUser.id, { onDelete: "cascade" }),

    // OPTIONAL: which integration account this token belongs to
    integrationAccountId: uuid("integration_account_id").references(
      () => integrationAccount.id,
      { onDelete: "set null" }
    ),

    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    scopes: json("scopes"),
    expiryDate: timestamptz("expiry_date").notNull(),
    isExpired: boolean("is_expired").notNull().default(false),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    tokensUserIdx: index("tokens_user_idx").on(table.userId),
    tokensIntegrationAccountIdx: index(
      "tokens_integration_account_idx"
    ).on(table.integrationAccountId),
  })
);


export const emailVerificationCodes = pgTable(
  "email_verification_codes",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    consumedAt: timestamptz("consumed_at"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
    enterpriseId: uuid("enterprise_id").references(() => enterprise.id),
  },
  (table) => ({
    emailVerificationCodesUserIdx: index(
      "email_verification_codes_user_idx"
    ).on(table.userId),
  })
);

export const calendarWebhook = pgTable(
  "calendar_webhook",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    resourceId: text("resource_id").notNull(),
    channelId: text("channel_id").notNull(),
    expirationDate: timestamptz("expiration_date").notNull(),
    integrationAccountId: uuid("integration_account_id").references(
      () => integrationAccount.id,
      { onDelete: "set null" }
    ),
    status: calendarWebhookStatusEnum("status").notNull(),
    calendarId: text("calendar_id").notNull(), // e.g. "primary"
    token: text("token"), // channel token (optional but recommended)
    nextSyncToken: text("next_sync_token"), // for incremental syncs
    resourceUri: text("resource_uri"),
    logs: json("logs"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    calendarWebhookChannelUnique: uniqueIndex(
      "calendar_webhook_channel_unique"
    ).on(table.channelId),
  })
);

export const calendarWebhookLogs = pgTable("calendar_webhook_logs", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  // store the channel id as plain text; avoid FK constraint to calendar_webhook.channel_id which
  // can cause issues if the unique constraint/order doesn't align during schema push
  channelId: text("channel_id").notNull(),
  logs: json("logs"),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export const recurringMeetings = pgTable(
  "recurring_meetings",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    recurringMeetingId: text("recurring_meeting_id").notNull(),
    lastSync: timestamptz("last_sync"),
    status: recurringStateEnum("status").notNull().default("active"),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    recurringMeetingIdUq: unique(
      "recurring_meetings_recurring_meeting_id_key"
    ).on(t.recurringMeetingId),
  })
);

export const settings = pgTable(
  "settings",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => appUser.id, {
      onDelete: "cascade",
    }),
    type: text("type").notNull(),
    Value: jsonb("value").notNull(), // Store settings as JSONB
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    settingsEnterpriseIdx: index("settings_enterprise_idx").on(
      table.enterpriseId
    ),
    settingsUserIdx: index("settings_user_idx").on(table.userId),
    settingsTypeIdx: index("settings_type_idx").on(table.type),
  })
);

/***********************************
 * METRICS TABLES
 ***********************************/
export const metrics = pgTable(
  "metrics",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id").references(() => enterprise.id, { onDelete: "cascade" }),
    orgUnitId: uuid("org_unit_id").references(() => orgUnit.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    dataType: metricDataTypeEnum("data_type").notNull(),
    unit: text("unit"),
    rollupFn: metricRollupFnEnum("rollup_fn").notNull(),
    higherIsBetter: boolean("higher_is_better").notNull().default(false),
    scopeKind: metricScopeKindEnum("scope_kind").notNull(),
    applicableOrgTypes: jsonb("applicable_org_types").notNull().default("[]"),
    applicableMeetingTypes: jsonb("applicable_meeting_types").notNull().default("[]"),
    applicableInteractionKinds: jsonb("applicable_interaction_kinds").notNull().default("[]"),
    visibleToRoles: jsonb("visible_to_roles").notNull().default("[]"),
    aggregationLevel: metricAggregationLevelEnum("aggregation_level").notNull(),
    buckets: jsonb("buckets"),
    version: integer("version").notNull().default(1),
    isAiGenerated: text("is_ai_generated"),
    isMandatory: boolean("is_mandatory").notNull().default(false),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    metricsApplicableOrgTypesGin: index(
      "metrics_applicable_org_types_gin"
    ).using("gin", table.applicableOrgTypes),
    metricsApplicableMeetingTypesGin: index(
      "metrics_applicable_meeting_types_gin"
    ).using("gin", table.applicableMeetingTypes),
    metricsApplicableInteractionKindsGin: index("metrics_applicable_interaction_kinds_gin").using(
      "gin",
      table.applicableInteractionKinds
    ),
    metricsVisibleToRolesGin: index("metrics_visible_to_roles_gin").using(
      "gin",
      table.visibleToRoles
    ),
  })
);

export const metricsData = pgTable(
  "metrics_data",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    metricId: uuid("metric_id")
      .notNull()
      .references(() => metrics.id, { onDelete: "cascade" }),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    // NEW world: scope by interaction, user, meeting as needed
    interactionId: uuid("interaction_id").references(() => interactions.id, {
      onDelete: "cascade",
    }),

    // Legacy: meeting-level scope (you can eventually drop this)
    meetingId: uuid("meeting_id").references(() => meetings.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    grain: metricGrainEnum("grain").notNull(),
    date: timestamp("date", { mode: "date" }),
    valueNumber: text("value_number"),
    valueText: text("value_text"),
    valueJson: jsonb("value_json"),
    computedAt: timestamptz("computed_at").defaultNow().notNull(),
    sourceHostUserId: uuid("source_host_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    sourceOrgUnitId: uuid("source_org_unit_id").references(() => orgUnit.id, {
      onDelete: "set null",
    }),
  },
  (table) => ({
    // aggregate by enterprise + date + grain (org-unit comes via interactionOrgUnitMapping)
    metricsDataEntDateGrainIdx: index(
      "metrics_data_ent_date_grain_idx"
    ).on(table.enterpriseId, table.date, table.grain),

    metricsDataMetricMeetingIdx: index("metrics_data_metric_meeting_idx").on(
      table.metricId,
      table.meetingId
    ),

    metricsDataMetricInteractionIdx: index(
      "metrics_data_metric_interaction_idx"
    ).on(table.metricId, table.interactionId),

    metricsDataMetricUserDateIdx: index("metrics_data_metric_user_date_idx").on(
      table.metricId,
      table.userId,
      table.date
    ),
    metricsDataInteractionMetricIdx: index(
      "metrics_data_interaction_metric_idx"
    ).on(table.interactionId, table.metricId),
  })
);


export const chatMessages = pgTable(
  "chat_messages",
  {
    // 1) id
    id: text("id").primaryKey().notNull(), // provider msg id

    // 2) meeting_id → meetings(id)
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),

    // 3) participant_id → participants(id) (nullable if sender can't be resolved)
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),

    // 4) recipient (default 'everyone')
    recipient: text("recipient").notNull().default("everyone"),

    // 5) text
    text: text("text").notNull(),

    // 6) timestamp - date time (timestamptz)
    timestamp: timestamptz("timestamp").notNull(),

    // 7) metadata (jsonb)
    metadata: jsonb("metadata").notNull().default({}),

    // 8) created_at / updated_at
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Fast filters by meeting + time
    chatByMeetingTsIdx: index("chat_messages_meeting_ts_idx").on(
      t.meetingId,
      t.timestamp
    ),
    // Handy when you want all msgs from a participant
    chatByParticipantIdx: index("chat_messages_participant_idx").on(
      t.participantId
    ),
  })
);

// --- Participant sessions (per-join window) ---------------------------------
export const participantSessions = pgTable(
  "participant_sessions",
  {
    // 1) id
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    // 2) meeting_id → meetings(id)
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),

    // 3) participant_id → participants(id)
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),

    // 4) join_time
    joinTime: timestamptz("join_time").notNull(),

    // 5) end_time
    endTime: timestamptz("end_time"),

    // (Standard stamps for consistency with your codebase)
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Common lookups
    psByMeetingIdx: index("participant_sessions_meeting_idx").on(t.meetingId),
    psByParticipantIdx: index("participant_sessions_participant_idx").on(
      t.participantId
    ),
    // De-dupe guard if you want at-most-one open window at a given join_time
    psMeetingParticipantJoinUq: uniqueIndex(
      "participant_sessions_meeting_participant_join_uq"
    ).on(t.meetingId, t.participantId, t.joinTime),
  })
);



export const orgUnitDailyMetrics = pgTable(
  "org_unit_daily_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),

    // window end anchor (e.g. '2025-10-26')
    windowEndDate: timestamp("window_end_date", { mode: "date" }).notNull(),

    // window length in days (1, 7, 30...)
    windowDays: integer("window_days").notNull().default(1),

    // metric catalog FK
    metricId: uuid("metric_id")
      .notNull()
      .references(() => metrics.id, { onDelete: "cascade" }),

    // aggregated values
    valueNumber: text("value_number"),
    valueJson: jsonb("value_json"),

    // bookkeeping
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    // upsert guard: unique per (org, metric, windowEndDate, windowDays)
    ouDailyUnique: uniqueIndex("ou_daily_unique").on(
      t.enterpriseId,
      t.orgUnitId,
      t.metricId,
      t.windowEndDate,
      t.windowDays
    ),

    // dashboard lookup: this matches the WHERE clause shape in your API
    ouDailyLookupIdx: index("ou_daily_lookup_idx").on(
      t.enterpriseId,
      t.orgUnitId,
      t.windowEndDate,
      t.windowDays
    ),
  })
);

export const orgUnitMeetingMapping = pgTable(
  "org_unit_meeting_mapping",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgUnitMeetingMappingOrgUnitIdx: index(
      "org_unit_meeting_mapping_org_unit_idx"
    ).on(table.orgUnitId),
    orgUnitMeetingMappingMeetingIdx: index(
      "org_unit_meeting_mapping_meeting_idx"
    ).on(table.meetingId),
    orgUnitMeetingMappingUq: uniqueIndex(
      "org_unit_meeting_mapping_uq"
    ).on(table.orgUnitId, table.meetingId),
  })
);

export const meetingInsights = pgTable(
  "meeting_insights",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    meetingId: uuid("meeting_id")
      .references(() => meetings.id, { onDelete: "set null" }),

    interactionId: uuid("interaction_id").references(() => interactions.id, {
      onDelete: "set null",
    }),

    participantId: uuid("participant_id")
      .references(() => participants.id, { onDelete: "set null" }),

    productId: text("product_id"),

    metricKey: text("metric_key").notNull(),

    detailsJson: jsonb("details_json"),
    // type-specific metadata (reason, product, severity, evidence, etc.)

    // --- Transcript anchor (optional) ---
    transcriptTs: text("transcript_ts"),
    // Store as PostgreSQL INTERVAL for HH:MM:SS accuracy & filtering.

    // --- Embeddings & Clustering ---
    embedding: vector(3072)("embedding"),
    // BGE-large (normalized), optional unless type='feature'

    clusterId: text("cluster_id").references(() => insightClusters.id, { onDelete: "set null" }),
    // assigned by offline/online clusterer; null until processed

    // --- Timestamp ---
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (table) => ({
    meetingInsightsDetailsJsonGin: index("meeting_insights_details_json_gin")
      .using("gin", table.detailsJson),
  })
);


// NOTE: Postgres allows a type and a table to share the same name. To avoid TS symbol conflicts
// and recursive type inference issues with self-referential columns, we use explicit any here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const insightClusters: any = pgTable("insight_clusters", {
  id: text("id").primaryKey(),

  enterpriseId: uuid("enterprise_id")
    .notNull()
    .references(() => enterprise.id, { onDelete: "cascade" }),

  metricKey: text("metric_key").notNull(),

  productId: text("product_id"),

  // Human-friendly metadata (LLM assigned)
  name: text("name"),
  type: text("type"),
  description: text("description"),

  // Clustering metadata
  centroid: vector(3072)("centroid").notNull(),
  size: integer("size").notNull().default(0),

  // NEW: Seeded cluster flag
  isSeeded: boolean("is_seeded").notNull().default(false),

  // NEW: Merge tracking
  mergedInto: text("merged_into").references(() => insightClusters.id, { onDelete: "set null" }),
  mergedAt: timestamptz("merged_at"),

  // NEW: When cluster first appeared (for trend detection)
  firstSeenAt: timestamptz("first_seen_at").defaultNow().notNull(),

  // NEW: Size history for trend tracking
  // Format: { "size_history": [{"date": "2025-01-20", "size": 5}, ...] }
  metadata: jsonb("metadata").notNull().default("{}"),

  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export const interactions = pgTable(
  "interactions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    kind: interactionKindEnum("kind").notNull(),
    // 'meeting' | 'call' | 'thread' | 'note'

    // Display fields
    title: text("title").notNull(),
    summary: text("summary"),

    // Canonical activity window
    startAt: timestamptz("start_at"),
    endAt: timestamptz("end_at"),

    // Where this came from
    source: text("source").notNull().default("integration"),
    // 'integration' | 'manual' | 'system'

    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    interactionsKindIdx: index("interactions_kind_idx").on(t.kind),
    interactionsStartAtKindIdx: index("interactions_start_at_kind_idx").on(
      t.startAt,
      t.kind
    ),
  })
);


export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    // 1–1 with interactions(kind='call')
    interactionId: uuid("interaction_id")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // Provider identity
    provider: text("provider").notNull(),
    // 'aircall' | 'nooks' | 'twilio' | ...

    externalCallId: text("external_call_id").notNull(),
    // provider call id

    externalAccountId: text("external_account_id"),
    // provider account/workspace id (optional, can also be in metadata)

    // Direction & numbers
    direction: callDirectionEnum("direction")
      .notNull()
      .default("unknown"),

    fromNumber: text("from_number"),
    toNumber: text("to_number"),

    // Normalized status
    status: callStatusEnum("status").notNull().default("unknown"),

    durationSeconds: integer("duration_seconds"),
    analytics: jsonb("analytics").notNull().default("{}"),

    // Provider-specific junk (rawStatus, queue, tags, etc.)
    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    callsInteractionUnique: uniqueIndex("calls_interaction_unique").on(
      t.interactionId
    ),
    callsProviderExternalUq: uniqueIndex("calls_provider_external_uq").on(
      t.provider,
      t.externalCallId,
      t.enterpriseId
    ),
    callsEnterpriseIdx: index("calls_enterprise_idx").on(t.enterpriseId),
    callsFromNumberIdx: index("calls_from_number_idx").on(t.fromNumber),
    callsToNumberIdx: index("calls_to_number_idx").on(t.toNumber),
  })
);

export const interactionOrgUnitMapping = pgTable(
  "interaction_org_unit_mapping",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    interactionId: uuid("interaction_id")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),

    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    interactionOrgUnitIdx: index("interaction_org_unit_idx").on(
      t.interactionId,
      t.orgUnitId
    ),
    interactionOrgUnitEnterpriseIdx: index(
      "interaction_org_unit_enterprise_idx"
    ).on(t.enterpriseId, t.interactionId),
    interactionOrgUnitUq: uniqueIndex("interaction_org_unit_uq").on(
      t.interactionId,
      t.orgUnitId
    ),
  })
);

export const integrationProvider = pgTable(
  "integration_provider",
  {
    // e.g. 'aircall', 'hubspot', 'whatsapp', 'gmail'
    key: text("key").primaryKey().notNull(),

    // Display name: 'Aircall', 'HubSpot CRM'
    name: text("name").notNull(),

    // Optional: 'telephony' | 'crm' | 'messaging' | 'calendar'
    category: text("category"),

    // Toggle per-deployment
    isEnabled: boolean("is_enabled").notNull().default(true),

    // Provider-level config (e.g. base URL, docs links, default scopes)
    config: jsonb("config").notNull().default("{}"),
    oauthProviderKey: text("oauth_provider_key").references(
      (): AnyPgColumn => integrationProvider.key,
      { onDelete: "set null" }
    ),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    integrationProviderCategoryIdx: index(
      "integration_provider_category_idx"
    ).on(t.category),
  })
);


export const integrationAccount = pgTable(
  "integration_account",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // Optional: for user-scoped connections (e.g. Gmail, personal HubSpot)
    userId: uuid("user_id").references(() => appUser.id, {
      onDelete: "cascade",
    }),

    // e.g. 'aircall', 'hubspot'
    providerKey: text("provider_key")
      .notNull()
      .references(() => integrationProvider.key, { onDelete: "set null" }),

    // 'enterprise' vs 'user'
    scope: integrationScopeEnum("scope").notNull(),

    // 'oauth' | 'api_key' | 'webhook_only'
    authMode: integrationAuthModeEnum("auth_mode").notNull(),

    // Optional label for UI: "Acme Sales Aircall", "Akshat's HubSpot"
    displayName: text("display_name"),

    // For api_key mode
    apiKey: text("api_key"),

    // For inbound webhooks: URL will embed this
    publicWebhookId: uuid("public_webhook_id"),

    // For signing / verification
    webhookSecret: text("webhook_secret"),

    // Provider-specific config: team ids, number filters, etc.
    config: jsonb("config").notNull().default("{}"),

    lastError: text("last_error"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    integrationAccountProviderScopeIdx: index(
      "integration_account_provider_scope_idx"
    ).on(t.providerKey, t.scope),
    integrationAccountEnterpriseIdx: index(
      "integration_account_enterprise_idx"
    ).on(t.enterpriseId),
    integrationAccountUserIdx: index("integration_account_user_idx").on(
      t.userId
    ),
    integrationAccountWebhookIdUq: uniqueIndex(
      "integration_account_webhook_id_uq"
    ).on(t.publicWebhookId),
  })
);

export const integrationSyncState = pgTable(
  "integration_sync_state",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    integrationAccountId: uuid("integration_account_id")
      .references(() => integrationAccount.id, { onDelete: "set null" }),

    providerKey: text("provider_key")
      .references(() => integrationProvider.key, { onDelete: "set null" }),

    // e.g. 'call', 'recording', 'contact', 'company', 'deal'
    objectType: text("object_type").notNull(),

    // 'webhook' | 'poll' | 'hybrid' | 'manual'
    syncMode: integrationSyncModeEnum("sync_mode")
      .notNull()
      .default("webhook"),

    status: integrationSyncStatusEnum("status")
      .notNull()
      .default("idle"),

    // Cursor-like checkpoint: page cursor, since timestamp, id, etc.
    cursor: text("cursor"),

    // Last external "updated_at" or equivalent
    lastSyncedExternalUpdatedAt: timestamptz(
      "last_synced_external_updated_at"
    ),

    lastRunStartedAt: timestamptz("last_run_started_at"),
    lastRunFinishedAt: timestamptz("last_run_finished_at"),

    lastError: text("last_error"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    integrationSyncStateAccountObjUq: uniqueIndex(
      "integration_sync_state_account_obj_uq"
    ).on(t.integrationAccountId, t.objectType),
    integrationSyncStateProviderIdx: index(
      "integration_sync_state_provider_idx"
    ).on(t.providerKey, t.objectType),
  })
);

export const integrationWebhookEvent = pgTable(
  "integration_webhook_event",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    integrationAccountId: uuid("integration_account_id")
      .notNull()
      .references(() => integrationAccount.id, { onDelete: "set null" }),

    providerKey: text("provider_key")
      .notNull()
      .references(() => integrationProvider.key, { onDelete: "set null" }),

    // Provider’s event id if they send one
    externalEventId: text("external_event_id"),

    // e.g. 'call.created', 'call.ended', 'contact.created'
    eventType: text("event_type").notNull(),

    rawBody: jsonb("raw_body").notNull(),

    processStatus: integrationWebhookProcessStatusEnum(
      "process_status"
    ).notNull().default("pending"),

    processError: text("process_error"),
    processedAt: timestamptz("processed_at"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    integrationWebhookEventAccountIdx: index(
      "integration_webhook_event_account_idx"
    ).on(t.integrationAccountId, t.processStatus),
    integrationWebhookEventExternalUq: uniqueIndex(
      "integration_webhook_event_external_uq"
    ).on(t.providerKey, t.externalEventId),
  })
);

export const integrationObjectMapping = pgTable(
  "integration_object_mapping",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    integrationAccountId: uuid("integration_account_id")
      .references(() => integrationAccount.id, { onDelete: "set null" }),

    providerKey: text("provider_key")
      .references(() => integrationProvider.key, { onDelete: "set null" }),

    // 'call' | 'recording' | 'meeting' | 'contact' | 'company' | 'deal' | ...
    objectType: text("object_type").notNull(),

    // Provider’s primary id for this object (e.g. Aircall call id)
    externalId: text("external_id").notNull(),

    // Optional secondary disambiguator if needed (e.g. line id, tenant id)
    externalSecondaryId: text("external_secondary_id"),

    // Links into your domain model
    interactionId: uuid("interaction_id").references(() => interactions.id, {
      onDelete: "set null",
    }),

    objectId: uuid("object_id"),

    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    integrationObjectExternalUq: uniqueIndex(
      "integration_object_external_uq"
    ).on(t.integrationAccountId, t.objectType, t.externalId),
    integrationObjectInteractionIdx: index(
      "integration_object_interaction_idx"
    ).on(t.interactionId),
    integrationObjectMeetingIdx: index("integration_object_idx").on(
      t.objectId)
  })
);

export const kbDocument = pgTable(
  "kb_document",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    // Hierarchical ownership (only one is set, others null)
    enterpriseId: uuid("enterprise_id").references(() => enterprise.id, {
      onDelete: "cascade",
    }),
    orgUnitId: uuid("org_unit_id").references(() => orgUnit.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => appUser.id, {
      onDelete: "cascade",
    }),

    // Content
    title: text("title").notNull(),
    content: text("content").notNull(),

    // Metadata
    category: text("category"), // 'product' | 'competitor' | 'other' | etc.
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "set null" }),

    // File storage (for PDFs)
    fileUrl: text("file_url"),
    fileName: text("file_name"),
    fileMimeType: text("file_mime_type"), // 'application/pdf'

    source: text("source").notNull().default("manual"), // 'manual' | 'pdf' | 'transcript'
    metadata: jsonb("metadata").notNull().default("{}"),

    isArchived: boolean("is_archived").notNull().default(false),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    kbDocEnterpriseIdx: index("kb_document_enterprise_idx").on(t.enterpriseId),
    kbDocOrgUnitIdx: index("kb_document_org_unit_idx").on(t.orgUnitId),
    kbDocUserIdx: index("kb_document_user_idx").on(t.userId),
    kbDocCategoryIdx: index("kb_document_category_idx").on(t.category),
    kbDocCreatedByIdx: index("kb_document_created_by_idx").on(
      t.createdByUserId
    ),
  })
);

export const kbDocumentEmbedding = pgTable(
  "kb_document_embedding",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => kbDocument.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index"),
    embedding: vector(1536)("embedding"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    kbDocEmbeddingDocIdx: uniqueIndex("kb_document_embedding_doc_idx").on(
      t.documentId,
      t.chunkIndex
    ),
  })
);



// customer and company tables

// ============================================
// 1. COMPANIES (Customer Accounts)
// ============================================
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // Display info
    name: text("name").notNull(),
    domain: text("domain"), // e.g., "acme.com" - used for email-based matching
    // Lifecycle & ownership
    // lifecycleStage: companyLifecycleStageEnum("lifecycle_stage")
    //   .notNull()
    //   .default("lead"),

    ownerUserId: uuid("owner_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    healthScore: integer("health_score"),
    currency: text("currency"),
    healthScoreComputedAt: timestamptz("health_score_computed_at"),
    healthScoreBreakdown: jsonb("health_score_breakdown"),
    ARR: integer("arr"),
    stageDefinitionId: uuid("stage_definition_id").references(
      () => stageDefinition.id,
      { onDelete: "set null" }
    ),

    // Store arbitrary CS/CRM fields that don't deserve columns yet
    // (e.g., ARR, contract_value, customer_health_score, etc.)
    attributes: jsonb("attributes").notNull().default("{}"),
    externalCompanyId: text("external_company_id"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companiesEnterpriseIdx: index("companies_enterprise_idx").on(
      table.enterpriseId
    ),
    companiesDomainIdx: index("companies_domain_idx").on(table.domain),
    companiesOwnerIdx: index("companies_owner_idx").on(table.ownerUserId),
    // IMPORTANT: domain + enterprise unique. Same domain can't exist twice in one enterprise.
    companiesEnterpriseExternalIdUq: uniqueIndex(
      "companies_enterprise_external_id_uq"
    ).on(table.enterpriseId, table.externalCompanyId),
    companiesHealthScoreIdx: index("companies_health_score_idx").on(table.healthScore),
    companiesStageIdx: index("companies_stage_idx").on(
      table.enterpriseId,
      table.stageDefinitionId
    ),
  })
);

// ============================================
// 2. CONTACTS (Customer People)
// ============================================
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // Name fields
    fullName: text("full_name"),

    // Title at company
    title: text("title"),

    // Internal owner (CSM, AE, etc.)
    ownerUserId: uuid("owner_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),

    // Flag to indicate if the contact needs to be analyzed
    toAnalyze: boolean("to_analyze").notNull().default(true),

    stageDefinitionId: uuid("stage_definition_id").references(
      () => stageDefinition.id,
      { onDelete: "set null" }
    ),

    // Freeform attributes (secondary emails, alternate phones, LinkedIn, etc.)
    attributes: jsonb("attributes").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactsEnterpriseIdx: index("contacts_enterprise_idx").on(
      table.enterpriseId
    ),
    contactsStageIdx: index("contacts_stage_idx").on(
      table.enterpriseId,
      table.stageDefinitionId
    ),
    // contactsOwnerIdx: index("contacts_owner_idx").on(table.ownerUserId),
    // NOTE: We do NOT make (enterprise_id, primary_email) unique.
    // Reason: same person (e.g., consultant) can exist in same enterprise under different contexts.
    // Deduping is a product-layer concern, not schema enforcement.
  })
);

// ============================================
// 3. CUSTOMER_COMPANY (Contact ↔ Company M2M)
// ============================================
export const customerCompany = pgTable(
  "customer_company",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),

    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Role at company (employee, consultant, etc.)
    relation: customerCompanyRelationEnum("relation")
      .notNull()
      .default("employee"),

    // Primary company for this contact (e.g., where they work)
    isPrimary: boolean("is_primary").notNull().default(false),

    // Arbitrary fields: department, reports_to, started_date, etc.
    attributes: jsonb("attributes").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Unique: one contact ↔ company pairing per enterprise
    customerCompanyUq: uniqueIndex("customer_company_uq").on(
      table.contactId,
      table.companyId
    ),
    customerCompanyEnterpriseIdx: index("customer_company_enterprise_idx").on(
      table.enterpriseId
    ),
    customerCompanyCompanyIdx: index("customer_company_company_idx").on(
      table.companyId
    ),
    customerCompanyContactIdx: index("customer_company_contact_idx").on(
      table.contactId
    ),
  })
);

// ============================================
// 4. INTERACTION_COMPANY (Interaction ↔ Company M2M)
// ============================================
export const interactionCompany = pgTable(
  "interaction_company",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    interactionId: uuid("interaction_id")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),

    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Optional: role of company in this interaction (e.g., "primary_account", "vendor", "partner")
    role: text("role"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Unique: one company per interaction (no duplicates)
    interactionCompanyUq: uniqueIndex("interaction_company_uq").on(
      table.interactionId,
      table.companyId
    ),
    interactionCompanyEnterpriseIdx: index(
      "interaction_company_enterprise_idx"
    ).on(table.enterpriseId),
    interactionCompanyCompanyIdx: index("interaction_company_company_idx").on(
      table.companyId
    ),
  })
);


export const threads = pgTable(
  "threads",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    // 1–1 with interactions(kind='thread')
    interactionId: uuid("interaction_id")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // Integration / provider identity
    providerKey: text("provider_key")
      .notNull()
      .references(() => integrationProvider.key, { onDelete: "set null" }),

    integrationAccountId: uuid("integration_account_id").references(
      () => integrationAccount.id,
      { onDelete: "set null" }
    ),

    // Channel & external thread/ticket id
    channel: threadChannelEnum("channel").notNull(),

    // Provider’s thread / conversation / ticket id
    externalThreadId: text("external_thread_id").notNull(),

    // Display / status
    subject: text("subject"),
    status: threadStatusEnum("status").notNull().default("open"),

    // Whether the thread is internal (e.g. internal notes) or external (customer-facing)
    type: threadTypeEnum("type").notNull().default("external"),

    firstMessageAt: timestamptz("first_message_at"),
    lastMessageAt: timestamptz("last_message_at"),

    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Guard 1–1 with interaction
    threadsInteractionUq: uniqueIndex("threads_interaction_uq").on(
      t.interactionId
    ),

    // Unique per external thread in a given enterprise + provider + channel
    threadsExternalUq: uniqueIndex("threads_external_uq").on(
      t.enterpriseId,
      t.providerKey,
      t.channel,
      t.externalThreadId,
    ),

    threadsEnterpriseIdx: index("threads_enterprise_idx").on(t.enterpriseId),
    threadsProviderIdx: index("threads_provider_idx").on(
      t.providerKey,
      t.channel
    ),
  })
);


export const threadMessages = pgTable(
  "thread_messages",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),



    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // Provider message id (gmail msg id, whatsapp msg id, slack ts, ticket note id, etc.)
    externalMessageId: text("external_message_id").notNull(),

    direction: messageDirectionEnum("direction").notNull(),

    // Who sent it (one of these will be set)
    fromUserId: uuid("from_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    fromContactId: uuid("from_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    fromParticipantId: uuid("from_participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),
    aiAnalysisStatus: aiAnalysisStatusEnum("ai_analysis_status").notNull().default("pending"),

    // Email-specific addressing (for non-email channels these can stay null or in metadata)
    fromEmail: text("from_email"),
    toEmails: jsonb("to_emails"),   // array of strings
    ccEmails: jsonb("cc_emails"),   // array of strings
    bccEmails: jsonb("bcc_emails"), // array of strings

    // Optional per-message subject (mostly useful for email)
    subject: text("subject"),
    // Content
    textBody: text("text_body"),
    htmlBody: text("html_body"),
    searchVector: tsvector("search_vector"),
    embedding: vector(1536)("embedding"),
    // Provider timestamp (when message was sent)
    sentAt: timestamptz("sent_at"),

    status: messageStatusEnum("status").default("sent"),

    metadata: jsonb("metadata").notNull().default("{}"),

    attachments: jsonb("attachments").notNull().default("[]"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Idempotency: one provider message per thread
    threadMessagesThreadExternalUq: uniqueIndex(
      "thread_messages_thread_external_uq"
    ).on(t.threadId, t.externalMessageId),


    threadMessagesFromUserIdx: index("thread_messages_from_user_idx").on(
      t.fromUserId
    ),
    threadMessagesSearchGin: index("thread_messages_search_gin")
      .using("gin", t.searchVector),
    threadMessagesFromContactIdx: index("thread_messages_from_contact_idx").on(
      t.fromContactId
    ),
    threadMessagesEnterpriseExtMsgIdx: index("thread_messages_enterprise_ext_msg_idx").on(
      t.enterpriseId,
      t.externalMessageId,
    ),
  })
);

export const actionItem = pgTable(
  "action_item",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),
    ownerUserId: uuid("owner_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    timestamp: text("timestamp"), // HH:MM:SS format from 
    overdueAt: timestamptz("overdue_at"),
    currentStageId: uuid("current_stage_id").references(() => pipelineStage.id, { onDelete: "set null" }),
    overdueTriggeredAt: timestamptz("overdue_triggered_at"),
    priority: actionItemPriorityEnum("priority").notNull().default("medium"),
    attachments: jsonb("attachments"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actionItemOwnerStatusIdx: index("action_item_owner_status_idx")
      .on(
        table.enterpriseId,
        table.ownerUserId,
        table.currentStageId
      ),

    actionItemStatusIdx: index("action_item_status_idx")
      .on(
        table.enterpriseId,
        table.currentStageId
      ),

    actionItemPriorityIdx: index("action_item_priority_idx")
      .on(
        table.enterpriseId,
        table.priority
      ),
  })
);

export const contactEmails = pgTable(
  "contact_emails",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    label: text("label"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    contactEmailsEnterpriseEmailIdx: index("contact_emails_enterprise_email_idx").on(
      t.enterpriseId,
      t.email
    ),
    contactEmailsContactIdx: index("contact_emails_contact_idx").on(t.contactId),
    contactEmailsEnterpriseEmailUq: uniqueIndex("contact_emails_enterprise_email_uq").on(
      t.enterpriseId,
      t.email
    ),
    contactEmailsPrimaryUq: uniqueIndex("contact_emails_primary_uq")
      .on(t.contactId)
      .where(sql`is_primary = true`),
  })
);

export const contactPhones = pgTable(
  "contact_phones",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    phoneNormalized: text("phone_normalized"),
    isPrimary: boolean("is_primary").notNull().default(false),
    label: text("label"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    contactPhonesEnterprisePhoneIdx: index("contact_phones_enterprise_phone_idx").on(
      t.enterpriseId,
      t.phoneNormalized
    ),
    contactPhonesContactIdx: index("contact_phones_contact_idx").on(t.contactId),
    contactPhonesEnterprisePhoneUq: uniqueIndex("contact_phones_enterprise_phone_uq").on(
      t.enterpriseId,
      t.phoneNormalized
    ),
    contactPhonesPrimaryUq: uniqueIndex("contact_phones_primary_uq")
      .on(t.contactId)
      .where(sql`is_primary = true`),
  })
);

export const fieldDefinitions = pgTable(
  "field_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    fieldKey: text("field_key").notNull(),
    fieldName: text("field_name").notNull(),
    fieldType: text("field_type").notNull(),
    enumOptions: jsonb("enum_options"),
    isRequired: boolean("is_required").notNull().default(false),
    displayOrder: integer("display_order"),
    isSystem: boolean("is_system").notNull().default(true),
    showInQuickAdd: boolean("show_in_quick_add").notNull().default(false),
    isImportant: boolean("is_important").notNull().default(false),
    color: jsonb("color"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    fieldDefinitionsEnterpriseEntityKeyIdx: index(
      "field_definitions_enterprise_entity_key_idx"
    ).on(table.enterpriseId, table.entityType, table.fieldKey),
  })
);

export const fieldValues = pgTable(
  "field_values",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    fieldDefinitionId: uuid("field_definition_id")
      .notNull()
      .references(() => fieldDefinitions.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    valueText: text("value_text"),
    valueNumber: text("value_number"),
    valueDate: timestamptz("value_date"),
    valueBool: boolean("value_bool"),
    valueJson: jsonb("value_json"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueConstraint: unique("field_values_enterprise_entity_field_unique").on(
      table.enterpriseId,
      table.entityType,
      table.entityId,
      table.fieldDefinitionId
    ),
    fieldValuesEntityIdx: index("field_values_entity_idx").on(
      table.entityType,
      table.entityId
    ),
    fieldValuesEntityFieldIdx: index("field_values_entity_field_idx").on(
      table.entityType,
      table.entityId,
      table.fieldDefinitionId
    ),
  })
);


// 1. ACCOUNTS
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    // Same system fields as companies
    name: text("name").notNull(),
    domain: text("domain"),
    accountType: text("account_type"),

    ownerUserId: uuid("owner_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    stageDefinitionId: uuid("stage_definition_id").references(
      () => stageDefinition.id,
      { onDelete: "set null" }
    ),

    healthScore: integer("health_score"),
    healthScoreComputedAt: timestamptz("health_score_computed_at"),
    healthScoreBreakdown: jsonb("health_score_breakdown"),
    ARR: integer("arr"),
    currency: text("currency"),

    externalId: text("external_id"),

    // Store arbitrary fields that don't deserve columns yet
    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    accountsEnterpriseIdx: index("accounts_enterprise_idx").on(t.enterpriseId),
    accountsCompanyIdx: index("accounts_company_idx").on(t.companyId),
    accountsOwnerIdx: index("accounts_owner_idx").on(t.ownerUserId),
    accountsDomainIdx: index("accounts_domain_idx").on(t.domain),
    accountsHealthScoreIdx: index("accounts_health_score_idx").on(t.healthScore),
    accountsExternalUq: uniqueIndex("accounts_external_uq").on(
      t.enterpriseId,
      t.externalId
    ),
    accountsStageIdx: index("accounts_stage_idx").on(
      t.enterpriseId,
      t.stageDefinitionId
    ),
  })
);

// 2. CONTACT_ACCOUNT (Contact ↔️ Account M2M)
export const contactAccount = pgTable(
  "contact_account",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    role: text("role"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    contactAccountUq: uniqueIndex("contact_account_uq").on(t.contactId, t.accountId),
    contactAccountEnterpriseIdx: index("contact_account_enterprise_idx").on(t.enterpriseId),
    contactAccountAccountIdx: index("contact_account_account_idx").on(t.accountId),
    contactAccountContactIdx: index("contact_account_contact_idx").on(t.contactId),
  })
);

// 3. INTERACTION_ACCOUNT (Interaction ↔️ Account M2M)
export const interactionAccount = pgTable(
  "interaction_account",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    interactionId: uuid("interaction_id")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    role: text("role"),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    interactionAccountUq: uniqueIndex("interaction_account_uq").on(
      t.interactionId,
      t.accountId
    ),
    interactionAccountEnterpriseIdx: index("interaction_account_enterprise_idx").on(t.enterpriseId),
    interactionAccountAccountIdx: index("interaction_account_account_idx").on(t.accountId),
    interactionAccountInteractionIdx: index("interaction_account_interaction_idx").on(t.interactionId),
  })
);

export const typeDefinitions = pgTable(
  "type_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .references(() => enterprise.id, { onDelete: "cascade" }),

    key: text("key").notNull(),                // 'sales' | 'cs' | 'onboarding'
    name: text("name").notNull(),              // 'Sales' | 'Customer Success'
    description: text("description"),
    color: text("color"),

    isSystem: boolean("is_system").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    typeDefsKeyUq: uniqueIndex("type_defs_key_uq").on(t.enterpriseId, t.key),
  })
);

export const keyRoleDefinitions = pgTable(
  "key_role_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .references(() => enterprise.id, { onDelete: "cascade" }),

    key: text("key").notNull(),                // 'csm' | 'ae' | 'tam'
    name: text("name").notNull(),              // 'Customer Success Manager'
    description: text("description"),

    // Uses same type as org units
    typeId: uuid("type_id")
      .notNull()
      .references(() => typeDefinitions.id, { onDelete: "restrict" }),

    applicableEntityTypes: jsonb("applicable_entity_types")
      .notNull()
      .default('["company", "account"]'),

    isSystem: boolean("is_system").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    keyRoleDefsKeyUq: uniqueIndex("key_role_defs_key_uq").on(t.enterpriseId, t.key),
    keyRoleDefsTypeIdx: index("key_role_defs_type_idx").on(t.typeId),
  })
);

export const keyRoleAssignments = pgTable(
  "key_role_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    keyRoleDefinitionId: uuid("key_role_definition_id")
      .notNull()
      .references(() => keyRoleDefinitions.id, { onDelete: "cascade" }),

    entityType: text("entity_type").notNull(),  // 'company' | 'account'
    entityId: uuid("entity_id").notNull(),

    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),

    startAt: timestamptz("start_at").notNull(),
    endAt: timestamptz("end_at"),
    reason: text("reason"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    keyRoleAssignCurrentIdx: index("key_role_assign_current_idx").on(
      t.entityType,
      t.entityId,
      t.keyRoleDefinitionId,
      t.endAt
    ),
    keyRoleAssignEntityIdx: index("key_role_assign_entity_idx").on(
      t.entityType,
      t.entityId
    ),
    keyRoleAssignUserIdx: index("key_role_assign_user_idx").on(t.userId),
    keyRoleAssignEnterpriseIdx: index("key_role_assign_enterprise_idx").on(t.enterpriseId),
  })
);

export const publicApiToken = pgTable(
  "public_api_token",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    /* ============================
     * Ownership (Multi-tenant)
     * ============================ */
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    createdByUserId: uuid("created_by_user_id")
      .references(() => appUser.id, { onDelete: "set null" }),

    /* ============================
     * Token material
     * ============================ */
    tokenHash: text("token_hash").notNull(),
    // SHA-256 hash of the token, NEVER store raw token

    name: text("name"),
    // "Aircall Prod Push", "Zapier", "Internal ETL"

    /* ============================
     * Authorization
     * ============================ */
    scopes: jsonb("scopes").notNull().default("[]"),
    // ["interactions:write", "calls:write"]

    rateLimitPerHour: integer("rate_limit_per_hour")
      .notNull()
      .default(1000),

    /* ============================
     * Lifecycle
     * ============================ */
    expiresAt: timestamptz("expires_at"),
    revokedAt: timestamptz("revoked_at"),
    lastUsedAt: timestamptz("last_used_at"),

    /* ============================
     * Metadata & bookkeeping
     * ============================ */
    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    publicApiTokenEnterpriseIdx: index(
      "public_api_token_enterprise_idx"
    ).on(t.enterpriseId),

    publicApiTokenHashUq: uniqueIndex(
      "public_api_token_hash_uq"
    ).on(t.tokenHash),

    publicApiTokenActiveIdx: index(
      "public_api_token_active_idx"
    ).on(t.enterpriseId, t.revokedAt),
  })
);

/* ============================
 * WORKFLOW ENUM-LIKE CONSTANTS
 * ============================ */

export const workflowScopeType = ["enterprise", "org_unit"] as const;
export const workflowVersionStatus = ["draft", "active", "archived"] as const;
export const workflowRunStatus = ["running", "completed", "failed", "cancelled"] as const;
export const workflowJobStatus = ["pending", "scheduled", "completed", "failed"] as const;

/* ============================
 * WORKFLOWS
 * ============================ */

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    enterpriseId: uuid("enterprise_id").references(() => enterprise.id, { onDelete: "cascade" }),

    scopeType: text("scope_type", { enum: workflowScopeType }).notNull(),
    orgUnitId: uuid("org_unit_id"),

    name: text("name").notNull(),
    description: text("description"),

    isActive: boolean("is_active").notNull().default(true),

    createdByUserId: uuid("created_by_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    enterpriseIdx: index("workflows_enterprise_idx").on(t.enterpriseId),
    scopeIdx: index("workflows_scope_idx").on(t.scopeType, t.orgUnitId),
  })
);

/* ============================
 * WORKFLOW VERSIONS
 * ============================ */

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),

    status: text("status", { enum: workflowVersionStatus }).notNull(),

    definition: jsonb("definition").notNull(),
    // { trigger: {...}, steps: [...] }

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workflowVersionUq: uniqueIndex("workflow_versions_uq").on(
      t.workflowId,
      t.version
    ),
    workflowIdx: index("workflow_versions_workflow_idx").on(t.workflowId),
  })
);

/* ============================
 * WORKFLOW TRIGGERS
 * ============================ */

export const workflowTriggers = pgTable(
  "workflow_triggers",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    enterpriseId: uuid("enterprise_id").references(() => enterprise.id, { onDelete: "cascade" }),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),

    entity: text("entity").notNull(),
    action: text("action").notNull(),

    conditions: jsonb("conditions"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    triggerLookupIdx: index("workflow_triggers_lookup_idx").on(
      t.enterpriseId,
      t.entity,
      t.action
    ),
    versionIdx: index("workflow_triggers_version_idx").on(
      t.workflowVersionId
    ),
  })
);

/* ============================
 * WORKFLOW RUNS
 * ============================ */

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    enterpriseId: uuid("enterprise_id").references(() => enterprise.id, { onDelete: "cascade" }),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),

    interactionId: uuid("interaction_id"),

    status: text("status", { enum: workflowRunStatus }).notNull(),

    context: jsonb("context").notNull(),

    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    runEnterpriseIdx: index("workflow_runs_enterprise_idx").on(t.enterpriseId),
    runVersionIdx: index("workflow_runs_version_idx").on(t.workflowVersionId),
  })
);

/* ============================
 * WORKFLOW JOBS (pg-boss)
 * ============================ */

export const workflowJobs = pgTable(
  "workflow_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    workflowRunId: uuid("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),

    stepId: text("step_id").notNull(),
    nodeKey: text("node_key").notNull(),

    pgBossJobId: text("pg_boss_job_id"),

    status: text("status", { enum: workflowJobStatus }).notNull(),

    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    attempts: integer("attempts").notNull().default(0),
    lastError: jsonb("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    runIdx: index("workflow_jobs_run_idx").on(t.workflowRunId),
    scheduleIdx: index("workflow_jobs_schedule_idx").on(
      t.status,
      t.scheduledFor
    ),
  })
);

/* ============================
 * NODE DEFINITIONS (REUSABLE)
 * ============================ */

export const nodeDefinitions = pgTable(
  "node_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    key: text("key").notNull(), // email.send, http.request
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),

    isSystem: boolean("is_system").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nodeKeyUq: uniqueIndex("node_definitions_key_uq").on(t.key),
  })
);

/* ============================
 * NODE DEFINITION FIELDS
 * ============================ */

export const nodeDefinitionFields = pgTable(
  "node_definition_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    nodeDefinitionId: uuid("node_definition_id")
      .notNull()
      .references(() => nodeDefinitions.id, { onDelete: "cascade" }),

    fieldKey: text("field_key").notNull(),
    fieldType: text("field_type").notNull(),
    isRequired: boolean("is_required").notNull().default(false),

    defaultValue: jsonb("default_value"),
    uiConfig: jsonb("ui_config"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    fieldUq: uniqueIndex("node_definition_fields_uq").on(
      t.nodeDefinitionId,
      t.fieldKey
    ),
  })
);

/* ============================
 * WORKFLOW ACTION LOGS
 * ============================ */

export const workflowActionLogs = pgTable(
  "workflow_action_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    enterpriseId: uuid("enterprise_id").notNull(),
    workflowJobId: uuid("workflow_job_id").notNull(),

    nodeKey: text("node_key").notNull(),
    integrationAccountId: uuid("integration_account_id"),

    requestJson: jsonb("request_json"),
    responseJson: jsonb("response_json"),

    status: text("status").notNull(), // success | failed
    externalObjectId: text("external_object_id"),
    errorJson: jsonb("error_json"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jobIdx: index("workflow_action_logs_job_idx").on(t.workflowJobId),
    enterpriseIdx: index("workflow_action_logs_enterprise_idx").on(
      t.enterpriseId,
      t.createdAt
    ),
  })
);

/**
 * ============================
 * ENUMS
 * ============================
 */

// risk/opportunity/info
export const companySignalTypeEnum = pgEnum("company_signal_type", [
  "risk",
  "opportunity",
  "info",
]);

// lifecycle
export const companySignalStatusEnum = pgEnum("company_signal_status", [
  "open",
  "in_progress",
  "resolved",
  "dismissed",
  "reopened",
]);

// generic severity across categories
export const companySignalSeverityEnum = pgEnum("company_signal_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

// occurrence source (default llm for now)
export const companySignalOccurrenceSourceEnum = pgEnum(
  "company_signal_occurrence_source",
  ["llm", "rule", "manual", "integration"],
);

// worsening-friendly denorms (optional per occurrence)
export const signalTimelineUrgencyEnum = pgEnum("signal_timeline_urgency", [
  "immediate",
  "short_term",
  "at_renewal",
  "unspecified",
]);

export const signalRecoverabilityEnum = pgEnum("signal_recoverability", [
  "likely_recoverable",
  "uncertain",
  "unlikely_recoverable",
]);

/**
 * ============================
 * TABLE: company_signal
 * Deduped “thing” you track (risk/opportunity/info) for a company or an account.
 *
 * IMPORTANT CONVENTION (since we removed scope):
 * - accountId IS NULL  => company-level signal
 * - accountId NOT NULL => account-level signal
 * ============================
 */
export const companySignal = pgTable(
  "company_signal",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),


    // Scope-by-nullability
    companyId: uuid("company_id").notNull().references(() => companies.id, {
      onDelete: "cascade",
    }), // references companies.id
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }), // nullable; references accounts.id

    // Classification
    type: companySignalTypeEnum("type").notNull(),
    categoryKey: text("category_key").notNull(), // e.g. 'churn', 'contraction_seats', 'expansion_rollout'

    // Display + ownership
    title: text("title").notNull(),
    status: companySignalStatusEnum("status").notNull().default("open"),
    severity: companySignalSeverityEnum("severity").notNull().default("medium"),

    // Accountability (default to company owner in code, but keep overridable)
    ownerUserId: uuid("owner_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }), // references app_user.id

    // Optional SLA
    dueAt: timestamptz("due_at"),

    // Identity for dedupe (MUST be deterministic)
    dedupeKey: text("dedupe_key").notNull(),

    // Lifecycle timestamps
    firstSeenAt: timestamptz("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamptz("last_seen_at").defaultNow().notNull(),

    inProgressAt: timestamptz("in_progress_at"),
    resolvedAt: timestamptz("resolved_at"),
    dismissedAt: timestamptz("dismissed_at"),
    reopenedAt: timestamptz("reopened_at"),

    // Extra
    metadata: jsonb("metadata").notNull().default({}),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Identity: 1 signal per enterprise per dedupeKey
    dedupeUnique: uniqueIndex("company_signal_enterprise_dedupe_uq").on(
      t.enterpriseId,
      t.dedupeKey,
    ),

    // Dashboard queues
    byCompanyStatusIdx: index("company_signal_by_company_status_idx").on(
      t.enterpriseId,
      t.companyId,
      t.status,
    ),
    byAccountStatusIdx: index("company_signal_by_account_status_idx").on(
      t.enterpriseId,
      t.accountId,
      t.status,
    ),

    // Owner worklist
    byOwnerStatusIdx: index("company_signal_by_owner_status_idx").on(
      t.enterpriseId,
      t.ownerUserId,
      t.status,
    ),

    // Recency sorting
    byLastSeenIdx: index("company_signal_by_last_seen_idx").on(
      t.enterpriseId,
      t.lastSeenAt,
    ),

    // Category/type filters
    byCategoryIdx: index("company_signal_by_category_idx").on(
      t.enterpriseId,
      t.categoryKey,
      t.status,
    ),
    byTypeIdx: index("company_signal_by_type_idx").on(
      t.enterpriseId,
      t.type,
      t.status,
    ),
    byCompanyCategoryStatusIdx: index("company_signal_by_company_category_status_idx").on(
      t.companyId,
      t.categoryKey,
      t.status,
    ),
  }),
);

/**
 * ============================
 * TABLE: company_signal_occurrence
 * One row per detection event (evidence history)
 * ============================
 */
export const companySignalOccurrence = pgTable(
  "company_signal_occurrence",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    signalId: uuid("signal_id")
      .notNull()
      .references(() => companySignal.id, { onDelete: "cascade" }),

    // Link-out
    interactionId: uuid("interaction_id").references(() => interactions.id, {
      onDelete: "set null",
    }), // references interactions.id
    metricDataId: uuid("metric_data_id").references(() => metricsData.id, {
      onDelete: "set null",
    }), // references metric_data.id
    // Link-out

    // Occurrence metadata
    detectedAt: timestamptz("detected_at").defaultNow().notNull(),
    source: companySignalOccurrenceSourceEnum("source").notNull(), // default 'llm' in code

    /**
     * Root-cause classification.
     * Examples:
     * - churn: ultimatum_with_deadline, budget_removed_or_blocked, competitor_switch_decision, ...
     * - contraction: seat_reduction, plan_downgrade, module_removal, ...
     * - expansion: addon_interest, new_team_rollout, procurement_started, ...
     */
    triggerType: text("trigger_type"), // keep free-text; category-specific values

    // Denorm for fast trend/worsening (optional but recommended)
    severity: companySignalSeverityEnum("severity"),
    timelineUrgency: signalTimelineUrgencyEnum("timeline_urgency"),
    recoverability: signalRecoverabilityEnum("recoverability"),

    // Full payload (store your LLM extractor output here)
    evidenceJson: jsonb("evidence_json").notNull().default({}),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // Fast: occurrences per signal (latest first via order in query)
    bySignalTimeIdx: index("company_signal_occ_by_signal_time_idx").on(
      t.signalId,
      t.detectedAt,
    ),

    // Fast: enterprise-wide feed / rollups
    byEnterpriseTimeIdx: index("company_signal_occ_by_enterprise_time_idx").on(
      t.enterpriseId,
      t.detectedAt,
    ),

    // Optional: reporting by trigger type
    byTriggerTypeIdx: index("company_signal_occ_by_trigger_type_idx").on(
      t.enterpriseId,
      t.triggerType,
    ),
  }),
);

/**
 * ============================
 * TABLE: company_signal_action_item
 * Join table: signals ↔ action_item
 * ============================
 */
export const companySignalActionItem = pgTable(
  "company_signal_action_item",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    signalId: uuid("signal_id")
      .notNull()
      .references(() => companySignal.id, { onDelete: "cascade" }),

    actionItemId: uuid("action_item_id")
      .notNull()
      .references(() => actionItem.id, { onDelete: "cascade" }),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => ({
    // Prevent duplicate links
    signalActionUnique: uniqueIndex("company_signal_action_item_uq").on(
      t.signalId,
      t.actionItemId,
    ),

    // Common lookups
    bySignalIdx: index("company_signal_action_item_by_signal_idx").on(t.signalId),
    byActionItemIdx: index("company_signal_action_item_by_action_item_idx").on(
      t.actionItemId,
    ),
  }),
);

// product can be core module, add-on, or just a tracked feature/metric SKU
export const billingProductKindEnum = pgEnum("billing_product_kind", [
  "core_product",
  "feature",
  "addon",
  "metric_only",
]);

export const billingProductStatusEnum = pgEnum("billing_product_status", [
  "active",
  "archived",
]);

export const billingPlanStatusEnum = pgEnum("billing_plan_status", [
  "active",
  "archived",
]);

export const subscriptionStatusEnum = pgEnum("billing_subscription_status", [
  "trialing",
  "active",
  "past_due",
  "paused",
  "cancelled",
  "ended",
]);

// whether subscription override merges with plan defaults or replaces them
export const entitlementOverrideModeEnum = pgEnum("entitlement_override_mode", [
  "merge",
  "replace",
]);

export const usageMetricTypeEnum = pgEnum("usage_metric_type", [
  "number",
  "json",
]);

/**
 * ============================
 * 1) PRODUCTS (enterprise-scoped product/feature catalog)
 * ============================
 * One row per enterprise per SKU you want to track (image/360/video or small features like pdf_export).
 */
export const billingProducts = pgTable(
  "billing_product",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // stable unique key per enterprise, e.g. "image", "p360", "video", "pdf_export"
    key: text("key").notNull(),

    name: text("name").notNull(),
    description: text("description"),

    kind: billingProductKindEnum("kind").notNull().default("core_product"),
    status: billingProductStatusEnum("status").notNull().default("active"),

    // set true if you might ever charge/entitle/limit it
    isBillableCandidate: boolean("is_billable_candidate")
      .notNull()
      .default(true),

    // Optional defaults for metric semantics, UI config, etc.
    // Example:
    // {
    //   "default_metrics": {
    //     "images_processed": {"unit":"count","type":"number"},
    //     "rejection_rate": {"unit":"percent","type":"number"}
    //   }
    // }
    config: jsonb("config").notNull().default({}),
    externalProductId: text("external_product_id"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    productEntIdx: index("billing_product_enterprise_idx").on(t.enterpriseId),
    productKeyUq: uniqueIndex("billing_product_enterprise_key_uq").on(
      t.enterpriseId,
      t.key
    ),
    productStatusIdx: index("billing_product_status_idx").on(
      t.enterpriseId,
      t.status
    ),
    productExternalUq: uniqueIndex("billing_product_external_uq").on(
      t.enterpriseId,
      t.externalProductId
    ).where(sql`external_product_id IS NOT NULL`),
  })
);

/**
 * ============================
 * 2) PLANS (commercial bundles)
 * ============================
 * Plan is *not* tied to a company/account. It’s a template: "bronze/silver/gold".
 * Multiple products can be included via billing_plan_product.
 */
export const billingPlans = pgTable(
  "billing_plan",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // stable unique key per enterprise, e.g. "bronze", "silver", "gold"
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    externalPlanId: text("external_plan_id"),

    status: billingPlanStatusEnum("status").notNull().default("active"),

    // Pricing metadata (MVP: store as metadata; later add price tables)
    // Example: { "currency": "INR", "interval": "month", "amount": 29900 }
    pricingJson: jsonb("pricing_json").notNull().default({}),

    // Plan-level default entitlements (fallback)
    // Suggested structure (simple + extensible):
    // {
    //   "defaults": {
    //     "images_processed": { "included_per_month": 5000 },
    //     "active_seats": { "included": 10 }
    //   }
    // }
    entitlementsJson: jsonb("entitlements_json").notNull().default({}),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    planEntIdx: index("billing_plan_enterprise_idx").on(t.enterpriseId),
    planKeyUq: uniqueIndex("billing_plan_enterprise_key_uq").on(
      t.enterpriseId,
      t.key
    ),
    planStatusIdx: index("billing_plan_status_idx").on(t.enterpriseId, t.status),
    planExternalUq: uniqueIndex("billing_plan_external_uq").on(
      t.enterpriseId,
      t.externalPlanId
    ).where(sql`external_plan_id IS NOT NULL`),
  })
);

/**
 * ============================
 * 3) PLAN ↔ PRODUCT mapping (many products per plan)
 * ============================
 * This is where you define which products are included and their per-product entitlements.
 */
export const billingPlanProducts = pgTable(
  "billing_plan_product",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    planId: uuid("plan_id")
      .notNull()
      .references(() => billingPlans.id, { onDelete: "cascade" }),

    productId: uuid("product_id")
      .notNull()
      .references(() => billingProducts.id, { onDelete: "cascade" }),

    // Optional: when the plan includes a product but it’s “optional” / UI toggle
    isIncludedByDefault: boolean("is_included_by_default")
      .notNull()
      .default(true),

    // Per-plan-per-product entitlements.
    // Example:
    // {
    //   "images_processed": { "included_per_month": 5000 },
    //   "videos_processed": { "included_per_month": 200 }
    // }
    productEntitlementsJson: jsonb("product_entitlements_json")
      .notNull()
      .default({}),

    // Optional ordering for UI (bronze plan: image first, then 360, etc.)
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    planProductUq: uniqueIndex("billing_plan_product_uq").on(
      t.enterpriseId,
      t.planId,
      t.productId
    ),
    planProductPlanIdx: index("billing_plan_product_plan_idx").on(
      t.enterpriseId,
      t.planId
    ),
    planProductProductIdx: index("billing_plan_product_product_idx").on(
      t.enterpriseId,
      t.productId
    ),
  })
);

export const billingIntervalEnum = pgEnum("billing_interval", [
  "month",
  "year",
  "one_time",
]);

/**
 * ============================
 * 4) SUBSCRIPTIONS
 * ============================
 * Scope = company + nullable account
 *
 * IMPORTANT semantics (MVP):
 * - Effective entitlements = (plan defaults) MERGED WITH (subscription overrides)
 * - Overrides ALWAYS MERGE. (No override mode column.)
 *
 * entitlementsOverrideJson suggested shape:
 * {
 *   "product:<productId>": {
 *     "images_processed": { "included_per_month": 8000 }
 *   },
 *   "global": {
 *     "active_seats": { "included": 25 }
 *   }
 * }
 */
export const billingSubscriptions = pgTable(
  "billing_subscription",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // Scope (match your existing companies/accounts)
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }), // FIXED FK: was companies.id

    planId: uuid("plan_id")
      .notNull()
      .references(() => billingPlans.id, { onDelete: "restrict" }),

    status: subscriptionStatusEnum("status").notNull().default("active"),

    // Contracted value for health/ARR visibility (store in minor units)
    currency: text("currency").notNull().default("INR"),
    billingInterval: billingIntervalEnum("billing_interval").notNull().default("month"),
    billingIntervalCount: integer("billing_interval_count").notNull().default(1),
    contractValueCents: bigint("contract_value_cents", { mode: "number" }),
    mrrCents: bigint("mrr_cents", { mode: "number" }),

    startAt: timestamptz("start_at").notNull().defaultNow(),
    currentPeriodStartAt: timestamptz("current_period_start_at"),
    currentPeriodEndAt: timestamptz("current_period_end_at"),

    cancelAt: timestamptz("cancel_at"),
    cancelledAt: timestamptz("cancelled_at"),
    endedAt: timestamptz("ended_at"),

    // Negotiated overrides on top of plan defaults (always MERGE)
    entitlementsOverrideJson: jsonb("entitlements_override_json")
      .notNull()
      .default({}),

    externalSubscriptionId: text("external_subscription_id"),

    metadata: jsonb("metadata").notNull().default({}),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    subScopeIdx: index("billing_subscription_scope_idx").on(
      t.enterpriseId,
      t.companyId,
      t.accountId,
      t.status
    ),
    // NEW: Support renewal job - find subs with periods ending soon
    subPeriodIdx: index("billing_subscription_period_idx").on(
      t.enterpriseId,
      t.companyId,
      t.currentPeriodEndAt
    ),
    subExternalUq: uniqueIndex("billing_subscription_external_uq").on(
      t.enterpriseId,
      t.externalSubscriptionId
    ).where(sql`external_subscription_id IS NOT NULL`),
  })
);



// Minimum check (company always required)
export const billingSubscriptionScopeCheckSql = sql`
  ALTER TABLE billing_subscription
  ADD CONSTRAINT billing_subscription_scope_check
  CHECK (company_id IS NOT NULL);
`;

/**
 * ============================
 * 5) USAGE (DAILY FACT)
 * ============================
 * One row per day per metric per product per scope.
 * This stays independent of plan membership (facts vs policy).
 */
export const usageDailyFact = pgTable(
  "usage_daily_fact",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // SCOPE mirrors subscription
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "set null" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }), // nullable

    productId: uuid("product_id")
      .notNull()
      .references(() => billingProducts.id, { onDelete: "cascade" }),

    date: timestamp("date", { mode: "date" }).notNull(),

    // Examples: "images_processed", "videos_processed", "active_users", "active_minutes"
    metricKey: text("metric_key").notNull(),
    metricType: usageMetricTypeEnum("metric_type").notNull().default("number"),

    valueNumber: integer("value_number"),
    valueJson: jsonb("value_json"),

    lastReportedAt: timestamptz("last_reported_at").defaultNow().notNull(),
    metadata: jsonb("metadata").notNull().default({}),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Idempotent daily upsert (accountId nullable is OK; multiple nulls are allowed => still fine for MVP;
    // if you need strict uniqueness with NULL semantics later, use a computed scope key)
    usageUq: uniqueIndex("usage_daily_fact_uq").on(
      t.enterpriseId,
      t.companyId,
      t.accountId,
      t.productId,
      t.date,
      t.metricKey
    ),

    usageLookupIdx: index("usage_daily_fact_lookup_idx").on(
      t.enterpriseId,
      t.companyId,
      t.accountId,
      t.productId,
      t.date
    ),

    usageMetricIdx: index("usage_daily_fact_metric_idx").on(
      t.enterpriseId,
      t.metricKey,
      t.date
    ),
  })
);

/**
 * ============================
 * NOTE (do not ignore)
 * ============================
 * You must enforce in code (or later via triggers) that:
 * - If accountId is set in billing_subscription / usage_daily_fact, that account belongs to companyId.
 * - Only one active-ish subscription per (enterpriseId, companyId, accountId) scope.
 */

export const signUpForm = pgTable("sign_up_form", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  company: text("company").notNull(),
  createdAt: timestamptz("created_at").defaultNow().notNull(),
});

export const stageScopeEnum = pgEnum("stage_scope", ["company", "account", "contact"]);

export const stageBucketEnum = pgEnum("stage_bucket", [
  "pre_sale",
  "onboarding",
  "live",
  "paused",
  "churned",
]);


export const stageDefinition = pgTable(
  "stage_definition",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .references(() => enterprise.id, { onDelete: "cascade" }),

    scope: stageScopeEnum("scope").notNull().default("company"),

    // stable key used in imports & workflows
    key: text("key").notNull(), // e.g. "co_pre_qualified"

    // display label
    name: text("name").notNull(), // e.g. "Qualified"

    // stable dashboard grouping
    bucket: stageBucketEnum("bucket").notNull(),

    sortOrder: integer("sort_order").notNull().default(0),

    isActive: boolean("is_active").notNull().default(true),
    isSystem: boolean("is_system").notNull().default(false),

    description: text("description"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    stageDefUq: uniqueIndex("stage_definition_uq").on(
      t.enterpriseId,
      t.scope,
      t.key
    ),
    stageDefListIdx: index("stage_definition_list_idx").on(
      t.enterpriseId,
      t.scope,
      t.bucket,
      t.isActive,
      t.sortOrder
    ),
  })
);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "pending",
  "resolved",
  "closed",
  "archived",
  "spam",
]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // 1–1 with interactions(kind='ticket')
    interactionId: uuid("interaction_id")
      .notNull()
      .references(() => interactions.id, { onDelete: "cascade" }),

    providerKey: text("provider_key")
      .notNull()
      .references(() => integrationProvider.key, { onDelete: "set null" }),

    integrationAccountId: uuid("integration_account_id").references(
      () => integrationAccount.id,
      { onDelete: "set null" }
    ),

    attachments: jsonb("attachments").default({}),

    // ONLY provider identifier
    externalTicketId: text("external_ticket_id").notNull(),

    subject: text("subject"),
    description: text("description"),

    status: ticketStatusEnum("status").notNull(),

    issueRaisedAt: timestamptz("issue_raised_at"),
    firstResponseAt: timestamptz("first_response_at"),
    issueResolvedAt: timestamptz("issue_resolved_at"),

    providerCreatedAt: timestamptz("provider_created_at"),
    providerUpdatedAt: timestamptz("provider_updated_at"),
    lastActivityAt: timestamptz("last_activity_at"),

    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // enforce 1–1 with interaction
    ticketInteractionUq: uniqueIndex("tickets_interaction_uq").on(
      t.interactionId
    ),

    // idempotent sync key — one ticket per enterprise + provider + external id
    ticketExternalUq: uniqueIndex("tickets_external_uq").on(
      t.enterpriseId,
      t.providerKey,
      t.externalTicketId
    ),

    ticketsEnterpriseIdx: index("tickets_enterprise_idx").on(
      t.enterpriseId
    ),

    ticketsLastActivityIdx: index("tickets_last_activity_idx").on(
      t.enterpriseId,
      t.lastActivityAt
    ),
  })
);

export const ticketStatusLogs = pgTable(
  "ticket_status_logs",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    fromStatus: ticketStatusEnum("from_status"),
    toStatus: ticketStatusEnum("to_status").notNull(),

    changedAt: timestamptz("changed_at").notNull(),

    metadata: jsonb("metadata").default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => ({
    statusLogTicketIdx: index("ticket_status_logs_ticket_idx").on(
      t.ticketId,
      t.changedAt
    ),
    statusLogEnterpriseIdx: index("ticket_status_logs_enterprise_idx").on(
      t.enterpriseId
    ),
  })
);

export const invoiceStatusEnum = pgEnum("billing_invoice_status", [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
]);

export const invoiceKindEnum = pgEnum("billing_invoice_kind", [
  "subscription", // recurring base fee
  "usage",        // usage charges (later)
  "adjustment",   // one-off / manual adjustment
]);

/**
 * ============================
 * TABLE: billing_invoice (HEADER ONLY)
 * ============================
 * MVP now: subscription + invoice header.
 * Future: supports usage invoices via kind='usage' + metadata usage_summary.
 */
export const billingInvoice = pgTable(
  "billing_invoice",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),

    // Link to subscription
    subscriptionId: uuid("subscription_id").references(
      () => billingSubscriptions.id,
      { onDelete: "set null" }
    ),

    // Classification
    kind: invoiceKindEnum("kind").notNull().default("subscription"),
    status: invoiceStatusEnum("status").notNull().default("open"),

    // Provider linkage
    providerKey: text("provider_key").notNull().default("manual"),
    externalInvoiceId: text("external_invoice_id"),
    invoiceNumber: text("invoice_number"),
    paymentMethod: text("payment_method"),

    // Money (store in minor units)
    currency: text("currency").notNull().default("INR"),
    amountDueCents: integer("amount_due_cents").notNull().default(0),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),

    // Timeline
    issuedAt: timestamptz("issued_at").notNull(),
    dueAt: timestamptz("due_at"),
    paidAt: timestamptz("paid_at"),

    // Coverage window
    periodStartAt: timestamptz("period_start_at"),
    periodEndAt: timestamptz("period_end_at"),

    // PDF support
    pdfUrl: text("pdf_url"),

    // Extensibility
    metadata: jsonb("metadata").notNull().default({}),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Common reads: per-customer invoice list
    scopeIssuedIdx: index("billing_invoice_scope_issued_idx").on(
      t.enterpriseId,
      t.companyId,
      t.accountId,
      t.issuedAt
    ),

    // Health score reads: last paid invoice
    scopePaidIdx: index("billing_invoice_scope_paid_idx").on(
      t.enterpriseId,
      t.companyId,
      t.accountId,
      t.paidAt
    ),

    // NEW: Support dunning job - find overdue invoices
    statusDueIdx: index("billing_invoice_status_due_idx").on(
      t.enterpriseId,
      t.status,
      t.dueAt
    ).where(sql`status = 'open' AND due_at IS NOT NULL`),

    // FIXED: Idempotent provider sync (multi-tenant safe + NULL handling)
    providerExternalUq: uniqueIndex("billing_invoice_provider_external_uq").on(
      t.enterpriseId,
      t.providerKey,
      t.externalInvoiceId
    ).where(sql`external_invoice_id IS NOT NULL`),

    // NEW: Prevent duplicate billing per subscription per period
    subscriptionPeriodUq: uniqueIndex("billing_invoice_subscription_period_uq").on(
      t.enterpriseId,
      t.subscriptionId,
      t.periodStartAt,
      t.periodEndAt
    ).where(sql`subscription_id IS NOT NULL AND status NOT IN ('void', 'uncollectible')`),

    // Invoice number uniqueness
    invoiceNumberUq: uniqueIndex("billing_invoice_number_uq").on(
      t.enterpriseId,
      t.invoiceNumber
    ),
  })
);

/**
 * NOTE:
 * - Keep invoiceNumber nullable for MVP. Once you generate numbers, enforce not-null in app + migration.
 * - Enforce in code that (accountId != null) implies it belongs to companyId.
 * - Enforce in code that periodStartAt < periodEndAt when provided.
 */
export const entityMetricHistory = pgTable(
  "entity_metric_history",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    /* ============================
     * MULTI-TENANT PARTITION KEY
     * ============================ */
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    /* ============================
     * ENTITY (Polymorphic)
     * ============================ */
    entityType: text("entity_type").notNull(),
    // 'company' | 'contact' | 'account' | 'org_unit' | ...

    entityId: uuid("entity_id").notNull(),

    /* ============================
     * METRIC
     * ============================ */
    metricKey: text("metric_key").notNull(),
    // 'health_score' | 'arr' | 'nps' | 'seat_count' | ...

    /* ============================
     * VALUE (Flexible)
     * ============================ */
    valueNumber: numeric("value_number"),
    valueText: text("value_text"),
    valueJson: jsonb("value_json"),

    /* ============================
     * TIME DIMENSION
     * ============================ */
    effectiveAt: timestamptz("effective_at")
      .notNull()
      .defaultNow(),
    // exact timestamp when value is valid

    date: timestamp("date", { mode: "date" }),
    // optional daily bucketing (for daily facts)

    /* ============================
     * CONTEXT / AUDIT
     * ============================ */
    source: text("source"),
    // 'system' | 'manual' | 'workflow' | 'import' | 'llm'

    reason: text("reason"),
    // 'renewal', 'plan_upgrade', 'risk_model_v2', etc.

    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => ({
    /* ============================
     * INDEXES
     * ============================ */

    // Fast "current value" lookup
    entityMetricLookupIdx: index(
      "entity_metric_lookup_idx"
    ).on(
      t.enterpriseId,
      t.entityType,
      t.entityId,
      t.metricKey,
      t.effectiveAt
    ),

    // Cross-entity analytics
    metricAnalyticsIdx: index(
      "entity_metric_analytics_idx"
    ).on(
      t.enterpriseId,
      t.metricKey,
      t.effectiveAt
    ),

    // Optional: enforce 1 snapshot/day
    uniqueDailySnapshot: uniqueIndex(
      "entity_metric_daily_unique"
    ).on(
      t.enterpriseId,
      t.entityType,
      t.entityId,
      t.metricKey,
      t.date
    ),
  })
);


export const phoneNumberTypeEnum = pgEnum("phone_number_type", [
  "local",
  "toll_free",
  "mobile",
  "did",
]);

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // The actual number
    number: text("number").notNull(), // E.164 format: +919876543210
    numberNormalized: text("number_normalized").notNull(), // stripped: 919876543210

    type: phoneNumberTypeEnum("type").notNull().default("local"),

    // Provider info
    providerKey: text("provider_key")
      .notNull()
      .default("frejun"), // 'frejun' | 'twilio' | 'aircall'

    integrationAccountId: uuid("integration_account_id")
      .references(() => integrationAccount.id, { onDelete: "set null" }),

    externalNumberId: text("external_number_id"), // provider's ID for this number

    // Assignment (nullable = pooled, not-null = dedicated)
    assignedToUserId: uuid("assigned_to_user_id")
      .references(() => appUser.id, { onDelete: "set null" }),

    assignedToOrgUnitId: uuid("assigned_to_org_unit_id")
      .references(() => orgUnit.id, { onDelete: "set null" }),

    // Capabilities
    canReceiveInbound: boolean("can_receive_inbound").notNull().default(true),
    canMakeOutbound: boolean("can_make_outbound").notNull().default(true),
    canReceiveSms: boolean("can_receive_sms").notNull().default(false),
    canSendSms: boolean("can_send_sms").notNull().default(false),

    // Status
    isActive: boolean("is_active").notNull().default(true),

    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    phoneNumberEnterpriseIdx: index("phone_number_enterprise_idx").on(
      t.enterpriseId,
      t.isActive
    ),
    phoneNumberNormalizedUq: uniqueIndex("phone_number_normalized_uq").on(
      t.numberNormalized
    ),
    phoneNumberUserIdx: index("phone_number_user_idx").on(
      t.assignedToUserId
    ),
    phoneNumberOrgUnitIdx: index("phone_number_org_unit_idx").on(
      t.assignedToOrgUnitId
    ),
    phoneNumberProviderIdx: index("phone_number_provider_idx").on(
      t.providerKey,
      t.externalNumberId
    ),
  })
);

// // Timestamps
// initiatedAt: timestamptz("initiated_at").defaultNow().notNull(),
// ringingAt: timestamptz("ringing_at"),
// answeredAt: timestamptz("answered_at"),
// endedAt: timestamptz("ended_at"),

// // Duration tracking (seconds)
// ringDurationSeconds: integer("ring_duration_seconds"),
// talkDurationSeconds: integer("talk_duration_seconds"),


export const emailSuppressionCategoryEnum = pgEnum("email_suppression_category", [
  "meeting_summary",
  // future:
  "product_updates",
  "marketing",
  "all", // optional global kill-switch
]);

export const emailSuppressionSourceEnum = pgEnum("email_suppression_source", [
  "user_link",
  "admin",
  "bounce",
  "complaint",
  "import",
]);

export const emailSuppression = pgTable(
  "email_suppression",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    // enterpriseId: uuid("enterprise_id")
    //   .notNull()
    //   .references(() => enterprise.id, { onDelete: "cascade" }),

    // store canonical email: lowercase + trimmed (enforce in app layer)
    email: text("email").notNull(),

    category: emailSuppressionCategoryEnum("category")
      .notNull()
      .default("meeting_summary"),

    source: emailSuppressionSourceEnum("source").notNull().default("user_link"),

    reason: text("reason"), // optional free text

    unsubscribedAt: timestamptz("unsubscribed_at").defaultNow().notNull(),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Fast lookup before sending
    lookupIdx: index("email_suppression_lookup_idx").on(
      // t.enterpriseId,
      t.email,
      t.category
    ),

    // Idempotency / prevent duplicates
    uq: uniqueIndex("email_suppression_uq").on(
      // t.enterpriseId,
      t.email,
      t.category
    ),
  })
);


export const actionItemsPipeline = pgTable("action_items_pipeline", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enterpriseId: uuid("enterprise_id").references(() => enterprise.id, { onDelete: "cascade" }),
  orgUnitId: uuid("org_unit_id").references(() => orgUnit.id, { onDelete: "set null" }),
  // ↑ new: so Sales and CS can have different pipelines

  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  createdByUserId: uuid("created_by_user_id").references(() => appUser.id, { onDelete: "set null" }),

  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});

export const pipelineStageBucketEnum = pgEnum("pipeline_stage_bucket", [
  "open", "in_progress", "blocked", "done", "archived",
]);

export const pipelineStage = pgTable("pipeline_stage", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enterpriseId: uuid("enterprise_id").notNull().references(() => enterprise.id, { onDelete: "cascade" }),
  pipelineId: uuid("pipeline_id").notNull().references(() => actionItemsPipeline.id, { onDelete: "cascade" }),

  name: text("name").notNull(),
  bucket: pipelineStageBucketEnum("bucket").notNull().default("open"),
  color: text("color"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  isTerminal: boolean("is_terminal").notNull().default(false),

  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (t) => ({
  pipelineStageOrderUq: uniqueIndex("pipeline_stage_order_uq").on(t.pipelineId, t.sortOrder),
}));

export const subtaskExecutionModeEnum = pgEnum("subtask_execution_mode", [
  "sequential",
  "parallel",
]);

export const pipelineSubtaskTemplate = pgTable("pipeline_subtask_template", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enterpriseId: uuid("enterprise_id").notNull().references(() => enterprise.id, { onDelete: "cascade" }),
  pipelineId: uuid("pipeline_id").notNull().references(() => actionItemsPipeline.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id").notNull().references(() => pipelineStage.id, { onDelete: "cascade" }),

  title: text("title").notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(false),
  executionMode: subtaskExecutionModeEnum("execution_mode").notNull().default("parallel"),
  sortOrder: integer("sort_order").notNull().default(0),
  // ↑ only meaningful when executionMode = sequential

  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (t) => ({
  subtaskTemplateStageIdx: index("pipeline_subtask_template_stage_idx").on(t.stageId),
}));

export const actionItemSubtask = pgTable("action_item_subtask", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enterpriseId: uuid("enterprise_id").notNull().references(() => enterprise.id, { onDelete: "cascade" }),
  actionItemId: uuid("action_item_id").notNull().references(() => actionItem.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id").notNull().references(() => pipelineStage.id, { onDelete: "cascade" }),
  // ↑ which stage this subtask belongs to

  templateSubtaskId: uuid("template_subtask_id").references(() => pipelineSubtaskTemplate.id, { onDelete: "set null" }),
  // ↑ null = user created ad hoc, non-null = seeded from template

  title: text("title").notNull(),
  description: text("description"),

  isRequired: boolean("is_required").notNull().default(false),
  executionMode: subtaskExecutionModeEnum("execution_mode").notNull().default("parallel"),
  sortOrder: integer("sort_order").notNull().default(0),

  isComplete: boolean("is_complete").notNull().default(false),
  completedAt: timestamptz("completed_at"),
  completedByUserId: uuid("completed_by_user_id").references(() => appUser.id, { onDelete: "set null" }),
  assignedToUserId: uuid("assigned_to_user_id").references(() => appUser.id, { onDelete: "set null" }),

  dueAt: timestamptz("due_at"),

  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
}, (t) => ({
  subtaskActionItemIdx: index("action_item_subtask_action_item_idx").on(t.actionItemId),
  subtaskStageIdx: index("action_item_subtask_stage_idx").on(t.actionItemId, t.stageId),
}));


export const actionItemEntityTypeEnum = pgEnum(
  "action_item_entity_type",
  [
    "company",
    "contact",
    "interaction",
    "account",   // optional future-proof
  ]
);

export const actionItemEntity = pgTable(
  "action_item_entity",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    actionItemId: uuid("action_item_id")
      .notNull()
      .references(() => actionItem.id, { onDelete: "cascade" }),

    entityType: actionItemEntityTypeEnum("entity_type").notNull(),

    entityId: uuid("entity_id").notNull(),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueMapping: uniqueIndex("action_item_entity_unique").on(
      t.actionItemId,
      t.entityType,
      t.entityId
    ),

    entityLookupIdx: index("action_item_entity_lookup_idx").on(
      t.enterpriseId,
      t.entityType,
      t.entityId
    ),

    actionItemIdx: index("action_item_entity_action_idx").on(t.actionItemId),
  })
);



export const ticketMessageTypeEnum = pgEnum("ticket_message_type", [
  "reply",        // public reply visible to customer
  "note",         // internal/private note
  "system",       // status change, assignment change, etc.
]);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    // Provider's message/note ID (for idempotent sync)
    externalMessageId: text("external_message_id").notNull(),

    // What kind of message
    messageType: ticketMessageTypeEnum("message_type").notNull().default("reply"),

    direction: messageDirectionEnum("direction").notNull(),
    aiAnalysisStatus: aiAnalysisStatusEnum("ai_analysis_status").notNull().default("pending"),
    
    // Who sent it
    fromUserId: uuid("from_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    fromContactId: uuid("from_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    fromParticipantId: uuid("from_participant_id").references(() => participants.id, {
      onDelete: "set null",
    }),

    fromEmail: text("from_email"),
    toEmails: jsonb("to_emails"),
    ccEmails: jsonb("cc_emails"),

    // Content
    subject: text("subject"),
    textBody: text("text_body"),
    htmlBody: text("html_body"),

    // Attachments (array of {url, name, size, mimeType})
    attachments: jsonb("attachments").default([]),

    // Provider timestamp
    sentAt: timestamptz("sent_at"),

    searchVector: tsvector("search_vector"),
    embedding: vector(1536)("embedding"),

    metadata: jsonb("metadata").notNull().default("{}"),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    // Idempotent sync
    ticketMsgExternalUq: uniqueIndex("ticket_messages_external_uq").on(
      t.ticketId,
      t.externalMessageId
    ),

    // List messages for a ticket chronologically
    ticketMsgTicketIdx: index("ticket_messages_ticket_idx").on(
      t.ticketId,
      t.sentAt
    ),

    // FTS
    ticketMsgSearchGin: index("ticket_messages_search_gin")
      .using("gin", t.searchVector),

    ticketMsgFromContactIdx: index("ticket_messages_from_contact_idx").on(
      t.fromContactId
    ),

    ticketMsgFromUserIdx: index("ticket_messages_from_user_idx").on(
      t.fromUserId
    ),
  })
);

export const filterView = pgTable(
  "filter_view",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    
    userId: uuid("user_id")
      .references(() => appUser.id, { onDelete: "cascade" }),

    entityType: text("entity_type").notNull(), // 'contacts' | 'deals' | 'companies' | 'accounts'

    name: text("name").notNull(), // e.g. "Default View", "Hot Leads", "New This Week"

    view: jsonb("view").notNull().default("{}"),

    isDefault: boolean("is_default").notNull().default(false),

    createdByUserId: uuid("created_by_user_id")
      .references(() => appUser.id, { onDelete: "set null" }),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    filterViewEnterpriseIdx: index("filter_view_enterprise_idx").on(
      table.enterpriseId
    ),
    filterViewEntityTypeIdx: index("filter_view_entity_type_idx").on(
      table.enterpriseId,
      table.entityType
    ),
  })
);

/***********************************
 * EXCHANGE RATES (USD-based)
 ***********************************/

export const exchangeRate = pgTable(
  "exchange_rate",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    fromCurrency: text("from_currency").notNull(), // ISO 4217 e.g. "USD"
    toCurrency: text("to_currency").notNull(), // ISO 4217 e.g. "INR"
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(), // 1 fromCurrency = ? toCurrency
    date: timestamp("date", { mode: "date" }).notNull(), // the date this rate applies to
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    currencyPairDateIdx: uniqueIndex("exchange_rate_pair_date_idx").on(
      table.fromCurrency,
      table.toCurrency,
      table.date
    ),
  })
);


export const noteEntityTypeEnum = pgEnum("note_entity_type", [
  "contact",
  "company",
  "account",
]);

export const entityActivityLogEntityTypeEnum = pgEnum(
  "entity_activity_log_entity_type",
  ["company", "contact", "account", "deal"],
);

export const entityActivityLogActionTypeEnum = pgEnum(
  "entity_activity_log_action_type",
  [
    "created",
    "updated",
    "deleted",
    "stage_changed",
    "owner_changed",
    "association_added",
    "association_removed",
    "note_created",
    "note_updated",
    "note_deleted",
  ],
);

export const entityNotes = pgTable(
  "entity_notes",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    entityType: noteEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    title: text("title"),
    content: text("content").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .references(() => appUser.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id")
      .references(() => appUser.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    entityLookupIdx: index("entity_notes_entity_lookup_idx").on(
      t.enterpriseId,
      t.entityType,
      t.entityId,
    ),
    createdByIdx: index("entity_notes_created_by_idx").on(t.createdByUserId),
    createdAtIdx: index("entity_notes_created_at_idx").on(
      t.enterpriseId,
      t.entityType,
      t.entityId,
      t.createdAt,
    ),
  })
);

export const entityActivityLogs = pgTable(
  "entity_activity_logs",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    entityType: entityActivityLogEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    actionType: entityActivityLogActionTypeEnum("action_type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    actorNameSnapshot: text("actor_name_snapshot"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => ({
    entityLookupIdx: index("entity_activity_logs_entity_lookup_idx").on(
      t.enterpriseId,
      t.entityType,
      t.entityId,
      t.createdAt,
    ),
    actionLookupIdx: index("entity_activity_logs_action_lookup_idx").on(
      t.enterpriseId,
      t.actionType,
      t.createdAt,
    ),
    actorLookupIdx: index("entity_activity_logs_actor_lookup_idx").on(
      t.actorUserId,
      t.createdAt,
    ),
  }),
);

/***********************************
 * ENUMS
 ***********************************/

export const metricTypeEnum = pgEnum("metric_type", [
  "aggregation",
  "derived",
  "ratio",
  "funnel",
]);

export const metricSourceEnum = pgEnum("metric_source", [
  "events",
]);

export const metricGrainV2Enum = pgEnum("metric_grain_v2", [
  "minute",
  "hour",
  "day",
]);

/***********************************
 * 1. METRIC DEFINITIONS (ENGINE BRAIN)
 ***********************************/

export const metricDefinitions = pgTable(
  "metric_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    type: metricTypeEnum("type").notNull(),
    source: metricSourceEnum("source").notNull().default("events"),

    // 🔥 CORE LOGIC
    definitionJson: jsonb("definition_json").notNull(),

    unit: text("unit"),
    higherIsBetter: boolean("higher_is_better").notNull().default(false),

    defaultGrain: text("default_grain"), // minute | hour | day

    isActive: boolean("is_active").notNull().default(true),
    version: integer("version").notNull().default(1),

    createdByUserId: uuid("created_by_user_id").references(
      () => appUser.id,
      { onDelete: "set null" }
    ),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    metricKeyUq: uniqueIndex("metric_definitions_key_uq").on(
      t.enterpriseId,
      t.key,
      t.version
    ),
    metricEnterpriseIdx: index("metric_definitions_enterprise_idx").on(
      t.enterpriseId
    ),
  })
);

/***********************************
 * 2. PRODUCT EVENTS (RAW LAYER)
 ***********************************/

export const productEvents = pgTable(
  "product_events",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    productId: uuid("product_id").references(() => billingProducts.id, {
      onDelete: "set null",
    }),

    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),

    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),

    userId: uuid("user_id").references(() => appUser.id, {
      onDelete: "set null",
    }),

    // EVENT
    eventName: text("event_name").notNull(),
    eventKey: text("event_key"), // request_id / job_id

    eventTimestamp: timestamptz("event_timestamp").notNull(),

    // VALUE
    valueNumber: numeric("value_number"),
    valueJson: jsonb("value_json"),

    // RAW PAYLOAD
    rawRequest: jsonb("raw_request"),
    rawResponse: jsonb("raw_response"),

    // FLEXIBLE DIMENSIONS
    dimensions: jsonb("dimensions").notNull().default({}),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
  },
  (t) => ({
    eventLookupIdx: index("product_events_lookup_idx").on(
      t.enterpriseId,
      t.eventName,
      t.eventTimestamp
    ),

    eventKeyIdx: index("product_events_event_key_idx").on(
      t.enterpriseId,
      t.eventKey
    ),

    eventCompanyIdx: index("product_events_company_idx").on(
      t.enterpriseId,
      t.companyId,
      t.eventTimestamp
    ),

    eventProductIdx: index("product_events_product_idx").on(
      t.enterpriseId,
      t.productId,
      t.eventTimestamp
    ),
  })
);

/***********************************
 * 3. METRIC COMPUTATIONS (GRANULAR)
 ***********************************/

export const metricComputations = pgTable(
  "metric_computations",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    metricId: uuid("metric_id")
      .notNull()
      .references(() => metricDefinitions.id, { onDelete: "cascade" }),

    // correlation key (request_id)
    eventKey: text("event_key"),

    productId: uuid("product_id").references(() => billingProducts.id, {
      onDelete: "set null",
    }),

    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),

    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),

    valueNumber: numeric("value_number"),
    valueJson: jsonb("value_json"),

    computedAt: timestamptz("computed_at").defaultNow().notNull(),

    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => ({
    metricCompMetricIdx: index("metric_computations_metric_idx").on(
      t.metricId,
      t.computedAt
    ),

    metricCompEntityIdx: index("metric_computations_entity_idx").on(
      t.enterpriseId,
      t.companyId,
      t.metricId,
      t.computedAt
    ),

    metricCompEventKeyIdx: index("metric_computations_event_key_idx").on(
      t.eventKey
    ),
  })
);

/***********************************
 * 4. METRIC AGGREGATES (DASHBOARD)
 ***********************************/

export const metricAggregates = pgTable(
  "metric_aggregates",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    metricId: uuid("metric_id")
      .notNull()
      .references(() => metricDefinitions.id, { onDelete: "cascade" }),

    productId: uuid("product_id").references(() => billingProducts.id, {
      onDelete: "set null",
    }),

    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),

    // TIME WINDOW
    windowStart: timestamptz("window_start").notNull(),
    windowEnd: timestamptz("window_end").notNull(),

    grain: metricGrainV2Enum("grain").notNull(),

    // AGG VALUES
    count: integer("count"),
    sum: numeric("sum"),
    avg: numeric("avg"),
    min: numeric("min"),
    max: numeric("max"),
    p95: numeric("p95"),

    valueJson: jsonb("value_json"),

    computedAt: timestamptz("computed_at").defaultNow().notNull(),
  },
  (t) => ({
    metricAggLookupIdx: index("metric_aggregates_lookup_idx").on(
      t.enterpriseId,
      t.metricId,
      t.windowStart,
      t.grain
    ),

    metricAggEntityIdx: index("metric_aggregates_entity_idx").on(
      t.enterpriseId,
      t.companyId,
      t.metricId,
      t.windowStart
    ),

    metricAggProductIdx: index("metric_aggregates_product_idx").on(
      t.enterpriseId,
      t.productId,
      t.metricId,
      t.windowStart
    ),
  })
);


export const subscriptionLineItems = pgTable("subscription_line_items", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),

  enterpriseId: uuid("enterprise_id")
    .notNull()
    .references(() => enterprise.id, { onDelete: "cascade" }),

  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => billingSubscriptions.id, { onDelete: "cascade" }),

  productId: uuid("product_id").notNull(),

  status: varchar("status", { length: 50 }).default("active"),

  arrCents: integer("arr_cents"),
  mrrCents: integer("mrr_cents"),

  quantity: integer("quantity").default(1),
  unitPriceCents: integer("unit_price_cents"),

  startAt: timestamptz("start_at").defaultNow(),
  endAt: timestamptz("end_at"),

  createdAt: timestamptz("created_at").defaultNow().notNull(),
  updatedAt: timestamptz("updated_at").defaultNow().notNull(),
});


export const stageFieldMapping = pgTable(
  "stage_field_mapping",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),

    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),

    stageDefinitionId: uuid("stage_definition_id")
      .notNull()
      .references(() => stageDefinition.id, { onDelete: "cascade" }),

    fieldDefinitionId: uuid("field_definition_id")
      .notNull()
      .references(() => fieldDefinitions.id, { onDelete: "cascade" }),

    isRequired: boolean("is_required").notNull().default(false),

    displayOrder: integer("display_order").default(0),

    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueConstraint: unique("unique_stage_field").on(
      table.stageDefinitionId,
      table.fieldDefinitionId
    ),
  })
);

export const entitySummaryCache = pgTable(
  "entity_summary_cache",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    enterpriseId: uuid("enterprise_id")
      .notNull()
      .references(() => enterprise.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    summary: text("summary").notNull(),
    dataHash: text("data_hash").notNull(),
    modelUsed: text("model_used"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    generatedAt: timestamptz("generated_at").defaultNow().notNull(),
    createdAt: timestamptz("created_at").defaultNow().notNull(),
    updatedAt: timestamptz("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    entitySummaryCacheUq: uniqueIndex(
      "entity_summary_cache_enterprise_entity_uq"
    ).on(table.enterpriseId, table.entityType, table.entityId),
    entitySummaryCacheGeneratedAtIdx: index(
      "entity_summary_cache_generated_at_idx"
    ).on(table.generatedAt),
  })
);