package br.com.vendua.impressora.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

val AgentJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

@Serializable
data class Printer(
    val id: String,
    val key: String,
    val kind: String,
    val name: String,
    val address: String = "",
)

/** A printer as this device discovers it, before Core assigns an id. */
@Serializable
data class ReportedPrinter(
    val key: String,
    val kind: String,
    val name: String,
    val address: String,
)

@Serializable
data class StoreInfo(val name: String)

@Serializable
data class DeviceInfo(val id: String, val name: String)

@Serializable
data class PairRequest(val platform: String, val name: String, val version: String)

@Serializable
data class PairResponse(
    val deviceCode: String,
    val userCode: String,
    val approveUrl: String,
    val expiresIn: Int,
    val interval: Int,
)

@Serializable
data class PollRequest(val deviceCode: String)

@Serializable
data class PollResponse(val status: String, val token: String? = null, val store: StoreInfo? = null)

@Serializable
data class JobResultBody(val ok: Boolean, val error: String? = null)

@Serializable
data class PrintersBody<T>(val printers: List<T>)

@Serializable
data class TestPrintResponse(val jobId: String)

@Serializable
data class ErrorBody(val code: String = "", val message: String = "")

@Serializable
data class ErrorEnvelope(val error: ErrorBody)

@Serializable
data class HelloEvent(
    val device: DeviceInfo? = null,
    val store: StoreInfo? = null,
    val printers: List<Printer> = emptyList(),
)

@Serializable
data class ConfigEvent(val printers: List<Printer> = emptyList())

@Serializable
data class JobEvent(
    val id: String,
    val printerId: String,
    val createdAt: String = "",
    val data: String,
)

@Serializable
data class VersionInfo(val version: String)
