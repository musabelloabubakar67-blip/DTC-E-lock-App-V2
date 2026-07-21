package com.directtrucking.elock.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val DtcRed = Color(0xFFFF473D)
val SignalGreen = Color(0xFF8BE3AA)
val SafetyAmber = Color(0xFFFFB35C)
val Ink = Color(0xFF0A0C0E)
val Paper = Color(0xFF0F1113)
val Panel = Color(0xFF14181B)
val PanelRaised = Color(0xFF191D20)
val Rule = Color(0xFF343A40)
val RuleStrong = Color(0xFF5B646C)
val IndustrialText = Color(0xFFF1F3EF)
val IndustrialMuted = Color(0xFFAEB5B8)

private val LightColors = lightColorScheme(
    primary = Color(0xFF090909),
    onPrimary = Color(0xFFEFEFEA),
    secondary = DtcRed,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFF090909),
    onSecondaryContainer = Color(0xFFEFEFEA),
    primaryContainer = Color(0xFFE4E4DE),
    onPrimaryContainer = Color(0xFF090909),
    background = Color(0xFFEFEFEA),
    onBackground = Color(0xFF090909),
    surface = Color(0xFFEFEFEA),
    onSurface = Color(0xFF090909),
    surfaceVariant = Color(0xFFE4E4DE),
    onSurfaceVariant = Color(0xFF62625D),
    outline = Color(0xFF121212),
    outlineVariant = Color(0xFF121212),
    error = Color(0xFFB91C1C),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFE8EAE6),
    onPrimary = Ink,
    secondary = DtcRed,
    onSecondary = Ink,
    secondaryContainer = Color(0xFF252B30),
    onSecondaryContainer = IndustrialText,
    primaryContainer = Color(0xFF252B30),
    onPrimaryContainer = IndustrialText,
    background = Paper,
    onBackground = IndustrialText,
    surface = Panel,
    onSurface = IndustrialText,
    surfaceVariant = PanelRaised,
    onSurfaceVariant = IndustrialMuted,
    outline = Rule,
    outlineVariant = RuleStrong,
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
        shapes = Shapes(
            extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(0.dp),
            small = androidx.compose.foundation.shape.RoundedCornerShape(0.dp),
            medium = androidx.compose.foundation.shape.RoundedCornerShape(0.dp),
            large = androidx.compose.foundation.shape.RoundedCornerShape(0.dp),
            extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(0.dp),
        ),
        typography = androidx.compose.material3.Typography(
            displaySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Black, fontSize = 52.sp, lineHeight = 46.sp),
            headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Black, fontSize = 30.sp, lineHeight = 30.sp),
            titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Black, fontSize = 21.sp, lineHeight = 24.sp),
            titleMedium = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 14.sp, lineHeight = 18.sp),
            bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 23.sp),
            bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 20.sp),
            labelLarge = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 12.sp, lineHeight = 16.sp),
            labelMedium = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 11.sp, lineHeight = 15.sp),
        ),
        content = content,
    )
}

enum class ThemeMode { System, Light, Dark }
