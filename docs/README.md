# EZSplit – Legal pages setup

Use these files to get **Privacy Policy** and **Terms of Service** URLs for App Store Connect and in-app links.

---

## Option A: GitHub Pages (same repo – recommended if repo is already on GitHub)

Use the `docs/` folder in **this** repo so you don’t need a separate repo.

### 1. Push the repo to GitHub

If you haven’t already:

```bash
cd "/Users/bryant/Documents/IT Project"
git add docs/
git commit -m "Add legal pages for hosting"
git push origin main
```

(Use your real repo URL and branch name if different.)

### 2. Enable GitHub Pages

1. On GitHub, open your repository (e.g. `YOUR_USERNAME/IT-Project` or whatever the repo name is).
2. Go to **Settings** → **Pages** (left sidebar).
3. Under **Build and deployment**:
   - **Source**: Deploy from a branch
   - **Branch**: `main` (or your default branch)
   - **Folder**: `/docs`
4. Click **Save**.

### 3. Your URLs

After a minute or two, the site will be live. Replace `YOUR_USERNAME` and `REPO_NAME` with your GitHub username and repo name:

- **Privacy Policy:**  
  `https://YOUR_USERNAME.github.io/REPO_NAME/privacy-policy.html`
- **Terms of Service:**  
  `https://YOUR_USERNAME.github.io/REPO_NAME/terms-of-service.html`
- **Index (optional):**  
  `https://YOUR_USERNAME.github.io/REPO_NAME/`

**Example:** If the repo is `bryant/ezsplit`, then:
- Privacy: `https://bryant.github.io/ezsplit/privacy-policy.html`
- Terms: `https://bryant.github.io/ezsplit/terms-of-service.html`

Use the **Privacy** URL in App Store Connect (required). Add the **Terms** URL where App Store Connect asks for a EULA or Terms URL.

---

## Option B: New repo only for legal pages

Use this if you prefer a separate repo (e.g. `ezsplit-legal`) so the URL is shorter or cleaner.

### 1. Create a new repo on GitHub

1. GitHub → **New repository**.
2. Name it e.g. **ezsplit-legal** (no need to add README or .gitignore).
3. Create the repo.

### 2. Push only the legal files

From your project folder:

```bash
cd "/Users/bryant/Documents/IT Project"

# Clone the new repo into a temp folder
git clone https://github.com/YOUR_USERNAME/ezsplit-legal.git _legal-repo
cd _legal-repo

# Copy the HTML files (and optional index)
cp ../docs/privacy-policy.html .
cp ../docs/terms-of-service.html .
cp ../docs/index.html .

# Push
git add .
git commit -m "Add Privacy Policy and Terms of Service"
git push -u origin main

# Clean up
cd ..
rm -rf _legal-repo
```

(Replace `YOUR_USERNAME/ezsplit-legal` with your repo URL.)

### 3. Enable GitHub Pages

1. In the **ezsplit-legal** repo: **Settings** → **Pages**.
2. **Source**: Deploy from a branch.
3. **Branch**: `main`, **Folder**: `/ (root)`.
4. **Save**.

### 4. Your URLs

- **Privacy:** `https://YOUR_USERNAME.github.io/ezsplit-legal/privacy-policy.html`
- **Terms:** `https://YOUR_USERNAME.github.io/ezsplit-legal/terms-of-service.html`

---

## Option C: Netlify (drag & drop)

1. Go to [app.netlify.com](https://app.netlify.com) and sign in.
2. **Add new site** → **Deploy manually**.
3. Drag the **docs** folder (or a folder containing `privacy-policy.html`, `terms-of-service.html`, and optionally `index.html`) onto the drop zone.
4. Netlify will give you a URL like `https://random-name-123.netlify.app`. Your links:
   - `https://random-name-123.netlify.app/privacy-policy.html`
   - `https://random-name-123.netlify.app/terms-of-service.html`
5. Optionally in **Domain settings** add a custom subdomain like `legal.ezsplit.com`.

---

## Checklist

- [ ] Choose Option A, B, or C and complete the steps.
- [ ] Open the Privacy Policy URL in a browser to confirm it loads.
- [ ] In **App Store Connect** → your app → **App Privacy** (and version info): paste the **Privacy Policy URL**.
- [ ] Where a Terms/EULA URL is requested, paste the **Terms of Service URL**.
- [ ] In-app: Settings already links to `/terms` and `/privacy`; you can optionally link to these hosted URLs from there (current in-app screens use the same content).
