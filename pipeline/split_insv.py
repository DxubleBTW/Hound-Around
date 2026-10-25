"""Insta360 .insv (two raw fisheye streams, or the .lrv proxy when the .insv was never finalized) -> phone-like views per frame, plus a callout transcript. No stitching.

Each lens sees a ~200 degree hemisphere. Views are cut straight from each fisheye (equidistant model) at yaws
inside that lens, away from the stitch seam, so Insta360 Studio isn't needed. Output matches split_360.py:
<out>/<name>/<name>_y<yaw>_<frame>.jpg, where yaws 0-135 come from lens 0 and 180-315 from lens 1, so
label_frames.py, blur_faces.py and anchors work unchanged and every view of one video stays one video.

Usage:
    python pipeline/split_insv.py data/raw360 --out data/frames360_crops --srt data/transcripts360
"""
import argparse
import re
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

from extract_frames import FFMPEG, transcribe

LENS_FOV = 200.0          # degrees across the image circle (Insta360 X-series)
YAWS_PER_LENS = (-45, 0, 45)


def fisheye_maps(size, yaw_deg, out_w=720, out_h=405, hfov_deg=70.0, lens_fov=LENS_FOV, pitch_deg=0.0):
    """remap maps for a pinhole view turned yaw degrees from the lens axis, from an equidistant fisheye."""
    f_out = (out_w / 2) / np.tan(np.radians(hfov_deg) / 2)
    u, v = np.meshgrid(np.arange(out_w) - (out_w - 1) / 2, np.arange(out_h) - (out_h - 1) / 2)
    x, y, z = u / f_out, v / f_out, np.ones_like(u)
    p, a = np.radians(pitch_deg), np.radians(yaw_deg)
    y, z = y * np.cos(p) - z * np.sin(p), y * np.sin(p) + z * np.cos(p)
    x, z = x * np.cos(a) + z * np.sin(a), -x * np.sin(a) + z * np.cos(a)
    theta = np.arctan2(np.hypot(x, y), z)          # angle from the lens axis
    phi = np.arctan2(y, x)
    r = theta / np.radians(lens_fov / 2) * (size / 2)
    map_x = size / 2 + r * np.cos(phi) - 0.5
    map_y = size / 2 + r * np.sin(phi) - 0.5
    return map_x.astype(np.float32), map_y.astype(np.float32)


def short_name(path):
    m = re.search(r"_(\d{3})\.(?:insv|lrv)$", path.name, re.IGNORECASE)
    return f"X360_{m.group(1)}" if m else path.stem


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", type=Path, help=".insv files or folders")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--srt", type=Path, required=True)
    ap.add_argument("--fps", type=float, default=2.0)
    args = ap.parse_args()

    videos = []
    for p in args.inputs:
        videos += sorted(p.glob("*.insv")) if p.is_dir() else [p]
    maps = {}
    for video in videos:
        name = short_name(video)
        dest = args.out / name
        dest.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            for lens in (0, 1):
                # A card pulled mid-write leaves a corrupt tail: keep the frames that decode instead of failing.
                if video.suffix.lower() == ".lrv":
                    # Low-res proxy: both lenses side by side in one stream (left half = lens 1).
                    src = ["-map", "0:v:0", "-vf", f"crop=iw/2:ih:{'iw/2' if lens == 0 else 0}:0,fps={args.fps}"]
                else:
                    src = ["-map", f"0:v:{lens}", "-vf", f"fps={args.fps}"]
                done = subprocess.run([FFMPEG, "-v", "error", "-y", "-fflags", "+discardcorrupt", "-err_detect",
                                       "ignore_err", "-i", str(video), *src, "-q:v", "2", f"{tmp}/l{lens}_%04d.jpg"])
                if done.returncode:
                    print(f"warning: {video.name} lens {lens} stopped early (ffmpeg exit {done.returncode})")
            frames = sorted(Path(tmp).glob("l0_*.jpg"))
            for f0 in frames:
                n = f0.stem.split("_")[1]
                for lens in (0, 1):
                    img = cv2.imread(f"{tmp}/l{lens}_{n}.jpg")
                    if img is None:
                        continue
                    for i, yaw in enumerate(YAWS_PER_LENS):
                        key = (img.shape[0], yaw)
                        if key not in maps:
                            maps[key] = fisheye_maps(img.shape[0], yaw)
                        view = cv2.remap(img, *maps[key], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                        tag = (yaw % 360) if lens == 0 else (180 + yaw) % 360
                        cv2.imwrite(str(dest / f"{name}_y{tag:03d}_{n}.jpg"), view, [cv2.IMWRITE_JPEG_QUALITY, 90])
        transcribe(video, args.srt / f"{name}.srt")
        print(f"{name} ({video.name}): {len(frames)} frames -> {len(list(dest.glob('*.jpg')))} views")


if __name__ == "__main__":
    main()
