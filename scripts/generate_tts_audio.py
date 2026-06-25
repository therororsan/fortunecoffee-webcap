#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
SCRIPTS_JSON_PATH = SCRIPT_DIR / "tts_scripts.json"
OUTPUT_ROOT = REPO_ROOT / "public" / "audio"
SHARED_ENV_PATH = Path(
    r"C:\Users\User\OneDrive\Claude\farmer-project\_shared\config\.env"
)

STATIC_SCREEN_ORDER = ("consent", "selfie", "question_intro", "success")
SCREEN_ORDER = STATIC_SCREEN_ORDER + ("questions",)
LANG_ORDER = ("en", "sw", "am", "si", "ta", "vi", "hi", "es", "fr", "pt")
ELEVENLABS_LANGS = frozenset(("en", "sw", "ta", "vi", "hi", "es", "fr", "pt"))
GOOGLE_LANGS = frozenset(("am", "si"))

ELEVENLABS_MODEL_ID = "eleven_multilingual_v2"
ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128"
VALID_EXISTING_FILE_MIN_BYTES = 30_000
MIN_GENERATED_FILE_BYTES = 5_000

GOOGLE_VOICE_CONFIG = {
    "am": {"language_code": "am-ET", "voice_name": "am-ET-Standard-A"},
    "si": {"language_code": "si-LK", "voice_name": "si-LK-Standard-A"},
}


@dataclass(frozen=True)
class AudioTask:
    screen: str
    lang: str
    text: str
    engine: str
    output_path: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Fortune Coffee TTS audio from tts_scripts.json."
    )
    parser.add_argument(
        "--screens",
        default=",".join(SCREEN_ORDER),
        help="Comma-separated list of screens to generate.",
    )
    parser.add_argument(
        "--langs",
        default=",".join(LANG_ORDER),
        help="Comma-separated list of language codes to generate.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be generated without making API calls.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing valid files instead of skipping them.",
    )
    return parser.parse_args()


def parse_csv_list(raw_value: str, valid_values: tuple[str, ...], label: str) -> list[str]:
    values = [item.strip() for item in raw_value.split(",") if item.strip()]
    if not values:
        raise ValueError(f"No {label} provided.")

    seen: set[str] = set()
    parsed: list[str] = []
    for value in values:
        if value not in valid_values:
            raise ValueError(
                f"Unsupported {label[:-1]} '{value}'. Valid {label}: {', '.join(valid_values)}"
            )
        if value not in seen:
            parsed.append(value)
            seen.add(value)
    return parsed


def load_environment() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return

    if SHARED_ENV_PATH.exists():
        load_dotenv(SHARED_ENV_PATH, override=False)


def validate_translation_block(
    block: object,
    required_langs: tuple[str, ...],
    label: str,
) -> dict[str, str]:
    if not isinstance(block, dict):
        raise ValueError(f"{label} must map to a language object.")

    actual_langs = set(block.keys())
    expected_langs = set(required_langs)
    if actual_langs != expected_langs:
        raise ValueError(
            f"{label} must define exactly these languages: "
            + ", ".join(required_langs)
        )

    translations: dict[str, str] = {}
    for lang in required_langs:
        text = block[lang]
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"{label} language '{lang}' must be a non-empty string.")
        translations[lang] = text
    return translations


def load_scripts() -> dict[str, object]:
    with SCRIPTS_JSON_PATH.open("r", encoding="utf-8") as handle:
        scripts = json.load(handle)

    if not isinstance(scripts, dict):
        raise ValueError("tts_scripts.json must contain a top-level object.")

    expected_screens = set(STATIC_SCREEN_ORDER)
    actual_screens = set(scripts.keys())
    if not expected_screens.issubset(actual_screens):
        raise ValueError(
            "tts_scripts.json screens must be exactly: "
            + ", ".join(STATIC_SCREEN_ORDER)
        )

    for screen in STATIC_SCREEN_ORDER:
        scripts[screen] = validate_translation_block(
            scripts.get(screen),
            LANG_ORDER,
            f"Screen '{screen}'",
        )

    questions = scripts.get("questions")
    if questions is not None:
        if not isinstance(questions, dict):
            raise ValueError("Screen 'questions' must map to a question object.")
        for question_id, translations in questions.items():
            scripts["questions"][question_id] = validate_translation_block(
                translations,
                ("en",),
                f"Question '{question_id}'",
            )

    return scripts


