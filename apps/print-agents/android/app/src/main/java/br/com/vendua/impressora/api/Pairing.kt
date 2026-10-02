package br.com.vendua.impressora.api

import kotlinx.coroutines.delay

sealed interface PairOutcome {
    data class Approved(val storeName: String) : PairOutcome
    data object Expired : PairOutcome
}

/** Polls `/pair/poll` until the merchant approves the code or it expires. */
/** outlasts Core's own window for collecting an approved code after it expires (5 min) */
const val COLLECT_GRACE_MS = 6 * 60_000L

class PairingPoller(
    private val api: ApiClient,
    private val tokens: TokenStore,
    private val clock: () -> Long = System::currentTimeMillis,
    private val minIntervalMs: Long = 1_000,
    private val rateLimitWaitMs: Long = 60_000,
) {
    suspend fun await(start: PairResponse): PairOutcome {
        // Core answers 410 once an unapproved code expires, and still hands an approved one out
        // for a few minutes after: only a Core that never answers hits this cap
        val deadline = clock() + start.expiresIn * 1_000L + COLLECT_GRACE_MS
        val interval = (start.interval * 1_000L).coerceAtLeast(minIntervalMs)
        while (true) {
            delay(interval)
            if (clock() > deadline) return PairOutcome.Expired
            when (val r = api.poll(start.deviceCode)) {
                is ApiResult.Ok -> when (r.value.status) {
                    "approved" -> {
                        val token = r.value.token ?: continue
                        tokens.set(token)
                        return PairOutcome.Approved(r.value.store?.name.orEmpty())
                    }
                    "pending" -> Unit
                    else -> return PairOutcome.Expired
                }
                is ApiResult.HttpError -> when (r.status) {
                    404, 410 -> return PairOutcome.Expired
                    429 -> delay(rateLimitWaitMs)
                }
                is ApiResult.NetworkError -> Unit
            }
        }
    }
}
