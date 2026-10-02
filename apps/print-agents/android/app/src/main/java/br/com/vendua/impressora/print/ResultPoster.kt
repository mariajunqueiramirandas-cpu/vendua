package br.com.vendua.impressora.print

import br.com.vendua.impressora.api.ApiClient
import br.com.vendua.impressora.api.ApiResult
import br.com.vendua.impressora.api.Backoff
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

fun interface ResultSink {
    fun report(jobId: String, ok: Boolean, error: String?)
}

/** Posts job results in the background, retrying for up to [retryWindowMs] (spec: 10 min). */
class ResultPoster(
    private val scope: CoroutineScope,
    private val api: ApiClient,
    private val retryWindowMs: Long = 10 * 60_000L,
    private val newBackoff: () -> Backoff = { Backoff(baseMs = 1_000, maxMs = 60_000) },
    private val clock: () -> Long = System::currentTimeMillis,
) : ResultSink {
    override fun report(jobId: String, ok: Boolean, error: String?) {
        scope.launch { post(jobId, ok, error) }
    }

    /** Returns true when Core has the result (or no longer wants it). */
    suspend fun post(jobId: String, ok: Boolean, error: String?): Boolean {
        val deadline = clock() + retryWindowMs
        val backoff = newBackoff()
        while (true) {
            when (val r = api.postJobResult(jobId, ok, error)) {
                is ApiResult.Ok -> return true
                is ApiResult.HttpError -> when {
                    r.status == 404 -> return true
                    r.status == 401 -> return false
                    r.status in 400..499 && r.status != 408 && r.status != 429 -> return false
                }
                is ApiResult.NetworkError -> Unit
            }
            val wait = backoff.next()
            if (clock() + wait > deadline) return false
            delay(wait)
        }
    }
}
