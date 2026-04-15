/**
 * Wraps a tool so internal errors (SQL/stack/etc.) never leak to the LLM
 * response. Errors are logged server-side; the LLM gets a clean error object.
 *
 * Apply at the tool-registration layer (tools/read/index.ts, tools/write/index.ts)
 * so individual tool implementations stay focused on happy-path logic.
 */
export function safeWrap<T extends { id: string; execute?: any }>(tool: T): T {
  const original = tool.execute;
  if (typeof original !== "function") return tool;

  const wrapped = {
    ...tool,
    execute: async (...args: unknown[]) => {
      try {
        return await original(...args);
      } catch (err: any) {
        console.error(
          `[tool:${tool.id}] failed:`,
          err?.message ?? err,
          err?.stack ?? "",
        );
        return {
          error:
            "This tool failed to run. Server logs have the details — retry or try a different query.",
          toolId: tool.id,
        };
      }
    },
  } as T;

  return wrapped;
}
