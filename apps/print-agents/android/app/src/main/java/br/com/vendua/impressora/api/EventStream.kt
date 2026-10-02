package br.com.vendua.impressora.api

import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

enum class ConnectionState { CONNECTING, ONLINE, OFFLINE }

sealed interface StreamEnd {
    data object Closed : StreamEnd
    data object Revoked : StreamEnd
    data object Unauthorized : StreamEnd
    data class Failed(val reason: String) : StreamEnd
}

/**
 * The long-lived SSE connection to Core. [http] should be the agent client; the stream copy gets a
 * 60 s read timeout, which is the spec's "no bytes for 60 s → dead" rule (Core pings every 20 s).
 */
class EventStream(
    http: OkHttpClient,
    private val api: ApiClient,
    private val clock: () -> Long = System::currentTimeMillis,
    idleTimeoutMs: Long = 60_000,
) {
    private val factory = EventSources.createFactory(
        http.newBuilder()
            .readTimeout(idleTimeoutMs, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS)
            .build(),
    )

    /** Reconnects forever; returns only when the device is no longer paired. */
    suspend fun run(
        onState: (ConnectionState) -> Unit,
        onEvent: (AgentEvent) -> Unit,
        backoff: Backoff = Backoff(),
    ) {
        while (true) {
            val request = api.streamRequest() ?: return
            onState(ConnectionState.CONNECTING)
            var openedAt = 0L
            val end = connectOnce(request, onOpen = {
                openedAt = clock()
                onState(ConnectionState.ONLINE)
            }, onEvent = onEvent)
            // A connection that lived a while was healthy: the next problem starts the backoff over.
            val wasHealthy = openedAt > 0 && clock() - openedAt >= 5_000
            if (wasHealthy) backoff.reset()
            when (end) {
                StreamEnd.Unauthorized -> {
                    api.unauthorized()
                    return
                }
                StreamEnd.Revoked -> return
                StreamEnd.Closed -> if (!wasHealthy) {
                    onState(ConnectionState.OFFLINE)
                    delay(backoff.next())
                }
                is StreamEnd.Failed -> {
                    onState(ConnectionState.OFFLINE)
                    delay(backoff.next())
                }
            }
        }
    }

    suspend fun connectOnce(
        request: Request,
        onOpen: () -> Unit = {},
        onEvent: (AgentEvent) -> Unit,
    ): StreamEnd = suspendCancellableCoroutine { cont ->
        val done = AtomicBoolean(false)
        fun finish(end: StreamEnd, source: EventSource?) {
            if (!done.compareAndSet(false, true)) return
            source?.cancel()
            cont.resume(end)
        }
        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) = onOpen()

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (done.get()) return
                val event = AgentEvent.parse(type, data) ?: return
                onEvent(event)
                if (event == AgentEvent.Revoked) finish(StreamEnd.Revoked, eventSource)
            }

            override fun onClosed(eventSource: EventSource) = finish(StreamEnd.Closed, null)

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                val code = response?.code
                finish(
                    if (code == 401) StreamEnd.Unauthorized else StreamEnd.Failed(t?.message ?: "HTTP $code"),
                    null,
                )
            }
        }
        val source = factory.newEventSource(request, listener)
        cont.invokeOnCancellation { source.cancel() }
    }
}
