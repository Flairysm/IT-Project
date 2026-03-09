const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Tesseract = require("tesseract.js");
const { createWorker } = Tesseract;
const FormData = require("form-data");
const heicConvert = require("heic-convert");
const sharp = require("sharp");
const { Pool } = require("pg");

const OCR_MAX_IMAGE_PX = Number(process.env.OCR_MAX_IMAGE_PX) || 1024;

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

/** Optional: use [receipt-ocr](https://github.com/bhimrazy/receipt-ocr) Tesseract service when set. */
const RECEIPT_OCR_URL = process.env.RECEIPT_OCR_URL || "";
/** Optional: use OpenAI Vision (gpt-4o-mini) for receipt extraction when set. Often better for mixed language and layout. */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
/** Local Postgres connection string (example: postgres://user:pass@localhost:5432/receipts_app). */
const DATABASE_URL = process.env.DATABASE_URL || "";
/** Optional: require this API key in x-api-key header for /ocr. Set in production to prevent abuse. */
const OCR_API_KEY = process.env.OCR_API_KEY || "";

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

// --- Public OCR: rate limit and optional API key (for multi-tenant cloud) ---
const ocrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.OCR_RATE_LIMIT_PER_MINUTE) || 30,
  message: { error: "Too many requests; try again in a minute." },
  standardHeaders: true,
});
function optionalOcrAuth(req, res, next) {
  if (!OCR_API_KEY) return next();
  const key = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (key !== OCR_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API key. Set x-api-key header." });
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ezsplit-ocr" });
});

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "ezsplit-ocr", message: "Use POST /ocr with imageBase64 for receipt scanning. GET /health for health check." });
});

let sharedTesseractWorker = null;
let sharedTesseractWorkerPromise = null;
async function getTesseractWorker() {
  if (sharedTesseractWorker) return sharedTesseractWorker;
  if (sharedTesseractWorkerPromise) return sharedTesseractWorkerPromise;
  sharedTesseractWorkerPromise = createWorker("eng", 1, { logger: () => {} }).then((w) => {
    sharedTesseractWorker = w;
    return w;
  });
  return sharedTesseractWorkerPromise;
}

/** Strip data URL prefix if present; return raw base64 payload. */
function normalizeBase64(imageBase64) {
  if (typeof imageBase64 !== "string") return "";
  const s = imageBase64.trim();
  const i = s.indexOf("base64,");
  return i >= 0 ? s.slice(i + 7) : s;
}

/** HEIC magic: ftyp at 4-7, then heic/mif1/heix/hevc at 8-11. */
function isHeic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer[4] !== 0x66 || buffer[5] !== 0x74 || buffer[6] !== 0x79 || buffer[7] !== 0x70) return false;
  const ftyp = buffer.toString("ascii", 8, 12);
  return /^heic|mif1|heix|hevc/i.test(ftyp) || (buffer[8] === 0x68 && buffer[9] === 0x65 && buffer[10] === 0x69 && buffer[11] === 0x63);
}

/** Normalize image: strip data URL, decode base64, convert HEIC to JPEG, resize for faster OCR. Returns { buffer, base64 }. */
async function normalizeImagePayload(imageBase64) {
  const raw = normalizeBase64(imageBase64);
  if (!raw) throw new Error("Missing or invalid image data");
  let buffer = Buffer.from(raw, "base64");
  if (buffer.length === 0) throw new Error("Image data is empty");
  if (isHeic(buffer)) {
    try {
      buffer = await heicConvert({ buffer, format: "JPEG" });
    } catch (e) {
      console.warn("HEIC convert failed:", e.message);
      throw new Error("Unsupported image format. Use JPEG or PNG.");
    }
  }
  try {
    const meta = await sharp(buffer).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (w > OCR_MAX_IMAGE_PX || h > OCR_MAX_IMAGE_PX) {
      buffer = await sharp(buffer)
        .resize(OCR_MAX_IMAGE_PX, OCR_MAX_IMAGE_PX, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
    }
  } catch (e) {
    console.warn("Resize skipped:", e.message);
  }
  return { buffer, base64: buffer.toString("base64") };
}

async function ensureReceiptsTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id BIGSERIAL PRIMARY KEY,
      merchant TEXT,
      receipt_date TEXT,
      total TEXT,
      source TEXT,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      members JSONB NOT NULL DEFAULT '[]'::jsonb,
      assignments JSONB NOT NULL DEFAULT '{}'::jsonb,
      split_totals JSONB NOT NULL DEFAULT '[]'::jsonb,
      paid_members JSONB NOT NULL DEFAULT '[]'::jsonb,
      paid BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE receipts
    ADD COLUMN IF NOT EXISTS paid_members JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
}

