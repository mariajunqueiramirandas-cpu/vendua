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
        val model = UsbPrinters.model(wanted)
        val addresses = UsbPrinters.addresses(manager)
        val sameModel = manager.deviceList.values.filter { UsbPrinters.model(addresses.getValue(it.deviceName)) == model }
        val device = sameModel.firstOrNull { addresses[it.deviceName] == wanted }
            // a serial is only readable with permission: ask for the one we can't tell apart yet
            ?: sameModel.firstOrNull { !manager.hasPermission(it) }?.let {
                requestPermission(it)
                throw PrintException("Permissão USB negada")
            }
            ?: throw PrintException("Impressora USB não encontrada")
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
    /**
     * `vid:pid`, plus `:serial` when the printer reports one and we may read it: two identical
     * printers on one tablet stay apart, and the key survives replugging (a bus path wouldn't).
     */
    fun address(device: UsbDevice, manager: UsbManager?): String {
        val model = String.format(Locale.ROOT, "%04x:%04x", device.vendorId, device.productId)
        val serial = if (manager?.hasPermission(device) == true) {
            try {
                device.serialNumber
            } catch (_: SecurityException) {
                null
            }
        } else {
            null
        }
        val clean = serial?.lowercase(Locale.ROOT)?.filter { it.isLetterOrDigit() }?.take(64)
        return if (clean.isNullOrEmpty()) model else "$model:$clean"
    }

    /**
     * Every attached device's address. Identical printers with no readable serial share
     * `vid:pid`, so those (and only those) get the port they sit on: a lone printer keeps the key
     * that survives replugging, and two identical ones are still two printers.
     */
    fun addresses(manager: UsbManager): Map<String, String> {
        val devices = manager.deviceList.values.toList()
        val base = devices.associate { it.deviceName to address(it, manager) }
        val clashing = base.values.groupingBy { it }.eachCount().filterValues { it > 1 }.keys
        return devices.associate { d ->
            val a = base.getValue(d.deviceName)
            d.deviceName to if (a in clashing) "$a:${port(d)}" else a
        }
    }

    /** `/dev/bus/usb/001/004` → `p001004` */
    private fun port(device: UsbDevice): String = "p" + device.deviceName.filter(Char::isDigit).takeLast(12)

    /** the `vid:pid` part of an address */
    fun model(address: String): String = address.split(':').take(2).joinToString(":")

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
            .ifEmpty { "Impressora USB ${address(device, null)}" }
}
