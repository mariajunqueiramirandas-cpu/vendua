package br.com.vendua.impressora.print

import br.com.vendua.impressora.api.JobEvent
import br.com.vendua.impressora.api.Printer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

const val ERROR_UNKNOWN_PRINTER = "Impressora não configurada neste aparelho"

/**
 * One FIFO worker per printer id, so jobs to one printer never interleave while different
 * printers print in parallel.
 */
class JobRunner(
    private val scope: CoroutineScope,
    private val transport: Transport,
    private val finished: FinishedStore,
    private val results: ResultSink,
    private val printers: () -> List<Printer>,
    /** Waits before attempts 2 and 3 (spec: immediately, after 3 s, after 10 s). */
    private val retryDelaysMs: List<Long> = listOf(3_000, 10_000),
    /** a backstop over the transports' own deadlines: one stuck attempt never parks the queue */
    private val attemptTimeoutMs: Long = 45_000,
    private val onFinished: (printerId: String, ok: Boolean, error: String?) -> Unit = { _, _, _ -> },
) {
    private val queues = ConcurrentHashMap<String, Channel<JobEvent>>()
    private val pending: MutableSet<String> = ConcurrentHashMap.newKeySet()

    fun submit(job: JobEvent) {
        // Already queued: the queued copy will print and report.
        if (!pending.add(job.id)) return
        queues.computeIfAbsent(job.printerId) { id ->
            Channel<JobEvent>(Channel.UNLIMITED).also { ch ->
                scope.launch {
                    for (j in ch) {
                        try {
                            process(j)
                        } finally {
                            pending.remove(j.id)
                        }
                    }
                }
            }
        }.trySend(job)
    }

    private suspend fun process(job: JobEvent) {
        finished.get(job.id)?.let {
            results.report(it.id, it.ok, it.error)
            return
        }
        val printer = printers().firstOrNull { it.id == job.printerId }
        val bytes = decode(job.data)
        val error: String? = when {
            printer == null -> ERROR_UNKNOWN_PRINTER
            bytes == null -> "Dados de impressão inválidos"
            else -> printWithRetries(printer, bytes)
        }
        val ok = error == null
        finished.put(FinishedJob(job.id, ok, error))
        onFinished(job.printerId, ok, error)
        results.report(job.id, ok, error)
    }

    /** Returns null on success, else the last error message. */
    private suspend fun printWithRetries(printer: Printer, bytes: ByteArray): String? {
        var lastError = "Falha ao imprimir"
        for (attempt in 0..retryDelaysMs.size) {
            if (attempt > 0) delay(retryDelaysMs[attempt - 1])
            try {
                withTimeout(attemptTimeoutMs) { transport.send(printer, bytes) }
                return null
            } catch (_: TimeoutCancellationException) {
                lastError = "A impressora não respondeu (${printer.name})"
            } catch (e: CancellationException) {
                throw e
            } catch (e: PrintException) {
                lastError = e.message ?: lastError
                if (!e.retryable) break
            } catch (e: Exception) {
                lastError = "Falha ao imprimir"
            }
        }
        return lastError.take(200)
    }

    private fun decode(data: String): ByteArray? = try {
        Base64.getMimeDecoder().decode(data)
    } catch (_: IllegalArgumentException) {
        null
    }
}
