/**
 * Anchor / web3 errors are often plain objects with `error` / `logs` / no
 * `.message`; `String(err)` becomes "[object Object]". Use this for logs.
 */
export function formatErrorForLog(err: unknown): string {
  if (err instanceof Error && err.message) {
    const base = err.stack ?? err.message;
    const logs = (err as { logs?: string[] }).logs;
    if (Array.isArray(logs) && logs.length > 0) {
      return `${base}\nlogs:\n${logs.slice(0, 40).join("\n")}`;
    }
    return base;
  }
  const any = err as Record<string, unknown> | null | undefined;
  if (any && typeof any.message === "string" && any.message.length > 0) {
    return any.message;
  }
  if (any && typeof any.toString === "function" && any.toString !== Object.prototype.toString) {
    const s = String(any.toString());
    if (s !== "[object Object]") return s;
  }
  try {
    return JSON.stringify(err, Object.getOwnPropertyNames(Object(err)));
  } catch {
    return String(err);
  }
}
