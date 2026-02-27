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
          "Request timed out. Make sure the OCR server is running (npm run ocr) and your device is on the same Wi‑Fi as your computer. If your computer's IP changed, update OCR_SERVER_URL in app/config.ts."
        );
      }
      if (/network|timed out|timeout|failed to fetch/i.test(e.message)) {
        throw new Error(
          "Cannot reach server. Check that the OCR server is running and your device is on the same Wi‑Fi. Update OCR_SERVER_URL in app/config.ts if your computer's IP changed."
        );
      }
    }
    throw e;
  }
}
