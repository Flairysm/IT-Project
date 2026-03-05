/**
 * Fetch with a timeout. Use for OCR server calls so we don't hang forever.
 * On timeout or network error, throws with a message that hints at server/network setup.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 30000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    if (e instanceof Error) {
      if (e.name === "AbortError") {
        throw new Error(
          "Request timed out. On mobile data or hotspot the server may take a moment to wake up—try again. Check your connection if it keeps failing."
        );
      }
      if (/network|timed out|timeout|failed to fetch/i.test(e.message)) {
        throw new Error(
          "Cannot reach the server. Check your internet connection and try again. On mobile data or hotspot, the first request can take longer."
        );
      }
    }
    throw e;
  }
}