async function ensureGroupsTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_groups (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      members JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function normalizePaidMembers(raw) {
  return Array.isArray(raw) ? raw.map((x) => String(x)) : [];
}

function computePaymentSummary(totalRaw, splitTotalsRaw, paidMembersRaw, paidFlag) {
  const totalNum = Number.isFinite(parseFloat(totalRaw || "0")) ? parseFloat(totalRaw || "0") : 0;
  const splitTotals = Array.isArray(splitTotalsRaw) ? splitTotalsRaw : [];
  const paidMembers = normalizePaidMembers(paidMembersRaw);

  if (!splitTotals.length) {
    return {
      paid: Boolean(paidFlag),
      amount_due: paidFlag ? "0.00" : totalNum.toFixed(2),
      paid_members: paidMembers,
    };
  }

  const unpaidAmount = splitTotals.reduce((sum, row) => {
    const name = String(row?.name || "");
    const amount = Number.isFinite(parseFloat(String(row?.amount ?? 0))) ? parseFloat(String(row?.amount ?? 0)) : 0;
    return paidMembers.includes(name) ? sum : sum + amount;
  }, 0);
  const amountDue = Math.max(0, unpaidAmount);
  const isPaid = amountDue < 0.01;

  return {
    paid: isPaid,
    amount_due: amountDue.toFixed(2),
    paid_members: paidMembers,
  };
}

// Lines that mark end of item block (totals / footer) - not "Qty 1" (item line), but "Subtotal", "Total", etc.
// Include ^service\s+ so OCR misreads like "Service RN" still end the block
const ITEM_BLOCK_END = /^(total\s*:?|subtotal|sub\s*total|tax|gst|hst|vat|sst\s|service\s|service\s+charge|amount\s+due|balance|cash|change|card|thank|thanks|receipt|visa|mastercard|debit|credit|touch\s*n\s*go|tng|uob|saving|spec\.?\s*disc|rounding|member\s*no|invoice\s*no|grab\s*member)/i;

// Lines that are clearly not items (address, contact, header, product codes, discounts)
function isNonItemLine(line) {
  if (!line || line.length < 2) return true;
  const t = line.toLowerCase();
  if (ITEM_BLOCK_END.test(line)) return true;
  if (/^service\s+/i.test(line)) return true; // "Service charge", "Service RN" (OCR), etc.
  if (/^\d{1,2}[\/\-]\d{1,2}/.test(line) && !/\d+\.\d{2}\s*$/.test(line)) return true; // date-only
  if (/^\$?\s*[\d,]+\.?\d*\s*$/.test(line)) return true; // only a number (grand total)
  if (/^-\s*[\d.]+$/.test(line)) return true; // discount line e.g. -0.92
  if (/^\d{2}\s+[\d.]+$/.test(line)) return true; // e.g. "02 7.48" net/code
  if (/\b(street|st\.|ave|avenue|road|rd|blvd|lane|ln|drive|dr|way|place|pl|block|darul\s*ehsan)\b/i.test(t)) return true;
  if (/\b(city|state|province|zip|postal|country|selangor)\b/i.test(t)) return true;
  if (/\b(phone|tel|fax|email|www\.|http|\.com|\.org)\b/i.test(t)) return true;
  if (/@/.test(t) || /\d{5}(-\d{4})?/.test(line)) return true; // email or zip
  if (line.length > 55 && !/\d+\.\d{2}\s*$/.test(line)) return true; // long line with no price = likely address
  if (/^\d{10,}\s*(unit|kg)$/i.test(line)) return true; // product code e.g. 9555487800052 UNIT
  if (/^\d+x[\d.]+$|^[\d.]+x[\d.]+$/i.test(line.trim())) return true; // only "1x8.40" or "0.084x12.10" (no item name)
  if (/^we\s+sell|please\s+come|thank\s+you|if\s+you\s+are\s+not/i.test(t)) return true; // footer
  if (/\(\d{5,}|^\d{6,}\s*\(/i.test(line)) return true; // 117420 (SYIFA) or (544047-T)
  if (/^[a-z]-?\d{2}-\d{2}/i.test(line)) return true; // D-01-01
  if (/^\d+\s+[\d.]+\s*$/.test(line)) return true; // "001" or "54" style
  if (line.split(/\s+/).length >= 8 && !/\d+\.\d{2}\s*$/.test(line)) return true; // many tokens, no price = address
  return false;
}

// Price must look like money (not zip, phone, etc.)
function isReasonablePrice(numStr) {
  const n = parseFloat(numStr);
  if (isNaN(n) || n < 0) return false;
  if (n > 9999.99) return false; // unlikely single item price
  const noDecimal = numStr.indexOf(".") === -1;
  if (noDecimal && numStr.length >= 5) return false; // e.g. 12345 = zip
  return true;
}

// Summary/payment keywords - never treat as item name (cross-check blocklist)
const NOT_ITEM_NAMES = /^(total|sub\s*total|subtotal|service\s*(\d|rn|charge)?|touch\s*n\s*go|tng|uob|saving|change|cash|card|rounding|spec\.?\s*disc|amount|balance|thank\s*you|receipt|visa|mastercard|debit|credit|item\s*\d*|qty\s*[\d.]*)$/i;

// Trim trailing " N" from name when it equals qty (OCR often appends quantity to name)
function trimQtyFromName(name, qty) {
  if (!name || qty == null) return name;
  const trailing = new RegExp("\\s+" + (qty | 0) + "\\s*$");
  return name.replace(trailing, "").trim() || name;
}

// Item name must look like a product name, not address/company/code/summary
function looksLikeItemName(name, allowShort) {
  if (!name || name.length < 2 || name.length > 60) return false;
  const n = name.trim().toLowerCase();
  if (/^service\s/.test(n)) return false; // "Service charge", "Service RN" (OCR), etc.
  if (NOT_ITEM_NAMES.test(n)) return false; // Total, Touch N Go, etc.
  const letters = (name.match(/[a-zA-Z]/g) || []).length;
  const digits = (name.match(/\d/g) || []).length;
  const minLetters = allowShort ? 2 : 3;
  if (letters < minLetters) return false; // "Rice" = 4
  if (digits > letters && !allowShort) return false; // mostly numbers = code
  if (/\d{10,}/.test(name)) return false; // 10+ consecutive digits = product code
  if (/\b(sdn\s*bhd|bhd|pte|llc|inc)\b/i.test(name)) return false;
  if (/\binvoice\s*no|member\s*no|tel\s*:|\bblock\s+[a-z]\b/i.test(name)) return false;
  if (/\(\d{5,}/.test(name) || /\d{5,}\)/.test(name)) return false; // (544047-T) style
  if (/,\s*\d{5}/.test(name)) return false; // address ", 47500"
  if (/^\d+\s*(unit|kg)$/i.test(name.trim())) return false;
  if (/^[a-z]-?\d{2}-\d{2}/i.test(name)) return false; // D-01-01 unit number
  return true;
}

/**
 * Parse one line into { name, price, qty } or null.
 * Handles JAYA GROCER style: "Item Name  1x8.40  8.40" or "Item Name  0.084x12.10  1.02".
 * Strips leading qty and middle "QtyxUnitPrice" from name.
 */
function parseLineItem(line) {
  const priceMatch = line.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/);
  if (!priceMatch) return null;
  const priceRaw = priceMatch[1].replace(/,/g, "");
  if (!isReasonablePrice(priceRaw)) return null;
  const price = priceRaw.includes(".") ? priceRaw : `${priceRaw}.00`;
  let namePart = line.slice(0, priceMatch.index).trim();
  if (!namePart || !/[a-zA-Z]/.test(namePart) || namePart.length < 2) return null;

  let qty = 1;
  // Strip middle "NxY.YY" or "N x Y.YY" (quantity x unit price) so name doesn't include it
  const qtyUnitMatch = namePart.match(/\s+(\d+(?:\.\d+)?)\s*x\s*[\d.]+\s*$/i);
  if (qtyUnitMatch) {
    qty = parseFloat(qtyUnitMatch[1]);
    namePart = namePart.slice(0, qtyUnitMatch.index).trim();
  } else {
    const leadingQty = namePart.match(/^(\d+)\s*x?\s*/i);
    if (leadingQty) {
      qty = parseInt(leadingQty[1], 10);
      namePart = namePart.slice(leadingQty[0].length).trim();
    } else {
      const leadingDecimalQty = namePart.match(/^(\d+\.\d+)\s*x\s*/i);
      if (leadingDecimalQty) {
        qty = parseFloat(leadingDecimalQty[1]);
        namePart = namePart.slice(leadingDecimalQty[0].length).trim();
      }
    }
  }
  let name = namePart.replace(/\s+/g, " ").trim();
  name = trimQtyFromName(name, qty);
  if (!name || name.length < 2) return null;
  if (!looksLikeItemName(name)) return null;

  return { name, price, qty };
}

// LONGJING / restaurant format: "Item Name  Qty 1  Subt. 59.00" or "Qty 1  Subt. 59.00" with name on previous line(s).
// If name is on previous line and that line is Chinese/not valid, use the line before that (English name).
function parseLineItemQtySubt(line, lines, lineIndex) {
  const onOneLine = line.match(/^(.+?)\s+Qty\s+(\d+)\s+Subt?\.?\s*([\d.]+)\s*$/i);
  if (onOneLine) {
    let name = onOneLine[1].trim().replace(/\s+/g, " ");
    const qty = parseInt(onOneLine[2], 10);
    name = trimQtyFromName(name, qty);
    if (!name || !looksLikeItemName(name, true)) return null;
    const priceRaw = onOneLine[3];
    if (!isReasonablePrice(priceRaw)) return null;
    const price = priceRaw.includes(".") ? priceRaw : `${priceRaw}.00`;
    return { name, price, qty };
  }
  const qtySubtOnly = line.match(/^\s*Qty\s+(\d+)\s+Subt?\.?\s*([\d.]+)\s*$/i);
  if (!qtySubtOnly) return null;
  const qty = parseInt(qtySubtOnly[1], 10);
  const priceRaw = qtySubtOnly[2];
  if (!isReasonablePrice(priceRaw)) return null;
  const price = priceRaw.includes(".") ? priceRaw : `${priceRaw}.00`;
  // Name may be on previous line, or two lines back (e.g. English then Chinese)
  for (const offset of [1, 2]) {
    const idx = lineIndex - offset;
    if (idx < 0) continue;
    const candidate = lines[idx].trim().replace(/\s+/g, " ");
    if (!candidate || candidate.length < 2) continue;
    if (/^Qty\s+\d+\s+Subt?\.?\s*[\d.]+/i.test(candidate)) continue; // skip if that line is another Qty/Subt
    let name = trimQtyFromName(candidate, qty);
    if (looksLikeItemName(name, true)) return { name, price, qty };
    // Allow English-looking name (has at least 2 ASCII letters) even if strict check fails (e.g. "Rice(Position)")
    const asciiLetters = (name.match(/[a-zA-Z]/g) || []).length;
    if (asciiLetters >= 2 && name.length <= 60 && !NOT_ITEM_NAMES.test(name.toLowerCase()) && !/^service\s/.test(name.toLowerCase())) return { name, price, qty };
  }
  return null;
}

/**
 * Find the item-only block: after header/address, before totals. Only collect items in that range.
 */
function extractReceiptInfo(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const extracted = {
    rawLines: lines,
    total: null,
    subtotal: null,
    tax: null,
    date: null,
    merchant: null,
    items: [],
    totalQtyFromReceipt: null,
    sumItemQty: null,
    totalCheck: null, // { subtotal, serviceCharge, sst, total, expectedTotal, match }
  };

  // Match "Total:" or line starting with "Total " but not "Subtotal"
  const totalRegex = /^total\s*:?\s*\$?\s*([\d,]+\.?\d*)/im;
  const taxRegex = /(?:tax|gst|hst|vat|sst)\s*:?\s*(?:\d+%?\s*)?\$?\s*([\d,]+\.?\d*)/i;
  const subtotalRegex = /sub\s*total\s*:?\s*\$?\s*([\d,]+\.?\d*)/i;
  const serviceChargeRegex = /service\s+charge\s*(?:\d+%)?\s*:?\s*\$?\s*([\d,]+\.?\d*)/i;
  const sstRegex = /sst\s*(?:\d+%)?\s*:?\s*\$?\s*([\d,]+\.?\d*)/i;
  const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/;

  let subtotalVal = null;
  let serviceChargeVal = null;
  let sstVal = null;
  let totalVal = null;

  for (const line of lines) {
    let m = line.match(totalRegex);
    if (m) {
      extracted.total = m[1].replace(/,/g, "");
      totalVal = parseFloat(extracted.total);
    }
    m = line.match(taxRegex);
    if (m) {
      extracted.tax = m[1].replace(/,/g, "");
      if (!sstVal) sstVal = parseFloat(extracted.tax);
    }
    m = line.match(subtotalRegex);
    if (m) {
      extracted.subtotal = m[1].replace(/,/g, "");
      subtotalVal = parseFloat(extracted.subtotal);
    }
    m = line.match(serviceChargeRegex);
    if (m) serviceChargeVal = parseFloat(m[1].replace(/,/g, ""));
    m = line.match(sstRegex);
    if (m) sstVal = parseFloat(m[1].replace(/,/g, ""));
    m = line.match(dateRegex);
    if (m) extracted.date = (m[1] || m[2]).trim();
    // Merchant: skip lines that are mostly numbers or "number: text" (e.g. "732: LONGING")
    if (!extracted.merchant && line.length > 2 && line.length < 50 && !/^\d+\.?\d*\s*:/.test(line) && !/^\d|^\$|total|tax|subtotal|date/i.test(line) && !isNonItemLine(line))
      extracted.merchant = line;
  }
  if (totalVal != null) {
    const expected = (subtotalVal || 0) + (serviceChargeVal || 0) + (sstVal || 0);
    const expectedRounded = Math.round(expected * 100) / 100;
    const match = Math.abs((totalVal || 0) - expectedRounded) < 0.02;
    extracted.totalCheck = {
      subtotal: subtotalVal,
      serviceCharge: serviceChargeVal,
      sst: sstVal,
      total: totalVal,
      expectedTotal: expectedRounded,
      match,
    };
  }

  // Item block: find keywords "Item", "Qty", "Subt" for start; "Subtotal", "Service charge", "SST", "Total" for end
  let itemBlockStart = -1;
  let itemBlockEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].toLowerCase();
    // Header row: "Item" with "Qty" or "Subt" -> start items on next line
    if (/item\b/.test(t) && (/\bqty\b/.test(t) || /\bsubt\.?\b/.test(t)) && itemBlockStart === -1) {
      itemBlockStart = i + 1;
    }
    // No header found: first line with "Qty N  Subt. X" starts the block
    if (itemBlockStart === -1 && /^\s*Qty\s+\d+\s+Subt?\.?\s*[\d.]+/i.test(lines[i])) {
      itemBlockStart = i;
    }
    if (itemBlockStart >= 0 && /^(subtotal|sub\s*total|service\s|service\s+charge|sst\s*\d*%?|total\s*:?)/i.test(lines[i])) {
      itemBlockEnd = i;
      break;
    }
  }
  if (itemBlockStart === -1) itemBlockStart = 0;

  const usedAsNameLineIndex = new Set();
  for (let i = itemBlockStart; i < itemBlockEnd; i++) {
    const line = lines[i];
    if (/^\s*item\s*$|^item\s+qty\s+subt/i.test(line.trim())) continue; // skip header row
    if (usedAsNameLineIndex.has(i)) continue; // this line was used as name for a Qty/Subt line
    let item = parseLineItemQtySubt(line, lines, i);
    if (item) {
      extracted.items.push(item);
      const qtySubtMatch = line.match(/^\s*Qty\s+\d+\s+Subt?\.?\s*[\d.]+/i);
      if (qtySubtMatch) {
        for (const offset of [1, 2]) {
          const idx = i - offset;
          if (idx >= 0 && lines[idx].trim().length >= 2 && !/^Qty\s+\d+\s+Subt?\.?/.test(lines[idx])) {
            usedAsNameLineIndex.add(idx);
            break;
          }
        }
      }
      continue;
    }
    item = parseLineItem(line);
    if (item) extracted.items.push(item);
  }

  // Fallback: original logic for lines outside keyword item block
  if (extracted.items.length === 0) {
    let inItemBlock = false;
    for (const line of lines) {
      if (isNonItemLine(line)) {
        if (ITEM_BLOCK_END.test(line)) inItemBlock = false;
        continue;
      }
      const item = parseLineItem(line);
      if (item) {
        if (!inItemBlock) inItemBlock = true;
        extracted.items.push(item);
      } else if (inItemBlock && ITEM_BLOCK_END.test(line)) {
        inItemBlock = false;
      }
    }
  }

  // Receipt total qty (summary "Qty 4.46") - skip if it's "Qty 1" (item line)
  for (const line of lines) {
    const qtyMatch = line.match(/qty\s*:?\s*([\d.]+)/i);
    if (qtyMatch) {
      const val = parseFloat(qtyMatch[1]);
      if (!isNaN(val) && val >= 0 && val < 10000) {
        const isSummaryQty = val > 20 || (val % 1 !== 0); // decimal or large = summary
        if (isSummaryQty || extracted.totalQtyFromReceipt == null) extracted.totalQtyFromReceipt = val;
      }
      break;
    }
  }
  const sumQty = extracted.items.reduce((s, i) => s + (i.qty || 0), 0);
  extracted.sumItemQty = extracted.items.length ? Math.round(sumQty * 100) / 100 : null;

  if (!extracted.total && lines.length > 0) {
    const last = lines[lines.length - 1];
    const amount = last.replace(/[^\d.]/g, "");
    if (amount && parseFloat(amount) > 0 && parseFloat(amount) < 100000) extracted.total = amount;
  }

  return extracted;
}

