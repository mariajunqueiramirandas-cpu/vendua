package br.com.vendua.impressora.api

interface TokenStore {
    fun get(): String?
    fun set(token: String)
    fun clear()
}

class InMemoryTokenStore(private var token: String? = null) : TokenStore {
    @Synchronized override fun get(): String? = token
    @Synchronized override fun set(token: String) {
        this.token = token
    }
    @Synchronized override fun clear() {
        token = null
    }
}
