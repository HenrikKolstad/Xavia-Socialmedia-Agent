"""
Creates a clean Instagram Reel video from property images.
Simple fade transitions, consistent white frames, no fancy effects.

Called by the Node.js agent via subprocess.

Usage:
    python3 scripts/create_reel.py --images img1.jpg img2.jpg ... --output reel.mp4 [--music path/to/music.mp3] [--duration 3] [--transition 0.5]
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
import os
from typing import List, Optional


def check_ffmpeg():
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def create_reel(images: List[str], output: str, music: Optional[str] = None,
                duration_per_image: float = 3.0, transition_duration: float = 0.5):
    """
    Clean reel: consistent white-framed images with simple fade transitions.
    1080x1920 (9:16) at 30fps.
    """
    if not images:
        return {"error": "No images provided"}

    n = len(images)
    total_video_duration = n * duration_per_image - (n - 1) * transition_duration

    filter_parts = []

    # Each image: fit 1080x1920 with white padding, subtle slow zoom in (~3%)
    frames = int(duration_per_image * 30)
    for i in range(n):
        filter_parts.append(
            f"[{i}:v]scale=8000:-1,"
            f"zoompan=z='min(zoom+0.0005,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
            f":d={frames}:s=1080x1920:fps=30,"
            f"setsar=1,"
            f"trim=duration={duration_per_image},"
            f"setpts=PTS-STARTPTS"
            f"[v{i}]"
        )

    # Simple fade transitions only — clean and consistent
    if n == 1:
        filter_parts.append("[v0]null[outv]")
    else:
        prev = "v0"
        for i in range(1, n):
            out_label = "outv" if i == n - 1 else f"xf{i-1}"
            offset = i * duration_per_image - i * transition_duration
            filter_parts.append(
                f"[{prev}][v{i}]xfade=transition=fade:duration={transition_duration}:offset={offset:.2f}[{out_label}]"
            )
            prev = out_label

    filter_complex = ";\n".join(filter_parts)

    cmd = ["ffmpeg", "-y"]
    for img in images:
        cmd.extend(["-i", img])

    has_music = music and os.path.exists(music)
    audio_idx = len(images)
    if has_music:
        cmd.extend(["-i", music])
    else:
        cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"])

    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", f"{audio_idx}:a",
    ])

    if has_music:
        fade_out_start = max(total_video_duration - 2.5, 0)
        cmd.extend([
            "-af", f"afade=t=in:st=0:d=1.5,afade=t=out:st={fade_out_start:.2f}:d=2.5,volume=0.35",
        ])
    else:
        cmd.extend(["-shortest"])

    cmd.extend([
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "44100",
        "-t", str(total_video_duration),
        "-movflags", "+faststart",
        output,
    ])

    print(f"[Reel] Creating {total_video_duration:.1f}s reel from {n} images (clean fade)...", file=sys.stderr)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            err_msg = result.stderr[-500:] if result.stderr else "unknown error"
            return {"error": f"ffmpeg failed: {err_msg}"}

        if os.path.exists(output):
            size_mb = os.path.getsize(output) / (1024 * 1024)
            print(f"[Reel] Video created: {output} ({size_mb:.1f}MB, {total_video_duration:.1f}s)", file=sys.stderr)
            return {"success": True, "output": output, "duration": round(total_video_duration, 1), "size_mb": round(size_mb, 1)}
        else:
            return {"error": "Output file not created"}

    except subprocess.TimeoutExpired:
        return {"error": "ffmpeg timed out (>10 min)"}
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Create clean Instagram Reel from property images")
    parser.add_argument("--images", nargs="+", required=True, help="Image file paths")
    parser.add_argument("--output", required=True, help="Output video path")
    parser.add_argument("--music", help="Background music file path")
    parser.add_argument("--duration", type=float, default=3.0, help="Seconds per image (default: 3)")
    parser.add_argument("--transition", type=float, default=0.5, help="Transition duration (default: 0.5)")
    args = parser.parse_args()

    if not check_ffmpeg():
        print(json.dumps({"error": "ffmpeg not installed. Run: sudo apt install ffmpeg"}))
        sys.exit(1)

    result = create_reel(
        images=args.images,
        output=args.output,
        music=args.music,
        duration_per_image=args.duration,
        transition_duration=args.transition,
    )

    print(json.dumps(result))


if __name__ == "__main__":
    main()
