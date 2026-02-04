# Using receipt-ocr (optional)

This project can use [**receipt-ocr**](https://github.com/bhimrazy/receipt-ocr) by bhimrazy for Tesseract-based receipt OCR. That engine includes image preprocessing and is tuned for receipts.

## How it fits

- **Our app** → sends receipt image (base64) to **our Node server** (port 3080).
- **Our Node server** → if `RECEIPT_OCR_URL` is set, forwards the image to **receipt-ocr** (port 8000); otherwise uses built-in tesseract.js.
- **receipt-ocr** → returns raw OCR text; our server parses it and returns `{ text, extracted }` to the app.

No change is required in the Expo app.

## 1. Run receipt-ocr (Tesseract service)

From any directory:

```bash
git clone https://github.com/bhimrazy/receipt-ocr.git
cd receipt-ocr
docker compose -f src/tesseract_ocr/docker-compose.yml up --build
```

Wait until the service is up. It listens on **http://localhost:8000** (POST `/ocr/` with multipart file upload). See [receipt-ocr Tesseract README](https://github.com/bhimrazy/receipt-ocr/tree/main/src/tesseract_ocr).

## 2. Point our OCR server at it

In the **IT Project** repo, OCR server is in `ocr-server/`.

**Option A – .env file**

```bash
cd ocr-server
cp .env.example .env
```

Edit `.env` and set:

```env
RECEIPT_OCR_URL=http://localhost:8000
```

**Option B – inline**

```bash
cd ocr-server
RECEIPT_OCR_URL=http://localhost:8000 npm run start
```

## 3. Start our OCR server and app

1. Leave receipt-ocr running (Docker on port 8000).
2. In another terminal, from the project root:
   ```bash
   npm run ocr
   ```
   You should see: `Using receipt-ocr at http://localhost:8000`.
3. Start the Expo app (`npm start`) and use **Scan Receipt** as usual.

## Summary

| Service        | Port | When to run        |
|----------------|------|--------------------|
| receipt-ocr    | 8000 | Optional; for their Tesseract engine. |
| Our OCR server | 3080 | Always; app talks to this.           |

If `RECEIPT_OCR_URL` is not set, our server uses built-in tesseract.js and you don’t need receipt-ocr or Docker.
