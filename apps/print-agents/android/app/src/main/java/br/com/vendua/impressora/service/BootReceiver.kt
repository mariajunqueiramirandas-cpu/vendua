package br.com.vendua.impressora.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import br.com.vendua.impressora.graph

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        WatchdogWorker.schedule(context)
        if (context.graph.state.paired.value && !PrintService.start(context)) {
            Notifications.postReactivate(context)
        }
    }
}
