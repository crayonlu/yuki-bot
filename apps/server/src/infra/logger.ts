import { randomUUID } from "node:crypto";
import type { LogLevel } from "@bot/shared";
import { BotDatabase } from "./db/sqlite";

type LogInput = {
  level: LogLevel;
  source: string;
  message: string;
  traceId?: string;
  data?: Record<string, unknown>;
};

export class AppLogger {
  constructor(private readonly db: BotDatabase) {}

  child(source: string) {
    return {
      debug: (message: string, data?: Record<string, unknown>, traceId?: string) =>
        this.log({ level: "debug", source, message, data, traceId }),
      info: (message: string, data?: Record<string, unknown>, traceId?: string) =>
        this.log({ level: "info", source, message, data, traceId }),
      warn: (message: string, data?: Record<string, unknown>, traceId?: string) =>
        this.log({ level: "warn", source, message, data, traceId }),
      error: (message: string, data?: Record<string, unknown>, traceId?: string) =>
        this.log({ level: "error", source, message, data, traceId })
    };
  }

  log(input: LogInput) {
    const traceId = input.traceId ?? randomUUID();
    const payload = {
      ts: Date.now(),
      level: input.level,
      source: input.source,
      traceId,
      message: input.message,
      data: input.data
    };
    console.log(JSON.stringify(payload));
    this.db.insertLog(
      input.level,
      input.source,
      traceId,
      input.message,
      input.data ? JSON.stringify(input.data) : undefined
    );
    return traceId;
  }
}
