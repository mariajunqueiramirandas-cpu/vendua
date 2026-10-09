"""The optimized decoder against a straight port of the reference loop, on a tiny random
model built with the same graph structure as the Parakeet decoder_joint export."""

import tempfile
import unittest
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto as TP
from onnx import helper as h
from onnx import numpy_helper as nh

from stt.compile import extract_decoder
from stt.decoder import MAX_SYMBOLS_PER_STEP, TdtDecoder

V, H, J, D, NDUR = 40, 16, 24, 12, 5  # vocab incl. blank, LSTM hidden, joint, encoder dim


def tiny_decoder_joint(path: Path, rng: np.random.Generator, blank_bias: float, dur0_bias: float) -> None:
    r = lambda *s: (rng.standard_normal(s) * 0.5).astype(np.float32)  # noqa: E731
    out_b = r(V + NDUR)
    out_b[V - 1] += blank_bias
    out_b[V] += dur0_bias
    inits = [
        nh.from_array(r(V, H), "decoder.prediction.embed.weight"),
        nh.from_array(r(1, 4 * H, H), "W0"), nh.from_array(r(1, 4 * H, H), "R0"), nh.from_array(r(1, 8 * H), "B0"),
        nh.from_array(r(1, 4 * H, H), "W1"), nh.from_array(r(1, 4 * H, H), "R1"), nh.from_array(r(1, 8 * H), "B1"),
        nh.from_array(r(D, J), "We"), nh.from_array(r(J), "joint.enc.bias"),
        nh.from_array(r(H, J), "Wp"), nh.from_array(r(J), "joint.pred.bias"),
        nh.from_array(r(J, V + NDUR), "Wo"), nh.from_array(out_b, "joint.joint_net.2.bias"),
        nh.from_array(np.array([0]), "i0"), nh.from_array(np.array([1]), "i1"), nh.from_array(np.array([2]), "i2"),
    ]
    n = h.make_node
    nodes = [
        n("Gather", ["decoder.prediction.embed.weight", "targets"], ["emb"]),  # [1,1,H]
        n("Transpose", ["emb"], ["x0"], perm=[1, 0, 2]),
        n("Slice", ["s1", "i0", "i1", "i0"], ["h0"]), n("Slice", ["s2", "i0", "i1", "i0"], ["c0"]),
        n("Slice", ["s1", "i1", "i2", "i0"], ["h1"]), n("Slice", ["s2", "i1", "i2", "i0"], ["c1"]),
        n("LSTM", ["x0", "W0", "R0", "B0", "", "h0", "c0"], ["y0", "ho0", "co0"], hidden_size=H),
        n("Squeeze", ["y0", "i1"], ["x1"]),
        n("LSTM", ["x1", "W1", "R1", "B1", "", "h1", "c1"], ["y1", "ho1", "co1"], hidden_size=H),
        n("Squeeze", ["y1", "i1"], ["y1s"]),  # [1,1,H]
        n("Concat", ["ho0", "ho1"], ["out_s1"], axis=0), n("Concat", ["co0", "co1"], ["out_s2"], axis=0),
        n("MatMul", ["enc", "We"], ["e0"], name="/joint/enc/MatMul"), n("Add", ["e0", "joint.enc.bias"], ["e"]),
        n("Squeeze", ["y1s", "i0"], ["y"]),
        n("MatMul", ["y", "Wp"], ["p0"], name="/joint/pred/MatMul"), n("Add", ["p0", "joint.pred.bias"], ["p"]),
        n("Add", ["e", "p"], ["s"]), n("Relu", ["s"], ["z"]),
        n("MatMul", ["z", "Wo"], ["o0"], name="/joint/joint_net/joint_net.2/MatMul"),
        n("Add", ["o0", "joint.joint_net.2.bias"], ["outputs"]),
    ]
    g = h.make_graph(
        nodes,
        "tiny",
        [
            h.make_tensor_value_info("enc", TP.FLOAT, [1, D]),
            h.make_tensor_value_info("targets", TP.INT64, [1, 1]),
            h.make_tensor_value_info("s1", TP.FLOAT, [2, 1, H]),
            h.make_tensor_value_info("s2", TP.FLOAT, [2, 1, H]),
        ],
        [
            h.make_tensor_value_info("outputs", TP.FLOAT, [1, V + NDUR]),
            h.make_tensor_value_info("out_s1", TP.FLOAT, [2, 1, H]),
            h.make_tensor_value_info("out_s2", TP.FLOAT, [2, 1, H]),
        ],
        inits,
    )
    m = h.make_model(g, opset_imports=[h.make_opsetid("", 17)], ir_version=8)
    onnx.checker.check_model(m)
    onnx.save(m, str(path))


