import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface RemindBody {
  receiptId: string;
  username?: string;
}

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
  let body: RemindBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { receiptId, username } = body;
  if (!receiptId || typeof receiptId !== "string") {
    return new Response(JSON.stringify({ error: "receiptId required" }), {
      status: 400,
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

  const { data: receipt, error: recErr } = await supabase
    .from("receipts")
    .select("id, host_id, merchant, split_totals, paid_members, total_amount")
    .eq("id", receiptId)
    .single();

  if (recErr || !receipt) {
    return new Response(JSON.stringify({ error: "Receipt not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (receipt.host_id !== user.id) {
    return new Response(JSON.stringify({ error: "Only the host can send reminders" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const splitTotals = Array.isArray(receipt.split_totals) ? receipt.split_totals : [];
  const paidMembers = Array.isArray(receipt.paid_members) ? receipt.paid_members.map(String) : [];
  const { data: hostProfile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", user.id)
    .single();

  const hostDisplayName = (hostProfile?.display_name || hostProfile?.username || "Someone")?.trim() || "Someone";
  const hostUsername = (hostProfile?.username || "").trim().toLowerCase();

  const unpaidUsernames = splitTotals
    .filter((s: { name?: string }) => {
      const n = String(s?.name ?? "").trim().toLowerCase();
      return n && n !== hostUsername && !paidMembers.some((p: string) => p.trim().toLowerCase() === n);
    })
    .map((s: { name?: string }) => String(s?.name ?? "").trim());

  const targets = username
    ? unpaidUsernames.filter((u: string) => u.toLowerCase() === String(username).trim().toLowerCase())
    : unpaidUsernames;

  if (targets.length === 0) {
    return new Response(JSON.stringify({ sent: 0, message: "No one to remind" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, push_token")
    .in("username", targets);

  const amountByUsername: Record<string, number> = {};
  for (const s of splitTotals) {
    const n = String((s as { name?: string }).name ?? "").trim();
    amountByUsername[n] = Number((s as { amount?: number }).amount ?? 0) || 0;
  }

  const tokens: { username: string; token: string; amount: number }[] = [];
  for (const p of profiles || []) {
    const row = p as { username?: string; push_token?: string | null };
    const tok = row.push_token;
    if (tok && typeof tok === "string" && tok.length > 0) {
      const u = row.username ?? "";
      tokens.push({ username: u, token: tok, amount: amountByUsername[u] ?? 0 });
    }
  }

  const merchant = (receipt.merchant || "receipt").trim().slice(0, 30);
  const currency = "RM";
  const messages = tokens.map(({ token, amount }) => ({
    to: token,
    title: "EZSplit reminder",
    body: `You owe ${hostDisplayName} ${currency} ${amount.toFixed(2)} for ${merchant}. Please settle up!`,
    data: { receiptId },
  }));

  let sent = 0;
  let failed = 0;
  if (messages.length > 0) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    const data = await res.json().catch(() => ({}));
    const results = Array.isArray(data.data) ? data.data : [];
    for (const r of results) {
      if ((r as { status?: string }).status === "ok") sent++;
      else failed++;
    }
    if (results.length === 0 && messages.length > 0) {
      failed = messages.length;
    } else if (sent + failed < messages.length) {
      sent = messages.length - failed;
    }
  }

  const payload: { sent: number; failed: number; total: number; message?: string } = {
    sent,
    failed,
    total: targets.length,
  };
  if (targets.length > 0 && sent === 0 && messages.length === 0) {
    payload.message = "No reminders sent — recipients don't have notifications enabled. Ask them to enable push in the app.";
  } else if (targets.length > 0 && sent === 0) {
    payload.message = "Reminders could not be delivered.";
  }

  return new Response(
    JSON.stringify(payload),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
