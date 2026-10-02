package br.com.vendua.impressora.service

import br.com.vendua.impressora.api.ConnectionState
import br.com.vendua.impressora.api.Printer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable

@Serializable
data class LastResult(val ok: Boolean, val error: String? = null, val at: Long)

/** Process-wide state the service writes and the UI reads. */
class AgentState {
    val paired = MutableStateFlow(false)
    val storeName = MutableStateFlow("")
    val connection = MutableStateFlow(ConnectionState.OFFLINE)
    val printers = MutableStateFlow<List<Printer>>(emptyList())
    val lastResults = MutableStateFlow<Map<String, LastResult>>(emptyMap())
    val availableUpdate = MutableStateFlow<String?>(null)
}
