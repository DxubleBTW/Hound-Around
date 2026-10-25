"""Cut 360 (equirectangular) frames into phone-like views so they match what users photograph.

Users send ordinary 1x phone photos, so raw panoramas would embed nothing like the queries. Each 360 frame becomes
N level views around the horizon (default 8, every 45 degrees, 70 degree horizontal field of view, 720x405 like the
phone frames). Crops keep the source video's folder and frame number and add the yaw, e.g.
IMG_0042/IMG_0042_y045_0007.jpg, so the existing anchors.json works unchanged and label_frames.py keeps every crop
of one walk under one video (leave-one-video-out evaluation stays honest).

Usage:
    python pipeline/extract_frames.py "G:/My Drive/DSX/360/IMG_0042.mp4" --width 3840 --out data/frames360 --srt data/transcripts360
    python pipeline/split_360.py --frames data/frames360 --out data/frames360_crops
    python pipeline/label_frames.py --frames data/frames360_crops --anchors data/anchors360.json --nodes data/graph.json --out data/dataset_360
    python pipeline/blur_faces.py data/dataset_360   # blur the crops: faces are distorted in the panorama

Yaw 0 is the centre of the panorama (the camera's front lens). Film with the front lens facing the walking
direction, and keep yourself out of the views you care about (stick above head height, or walk behind it).
"""
import argparse
from pathlib import Path

import cv2
import numpy as np


def view_maps(pano_w, pano_h, yaw_deg, out_w=720, out_h=405, hfov_deg=70.0, pitch_deg=0.0):
    """cv2.remap maps for one pinhole view looking at (yaw, pitch) inside an equirectangular image."""
    f = (out_w / 2) / np.tan(np.radians(hfov_deg) / 2)
    u, v = np.meshgrid(np.arange(out_w) - (out_w - 1) / 2, np.arange(out_h) - (out_h - 1) / 2)
    # Camera ray (x right, y down, z forward), tilted by pitch, then turned by yaw.
    x, y, z = u / f, v / f, np.ones_like(u)
    p = np.radians(pitch_deg)
    y, z = y * np.cos(p) - z * np.sin(p), y * np.sin(p) + z * np.cos(p)
    lon = np.radians(yaw_deg) + np.arctan2(x, z)
    lat = np.arctan2(-y, np.hypot(x, z))
    map_x = ((lon / (2 * np.pi) + 0.5) % 1.0) * pano_w - 0.5
    map_y = np.clip((0.5 - lat / np.pi) * pano_h - 0.5, 0, pano_h - 1)
    return map_x.astype(np.float32), map_y.astype(np.float32)


def split_frame(pano, yaws, maps_cache, **view):
    h, w = pano.shape[:2]
    out = {}
    for yaw in yaws:
        key = (w, h, yaw)
        if key not in maps_cache:
            maps_cache[key] = view_maps(w, h, yaw, **view)
        # BORDER_WRAP stitches the panorama's left and right edges seamlessly.
        out[yaw] = cv2.remap(pano, *maps_cache[key], cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=Path, required=True, help="extract_frames.py output of 360 videos")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--views", type=int, default=8, help="views around the horizon")
    ap.add_argument("--hfov", type=float, default=70.0, help="horizontal field of view, degrees (1x phone ~70)")
    ap.add_argument("--pitch", type=float, default=0.0, help="degrees up (+) or down (-)")
    ap.add_argument("--size", default="720x405", help="crop size WxH, matching the phone frames")
    args = ap.parse_args()

    out_w, out_h = map(int, args.size.lower().split("x"))
    yaws = [round(i * 360 / args.views) for i in range(args.views)]
    maps_cache = {}
    for video_dir in sorted(p for p in args.frames.iterdir() if p.is_dir()):
        files = sorted(video_dir.glob("*.jpg"))
        dest = args.out / video_dir.name
        dest.mkdir(parents=True, exist_ok=True)
        for f in files:
            pano = cv2.imread(str(f))
            if pano.shape[1] != 2 * pano.shape[0]:
                raise SystemExit(f"{f} is {pano.shape[1]}x{pano.shape[0]}, not a 2:1 equirectangular frame")
            if pano.shape[1] < 2000:
                print(f"warning: {f.name} is only {pano.shape[1]} px wide; re-extract with --width 3840")
            frame_no = f.stem.rsplit("_", 1)[1]
            for yaw, crop in split_frame(pano, yaws, maps_cache, out_w=out_w, out_h=out_h,
                                         hfov_deg=args.hfov, pitch_deg=args.pitch).items():
                cv2.imwrite(str(dest / f"{video_dir.name}_y{yaw:03d}_{frame_no}.jpg"), crop,
                            [cv2.IMWRITE_JPEG_QUALITY, 90])
        print(f"{video_dir.name}: {len(files)} panoramas -> {len(files) * len(yaws)} crops")


if __name__ == "__main__":
    main()
