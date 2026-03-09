# EZSplit – Step-by-step deployment guide

Follow these steps in order to deploy EZSplit to the App Store (e.g. for a diploma demo).

---

## Step 1: Prerequisites

- [ ] **Apple Developer account** – [developer.apple.com](https://developer.apple.com) → Enroll ($99/year). Needed for App Store and TestFlight.
- [ ] **Expo account** – Sign up at [expo.dev](https://expo.dev) if you haven’t. Your project already has an EAS project ID in `app.json`.
- [ ] **Node.js & EAS CLI** – On your machine:
  ```bash
  npm install -g eas-cli
  eas login
  ```
- [ ] **Assets** – Ensure `assets/EZSplitSplash.png` and `assets/EZSplitLogo.png` exist (build will fail if they’re missing).

---

## Step 2: Deploy the OCR server (Render)

Receipt scanning in the app needs a live OCR server. Your project is set to use `https://ezsplit-ocr-sg.onrender.com`.

1. Go to [render.com](https://render.com) and sign in (or create an account).
2. **New → Blueprint** (or **New → Web Service**).
3. Connect your **GitHub** repo that contains this project.
4. If using the **Blueprint** from the repo:
   - Render will read `render.yaml` or `ocr-server/render.yaml`.
   - Set **Root Directory** to `ocr-server` for the service (if the form asks).
5. If creating a **Web Service** manually:
   - **Build**: Docker; Dockerfile path: `ocr-server/Dockerfile`; Docker context: `ocr-server`.
   - **Service name**: `ezsplit-ocr` (so the URL is `https://ezsplit-ocr-sg.onrender.com`).
   - **Environment**: Add `PORT` = `3080`.
6. Deploy. Wait until the service is **Live**.
7. Open `https://ezsplit-ocr-sg.onrender.com` in a browser. You should see a response or “OK” (not an error).  
   If your service name is different, note the URL and update **Step 5** (EAS build) to use that URL.

8. **Enable accurate extraction (OpenAI Vision):** Without this, the server uses Tesseract-only OCR and details (merchant, items, totals) are often wrong. In Render → your **ezsplit-ocr** service → **Environment** → **Add Environment Variable**:
   - **Key:** `OPENAI_API_KEY`
   - **Value:** your OpenAI API key (starts with `sk-`; get one at [platform.openai.com](https://platform.openai.com/api-keys))
   Save and let the service redeploy. After that, receipt extraction uses GPT-4 Vision and is much more accurate.

(Optional) To lock the API: in Render → Service → Environment, add `OCR_API_KEY` and set a secret. Then add the same value as an EAS secret `EXPO_PUBLIC_OCR_API_KEY` so the app can call the server.

---

## Step 3: Host Privacy Policy and Terms of Service

App Store Connect requires a **Privacy Policy URL**. You already have the content in `docs/`.

**Option A – GitHub Pages**

1. Create a new repo (e.g. `ezsplit-legal`) or use an existing one.
2. Upload (or copy) the contents of the `docs/` folder:
   - `privacy-policy.html`
   - `terms-of-service.html`
3. In the repo: **Settings → Pages**.
4. Under **Source**, choose **main** (or **master**) and **/ (root)** or the folder where the HTML files are.
5. Save. After a minute, the site will be at `https://YOUR_USERNAME.github.io/ezsplit-legal/`.
6. Your URLs:
   - Privacy: `https://YOUR_USERNAME.github.io/ezsplit-legal/privacy-policy.html`
   - Terms: `https://YOUR_USERNAME.github.io/ezsplit-legal/terms-of-service.html`

**Option B – Netlify / Vercel**

1. Sign up at [netlify.com](https://netlify.com) or [vercel.com](https://vercel.com).
2. Create a new site and connect the repo, or drag-and-drop a folder containing only the two HTML files.
3. Use the URLs they give you (e.g. `https://your-site.netlify.app/privacy-policy.html`).

Save both URLs; you’ll add them in App Store Connect (Step 6).

---

## Step 4: Create the app in App Store Connect

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) and sign in with your Apple Developer account.
2. **My Apps → + → New App**.
3. Fill in:
   - **Platform**: iOS.
   - **Name**: EZSplit.
   - **Primary language**: your choice.
   - **Bundle ID**: select or create `com.flairysm.ezsplit` (must match `app.json`).
   - **SKU**: e.g. `ezsplit-1`.
4. Create the app. You’ll add version, description, and URLs in the next steps.

---

## Step 5: Build the app with EAS

Your project already has **production** and **preview** profiles in `eas.json` with `EXPO_PUBLIC_OCR_URL` set to `https://ezsplit-ocr-sg.onrender.com`. If your OCR URL is different, change it in `eas.json` under `build.production.env` or set it as a secret in the EAS dashboard.

1. In the project root:
   ```bash
   cd "/Users/bryant/Documents/IT Project"
   eas build --platform ios --profile production
   eas submit --platform ios
   ```
2. First time:
   - EAS may ask to create the project or link to an existing one; confirm.
   - For **Apple credentials**, choose **Let EAS handle it** (recommended). EAS will create or use a distribution certificate and provisioning profile.
   - When asked about **Push Notifications**, allow EAS to create or use an APNs key so reminders work.
3. Wait for the build to finish on [expo.dev](https://expo.dev) (Builds tab). You’ll get a link to the `.ipa` or a “Build ready” message.

If you use an **OCR API key** on Render, add it as a secret so it’s not in the repo:

```bash
eas secret:create --name EXPO_PUBLIC_OCR_API_KEY --value "your-ocr-api-key" --scope project
```

Then run the build again (or use the same command; EAS injects secrets into the build).

---

## Step 6: Fill in App Store Connect (version, URLs, metadata)

1. In **App Store Connect**, open your app → **App Store** tab (left).
2. Under the **iOS App** version (e.g. 1.0.0):
   - **Screenshots**: Add at least one screenshot per required device size (e.g. iPhone 6.7", 6.5").
   - **Promotional Text** (optional) / **Description**: e.g. “Split receipts with friends. Scan, assign, and settle up.”
   - **Keywords**: e.g. receipt, split, expense, friends.
   - **Support URL**: A page or email (e.g. mailto:your@email.com or your GitHub).
   - **Privacy Policy URL**: Paste the **Privacy** URL from Step 3 (required).
   - **Terms of Service (EULA)** or **License**: Paste the **Terms** URL from Step 3 if your region asks for it.
3. **App Privacy**: Open the **App Privacy** section, declare that you collect **Account** (email, name) and **User Content** (receipt photos/data) for app functionality; no tracking. Add or link the same Privacy Policy URL.
4. **Pricing**: Set **Free** (or your choice).
5. **Build**: You’ll attach the build from Step 5 when you submit (next step).

---

## Step 7: Submit the build to TestFlight / App Store

**Option A – From EAS dashboard**

1. Go to [expo.dev](https://expo.dev) → your project → **Builds**.
2. Open the latest **production** iOS build.
3. Click **Submit to App Store** (or **Submit**). Follow the prompts; sign in with your Apple ID and select the app (e.g. EZSplit, `com.ezsplit.app`). EAS will upload the build to App Store Connect.

**Option B – From App Store Connect**

1. In App Store Connect, go to your app → **TestFlight** (or **App Store**).
2. Under **Build**, click **+** and select the build that appeared after EAS upload (it can take a few minutes).
3. After processing, the build will show under **TestFlight** for internal/external testers, and under **App Store** for the version you’re preparing.

**Submit for review**

1. In **App Store Connect**, open the **App Store** tab and the version (e.g. 1.0.0).
2. Select the build you just added.
3. Answer **Export Compliance**, **Content Rights**, **Advertising**, etc. (for EZSplit: no encryption beyond HTTPS, no ads, etc.).
4. Click **Submit for Review**. After approval, the app will be available on the App Store (or only in TestFlight if you only added testers).

---

## Step 8: After deployment

- **OCR**: Uses `https://ezsplit-ocr-sg.onrender.com` (or the URL you set). Ensure the Render service stays running and the URL is reachable.
- **Faster scanning (aim for 5–10s):** (1) Set `OPENAI_API_KEY` on the **Singapore** Render service so the server uses GPT-4 Vision (much faster than Tesseract). (2) Keep the service warm: on Render free tier, the first request after idle can take **30–60s** (cold start). Use a free cron (e.g. [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com)) to hit `GET https://ezsplit-ocr-sg.onrender.com/health` every 10–14 minutes. (3) The app resizes and compresses images before upload—both help speed.
- **Notifications**: Users enable them in the app (Settings → Notifications). Reminders work if APNs was set up (EAS usually does this when you built with “Let EAS handle it” and allowed push).
- **Updates**: Change version in `app.json` if needed, then run `eas build --platform ios --profile production` again and submit a new build in App Store Connect.

---

## Quick reference

| Step | What |
|------|------|
| 1 | Apple Developer, Expo account, EAS CLI, splash/logo assets |
| 2 | Deploy OCR server to Render → `https://ezsplit-ocr-sg.onrender.com` |
| 3 | Host `docs/privacy-policy.html` and `terms-of-service.html` (e.g. GitHub Pages) |
| 4 | Create app in App Store Connect (Bundle ID: `com.flairysm.ezsplit`) |
| 5 | Run `eas build --platform ios --profile production` |
| 6 | In App Store Connect: add Privacy & Terms URLs, description, screenshots, app privacy |
| 7 | Submit build from EAS or App Store Connect → TestFlight / App Store → Submit for Review |

If a step fails, check the error message (EAS build logs, Render logs, App Store Connect resolution center) and fix that step before continuing.
