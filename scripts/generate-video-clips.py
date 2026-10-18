#!/usr/bin/env python3
"""Short synthetic clips for the public Tesla video-player probe.

No speech, no third-party footage. Each file burns its own label into the
picture so a source-fallback test shows which file actually decoded.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "video" / "clips"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SIZE = "480x270"
RATE = "15"
DUR = "3"


def run(args: list[str]) -> None:
    print("+", " ".join(args[:6]), "...")
    subprocess.run(args, check=True)


def video_src(label: str) -> str:
    safe = label.replace(":", "\\:").replace("'", "")
    return (
        f"testsrc2=size={SIZE}:rate={RATE}:duration={DUR},"
        f"drawtext=fontfile={FONT}:text='{safe}':fontsize=32:fontcolor=white:"
        "box=1:boxcolor=black@0.65:x=12:y=12"
    )


def audio_src() -> str:
    return f"sine=frequency=880:sample_rate=48000:duration={DUR},volume=0.35"


def encode(name: str, label: str, codec_args: list[str]) -> None:
    dest = OUT / name
    run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            video_src(label),
            "-f",
            "lavfi",
            "-i",
            audio_src(),
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-shortest",
            *codec_args,
            str(dest),
        ]
    )


def avc1_codec(path: Path) -> str | None:
    data = path.read_bytes()
    index = data.find(b"avcC")
    if index < 0 or index + 8 > len(data):
        return None
    profile, compat, level = data[index + 5 : index + 8]
    return f"avc1.{profile:02X}{compat:02X}{level:02X}"


def probe(path: Path) -> dict:
    raw = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=codec_name,codec_type,profile,width,height",
            "-of",
            "json",
            str(path),
        ],
        text=True,
    )
    parsed = json.loads(raw)
    streams = parsed.get("streams", [])
    video = next(item for item in streams if item.get("codec_type") == "video")
    audio = next(item for item in streams if item.get("codec_type") == "audio")
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "duration": round(float(parsed["format"]["duration"]), 3),
        "video": video["codec_name"],
        "audio": audio["codec_name"],
        "width": video.get("width"),
        "height": video.get("height"),
        "profile": video.get("profile"),
        "avc1": avc1_codec(path),
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    encode(
        "h264-baseline.mp4",
        "H264 BASE",
        [
            "-c:v",
            "libx264",
            "-profile:v",
            "baseline",
            "-level",
            "3.0",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "2",
        ],
    )
    encode(
        "h264-high.mp4",
        "H264 HIGH",
        [
            "-c:v",
            "libx264",
            "-profile:v",
            "high",
            "-level",
            "3.1",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "2",
        ],
    )
    encode(
        "h264-frag.mp4",
        "H264 MSE",
        [
            "-c:v",
            "libx264",
            "-profile:v",
            "baseline",
            "-level",
            "3.0",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "28",
            "-g",
            "15",
            "-keyint_min",
            "15",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "2",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
        ],
    )
    encode(
        "vp8.webm",
        "VP8",
        ["-c:v", "libvpx", "-crf", "35", "-b:v", "400k", "-c:a", "libvorbis", "-q:a", "4"],
    )
    encode(
        "vp9.webm",
        "VP9",
        [
            "-c:v",
            "libvpx-vp9",
            "-crf",
            "36",
            "-b:v",
            "0",
            "-deadline",
            "realtime",
            "-cpu-used",
            "8",
            "-row-mt",
            "1",
            "-c:a",
            "libopus",
            "-b:a",
            "64k",
        ],
    )
    encode(
        "av1.webm",
        "AV1",
        [
            "-c:v",
            "libsvtav1",
            "-preset",
            "11",
            "-crf",
            "40",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "libopus",
            "-b:a",
            "64k",
        ],
    )
    encode(
        "hevc.mp4",
        "HEVC",
        [
            "-c:v",
            "libx265",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
            "-tag:v",
            "hvc1",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "2",
        ],
    )
    encode(
        "theora.ogv",
        "THEORA",
        ["-c:v", "libtheora", "-q:v", "6", "-c:a", "libvorbis", "-q:a", "4"],
    )
    run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(OUT / "h264-baseline.mp4"),
            "-c",
            "copy",
            "-f",
            "mpegts",
            # .ts is text/vnd.trolltech.linguist in Python's map and ambiguous on static hosts.
            str(OUT / "segment.m2ts"),
        ]
    )
    duration = probe(OUT / "h264-baseline.mp4")["duration"]
    (OUT / "hls.m3u8").write_text(
        "\n".join(
            [
                "#EXTM3U",
                "#EXT-X-VERSION:3",
                "#EXT-X-TARGETDURATION:4",
                "#EXT-X-MEDIA-SEQUENCE:0",
                f"#EXTINF:{duration:.3f},",
                "segment.m2ts",
                "#EXT-X-ENDLIST",
                "",
            ]
        ),
        encoding="utf-8",
    )
    files = [
        "h264-baseline.mp4",
        "h264-high.mp4",
        "h264-frag.mp4",
        "vp8.webm",
        "vp9.webm",
        "av1.webm",
        "hevc.mp4",
        "theora.ogv",
        "segment.m2ts",
    ]
    manifest = {"clips": [probe(OUT / name) for name in files]}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
