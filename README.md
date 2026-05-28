# webcap — Farmer Video Capture PWA

A mobile-optimized Progressive Web App that lets farmers record a short video response to a question and upload it directly to Supabase cloud storage. No app installation required — works in any mobile browser via a unique link.

---

## What it does

1. Farmer opens a unique link: `https://[domain]/?id=ke_042`
2. App reads their `farmer_id` from the URL
3. Farmer sees a question and a live camera preview
4. Farmer records a video response (max 90 seconds)
5. Farmer reviews the video, then taps **Upload**
6. Video uploads to Supabase storage; a record is written to `farmer_submissions` table
7. Farmer sees a confirmation screen

---

## Folder structure

```
webcap/
├── index.html
├── app.js
├── style.css
├── style.css
├── config.example.js       ← reference template (not used in production)
├── api/
│   └── config.js           ← Vercel serverless function (returns Supabase config from env vars)
├── questions/
│   └── questions.json      ← question bank
└── audio/                  ← audio files for consent and questions
    ├── consent/
    └── questions/
```

---

## Environment variables

**Production (Vercel):**
Supabase configuration comes from environment variables set in the Vercel dashboard. The app fetches config from the `/api/config` serverless function at startup.

Set these in Vercel → Settings → Environment Variables:
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_ANON_KEY` — your Supabase anon key (public, safe for browser)

See `SUPABASE_SETUP.md` for how to get these values.

**Local development:**
Create a `config.js` file at the root (copy from `config.example.js`). This file is gitignored and only for local testing.

---

## Running locally

### Option A — npx serve (recommended)

```bash
cd webcap
npx serve .
```

Then open: `http://localhost:3000/?id=test_001`

### Option B — Python

```bash
cd webcap
python -m http.server 3000
```

Then open: `http://localhost:3000/?id=test_001`

**Note:** For local testing with `/api/config`, you'll need:
1. Create a `config.js` file at root with your Supabase credentials (see `config.example.js`)
2. Or run a local serverless function emulator (e.g., `wrangler` for Vercel Functions)

---

## Testing checklist

Test at: `http://localhost:3000/?id=test_001`

- [ ] Page loads without errors in browser console
- [ ] Camera permission prompt appears
- [ ] Live camera preview shows in portrait orientation
- [ ] Question text is displayed clearly
- [ ] Recording starts on button tap
- [ ] Countdown timer counts down from 90
- [ ] Recording stops at 90 seconds automatically
- [ ] Stop button ends recording early
- [ ] Review screen shows playback + file size estimate
- [ ] Re-record returns to ready state
- [ ] Upload button shows progress bar
- [ ] Success screen appears after upload
- [ ] Video appears in Supabase storage under `farmer-videos/test_001/`
- [ ] Row appears in `farmer_submissions` table with correct `farmer_id`, `question_id`, `video_url`

---

## Video format

| Setting | Value |
|---|---|
| Target resolution | 720p portrait (720×1280) |
| Preferred codec | MP4/H.264 (iOS) or WebM/VP9 (Android/Chrome) |
| Max duration | 90 seconds |
| Bitrate cap | 2 Mbps |
| Max file size | ~50 MB for 90s |

> **Note on format:** iOS Safari records in MP4. Android Chrome and most desktop browsers record in WebM. Both formats upload correctly to Supabase. The downstream `videowork` pipeline uses FFmpeg to standardize to MP4 for all videos.

---

## Farmer link system

Each farmer gets a unique URL with their `farmer_id` as a query parameter:

```
https://[your-domain]/?id=ke_042
```

- `farmer_id` is set in `farmer-master.csv` at `farmer-project/_shared/`
- The app reads `?id=` on load and uses it for all Supabase records
- If no `?id=` is present in production, the app shows a friendly error
- During development, `test_001` is used as a fallback (see comment in `app.js`)

---

## Updating farmer-master.csv (Phase 1 — manual)

After each successful test upload:

1. Open `C:\Users\User\OneDrive\Claude\farmer-project\_shared\farmer-master.csv`
2. Find or add the row for the `farmer_id`
3. Fill in: `video_raw_path`, `video_public_link`, `date_recorded`, `status=received`

**Phase 2 note:** This will be automated by a post-upload webhook or script. Flagged for `videowork` phase.

---

## Git

Repository: `webcap` (private GitHub repo)
Branch strategy:
- `main` — stable, tested builds only
- `webcap-dev` — active development

```bash
# First time setup
git init
git checkout -b webcap-dev
git add .
git commit -m "feat(webcap): initial scaffold — farmer video capture PWA"
git remote add origin git@github.com:YOUR_USERNAME/webcap.git
git push -u origin webcap-dev
```

---

## Phase 2 — deferred features

- Audio prompts (TTS or pre-recorded)
- Multi-question flow
- Admin dashboard
- Automated `farmer-master.csv` updates
- Offline support / service worker
- Custom domain and deployment
