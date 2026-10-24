# Data pipeline

Walking video → labeled, face-blurred hallway frames for the index. Everything it reads and writes lives in `data/`, which is gitignored: frames, transcripts, anchors and the node list never go in this repo.

## Setup (once per laptop)

```bash
uv venv --python 3.11 .venv && .venv\Scripts\activate
uv pip install opencv-python mediapipe numpy
mkdir pipeline\models
curl -L -o pipeline/models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
curl -L -o pipeline/models/yunet.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -L -o pipeline/models/blaze_face_short_range.tflite https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
```

ffmpeg 8+ is required for the whisper filter (`winget install Gyan.FFmpeg`). The script finds the winget install even when it isn't on PATH. On Windows, set `PYTHONIOENCODING=utf-8`.

## Run

```bash
# 1. Frames at 2 fps, 720 px wide, plus a transcript of the spoken callouts (HDR clips are tone-mapped)
python pipeline/extract_frames.py "G:/My Drive/DSX/Videos/IMG_2961.MOV" --out data/frames --srt data/transcripts

# 2. Read data/transcripts/*.srt and write data/anchors.json:
#    {"IMG_2961": [[0, "F1_entry_east", "voice"]],
#     "IMG_4521": [[0, "B1_comm_stair", "voice"], [23, "B1_core_e", "voice"]]}
#    One-spot clips get a single anchor at 0. Walks get one anchor per callout.

# 3. Label, drop blurry and duplicate frames, sort into data/dataset
python pipeline/label_frames.py --frames data/frames --anchors data/anchors.json --nodes data/nodes.txt --out data/dataset

# 4. Blur faces in place before anything leaves the laptop
python pipeline/blur_faces.py data/dataset
```

`label_frames.py` prints the frames kept per spot and lists spots under 20 frames: that's the re-film list. Output folders: `train/<spot>/`, `reject_blurry/`, `reject_duplicate/`, `review_not_in_graph/` (labels that aren't graph nodes yet, such as room numbers), `exclude_restricted/`.

## Filming that labels well

- One short clip per spot (about 15 s, slow 360°), with the spot name said out loud, in words: "Floor two, hall east one".
- For long walks, say each name as you arrive, not as you leave.
- iPhone: 1080p at 30 fps, HDR off, lock exposure. Chest height, 1× lens, phone pointed down the hallway.
- Skip service corridors, security rooms and occupied classrooms. Wait for people to pass.

## Thresholds

- Blur: Laplacian variance under 300 at 96 px wide. Calibrated by eye on Friday's footage: below it is mostly motion blur, floor or blank wall.
- Duplicate: an 8×8 grayscale grid within 4 levels of the previous frame.
- Faces: YuNet at 1× and 2× plus MediaPipe BlazeFace, padded 1.6× and pixelated. Figures only a few pixels tall at 720 px are left as is.
