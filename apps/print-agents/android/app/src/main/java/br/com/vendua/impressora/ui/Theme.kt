package br.com.vendua.impressora.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Warm terracotta accent on warm neutrals; container roles are set explicitly so cards don't fall back
// to the baseline (lavender) neutrals.
private val Light = lightColorScheme(
    primary = Color(0xFFA9481F),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFFFDBCC),
    onPrimaryContainer = Color(0xFF390C00),
    secondary = Color(0xFF77574A),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFFFDBCF),
    onSecondaryContainer = Color(0xFF2C160D),
    tertiary = Color(0xFF6A5E2F),
    onTertiary = Color(0xFFFFFFFF),
    background = Color(0xFFFFF8F5),
    onBackground = Color(0xFF231A16),
    surface = Color(0xFFFFF8F5),
    onSurface = Color(0xFF231A16),
    surfaceVariant = Color(0xFFF5DED5),
    onSurfaceVariant = Color(0xFF53433D),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFFF1EB),
    surfaceContainer = Color(0xFFFCEAE3),
    surfaceContainerHigh = Color(0xFFF6E5DD),
    surfaceContainerHighest = Color(0xFFF0DFD7),
    surfaceBright = Color(0xFFFFF8F5),
    surfaceDim = Color(0xFFE8D6CF),
    outline = Color(0xFF85736C),
    outlineVariant = Color(0xFFD8C2BA),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFFFB59A),
    onPrimary = Color(0xFF5A1B00),
    primaryContainer = Color(0xFF853512),
    onPrimaryContainer = Color(0xFFFFDBCC),
    secondary = Color(0xFFE7BDAD),
    onSecondary = Color(0xFF442A1F),
    secondaryContainer = Color(0xFF5D4034),
    onSecondaryContainer = Color(0xFFFFDBCF),
    tertiary = Color(0xFFD7C68D),
    onTertiary = Color(0xFF3A3005),
    background = Color(0xFF1A120E),
    onBackground = Color(0xFFF0DFD8),
    surface = Color(0xFF1A120E),
    onSurface = Color(0xFFF0DFD8),
    surfaceVariant = Color(0xFF53433D),
    onSurfaceVariant = Color(0xFFD8C2BA),
    surfaceContainerLowest = Color(0xFF140D0A),
    surfaceContainerLow = Color(0xFF231A16),
    surfaceContainer = Color(0xFF271E1A),
    surfaceContainerHigh = Color(0xFF322824),
    surfaceContainerHighest = Color(0xFF3D332E),
    surfaceBright = Color(0xFF423733),
    surfaceDim = Color(0xFF1A120E),
    outline = Color(0xFFA08D86),
    outlineVariant = Color(0xFF53433D),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
)

@Immutable
data class StatusColors(val ok: Color, val warn: Color, val idle: Color)

private val LightStatus = StatusColors(ok = Color(0xFF2E7D32), warn = Color(0xFFB26A00), idle = Color(0xFF85736C))
private val DarkStatus = StatusColors(ok = Color(0xFF81C784), warn = Color(0xFFFFB74D), idle = Color(0xFFA08D86))

val LocalStatusColors = staticCompositionLocalOf { LightStatus }

@Composable
fun VenduaTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val scheme: ColorScheme = if (dark) Dark else Light
    androidx.compose.runtime.CompositionLocalProvider(LocalStatusColors provides if (dark) DarkStatus else LightStatus) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
