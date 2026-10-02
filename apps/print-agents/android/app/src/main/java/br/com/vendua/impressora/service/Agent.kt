package br.com.vendua.impressora.service

import br.com.vendua.impressora.api.AgentEvent
import br.com.vendua.impressora.api.ApiClient
import br.com.vendua.impressora.api.ApiResult
import br.com.vendua.impressora.api.ConnectionState
import br.com.vendua.impressora.api.EventStream
import br.com.vendua.impressora.api.ReportedPrinter
import br.com.vendua.impressora.print.JobRunner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Wires the SSE stream to the job runner and keeps [state] current. Free of Android types. */
class Agent(
    private val api: ApiClient,
    private val stream: EventStream,
    private val runner: JobRunner,
    private val state: AgentState,
    private val discover: () -> List<ReportedPrinter>,
    private val scope: CoroutineScope,
) {
    /** Runs until the device is unpaired (revoked, 401, or disconnected). */
    suspend fun run() {
        try {
            stream.run(onState = { state.connection.value = it }, onEvent = ::handle)
        } finally {
            state.connection.value = ConnectionState.OFFLINE
        }
    }

    fun handle(event: AgentEvent) {
        when (event) {
            is AgentEvent.Hello -> {
                event.event.store?.name?.let { state.storeName.value = it }
                state.printers.value = event.event.printers
                scope.launch { reportPrinters() }
            }
            is AgentEvent.Config -> state.printers.value = event.printers
            is AgentEvent.Job -> runner.submit(event.job)
            AgentEvent.Revoked -> api.unauthorized()
            AgentEvent.Ping -> Unit
        }
    }

    suspend fun reportPrinters(): Boolean {
        val result = api.putPrinters(discover())
        if (result is ApiResult.Ok) state.printers.value = result.value
        return result is ApiResult.Ok
    }
}
