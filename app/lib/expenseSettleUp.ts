export type SettleUpEntry = {
  paid_by: string;
  amount: number;
  split_among: string[];
  /** Optional: user_id -> percentage (0–100). If absent, split is equal among split_among. */
  split_percentages?: Record<string, number> | null;
};

/**
 * Compute minimal "who pays whom" settlement from expense entries.
 * Members and entries must match the same expense group.
 */
export function computeSettleUp(
  memberIds: string[],
  entries: SettleUpEntry[]
): { from: string; to: string; amount: number }[] {
  const ids = [...memberIds];
  const amountPaid: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const share: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));

  for (const e of entries) {
    amountPaid[e.paid_by] = (amountPaid[e.paid_by] ?? 0) + e.amount;
    const among = e.split_among.length ? e.split_among : [...ids];
    const pct = e.split_percentages && Object.keys(e.split_percentages).length > 0
      ? e.split_percentages
      : null;
    if (pct) {
      let totalPct = 0;
      for (const id of among) {
        if (ids.includes(id)) totalPct += pct[id] ?? 0;
      }
      const scale = totalPct > 0 ? 100 / totalPct : 1 / among.length;
      for (const id of among) {
        if (ids.includes(id)) {
          const frac = ((pct[id] ?? 0) * scale) / 100;
          share[id] = (share[id] ?? 0) + e.amount * frac;
        }
      }
    } else {
      const n = among.length || 1;
      const each = e.amount / n;
      for (const id of among) {
        if (ids.includes(id)) share[id] = (share[id] ?? 0) + each;
      }
    }
  }

  const balance: Record<string, number> = {};
  for (const id of ids) {
    balance[id] = (amountPaid[id] ?? 0) - (share[id] ?? 0);
  }

  const debtors = ids.filter((id) => balance[id]! < -0.01).map((id) => ({ id, balance: balance[id]! })).sort((a, b) => a.balance - b.balance);
  const creditors = ids.filter((id) => balance[id]! > 0.01).map((id) => ({ id, balance: balance[id]! })).sort((a, b) => b.balance - a.balance);

  const result: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const from = debtors[i]!;
    const to = creditors[j]!;
    const amount = Math.min(-from.balance, to.balance);
    if (amount >= 0.01) {
      result.push({ from: from.id, to: to.id, amount });
      from.balance += amount;
      to.balance -= amount;
    }
    if (from.balance >= -0.01) i++;
    if (to.balance <= 0.01) j++;
  }
  return result;
}