def engine_for_lang(lang: str) -> str:
    if lang in ELEVENLABS_LANGS:
        return "ElevenLabs"
    if lang in GOOGLE_LANGS:
        return "Google Cloud TTS"
    raise ValueError(f"No engine configured for language '{lang}'.")


def build_tasks(
    scripts: dict[str, object],
    screens: list[str],
    langs: list[str],
) -> list[AudioTask]:
    tasks: list[AudioTask] = []
    for screen in screens:
        if screen == "questions":
            questions = scripts.get("questions")
            if not isinstance(questions, dict):
                raise ValueError("Screen 'questions' is missing from tts_scripts.json.")
            for question_id, translations in questions.items():
                if not isinstance(translations, dict):
                    raise ValueError(
                        f"Question '{question_id}' must map to a language object."
                    )
                for lang in langs:
                    text = translations.get(lang)
                    if not isinstance(text, str) or not text.strip():
                        continue
                    tasks.append(
                        AudioTask(
                            screen=screen,
                            lang=lang,
                            text=text,
                            engine=engine_for_lang(lang),
                            output_path=OUTPUT_ROOT / "questions" / f"{question_id}_{lang}.mp3",
                        )
                    )
            continue

        screen_translations = scripts.get(screen)
        if not isinstance(screen_translations, dict):
            raise ValueError(f"Screen '{screen}' is missing from tts_scripts.json.")
        for lang in langs:
            tasks.append(
                AudioTask(
                    screen=screen,
                    lang=lang,
                    text=screen_translations[lang],
                    engine=engine_for_lang(lang),
                    output_path=OUTPUT_ROOT / screen / f"{screen}_{lang}.mp3",
                )
            )
    return tasks


def load_voices(scripts: dict[str, object]) -> dict[str, str]:
    voices = scripts.get("voices")
    if not isinstance(voices, dict):
        raise ValueError("tts_scripts.json must contain a top-level 'voices' object.")

    resolved: dict[str, str] = {}
    for lang, voice_id in voices.items():
        if not isinstance(voice_id, str) or not voice_id.strip():
            raise ValueError(f"Voice '{lang}' must be a non-empty string.")
        resolved[lang] = voice_id

    if "default" not in resolved:
        raise ValueError("tts_scripts.json voices must define 'default'.")

    return resolved


def voice_id_for_lang(voices: dict[str, str], lang: str) -> str:
    return voices.get(lang, voices["default"])


def voice_label_for_task(task: AudioTask, voices: dict[str, str]) -> str:
    if task.engine == "ElevenLabs":
        return voice_id_for_lang(voices, task.lang)
    return GOOGLE_VOICE_CONFIG[task.lang]["voice_name"]


def planned_action(existing_size: int | None, force: bool) -> str:
    if existing_size is None:
        return "generate"
    if existing_size > VALID_EXISTING_FILE_MIN_BYTES:
        return "overwrite" if force else "skip"
    return "regenerate"


def write_audio_stream(audio_stream: object, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    try:
        with temp_path.open("wb") as handle:
            if isinstance(audio_stream, (bytes, bytearray)):
                handle.write(audio_stream)
            else:
                for chunk in audio_stream:
                    if isinstance(chunk, (bytes, bytearray)):
                        handle.write(chunk)
        temp_path.replace(output_path)
    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise


def validate_generated_output(task: AudioTask) -> int:
    if not task.output_path.exists():
        raise RuntimeError(
            f"Generated audio file is missing for screen={task.screen} lang={task.lang} "
            f"path={task.output_path}"
        )

    output_size = task.output_path.stat().st_size
    if output_size < MIN_GENERATED_FILE_BYTES:
        task.output_path.unlink()
        raise RuntimeError(
            f"Rejected tiny audio output for screen={task.screen} lang={task.lang} "
            f"path={task.output_path} size={output_size} bytes"
        )

    return output_size


def synthesize_elevenlabs(task: AudioTask, voices: dict[str, str]) -> None:
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set.")

    from elevenlabs.client import ElevenLabs

    client = ElevenLabs(api_key=api_key)
    audio_stream = client.text_to_speech.convert(
        voice_id=voice_id_for_lang(voices, task.lang),
        model_id=ELEVENLABS_MODEL_ID,
        output_format=ELEVENLABS_OUTPUT_FORMAT,
        text=task.text,
    )
    write_audio_stream(audio_stream, task.output_path)


def synthesize_google(task: AudioTask) -> None:
    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not credentials_path:
        raise RuntimeError("GOOGLE_APPLICATION_CREDENTIALS is not set.")

    credentials_file = Path(credentials_path)
    if not credentials_file.exists():
        raise RuntimeError(
            f"GOOGLE_APPLICATION_CREDENTIALS points to a missing file: {credentials_file}"
        )

    from google.cloud import texttospeech

    voice_config = GOOGLE_VOICE_CONFIG[task.lang]
    client = texttospeech.TextToSpeechClient()
    response = client.synthesize_speech(
        input=texttospeech.SynthesisInput(text=task.text),
        voice=texttospeech.VoiceSelectionParams(
            language_code=voice_config["language_code"],
            name=voice_config["voice_name"],
        ),
        audio_config=texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3
        ),
    )
    write_audio_stream(response.audio_content, task.output_path)


