FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOUND_DATA_DIR=/app/data \
    # Model caches live under /app/caches, readable by the runtime user `app`.
    # DINOv2 (transformers) uses HF_HOME; EasyOCR uses EASYOCR_MODULE_PATH.
    HF_HOME=/app/caches/hf \
    TRANSFORMERS_CACHE=/app/caches/hf \
    EASYOCR_MODULE_PATH=/app/caches/easyocr
WORKDIR /app
COPY requirements.txt .
# Install the CPU-only torch wheel first so no CUDA wheels are pulled, then the
# rest of the runtime deps from requirements.txt (torch is already satisfied).
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
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
