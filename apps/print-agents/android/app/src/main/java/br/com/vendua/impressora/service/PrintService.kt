package br.com.vendua.impressora.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import br.com.vendua.impressora.graph
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Keeps the SSE connection and the print queues alive while the app is in the background. */
class PrintService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var agentJob: Job? = null
    private var updateJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        val state = graph.state
        scope.launch {
            combine(state.storeName, state.connection) { name, conn -> name to conn }.collect { (name, conn) ->
                if (Notifications.canPost(this@PrintService)) {
                    try {
                        NotificationManagerCompat.from(this@PrintService)
                            .notify(Notifications.SERVICE_ID, Notifications.service(this@PrintService, name, conn))
                    } catch (_: SecurityException) {
                    }
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val g = graph
        // startForeground must follow every startForegroundService() within a few seconds, even when we stop at once.
        try {
            ServiceCompat.startForeground(
                this,
                Notifications.SERVICE_ID,
                Notifications.service(this, g.state.storeName.value, g.state.connection.value),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0,
            )
        } catch (_: RuntimeException) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!g.state.paired.value) {
            stopSelf()
            return START_NOT_STICKY
        }
        Notifications.cancelReactivate(this)
        if (agentJob?.isActive != true) {
            agentJob = scope.launch {
                g.agent.run()
                stopSelf()
            }
        }
        if (updateJob?.isActive != true) {
            updateJob = scope.launch {
                while (isActive) {
                    g.checkForUpdate()
                    delay(UPDATE_INTERVAL_MS)
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000L

        @Volatile
        var running = false
            private set

        /** False when Android refused a start from the background (ForegroundServiceStartNotAllowedException). */
        fun start(context: Context): Boolean = try {
            ContextCompat.startForegroundService(context, Intent(context, PrintService::class.java))
            true
        } catch (_: IllegalStateException) {
            false
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PrintService::class.java))
        }
    }
}