/**
 * Call receipt-ocr Tesseract service (POST /ocr/ with multipart file).
 * Returns raw text string.
 */
async function ocrViaReceiptOcr(imageBuffer) {
  const form = new FormData();
  form.append("file", imageBuffer, { filename: "receipt.jpg", contentType: "image/jpeg" });
  const baseUrl = RECEIPT_OCR_URL.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/ocr/`, {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || data.message || "receipt-ocr request failed");
  return data.text ?? data.result ?? data.extracted_text ?? (typeof data === "string" ? data : "");
}

/**
 * Optional: extract receipt data using OpenAI Vision (gpt-4o-mini).
 * Returns same shape as extractReceiptInfo so the app works unchanged.
 */
async function extractReceiptWithVision(imageBase64) {
  const prompt = `Extract receipt data from this image. Return ONLY a single JSON object (no markdown, no code block) with this exact structure:
{
  "merchant": "store or restaurant name or null",
  "date": "YYYY-MM-DD or null",
  "items": [ { "name": "item name in English", "qty": 1, "price": "59.00" } ],
  "subtotal": "171.00",
  "serviceCharge": "17.10",
  "sst": "10.26",
  "total": "198.36"
}
Rules:
- items: only line items (food/products). NOT subtotal, service charge, SST, total, payment method, or footer text.
- price: string with 2 decimals (e.g. "59.00").
- If a field is not found, use null. For numbers use string (e.g. "198.36").
- Prefer English for item names; if the receipt has Chinese, use the English part or a short English label.`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You extract receipt data. Reply with only valid JSON, no other text." },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "OpenAI API error");
  const raw = data.choices?.[0]?.message?.content?.trim() || "";
  let json = raw;
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) json = codeBlock[1].trim();
  const parsed = JSON.parse(json);

  const subtotal = parsed.subtotal != null ? parseFloat(String(parsed.subtotal)) : null;
  const serviceCharge = parsed.serviceCharge != null ? parseFloat(String(parsed.serviceCharge)) : null;
  const sst = parsed.sst != null ? parseFloat(String(parsed.sst)) : null;
  const total = parsed.total != null ? parseFloat(String(parsed.total)) : null;
  const expectedTotal = [subtotal, serviceCharge, sst].every((n) => n != null) ? Math.round((subtotal + serviceCharge + sst) * 100) / 100 : null;
  const match = total != null && expectedTotal != null && Math.abs(total - expectedTotal) < 0.02;

  const items = Array.isArray(parsed.items) ? parsed.items.map((i) => ({
    name: String(i.name || "").trim(),
    qty: typeof i.qty === "number" ? i.qty : parseInt(String(i.qty || 1), 10) || 1,
    price: typeof i.price === "string" ? i.price : (i.price != null ? String(Number(i.price).toFixed(2)) : "0.00"),
  })) : [];
  const sumItemQty = items.reduce((s, i) => s + (i.qty || 0), 0);

  return {
    rawLines: [],
    total: parsed.total != null ? String(parsed.total).replace(/^(\d+\.?\d*).*/, "$1") : null,
    subtotal: parsed.subtotal != null ? String(parsed.subtotal) : null,
    tax: parsed.sst != null ? String(parsed.sst) : parsed.tax || null,
    date: parsed.date != null ? String(parsed.date) : null,
    merchant: parsed.merchant != null ? String(parsed.merchant).trim() : null,
    items,
    totalQtyFromReceipt: items.length ? sumItemQty : null,
    sumItemQty: items.length ? Math.round(sumItemQty * 100) / 100 : null,
    totalCheck: total != null ? { subtotal, serviceCharge, sst, total, expectedTotal, match } : null,
  };
}

app.post("/ocr", optionalOcrAuth, ocrLimiter, async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }
    const { buffer, base64: normalizedBase64 } = await normalizeImagePayload(imageBase64);

    // Prefer AI vision when configured (usually better for mixed language and layout)
    if (OPENAI_API_KEY) {
      try {
        console.log("OCR request: using OpenAI Vision...");
        const extracted = await extractReceiptWithVision(normalizedBase64);
        console.log("OCR request: Vision OK, items:", extracted.items?.length ?? 0);
        return res.json({ text: "(extracted with AI vision)", extracted, source: "vision" });
      } catch (aiErr) {
        console.warn("AI vision failed, falling back to OCR:", aiErr.message);
      }
    } else {
      console.log("OCR request: no OPENAI_API_KEY, using OCR");
    }

    let text;
    if (RECEIPT_OCR_URL) {
      text = await ocrViaReceiptOcr(buffer);
    } else {
      const worker = await getTesseractWorker();
      const { data } = await worker.recognize(buffer);
      text = data.text || "";
    }

    const extracted = extractReceiptInfo(text);
    console.log("OCR request: OCR OK, items:", extracted.items?.length ?? 0);
    res.json({ text: (text || "").trim(), extracted, source: "ocr" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "OCR failed" });
  }
});

app.post("/receipts", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    }

    const {
      merchant = null,
      date = null,
      total = null,
      source = null,
      items = [],
      members = [],
      assignments = {},
      split_totals = [],
    } = req.body || {};

    const insert = await pool.query(
      `INSERT INTO receipts
        (merchant, receipt_date, total, source, items, members, assignments, split_totals, paid_members, paid)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)
       RETURNING id`,
      [
        merchant,
        date,
        total,
        source,
        JSON.stringify(Array.isArray(items) ? items : []),
        JSON.stringify(Array.isArray(members) ? members : []),
        JSON.stringify(assignments && typeof assignments === "object" ? assignments : {}),
        JSON.stringify(Array.isArray(split_totals) ? split_totals : []),
        JSON.stringify([]),
        false,
      ]
    );

    return res.json({ ok: true, id: String(insert.rows[0].id) });
  } catch (err) {
    console.error("Save receipt failed:", err);
    return res.status(500).json({ error: err.message || "Failed to save receipt" });
  }
});

app.get("/receipts", async (_req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    }
    const result = await pool.query(
      `SELECT id, merchant, receipt_date, total, source, items, members, assignments, split_totals, paid_members, paid, created_at
       FROM receipts
       ORDER BY created_at DESC`
    );

    const rows = result.rows.map((r) => {
      const paymentSummary = computePaymentSummary(r.total, r.split_totals, r.paid_members, r.paid);
      return {
        id: String(r.id),
        merchant: r.merchant,
        date: r.receipt_date,
        total: r.total,
        source: r.source,
        items: r.items || [],
        members: r.members || [],
        assignments: r.assignments || {},
        split_totals: r.split_totals || [],
        paid_members: paymentSummary.paid_members,
        paid: paymentSummary.paid,
        amount_due: paymentSummary.amount_due,
        created_at: r.created_at,
      };
    });

    return res.json({ receipts: rows });
  } catch (err) {
    console.error("Fetch receipts failed:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch receipts" });
  }
});

app.get("/receipts/:id", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    }
    const result = await pool.query(
      `SELECT id, merchant, receipt_date, total, source, items, members, assignments, split_totals, paid_members, paid, created_at
       FROM receipts
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Receipt not found" });

    const r = result.rows[0];
    const paymentSummary = computePaymentSummary(r.total, r.split_totals, r.paid_members, r.paid);
    return res.json({
      receipt: {
        id: String(r.id),
        merchant: r.merchant,
        date: r.receipt_date,
        total: r.total,
        source: r.source,
        items: r.items || [],
        members: r.members || [],
        assignments: r.assignments || {},
        split_totals: r.split_totals || [],
        paid_members: paymentSummary.paid_members,
        paid: paymentSummary.paid,
        amount_due: paymentSummary.amount_due,
        created_at: r.created_at,
      },
    });
  } catch (err) {
    console.error("Fetch receipt failed:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch receipt" });
  }
});

