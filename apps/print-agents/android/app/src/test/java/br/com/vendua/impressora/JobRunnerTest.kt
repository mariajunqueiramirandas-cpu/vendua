package br.com.vendua.impressora

import br.com.vendua.impressora.api.Backoff
import br.com.vendua.impressora.api.InMemoryTokenStore
import br.com.vendua.impressora.api.JobEvent
import br.com.vendua.impressora.api.Printer
import br.com.vendua.impressora.print.ERROR_UNKNOWN_PRINTER
import br.com.vendua.impressora.print.FinishedJob
import br.com.vendua.impressora.print.FinishedStore
import br.com.vendua.impressora.print.JobRunner
import br.com.vendua.impressora.print.PrintException
import br.com.vendua.impressora.print.ResultPoster
import br.com.vendua.impressora.print.ResultSink
import br.com.vendua.impressora.print.Transport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class JobRunnerTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val printer = Printer("p1", "tcp:10.0.0.5:9100", "tcp", "Cozinha", "10.0.0.5:9100")
    private val data = Base64.getEncoder().encodeToString("ticket".toByteArray())

    private data class Reported(val id: String, val ok: Boolean, val error: String?)

    private class RecordingSink : ResultSink {
        val reports = LinkedBlockingQueue<Reported>()
        override fun report(jobId: String, ok: Boolean, error: String?) {
            reports.add(Reported(jobId, ok, error))
        }
        fun next(): Reported = requireNotNull(reports.poll(5, TimeUnit.SECONDS)) { "no result reported" }
    }

    @After fun tearDown() = scope.cancel()

    private fun job(id: String, printerId: String = "p1") = JobEvent(id, printerId, "2026-01-01T00:00:00Z", data)

    @Test fun duplicateJobIdIsNotPrintedTwice() {
        val prints = AtomicInteger()
        val sink = RecordingSink()
        val runner = JobRunner(scope, { _, _ -> prints.incrementAndGet() }, FinishedStore(null), sink, { listOf(printer) })

        runner.submit(job("j1"))
        assertEquals(Reported("j1", true, null), sink.next())
        // Core redelivers after a reconnect: result is re-sent, ticket is not reprinted.
        runner.submit(job("j1"))
        assertEquals(Reported("j1", true, null), sink.next())
        assertEquals(1, prints.get())
    }

    @Test fun finishedStoreSurvivesRestart() {
        val dir = Files.createTempDirectory("finished").toFile()
        val file = File(dir, "finished.json")
        FinishedStore(file).put(FinishedJob("j1", false, "Bluetooth desligado"))

        val prints = AtomicInteger()
        val sink = RecordingSink()
        val runner = JobRunner(scope, { _, _ -> prints.incrementAndGet() }, FinishedStore(file), sink, { listOf(printer) })
        runner.submit(job("j1"))
        assertEquals(Reported("j1", false, "Bluetooth desligado"), sink.next())
        assertEquals(0, prints.get())
        dir.deleteRecursively()
    }

    @Test fun finishedStoreKeepsLast200() {
        val store = FinishedStore(null)
        repeat(205) { store.put(FinishedJob("j$it", true)) }
        assertNull(store.get("j4"))
        assertTrue(store.get("j5")!!.ok)
        assertTrue(store.get("j204")!!.ok)
    }

    @Test fun unknownPrinterReportsNotOk() {
        val prints = AtomicInteger()
        val sink = RecordingSink()
        val runner = JobRunner(scope, { _, _ -> prints.incrementAndGet() }, FinishedStore(null), sink, { listOf(printer) })
        runner.submit(job("j2", printerId = "nope"))
        assertEquals(Reported("j2", false, ERROR_UNKNOWN_PRINTER), sink.next())
        assertEquals(0, prints.get())
    }

    @Test fun jobsToOnePrinterRunInOrder() {
        val order = LinkedBlockingQueue<String>()
        val sink = RecordingSink()
        val runner = JobRunner(scope, { _, bytes -> order.add(String(bytes)) }, FinishedStore(null), sink, { listOf(printer) })
        val ids = (1..20).map { "j$it" }
        ids.forEach { id ->
            runner.submit(JobEvent(id, "p1", "", Base64.getEncoder().encodeToString(id.toByteArray())))
        }
        repeat(ids.size) { sink.next() }
        assertEquals(ids, order.toList())
    }

    @Test fun threeAttemptsThenFailureIsPostedWithIdempotencyKey() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(json(200, "{}"))
            val api = server.api(InMemoryTokenStore("tok"))
            val attempts = AtomicInteger()
            val transport = Transport { _, _ ->
                attempts.incrementAndGet()
                throw PrintException("Sem resposta da impressora (10.0.0.5:9100)")
            }
            val runner = JobRunner(
                scope,
                transport,
                FinishedStore(null),
                ResultPoster(scope, api),
                { listOf(printer) },
                retryDelaysMs = listOf(0, 0),
            )
            runner.submit(job("j9"))

            val req = server.next()
            assertEquals(3, attempts.get())
            assertEquals("POST", req.method)
            assertEquals("/admin/v1/agent/jobs/j9/result", req.url.encodedPath)
            assertEquals("job-result-j9", req.headers["Idempotency-Key"])
            assertEquals("Bearer tok", req.headers["Authorization"])
            assertEquals("""{"ok":false,"error":"Sem resposta da impressora (10.0.0.5:9100)"}""", req.text)
        }
    }

    @Test fun aStuckAttemptTimesOutAndTheQueueMovesOn() {
        val sink = RecordingSink()
        val prints = AtomicInteger()
        val transport = Transport { _, _ ->
            // the first job never returns, like a write to a printer that stopped reading
            if (prints.incrementAndGet() == 1) kotlinx.coroutines.awaitCancellation()
        }
        val runner = JobRunner(
            scope, transport, FinishedStore(null), sink, { listOf(printer) },
            retryDelaysMs = emptyList(), attemptTimeoutMs = 200,
        )
        runner.submit(job("stuck"))
        runner.submit(job("next"))
        val first = sink.next()
        assertEquals("stuck", first.id)
        assertFalse(first.ok)
        assertTrue(first.error!!.contains("não respondeu"))
        assertEquals(Reported("next", true, null), sink.next())
    }

    @Test fun aTcpPrinterThatStopsReadingFailsInsteadOfHanging() = runBlocking {
        java.net.ServerSocket(0).use { server ->
            // accepts, then never reads: the write fills both socket buffers and blocks
            val accepted = Thread { runCatching { server.accept() }.getOrNull()?.let { Thread.sleep(10_000) } }
            accepted.isDaemon = true
            accepted.start()
            val tcp = br.com.vendua.impressora.print.TcpTransport(connectTimeoutMs = 2_000, writeTimeoutMs = 500)
            val target = Printer("p9", "tcp:127.0.0.1:${server.localPort}", "tcp", "Balcão", "127.0.0.1:${server.localPort}")
            val started = System.nanoTime()
            val err = runCatching { tcp.send(target, ByteArray(64 * 1024 * 1024)) }.exceptionOrNull()
            assertTrue("expected a PrintException, got $err", err is PrintException)
            assertTrue((System.nanoTime() - started) / 1_000_000 < 5_000)
        }
    }

    @Test fun nonRetryableErrorStopsEarly() {
        val attempts = AtomicInteger()
        val sink = RecordingSink()
        val runner = JobRunner(
            scope,
            { _, _ ->
                attempts.incrementAndGet()
                throw PrintException("Permissão de Bluetooth negada", retryable = false)
            },
            FinishedStore(null),
            sink,
            { listOf(printer) },
            retryDelaysMs = listOf(0, 0),
        )
        runner.submit(job("j3"))
        assertEquals(Reported("j3", false, "Permissão de Bluetooth negada"), sink.next())
        assertEquals(1, attempts.get())
    }

    @Test fun resultRetriesReuseTheSameKeyAndStopOn404() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(json(503, """{"error":{"code":"UNAVAILABLE","message":""}}"""))
            server.enqueue(json(200, "{}"))
            server.enqueue(json(404, """{"error":{"code":"JOB_NOT_FOUND","message":""}}"""))
            val poster = ResultPoster(scope, server.api(InMemoryTokenStore("tok")), newBackoff = { Backoff(1, 1, 0.0) })

            assertTrue(poster.post("j5", true, null))
            val first = server.next()
            val second = server.next()
            assertEquals("job-result-j5", first.headers["Idempotency-Key"])
            assertEquals(first.headers["Idempotency-Key"], second.headers["Idempotency-Key"])

            assertTrue("404 drops the result", poster.post("gone", true, null))
            assertEquals(3, server.requestCount)
        }
    }

    @Test fun resultRetriesGiveUpAfterWindow() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            repeat(10) { server.enqueue(json(500, "{}")) }
            var now = 0L
            val poster = ResultPoster(
                scope,
                server.api(InMemoryTokenStore("tok")),
                retryWindowMs = 10 * 60_000L,
                newBackoff = { Backoff(1, 1, 0.0) },
                clock = { now.also { now += 4 * 60_000L } },
            )
            assertFalse(poster.post("j6", true, null))
        }
    }
}
