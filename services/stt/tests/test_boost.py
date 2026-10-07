import tempfile
import unittest
from pathlib import Path

import numpy as np
import onnxruntime as ort

from stt.boost import WORD, BoostCache, PhraseBoost
from stt.compile import extract_decoder
from stt.decoder import TdtDecoder
from tests.test_decoder import V, tiny_decoder_joint

PIECES = {
    WORD + "pi": 1, "zza": 2, WORD + "pizza": 3, WORD + "de": 4, WORD + "ca": 5, "tu": 6, "piry": 7,
    WORD + "Pizza": 8, WORD + "x": 9, "-": 10, "tudo": 11, "a": 12,
}


class AutomatonTest(unittest.TestCase):
    def setUp(self):
        self.b = PhraseBoost(["Pizza de Catupiry", "X-Tudo"], PIECES, start_bonus=1.0, step_bonus=2.0)

    def test_any_tokenization_matches(self):
        root = self.b.bonuses(())
        # whole-word and split pieces both start the phrase, in any casing variant
        for piece in (WORD + "pi", WORD + "pizza", WORD + "Pizza", WORD + "x"):
            self.assertEqual(root[PIECES[piece]][0], 1.0, piece)
        # a phrase only starts at a word boundary
        self.assertNotIn(PIECES["zza"], root)
        s = self.b.advance((), PIECES[WORD + "pi"])
        self.assertEqual(self.b.bonuses(s)[PIECES["zza"]][0], 2.0)
        s = self.b.advance(s, PIECES["zza"])
        self.assertIn(PIECES[WORD + "de"], self.b.bonuses(s))
        for piece in (WORD + "de", WORD + "ca", "tu", "piry"):
            self.assertIn(PIECES[piece], self.b.bonuses(s), piece)
            s = self.b.advance(s, PIECES[piece])
        self.assertTrue(s)  # at the end of "pizza de catupiry"

    def test_a_wrong_piece_drops_the_match(self):
        s = self.b.advance((), PIECES[WORD + "pi"])
        self.assertEqual(self.b.advance(s, PIECES["a"]), ())
        # but a piece that starts another phrase starts it
        self.assertTrue(self.b.advance(s, PIECES[WORD + "x"]))

    def test_cache(self):
        c = BoostCache(PIECES, 1.0, 2.0, size=2)
        a = c.get(["X-Tudo", "Pizza de Catupiry"])
        self.assertIs(c.get([" Pizza de Catupiry ", "X-Tudo"]), a)
        self.assertIsNone(c.get(["  ", ""]))


class BoostedDecodeTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(3)
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name) / "dj.onnx"
        tiny_decoder_joint(path, rng, blank_bias=2.0, dur0_bias=0.0)
        self.sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.dec = TdtDecoder(extract_decoder(path))
        self.enc = rng.standard_normal((2, 30, 12)).astype(np.float32)

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_boosted_phrase_wins_and_probabilities_stay_the_models(self):
        pieces = {WORD + "p5": 5, "q7": 7, "q9": 9}
        boost = PhraseBoost(["p5q7q9"], pieces, start_bonus=50.0, step_bonus=100.0)
        plain, boosted = self.dec.decode(self.enc, np.array([30, 30]), [None, boost])
        self.assertEqual(boosted.tokens[:3], [5, 7, 9])
        # the unboosted row in the same batch is untouched
        alone = self.dec.decode(self.enc[:1], np.array([30]))[0]
        self.assertEqual(plain.tokens, alone.tokens)
        # the first token's reported log-prob is the model's, not the boosted score
        out = self.sess.run(
            None,
            {
                "enc": self.enc[1, :1],
                "targets": np.array([[V - 1]]),
                "s1": np.zeros((2, 1, 16), np.float32),
                "s2": np.zeros((2, 1, 16), np.float32),
            },
        )[0][0, :V]
        logp = out - (out.max() + np.log(np.exp(out - out.max()).sum()))
        self.assertAlmostEqual(boosted.logprobs[0], float(logp[5]), places=4)


class ConfidenceTest(unittest.TestCase):
    def test_entropy_confidence_bounds(self):
        dec = TdtDecoder.__new__(TdtDecoder)
        dec.vocab = 8193
        a = 1 / 3
        dec._conf_floor = float(np.exp((1 - dec.vocab ** (1 - a)) / (1 - a)))
        uniform = np.full((1, dec.vocab), -np.log(dec.vocab))
        sure = np.full((1, dec.vocab), -40.0)
        sure[0, 0] = 0.0
        unsure = np.full((1, dec.vocab), -12.0)
        unsure[0, :2] = np.log(0.5)
        c = dec._confidence(np.concatenate([uniform, sure, unsure]))
        self.assertAlmostEqual(float(c[0]), 0.0, places=6)
        self.assertGreater(float(c[1]), 0.97)
        self.assertLess(float(c[2]), 0.6)  # a coin flip between two pieces


if __name__ == "__main__":
    unittest.main()
