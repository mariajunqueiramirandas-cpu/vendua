"""Turns the pinned Parakeet-TDT-0.6B-v3 ONNX export into what the engine loads.

  python -m stt.compile <src dir with the fp32 export> <out dir> [model]

- encoder.int8.onnx: the fp32 encoder with every 1x1 Conv1d rewritten as a MatMul, then
  dynamically quantized (MatMul only, per-channel, signed int8 weights). The community int8
  export quantizes those convs as ConvInteger with uint8 weights, which ORT runs through
  im2col plus an int32->float Cast: half the encoder time on x86. Signed weights let MLAS use
  its u8s8 VNNI/AMX kernels.
- decoder.npz: the prediction network and joint weights, laid out for stt.decoder.
- vocab.txt, preprocessor.onnx: copied through.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper

from .fetch import DEFAULT, variant

# raw min-word entropy confidence that maps to 0.7 (Core's confirm gate), per model: the base
# model's worst 15% on FLEURS pt-BR; the pt-BR fine-tune's threshold flags the same share of
# a 200-clip FLEURS + CORAA mix as the base one does
GATE_RAW = {"parakeet-tdt-0.6b-v3": 0.0057, "parakeet-tdt-0.6b-v3-ptbr": 0.00285}

def rewrite_pointwise_convs(model: onnx.ModelProto) -> int:
    """Conv1d(kernel 1, group 1) on [B, C, T] -> Transpose, MatMul, Transpose.

    ORT's transpose optimizer cancels the Transposes against the ones the Conformer conv
    module already has around these convs."""
    g = model.graph
    inits = {t.name: t for t in g.initializer}
    nodes: list[onnx.NodeProto] = []
    count = 0
    for n in g.node:
        attrs = {a.name: helper.get_attribute_value(a) for a in n.attribute}
        w = inits.get(n.input[1]) if n.op_type == "Conv" and len(n.input) > 1 else None
        if (
            w is None
            or len(w.dims) != 3
            or w.dims[2] != 1
            or attrs.get("group", 1) != 1
            or any(s != 1 for s in attrs.get("strides", [1]))
            or any(p != 0 for p in attrs.get("pads", [0, 0]))
            or any(d != 1 for d in attrs.get("dilations", [1]))
        ):
            nodes.append(n)
            continue
        wt = numpy_helper.to_array(w)[:, :, 0].T.copy()  # [Cin, Cout]
        wname = f"{n.name}/matmul_weight"
        g.initializer.append(numpy_helper.from_array(wt, wname))
        x, y = n.input[0], n.output[0]
        nodes.append(helper.make_node("Transpose", [x], [f"{n.name}/btc"], perm=[0, 2, 1]))
        mm_out = f"{n.name}/mm"
        nodes.append(helper.make_node("MatMul", [f"{n.name}/btc", wname], [mm_out], name=f"{n.name}/MatMul"))
        if len(n.input) > 2 and n.input[2]:
            nodes.append(helper.make_node("Add", [mm_out, n.input[2]], [f"{n.name}/biased"]))
            mm_out = f"{n.name}/biased"
        nodes.append(helper.make_node("Transpose", [mm_out], [y], perm=[0, 2, 1]))
        count += 1
    del g.node[:]
    g.node.extend(nodes)
    used = {i for n in g.node for i in n.input}
    keep = [t for t in g.initializer if t.name in used]
    del g.initializer[:]
    g.initializer.extend(keep)
    return count


def compile_encoder(src: Path, dst: Path, reduce_range: bool) -> int:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    model = onnx.load(str(src))
    rewritten = rewrite_pointwise_convs(model)
    with tempfile.TemporaryDirectory(dir=dst.parent) as tmp:
        mid = Path(tmp) / "encoder.rewritten.onnx"
        onnx.save(model, str(mid), save_as_external_data=True, location="encoder.rewritten.data")
        del model
        quantize_dynamic(
            str(mid),
            str(dst),
            weight_type=QuantType.QInt8,
            per_channel=True,
            reduce_range=reduce_range,
            op_types_to_quantize=["MatMul"],
            extra_options={"MatMulConstBOnly": True},
        )
    return rewritten


def extract_decoder(src: Path) -> dict[str, np.ndarray]:
    """Weights of decoder_joint-model.onnx, pre-folded for the decoder's hot loop.

    The ONNX LSTM packs gates as i, o, f, c with W [1, 4H, in], R [1, 4H, H], B [1, 8H]."""
    m = onnx.load(str(src))
    w = {t.name: numpy_helper.to_array(t).astype(np.float32) for t in m.graph.initializer}
    lstm = [n for n in m.graph.node if n.op_type == "LSTM"]
    matmul = {n.name: n for n in m.graph.node if n.op_type == "MatMul"}
    assert len(lstm) == 2, "expected a 2-layer LSTM prediction network"

    def mm(prefix: str) -> np.ndarray:
        node = next(n for name, n in matmul.items() if name.startswith(prefix))
        return w[node.input[1]]

    embed = w["decoder.prediction.embed.weight"]
    (w0, r0, b0), (w1, r1, b1) = ((w[n.input[1]][0], w[n.input[2]][0], w[n.input[3]][0]) for n in lstm)
    h = r0.shape[1]
    # layer 0's input term is a pure function of the token: fold it into a lookup table
    table0 = embed @ w0.T + b0[: 4 * h] + b0[4 * h :]
    return {
        "table0": table0.astype(np.float32),
        "r0": np.ascontiguousarray(r0.T),
        "wr1": np.ascontiguousarray(np.concatenate([w1, r1], axis=1).T),
        "b1": (b1[: 4 * h] + b1[4 * h :]).astype(np.float32),
        "enc_w": mm("/joint/enc/"),
        "enc_b": w["joint.enc.bias"],
        "pred_w": mm("/joint/pred/"),
        "pred_b": w["joint.pred.bias"],
        "out_w": np.ascontiguousarray(mm("/joint/joint_net")),
        "out_b": w["joint.joint_net.2.bias"],
        # blank is the last embedding row; the head's outputs past the vocabulary are TDT durations
        "blank": np.array(embed.shape[0] - 1),
        "durations": np.arange(mm("/joint/joint_net").shape[1] - embed.shape[0]),
    }


def save_npz(path: Path, arrays: dict[str, np.ndarray]) -> None:
    """np.savez, minus the build time it stamps on each member: the release digests in
    stt/fetch.py need the same bytes from every build."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
        for name, a in arrays.items():
            with z.open(zipfile.ZipInfo(f"{name}.npy", (1980, 1, 1, 0, 0, 0)), "w", force_zip64=True) as f:
                np.lib.format.write_array(f, np.asanyarray(a), allow_pickle=False)


def main(src_dir: str, out_dir: str, model: str = DEFAULT) -> None:
    src, out = Path(src_dir), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    reduce_range = variant() == "compat"
    rewritten = compile_encoder(src / "encoder-model.onnx", out / "encoder.int8.onnx", reduce_range)
    save_npz(out / "decoder.npz", extract_decoder(src / "decoder_joint-model.onnx"))
    shutil.copyfile(src / "vocab.txt", out / "vocab.txt")
    shutil.copyfile(src / "nemo128.onnx", out / "preprocessor.onnx")
    manifest = {
        "model": model,
        "gate_raw": GATE_RAW[model],
        "pointwise_convs_rewritten": rewritten,
        "reduce_range": reduce_range,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main(*sys.argv[1:4])