app.patch("/receipts/:id/paid", async (_req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    }
    const getRow = await pool.query(
      `SELECT split_totals FROM receipts WHERE id = $1 LIMIT 1`,
      [_req.params.id]
    );
    if (!getRow.rows.length) return res.status(404).json({ error: "Receipt not found" });
    const splitTotals = Array.isArray(getRow.rows[0].split_totals) ? getRow.rows[0].split_totals : [];
    const paidMembers = splitTotals.map((x) => String(x?.name || "")).filter(Boolean);

    const result = await pool.query(
      `UPDATE receipts
       SET paid = TRUE, paid_members = $2::jsonb
       WHERE id = $1
       RETURNING id`,
      [_req.params.id, JSON.stringify(paidMembers)]
    );
    return res.json({ ok: true, id: String(result.rows[0].id) });
  } catch (err) {
    console.error("Mark paid failed:", err);
    return res.status(500).json({ error: err.message || "Failed to mark as paid" });
  }
});

app.patch("/receipts/:id/paid-member", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    }
    const { name, paid } = req.body || {};
    const memberName = String(name || "").trim();
    if (!memberName) return res.status(400).json({ error: "Member name is required" });

    const current = await pool.query(
      `SELECT paid_members, split_totals FROM receipts WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    if (!current.rows.length) return res.status(404).json({ error: "Receipt not found" });

    const splitTotals = Array.isArray(current.rows[0].split_totals) ? current.rows[0].split_totals : [];
    const splitNames = splitTotals.map((x) => String(x?.name || ""));
    if (splitNames.length && !splitNames.includes(memberName)) {
      return res.status(400).json({ error: "Member does not exist in split totals" });
    }

    const existing = normalizePaidMembers(current.rows[0].paid_members);
    const shouldMarkPaid = paid === undefined ? !existing.includes(memberName) : Boolean(paid);
    const next = shouldMarkPaid
      ? Array.from(new Set([...existing, memberName]))
      : existing.filter((x) => x !== memberName);

    const isFullyPaid = splitNames.length ? splitNames.every((x) => next.includes(x)) : false;
    await pool.query(
      `UPDATE receipts
       SET paid_members = $2::jsonb, paid = $3
       WHERE id = $1`,
      [req.params.id, JSON.stringify(next), isFullyPaid]
    );

    return res.json({ ok: true, paid_members: next, paid: isFullyPaid });
  } catch (err) {
    console.error("Mark paid member failed:", err);
    return res.status(500).json({ error: err.message || "Failed to update member payment" });
  }
});

app.delete("/receipts/:id", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    }
    const result = await pool.query(
      `DELETE FROM receipts
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Receipt not found" });
    return res.json({ ok: true, id: String(result.rows[0].id) });
  } catch (err) {
    console.error("Delete receipt failed:", err);
    return res.status(500).json({ error: err.message || "Failed to delete receipt" });
  }
});

