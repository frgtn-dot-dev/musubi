import { OutlookMoveOptionsSchema, OutlookMoveResultSchema, type OutlookMoveRequest } from "@musubi/types";
import { apiRequest } from "./http";
export const getOutlookMoveOptions = (eventID: string, signal?: AbortSignal) => apiRequest(`/api/v1/events/${eventID}/outlook-move/options`, { signal, responseSchema: OutlookMoveOptionsSchema });
export const getLatestOutlookMove = (eventID: string, signal?: AbortSignal) => apiRequest(`/api/v1/events/${eventID}/outlook-move`, { signal, responseSchema: OutlookMoveResultSchema.nullable() });
export const getOutlookMove = (operationID: string, signal?: AbortSignal) => apiRequest(`/api/v1/outlook-moves/${operationID}`, { signal, responseSchema: OutlookMoveResultSchema });
export const previewOutlookMove = (request: OutlookMoveRequest) => apiRequest("/api/v1/outlook-moves/preview", { method: "POST", body: request, responseSchema: OutlookMoveResultSchema });
export const startOutlookMove = (operationID: string) => apiRequest(`/api/v1/outlook-moves/${operationID}/start`, { method: "POST", body: {}, responseSchema: OutlookMoveResultSchema });
