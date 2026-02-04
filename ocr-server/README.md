# Receipt OCR Server

Local server that runs OCR on receipt images. The app sends a base64 image and receives extracted text plus parsed fields (total, tax, date, merchant).

## Modes

1. **Built-in (default)** – Uses [tesseract.js](https://github.com/naptha/tesseract.js) in Node. No extra setup.
2. **receipt-ocr (optional)** – Forwards to [receipt-ocr](https://github.com/bhimrazy/receipt-ocr) Tesseract service for their preprocessing and engine. Set `RECEIPT_OCR_URL` (see below).

## Setup

```bash
cd ocr-server
npm install
npm run start
```

Server runs at `http://localhost:3080`. On a physical device with Expo Go, set `OCR_SERVER_URL` in `app/config.ts` to your computer’s LAN IP (e.g. `http://192.168.1.52:3080`).

## Using receipt-ocr (optional)

[receipt-ocr](https://github.com/bhimrazy/receipt-ocr) is an efficient OCR engine for receipts with image preprocessing. To use it:

1. **Clone and run their Tesseract service:**
   ```bash
   git clone https://github.com/bhimrazy/receipt-ocr.git
   cd receipt-ocr
   docker compose -f src/tesseract_ocr/docker-compose.yml up --build
   ```
   Their API runs at `http://localhost:8000` (POST `/ocr/` with image file).

2. **Point this server at it** – in `ocr-server` create a `.env` file:
   ```env
   RECEIPT_OCR_URL=http://localhost:8000
   ```
   Or run with:
   ```bash
   RECEIPT_OCR_URL=http://localhost:8000 node server.js
   ```

3. Start this server as usual (`npm run start`). It will proxy images to receipt-ocr and return the same `{ text, extracted }` shape to the app.

The app does not need any changes; it still talks only to this server on port 3080.

## API

- **POST /ocr**  
  Body: `{ "imageBase64": "<base64 string>" }`  
  Response: `{ "text": "<full OCR text>", "extracted": { "total", "date", "merchant", ... } }`
