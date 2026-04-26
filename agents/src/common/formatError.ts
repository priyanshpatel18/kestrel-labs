/**
 * Short, log-safe error text: message only (no Anchor simulation logs, stacks,
 * or JSON blobs that can echo RPC URLs).
 */
export function formatErrorForLog(err: unknown): string {
  const cap = 800;
  let out: string;
  if (err instanceof Error && err.message) {
    out = err.message;
  } else {
    const any = err as Record<string, unknown> | null | undefined;
    if (any && typeof any.message === "string" && any.message.length > 0) {
      out = any.message;
    } else if (
      any &&
      typeof any.toString === "function" &&
      any.toString !== Object.prototype.toString
    ) {
      const s = String(any.toString());
      out = s !== "[object Object]" ? s : "unknown error";
    } else {
      try {
        out = JSON.stringify(err, Object.getOwnPropertyNames(Object(err)));
      } catch {
        out = String(err);
      }
    }
  }
  return out.length > cap ? `${out.slice(0, cap)}…` : out;
}
