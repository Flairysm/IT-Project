# EZSplit OCR Server

Receipt OCR and extraction service used by the EZSplit app. Supports **local** (dev) and **cloud** (multi-user) deployment.

## Local (development)

```bash
cd ocr-server
npm install
# Optional: copy .env.example to .env and set OPENAI_API_KEY for better extraction
npm start
```

Server runs at `http://localhost:3080`. Point the app at your machine’s IP (e.g. `http://192.168.x.x:3080`) when testing on a device.

## Cloud (public / multi-user)

The server is built for multi-tenant use:

- **Rate limiting**: 30 requests per IP per minute (configurable via `OCR_RATE_LIMIT_PER_MINUTE`).
- **Optional API key**: set `OCR_API_KEY` in the server env; the app sends it in the `x-api-key` header so only your app can call the API.
- **Health check**: `GET /health` returns `{ ok: true }` for load balancers.

### Deploy on Render.com

1. Push this repo to GitHub.
2. In [Render](https://render.com): **New → Blueprint**, connect the repo, and select the root `render.yaml`.
3. Deploy. Render will build the Docker image from `ocr-server/` and run the server.
4. Copy the service URL (e.g. `https://ezsplit-ocr.onrender.com`).
5. (Optional) In Render dashboard → **Environment**, add:
   - `OCR_API_KEY`: secret key; add the same value in the app as `EXPO_PUBLIC_OCR_API_KEY` so the app can call the API.
   - `OPENAI_API_KEY`: for better receipt parsing (optional, costs per request).

### Deploy with Docker

```bash
cd ocr-server
docker build -t ezsplit-ocr .
docker run -p 3080:3080 -e OCR_API_KEY=your-key -e OPENAI_API_KEY=sk-... ezsplit-ocr
```

### Use the cloud URL in the app

Set the OCR URL when building the app (e.g. EAS Build or local prod):

- **Expo**: set `EXPO_PUBLIC_OCR_URL=https://your-ocr-service.onrender.com` (no trailing slash).
- If the server uses an API key, set `EXPO_PUBLIC_OCR_API_KEY` to the same value.

See `app/config.ts`: it uses `EXPO_PUBLIC_OCR_URL` when defined, otherwise the default (e.g. local IP).

## API

- `GET /health` — returns `{ ok: true, service: "ezsplit-ocr" }`.
- `POST /ocr` — body `{ imageBase64: string }`. Returns `{ text?, extracted: { merchant?, date?, total?, items? }, source }`. If `OCR_API_KEY` is set, send it in the `x-api-key` header.
