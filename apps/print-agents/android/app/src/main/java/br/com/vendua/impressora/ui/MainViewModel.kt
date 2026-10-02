package br.com.vendua.impressora.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import br.com.vendua.impressora.BuildConfig
import br.com.vendua.impressora.api.ApiResult
import br.com.vendua.impressora.api.PairOutcome
import br.com.vendua.impressora.api.PairingPoller
import br.com.vendua.impressora.api.Printer
import br.com.vendua.impressora.api.ReportedPrinter
import br.com.vendua.impressora.graph
import br.com.vendua.impressora.print.BluetoothCandidate
import br.com.vendua.impressora.print.PrinterDiscovery
import br.com.vendua.impressora.print.UsbCandidate
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface PairingUi {
    data object Idle : PairingUi
    data object Starting : PairingUi
    data class Showing(val userCode: String, val approveUrl: String, val expiresAt: Long) : PairingUi
    data object Expired : PairingUi
    data class Error(val message: String) : PairingUi
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val g = app.graph
    val state = g.state

    private val _pairing = MutableStateFlow<PairingUi>(PairingUi.Idle)
    val pairing = _pairing.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val messages = _messages.asSharedFlow()

    private val _testing = MutableStateFlow<Set<String>>(emptySet())
    val testing = _testing.asStateFlow()

    private val _updating = MutableStateFlow(false)
    val updating = _updating.asStateFlow()

    private val _pickedBluetooth = MutableStateFlow(g.store.pickedBluetooth)
    val pickedBluetooth = _pickedBluetooth.asStateFlow()

    private var pairJob: Job? = null

    init {
        viewModelScope.launch { g.checkForUpdate() }
    }

    fun startPairing() {
        pairJob?.cancel()
        pairJob = viewModelScope.launch {
            _pairing.value = PairingUi.Starting
            when (val r = g.api.pair(deviceName(), BuildConfig.VERSION_NAME)) {
                is ApiResult.Ok -> {
                    val p = r.value
                    _pairing.value = PairingUi.Showing(p.userCode, p.approveUrl, System.currentTimeMillis() + p.expiresIn * 1_000L)
                    when (val outcome = PairingPoller(g.api, g.tokens).await(p)) {
                        is PairOutcome.Approved -> {
                            _pairing.value = PairingUi.Idle
                            g.onPaired(outcome.storeName)
                        }
                        PairOutcome.Expired -> _pairing.value = PairingUi.Expired
                    }
                }
                is ApiResult.HttpError -> _pairing.value = PairingUi.Error(
                    if (r.status == 429) {
                        "Muitas tentativas seguidas. Aguarde um minuto e tente de novo."
                    } else {
                        "Não foi possível gerar o código agora (erro ${r.status}). Tente de novo em instantes."
                    },
                )
                is ApiResult.NetworkError -> _pairing.value =
                    PairingUi.Error("Sem conexão com a internet. Confira o Wi-Fi e tente de novo.")
            }
        }
    }

    fun cancelPairing() {
        pairJob?.cancel()
        _pairing.value = PairingUi.Idle
    }

    fun testPrint(printer: Printer) {
        if (printer.id in _testing.value) return
        viewModelScope.launch {
            _testing.update { it + printer.id }
            val msg = when (val r = g.api.testPrinter(printer.id)) {
                is ApiResult.Ok -> "Teste enviado para ${printer.name}."
                is ApiResult.HttpError -> r.message.ifBlank { "Não foi possível enviar o teste (erro ${r.status})." }
                is ApiResult.NetworkError -> "Sem conexão com a internet. Tente de novo."
            }
            _testing.update { it - printer.id }
            _messages.tryEmit(msg)
        }
    }

    fun addBluetooth(candidate: BluetoothCandidate) {
        val printer = PrinterDiscovery.bluetoothPrinter(candidate)
        val next = _pickedBluetooth.value.filterNot { it.key == printer.key } + printer
        savePicked(next)
        _messages.tryEmit("${candidate.name} adicionada.")
    }

    fun removeBluetooth(key: String) {
        savePicked(_pickedBluetooth.value.filterNot { it.key == key })
    }

    private fun savePicked(list: List<ReportedPrinter>) {
        g.store.pickedBluetooth = list
        _pickedBluetooth.value = list
        g.reportPrintersAsync()
    }

    fun addUsb(candidate: UsbCandidate) {
        if (candidate.permitted) {
            g.reportPrintersAsync()
            _messages.tryEmit("${candidate.name} adicionada.")
        } else {
            g.usbPermission.request(candidate.device, force = true)
        }
    }

    fun refreshPrinters() = g.reportPrintersAsync()

    fun usbCandidates(): List<UsbCandidate> = g.discovery.usbCandidates()

    fun bondedBluetooth(): List<BluetoothCandidate> = g.discovery.bondedBluetooth()

    fun disconnect() {
        viewModelScope.launch {
            when (val r = g.api.disconnect()) {
                is ApiResult.Ok -> g.onUnpaired()
                is ApiResult.HttpError -> if (r.status == 401 || r.status == 404) {
                    g.onUnpaired()
                } else {
                    _messages.tryEmit("Não foi possível desconectar agora (erro ${r.status}). Tente de novo.")
                }
                is ApiResult.NetworkError -> _messages.tryEmit("Sem conexão com a internet. Conecte-se para desconectar.")
            }
        }
    }

    fun installUpdate() {
        if (_updating.value) return
        viewModelScope.launch {
            _updating.value = true
            g.updateInstaller.install()
            _updating.value = false
        }
    }

    fun apiBase(): String = g.apiBase()

    fun setApiBase(value: String?) {
        g.store.apiBase = value
        _messages.tryEmit("Servidor: ${g.apiBase()}")
    }

    private fun deviceName(): String = "${Build.MANUFACTURER} ${Build.MODEL}".take(60)
}
