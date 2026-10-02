package br.com.vendua.impressora.print

import br.com.vendua.impressora.api.Printer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket

class TcpTransport(
    private val connectTimeoutMs: Int = 5_000,
    private val writeTimeoutMs: Int = 15_000,
) : Transport {
    override suspend fun send(printer: Printer, bytes: ByteArray): Unit = withContext(Dispatchers.IO) {
        val (host, port) = parseHostPort(printer.address.ifBlank { printer.key.removePrefix("tcp:") })
            ?: throw PrintException("Endereço de impressora inválido (${printer.address})", retryable = false)
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), connectTimeoutMs)
                // soTimeout only bounds reads: a printer that stops draining its buffer would
                // block this write, and the printer's whole queue behind it, for good
                withDeadline(writeTimeoutMs.toLong(), socket) {
                    socket.getOutputStream().apply {
                        write(bytes)
                        flush()
                    }
                    socket.shutdownOutput()
                }
            }
        } catch (_: IOException) {
            throw PrintException("Sem resposta da impressora ($host:$port)")
        }
    }

    companion object {
        fun parseHostPort(address: String): Pair<String, Int>? {
            val a = address.trim()
            if (a.isEmpty()) return null
            // [v6]:port, host:port, or bare host (default 9100).
            if (a.startsWith("[")) {
                val end = a.indexOf(']')
                if (end < 0) return null
                val host = a.substring(1, end)
                val port = a.substring(end + 1).removePrefix(":").ifEmpty { "9100" }.toIntOrNull() ?: return null
                return host to port
            }
            val colon = a.lastIndexOf(':')
            if (colon < 0 || a.count { it == ':' } > 1) return a to 9100
            val port = a.substring(colon + 1).toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
            return a.substring(0, colon) to port
        }
    }
}
