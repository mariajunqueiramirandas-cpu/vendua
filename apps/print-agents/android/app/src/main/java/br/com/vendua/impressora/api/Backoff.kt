package br.com.vendua.impressora.api

import kotlin.random.Random

/** Exponential backoff: base, 2×base … capped at max, each with ±jitter. */
class Backoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 30_000,
    private val jitter: Double = 0.2,
    private val random: Random = Random.Default,
) {
    private var attempt = 0

    fun next(): Long {
        val raw = (baseMs shl attempt.coerceAtMost(20)).coerceAtMost(maxMs)
        attempt++
        if (jitter == 0.0) return raw
        val spread = raw * jitter
        return (raw - spread + random.nextDouble() * 2 * spread).toLong().coerceAtLeast(0)
    }

    fun reset() {
        attempt = 0
    }
}
