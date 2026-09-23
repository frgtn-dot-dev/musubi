import { OutlookMoveOptionsSchema, OutlookMoveResultSchema, type OutlookMoveRequest } from "@musubi/types";
import { apiRequest } from "./http";
export const getOutlookMoveOptions = (eventID: string, signal?: AbortSignal) => apiRequest(`/api/v1/events/${eventID}/outlook-move/options?outlookOrganizer=10`, { signal, responseSchema: OutlookMoveOptionsSchema });
export const getLatestOutlookMove = (eventID: string, signal?: AbortSignal) => apiRequest(`/api/v1/events/${eventID}/outlook-move?outlookOrganizer=10`, { signal, responseSchema: OutlookMoveResultSchema.nullable() });
export const getOutlookMove = (operationID: string, signal?: AbortSignal) => apiRequest(`/api/v1/outlook-moves/${operationID}?outlookOrganizer=10`, { signal, responseSchema: OutlookMoveResultSchema });
export const previewOutlookMove = (request: OutlookMoveRequest) => apiRequest("/api/v1/outlook-moves/preview?outlookOrganizer=10", { method: "POST", body: request, responseSchema: OutlookMoveResultSchema });
export const startOutlookMove = (operationID: string) => apiRequest(`/api/v1/outlook-moves/${operationID}/start?outlookOrganizer=10`, { method: "POST", body: {}, responseSchema: OutlookMoveResultSchema });
