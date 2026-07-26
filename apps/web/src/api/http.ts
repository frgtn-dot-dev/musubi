import { z } from "zod";
import { notifyAuthExpired } from "~/auth/auth-client";

const ApiErrorEnvelopeSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  requestId: z.string().optional(),
});

type RequestOptions<T> = {
  body?: unknown;
  headers?: HeadersInit;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  responseSchema: z.ZodType<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class ApiError extends Error {
  readonly requestId?: string;
  readonly status: number;

  constructor(message: string, status: number, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.requestId = requestId;
    this.status = status;
  }
}

export class ApiResponseError extends Error {
  readonly requestId?: string;

  constructor(requestId?: string) {
    super("The server returned data the web app could not read.");
    this.name = "ApiResponseError";
    this.requestId = requestId;
  }
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now().toString(36)}`;
}

function responseRequestId(response: Response, body: unknown) {
  const parsed = ApiErrorEnvelopeSchema.safeParse(body);
  return parsed.success
    ? parsed.data.requestId ?? response.headers.get("x-request-id") ?? undefined
    : response.headers.get("x-request-id") ?? undefined;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function apiRequest<T>(
  path: `/api/${string}`,
  {
    body,
    headers,
    method = "GET",
    responseSchema,
    signal,
    timeoutMs = 10_000,
  }: RequestOptions<T>,
): Promise<T> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("accept", "application/json");
  requestHeaders.set("x-request-id", requestId());

  if (body !== undefined) {
    requestHeaders.set("content-type", "application/json");
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
    headers: requestHeaders,
    method,
    signal: combinedSignal,
  });
  const payload = await parseJson(response);
  const correlationId = responseRequestId(response, payload);

  if (!response.ok) {
    const envelope = ApiErrorEnvelopeSchema.safeParse(payload);
    const message = envelope.success
      ? envelope.data.message ?? envelope.data.error
      : response.statusText || "The Musubi server rejected the request.";

    if (response.status === 401) {
      notifyAuthExpired();
    }

    throw new ApiError(message, response.status, correlationId);
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiResponseError(correlationId);
  }

  return parsed.data;
}
