// Use cloud URL when set (e.g. EXPO_PUBLIC_OCR_URL=https://ezsplit-ocr.onrender.com); else local/dev.
export const OCR_SERVER_URL =
  (typeof process !== "undefined" && (process as unknown as { env?: Record<string, string> }).env?.EXPO_PUBLIC_OCR_URL) ||
  "http://192.168.1.60:3080";

// Optional: same value as OCR_API_KEY on the server; sent in x-api-key for cloud OCR.
export const OCR_API_KEY =
  (typeof process !== "undefined" && (process as unknown as { env?: Record<string, string> }).env?.EXPO_PUBLIC_OCR_API_KEY) ||
  "";

// EZSplit backend (project_ref pgabmbofjoiktzdpnxsd)
export const EZSPLIT_URL = "https://pgabmbofjoiktzdpnxsd.supabase.co";
export const EZSPLIT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBnYWJtYm9mam9pa3R6ZHBueHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxOTY0ODcsImV4cCI6MjA4Nzc3MjQ4N30.oFjl4LPbzsfJvBBq39ycJ0xoKFeT4rJc7IUYQe6S1Bo";
