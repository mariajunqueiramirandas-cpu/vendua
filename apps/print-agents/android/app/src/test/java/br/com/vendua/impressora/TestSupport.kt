package br.com.vendua.impressora

import br.com.vendua.impressora.api.ApiClient
import br.com.vendua.impressora.api.TokenStore
import br.com.vendua.impressora.api.agentHttpClient
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import java.util.concurrent.TimeUnit

fun json(code: Int, body: String): MockResponse =
    MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

fun sse(vararg events: Pair<String, String>): MockResponse = MockResponse.Builder()
    .code(200)
    .addHeader("Content-Type", "text/event-stream")
    .body(events.joinToString("") { (name, data) -> "event: $name\ndata: $data\n\n" })
    .build()

fun MockWebServer.api(tokens: TokenStore, onUnauthorized: () -> Unit = {}) =
    ApiClient(agentHttpClient("0.1.0"), { url("/").toString() }, tokens, onUnauthorized)

fun MockWebServer.next(): RecordedRequest = requireNotNull(takeRequest(5, TimeUnit.SECONDS)) { "no request arrived" }

val RecordedRequest.text: String get() = body?.utf8().orEmpty()
