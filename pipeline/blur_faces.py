"""Blur faces in place in every .jpg under a folder. Run this before any frame leaves the filming laptop.

Two detectors, boxes merged: OpenCV YuNet at 1x and 2x (catches small faces far down a hallway) and
MediaPipe Tasks BlazeFace (close faces). Each face gets a padded pixelate + blur box covering hair and ears.

Usage:
    python pipeline/blur_faces.py data/dataset [--log data/dataset/blur_log.csv]
Models live in pipeline/models/ (see pipeline/README.md for the download commands).
"""
import argparse
import csv
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

MODELS = Path(__file__).parent / "models"


def make_detectors():
    yunet = cv2.FaceDetectorYN.create(str(MODELS / "yunet.onnx"), "", (320, 320),
                                      score_threshold=0.55, nms_threshold=0.3, top_k=50)
    blaze = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
        base_options=mpt.BaseOptions(model_asset_path=str(MODELS / "blaze_face_short_range.tflite")),
        min_detection_confidence=0.5))
    return yunet, blaze


def detect(img, yunet, blaze):
    boxes = []
    for scale in (1.0, 2.0):
        im = cv2.resize(img, None, fx=scale, fy=scale) if scale != 1 else img
        h, w = im.shape[:2]
        yunet.setInputSize((w, h))
        _, faces = yunet.detect(im)
        if faces is not None:
            boxes += [tuple(f[:4] / scale) for f in faces]
    res = blaze.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB)))
    boxes += [(d.bounding_box.origin_x, d.bounding_box.origin_y, d.bounding_box.width, d.bounding_box.height)
              for d in res.detections]
    return boxes


def blur(img, boxes):
    H, W = img.shape[:2]
    for x, y, w, h in boxes:
        cx, cy, s = x + w / 2, y + h / 2, max(w, h) * 1.6
        x0, y0 = int(max(0, cx - s / 2)), int(max(0, cy - s / 2))
        x1, y1 = int(min(W, cx + s / 2)), int(min(H, cy + s / 2))
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        roi = img[y0:y1, x0:x1]
        small = cv2.resize(roi, (max(1, (x1 - x0) // 12), max(1, (y1 - y0) // 12)), interpolation=cv2.INTER_LINEAR)
        pixelated = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)
        img[y0:y1, x0:x1] = cv2.GaussianBlur(pixelated, (0, 0), 3)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    ap.add_argument("--log", type=Path)
    args = ap.parse_args()
    log = args.log or args.root / "blur_log.csv"
    yunet, blaze = make_detectors()
    files = sorted(args.root.rglob("*.jpg"))
    n_faces = n_imgs = 0
    with open(log, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "faces"])
        for i, f in enumerate(files):
            img = cv2.imread(str(f))
            boxes = detect(img, yunet, blaze)
            if boxes:
                cv2.imwrite(str(f), blur(img, boxes), [cv2.IMWRITE_JPEG_QUALITY, 90])
                n_faces += len(boxes)
                n_imgs += 1
            w.writerow([f.relative_to(args.root).as_posix(), len(boxes)])
            if i % 500 == 0:
                print(f"{i}/{len(files)}", flush=True)
    print(f"done: {len(files)} frames, {n_imgs} had faces, {n_faces} face boxes blurred")


if __name__ == "__main__":
    main()
