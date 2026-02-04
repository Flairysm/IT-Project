# Receipts app – in-depth guide

This guide walks you through setting up and running the Receipts app with the OCR server, whether you use a simulator or a physical device.

---

## 1. Prerequisites

- **Node.js** (v18 or v20). Check: `node -v`
- **npm**. Check: `npm -v`
- **Expo Go** on your phone ([iOS](https://apps.apple.com/app/expo-go/id982107779) / [Android](https://play.google.com/store/apps/details?id=host.exp.exponent))
- **Same Wi‑Fi** for your computer and phone (needed when using Expo Go on a physical device)

---

## 2. First-time setup

### 2.1 Install the app

From the project root (`IT Project`):

```bash
npm install
```

If you see peer dependency warnings, you can use:

```bash
npm install --legacy-peer-deps
```

### 2.2 Install the OCR server

The app sends receipt images to a small Node server that runs Tesseract OCR. You need to install and run it separately:

```bash
cd ocr-server
npm install
cd ..
```

Keep the project root in mind: the app lives in the root folder, the server in `ocr-server/`.

---

## 3. Understanding “localhost” vs “your computer’s IP”

- **localhost** (`http://localhost:3080`) means “this device.”
  - On the **simulator** (iOS/Android on your computer), “this device” is your computer → the app can reach the OCR server with `localhost`.
- On a **physical phone**, “this device” is the phone. The phone has no OCR server, so `http://localhost:3080` fails → you get “network request failed.”

So:

- **Simulator (or app and server on same machine):** use `http://localhost:3080` in the app.
- **Physical device (Expo Go on phone):** the app must use your **computer’s IP** (e.g. `http://192.168.1.5:3080`).

---

## 4. Finding your computer’s IP address

Use the same Wi‑Fi as your phone, then:

### Mac

1. Open **Terminal**.
2. Run:
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```
3. Use the address that looks like `192.168.x.x` or `10.0.x.x` (not `127.0.0.1`).

Example: if you see `inet 192.168.1.5`, your URL is `http://192.168.1.5:3080`.

### Windows

1. Open **Command Prompt** or **PowerShell**.
2. Run:
   ```bash
   ipconfig
   ```
3. Find the **Wireless LAN adapter Wi-Fi** (or **Ethernet** if wired) section.
4. Use the **IPv4 Address** (e.g. `192.168.1.5`). Your URL is `http://192.168.1.5:3080`.

### Linux

```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

Or:

```bash
hostname -I
```

Use the first address that looks like `192.168.x.x` or `10.0.x.x`.

---

## 5. Configuring the app (OCR server URL)

The app reads the OCR server URL from **`app/config.ts`**.

1. Open **`app/config.ts`** in the project root.
2. Edit the line:
   ```ts
   export const OCR_SERVER_URL = "http://localhost:3080";
   ```

**When to use which value:**

| How you run the app        | Use this for `OCR_SERVER_URL`     |
|---------------------------|------------------------------------|
| iOS Simulator             | `http://localhost:3080`           |
| Android Emulator          | `http://10.0.2.2:3080` (emulator’s alias for host) or your LAN IP |
| Expo Go on a real phone   | `http://YOUR_COMPUTER_IP:3080` (e.g. `http://192.168.1.5:3080`) |

Example for a phone:

```ts
export const OCR_SERVER_URL = "http://192.168.1.5:3080";
```

Save the file. The next time the app reloads (or you scan a receipt), it will use this URL.

---

## 5b. Optional: Using AI (OpenAI Vision) for better extraction

The server can use **OpenAI’s Vision API** (gpt-4o) instead of (or as a fallback after) Tesseract OCR.

**When AI helps:**
- **Mixed language** (e.g. English + Chinese on the same receipt) – Vision understands both and can pick the right item names.
- **Layout / tables** – Better at seeing “Item / Qty / Subt.” columns and not treating “Service charge” as a line item.
- **OCR misreads** – e.g. “Shaoxing” read as “Boe”; Vision often corrects these.
- **Missing items** – Vision looks at the image as a whole, so it’s less likely to drop the first or last line item.

**Trade-offs:**
- **Cost** – You pay per request (see below). Tesseract is free.
- **Privacy / offline** – Requests go to OpenAI’s servers. Tesseract runs fully on your machine.

**Pricing (OpenAI Vision, gpt-4o):**  
OpenAI charges by **tokens**, not a fixed “per image” fee. One receipt scan uses:
- **Input:** your prompt (text) + the image (counts as many input tokens; depends on size). Typical total ~500–1,500 input tokens.
- **Output:** the JSON with items/totals. Typical ~200–400 tokens.

Approximate **gpt-4o** list price (see [OpenAI Pricing](https://platform.openai.com/docs/pricing) for current numbers):
- Input: **$2.50 per 1M tokens** (Standard tier).
- Output: **$10.00 per 1M tokens**.

So **one receipt scan is roughly $0.005–$0.02** (about half a cent to 2 cents) depending on image size and response length. Example: 1,000 input + 300 output ≈ (0.001 × $2.50) + (0.0003 × $10) ≈ **$0.0055 per scan**.  
You can confirm actual usage in the [OpenAI usage dashboard](https://platform.openai.com/usage) after scanning.

**How to enable:**
1. Get an API key from [OpenAI](https://platform.openai.com/api-keys).
2. In the **`ocr-server`** folder, create or edit a `.env` file:
   ```bash
   cd ocr-server
   echo "OPENAI_API_KEY=sk-your-key-here" >> .env
   ```
3. Restart the OCR server. On startup you should see: *Using OpenAI Vision for receipt extraction*.
4. If the Vision request fails (e.g. network or quota), the server automatically falls back to Tesseract OCR.

No app changes are needed – the server returns the same data shape whether it uses AI or OCR.

---

## 6. Running everything step by step

### Option A: Physical device (Expo Go on your phone)

1. **Set the OCR URL**  
   In `app/config.ts`, set `OCR_SERVER_URL` to your computer’s IP (see sections 4 and 5). Example: `http://192.168.1.5:3080`.

2. **Start the OCR server** (on your computer):
   ```bash
   cd ocr-server
   npm run start
   ```
   You should see: `OCR server at http://localhost:3080`. Leave this terminal open.

3. **Start the Expo app** (in a **second** terminal, from the project root):
   ```bash
   cd "/Users/bryant/Documents/IT Project"
   npx expo start
   ```
   Or from the project root:
   ```bash
   npx expo start
   ```

4. **Open the app on your phone**  
   - Unlock the phone and open the **Expo Go** app.  
   - Scan the QR code shown in the terminal (or in the browser).  
   - Wait for the bundle to load.

5. **Scan a receipt**  
   - Tap **Scan Receipt**.  
   - Choose **Take Photo** or **Choose from Library**.  
   - After selecting/capturing an image, the app sends it to the OCR server; then you see the extracted text and fields.

### Option B: iOS Simulator (Mac)

1. **OCR URL**  
   Keep `OCR_SERVER_URL = "http://localhost:3080"` in `app/config.ts`.

2. **Start the OCR server** (first terminal):
   ```bash
   cd ocr-server
   npm run start
   ```

3. **Start Expo** (second terminal, project root):
   ```bash
   npx expo start
   ```
   Press **`i`** to open the iOS Simulator.

4. In the app, tap **Scan Receipt** and use **Choose from Library** (or **Take Photo** if the simulator supports it). The app will talk to the server on `localhost:3080`.

### Option C: Android Emulator

1. **OCR URL**  
   Use either:
   - `http://10.0.2.2:3080` (emulator’s special alias for your computer’s localhost), or  
   - Your computer’s LAN IP, e.g. `http://192.168.1.5:3080`.

2. **Start the OCR server** (first terminal):
   ```bash
   cd ocr-server
   npm run start
   ```

3. **Start Expo** (second terminal):
   ```bash
   npx expo start
   ```
   Press **`a`** to open the Android emulator.

4. Use **Scan Receipt** as on iOS.

---

## 7. Troubleshooting

### “Network request failed” when scanning

- **On a physical device:**  
  - Confirm `app/config.ts` uses your **computer’s IP** (e.g. `http://192.168.1.5:3080`), not `localhost`.  
  - Confirm the OCR server is running (`cd ocr-server && npm run start`).  
  - Confirm phone and computer are on the **same Wi‑Fi**.  
  - Try pinging your computer from the phone (e.g. with a network tool app) to confirm the IP is reachable.

- **On Android:**  
  The project has `usesCleartextTraffic: true` in `app.json` so HTTP works. If you still see errors, restart the app or rebuild.

- **Firewall:**  
  Ensure your OS firewall allows incoming connections on port **3080** (or temporarily disable it for testing).

### “Cannot read property 'Base64' of undefined”

- This was fixed by using the new expo-file-system API (`File` and `.base64()`). If you still see it, ensure you’re on the latest project code and have run `npm install` in the app.

### OCR server won’t start: “Port 3080 already in use”

- Another process is using 3080. Either:
  - Stop that process, or  
  - Use a different port, e.g. 3081:
    - In `ocr-server/server.js`, change `const PORT = process.env.PORT || 3080` to `3081`.
    - In `app/config.ts`, use `http://localhost:3081` (or `http://YOUR_IP:3081` on device).

### Camera or photo library permission denied

- The first time you tap **Take Photo** or **Choose from Library**, the system will ask for permission.  
- If you previously denied it: open the device **Settings** → **Receipts** (or Expo Go) → enable **Camera** and **Photos**.

### Expo Go says “Project is incompatible with this version of Expo Go”

- Your Expo Go app is for a different SDK (e.g. 54) than the project. Either:
  - Update the project to match Expo Go (already done for SDK 54), or  
  - Use a simulator and the matching Expo Go / SDK version.

### App shows “Can’t reach the OCR server…” after scanning

- That’s the in-app message when the fetch to the OCR server fails. Follow the steps in the “Network request failed” section above (correct IP, server running, same Wi‑Fi, firewall).

---

## 8. Testing the OCR server without the app

You can check that the server is running and responding:

```bash
# Health check (optional – your server may not have a GET route)
curl -X POST http://localhost:3080/ocr \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"'$(echo -n "test" | base64)'"}'
```

A real test is to send a small base64 image. For a quick check, just ensure the server starts without errors and that from another terminal `curl http://localhost:3080` (if you add a simple GET route) or the POST above doesn’t fail with “connection refused.”

---

## 9. Project layout (where to change things)

| What you want to change           | File or folder              |
|----------------------------------|-----------------------------|
| OCR server URL (localhost vs IP) | `app/config.ts`             |
| App name, icon, splash           | `app.json`                  |
| Home screen (Scan Receipt, etc.) | `app/(tabs)/index.tsx`      |
| History tab                      | `app/(tabs)/history.tsx`    |
| Setting tab                      | `app/(tabs)/setting.tsx`    |
| Bottom tab bar styling           | `app/(tabs)/_layout.tsx`    |
| OCR logic (Tesseract, parsing)   | `ocr-server/server.js`      |
| OCR server port                  | `ocr-server/server.js` (and `app/config.ts`) |

---

## 10. Quick reference

- **App (Expo):** project root → `npm install` then `npx expo start`.  
- **OCR server:** `ocr-server/` → `npm install` then `npm run start` (port 3080).  
- **Config:** `app/config.ts` → `OCR_SERVER_URL` for simulator (localhost) or device (computer IP).  
- **Same Wi‑Fi** required when using Expo Go on a physical device.

If you hit something not covered here (e.g. a new error message), you can add it to this guide under a new “Troubleshooting” item.
