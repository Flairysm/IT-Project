import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("push_token")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    return new Response(JSON.stringify({ error: "Profile not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const pushToken = (profile as { push_token?: string | null }).push_token;
  if (!pushToken || typeof pushToken !== "string" || pushToken.length === 0) {
    return new Response(
      JSON.stringify({ error: "No push token. Enable notifications in Settings first." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      {
        to: pushToken,
        title: "EZSplit",
        body: "If you see this, notifications work!",
        data: { test: true },
      },
    ]),
  });
  const data = await res.json().catch(() => ({}));
  const results = Array.isArray(data.data) ? data.data : [];
  const ok = results.some((r: { status?: string }) => (r as { status?: string }).status === "ok");

  return new Response(
    JSON.stringify({ sent: ok ? 1 : 0, message: ok ? "Test notification sent. Check your device." : "Failed to send." }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
