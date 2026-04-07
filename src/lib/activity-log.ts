import { db } from "../db/index.js";
import { entityActivityLogs, appUser } from "../db/schema.js";
import { eq } from "drizzle-orm";

type EntityType = "company" | "contact" | "account" | "deal";
type ActionType =
  | "created"
  | "updated"
  | "deleted"
  | "stage_changed"
  | "owner_changed"
  | "association_added"
  | "association_removed"
  | "note_created"
  | "note_updated"
  | "note_deleted";

type LogParams = {
  enterpriseId: string;
  entityType: EntityType;
  entityId: string;
  actionType: ActionType;
  actorUserId?: string | null;
  metadata?: {
    from_label?: string;
    to_label?: string;
    field_labels?: string[];
    changed_fields?: string[];
    entity_label?: string;
    source?: string;
    [key: string]: unknown;
  };
};

function buildTitleAndDescription(
  entityType: EntityType,
  actionType: ActionType,
  metadata: LogParams["metadata"] = {},
) {
  const entityLabel =
    metadata.entity_label ??
    entityType.charAt(0).toUpperCase() + entityType.slice(1);

  switch (actionType) {
    case "stage_changed":
      return {
        title: "Stage changed",
        description:
          metadata.from_label || metadata.to_label
            ? `${entityLabel} stage changed from ${metadata.from_label ?? "Unassigned"} to ${metadata.to_label ?? "Unassigned"}.`
            : `${entityLabel} stage was changed.`,
      };
    case "owner_changed":
      return {
        title: "Owner changed",
        description:
          metadata.from_label || metadata.to_label
            ? `${entityLabel} owner changed from ${metadata.from_label ?? "Unassigned"} to ${metadata.to_label ?? "Unassigned"}.`
            : `${entityLabel} owner was changed.`,
      };
    case "updated": {
      const fields = metadata.field_labels ?? metadata.changed_fields ?? [];
      return {
        title: `${entityLabel} updated`,
        description:
          fields.length > 0
            ? `${entityLabel} updated: ${fields.join(", ")}.`
            : `${entityLabel} details were updated.`,
      };
    }
    case "note_created":
      return {
        title: "Note added",
        description: `A note was added to this ${entityLabel.toLowerCase()}.`,
      };
    case "note_updated":
      return {
        title: "Note updated",
        description: `A note was updated on this ${entityLabel.toLowerCase()}.`,
      };
    case "note_deleted":
      return {
        title: "Note deleted",
        description: `A note was deleted from this ${entityLabel.toLowerCase()}.`,
      };
    default:
      return {
        title: `${entityLabel} ${actionType.replace(/_/g, " ")}`,
        description: `${entityLabel} activity recorded.`,
      };
  }
}

export async function logActivity(params: LogParams): Promise<void> {
  try {
    const {
      enterpriseId,
      entityType,
      entityId,
      actionType,
      actorUserId,
      metadata = {},
    } = params;

    let actorNameSnapshot: string | null = null;
    if (actorUserId) {
      const [user] = await db
        .select({ name: appUser.name, email: appUser.email })
        .from(appUser)
        .where(eq(appUser.id, actorUserId))
        .limit(1);
      actorNameSnapshot = user?.name ?? user?.email ?? null;
    }

    const { title, description } = buildTitleAndDescription(
      entityType,
      actionType,
      metadata,
    );

    await db.insert(entityActivityLogs).values({
      enterpriseId,
      entityType,
      entityId,
      actionType,
      title,
      description,
      actorUserId: actorUserId ?? null,
      actorNameSnapshot,
      metadata,
    });
  } catch (err) {
    console.warn("[activity-log] Failed to log entity activity:", err);
  }
}
