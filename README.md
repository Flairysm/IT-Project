# Receipts (Expo)

Black & green themed React Native app with Expo Go. Scan receipts by taking a photo or choosing from the library; OCR runs via a local Tesseract server and extracted text is shown in the app.

**For a full setup and troubleshooting guide**, see **[GUIDE.md](./GUIDE.md)** (prerequisites, simulator vs device, finding your IP, configuring the OCR URL, step-by-step runs, and troubleshooting).

---

## Quick start (after setup)

**Terminal 1 – OCR server** (required for Scan Receipt):
```bash
npm run ocr
```

**Terminal 2 – Expo app:**
```bash
npm start
```
Scan the QR code with **Expo Go** (same Wi-Fi), or press `i` (iOS) / `a` (Android). The app is already configured with your computer's IP so Scan Receipt works on your phone.

## First-time setup

From the project root:
```bash
npm run setup
```
Then use the Quick start above.

## Scan Receipt (OCR)

1. Run `npm run ocr` in one terminal.
2. Run `npm start` in another; open the app in Expo Go.
3. Tap **Scan Receipt** → **Take Photo** or **Choose from Library**.
4. View extracted info (merchant, date, total, tax) and full OCR text.

**Physical device:** `app/config.ts` is set to your computer's LAN IP; keep phone and computer on the same Wi-Fi.

**Optional – AI (OpenAI Vision):** For better accuracy (e.g. mixed English + Chinese, layout), set `OPENAI_API_KEY` in `ocr-server/.env`. The server will use Vision first and fall back to Tesseract if the request fails. See **GUIDE.md** §5b.

**Optional – [receipt-ocr](https://github.com/bhimrazy/receipt-ocr):** You can use their Tesseract engine (Docker) for OCR; see **[RECEIPT_OCR.md](./RECEIPT_OCR.md)**.

## Structure

- **Home** – Scan Receipt (camera or library), then view OCR text and extracted fields.
- **History** – placeholder
- **Setting** – placeholder

Bottom tabs: Home, History, Setting.
