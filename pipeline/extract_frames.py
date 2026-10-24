"""Video -> frames at 2 fps (720 px wide) + a whisper transcript of the spoken spot callouts.

iPhone HDR clips (HLG, color_transfer arib-std-b67) are tone-mapped to SDR, otherwise frames come out washed out.

Usage:
    python pipeline/extract_frames.py <video_or_folder> [<video> ...] --out data/frames --srt data/transcripts
Needs ffmpeg 8+ on PATH (whisper filter) and the whisper model at pipeline/models/ggml-base.en.bin.
"""
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

MODEL = Path(__file__).parent / "models" / "ggml-base.en.bin"


def find_tool(name):
    """ffmpeg/ffprobe from PATH, else from a winget install (Gyan.FFmpeg doesn't always add itself to PATH)."""
    found = shutil.which(name)
    if found:
        return found
    winget = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    hits = sorted(winget.glob(f"Gyan.FFmpeg*/ffmpeg-*/bin/{name}.exe"))
    if hits:
        return str(hits[-1])
    raise SystemExit(f"{name} not found: install ffmpeg 8+ (winget install Gyan.FFmpeg) or add it to PATH")


FFMPEG, FFPROBE = find_tool("ffmpeg"), find_tool("ffprobe")
VIDEO_EXT = {".mov", ".mp4", ".m4v"}
TONEMAP = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
           "tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p")


def probe(video):
    out = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=color_transfer:format=duration", "-of", "json", str(video)],
                         capture_output=True, text=True, check=True).stdout
    info = json.loads(out)
    stream = (info.get("streams") or [{}])[0]
    return stream.get("color_transfer", ""), float(info["format"]["duration"])


def extract(video, frames_root, srt_root):
    name = video.stem
    transfer, duration = probe(video)
    vf = "fps=2,scale=720:-2" + ("," + TONEMAP if transfer == "arib-std-b67" else "")
    out_dir = frames_root / name
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(video), "-vf", vf, "-q:v", "3",
                    str(out_dir / f"{name}_%04d.jpg")], check=True)

    srt_root.mkdir(parents=True, exist_ok=True)
    # The whisper filter can't take Windows drive paths in its options, so run it from the model's folder
    srt_rel = os.path.relpath(srt_root / f"{name}.srt", MODEL.parent).replace("\\", "/")
    subprocess.run([FFMPEG, "-v", "error", "-i", str(video.resolve()), "-vn", "-af",
                    f"aresample=16000,whisper=model={MODEL.name}:language=en:queue=3:destination={srt_rel}:format=srt",
                    "-f", "null", "-"], check=True, cwd=MODEL.parent)
    frames = len(list(out_dir.glob("*.jpg")))
    print(f"{name}: {duration:.0f}s, {'HDR tone-mapped, ' if vf.endswith('yuv420p') else ''}{frames} frames")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("data/frames"))
    ap.add_argument("--srt", type=Path, default=Path("data/transcripts"))
    args = ap.parse_args()
    videos = []
    for p in args.inputs:
        videos += sorted(v for v in p.iterdir() if v.suffix.lower() in VIDEO_EXT) if p.is_dir() else [p]
    for v in videos:
        extract(v, args.out.resolve(), args.srt.resolve())


if __name__ == "__main__":
    main()