def print_summary(
    tasks: list[AudioTask],
    generated: list[Path],
    skipped: list[Path],
    failures: list[str],
    dry_run: bool,
) -> None:
    print("\nSummary")
    print(f"Requested: {len(tasks)}")
    print(f"{'Would generate' if dry_run else 'Generated'}: {len(generated)}")
    print(f"Skipped existing: {len(skipped)}")
    print(f"{'Would fail' if dry_run else 'Failures'}: {len(failures)}")
    if failures:
        for failure in failures:
            print(f"  - {failure}")


def main() -> int:
    try:
        args = parse_args()
        screens = parse_csv_list(args.screens, SCREEN_ORDER, "screens")
        langs = parse_csv_list(args.langs, LANG_ORDER, "languages")
        load_environment()
        scripts = load_scripts()
        voices = load_voices(scripts)
        tasks = build_tasks(scripts, screens, langs)
    except Exception as exc:
        print(f"Setup failed: {exc}")
        return 1

    generated: list[Path] = []
    skipped: list[Path] = []
    failures: list[str] = []

    print(f"Scripts source: {SCRIPTS_JSON_PATH}")
    print(f"Output root: {OUTPUT_ROOT}")
    voice_summary = ", ".join(
        f"{lang}={voice_id}" for lang, voice_id in sorted(voices.items())
    )
    print(f"ElevenLabs: model={ELEVENLABS_MODEL_ID}, voices={voice_summary}, output={ELEVENLABS_OUTPUT_FORMAT}")
    print(
        "Google Cloud TTS: am=am-ET-Standard-A, si=si-LK-Standard-A, output=MP3"
    )

    for index, task in enumerate(tasks, start=1):
        relative_output = task.output_path.relative_to(REPO_ROOT)
        existing_size = task.output_path.stat().st_size if task.output_path.exists() else None
        action = planned_action(existing_size, args.force)

        if args.dry_run:
            action_suffix = (
                ""
                if existing_size is None
                else f" existing_size={existing_size} bytes"
            )
            print(
                f"[{index}/{len(tasks)}] Dry run {action} {relative_output} "
                f"({task.engine}, voice={voice_label_for_task(task, voices)}){action_suffix}"
            )
            print(f"  screen={task.screen} lang={task.lang} chars={len(task.text)} text={task.text}")
            if action == "skip":
                skipped.append(task.output_path)
            else:
                generated.append(task.output_path)
            continue

        if (
            action == "skip"
        ):
            print(
                f"[{index}/{len(tasks)}] Skip {relative_output} "
                f"({task.engine}) already exists ({existing_size} bytes)"
            )
            skipped.append(task.output_path)
            continue

        if action == "generate":
            action = "Generate"
        else:
            action = f"{action.capitalize()} existing file ({existing_size} bytes) for"
        print(f"[{index}/{len(tasks)}] {action} {relative_output} ({task.engine})")
        try:
            if task.engine == "ElevenLabs":
                synthesize_elevenlabs(task, voices)
            else:
                synthesize_google(task)
            output_size = validate_generated_output(task)
        except Exception as exc:
            failures.append(f"{relative_output}: {exc}")
            print(f"  FAILED: {exc}")
            continue

        generated.append(task.output_path)
        print(f"  OK ({output_size} bytes)")

    print_summary(tasks, generated, skipped, failures, args.dry_run)
    return 1 if failures and not args.dry_run else 0


if __name__ == "__main__":
    sys.exit(main())
