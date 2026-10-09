package br.com.vendua.impressora.print

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import br.com.vendua.impressora.api.Printer
import br.com.vendua.impressora.api.ReportedPrinter
import java.util.Locale

data class UsbCandidate(val device: UsbDevice, val name: String, val address: String, val permitted: Boolean)

data class BluetoothCandidate(val name: String, val mac: String)

/** What this tablet can print to on its own; TCP printers are configured in the admin. */
class PrinterDiscovery(
    private val context: Context,
    private val pickedBluetooth: () -> List<ReportedPrinter>,
    /** the printers Core knows for this device */
    private val known: () -> List<Printer> = { emptyList() },
    private val requestUsbPermission: (UsbDevice) -> Unit = {},
) {
    fun discover(): List<ReportedPrinter> {
        val usb = usbCandidates()
        val permitted = usb.filter { it.permitted }.map {
            ReportedPrinter(key = "usb:${it.address}", kind = "usb", name = it.name, address = it.address)
        }
        // USB permission doesn't survive a reboot, and without it the serial in the key can't be
        // read: a printer of a model this device already prints to keeps its key, or Core marks
        // it absent. Unknown devices stay out until someone picks them.
        val taken = permitted.map { it.key }.toMutableSet()
        val waiting = usb.filter { !it.permitted }.mapNotNull { c ->
            val k = known().firstOrNull {
                it.kind == "usb" && it.key !in taken && UsbPrinters.model(usbAddress(it)) == UsbPrinters.model(c.address)
            } ?: return@mapNotNull null
            taken += k.key
            requestUsbPermission(c.device)
            ReportedPrinter(key = k.key, kind = "usb", name = c.name, address = usbAddress(k))
        }
        return permitted + waiting + pickedBluetooth()
    }

    private fun usbAddress(p: Printer) = p.address.ifBlank { p.key.removePrefix("usb:") }.lowercase(Locale.ROOT)

    fun usbCandidates(): List<UsbCandidate> {
        val manager = context.getSystemService(UsbManager::class.java) ?: return emptyList()
        val addresses = UsbPrinters.addresses(manager)
        return manager.deviceList.values
            .filter { UsbPrinters.bulkOut(it) != null }
            .map { UsbCandidate(it, UsbPrinters.displayName(it), addresses.getValue(it.deviceName), manager.hasPermission(it)) }
    }

    @SuppressLint("MissingPermission") // guarded by hasConnectPermission()
    fun bondedBluetooth(): List<BluetoothCandidate> {
        if (!Bluetooth.hasConnectPermission(context)) return emptyList()
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return emptyList()
        return try {
            adapter.bondedDevices.orEmpty().map {
                BluetoothCandidate(it.name?.takeIf(String::isNotBlank) ?: it.address, it.address.uppercase(Locale.ROOT))
            }.sortedBy { it.name.lowercase(Locale.ROOT) }
        } catch (_: SecurityException) {
            emptyList()
        }
    }

    companion object {
        fun bluetoothPrinter(c: BluetoothCandidate) =
            ReportedPrinter(key = "bt:${c.mac}", kind = "bluetooth", name = c.name, address = c.mac)
    }
}
