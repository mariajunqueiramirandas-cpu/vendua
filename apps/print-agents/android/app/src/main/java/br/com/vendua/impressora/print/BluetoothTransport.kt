package br.com.vendua.impressora.print

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import br.com.vendua.impressora.api.Printer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.Locale
import java.util.UUID

class BluetoothTransport(private val context: Context) : Transport {
    @SuppressLint("MissingPermission") // checked by hasConnectPermission()
    override suspend fun send(printer: Printer, bytes: ByteArray): Unit = withContext(Dispatchers.IO) {
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
            ?: throw PrintException("Bluetooth indisponível neste aparelho", retryable = false)
        if (!Bluetooth.hasConnectPermission(context)) {
            throw PrintException("Permissão de Bluetooth negada", retryable = false)
        }
        if (!adapter.isEnabled) throw PrintException("Bluetooth desligado")
        val mac = printer.address.ifBlank { printer.key.removePrefix("bt:") }.uppercase(Locale.ROOT)
        val device = try {
            adapter.getRemoteDevice(mac)
        } catch (_: IllegalArgumentException) {
            throw PrintException("Endereço Bluetooth inválido ($mac)", retryable = false)
        }
        // An ongoing discovery makes RFCOMM connects slow or fail.
        if (Bluetooth.hasScanPermission(context)) adapter.cancelDiscovery()
        val socket = connect { device.createRfcommSocketToServiceRecord(SPP) }
            ?: connect { device.createInsecureRfcommSocketToServiceRecord(SPP) }
            ?: throw PrintException("Sem resposta da impressora Bluetooth (${printer.name})")
        try {
            socket.outputStream.apply {
                write(bytes)
                flush()
            }
            // Many cheap printers drop the tail of the buffer if the link closes right after the write.
            delay(400)
        } catch (_: IOException) {
            throw PrintException("Falha ao enviar para a impressora Bluetooth")
        } finally {
            try {
                socket.close()
            } catch (_: IOException) {
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun connect(open: () -> BluetoothSocket): BluetoothSocket? {
        val socket = try {
            open()
        } catch (_: IOException) {
            return null
        }
        return try {
            socket.connect()
            socket
        } catch (_: IOException) {
            try {
                socket.close()
            } catch (_: IOException) {
            }
            null
        }
    }

    companion object {
        val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}

object Bluetooth {
    fun hasConnectPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    fun hasScanPermission(context: Context): Boolean =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        }

    /** Runtime permissions to request together (one "Dispositivos por perto" dialog on 31+). */
    val runtimePermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
        } else {
            emptyArray()
        }
}
