# DancersDeck backend: FastAPI + Demucs + ffmpeg (CPU).
FROM python:3.12-slim

# ffmpeg provides extraction/transcode AND the shared libs torchcodec needs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the CPU PyTorch stack first (matched +cpu builds), then app deps.
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch torchaudio torchcodec \
      --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Bake the Demucs weights into the image so the first separation isn't slow.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"

ENV DANCERSDECK_DATA_DIR=/data
EXPOSE 8008
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8008"]
