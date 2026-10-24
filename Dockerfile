FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOUND_DATA_DIR=/app/data \
    HOUND_CORS_ORIGINS=https://www.hound-around.tech,https://hound-around.tech,https://hound-around-theta.vercel.app,http://localhost:5173
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 1000 app \
    && mkdir -p /app/data \
    && chown app:app /app/data

# ---- ML runtime (needs approval of requirements-ml.txt) ----
# Model caches live under /app/.cache so the weights downloaded at build time (as root)
# are found at runtime (as the app user), and cold start never downloads them.
ENV HF_HOME=/app/.cache/huggingface \
    EASYOCR_MODULE_PATH=/app/.cache/easyocr \
    HOUND_ML_FACTORY=ml.backend:create_backend
# OpenCV (pulled in by easyocr) needs glib even in its headless build.
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-ml.txt .
# CPU-only torch first: the PyPI Linux wheels bundle CUDA (~2 GB) the Space can't use.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
        "torch>=2.6,<2.7" "torchvision>=0.21,<0.22" \
    && pip install --no-cache-dir -r requirements-ml.txt
# Bake the DINOv2-small and EasyOCR English weights into the image.
RUN python -c "from transformers import AutoImageProcessor, AutoModel; \
AutoImageProcessor.from_pretrained('facebook/dinov2-small'); AutoModel.from_pretrained('facebook/dinov2-small'); \
import easyocr; easyocr.Reader(['en'], gpu=False)" \
    && chown -R app:app /app/.cache

COPY --chown=app:app api ./api
COPY --chown=app:app ml ./ml
COPY --chown=app:app deploy ./deploy
USER app
EXPOSE 7860
# Fetch private data (if HOUND_DATA_REPO is set), then serve. One worker: corrections live in one in-memory index.
CMD ["sh", "-c", "python deploy/fetch_data.py && exec python -m uvicorn api.main:app --host 0.0.0.0 --port 7860 --workers 1 --no-access-log"]
