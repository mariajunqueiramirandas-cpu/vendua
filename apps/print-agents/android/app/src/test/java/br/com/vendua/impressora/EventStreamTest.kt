package br.com.vendua.impressora

import br.com.vendua.impressora.api.AgentEvent
import br.com.vendua.impressora.api.EventStream
import br.com.vendua.impressora.api.InMemoryTokenStore
import br.com.vendua.impressora.api.StreamEnd
import br.com.vendua.impressora.api.agentHttpClient
import br.com.vendua.impressora.print.FinishedStore
import br.com.vendua.impressora.print.JobRunner
import br.com.vendua.impressora.print.ResultPoster
import br.com.vendua.impressora.print.Transport
import br.com.vendua.impressora.service.Agent
import br.com.vendua.impressora.service.AgentState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class EventStreamTest {
    private val server = MockWebServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Before fun setUp() = server.start()

    @After fun tearDown() {
        scope.cancel()
        server.close()
    }

    @Test fun parsesEveryEventType() {
        val hello = AgentEvent.parse(
            "hello",
            """{"device":{"id":"d1","name":"Tab"},"store":{"name":"Quero Pudim"},"printers":[{"id":"p1","key":"tcp:10.0.0.5:9100","kind":"tcp","name":"Cozinha","address":"10.0.0.5:9100"}],"extra":1}""",
        ) as AgentEvent.Hello
        assertEquals("Quero Pudim", hello.event.store?.name)
        assertEquals("p1", hello.event.printers.single().id)

        val config = AgentEvent.parse("config", """{"printers":[]}""") as AgentEvent.Config
        assertTrue(config.printers.isEmpty())

        val job = AgentEvent.parse("job", """{"id":"j1","printerId":"p1","createdAt":"2026-01-01T00:00:00Z","data":"G0A="}""") as AgentEvent.Job
        assertEquals("j1", job.job.id)

        assertEquals(AgentEvent.Revoked, AgentEvent.parse("revoked", "{}"))
        assertEquals(AgentEvent.Ping, AgentEvent.parse("ping", "{}"))
        assertNull(AgentEvent.parse("future-event", "{}"))
        assertNull(AgentEvent.parse("job", "{not json"))
        assertNull(AgentEvent.parse("job", """{"id":"j1"}"""))
    }

    @Test fun streamedJobIsPrintedAndReported() = runBlocking {
        val bytes = byteArrayOf(0x1B, 0x40, 'O'.code.toByte(), 'i'.code.toByte(), 0x0A)
        val b64 = Base64.getEncoder().encodeToString(bytes)
        val printer = """{"id":"p1","key":"tcp:10.0.0.5:9100","kind":"tcp","name":"Cozinha","address":"10.0.0.5:9100"}"""
        val requests = LinkedBlockingQueue<RecordedRequest>()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests.add(request)
                val path = request.url.encodedPath
                return when {
                    path == "/admin/v1/agent/stream" -> sse(
                        "hello" to """{"device":{"id":"d1","name":"Tab"},"store":{"name":"Quero Pudim"},"printers":[$printer]}""",
                        "ping" to "{}",
                        "job" to """{"id":"j1","printerId":"p1","createdAt":"2026-01-01T00:00:00Z","data":"$b64"}""",
                    )
                    path == "/admin/v1/agent/printers" -> json(200, """{"printers":[$printer]}""")
                    path == "/admin/v1/agent/jobs/j1/result" -> json(200, "{}")
                    else -> json(404, """{"error":{"code":"NOT_FOUND","message":""}}""")
                }
            }
        }
        val tokens = InMemoryTokenStore("tok")
        val api = server.api(tokens)
        val printed = CompletableDeferred<ByteArray>()
        val transport = Transport { p, data ->
            assertEquals("p1", p.id)
            printed.complete(data)
        }
        val state = AgentState()
        val runner = JobRunner(scope, transport, FinishedStore(null), ResultPoster(scope, api), { state.printers.value })
        val agent = Agent(api, EventStream(agentHttpClient("0.1.0"), api), runner, state, { emptyList() }, scope)
        val stream = EventStream(agentHttpClient("0.1.0"), api)

        val end = stream.connectOnce(requireNotNull(api.streamRequest()), onEvent = agent::handle)

        assertEquals(StreamEnd.Closed, end)
        assertEquals("Quero Pudim", state.storeName.value)
        assertArrayEquals(bytes, withTimeout(5_000) { printed.await() })

        val seen = mutableListOf<RecordedRequest>()
        while (seen.none { it.url.encodedPath.endsWith("/result") } || seen.none { it.method == "PUT" }) {
            seen += requireNotNull(requests.poll(5, TimeUnit.SECONDS)) { "result never posted; saw ${seen.map { it.url }}" }
        }
        val stream0 = seen.first { it.url.encodedPath == "/admin/v1/agent/stream" }
        assertEquals("Bearer tok", stream0.headers["Authorization"])
        assertEquals("android", stream0.headers["X-Agent-Platform"])
        assertEquals("0.1.0", stream0.headers["X-Agent-Version"])
        assertEquals("VenduaImpressora/0.1.0 (android)", stream0.headers["User-Agent"])
        assertTrue("hello triggers a printer report", seen.any { it.method == "PUT" && it.url.encodedPath == "/admin/v1/agent/printers" })
        val result = seen.first { it.url.encodedPath.endsWith("/result") }
        assertEquals("job-result-j1", result.headers["Idempotency-Key"])
        assertEquals("""{"ok":true}""", result.text)
    }

    @Test fun stream401WipesTokenAndStops() = runBlocking {
        server.enqueue(json(401, """{"error":{"code":"DEVICE_REVOKED","message":"Aparelho removido"}}"""))
        val tokens = InMemoryTokenStore("tok")
        var unauthorized = false
        val api = server.api(tokens) { unauthorized = true }
        withTimeout(5_000) {
            EventStream(agentHttpClient("0.1.0"), api).run(onState = {}, onEvent = {})
        }
        assertNull(tokens.get())
        assertTrue(unauthorized)
    }

    @Test fun revokedEventEndsTheStream() = runBlocking {
        server.enqueue(sse("revoked" to "{}"))
        val tokens = InMemoryTokenStore("tok")
        val api = server.api(tokens)
        val state = AgentState()
        val runner = JobRunner(scope, { _, _ -> }, FinishedStore(null), { _, _, _ -> }, { emptyList() })
        val agent = Agent(api, EventStream(agentHttpClient("0.1.0"), api), runner, state, { emptyList() }, scope)
        withTimeout(5_000) { agent.run() }
        assertNull(tokens.get())
    }
}
