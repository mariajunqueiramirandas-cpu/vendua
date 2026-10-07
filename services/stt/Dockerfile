# Build: docker build -t vendua-stt services/stt
# The model stage downloads the 2.5 GB fp32 export once (cached layer) and compiles it for the
# building host's CPU (see stt/compile.py); only the compiled 0.8 GB reaches the final image.
FROM python:3.13-slim-trixie AS model
WORKDIR /src
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY stt/__init__.py stt/cpus.py stt/fetch.py stt/
# parakeet-tdt-0.6b-v3 (default) or parakeet-tdt-0.6b-v3-ptbr, the Brazilian Portuguese fine-tune
# (ADR 0035: better on spontaneous speech, worse on read speech)
ARG STT_MODEL=parakeet-tdt-0.6b-v3
RUN python -m stt.fetch /src/export $STT_MODEL
COPY stt/compile.py stt/
# auto = decide from this host's /proc/cpuinfo; 1 when the image will run on CPUs without VNNI
ARG STT_REDUCE_RANGE=auto
RUN STT_REDUCE_RANGE=$STT_REDUCE_RANGE python -m stt.compile /src/export /models $STT_MODEL

FROM python:3.13-slim-trixie
# audio is decoded in-process by PyAV, whose wheel bundles the libav libraries it needs
RUN useradd --system --uid 10001 --no-create-home stt
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
