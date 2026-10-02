package br.com.vendua.impressora.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.content.IntentCompat
import androidx.core.net.toUri
import br.com.vendua.impressora.api.await
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException

/** Downloads the release APK and hands it to PackageInstaller; any failure falls back to the browser. */
class UpdateInstaller(private val context: Context, private val http: OkHttpClient) {
    suspend fun install(): Boolean {
        val ok = try {
            val apk = download()
            withContext(Dispatchers.IO) { commit(apk) }
            true
        } catch (_: IOException) {
            false
        } catch (_: SecurityException) {
            false
        } catch (_: IllegalStateException) {
            false
        }
        if (!ok) openInBrowser(context)
        return ok
    }

    private suspend fun download(): File {
        val target = File(context.cacheDir, "update.apk")
        http.newCall(Request.Builder().url(Releases.APK).build()).await().use { r ->
            if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
            withContext(Dispatchers.IO) {
                target.outputStream().use { out -> r.body.byteStream().copyTo(out) }
            }
        }
        return target
    }

    private fun commit(apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(apk.length())
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            session.openWrite("vendua-impressora.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            // The installer fills extras (status, confirmation intent) into this PendingIntent.
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val callback = PendingIntent.getBroadcast(
                context,
                sessionId,
                Intent(context, InstallResultReceiver::class.java).setPackage(context.packageName),
                flags,
            )
            session.commit(callback.intentSender)
        }
    }

    companion object {
        fun openInBrowser(context: Context) {
            try {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Releases.APK.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: Exception) {
            }
        }
    }
}

class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                if (confirm == null) {
                    UpdateInstaller.openInBrowser(context)
                    return
                }
                try {
                    context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (_: Exception) {
                    UpdateInstaller.openInBrowser(context)
                }
            }
            PackageInstaller.STATUS_SUCCESS, PackageInstaller.STATUS_FAILURE_ABORTED -> Unit
            else -> UpdateInstaller.openInBrowser(context)
        }
    }
}
