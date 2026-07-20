package com.directtrucking.elock.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val DtcRed = Color(0xFFE32020)
val SignalGreen = Color(0xFF0B8F46)
val SafetyAmber = Color(0xFFF0A000)
val Ink = Color(0xFF17191A)
val Paper = Color(0xFFF1F1EC)
val Rule = Color(0xFFD2D3CD)

private val LightColors = lightColorScheme(
    primary = Ink,
    onPrimary = Color.White,
    secondary = DtcRed,
    onSecondary = Color.White,
    background = Paper,
    onBackground = Ink,
    surface = Color(0xFFF9F9F5),
    onSurface = Ink,
    surfaceVariant = Color(0xFFE7E7E1),
    onSurfaceVariant = Color(0xFF545650),
    outline = Rule,
    error = Color(0xFFB91C1C),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFF2F2ED),
    onPrimary = Ink,
    secondary = Color(0xFFFF5353),
    onSecondary = Ink,
    background = Color(0xFF111314),
    onBackground = Color(0xFFF2F2ED),
    surface = Color(0xFF1A1D1E),
    onSurface = Color(0xFFF2F2ED),
    surfaceVariant = Color(0xFF25292A),
    onSurfaceVariant = Color(0xFFC4C7C1),
    outline = Color(0xFF3D4142),
    error = Color(0xFFFF6B6B),
)

@Composable
fun DtcTheme(mode: ThemeMode, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
    }
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        typography = androidx.compose.material3.Typography(
            displaySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Black, fontSize = 38.sp, lineHeight = 40.sp),
            headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Black, fontSize = 28.sp, lineHeight = 31.sp),
            titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 24.sp),
            titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 17.sp, lineHeight = 21.sp),
            bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 23.sp),
            bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 20.sp),
            labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 18.sp),
            labelMedium = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 12.sp, lineHeight = 16.sp),
        ),
        content = content,
    )
}

enum class ThemeMode { System, Light, Dark }
