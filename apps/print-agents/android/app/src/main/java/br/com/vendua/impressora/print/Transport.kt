package br.com.vendua.impressora.print

import br.com.vendua.impressora.api.Printer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import java.io.Closeable

/** [message] is shown to the merchant and sent to Core, so it is short pt-BR. */
class PrintException(message: String, val retryable: Boolean = true) : Exception(message)

fun interface Transport {
    /** Writes the already-encoded ESC/POS [bytes] to [printer]; throws [PrintException] on failure. */
    suspend fun send(printer: Printer, bytes: ByteArray)
}

/** Picks the transport by printer kind; kinds this device can't drive fail without retrying. */
class TransportRouter(private val byKind: Map<String, Transport>) : Transport {
    override suspend fun send(printer: Printer, bytes: ByteArray) {
        val transport = byKind[printer.kind]
            ?: throw PrintException("Tipo de impressora não suportado neste aparelho (${printer.kind})", retryable = false)
        transport.send(printer, bytes)
    }
}

/**
 * Runs blocking socket I/O with a hard deadline. A socket write or Bluetooth connect ignores
 * interrupts and has no write timeout of its own; closing the socket is what unblocks it, and
 * the blocked call then fails with an IOException the caller already maps to a PrintException.
 */
suspend fun <T> withDeadline(ms: Long, resource: Closeable, block: () -> T): T = coroutineScope {
    val killer = launch {
        delay(ms)
        runCatching { resource.close() }
    }
    try {
        runInterruptible(Dispatchers.IO) { block() }
    } finally {
        killer.cancel()
    }
}
