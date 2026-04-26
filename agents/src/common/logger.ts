import pino from "pino";

export type Logger = pino.Logger;

/** One pino logger per role process; pretty-printed in dev. */
export function buildLogger(role: string): Logger {
  return pino({
    name: `kestrel-agent:${role}`,
    transport: process.env.NODE_ENV === "production"
      ? undefined
      : {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            singleLine: false,
          },
        },
    base: { role },
    level: process.env.AGENTS_LOG_LEVEL || "info",
  });
}
