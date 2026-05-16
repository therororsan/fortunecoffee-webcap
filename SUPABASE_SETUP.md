# SUPABASE_SETUP.md — webcap

Step-by-step guide to creating and configuring the Supabase backend for webcap.
Complete these steps once before running the app for the first time.

---

## Step 1 — Create a Supabase account and project

1. Go to [supabase.com](https://supabase.com) and click **Start your project**
2. Sign up with GitHub or email
3. Click **New project**
4. Fill in:
   - **Organization:** create one or use existing
   - **Name:** `farmer-project` (or any name you prefer)
   - **Database password:** generate a strong password and save it securely in `farmer-project/_shared/config/` — never commit it
   - **Region:** choose closest to your farmers (e.g. `eu-west-1` for East Africa)
5. Click **Create new project** — provisioning takes ~2 minutes

---

## Step 2 — Create the storage bucket

1. In your Supabase project, go to **Storage** in the left sidebar
2. Click **New bucket**
3. Set:
   - **Name:** `farmer-videos` (must match exactly)
   - **Public bucket:** ✅ ON — this allows public read access for video links
4. Click **Save**

### Set bucket policy (allow anonymous uploads)

1. In Storage, click on `farmer-videos`
2. Go to **Policies** tab
3. Click **New policy** → **For full customization**
4. Create this policy:

```sql
-- Allow anyone to upload (INSERT) to this bucket
CREATE POLICY "Allow anonymous uploads"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (bucket_id = 'farmer-videos');
```

5. Also add a SELECT policy for public reads:

```sql
-- Allow public read of all files
CREATE POLICY "Allow public read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'farmer-videos');
```

> **Why anon uploads?** Farmers open a unique link — no login. The `anon` role in Supabase represents unauthenticated users. We restrict the risk by validating `farmer_id` format downstream.

---

## Step 3 — Create the database table

1. Go to **Table Editor** in the left sidebar
2. Click **New table**
3. Set **Name:** `farmer_submissions`
4. Turn OFF **Enable Row Level Security (RLS)** for now — we'll enable it in the next step
5. Add these columns (the `id` column is created automatically as UUID primary key):

| Column name | Type | Default | Notes |
|---|---|---|---|
| `id` | `uuid` | `gen_random_uuid()` | Auto-created as primary key |
| `farmer_id` | `text` | — | Not null |
| `country` | `text` | — | Nullable |
| `question_id` | `text` | — | Not null |
| `video_path` | `text` | — | Storage path |
| `video_url` | `text` | — | Public URL |
| `uploaded_at` | `timestamptz` | `now()` | Auto-set |
| `status` | `text` | `'received'` | — |

6. Click **Save**

### Alternatively — run this SQL directly

Go to **SQL Editor** → **New query**, paste and run:

```sql
CREATE TABLE farmer_submissions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id   text        NOT NULL,
  country     text,
  question_id text        NOT NULL,
  video_path  text,
  video_url   text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status      text        NOT NULL DEFAULT 'received'
);
```

---

## Step 4 — Enable Row Level Security (RLS)

RLS controls who can read/write your database table.

1. Go to **Authentication → Policies** or the **Table Editor → farmer_submissions → RLS**
2. Enable RLS on `farmer_submissions`
3. Add this INSERT policy to allow farmers to submit:

```sql
-- Allow anonymous inserts (farmer submissions)
CREATE POLICY "Allow anon insert"
ON farmer_submissions
FOR INSERT
TO anon
WITH CHECK (true);
```

4. Do NOT add a SELECT policy yet — no one should be able to read the full submissions list from the browser. Admin access happens via Supabase dashboard only (Phase 1).

---

## Step 5 — Get your API credentials

1. Go to **Project Settings** (gear icon) → **API**
2. Copy:
   - **Project URL** — looks like `https://abcdefghijklm.supabase.co`
   - **anon / public key** — the long `eyJ...` string under "Project API keys"

3. Open `webcap/app/config.js` (copy from `config.example.js` if you haven't already)
4. Paste your values:

```js
window.SUPABASE_URL      = 'https://abcdefghijklm.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

5. Save `config.js` — it is gitignored and will never be committed

> **Never paste API keys into Claude.ai chat, GitHub issues, or anywhere else.** The anon key is low-risk (it's exposed client-side by design) but still treat it with care.

---

## Step 6 — Verify the setup

### Check storage
1. In Supabase → Storage → `farmer-videos` — bucket should exist and show as Public

### Check table
1. In Supabase → Table Editor → `farmer_submissions` — table should exist with 8 columns

### Check policies
1. In Supabase → Authentication → Policies — should see policies on both `storage.objects` and `farmer_submissions`

### Run a live test
1. Start the local server (see `README.md`)
2. Open `http://localhost:3000/app/?id=test_001`
3. Record and upload a short test video
4. In Supabase → Storage → `farmer-videos` → you should see: `test_001/q1_[timestamp].webm`
5. In Supabase → Table Editor → `farmer_submissions` → you should see one new row with:
   - `farmer_id = test_001`
   - `question_id = q1`
   - `video_url` = a working public link
   - `status = received`
6. Click the `video_url` link — the video should play in your browser

If all 6 checks pass, your Supabase backend is fully operational.

---

## Supabase free tier limits (as of 2025)

| Resource | Free tier limit |
|---|---|
| Storage | 1 GB |
| Database | 500 MB |
| Bandwidth | 5 GB/month |
| API requests | Unlimited |

For 5–10 farmers recording 90-second videos at 2 Mbps: ~135 MB per farmer, well within limits.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Upload fails with 403 | Missing INSERT policy on bucket | Re-check Step 2 policies |
| DB insert fails with RLS error | INSERT policy not applied on table | Re-check Step 4 |
| `config.js` not found error | You haven't created config.js yet | Copy config.example.js → config.js |
| Camera not showing | Browser blocked camera | Check browser permissions; use HTTPS or localhost |
| Video plays back but won't upload | Bucket name mismatch | Confirm bucket is named exactly `farmer-videos` |
