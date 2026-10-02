package br.com.vendua.impressora

import android.app.Application
import android.content.Context
import br.com.vendua.impressora.api.ApiClient
import br.com.vendua.impressora.api.ConnectionState
import br.com.vendua.impressora.api.EventStream
import br.com.vendua.impressora.api.agentHttpClient
import br.com.vendua.impressora.print.BluetoothTransport
import br.com.vendua.impressora.print.FinishedStore
import br.com.vendua.impressora.print.JobRunner
import br.com.vendua.impressora.print.PrinterDiscovery
import br.com.vendua.impressora.print.ResultPoster
import br.com.vendua.impressora.print.TcpTransport
import br.com.vendua.impressora.print.TransportRouter
import br.com.vendua.impressora.print.UsbTransport
import br.com.vendua.impressora.service.Agent
import br.com.vendua.impressora.service.AgentState
import br.com.vendua.impressora.service.LastResult
import br.com.vendua.impressora.service.LocalStore
import br.com.vendua.impressora.service.Notifications
import br.com.vendua.impressora.service.PrintService
import br.com.vendua.impressora.service.SecureTokenStore
import br.com.vendua.impressora.service.UsbPermission
import br.com.vendua.impressora.service.WatchdogWorker
import br.com.vendua.impressora.update.UpdateChecker
import br.com.vendua.impressora.update.UpdateInstaller
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File

class VenduaApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        Notifications.createChannels(this)
        WatchdogWorker.schedule(this)
    }
}

val Context.graph: AppGraph get() = (applicationContext as VenduaApp).graph

/** Process-wide singletons shared by the service, receivers and UI. */
class AppGraph(private val context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val store = LocalStore(context)
    val tokens = SecureTokenStore(context)
    val http = agentHttpClient(BuildConfig.VERSION_NAME)
    val api = ApiClient(http, ::apiBase, tokens, onUnauthorized = ::onUnpaired)
    val usbPermission = UsbPermission(context)
    val discovery = PrinterDiscovery(context) { store.pickedBluetooth }
    val updateInstaller = UpdateInstaller(context, http)

    val state = AgentState().apply {
        paired.value = tokens.get() != null
        storeName.value = store.storeName
        printers.value = store.printers
        lastResults.value = store.lastResults
    }

    private val runner = JobRunner(
        scope = scope,
        transport = TransportRouter(
            mapOf(
                "tcp" to TcpTransport(),
                "usb" to UsbTransport(context) { usbPermission.request(it) },
                "bluetooth" to BluetoothTransport(context),
            ),
        ),
        finished = FinishedStore(File(context.filesDir, "finished-jobs.json")),
        results = ResultPoster(scope, api),
        printers = { state.printers.value },
        onFinished = { printerId, ok, error ->
            state.lastResults.update { it + (printerId to LastResult(ok, error, System.currentTimeMillis())) }
        },
    )

    val agent = Agent(api, EventStream(http, api), runner, state, discovery::discover, scope)
    private val updates = UpdateChecker(http)

    init {
        scope.launch { state.storeName.drop(1).collect { store.storeName = it } }
        scope.launch { state.printers.drop(1).collect { store.printers = it } }
        scope.launch { state.lastResults.drop(1).collect { store.lastResults = it } }
    }

    fun apiBase(): String = store.apiBase ?: BuildConfig.API_BASE

    fun onPaired(storeName: String) {
        state.storeName.value = storeName
        state.paired.value = true
        PrintService.start(context)
    }

    fun onUnpaired() {
        tokens.clear()
        state.paired.value = false
        state.connection.value = ConnectionState.OFFLINE
        state.printers.value = emptyList()
        state.lastResults.value = emptyMap()
        state.storeName.value = ""
        store.clearStoreData()
        PrintService.stop(context)
    }

    fun reportPrintersAsync() {
        if (state.paired.value) scope.launch { agent.reportPrinters() }
    }

    suspend fun checkForUpdate() {
        state.availableUpdate.value = updates.newerThan(BuildConfig.VERSION_NAME)
    }
}
