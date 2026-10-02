package br.com.vendua.impressora

import br.com.vendua.impressora.api.ApiResult
import br.com.vendua.impressora.api.InMemoryTokenStore
import br.com.vendua.impressora.api.PairOutcome
import br.com.vendua.impressora.api.PairResponse
import br.com.vendua.impressora.api.PairingPoller
import br.com.vendua.impressora.api.ReportedPrinter
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    private val server = MockWebServer()

    @Before fun setUp() = server.start()

    @After fun tearDown() = server.close()

    private val start = PairResponse("dev-secret", "K7QD-4MXA", "https://x/parear?code=K7QD-4MXA", expiresIn = 600, interval = 0)

    @Test fun pairSendsPlatformNameAndVersion() = runBlocking {
        server.enqueue(json(200, """{"deviceCode":"dc","userCode":"K7QD-4MXA","approveUrl":"https://x","expiresIn":600,"interval":3}"""))
        val r = server.api(InMemoryTokenStore()).pair("Samsung SM-T220", "0.1.0")
        assertEquals("K7QD-4MXA", (r as ApiResult.Ok).value.userCode)
        val req = server.next()
        assertEquals("/admin/v1/agent/pair", req.url.encodedPath)
        assertEquals("""{"platform":"android","name":"Samsung SM-T220","version":"0.1.0"}""", req.text)
        assertNull(req.headers["Authorization"])
    }

    @Test fun pairingPollPendingThenApproved() = runBlocking {
        server.enqueue(json(200, """{"status":"pending"}"""))
        server.enqueue(json(200, """{"status":"pending"}"""))
        server.enqueue(json(200, """{"status":"approved","token":"tok-1","store":{"name":"Quero Pudim"}}"""))
        val tokens = InMemoryTokenStore()
        val outcome = PairingPoller(server.api(tokens), tokens, minIntervalMs = 0).await(start)

        assertEquals(PairOutcome.Approved("Quero Pudim"), outcome)
        assertEquals("tok-1", tokens.get())
        assertEquals(3, server.requestCount)
        val poll = server.next()
        assertEquals("/admin/v1/agent/pair/poll", poll.url.encodedPath)
        assertEquals("""{"deviceCode":"dev-secret"}""", poll.text)
    }

    @Test fun pairingExpires() = runBlocking {
        server.enqueue(json(200, """{"status":"pending"}"""))
        server.enqueue(json(410, """{"error":{"code":"PAIRING_EXPIRED","message":"Código expirou"}}"""))
        val tokens = InMemoryTokenStore()
        assertEquals(PairOutcome.Expired, PairingPoller(server.api(tokens), tokens, minIntervalMs = 0).await(start))
        assertNull(tokens.get())
    }

    @Test fun approvalJustAfterNominalExpiryIsStillCollected() = runBlocking {
        server.enqueue(json(200, """{"status":"pending"}"""))
        server.enqueue(json(200, """{"status":"approved","token":"tok-late","store":{"name":"Loja"}}"""))
        val tokens = InMemoryTokenStore()
        // the approving poll runs at 700 s, past the code's 600 s but inside Core's grace window
        var now = 0L
        val clock = { now.also { now += 350_000L } }
        val outcome = PairingPoller(server.api(tokens), tokens, clock = clock, minIntervalMs = 0).await(start)
        assertEquals(PairOutcome.Approved("Loja"), outcome)
        assertEquals("tok-late", tokens.get())
    }

    @Test fun pairingRateLimitWaitsAndContinues() = runBlocking {
        server.enqueue(json(429, """{"error":{"code":"RATE_LIMITED","message":""}}"""))
        server.enqueue(json(200, """{"status":"approved","token":"tok-2","store":{"name":"Loja"}}"""))
        val tokens = InMemoryTokenStore()
        val outcome = PairingPoller(server.api(tokens), tokens, minIntervalMs = 0, rateLimitWaitMs = 1).await(start)
        assertEquals(PairOutcome.Approved("Loja"), outcome)
    }

    @Test fun unauthorizedWipesToken() = runBlocking {
        server.enqueue(json(401, """{"error":{"code":"UNAUTHENTICATED","message":"Token inválido"}}"""))
        val tokens = InMemoryTokenStore("tok")
        var called = 0
        val api = server.api(tokens) { called++ }
        val r = api.putPrinters(listOf(ReportedPrinter("bt:00:11:22:33:44:55", "bluetooth", "MPT-II", "00:11:22:33:44:55")))

        assertEquals(ApiResult.HttpError(401, "UNAUTHENTICATED", "Token inválido"), r)
        assertNull(tokens.get())
        assertEquals(1, called)
        val req = server.next()
        assertEquals("PUT", req.method)
        assertTrue(req.headers["Idempotency-Key"]!!.isNotBlank())
        assertNull("no stream request once unpaired", api.streamRequest())
    }

    @Test fun putPrintersCapsTheReportedSet() = runBlocking {
        server.enqueue(json(200, """{"printers":[]}"""))
        val many = (1..60).map { ReportedPrinter("bt:$it", "bluetooth", "x".repeat(300), "$it") }
        server.api(InMemoryTokenStore("tok")).putPrinters(many)
        val body = server.next().text
        assertEquals(50, Regex("\"key\"").findAll(body).count())
        assertTrue(!body.contains("x".repeat(201)))
    }

    @Test fun badIdIsPathEncoded() = runBlocking {
        server.enqueue(json(404, """{"error":{"code":"JOB_NOT_FOUND","message":""}}"""))
        val r = server.api(InMemoryTokenStore("tok")).postJobResult("a/b", true, null)
        assertEquals(404, (r as ApiResult.HttpError).status)
        assertEquals("/admin/v1/agent/jobs/a%2Fb/result", server.next().url.encodedPath)
    }
}