app.get("/groups", async (_req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    const result = await pool.query(
      `SELECT id, name, members, created_at
       FROM member_groups
       ORDER BY created_at DESC`
    );
    return res.json({
      groups: result.rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        members: Array.isArray(row.members) ? row.members.map((x) => String(x)) : [],
        created_at: row.created_at,
      })),
    });
  } catch (err) {
    console.error("Fetch groups failed:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch groups" });
  }
});

app.post("/groups", async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    const { name, members } = req.body || {};
    const groupName = String(name || "").trim();
    const safeMembers = Array.isArray(members)
      ? Array.from(new Set(members.map((x) => String(x).trim()).filter(Boolean)))
      : [];

    if (!groupName) return res.status(400).json({ error: "Group name is required" });
    if (!safeMembers.length) return res.status(400).json({ error: "At least one member is required" });

    const result = await pool.query(
      `INSERT INTO member_groups (name, members)
       VALUES ($1, $2::jsonb)
       RETURNING id, name, members, created_at`,
      [groupName, JSON.stringify(safeMembers)]
    );
    const row = result.rows[0];
    return res.json({
      group: {
        id: String(row.id),
        name: row.name,
        members: Array.isArray(row.members) ? row.members.map((x) => String(x)) : [],
        created_at: row.created_at,
      },
    });
  } catch (err) {
    console.error("Create group failed:", err);
    return res.status(500).json({ error: err.message || "Failed to create group" });
  }
});

