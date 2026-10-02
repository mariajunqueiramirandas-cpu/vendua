package br.com.vendua.impressora.print

import br.com.vendua.impressora.api.Printer

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
