#!/usr/bin/env python3
"""Sync repo-authored question text to Supabase, or check for drift.

The webcap repo is the authoring source for active question text. Runtime still
uses the local JSON file; this script is an operator tool for dashboard/data
propagation and drift detection.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_PATH = REPO_ROOT / "public" / "questions" / "questions.json"
DEFAULT_ENV_PATH = REPO_ROOT.parent / "_shared" / "config" / ".env"
REPAIR_NOTE_MARKER = "Pinned question identity repair 2026-07-30"


def load_env(path: Path) -> dict[str, str]:
  values: dict[str, str] = {}
  if not path.exists():
    raise SystemExit(f"Missing env file: {path}")

  for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip().strip('"').strip("'")
  return values


def service_credentials(env: dict[str, str]) -> tuple[str, str]:
  url = env.get("SUPABASE_URL")
  service_key = (
    env.get("SUPABASE_SERVICE_ROLE_KEY")
    or env.get("SUPABASE_SERVICE_KEY")
    or env.get("SUPABASE_SERVICE_ROLE")
  )

  if not url:
    raise SystemExit("Missing SUPABASE_URL in shared env.")
  if not service_key:
    raise SystemExit(
      "Missing service-role key in shared env. --check must not use anon because "
      "anon RLS hides retired questions, including legacy q1."
    )
  return url.rstrip("/"), service_key


def load_source(path: Path) -> list[dict[str, str | None]]:
  data = json.loads(path.read_text(encoding="utf-8"))
  if not isinstance(data, list) or not data:
    raise SystemExit("questions.json must contain a non-empty list.")

  rows: list[dict[str, str | None]] = []
  seen: set[tuple[str, str]] = set()

  for index, question in enumerate(data):
    if not isinstance(question, dict):
      raise SystemExit(f"questions.json entry {index} is not an object.")

    question_id = question.get("question_id")
    audio_key = question.get("audio_key")
    file_slot_key = question.get("file_slot_key")
    text = question.get("text")

    if not isinstance(question_id, str) or not question_id.startswith("q_"):
      raise SystemExit(f"questions.json entry {index} missing immutable question_id.")
    if not isinstance(audio_key, str) or not audio_key:
      raise SystemExit(f"questions.json entry {question_id} missing audio_key.")
    if not isinstance(file_slot_key, str) or not file_slot_key:
      raise SystemExit(f"questions.json entry {question_id} missing file_slot_key.")
    if not isinstance(text, dict) or not text:
      raise SystemExit(f"questions.json entry {question_id} missing text map.")

    for language, question_text in sorted(text.items()):
      if not isinstance(language, str) or not language:
        raise SystemExit(f"Invalid language key for {question_id}.")
      if not isinstance(question_text, str) or not question_text.strip():
        raise SystemExit(f"Missing text for {question_id}/{language}.")

      key = (question_id, language)
      if key in seen:
        raise SystemExit(f"Duplicate source row for {question_id}/{language}.")
      seen.add(key)

      rows.append({
        "question_id": question_id,
        "language": language,
        "question_text": question_text.strip(),
        "retired_at": None,
      })

  return rows


def supabase_request(
  method: str,
  base_url: str,
  service_key: str,
  path: str,
  body: object | None = None,
  extra_headers: dict[str, str] | None = None,
) -> object:
  data = None
  headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "Accept": "application/json",
  }
  if body is not None:
    data = json.dumps(body).encode("utf-8")
    headers["Content-Type"] = "application/json"
  if extra_headers:
    headers.update(extra_headers)

  request = urllib.request.Request(
    f"{base_url}{path}",
    data=data,
    headers=headers,
    method=method,
  )

  try:
    with urllib.request.urlopen(request, timeout=30) as response:
      payload = response.read().decode("utf-8")
  except urllib.error.HTTPError as error:
    detail = error.read().decode("utf-8", errors="replace")
    raise SystemExit(f"Supabase {method} failed with HTTP {error.code}: {detail}") from error
  except urllib.error.URLError as error:
    raise SystemExit(f"Supabase {method} failed: {error}") from error

  return json.loads(payload) if payload else None


def fetch_questions(base_url: str, service_key: str) -> list[dict[str, object]]:
  query = urllib.parse.urlencode({
    "select": "question_id,language,question_text,retired_at,notes",
  })
  rows = supabase_request(
    "GET",
    base_url,
    service_key,
    f"/rest/v1/questions?{query}",
  )
  if not isinstance(rows, list):
    raise SystemExit("Unexpected Supabase questions response.")
  return rows


def source_key(row: dict[str, object]) -> tuple[str, str]:
  return (str(row["question_id"]), str(row["language"]))


def find_drift(
  source_rows: list[dict[str, str | None]],
  db_rows: list[dict[str, object]],
) -> list[str]:
  drift: list[str] = []
  source_by_key = {source_key(row): row for row in source_rows}
  db_by_key = {source_key(row): row for row in db_rows}

  for key, source_row in sorted(source_by_key.items()):
    db_row = db_by_key.get(key)
    label = f"{key[0]}/{key[1]}"
    if not db_row:
      drift.append(f"missing active question row: {label}")
      continue
    if db_row.get("retired_at") is not None:
      drift.append(f"source question is retired in Supabase: {label}")
    if db_row.get("question_text") != source_row["question_text"]:
      drift.append(f"text mismatch: {label}")

  for key, db_row in sorted(db_by_key.items()):
    if db_row.get("retired_at") is None and key not in source_by_key:
      drift.append(f"unexpected active Supabase question row not in repo source: {key[0]}/{key[1]}")

  q1_rows = [row for row in db_rows if row.get("question_id") == "q1"]
  if not q1_rows:
    drift.append("missing retired legacy q1 evidence row")
  for row in q1_rows:
    language = row.get("language") or "(null)"
    if row.get("retired_at") is None:
      drift.append(f"legacy q1 row is not retired: q1/{language}")
    notes = str(row.get("notes") or "")
    if REPAIR_NOTE_MARKER not in notes:
      drift.append(f"legacy q1 row missing repair note marker: q1/{language}")

  return drift


def planned_upserts(
  source_rows: list[dict[str, str | None]],
  db_rows: list[dict[str, object]],
) -> list[dict[str, str | None]]:
  db_by_key = {source_key(row): row for row in db_rows}
  changes: list[dict[str, str | None]] = []
  for source_row in source_rows:
    db_row = db_by_key.get(source_key(source_row))
    if (
      not db_row
      or db_row.get("retired_at") is not None
      or db_row.get("question_text") != source_row["question_text"]
    ):
      changes.append(source_row)
  return changes


def print_drift(drift: list[str]) -> None:
  if not drift:
    print("No question drift detected.")
    return
  print("Question drift detected:")
  for item in drift:
    print(f"- {item}")


def upsert_rows(
  base_url: str,
  service_key: str,
  rows: list[dict[str, str | None]],
) -> None:
  if not rows:
    print("No active question rows need upsert.")
    return

  query = urllib.parse.urlencode({"on_conflict": "question_id,language"})
  supabase_request(
    "POST",
    base_url,
    service_key,
    f"/rest/v1/questions?{query}",
    body=rows,
    extra_headers={"Prefer": "resolution=merge-duplicates"},
  )
  print(f"Upserted {len(rows)} active question row(s).")


def main() -> int:
  parser = argparse.ArgumentParser(
    description="Check or propagate webcap question text to Supabase.",
  )
  mode = parser.add_mutually_exclusive_group(required=True)
  mode.add_argument("--check", action="store_true", help="fail non-zero if Supabase differs from repo source")
  mode.add_argument("--dry-run", action="store_true", help="print planned active-row upserts without writing")
  mode.add_argument("--apply", action="store_true", help="write active repo rows to Supabase")
  mode.add_argument("--validate-source", action="store_true", help="validate local questions.json without Supabase")
  parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE_PATH)
  parser.add_argument("--env", type=Path, default=DEFAULT_ENV_PATH)
  args = parser.parse_args()

  source_rows = load_source(args.source)
  print(f"Loaded {len(source_rows)} active question row(s) from {args.source}.")

  if args.validate_source:
    return 0

  env = load_env(args.env)
  base_url, service_key = service_credentials(env)
  db_rows = fetch_questions(base_url, service_key)
  drift = find_drift(source_rows, db_rows)

  if args.check:
    print_drift(drift)
    return 1 if drift else 0

  changes = planned_upserts(source_rows, db_rows)

  if args.dry_run:
    print_drift(drift)
    if changes:
      print("Active question rows that would be upserted:")
      for row in changes:
        print(f"- {row['question_id']}/{row['language']}")
    else:
      print("No active question rows would be upserted.")
    return 0

  non_upsert_drift = [
    item for item in drift
    if item.startswith("unexpected active")
    or item.startswith("legacy q1")
    or item.startswith("missing retired legacy")
  ]
  if non_upsert_drift:
    print_drift(non_upsert_drift)
    print("Refusing --apply until non-upsert drift is resolved manually.")
    return 1

  upsert_rows(base_url, service_key, changes)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
