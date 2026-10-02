package br.com.vendua.impressora.service

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.core.content.edit
import br.com.vendua.impressora.api.TokenStore
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The device token, AES/GCM-encrypted with a non-exportable AndroidKeyStore key. */
class SecureTokenStore(context: Context) : TokenStore {
    private val prefs = context.getSharedPreferences("vendua_secure", Context.MODE_PRIVATE)

    @Volatile private var cached: String? = null

    @Volatile private var loaded = false

    @Synchronized
    override fun get(): String? {
        if (!loaded) {
            cached = decrypt(prefs.getString(TOKEN, null))
            loaded = true
        }
        return cached
    }

    @Synchronized
    override fun set(token: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val ct = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val enc = Base64.getEncoder()
        prefs.edit(commit = true) { putString(TOKEN, enc.encodeToString(cipher.iv) + ":" + enc.encodeToString(ct)) }
        cached = token
        loaded = true
    }

    @Synchronized
    override fun clear() {
        prefs.edit(commit = true) { remove(TOKEN) }
        cached = null
        loaded = true
    }

    private fun decrypt(stored: String?): String? {
        if (stored == null) return null
        return try {
            val (iv, ct) = stored.split(':', limit = 2).map { Base64.getDecoder().decode(it) }
            val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            }
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (_: GeneralSecurityException) {
            // Key lost (e.g. restored backup on a new device): the merchant pairs again.
            prefs.edit { remove(TOKEN) }
            null
        } catch (_: IllegalArgumentException) {
            prefs.edit { remove(TOKEN) }
            null
        } catch (_: IndexOutOfBoundsException) {
            prefs.edit { remove(TOKEN) }
            null
        }
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "vendua_device_token"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TOKEN = "token"
    }
}
