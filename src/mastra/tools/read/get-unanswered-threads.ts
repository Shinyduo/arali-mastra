import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { db } from "../../../db/index.js";
import { sql } from "drizzle-orm";
import { extractContext, getCompanyScope, buildKeyRoleScopeClause, fuzzyNameMatch } from "../../../lib/rbac.js";

export const getUnansweredThreads = createTool({
  id: "get-unanswered-threads",
  description:
    "Find threads awaiting a reply — either from a rep or from a customer. " +
    "Use awaitingReplyFrom='rep' (default) to find customer messages your team hasn't responded to. " +
    "Use awaitingReplyFrom='customer' to find threads where the rep sent the last message and the customer hasn't replied. " +
    "Use for 'unanswered customer emails', 'emails with no response in 48 hours', " +
    "'which customers are waiting for a reply?', 'dropped conversations', " +
    "'messages we haven't responded to', 'pending customer replies', " +
    "'customers who haven't replied', or 'follow-ups with no customer response'.",
  inputSchema: z.object({
    awaitingReplyFrom: z
      .enum(["rep", "customer"])
      .optional()
      .default("rep")
      .describe(
        "'rep' = last message is from a customer (inbound) and no rep has replied — use for dropped conversations. " +
        "'customer' = last message is from a rep (outbound) and the customer hasn't replied — use for pending follow-ups."
      ),
    minHoursUnanswered: z
      .number()
      .min(1)
      .optional()
      .default(48)
      .describe("Minimum hours since the last message with no reply from the other side (default 48)"),
    channel: z
      .enum(["email", "message", "whatsapp", "other"])
      .optional()
      .describe("Filter by channel type"),
    companyName: z
      .string()
      .optional()
      .describe("Filter by company name (partial match)"),
    ownerEmail: z
      .string()
      .email()
      .optional()
      .describe("Filter by assigned user's email (via key role assignments on the company)"),
    limit: z.number().int().min(1).max(50).optional().default(20),
  }),
  execute: async (input, context) => {
    const { enterpriseId, userId, capabilities } = extractContext(
      context.requestContext!,
    );

    const limit = input.limit ?? 20;
    const hours = input.minHoursUnanswered ?? 48;
    const awaitingFrom = input.awaitingReplyFrom ?? "rep";
    const scope = getCompanyScope(capabilities);

    // rep = last message is inbound (customer sent, rep hasn't replied)
    // customer = last message is outbound (rep sent, customer hasn't replied)
    const lastMessageDirection = awaitingFrom === "rep" ? "inbound" : "outbound";

    const rows = await db.execute(sql`
      WITH last_messages AS (
        SELECT DISTINCT ON (tm.thread_id)
          tm.thread_id,
          tm.direction,
          tm.sent_at,
          tm.from_email,
          tm.subject AS message_subject,
          tm.text_body
        FROM thread_messages tm
        WHERE tm.enterprise_id = ${enterpriseId}
        ORDER BY tm.thread_id, tm.sent_at DESC
      )
      SELECT
        th.subject AS thread_subject,
        th.channel,
        th.status AS thread_status,
        lm.direction AS last_direction,
        lm.from_email,
        lm.sent_at AS last_message_at,
        lm.message_subject,
        LEFT(lm.text_body, 200) AS snippet,
        EXTRACT(EPOCH FROM NOW() - lm.sent_at) / 3600 AS hours_waiting,
        c.name AS company_name
      FROM last_messages lm
      JOIN threads th ON th.id = lm.thread_id
      LEFT JOIN interaction_company ic ON ic.interaction_id = th.interaction_id AND ic.enterprise_id = ${enterpriseId}
      LEFT JOIN companies c ON c.id = ic.company_id
      WHERE lm.direction = ${lastMessageDirection}
        AND lm.sent_at < NOW() - INTERVAL '${sql.raw(String(Math.floor(hours)))} hours'
        AND th.enterprise_id = ${enterpriseId}
        AND th.status NOT IN ('closed', 'spam', 'archived')
        ${input.channel ? sql`AND th.channel = ${input.channel}` : sql``}
        ${input.companyName ? sql`AND ${fuzzyNameMatch(sql`c.name`, input.companyName!)}` : sql``}
        ${input.ownerEmail ? sql`AND EXISTS (
          SELECT 1 FROM key_role_assignments kra
          JOIN app_user au ON au.id = kra.user_id
          WHERE kra.entity_type = 'company'
            AND kra.entity_id = c.id
            AND kra.end_at IS NULL
            AND au.email = ${input.ownerEmail}
        )` : sql``}
        ${
          !scope?.enterprise
            ? sql`AND (
                c.id IS NULL OR
                ${buildKeyRoleScopeClause(scope, userId, "company", sql`c.id` as any) ?? sql`TRUE`}
              )`
            : sql``
        }
      ORDER BY lm.sent_at ASC
      LIMIT ${limit}
    `);

    const label = awaitingFrom === "rep" ? "Awaiting rep reply" : "Awaiting customer reply";

    return {
      awaitingReplyFrom: awaitingFrom,
      description: label,
      threads: (rows as any[]).map((r: any) => ({
        subject: r.thread_subject ?? r.message_subject ?? "—",
        channel: r.channel,
        status: r.thread_status,
        lastMessageFrom: r.last_direction === "inbound" ? "customer" : "rep",
        from: r.from_email ?? "Unknown",
        company: r.company_name ?? "—",
        lastMessageAt: r.last_message_at
          ? new Date(r.last_message_at).toISOString().slice(0, 16).replace("T", " ")
          : "—",
        hoursWaiting: r.hours_waiting != null ? Math.round(Number(r.hours_waiting)) : null,
        snippet: r.snippet ? (r.snippet + (r.snippet.length >= 200 ? "…" : "")) : "—",
      })),
    };
  },
});
