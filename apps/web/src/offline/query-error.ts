import { ApiError } from "~/api/http";

/** A failed refresh must not hide a previously validated offline snapshot.
 * HTTP refusals and invalid payload/time models still invalidate the view. */
export function canKeepOfflineQueryData(
  query: { data: unknown; error: unknown },
  offline: boolean,
) {
  if (!offline || query.data === undefined) return false;
  const error = query.error;
  return error instanceof TypeError ||
    (error instanceof DOMException &&
      ["AbortError", "NetworkError", "TimeoutError"].includes(error.name)) ||
    (error instanceof ApiError && error.status === 0);
}
