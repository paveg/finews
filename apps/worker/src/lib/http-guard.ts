/**
 * Guards against unbounded response body consumption.
 * Checks Content-Length header and rejects oversized responses.
 */
export function isResponseTooLarge(
  headers: Headers,
  maxBytes: number,
): boolean {
  const cl = headers.get('content-length');
  if (cl === null) return false; // unknown size — caller decides
  const len = Number(cl);
  if (Number.isNaN(len)) return false;
  return len > maxBytes;
}

/** 5 MB — upper bound for RSS/Atom feeds */
export const MAX_RSS_BYTES = 5 * 1024 * 1024;

/** 1 MB — upper bound for market-data CSV / JSON */
export const MAX_MARKET_BYTES = 1024 * 1024;
