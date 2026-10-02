package br.com.vendua.impressora.api

import kotlinx.serialization.SerializationException

sealed interface AgentEvent {
    data class Hello(val event: HelloEvent) : AgentEvent
    data class Config(val printers: List<Printer>) : AgentEvent
    data class Job(val job: JobEvent) : AgentEvent
    data object Revoked : AgentEvent
    data object Ping : AgentEvent

    companion object {
        /** Returns null for unknown event names or malformed data, so a newer Core can't break us. */
        fun parse(type: String?, data: String): AgentEvent? = try {
            when (type) {
                "hello" -> Hello(AgentJson.decodeFromString<HelloEvent>(data))
                "config" -> Config(AgentJson.decodeFromString<ConfigEvent>(data).printers)
                "job" -> Job(AgentJson.decodeFromString<JobEvent>(data))
                "revoked" -> Revoked
                "ping" -> Ping
                else -> null
            }
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
