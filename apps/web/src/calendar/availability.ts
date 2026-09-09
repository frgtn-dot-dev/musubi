import { AvailabilitySourcesSchema, AvailabilityResponseSchema, type AvailabilityRequest } from "@musubi/types";
import { apiRequest } from "~/api/http";
export const getAvailabilitySources = (signal?: AbortSignal) => apiRequest("/api/v1/availability/sources", { signal, responseSchema: AvailabilitySourcesSchema });
export const selectAvailabilitySource = (id: string, enabled: boolean, expectedGeneration: number) => apiRequest(`/api/v1/availability/sources/${encodeURIComponent(id)}`, { method: "PUT", body: { enabled, expectedGeneration }, responseSchema: AvailabilitySourcesSchema });
export const getAvailability = (body: AvailabilityRequest, signal?: AbortSignal) => apiRequest("/api/v1/availability", { method: "POST", body, signal, timeoutMs: 30000, responseSchema: AvailabilityResponseSchema });
