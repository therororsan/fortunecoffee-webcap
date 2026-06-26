#!/usr/bin/env python3
"""
Fill missing farmer IDs, webcap links, and contact links in a team worksheet.

Usage:
  python generate_farmer_links.py --sheet "Team Ethiopia"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote, unquote
from urllib.request import Request, urlopen


BASE_URL = "https://fortunecoffee-webcap.vercel.app/"
EXPECTED_HEADERS = [
    "farmer_name",
    "farm_name",
    "country",
    "phone",
    "contact_app",
    "language",
    "status",
    "notes",
    "farmer_id",
    "webcap_link",
    "contact_link",
]
COUNTRY_ID_CODES = {
    "Ethiopia": "ET",
    "Kenya": "KE",
    "India": "IN",
    "Colombia": "CO",
    "Brazil": "BR",
    "Guatemala": "GT",
    "Honduras": "HN",
    "Indonesia": "ID",
    "Mexico": "MX",
    "Peru": "PE",
    "Rwanda": "RW",
    "Tanzania": "TZ",
    "Uganda": "UG",
    "Vietnam": "VN",
    "Yemen": "YE",
}
COUNTRY_PHONE_CODES = {
    "Ethiopia": "+251",
    "Kenya": "+254",
    "India": "+91",
    "Colombia": "+57",
    "Brazil": "+55",
    "Guatemala": "+502",
    "Honduras": "+504",
    "Indonesia": "+62",
    "Mexico": "+52",
    "Peru": "+51",
    "Rwanda": "+250",
    "Tanzania": "+255",
    "Uganda": "+256",
    "Vietnam": "+84",
    "Yemen": "+967",
}


def load_env(env_path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not env_path.exists():
        return env

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def get_paths() -> tuple[Path, Path]:
    script_dir = Path(__file__).resolve().parent
    config_dir = script_dir.parent / "_shared" / "config"
    return config_dir / ".env", config_dir / "google_service_account.json"


def normalize_phone(local_phone: str, country: str) -> str:
    country_code = COUNTRY_PHONE_CODES.get(country)
    if not country_code:
        raise ValueError(f"Unsupported country for phone code: {country}")

    cleaned = re.sub(r"\s+", "", local_phone or "")
    cleaned = cleaned.lstrip("0")
    if not cleaned:
        raise ValueError("Phone is blank after stripping leading zeroes.")
    return f"{country_code}{cleaned}"


def next_farmer_id(country: str, counters: dict[str, int]) -> str:
    country_id_code = COUNTRY_ID_CODES.get(country)
    if not country_id_code:
        raise ValueError(f"Unsupported country for farmer_id: {country}")

    counters[country_id_code] = counters.get(country_id_code, 0) + 1
    return f"{country_id_code}_{counters[country_id_code]:03d}"


def extract_existing_counters(rows: list[list[str]], header_index: dict[str, int]) -> dict[str, int]:
    counters: dict[str, int] = {}
    farmer_id_col = header_index["farmer_id"]

    for row in rows:
        farmer_id = row[farmer_id_col].strip() if farmer_id_col < len(row) else ""
        match = re.fullmatch(r"([A-Z]{2})_(\d{3})", farmer_id)
        if not match:
            continue
        country_code, number = match.groups()
        counters[country_code] = max(counters.get(country_code, 0), int(number))

    return counters


def build_webcap_link(farmer_id: str, farmer_name: str, country: str, full_phone: str, language: str = "en") -> str:
    params = urlencode(
        {
            "id": farmer_id,
            "name": farmer_name,
            "country": country,
            "phone": full_phone,
            "lang": language,
        }
    )
    return f"{BASE_URL}?{params}"


def build_contact_link(contact_app: str, farmer_name: str, webcap_link: str, full_phone: str) -> str:
    normalized_app = contact_app.strip().lower()
    readable_webcap_link = unquote(webcap_link)
    message = (
        f"Hi {farmer_name}, Fortune Coffee would like to hear your story.\n"
        f"Please tap this link to record a short video: {readable_webcap_link}"
    )
    encoded_message = quote(message, safe="")

    if normalized_app == "whatsapp":
        phone_for_whatsapp = full_phone.replace("+", "")
        return f"https://wa.me/{phone_for_whatsapp}?text={encoded_message}"
    if normalized_app == "telegram":
        return f"https://t.me/+{full_phone.lstrip('+')}"
    if normalized_app == "line":
        return f"https://line.me/R/msg/text/?{encoded_message}"
    if normalized_app == "wechat":
        return "Send manually via WeChat"
    if normalized_app == "sms":
        return f"sms:{full_phone}?body={encoded_message}"
    raise ValueError(f"Unsupported contact_app: {contact_app}")


def col_to_a1(col_index: int) -> str:
    result = []
    value = col_index + 1
    while value:
        value, remainder = divmod(value - 1, 26)
        result.append(chr(65 + remainder))
    return "".join(reversed(result))


def pad_row(row: list[str], width: int) -> list[str]:
    return row + [""] * max(0, width - len(row))


def format_phone_column_as_text(worksheet) -> None:
    worksheet.format("D:D", {"numberFormat": {"type": "TEXT"}})


def initialize_headers_if_needed(worksheet) -> list[str]:
    headers = worksheet.row_values(1)

    if not any(cell.strip() for cell in headers):
        worksheet.update(range_name="A1:K1", values=[EXPECTED_HEADERS])
        format_phone_column_as_text(worksheet)
        return EXPECTED_HEADERS

    return headers


def sync_farmers_to_supabase(
    env: dict[str, str],
    farmer_rows: list[dict[str, str]],
) -> None:
    if not farmer_rows:
        return

    supabase_url = env.get("SUPABASE_URL")
    supabase_anon_key = env.get("SUPABASE_ANON_KEY")
    if not supabase_url or not supabase_anon_key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_ANON_KEY missing from ../_shared/config/.env")

    request_url = f"{supabase_url.rstrip('/')}/rest/v1/farmers?on_conflict=farmer_id"
    request = Request(
        request_url,
        data=json.dumps(farmer_rows).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "apikey": supabase_anon_key,
            "Authorization": f"Bearer {supabase_anon_key}",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
        method="POST",
    )

    try:
        with urlopen(request) as response:
            if response.status not in (200, 201, 204):
                raise RuntimeError(f"Unexpected Supabase status: {response.status}")
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase sync failed: HTTP {exc.code} {error_body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Supabase sync failed: {exc.reason}") from exc


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fill missing farmer IDs, webcap links, and contact links in a worksheet."
    )
    parser.add_argument("--sheet", required=True, help='Worksheet tab name, e.g. "Team Ethiopia"')
    args = parser.parse_args()

    env_path, credentials_path = get_paths()
    env = load_env(env_path)
    spreadsheet_name = env.get("GOOGLE_SHEET_NAME")

    if not spreadsheet_name:
        print("Error: GOOGLE_SHEET_NAME not found in ../_shared/config/.env")
        sys.exit(1)

    if not credentials_path.exists():
        print(f"Error: Credentials file not found: {credentials_path}")
        sys.exit(1)

    try:
        import gspread
    except ImportError:
        print("Missing dependency. Install with:")
        print("  pip install gspread google-auth")
        sys.exit(1)

    try:
        client = gspread.service_account(filename=str(credentials_path))
        spreadsheet = client.open(spreadsheet_name)
        try:
            worksheet = spreadsheet.worksheet(args.sheet)
        except gspread.WorksheetNotFound:
            if args.sheet == spreadsheet_name:
                worksheet = spreadsheet.sheet1
            else:
                raise
    except Exception as exc:
        print(f"Error opening Google Sheet '{spreadsheet_name}' / worksheet '{args.sheet}': {exc}")
        sys.exit(1)

    headers = initialize_headers_if_needed(worksheet)
    if headers != EXPECTED_HEADERS:
        print("Error: Worksheet headers do not match the expected template.")
        print("Expected:")
        print(",".join(EXPECTED_HEADERS))
        print("Found:")
        print(",".join(headers))
        sys.exit(1)
    format_phone_column_as_text(worksheet)

    rows = worksheet.get_all_values()
    if not rows:
        rows = [EXPECTED_HEADERS]

    header_index = {header: index for index, header in enumerate(headers)}
    data_rows = [pad_row(row, len(headers)) for row in rows[1:]]
    counters = extract_existing_counters(data_rows, header_index)

    updates: list[dict[str, list[list[str]]]] = []
    farmers_to_sync: list[dict[str, str]] = []
    processed_count = 0
    farmer_id_count = 0
    webcap_link_count = 0
    contact_link_count = 0
    skipped_inactive_count = 0

    for zero_based_index, row in enumerate(data_rows, start=2):
        status = row[header_index["status"]].strip().lower()
        if status != "active":
            skipped_inactive_count += 1
            continue

        processed_count += 1
        farmer_name = row[header_index["farmer_name"]].strip()
        farm_name = row[header_index["farm_name"]].strip()
        country = row[header_index["country"]].strip()
        phone = row[header_index["phone"]].strip()
        contact_app = row[header_index["contact_app"]].strip()
        language = row[header_index["language"]].strip()
        notes = row[header_index["notes"]].strip()

        if not farmer_name:
            print(f"Warning: Skipping row {zero_based_index} because farmer_name is blank.")
            continue

        full_phone = None
        if not row[header_index["webcap_link"]].strip() or not row[header_index["contact_link"]].strip():
            try:
                full_phone = normalize_phone(phone, country)
            except ValueError as exc:
                print(f"Warning: Skipping row {zero_based_index}: {exc}")
                continue

        farmer_id = row[header_index["farmer_id"]].strip()
        if not farmer_id:
            try:
                farmer_id = next_farmer_id(country, counters)
            except ValueError as exc:
                print(f"Warning: Skipping row {zero_based_index}: {exc}")
                continue

            updates.append(
                {
                    "range": f"{col_to_a1(header_index['farmer_id'])}{zero_based_index}",
                    "values": [[farmer_id]],
                }
            )
            farmer_id_count += 1

        webcap_link = row[header_index["webcap_link"]].strip()
        if not webcap_link:
            webcap_link = build_webcap_link(farmer_id, farmer_name, country, full_phone or "", language)
            updates.append(
                {
                    "range": f"{col_to_a1(header_index['webcap_link'])}{zero_based_index}",
                    "values": [[webcap_link]],
                }
            )
            webcap_link_count += 1

        contact_link = row[header_index["contact_link"]].strip()
        if not contact_link:
            try:
                contact_link = build_contact_link(contact_app, farmer_name, webcap_link, full_phone or "")
            except ValueError as exc:
                print(f"Warning: Skipping contact_link for row {zero_based_index}: {exc}")
                continue

            updates.append(
                {
                    "range": f"{col_to_a1(header_index['contact_link'])}{zero_based_index}",
                    "values": [[contact_link]],
                }
            )
            contact_link_count += 1

        farmers_to_sync.append(
            {
                "farmer_id": farmer_id,
                "team_id": args.sheet,
                "farmer_name": farmer_name,
                "farm_name": farm_name,
                "country": country,
                "phone": full_phone or phone,
                "contact_app": contact_app,
                "language": language,
                "status": row[header_index["status"]].strip(),
                "webcap_link": webcap_link,
                "notes": notes,
            }
        )

    if updates:
        worksheet.batch_update(updates)
    sync_farmers_to_supabase(env, farmers_to_sync)

    print(f"Processed: {processed_count} rows")
    print(f"New farmer_ids generated: {farmer_id_count}")
    print(f"New webcap links generated: {webcap_link_count}")
    print(f"New contact links generated: {contact_link_count}")
    print(f"Skipped (not active): {skipped_inactive_count}")


if __name__ == "__main__":
    main()
