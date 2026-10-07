"""Downloads a pinned Parakeet-TDT-0.6B-v3 fp32 ONNX export, checking every file's sha256.

  python -m stt.fetch <dir> [model]

`parakeet-tdt-0.6b-v3`: NVIDIA's weights (CC-BY-4.0), exported by github.com/istupakov/onnx-asr.
`parakeet-tdt-0.6b-v3-ptbr`: the same model fine-tuned on Brazilian Portuguese podcasts
(TAGARELA) by alexandreacff, exported by alefiury (CC-BY-4.0). Same layout, preprocessor and
vocabulary; only the weights differ.
"""

from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

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


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def main(out_dir: str, model: str = DEFAULT) -> None:
    repo, revision, files = MODELS[model]
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, digest in files.items():
        dst = out / name
        if dst.exists() and sha256(dst) == digest:
            continue
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{name}"
        tmp = dst.with_suffix(dst.suffix + ".part")
        h = hashlib.sha256()
        with urllib.request.urlopen(url, timeout=60) as r, tmp.open("wb") as f:
            while chunk := r.read(1 << 20):
                h.update(chunk)
                f.write(chunk)
        if h.hexdigest() != digest:
            tmp.unlink()
            sys.exit(f"{name}: sha256 {h.hexdigest()} != pinned {digest}")
        tmp.rename(dst)
        print(f"fetched {name}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
