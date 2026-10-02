package br.com.vendua.impressora.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import br.com.vendua.impressora.R
import br.com.vendua.impressora.api.ConnectionState
import br.com.vendua.impressora.ui.MainActivity

object Notifications {
    const val SERVICE_ID = 1
    private const val REACTIVATE_ID = 2
    private const val CHANNEL_SERVICE = "service"
    private const val CHANNEL_ALERTS = "alerts"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SERVICE, "Impressão automática", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Mostra que o aparelho está pronto para imprimir os pedidos."
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, "Avisos", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Avisa quando a impressão automática parou."
            },
        )
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun service(context: Context, storeName: String, connection: ConnectionState): Notification {
        val title = if (storeName.isBlank()) "Impressão automática ativa" else "Impressão automática ativa — $storeName"
        val text = when (connection) {
            ConnectionState.ONLINE -> "Conectado. Os pedidos serão impressos automaticamente."
            ConnectionState.CONNECTING -> "Conectando à loja…"
            ConnectionState.OFFLINE -> "Sem conexão. Tentando de novo…"
        }
        return NotificationCompat.Builder(context, CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_print)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(openApp(context))
            .build()
    }

    fun postReactivate(context: Context) {
        if (!canPost(context)) return
        val n = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_stat_print)
            .setContentTitle("A impressão automática parou")
            .setContentText("Toque para reativar a impressão automática")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(REACTIVATE_ID, n)
        } catch (_: SecurityException) {
        }
    }

    fun cancelReactivate(context: Context) = NotificationManagerCompat.from(context).cancel(REACTIVATE_ID)

    fun canPost(context: Context): Boolean =
        android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}
