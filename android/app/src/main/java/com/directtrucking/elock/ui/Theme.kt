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

val DtcRed = Color(0xFFFF4D43)
val SignalGreen = Color(0xFF62DEA0)
val SafetyAmber = Color(0xFFF4B85A)
val Ink = Color(0xFF080C0F)
val Paper = Color(0xFF0B1013)
val Panel = Color(0xFF12181C)
val PanelRaised = Color(0xFF192126)
val Rule = Color(0xFF29343A)
val RuleStrong = Color(0xFF3C494F)
val IndustrialText = Color(0xFFF5F7F7)
val IndustrialMuted = Color(0xFFA4AFB4)

private val LightColors = lightColorScheme(
    primary = Color(0xFF111A1E),
    onPrimary = Color(0xFFF8FAF9),
    secondary = DtcRed,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFE8E5),
    onSecondaryContainer = Color(0xFF711C17),
    primaryContainer = Color(0xFFE7ECEA),
    onPrimaryContainer = Color(0xFF111A1E),
    background = Color(0xFFF3F5F3),
    onBackground = Color(0xFF111A1E),
    surface = Color(0xFFFCFDFC),
    onSurface = Color(0xFF111A1E),
    surfaceVariant = Color(0xFFE9EEEB),
    onSurfaceVariant = Color(0xFF58646A),
    outline = Color(0xFFD2DAD6),
    outlineVariant = Color(0xFFE3E8E5),
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
            extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(5.dp),
            small = androidx.compose.foundation.shape.RoundedCornerShape(7.dp),
            medium = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
            large = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
            extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
        ),
        typography = androidx.compose.material3.Typography(
            displaySmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Black, fontSize = 40.sp, lineHeight = 44.sp),
            headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.ExtraBold, fontSize = 30.sp, lineHeight = 34.sp),
            titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, lineHeight = 28.sp),
            titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
            bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 24.sp),
            bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 21.sp),
            labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 13.sp, lineHeight = 18.sp),
            labelMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 17.sp),
        ),
        content = content,
    )
}

enum class ThemeMode { System, Light, Dark }
