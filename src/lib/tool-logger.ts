import { db } from "../db/index.js";
import { toolInvocations } from "../db/schema.js";

export type ToolSource = "mcp" | "chat";

export async function logToolInvocation(params: {
  enterpriseId: string;
  userId: string;
  source: ToolSource;
  sessionId?: string | null;
  toolId: string;
  input: unknown;
  status: "success" | "error";
  durationMs: number;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await db.insert(toolInvocations).values({
      enterpriseId: params.enterpriseId,
      userId: params.userId,
      source: params.source,
      sessionId: params.sessionId ?? null,
      toolId: params.toolId,
      input: params.input as Record<string, unknown>,
      status: params.status,
      errorMessage: params.errorMessage ?? null,
      durationMs: params.durationMs,
    });
  } catch {
    // Never let logging failures break tool execution
  }
}
