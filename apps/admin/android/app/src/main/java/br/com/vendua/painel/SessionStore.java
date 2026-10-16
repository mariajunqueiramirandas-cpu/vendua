package br.com.vendua.painel;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The admin session token (ADR 0044 §3), encrypted with a Keystore key that never leaves the
 * phone. No user-auth requirement on the key: "Aceitar" on the lock screen must read it.
 */
final class SessionStore {
    private static final String ALIAS = "vendua-session";
    private static final String PREFS = "vendua-session";

    private SessionStore() {}

    static synchronized void set(Context c, String token, String apiOrigin) {
        SharedPreferences.Editor e = prefs(c).edit();
        if (apiOrigin != null) e.putString("api", apiOrigin);
        if (token == null) e.remove("token");
        else {
            try {
                e.putString("token", seal(token));
            } catch (Exception err) {
                e.remove("token");
            }
        }
        e.apply();
    }

    static synchronized String token(Context c) {
        String sealed = prefs(c).getString("token", null);
        if (sealed == null) return null;
        try {
            return open(sealed);
        } catch (Exception err) {
            // a restored backup or a reset Keystore: the key is gone, so is the session
            prefs(c).edit().remove("token").apply();
            return null;
        }
    }

    static String apiOrigin(Context c) {
        return prefs(c).getString("api", "https://painel.vendua.com.br");
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return g.generateKey();
    }

    private static String seal(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private static String open(String sealed) throws Exception {
        String[] p = sealed.split(":", 2);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
}
