package br.com.vendua.impressora.service

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import br.com.vendua.impressora.graph

class UsbPermission(private val context: Context) {
    @Volatile private var lastRequestAt = 0L

    fun request(device: UsbDevice, force: Boolean = false) {
        val manager = context.getSystemService(UsbManager::class.java) ?: return
        if (manager.hasPermission(device)) return
        // The print retries would otherwise stack up one system dialog per attempt.
        val now = System.currentTimeMillis()
        if (!force && now - lastRequestAt < 30_000) return
        lastRequestAt = now
        // UsbManager adds EXTRA_DEVICE / EXTRA_PERMISSION_GRANTED, so the intent must be mutable (31+); it is explicit.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        val intent = Intent(context, UsbPermissionReceiver::class.java)
            .setAction(ACTION)
            .setPackage(context.packageName)
        manager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags))
    }

    companion object {
        const val ACTION = "br.com.vendua.impressora.USB_PERMISSION"
    }
}

class UsbPermissionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != UsbPermission.ACTION) return
        if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
            context.graph.reportPrintersAsync()
        }
    }
}