app.delete("/groups/:id", async (req, res) => {
  try {
    if (!pool) return res.status(500).json({ error: "DATABASE_URL is missing in ocr-server/.env" });
    const result = await pool.query(
      `DELETE FROM member_groups
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Group not found" });
    return res.json({ ok: true, id: String(result.rows[0].id) });
  } catch (err) {
    console.error("Delete group failed:", err);
    return res.status(500).json({ error: err.message || "Failed to delete group" });
  }
});

const PORT = process.env.PORT || 3080;
app.listen(PORT, "0.0.0.0", async () => {
  if (pool) {
    try {
      await ensureReceiptsTable();
      await ensureGroupsTable();
      console.log("Postgres: connected and receipts table ready");
    } catch (dbErr) {
      console.warn("Postgres init failed:", dbErr.message);
    }
  } else {
    console.log("Postgres: disabled (set DATABASE_URL in ocr-server/.env to enable local saving)");
  }
  console.log(`OCR server at http://localhost:${PORT}`);
  if (OPENAI_API_KEY) {
    console.log("Receipt extraction: OpenAI Vision enabled (OPENAI_API_KEY loaded from ocr-server/.env)");
  } else {
    console.log("Receipt extraction: OCR only (add OPENAI_API_KEY to ocr-server/.env to use Vision)");
  }
  if (RECEIPT_OCR_URL) console.log(`Using receipt-ocr at ${RECEIPT_OCR_URL}`);
});
