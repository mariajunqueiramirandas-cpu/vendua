# Build: docker build -t vendua-stt services/stt
# The model stage downloads the 2.5 GB fp32 export once (cached layer) and compiles it for the
# building host's CPU (see stt/compile.py); only the compiled 0.8 GB reaches the final image.
FROM python:3.13-slim-trixie AS model
WORKDIR /src
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY stt/__init__.py stt/fetch.py stt/
RUN python -m stt.fetch /src/export
COPY stt/compile.py stt/decoder.py stt/
# auto = decide from this host's /proc/cpuinfo; 1 when the image will run on CPUs without VNNI
ARG STT_REDUCE_RANGE=auto
RUN STT_REDUCE_RANGE=$STT_REDUCE_RANGE python -m stt.compile /src/export /models

FROM python:3.13-slim-trixie
# ffmpeg decodes Ogg/Opus voice notes, in a subprocess so a bad file can't take the server down
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home stt
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY --from=model /models /models
COPY stt /app/stt
WORKDIR /app
# HOME: onnxruntime wants a writable one at import
ENV PYTHONUNBUFFERED=1 STT_MODEL_DIR=/models HOME=/tmp
USER stt
EXPOSE 8792
CMD ["python", "-m", "stt.server"]
