#!/usr/bin/env python3
"""Add fixed silence to verified sentence-boundary pauses in consent clips.

This one-off helper intentionally uses ffmpeg's silencedetect output rather
than regenerating speech.  The index map records the five sentence-boundary
silences confirmed for the current consent clips; it excludes leading,
trailing, and within-sentence comma pauses.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
CONSENT_DIR = REPO_ROOT / "public" / "audio" / "consent"
SCRIPTS_PATH = REPO_ROOT / "scripts" / "tts_scripts.json"
LANGS = ("en", "sw", "am", "si", "ta", "vi", "hi", "es", "fr", "pt", "fil")
INSERT_SECONDS = 0.1

# Raw silence-event indexes from silencedetect=noise=-40dB:d=0.2.  Each list
# contains only the five silences that occur between the six consent sentences.
BOUNDARY_INDEXES = {
    "en": (0, 1, 2, 3, 4),
    "sw": (0, 1, 3, 4, 6),
    "am": (0, 1, 2, 3, 5),
    "si": (0, 1, 2, 3, 4),
    "ta": (0, 1, 2, 4, 5),
    "vi": (0, 1, 3, 4, 6),
    "hi": (0, 1, 3, 4, 6),
    "es": (0, 1, 2, 3, 5),
    "fr": (0, 1, 2, 3, 5),
    "pt": (0, 1, 2, 3, 5),
    "fil": (0, 1, 2, 3, 5),
}


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, check=True, capture_output=True, text=True)


def expected_breaks(lang: str) -> int:
    scripts = json.loads(SCRIPTS_PATH.read_text(encoding="utf-8"))
    return scripts["consent"][lang].count('<break time="0.3s" />')


def detect_silences(path: Path) -> list[tuple[float, float]]:
    result = run(
        "ffmpeg", "-hide_banner", "-i", str(path),
        "-af", "silencedetect=noise=-40dB:d=0.2", "-f", "null", "-",
    )
    starts: list[float] = []
    silences: list[tuple[float, float]] = []
    for line in result.stderr.splitlines():
        start_match = re.search(r"silence_start: ([0-9.]+)", line)
        if start_match:
            starts.append(float(start_match.group(1)))
            continue
        end_match = re.search(r"silence_end: ([0-9.]+)", line)
        if end_match and starts:
            silences.append((starts.pop(0), float(end_match.group(1))))
    return silences


def audio_properties(path: Path) -> tuple[int, int, str]:
    result = run(
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels,bit_rate",
        "-of", "json", str(path),
    )
    stream = json.loads(result.stdout)["streams"][0]
    return int(stream["sample_rate"]), int(stream["channels"]), str(stream["bit_rate"])


def duration(path: Path) -> float:
    return float(run(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ).stdout.strip())


def pad_file(path: Path, pauses: list[tuple[float, float]]) -> None:
    sample_rate, channels, bit_rate = audio_properties(path)
    channel_layout = "mono" if channels == 1 else "stereo"
    midpoints = [(start + end) / 2 for start, end in pauses]
    parts: list[str] = []
    labels: list[str] = []
    previous = 0.0
    for index, midpoint in enumerate(midpoints):
        audio_label = f"a{index}"
        silence_label = f"s{index}"
        parts.append(
            f"[0:a]atrim=start={previous:.6f}:end={midpoint:.6f},asetpts=PTS-STARTPTS[{audio_label}]"
        )
        parts.append(f"anullsrc=r={sample_rate}:cl={channel_layout}:d={INSERT_SECONDS}[{silence_label}]")
        labels.extend((f"[{audio_label}]", f"[{silence_label}]"))
        previous = midpoint
    audio_label = f"a{len(midpoints)}"
    parts.append(f"[0:a]atrim=start={previous:.6f},asetpts=PTS-STARTPTS[{audio_label}]")
    labels.append(f"[{audio_label}]")
    parts.append(f"{''.join(labels)}concat=n={len(labels)}:v=0:a=1[out]")
    temporary = path.with_suffix(".padded.mp3")
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-y", "-i", str(path),
            "-filter_complex", ";".join(parts), "-map", "[out]",
            "-ar", str(sample_rate), "-ac", str(channels),
            "-c:a", "libmp3lame", "-b:a", bit_rate,
            str(temporary),
        ],
        check=True,
    )
    temporary.replace(path)


def main() -> int:
    results: list[str] = []
    for lang in LANGS:
        path = CONSENT_DIR / f"consent_{lang}.mp3"
        expected = expected_breaks(lang)
        silences = detect_silences(path)
        indexes = BOUNDARY_INDEXES[lang]
        if expected != len(indexes) or max(indexes) >= len(silences):
            results.append(f"{lang}\tSKIPPED\t{len(indexes)}/{expected}")
            continue
        selected = [silences[index] for index in indexes]
        old_duration = duration(path)
        pad_file(path, selected)
        new_duration = duration(path)
        results.append(f"{lang}\t{len(selected)}/{expected}\t{old_duration:.3f}s -> {new_duration:.3f}s")
    print("\n".join(results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
