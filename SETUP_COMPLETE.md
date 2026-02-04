# Full setup – Receipts app

Follow these steps once to get everything running. After that, use **Run the app** below.

---

## 1. Prerequisites

- **Node.js** v18 or v20 → `node -v`
- **npm** → `npm -v`
- **Expo Go** on your phone ([iOS](https://apps.apple.com/app/expo-go/id982107779) / [Android](https://play.google.com/store/apps/details?id=host.exp.exponent))
- **Same Wi‑Fi** for computer and phone (for scanning on a real device)

---

## 2. One-time install

From the **project root** (`IT Project`):

```bash
cd "/Users/bryant/Documents/IT Project"
npm run setup
```

This runs: `npm install --legacy-peer-deps` (app) and `npm install` in `ocr-server/`.  
If you prefer to do it manually:

```bash
npm install --legacy-peer-deps
cd ocr-server && npm install && cd ..
```

---

## 3. Config (OCR server URL)

The app must know where the OCR server is.

- **File:** `app/config.ts`
- **On your phone (Expo Go):** Set `OCR_SERVER_URL` to your **computer’s IP**, e.g. `http://192.168.1.52:3080`
- **Simulator only:** You can use `http://localhost:3080`

Your config is already set to **192.168.1.52**. If your Mac’s IP changes (different Wi‑Fi), update it. To find IP: `ifconfig | grep "inet " | grep -v 127.0.0.1` and use the `192.168.x.x` or `10.0.x.x` address.

---

## 4. Optional – AI (OpenAI Vision)

For better receipt accuracy (e.g. mixed English + Chinese):

1. Get an API key from [OpenAI API keys](https://platform.openai.com/api-keys).
2. Create `ocr-server/.env` with:
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```
3. Restart the OCR server. You should see: *Receipt extraction: OpenAI Vision (fallback: OCR)*.

If you skip this, the app uses **Tesseract OCR** only (free, runs on your machine).

---

## 5. Run the app (every time you develop)

You need **two terminals**.

### Terminal 1 – OCR server (leave running)

```bash
cd "/Users/bryant/Documents/IT Project"
npm run ocr
```

You should see:
- `OCR server at http://localhost:3080`
- If you set `OPENAI_API_KEY`: `Receipt extraction: OpenAI Vision (fallback: OCR)`

### Terminal 2 – Expo app

```bash
cd "/Users/bryant/Documents/IT Project"
npm start
```

Then:

- **Phone:** Open **Expo Go** → scan the QR code (same Wi‑Fi as your Mac).
- **Simulator:** Press **`i`** (iOS) or **`a`** (Android) in the terminal.

---

## 6. Use the app

1. Tap **Scan Receipt**.
2. Choose **Take Photo** or **Choose from Library**.
3. The image is sent to the OCR server; you’ll see extracted items, total, and (if available) Total check and Qty check.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| **“Network request failed”** | Phone and Mac on same Wi‑Fi? OCR server running (`npm run ocr`)? Is `app/config.ts` using your Mac’s current IP? |
| **Port 3080 in use** | Stop the other process, or change `PORT` in `ocr-server/.env` and the port in `app/config.ts`. |
| **Peer dependency warnings** | Use `npm install --legacy-peer-deps` at project root. |
| **AI not used** | Ensure `ocr-server/.env` has `OPENAI_API_KEY=sk-...` and you restarted the OCR server. |

More detail: **[GUIDE.md](./GUIDE.md)** (IP, simulator vs device, optional receipt-ocr Docker).
