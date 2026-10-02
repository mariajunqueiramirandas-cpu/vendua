package br.com.vendua.impressora.print

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import br.com.vendua.impressora.api.ReportedPrinter
import java.util.Locale

data class UsbCandidate(val device: UsbDevice, val name: String, val address: String, val permitted: Boolean)

data class BluetoothCandidate(val name: String, val mac: String)

/** What this tablet can print to on its own; TCP printers are configured in the admin. */
class PrinterDiscovery(
    private val context: Context,
    private val pickedBluetooth: () -> List<ReportedPrinter>,
) {
    fun discover(): List<ReportedPrinter> =
        usbCandidates().filter { it.permitted }.map {
            ReportedPrinter(key = "usb:${it.address}", kind = "usb", name = it.name, address = it.address)
        } + pickedBluetooth()

    fun usbCandidates(): List<UsbCandidate> {
        val manager = context.getSystemService(UsbManager::class.java) ?: return emptyList()
        return manager.deviceList.values
            .filter { UsbPrinters.bulkOut(it) != null }
            .map { UsbCandidate(it, UsbPrinters.displayName(it), UsbPrinters.address(it, manager), manager.hasPermission(it)) }
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
