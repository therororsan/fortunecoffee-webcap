-- ─────────────────────────────────────────────────────────────────────────────
-- APPLY IN SUPABASE DASHBOARD → SQL Editor → New query
-- DO NOT apply via Supabase CLI without first checking the project is linked.
--
-- Problem: upsert on farmers table fails with "new row violates row-level
-- security policy" on retake/re-upload because the existing FOR ALL policy
-- (if present) or INSERT-only policy does not explicitly cover UPDATE, and
-- Supabase upsert resolves to an UPDATE when the row already exists.
--
-- Fix: drop any existing policies on farmers, then create explicit separate
-- policies for SELECT, INSERT, and UPDATE for the anon role.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: drop existing policies (names may vary — drop all common variants)
DROP POLICY IF EXISTS "Allow anon read"                    ON farmers;
DROP POLICY IF EXISTS "Allow anon insert"                  ON farmers;
DROP POLICY IF EXISTS "Allow anon update"                  ON farmers;
DROP POLICY IF EXISTS "Allow anon select"                  ON farmers;
DROP POLICY IF EXISTS "Enable all operations for anon"     ON farmers;
DROP POLICY IF EXISTS "Enable read access for all users"   ON farmers;
DROP POLICY IF EXISTS "Enable insert for all users"        ON farmers;
DROP POLICY IF EXISTS "Enable update for all users"        ON farmers;
DROP POLICY IF EXISTS "farmers_anon_select"                ON farmers;
DROP POLICY IF EXISTS "farmers_anon_insert"                ON farmers;
DROP POLICY IF EXISTS "farmers_anon_update"                ON farmers;

-- If you see other policy names in Authentication → Policies for the farmers
-- table, add DROP POLICY IF EXISTS "..." ON farmers; lines above before running.

-- Step 2: ensure RLS is active
ALTER TABLE farmers ENABLE ROW LEVEL SECURITY;

-- Step 3: SELECT — allow anon to look up any row by farmer_id or phone
-- (required by checkExistingFarmer() returning-farmer lookup in app.js)
CREATE POLICY "farmers_anon_select" ON farmers
  FOR SELECT
  TO anon
  USING (true);

-- Step 4: INSERT — allow anon to create a new farmer row
-- (required by syncFarmerConsent() on first consent)
CREATE POLICY "farmers_anon_insert" ON farmers
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Step 5: UPDATE — allow anon to update an existing farmer row
-- (required by syncFarmerConsent() upsert and uploadVideo() selfie_url upsert
--  on retake/re-record; this is the policy that was missing)
CREATE POLICY "farmers_anon_update" ON farmers
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification: after running, check Authentication → Policies → farmers
-- You should see exactly three policies: farmers_anon_select, farmers_anon_insert,
-- farmers_anon_update — one for each operation.
-- ─────────────────────────────────────────────────────────────────────────────
