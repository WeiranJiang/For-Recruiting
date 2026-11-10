import "server-only";
import { ZodError } from "zod";

/** An error whose message is safe to show to the signed-in user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 400 with a user-facing message. */
export const userError = (message: string) => new HttpError(400, message);

/**
 * Message that is safe to return to the client. Only HttpError messages pass through;
 * everything else is replaced so internal details (SQL, stack traces, upstream responses) never leak.
 */
export function safeMessage(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof ZodError) return "Invalid request.";
  return "Something went wrong. Please try again.";
}

/**
 * Log without leaking secrets. googleapis/gaxios errors carry the full request config
 * (including the OAuth Authorization header), so never log the raw error object.
 */
export function logError(context: string, e: unknown) {
  const err = e as { name?: string; message?: string; status?: number; code?: string | number };
  const message = String(err?.message ?? e)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(sk-ant-[a-z0-9]+-)[A-Za-z0-9_-]+/gi, "$1[REDACTED]")
    .replace(/(api_key=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 500);
  console.error(`[${context}]`, err?.name ?? "Error", err?.status ?? err?.code ?? "", message);
}
