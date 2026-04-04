import type { AppLogger } from "./logger";

export class ErrorReporter {
  private readonly log;

  constructor(private readonly logger: AppLogger) {
    this.log = this.logger.child("error-reporter");
  }

  capture(error: unknown, context: Record<string, unknown>, traceId?: string) {
    const message = error instanceof Error ? error.message : "Unknown error";
    this.log.error(
      "Captured runtime error",
      {
        ...context,
        message,
        stack: error instanceof Error ? error.stack : undefined
      },
      traceId
    );
  }
}
