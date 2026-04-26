/**
 * Markets + Agents nav and server routes that are dev-first by default.
 * Set `NEXT_PUBLIC_SHOW_DEV_NAV=true` on preview / hackathon prod so judges
 * can open /agents and /markets without a local dev server.
 */
export function showDevNav(): boolean {
  if (process.env.NEXT_PUBLIC_SHOW_DEV_NAV === "true") return true;
  return process.env.NODE_ENV !== "production";
}