def reference_decode(sess: ort.InferenceSession, enc: np.ndarray, length: int):
    """onnx-asr's NemoConformerTdt loop: the whole decoder_joint runs on every step."""
    state = (np.zeros((2, 1, H), np.float32), np.zeros((2, 1, H), np.float32))
    tokens, frames, logprobs = [], [], []
    t = emitted = 0
    while t < length:
        last = tokens[-1] if tokens else V - 1
        out, s1, s2 = sess.run(None, {"enc": enc[t][None], "targets": np.array([[last]]), "s1": state[0], "s2": state[1]})
        out = out[0]
        tok, step = int(out[:V].argmax()), int(out[V:].argmax())
        if tok != V - 1:
            state = (s1, s2)
            tokens.append(tok)
            frames.append(t)
            lt = out[:V]
            logprobs.append(float(lt[tok] - (lt.max() + np.log(np.exp(lt - lt.max()).sum()))))
            emitted += 1
        if step > 0:
            t += step
            emitted = 0
        elif tok == V - 1 or emitted == MAX_SYMBOLS_PER_STEP:
            t += 1
            emitted = 0
    return tokens, frames, logprobs


class DecoderTest(unittest.TestCase):
    def check(self, seed: int, blank_bias: float, dur0_bias: float) -> int:
        rng = np.random.default_rng(seed)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "dj.onnx"
            tiny_decoder_joint(path, rng, blank_bias, dur0_bias)
            sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
            dec = TdtDecoder(extract_decoder(path))
        lengths = np.array([30, 1, 17, 0, 25, 30])
        enc = rng.standard_normal((len(lengths), 30, D)).astype(np.float32)
        hyps = dec.decode(enc, lengths)
        emitted = 0
        for b, n in enumerate(lengths):
            tokens, frames, logprobs = reference_decode(sess, enc[b], int(n))
            self.assertEqual(hyps[b].tokens, tokens, f"utterance {b}")
            self.assertEqual(hyps[b].frames, frames, f"utterance {b}")
            np.testing.assert_allclose(hyps[b].logprobs, logprobs, atol=1e-4)
            # batching never changes a result
            alone = dec.decode(enc[b : b + 1, : max(int(n), 1)], lengths[b : b + 1])[0]
            self.assertEqual(alone.tokens, tokens)
            emitted += len(tokens)
        return emitted

    def test_matches_reference(self):
        for seed in range(4):
            self.assertGreater(self.check(seed, blank_bias=1.0, dur0_bias=0.0), 0)

    def test_symbol_cap_on_zero_durations(self):
        # mostly tokens with duration 0: exercises MAX_SYMBOLS_PER_STEP
        self.assertGreater(self.check(7, blank_bias=-3.0, dur0_bias=4.0), 30)

    def test_blank_and_durations_inferred(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "dj.onnx"
            tiny_decoder_joint(path, np.random.default_rng(0), 0, 0)
            w = extract_decoder(path)
        self.assertEqual(int(w["blank"]), V - 1)
        self.assertEqual(w["durations"].tolist(), list(range(NDUR)))


if __name__ == "__main__":
    unittest.main()
