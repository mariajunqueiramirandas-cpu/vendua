package br.com.vendua.impressora.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.UUID

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class HttpError(val status: Int, val code: String, val message: String) : ApiResult<Nothing>
    data class NetworkError(val cause: IOException) : ApiResult<Nothing>
}

class ApiClient(
    private val http: OkHttpClient,
    private val baseUrl: () -> String,
    private val tokens: TokenStore,
    private val onUnauthorized: () -> Unit = {},
) {
    private val jsonType = "application/json".toMediaType()

    suspend fun pair(name: String, version: String): ApiResult<PairResponse> = send(
        post("admin/v1/agent/pair", PairRequest(PLATFORM, name.take(60), version), PairRequest.serializer()),
        PairResponse.serializer(),
        authenticated = false,
    )

    suspend fun poll(deviceCode: String): ApiResult<PollResponse> = send(
        post("admin/v1/agent/pair/poll", PollRequest(deviceCode), PollRequest.serializer()),
        PollResponse.serializer(),
        authenticated = false,
    )

    suspend fun postJobResult(jobId: String, ok: Boolean, error: String?): ApiResult<Unit> = send(
        post(
            url("admin/v1/agent/jobs", jobId, "result"),
            JobResultBody(ok, if (ok) null else error?.take(200)),
            JobResultBody.serializer(),
        ).header("Idempotency-Key", "job-result-$jobId".take(200)),
        null,
    )

    suspend fun putPrinters(printers: List<ReportedPrinter>): ApiResult<List<Printer>> {
        val body = PrintersBody(printers.take(50).map {
            ReportedPrinter(it.key.take(200), it.kind.take(200), it.name.take(200), it.address.take(200))
        })
        val req = Request.Builder()
            .url(url("admin/v1/agent/printers"))
            .put(encode(body, PrintersBody.serializer(ReportedPrinter.serializer())))
            .header("Idempotency-Key", UUID.randomUUID().toString())
        return when (val r = send(req, PrintersBody.serializer(Printer.serializer()))) {
            is ApiResult.Ok -> ApiResult.Ok(r.value.printers)
            is ApiResult.HttpError -> r
            is ApiResult.NetworkError -> r
        }
    }

    suspend fun testPrinter(printerId: String): ApiResult<TestPrintResponse> = send(
        Request.Builder()
            .url(url("admin/v1/agent/printers", printerId, "test"))
            .post(ByteArray(0).toRequestBody(null))
            .header("Idempotency-Key", UUID.randomUUID().toString()),
        TestPrintResponse.serializer(),
    )

    suspend fun disconnect(): ApiResult<Unit> = send(
        Request.Builder()
            .url(url("admin/v1/agent/self"))
            .delete()
            .header("Idempotency-Key", UUID.randomUUID().toString()),
        null,
    )

    /** The SSE request; the caller owns the stream lifecycle. Null when unpaired. */
    fun streamRequest(): Request? {
        val token = tokens.get() ?: return null
        return Request.Builder()
            .url(url("admin/v1/agent/stream"))
            .header("Authorization", "Bearer $token")
            .header("Accept", "text/event-stream")
            .get()
            .build()
    }

    /** Called by the stream on a 401: same handling as any other authenticated call. */
    fun unauthorized() {
        tokens.clear()
        onUnauthorized()
    }

    private fun url(path: String, vararg segments: String): HttpUrl {
        val b = baseUrl().trimEnd('/').toHttpUrl().newBuilder().addPathSegments(path)
        segments.forEach { b.addPathSegment(it) }
        return b.build()
    }

    private fun <T> encode(value: T, serializer: KSerializer<T>): RequestBody =
        AgentJson.encodeToString(serializer, value).toRequestBody(jsonType)

    private fun <T> post(path: String, body: T, serializer: KSerializer<T>) = post(url(path), body, serializer)

    private fun <T> post(url: HttpUrl, body: T, serializer: KSerializer<T>): Request.Builder =
        Request.Builder().url(url).post(encode(body, serializer))

    @Suppress("UNCHECKED_CAST")
    private suspend fun <T> send(
        builder: Request.Builder,
        serializer: KSerializer<T>?,
        authenticated: Boolean = true,
    ): ApiResult<T> {
        if (authenticated) {
            val token = tokens.get() ?: return ApiResult.HttpError(401, "UNAUTHENTICATED", "Aparelho não conectado")
            builder.header("Authorization", "Bearer $token")
        }
        val response = try {
            http.newCall(builder.build()).await()
        } catch (e: IOException) {
            return ApiResult.NetworkError(e)
        }
        return response.use {
            val text = try {
                it.body.string()
            } catch (e: IOException) {
                return ApiResult.NetworkError(e)
            }
            if (!it.isSuccessful) {
                val err = try {
                    AgentJson.decodeFromString(ErrorEnvelope.serializer(), text).error
                } catch (_: SerializationException) {
                    ErrorBody()
                } catch (_: IllegalArgumentException) {
                    ErrorBody()
                }
                if (it.code == 401 && authenticated) unauthorized()
                return ApiResult.HttpError(it.code, err.code, err.message)
            }
            if (serializer == null) return ApiResult.Ok(Unit as T)
            try {
                ApiResult.Ok(AgentJson.decodeFromString(serializer, text))
            } catch (e: SerializationException) {
                ApiResult.HttpError(it.code, "BAD_RESPONSE", e.message ?: "")
            } catch (e: IllegalArgumentException) {
                ApiResult.HttpError(it.code, "BAD_RESPONSE", e.message ?: "")
            }
        }
    }
}
