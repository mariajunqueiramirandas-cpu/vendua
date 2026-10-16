# Build: docker build -t vendua-tts services/tts
# The model stage downloads Kyutai's Portuguese Pocket TTS (360 MB: weights, tokenizer, 25 voices;
# pinned by sha256 in tts/fetch.py) and packs it for the engine (230 MB, int8 where it's safe).
# The engine stage compiles libpocket.so, which picks its AVX2, AVX-512 or AMX kernels at
# startup from the CPU it runs on, so the build host's CPU doesn't matter.
FROM python:3.13-slim-trixie AS model
WORKDIR /src
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY tts/__init__.py tts/config.py tts/fetch.py tts/pack.py tts/weights.py tts/
RUN python -m tts.fetch /src/hf \
    && mkdir /models \
    && python -m tts.pack /src/hf/model.safetensors /src/hf/embeddings /models/pocket.bin \
    && cp /src/hf/tokenizer.json /models/

FROM python:3.13-slim-trixie AS engine
RUN apt-get update && apt-get install -y --no-install-recommends g++ make && rm -rf /var/lib/apt/lists/*
COPY engine /src/engine
RUN make -C /src/engine -j"$(nproc)"

FROM python:3.13-slim-trixie
RUN useradd --system --uid 10001 --no-create-home tts
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY --from=model /models /models
COPY --from=engine /src/engine/build/libpocket.so /app/engine/build/libpocket.so
COPY tts /app/tts
WORKDIR /app
ENV PYTHONUNBUFFERED=1 TTS_MODEL_DIR=/models HOME=/tmp
USER tts
EXPOSE 8793
CMD ["python", "-m", "tts.server"]
