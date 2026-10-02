package br.com.vendua.impressora.print

import android.content.Context
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import br.com.vendua.impressora.api.Printer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

class UsbTransport(
    private val context: Context,
    private val requestPermission: (UsbDevice) -> Unit,
) : Transport {
    override suspend fun send(printer: Printer, bytes: ByteArray): Unit = withContext(Dispatchers.IO) {
        val manager = context.getSystemService(UsbManager::class.java)
            ?: throw PrintException("USB indisponível neste aparelho", retryable = false)
        val wanted = printer.address.ifBlank { printer.key.removePrefix("usb:") }.lowercase(Locale.ROOT)
        val device = manager.deviceList.values.firstOrNull { UsbPrinters.address(it) == wanted }
            ?: throw PrintException("Impressora USB não encontrada")
        if (!manager.hasPermission(device)) {
            requestPermission(device)
            throw PrintException("Permissão USB negada")
        }
        val (iface, endpoint) = UsbPrinters.bulkOut(device)
            ?: throw PrintException("Impressora USB sem saída de dados", retryable = false)
        val conn = manager.openDevice(device) ?: throw PrintException("Não foi possível abrir a impressora USB")
        try {
            if (!conn.claimInterface(iface, true)) throw PrintException("Impressora USB ocupada")
            var offset = 0
            while (offset < bytes.size) {
                val len = minOf(CHUNK, bytes.size - offset)
                val sent = conn.bulkTransfer(endpoint, bytes, offset, len, TIMEOUT_MS)
                if (sent <= 0) throw PrintException("Falha ao enviar para a impressora USB")
                offset += sent
            }
            conn.releaseInterface(iface)
        } finally {
            conn.close()
        }
    }

    private companion object {
        const val CHUNK = 16 * 1024
        const val TIMEOUT_MS = 5_000
    }
}

object UsbPrinters {
    fun address(device: UsbDevice): String =
        String.format(Locale.ROOT, "%04x:%04x", device.vendorId, device.productId)

    /** Printer-class interface (7) first, else the first interface with a bulk OUT endpoint. */
    fun bulkOut(device: UsbDevice): Pair<UsbInterface, UsbEndpoint>? {
        val interfaces = (0 until device.interfaceCount).map { device.getInterface(it) }
        val ordered = interfaces.filter { it.interfaceClass == UsbConstants.USB_CLASS_PRINTER } +
            interfaces.filter { it.interfaceClass != UsbConstants.USB_CLASS_PRINTER }
        for (iface in ordered) {
            for (i in 0 until iface.endpointCount) {
                val ep = iface.getEndpoint(i)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) {
                    return iface to ep
                }
            }
        }
        return null
    }

    fun displayName(device: UsbDevice): String =
        listOfNotNull(device.manufacturerName, device.productName).joinToString(" ").trim()
            .ifEmpty { "Impressora USB ${address(device)}" }
}
