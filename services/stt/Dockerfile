# Build: docker build -t vendua-stt services/stt
# The model stage downloads the compiled int8 model (0.8 GB) from this repo's GitHub Release,
# pinned by sha256 in stt/fetch.py. It falls back to downloading the 2.5 GB fp32 export and
# compiling it here (stt/compile.py) while that release isn't published.
FROM python:3.13-slim-trixie AS model
WORKDIR /src
COPY requirements.txt requirements-dev.txt ./
COPY stt/__init__.py stt/cpus.py stt/fetch.py stt/compile.py stt/
# parakeet-tdt-0.6b-v3 (default) or parakeet-tdt-0.6b-v3-ptbr, the Brazilian Portuguese fine-tune
# (ADR 0037: better on spontaneous speech, worse on read speech)
ARG STT_MODEL=parakeet-tdt-0.6b-v3
# auto = decide from this host's /proc/cpuinfo; 1 when the image will run on CPUs without VNNI
ARG STT_REDUCE_RANGE=auto
# release, or compile to always build from the fp32 export
ARG STT_FROM=release
RUN if [ "$STT_FROM" = release ]; then \
      python -m stt.fetch --compiled /models "$STT_MODEL"; s=$?; [ $s = 3 ] || exit $s; \
    fi; \
    pip install --no-cache-dir -r requirements-dev.txt \
    && python -m stt.fetch /src/export "$STT_MODEL" \
    && python -m stt.compile /src/export /models "$STT_MODEL"

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
