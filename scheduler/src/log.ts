import pino, { Logger } from "pino";

export type SchedulerLogger = Logger;

let cached: Logger | null = null;

export function getLogger(): SchedulerLogger {
  if (cached) return cached;

  const level = process.env.KESTREL_LOG_LEVEL || "info";
  const format = (process.env.KESTREL_LOG_FORMAT || "pretty").toLowerCase();

  if (format === "json") {
    cached = pino({ level });
  } else {
    cached = pino({
      level,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      },
    });
  }
  return cached;
}

export function marketLogger(base: SchedulerLogger, marketId: number): SchedulerLogger {
  return base.child({ market_id: marketId });
}
