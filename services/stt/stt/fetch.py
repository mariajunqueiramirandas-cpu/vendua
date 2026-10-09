"""Downloads a model, checking every file's sha256.

  python -m stt.fetch --compiled <dir> [model]   what stt.compile makes, from this repo's release
  python -m stt.fetch <dir> [model]              the pinned fp32 ONNX export it is made from
  python -m stt.fetch --stage <compiled> <assets> [model]   (CI) names a model's two compiled
                                                 variants as release assets, checking the pins

`parakeet-tdt-0.6b-v3`: NVIDIA's weights (CC-BY-4.0), exported by github.com/istupakov/onnx-asr.
`parakeet-tdt-0.6b-v3-ptbr`: the same model fine-tuned on Brazilian Portuguese podcasts
(TAGARELA) by alexandreacff, exported by alefiury (CC-BY-4.0). Same layout, preprocessor and
vocabulary; only the weights differ.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

from .cpus import cpu_has_vnni

PREPROCESSOR = "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f"
VOCAB = "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"

MODELS = {
    "parakeet-tdt-0.6b-v3": (
        "istupakov/parakeet-tdt-0.6b-v3-onnx",
        "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce",
        {
            "encoder-model.onnx": "98a74b21b4cc0017c1e7030319a4a96f4a9506e50f0708f3a516d02a77c96bb1",
            "encoder-model.onnx.data": "9a22d372c51455c34f13405da2520baefb7125bd16981397561423ed32d24f36",
            "decoder_joint-model.onnx": "e978ddf6688527182c10fde2eb4b83068421648985ef23f7a86be732be8706c1",
            "nemo128.onnx": PREPROCESSOR,
            "vocab.txt": VOCAB,
        },
    ),
    "parakeet-tdt-0.6b-v3-ptbr": (
        "alefiury/parakeet-tdt-0.6b-v3-ptBR-TAGARELA-onnx",
        "f97e702671c4dc14344da4ef7a3c07ba94b279fc",
        {
            "encoder-model.onnx": "5e6470dc3c6f0bcb5f99dbf3d64285ac52a0e991b3bddcf634e34bbe60d9d6f0",
            "encoder-model.onnx.data": "21bee798dceaaff37a31ef2b56910eaed90b71ee2be143d8bda3b7be3f549dd7",
            "decoder_joint-model.onnx": "7ffb7866c27dbd2d983ec82e2780dbb2669f451d33ea0491ac7a81fce5f84ba9",
            "nemo128.onnx": PREPROCESSOR,
            "vocab.txt": VOCAB,
        },
    ),
}
DEFAULT = "parakeet-tdt-0.6b-v3"

# stt.compile's output for each model, published by .github/workflows/stt-models.yml. Compiling
# is deterministic, so these are the digests compiling the exports above gives on any host, and
# that workflow checks them before it publishes. A compiler change that moves one needs a new tag.
TAG = "stt-models-v1"
RELEASE = f"https://github.com/mariajunqueiramirandas-cpu/vendua/releases/download/{TAG}"
# vnni: reduce_range off, for CPUs with VNNI/AMX; compat: reduce_range on, for CPUs without
COMPILED = {
    (model, variant): {
        "encoder.int8.onnx": encoder,
        "decoder.npz": decoder,
        "manifest.json": manifest,
        "preprocessor.onnx": PREPROCESSOR,
        "vocab.txt": VOCAB,
    }
    for model, variant, encoder, decoder, manifest in (
        (
            "parakeet-tdt-0.6b-v3",
            "vnni",
            "e851c577ef97570f76f591a09c5dce90ff23cd672892fcfeb257978895494185",
            "bc2b043cf276df1797f66b1612fcdcc08cb16a62a13198a354c9c7d91dd0cd0b",
            "f75642e3e5fb632c9336a31fd4185c5569e4b598188f44bd431cd50c254bccdb",
        ),
        (
            "parakeet-tdt-0.6b-v3",
            "compat",
            "581a137e454d26a0b43ead9cf44c34e3a7fb192299d1f23fd15c55f14be498a9",
            "bc2b043cf276df1797f66b1612fcdcc08cb16a62a13198a354c9c7d91dd0cd0b",
            "5619a34a891599b9936e0f1e5f5156adc5f4ae3a898b1874bba17fa77dc36d1a",
        ),
        (
            "parakeet-tdt-0.6b-v3-ptbr",
            "vnni",
            "3dc7fcace0aa3bcf8f19f87f0937beec22b8c24d55bdf3427995d4cb20392375",
            "7356046f8185d31c46d358b73728dc62d2bd7da49ba9eb89fbeb5ed3220707d6",
            "776976a6aab13afaa34b6cab3bc3ae0a92222e70ced759745570c05d110fcabf",
        ),
        (
            "parakeet-tdt-0.6b-v3-ptbr",
            "compat",
            "864d9b049ed6d7105ab98d32637e178bfa486c6e775f93c604a3b54eeab04e17",
            "7356046f8185d31c46d358b73728dc62d2bd7da49ba9eb89fbeb5ed3220707d6",
            "7abbfa5368e7162f958922599640a34b916a25c440246290b35c5b4abe522d19",
        ),
    )
}
NOT_PUBLISHED = 3  # exit status: the release lacks a file, so the image compiles instead


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dst: Path, digest: str) -> None:
    if dst.exists() and sha256(dst) == digest:
        return
    tmp = dst.with_suffix(dst.suffix + ".part")
    h = hashlib.sha256()
    try:
        with urllib.request.urlopen(url, timeout=60) as r, tmp.open("wb") as f:
            while chunk := r.read(1 << 20):
                h.update(chunk)
                f.write(chunk)
    except urllib.error.HTTPError as e:
        tmp.unlink(missing_ok=True)
        if e.code == 404:
            print(f"{url}: not published", file=sys.stderr)
            sys.exit(NOT_PUBLISHED)
        raise
    if h.hexdigest() != digest:
        tmp.unlink()
        sys.exit(f"{dst.name}: sha256 {h.hexdigest()} != pinned {digest}")
    tmp.rename(dst)
    print(f"fetched {dst.name}")


def main(out_dir: str, model: str = DEFAULT) -> None:
    repo, revision, files = MODELS[model]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, digest in files.items():
        download(f"https://huggingface.co/{repo}/resolve/{revision}/{name}", out / name, digest)


def variant() -> str:
    # u8s8 without VNNI saturates int16 intermediates (stt.compile); auto = this host's CPU
    forced = os.environ.get("STT_REDUCE_RANGE", "auto")
    reduce_range = not cpu_has_vnni() if forced == "auto" else forced == "1"
    return "compat" if reduce_range else "vnni"


def compiled(out_dir: str, model: str = DEFAULT) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    v = variant()
    for name, digest in COMPILED[(model, v)].items():
        download(f"{RELEASE}/{model}.{v}.{name}", out / name, digest)


def stage(compiled_dir: str, assets_dir: str, model: str = DEFAULT) -> None:
    """<compiled>/<vnni|compat>/ are stt.compile outputs; each file becomes <model>.<variant>.<name>."""
    assets = Path(assets_dir)
    assets.mkdir(parents=True, exist_ok=True)
    wrong = []
    for v in ("vnni", "compat"):
        pins = dict(COMPILED[(model, v)])
        for f in sorted((Path(compiled_dir) / v).iterdir()):
            got = sha256(f)
            if pins.pop(f.name, None) != got:
                wrong.append(f'{model} {v}: "{f.name}": "{got}",')
            shutil.move(f, assets / f"{model}.{v}.{f.name}")
        wrong += [f"{model} {v}: {name} not compiled" for name in pins]
    if wrong:
        sys.exit("compiled files differ from COMPILED in stt/fetch.py:\n" + "\n".join(wrong))


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--compiled"]:
        compiled(*args[1:3])
    elif args[:1] == ["--stage"]:
        stage(*args[1:4])
    else:
        main(*args[:2])
