FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOUND_DATA_DIR=/app/data \
    # Model caches live under /app/caches, readable by the runtime user `app`.
    # DINOv2 (transformers) uses HF_HOME; EasyOCR uses EASYOCR_MODULE_PATH.
    HF_HOME=/app/caches/hf \
    TRANSFORMERS_CACHE=/app/caches/hf \
    EASYOCR_MODULE_PATH=/app/caches/easyocr \
    # Turn on real recognition and allow the production frontend. Defaults only:
    # Space variables with the same names override these at runtime.
    HOUND_ML_FACTORY=ml.backend:create_backend \
    HOUND_CORS_ORIGINS=https://www.hound-around.tech,https://hound-around.tech,https://hound-around-theta.vercel.app,http://localhost:5173
WORKDIR /app
COPY requirements.txt .
# Install CPU-only torch AND torchvision first so no CUDA wheels are pulled, then the
# rest of the runtime deps from requirements.txt (both already satisfied). torchvision
# must come from the CPU index too: easyocr needs it, and a PyPI torchvision whose torch
# pin doesn't match would make pip swap in the ~2 GB CUDA torch.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 1000 app \
    && mkdir -p /app/data /app/caches/hf /app/caches/easyocr \
    && chown -R app:app /app/data /app/caches
# Code needed at build time to pre-download models (ml/ imports the embedder).
COPY --chown=app:app api ./api
COPY --chown=app:app ml ./ml
COPY --chown=app:app scripts ./scripts
# Pre-download model weights at BUILD time (as `app`, into caches it can read)
# so cold start does not download them (design.md §6).
USER app
RUN python -c "from transformers import AutoModel, AutoImageProcessor; AutoImageProcessor.from_pretrained('facebook/dinov2-small'); AutoModel.from_pretrained('facebook/dinov2-small')" \
    && python -c "import easyocr; easyocr.Reader(['en'], gpu=False)"
EXPOSE 7860
# start.sh pulls private data (if HOUND_DATA_REPO/HF_TOKEN are set) then execs
# uvicorn with --proxy-headers for the HF proxy rate-limit fix (design.md §7).
CMD ["bash", "scripts/start.sh"]
