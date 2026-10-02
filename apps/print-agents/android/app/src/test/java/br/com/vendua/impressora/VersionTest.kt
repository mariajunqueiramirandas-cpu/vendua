package br.com.vendua.impressora

import br.com.vendua.impressora.api.Backoff
import br.com.vendua.impressora.print.TcpTransport
import br.com.vendua.impressora.update.SemVer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class VersionTest {
    @Test fun semverCompare() {
        assertTrue(SemVer.isNewer("0.1.1", "0.1.0"))
        assertTrue(SemVer.isNewer("0.10.0", "0.9.9"))
        assertTrue(SemVer.isNewer("1.0.0", "0.99.99"))
        assertTrue(SemVer.isNewer("v2.0.0", "1.9.0"))
        assertFalse(SemVer.isNewer("0.1.0", "0.1.0"))
        assertFalse(SemVer.isNewer("0.0.9", "0.1.0"))
        assertFalse(SemVer.isNewer("garbage", "0.1.0"))
        assertFalse(SemVer.isNewer("1.2", "0.1.0"))
        assertEquals(0, SemVer.compare("1.2.3-beta", "1.2.3"))
        assertNull(SemVer.parse("1.-2.3"))
    }

    @Test fun versionCodeDerivation() {
        assertEquals(100, SemVer.versionCode("0.1.0"))
        assertEquals(10203, SemVer.versionCode("1.2.3"))
        assertEquals(129999, SemVer.versionCode("12.99.99"))
    }

    @Test fun buildUsesSharedVersionFile() {
        // Unit tests run from the app module directory: android/app → ../../VERSION.
        val shared = File("../../VERSION").readText().trim()
        assertEquals(shared, BuildConfig.VERSION_NAME)
        assertEquals(SemVer.versionCode(shared), BuildConfig.VERSION_CODE)
        assertEquals("https://painel.vendua.com.br", BuildConfig.API_BASE)
    }

    @Test fun backoffDoublesToCapWithJitter() {
        val plain = Backoff(jitter = 0.0)
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), List(7) { plain.next() })
        plain.reset()
        assertEquals(1_000L, plain.next())
        val jittered = Backoff()
        repeat(50) { jittered.reset(); assertTrue(jittered.next() in 800L..1_200L) }
    }

    @Test fun tcpAddressParsing() {
        assertEquals("192.168.0.50" to 9100, TcpTransport.parseHostPort("192.168.0.50"))
        assertEquals("192.168.0.50" to 9101, TcpTransport.parseHostPort("192.168.0.50:9101"))
        assertEquals("fe80::1" to 9100, TcpTransport.parseHostPort("[fe80::1]"))
        assertEquals("fe80::1" to 9100, TcpTransport.parseHostPort("fe80::1"))
        assertNull(TcpTransport.parseHostPort("host:99999"))
        assertNull(TcpTransport.parseHostPort(""))
    }
}
