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

type RawJsonRequestOptions<T> = {
  body: string;
  contentType: string;
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

function throwApiError(response: Response, payload: unknown): never {
  const correlationId = responseRequestId(response, payload);
  const envelope = ApiErrorEnvelopeSchema.safeParse(payload);
  // Never `response.statusText`: it put "Internal Server Error" into sentences
  // people read ("Musubi could not delete this event. Internal Server Error"),
  // which names the HTTP layer and says nothing about what to do. The request id
  // travels with the error for whoever reads the logs.
  const message = envelope.success
    ? envelope.data.message ?? envelope.data.error
    : "The server did not say why.";

  if (response.status === 401) {
    notifyAuthExpired();
  }

  throw new ApiError(message, response.status, correlationId);
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
    throwApiError(response, payload);
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiResponseError(correlationId);
  }

  return parsed.data;
}

export async function apiRawJsonRequest<T>(
  path: `/api/${string}`,
  {
    body,
    contentType,
    responseSchema,
    signal,
    timeoutMs = 30_000,
  }: RawJsonRequestOptions<T>,
): Promise<T> {
  const headers = new Headers({
    accept: "application/json",
    "content-type": contentType,
    "x-request-id": requestId(),
  });
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(path, {
    body,
    credentials: "include",
    headers,
    method: "POST",
    signal: signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal,
  });
  const payload = await parseJson(response);

  if (!response.ok) {
    throwApiError(response, payload);
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiResponseError(responseRequestId(response, payload));
  }

  return parsed.data;
}

export async function apiTextRequest(
  path: `/api/${string}`,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      accept: "text/calendar",
      "x-request-id": requestId(),
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const payload = await parseJson(response);
    throwApiError(response, payload);
  }

  return response.text();
}
