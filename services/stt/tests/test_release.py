import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from stt import fetch
from stt.compile import save_npz


class SaveNpzTest(unittest.TestCase):
    def test_same_bytes_every_time_and_loads_like_savez(self):
        arrays = {"a": np.arange(6, dtype=np.float32).reshape(2, 3), "blank": np.array(8192)}
        with tempfile.TemporaryDirectory() as d:
            first, second = Path(d, "1.npz"), Path(d, "2.npz")
            save_npz(first, arrays)
            with mock.patch("time.time", return_value=2e9):
                save_npz(second, arrays)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with np.load(first) as w:
                np.testing.assert_array_equal(w["a"], arrays["a"])
                self.assertEqual(int(w["blank"]), 8192)


class StageTest(unittest.TestCase):
    def compiled(self, root: Path) -> None:
        for v in ("vnni", "compat"):
            (root / v).mkdir(parents=True)
            (root / v / "vocab.txt").write_text(v)

    def pins(self, vnni: str, compat: str) -> dict:
        return {("m", "vnni"): {"vocab.txt": vnni}, ("m", "compat"): {"vocab.txt": compat}}

    def test_names_assets_by_model_and_variant(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.compiled(root / "out")
            ok = self.pins(fetch.sha256(root / "out/vnni/vocab.txt"), fetch.sha256(root / "out/compat/vocab.txt"))
            with mock.patch.dict(fetch.COMPILED, ok, clear=True):
                fetch.stage(str(root / "out"), str(root / "assets"), "m")
            self.assertEqual(sorted(p.name for p in (root / "assets").iterdir()), ["m.compat.vocab.txt", "m.vnni.vocab.txt"])

    def test_a_moved_digest_fails_and_prints_the_new_pin(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.compiled(root / "out")
            stale = self.pins("0" * 64, fetch.sha256(root / "out/compat/vocab.txt"))
            with mock.patch.dict(fetch.COMPILED, stale, clear=True), self.assertRaises(SystemExit) as e:
                fetch.stage(str(root / "out"), str(root / "assets"), "m")
            self.assertIn(f'm vnni: "vocab.txt": "{fetch.sha256(root / "assets/m.vnni.vocab.txt")}"', str(e.exception))
            self.assertNotIn("compat", str(e.exception))


class VariantTest(unittest.TestCase):
    def test_forced_and_auto(self):
        with mock.patch.dict("os.environ", {"STT_REDUCE_RANGE": "1"}):
            self.assertEqual(fetch.variant(), "compat")
        with mock.patch.dict("os.environ", {"STT_REDUCE_RANGE": "0"}):
            self.assertEqual(fetch.variant(), "vnni")
        with mock.patch.dict("os.environ", {"STT_REDUCE_RANGE": "auto"}), mock.patch.object(fetch, "cpu_has_vnni", return_value=False):
            self.assertEqual(fetch.variant(), "compat")


if __name__ == "__main__":
    unittest.main()
