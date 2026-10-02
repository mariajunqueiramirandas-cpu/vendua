package br.com.vendua.impressora.service

import android.content.Context
import androidx.core.content.edit
import br.com.vendua.impressora.api.AgentJson
import br.com.vendua.impressora.api.Printer
import br.com.vendua.impressora.api.ReportedPrinter
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

/** Non-secret local state. The token lives in [SecureTokenStore]. */
class LocalStore(context: Context) {
    private val prefs = context.getSharedPreferences("vendua", Context.MODE_PRIVATE)

    var storeName: String
        get() = prefs.getString(STORE_NAME, "").orEmpty()
        set(value) = prefs.edit { putString(STORE_NAME, value) }

    var printers: List<Printer>
        get() = read(PRINTERS, ListSerializer(Printer.serializer())) ?: emptyList()
        set(value) = write(PRINTERS, ListSerializer(Printer.serializer()), value)

    var lastResults: Map<String, LastResult>
        get() = read(LAST_RESULTS, lastResultsSerializer) ?: emptyMap()
        set(value) = write(LAST_RESULTS, lastResultsSerializer, value)

    var pickedBluetooth: List<ReportedPrinter>
        get() = read(PICKED_BT, ListSerializer(ReportedPrinter.serializer())) ?: emptyList()
        set(value) = write(PICKED_BT, ListSerializer(ReportedPrinter.serializer()), value)

    /** Staff-only override of BuildConfig.API_BASE. */
    var apiBase: String?
        get() = prefs.getString(API_BASE, null)?.takeIf { it.isNotBlank() }
        set(value) = prefs.edit { if (value.isNullOrBlank()) remove(API_BASE) else putString(API_BASE, value.trim()) }

    fun clearStoreData() = prefs.edit {
        remove(STORE_NAME)
        remove(PRINTERS)
        remove(LAST_RESULTS)
        remove(PICKED_BT)
    }

    private fun <T> read(key: String, serializer: KSerializer<T>): T? {
        val raw = prefs.getString(key, null) ?: return null
        return try {
            AgentJson.decodeFromString(serializer, raw)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun <T> write(key: String, serializer: KSerializer<T>, value: T) =
        prefs.edit { putString(key, AgentJson.encodeToString(serializer, value)) }

    private companion object {
        const val STORE_NAME = "store_name"
        const val PRINTERS = "printers"
        const val LAST_RESULTS = "last_results"
        const val PICKED_BT = "picked_bluetooth"
        const val API_BASE = "api_base"
        val lastResultsSerializer = MapSerializer(String.serializer(), LastResult.serializer())
    }
}
