package br.com.vendua.impressora.print

import br.com.vendua.impressora.api.AgentJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.io.IOException

@Serializable
data class FinishedJob(val id: String, val ok: Boolean, val error: String? = null)

/**
 * The last [capacity] finished job ids with their result. Core delivers at least once, so a job
 * seen here is never printed again; its result is just re-sent.
 */
class FinishedStore(private val file: File?, private val capacity: Int = 200) {
    private val entries = LinkedHashMap<String, FinishedJob>()

    init {
        load()
    }

    @Synchronized
    fun get(id: String): FinishedJob? = entries[id]

    @Synchronized
    fun put(job: FinishedJob) {
        entries.remove(job.id)
        entries[job.id] = job
        while (entries.size > capacity) entries.remove(entries.keys.first())
        save()
    }

    private fun load() {
        val f = file ?: return
        if (!f.exists()) return
        try {
            AgentJson.decodeFromString(ListSerializer(FinishedJob.serializer()), f.readText())
                .takeLast(capacity)
                .forEach { entries[it.id] = it }
        } catch (_: IOException) {
        } catch (_: SerializationException) {
        } catch (_: IllegalArgumentException) {
        }
    }

    private fun save() {
        val f = file ?: return
        try {
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeText(AgentJson.encodeToString(ListSerializer(FinishedJob.serializer()), entries.values.toList()))
            if (!tmp.renameTo(f)) {
                f.delete()
                tmp.renameTo(f)
            }
        } catch (_: IOException) {
        }
    }
}
