/**
 * Thin HTTP client for calling the arali-backend public API (`/api/v1/*`).
 *
 * We route all mutations (create/update) through the public API rather than
 * writing to the DB directly so that workflow triggers (published to pgboss
 * by `checkAndPublishWorkflowTriggers()` in arali-backend) fire consistently.
 *
 * The user's JWT is forwarded as a Bearer token. The backend accepts the same
 * JWT_SECRET that arali-main uses, and `hasScope()` in arali-backend passes
 * through when the `scopes` claim is absent (which is the case for JWTs from
 * the web-app login), so no separate API key / scope minting is needed.
 */

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface CallBackendOptions {
  method: HttpMethod;
  path: string; // e.g. "/api/v1/contacts"
  body?: unknown;
  jwt: string;
}

export interface BackendApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function callBackendApi<T = unknown>(
  opts: CallBackendOptions,
): Promise<BackendApiResponse<T>> {
  const baseUrl = (process.env.ARALI_BACKEND_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const url = `${baseUrl}${opts.path}`;

  if (!opts.jwt) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Missing JWT — request context did not preserve a Bearer token",
    };
  }

  try {
    const res = await fetch(url, {
      method: opts.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.jwt}`,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    let data: unknown = null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    } else {
      try {
        data = await res.text();
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      const errorMsg =
        (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : null) ?? `HTTP ${res.status} ${res.statusText}`;
      return {
        ok: false,
        status: res.status,
        data: data as T | null,
        error: errorMsg,
      };
    }

    return {
      ok: true,
      status: res.status,
      data: data as T,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      data: null,
      error: `Network error calling ${url}: ${message}`,
    };
  }
}
