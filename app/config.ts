/**
 * OCR server URL. Must be reachable from your phone/emulator.
 * Set to your computer's LAN IP so Expo Go on your phone works.
 * For simulator-only you could use "http://localhost:3080".
 * Start the server: cd ocr-server && npm run start
 */
export const OCR_SERVER_URL = "http://192.168.1.52:3080";

/**
 * Supabase (use anon key only in the app; never put service_role/secret in client code).
 * Get from Dashboard: Project Settings → API → anon public.
 */
export const SUPABASE_URL = "https://nzpjxutdbjtxhruigvrt.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56cGp4dXRkYmp0eGhydWlndnJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI4NzY0MzMsImV4cCI6MjA3ODQ1MjQzM30.GHpuieH1tXE8QRaII_MzcKqb438ytr1DAdvFygFy_do";
