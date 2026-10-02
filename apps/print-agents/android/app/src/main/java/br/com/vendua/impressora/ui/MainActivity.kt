package br.com.vendua.impressora.ui

import android.content.Intent
import android.hardware.usb.UsbManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import br.com.vendua.impressora.graph
import br.com.vendua.impressora.service.PrintService

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            VenduaTheme {
                AppRoot(vm)
            }
        }
        handle(intent)
    }

    override fun onStart() {
        super.onStart()
        if (graph.state.paired.value) PrintService.start(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        // Opening the app from the "printer plugged in" prompt grants USB permission for that device.
        if (intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED) graph.reportPrintersAsync()
    }
}
