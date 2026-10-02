package br.com.vendua.impressora.update

import br.com.vendua.impressora.api.AgentJson
import br.com.vendua.impressora.api.VersionInfo
import br.com.vendua.impressora.api.await
import kotlinx.serialization.SerializationException
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

object Releases {
    private const val BASE = "https://github.com/mariajunqueiramirandas-cpu/vendua/releases/latest/download/"
    const val VERSION_JSON = BASE + "version.json"
    const val APK = BASE + "vendua-impressora.apk"
}

class UpdateChecker(private val http: OkHttpClient, private val url: String = Releases.VERSION_JSON) {
    /** The published version if it is newer than [current], else null (also on any error). */
    suspend fun newerThan(current: String): String? {
        val latest = try {
            http.newCall(Request.Builder().url(url).build()).await().use { r ->
                if (!r.isSuccessful) return null
                AgentJson.decodeFromString(VersionInfo.serializer(), r.body.string()).version
            }
        } catch (_: IOException) {
            return null
        } catch (_: SerializationException) {
            return null
        } catch (_: IllegalArgumentException) {
            return null
        }
        return latest.takeIf { SemVer.isNewer(it, current) }
    }
}
