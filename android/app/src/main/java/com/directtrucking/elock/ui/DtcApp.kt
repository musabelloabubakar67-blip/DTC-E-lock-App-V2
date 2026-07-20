package com.directtrucking.elock.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HomeRepairService
import androidx.compose.material.icons.outlined.InstallMobile
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.directtrucking.elock.core.DashboardSnapshot
import com.directtrucking.elock.core.DashboardCounts
import com.directtrucking.elock.core.DashboardTrust
import com.directtrucking.elock.core.DtcApi
import com.directtrucking.elock.core.FeedItem
import com.directtrucking.elock.core.InstallationItem
import com.directtrucking.elock.core.LookupSnapshot
import com.directtrucking.elock.core.RegistryItem
import com.directtrucking.elock.core.ReviewItem
import com.directtrucking.elock.core.NativeUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.NumberFormat

enum class AppScreen(val label: String, val icon: ImageVector) {
    Dashboard("Dashboard", Icons.Outlined.Dashboard),
    Register("Register", Icons.Outlined.AddBox),
    Install("Install", Icons.Outlined.Build),
    Lookup("Lookup", Icons.Outlined.Search),
    Review("Review", Icons.Outlined.ListAlt),
    Settings("Settings", Icons.Outlined.Settings),
}

data class NativeUiState(
    val booting: Boolean = true,
    val working: Boolean = false,
    val dashboard: DashboardSnapshot? = null,
    val selected: AppScreen = AppScreen.Dashboard,
    val registry: List<RegistryItem> = emptyList(),
    val registryTotal: Int = 0,
    val installations: List<InstallationItem> = emptyList(),
    val installationTotal: Int = 0,
    val reviews: List<ReviewItem> = emptyList(),
    val lookup: LookupSnapshot? = null,
    val message: String? = null,
    val error: String? = null,
    val themeMode: ThemeMode = ThemeMode.System,
)

class DtcViewModel(private val api: DtcApi, private val demo: Boolean = false) : ViewModel() {
    private val _state = MutableStateFlow(if (demo) demoState() else NativeUiState())
    val state = _state.asStateFlow()

    init {
        if (!demo) {
            viewModelScope.launch {
                runCatching { api.restoreSession() }
                    .onSuccess { dashboard -> _state.update { it.copy(booting = false, dashboard = dashboard) } }
                    .onFailure { error -> _state.update { it.copy(booting = false, error = error.message) } }
            }
        }
    }

    fun login(username: String, password: String) = launchWork {
        val dashboard = api.login(username, password)
        _state.update { it.copy(dashboard = dashboard, selected = AppScreen.Dashboard, message = "Signed in") }
    }

    fun logout() {
        api.logout()
        _state.update { NativeUiState(booting = false, themeMode = it.themeMode) }
    }

    fun open(screen: AppScreen) {
        _state.update { it.copy(selected = screen, message = null, error = null) }
        if (demo) return
        when (screen) {
            AppScreen.Register -> loadRegistry()
            AppScreen.Install -> loadInstallations()
            AppScreen.Review -> loadReviews()
            else -> Unit
        }
    }

    fun refreshDashboard() = launchWork {
        if (demo) return@launchWork
        _state.update { it.copy(dashboard = api.bootstrap(), message = "Workspace refreshed") }
    }

    fun loadRegistry(query: String = "") = launchWork {
        if (demo) return@launchWork
        val (items, total) = api.registry(query)
        _state.update { it.copy(registry = items, registryTotal = total) }
    }

    fun loadInstallations(query: String = "") = launchWork {
        if (demo) return@launchWork
        val (items, total) = api.installationHistory(query)
        _state.update { it.copy(installations = items, installationTotal = total) }
    }

    fun loadReviews() = launchWork {
        if (demo) return@launchWork
        _state.update { it.copy(reviews = api.reviews()) }
    }

    fun lookup(query: String) = launchWork {
        if (demo) {
            _state.update { it.copy(message = "Demo lookup loaded for ${query.uppercase()}") }
            return@launchWork
        }
        _state.update { it.copy(lookup = api.lookup(query)) }
    }

    fun register(mother: String, subs: List<String>, sim: String, done: () -> Unit) = launchWork {
        if (demo) {
            _state.update { it.copy(message = "Demo registration complete - no data was written") }
            done()
            return@launchWork
        }
        api.registerKit(mother, subs, sim)
        val (items, total) = api.registry()
        _state.update { it.copy(registry = items, registryTotal = total, message = "Kit registered") }
        done()
    }

    fun install(truck: String, company: String, mother: String, subs: List<String>, status: String, done: () -> Unit) = launchWork {
        if (demo) {
            _state.update { it.copy(message = "Demo installation complete - no data was written") }
            done()
            return@launchWork
        }
        api.installKit(truck, company, mother, subs, status)
        val (items, total) = api.installationHistory()
        _state.update { it.copy(installations = items, installationTotal = total, message = "Installation recorded") }
        done()
    }

    fun review(id: String, action: String, notes: String) = launchWork {
        if (demo) {
            _state.update { current -> current.copy(reviews = current.reviews.filterNot { it.id == id }, message = "Demo review updated") }
            return@launchWork
        }
        api.reviewAction(id, action, notes)
        _state.update { it.copy(reviews = api.reviews(), message = "Review ${if (action == "resolve") "resolved" else "dismissed"}") }
    }

    fun changePassword(current: String, next: String, confirm: String, done: () -> Unit) = launchWork {
        if (demo) {
            _state.update { it.copy(message = "Password was not changed in demo mode") }
            done()
            return@launchWork
        }
        api.changePassword(current, next, confirm)
        _state.update { it.copy(message = "Password changed. Sign in again on your other devices.") }
        done()
    }

    fun setTheme(mode: ThemeMode) = _state.update { it.copy(themeMode = mode) }
    fun clearNotice() = _state.update { it.copy(message = null, error = null) }

    private fun launchWork(block: suspend () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(working = true, error = null) }
            runCatching { block() }
                .onFailure { error -> _state.update { it.copy(error = error.message ?: "Something went wrong") } }
            _state.update { it.copy(working = false) }
        }
    }
}

@Composable
fun DtcNativeApp(demo: Boolean = false) {
    val context = LocalContext.current
    val factory = remember {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = DtcViewModel(DtcApi(context), demo) as T
        }
    }
    val model: DtcViewModel = viewModel(factory = factory)
    val state by model.state.collectAsStateWithLifecycle()

    DtcTheme(state.themeMode) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when {
                state.booting -> LoadingScreen("Opening secure workspace")
                state.dashboard == null -> LoginScreen(state.working, state.error, model::login)
                else -> NativeWorkspace(state, model)
            }
        }
    }
}

@Composable
private fun LoadingScreen(label: String) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        DtcMark()
        Spacer(Modifier.height(28.dp))
        CircularProgressIndicator(color = DtcRed)
        Spacer(Modifier.height(14.dp))
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun LoginScreen(working: Boolean, error: String?, login: (String, String) -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding().padding(20.dp)) {
        val wide = maxWidth >= 700.dp
        val loginWidth = if (wide) 430.dp else maxWidth
        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            if (wide) {
                Column(Modifier.weight(1f).padding(36.dp), verticalArrangement = Arrangement.Center) {
                    DtcMark()
                    Spacer(Modifier.height(42.dp))
                    Text("FLEET CONTROL,\nWITHOUT THE NOISE.", style = MaterialTheme.typography.displaySmall)
                    Spacer(Modifier.height(16.dp))
                    Text("Native field operations for DTC E-Lock teams.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Surface(
                modifier = Modifier.width(loginWidth).padding(if (wide) 24.dp else 0.dp),
                shape = RoundedCornerShape(2.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            ) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (!wide) DtcMark()
                    Text("SECURE ACCESS", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                    Text("Sign in", style = MaterialTheme.typography.headlineMedium)
                    OutlinedTextField(username, { username = it }, Modifier.fillMaxWidth(), label = { Text("Username") }, singleLine = true)
                    OutlinedTextField(
                        password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Password") }, singleLine = true,
                        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = { IconButton(onClick = { visible = !visible }) { Icon(if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, "Toggle password") } },
                    )
                    if (error != null) StatusStrip(error, true)
                    Button(
                        onClick = { login(username, password) },
                        enabled = username.isNotBlank() && password.isNotBlank() && !working,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(2.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DtcRed),
                    ) { if (working) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White) else Text("ENTER WORKSPACE") }
                    Text("Session credentials are encrypted on this device.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NativeWorkspace(state: NativeUiState, model: DtcViewModel) {
    var moreOpen by remember { mutableStateOf(false) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val tablet = maxWidth >= 600.dp || (maxWidth >= 500.dp && maxHeight >= 760.dp)
        val compactTablet = maxWidth < 700.dp
        if (tablet) {
            Row(Modifier.fillMaxSize().statusBarsPadding()) {
                TabletRail(state, compactTablet, model::open, model::logout)
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    TopBar(state, model::refreshDashboard)
                    ScreenContent(state, model, Modifier.weight(1f))
                }
            }
        } else {
            Scaffold(
                contentWindowInsets = WindowInsets.safeDrawing,
                topBar = { TopBar(state, model::refreshDashboard) },
                bottomBar = { PhoneNav(state.selected, model::open) { moreOpen = true } },
            ) { padding -> ScreenContent(state, model, Modifier.padding(padding)) }
        }
    }
    if (moreOpen) {
        ModalBottomSheet(onDismissRequest = { moreOpen = false }) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
                Text("MORE OPERATIONS", Modifier.padding(horizontal = 20.dp, vertical = 10.dp), style = MaterialTheme.typography.labelMedium, color = DtcRed)
                listOf(AppScreen.Review, AppScreen.Settings).forEach { screen ->
                    NavRow(screen, state.selected == screen) { model.open(screen); moreOpen = false }
                }
            }
        }
    }
}

@Composable
private fun TopBar(state: NativeUiState, refresh: () -> Unit) {
    Surface(color = Ink, contentColor = Color.White) {
        Row(Modifier.fillMaxWidth().height(62.dp).padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            DtcMark(compact = true, light = true)
            Spacer(Modifier.weight(1f))
            if (state.working) CircularProgressIndicator(Modifier.size(18.dp), color = DtcRed, strokeWidth = 2.dp)
            IconButton(onClick = refresh) { Icon(Icons.Outlined.Refresh, "Refresh") }
            Column(horizontalAlignment = Alignment.End) {
                Text(state.dashboard?.user?.name.orEmpty(), style = MaterialTheme.typography.labelLarge, maxLines = 1)
                Text(state.dashboard?.user?.role?.uppercase().orEmpty(), style = MaterialTheme.typography.labelMedium, color = Color(0xFFB9BDB9))
            }
        }
    }
}

@Composable
private fun TabletRail(state: NativeUiState, compact: Boolean, open: (AppScreen) -> Unit, logout: () -> Unit) {
    Surface(Modifier.width(if (compact) 76.dp else 184.dp).fillMaxHeight(), color = Ink, contentColor = Color.White) {
        Column(Modifier.fillMaxSize().padding(vertical = 12.dp)) {
            Text(if (compact) "OPS" else "OPS / NATIVE", Modifier.padding(horizontal = 18.dp, vertical = 18.dp), style = MaterialTheme.typography.labelMedium, color = DtcRed)
            AppScreen.entries.forEach { screen ->
                if (screen != AppScreen.Review || state.dashboard?.user?.role == "supervisor") {
                    if (compact) {
                        Box(
                            Modifier.fillMaxWidth().clickable { open(screen) }
                                .background(if (state.selected == screen) DtcRed.copy(alpha = .28f) else Color.Transparent)
                                .padding(vertical = 16.dp),
                            contentAlignment = Alignment.Center,
                        ) { Icon(screen.icon, screen.label, tint = if (state.selected == screen) DtcRed else Color.White.copy(alpha = .82f)) }
                    } else NavRow(screen, state.selected == screen, dark = true) { open(screen) }
                }
            }
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth().clickable(onClick = logout).padding(18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = if (compact) Arrangement.Center else Arrangement.Start) {
                Icon(Icons.Outlined.Logout, null, Modifier.size(20.dp))
                if (!compact) { Spacer(Modifier.width(12.dp)); Text("Sign out", style = MaterialTheme.typography.labelLarge) }
            }
        }
    }
}

@Composable
private fun NavRow(screen: AppScreen, active: Boolean, dark: Boolean = false, onClick: () -> Unit) {
    val activeColor = if (dark) Color.White else MaterialTheme.colorScheme.onSurface
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick)
            .background(if (active) DtcRed.copy(alpha = if (dark) .26f else .12f) else Color.Transparent)
            .padding(horizontal = 18.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (active) Box(Modifier.width(3.dp).height(22.dp).background(DtcRed))
        if (active) Spacer(Modifier.width(9.dp)) else Spacer(Modifier.width(12.dp))
        Icon(screen.icon, null, Modifier.size(21.dp), tint = if (active) DtcRed else activeColor.copy(alpha = .8f))
        Spacer(Modifier.width(12.dp))
        Text(screen.label, style = MaterialTheme.typography.labelLarge, color = activeColor)
    }
}

@Composable
private fun PhoneNav(selected: AppScreen, open: (AppScreen) -> Unit, more: () -> Unit) {
    Surface(shadowElevation = 12.dp, color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(66.dp), horizontalArrangement = Arrangement.SpaceAround) {
            listOf(AppScreen.Dashboard, AppScreen.Register, AppScreen.Install, AppScreen.Lookup).forEach { screen ->
                PhoneNavItem(screen.label, screen.icon, selected == screen) { open(screen) }
            }
            PhoneNavItem("More", Icons.Outlined.MoreHoriz, selected == AppScreen.Review || selected == AppScreen.Settings, more)
        }
    }
}

@Composable
private fun PhoneNavItem(label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.clickable(onClick = onClick).padding(horizontal = 9.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, label, Modifier.size(23.dp), tint = if (selected) DtcRed else MaterialTheme.colorScheme.onSurfaceVariant)
        Text(label, style = MaterialTheme.typography.labelMedium, color = if (selected) DtcRed else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ScreenContent(state: NativeUiState, model: DtcViewModel, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        if (state.error != null) StatusStrip(state.error, true, model::clearNotice)
        else if (state.message != null) StatusStrip(state.message, false, model::clearNotice)
        when (state.selected) {
            AppScreen.Dashboard -> DashboardScreen(state.dashboard!!, model::open)
            AppScreen.Register -> RegisterScreen(state, model)
            AppScreen.Install -> InstallScreen(state, model)
            AppScreen.Lookup -> LookupScreen(state.lookup, model::lookup)
            AppScreen.Review -> ReviewScreen(state, model)
            AppScreen.Settings -> SettingsScreen(state, model)
        }
    }
}

@Composable
private fun StatusStrip(message: String, error: Boolean, close: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().background(if (error) DtcRed else SignalGreen).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (error) Icons.Outlined.ErrorOutline else Icons.Outlined.CheckCircle, null, tint = Color.White)
        Text(message, Modifier.padding(horizontal = 10.dp).weight(1f), color = Color.White, style = MaterialTheme.typography.labelLarge)
        if (close != null) IconButton(onClick = close) { Icon(Icons.Outlined.Close, "Dismiss", tint = Color.White) }
    }
}

@Composable
private fun PageHeader(kicker: String, title: String, detail: String) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 18.dp)) {
        Text(kicker.uppercase(), style = MaterialTheme.typography.labelMedium, color = DtcRed)
        Text(title, style = MaterialTheme.typography.headlineMedium)
        Text(detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DashboardScreen(data: DashboardSnapshot, open: (AppScreen) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { PageHeader("Fleet operational register", "Fleet ${number(data.counts.inServiceMothers)}", "${number(data.counts.availableMothers)} mother locks remain available for assignment.") }
        item {
            Surface(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp), shape = RoundedCornerShape(2.dp),
                color = when (data.healthTone) { "danger" -> DtcRed.copy(alpha = .11f); "warning" -> SafetyAmber.copy(alpha = .14f); else -> SignalGreen.copy(alpha = .11f) },
                border = BorderStroke(1.dp, when (data.healthTone) { "danger" -> DtcRed; "warning" -> SafetyAmber; else -> SignalGreen }),
            ) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (data.healthTone == "ok") Icons.Outlined.Shield else Icons.Outlined.Warning, null, tint = if (data.healthTone == "ok") SignalGreen else DtcRed)
                    Column(Modifier.padding(start = 14.dp).weight(1f)) { Text(data.healthTitle, style = MaterialTheme.typography.titleMedium); Text(data.healthDetail, style = MaterialTheme.typography.bodyMedium) }
                    if (data.counts.openReviews > 0) IconButton(onClick = { open(AppScreen.Review) }) { Icon(Icons.Outlined.ChevronRight, "Open reviews") }
                }
            }
        }
        item {
            FlowRow(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 3) {
                Metric("Registered kits", data.counts.registeredKits, Icons.Outlined.AddBox)
                Metric("In service", data.counts.inServiceMothers, Icons.Outlined.InstallMobile, SignalGreen)
                Metric("Available", data.counts.availableMothers, Icons.Outlined.Lock)
                Metric("Open reviews", data.counts.openReviews, Icons.Outlined.ListAlt, if (data.counts.openReviews > 0) DtcRed else null)
                Metric("Repair pool", data.counts.pendingRepair, Icons.Outlined.HomeRepairService, if (data.counts.pendingRepair > 0) SafetyAmber else null)
                Metric("Active trucks", data.counts.trucks, Icons.Outlined.Build)
            }
        }
        item {
            SectionTitle("Quick operations")
            LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf(AppScreen.Lookup, AppScreen.Register, AppScreen.Install, AppScreen.Review)) { screen ->
                    OutlinedButton(onClick = { open(screen) }, shape = RoundedCornerShape(2.dp)) { Icon(screen.icon, null); Spacer(Modifier.width(8.dp)); Text(screen.label) }
                }
            }
        }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth().padding(20.dp)) {
                if (maxWidth >= 650.dp) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TrustPanel(data, Modifier.weight(1f)); FeedPanel("Recent registrations", data.registrations, Modifier.weight(1f)); FeedPanel("Attention queue", data.reviews, Modifier.weight(1f))
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { TrustPanel(data); FeedPanel("Recent registrations", data.registrations); FeedPanel("Attention queue", data.reviews) }
                }
            }
        }
    }
}

@Composable
private fun Metric(label: String, value: Int, icon: ImageVector, accent: Color? = null) {
    Surface(Modifier.width(164.dp), shape = RoundedCornerShape(2.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
        Column(Modifier.padding(14.dp)) {
            Icon(icon, null, tint = accent ?: MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
            Text(number(value), style = MaterialTheme.typography.headlineMedium)
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun TrustPanel(data: DashboardSnapshot, modifier: Modifier = Modifier) = Panel("Trust posture", modifier) {
    ValueLine("Verified", data.trust.verified.toString(), SignalGreen)
    ValueLine("Stale", data.trust.stale.toString(), SafetyAmber)
    ValueLine("Unverified", data.trust.unverified.toString(), DtcRed)
    ValueLine("Active trucks", data.trust.total.toString())
}

@Composable
private fun FeedPanel(title: String, feed: List<com.directtrucking.elock.core.FeedItem>, modifier: Modifier = Modifier) = Panel(title, modifier) {
    if (feed.isEmpty()) Text("No current items.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    feed.take(5).forEach { item ->
        Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) { Text(item.title.replace('_', ' '), style = MaterialTheme.typography.labelLarge); Text(item.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Divider()
    }
}

@Composable
private fun RegisterScreen(state: NativeUiState, model: DtcViewModel) {
    var query by remember { mutableStateOf("") }
    var mother by remember { mutableStateOf("") }
    var sim by remember { mutableStateOf("") }
    var subs by remember { mutableStateOf(listOf("", "", "")) }
    var scanTarget by remember { mutableStateOf<Int?>(null) }
    var showForm by remember { mutableStateOf(true) }
    LaunchedEffect(query) { delay(350); model.loadRegistry(query) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Inventory intake", "Register", "Create an unassigned four-lock kit and keep the full registry searchable.") }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                val twoPane = maxWidth >= 760.dp
                if (twoPane) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    RegisterForm(mother, { mother = it }, subs, { i, value -> subs = subs.toMutableList().also { it[i] = value } }, sim, { sim = it }, { scanTarget = it }, state.working, {
                        model.register(mother, subs, sim) { mother = ""; subs = listOf("", "", ""); sim = "" }
                    }, Modifier.weight(.8f))
                    RegistryArchive(state, query, { query = it }, Modifier.weight(1.2f))
                } else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = { showForm = !showForm }, Modifier.fillMaxWidth(), shape = RoundedCornerShape(2.dp)) { Icon(if (showForm) Icons.Outlined.Close else Icons.Outlined.AddBox, null); Spacer(Modifier.width(8.dp)); Text(if (showForm) "Collapse registration form" else "New registration") }
                    if (showForm) RegisterForm(mother, { mother = it }, subs, { i, value -> subs = subs.toMutableList().also { it[i] = value } }, sim, { sim = it }, { scanTarget = it }, state.working, {
                        model.register(mother, subs, sim) { mother = ""; subs = listOf("", "", ""); sim = "" }
                    })
                    RegistryArchive(state, query, { query = it })
                }
            }
        }
    }
    scanTarget?.let { target ->
        val label = if (target == 0) "mother lock" else "sub-lock ${'A' + target}"
        ScannerDialog(label, onScanned = { value -> if (value.isNotBlank()) { if (target == 0) mother = value else subs = subs.toMutableList().also { it[target - 1] = value } }; scanTarget = null }, onDismiss = { scanTarget = null })
    }
}

@Composable
private fun RegisterForm(
    mother: String, setMother: (String) -> Unit, subs: List<String>, setSub: (Int, String) -> Unit,
    sim: String, setSim: (String) -> Unit, scan: (Int) -> Unit, working: Boolean, submit: () -> Unit, modifier: Modifier = Modifier,
) = Panel("New kit", modifier) {
    ScanField("Mother lock", mother, setMother) { scan(0) }
    subs.forEachIndexed { index, value -> ScanField("Sub-lock ${listOf("B", "C", "D")[index]}", value, { setSub(index, it) }) { scan(index + 1) } }
    OutlinedTextField(sim, setSim, Modifier.fillMaxWidth(), label = { Text("SIM number") }, singleLine = true)
    Button(
        onClick = submit, enabled = !working && mother.isNotBlank() && subs.all(String::isNotBlank) && sim.isNotBlank(),
        modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(2.dp), colors = ButtonDefaults.buttonColors(containerColor = DtcRed),
    ) { Text("REGISTER KIT") }
}

@Composable
private fun RegistryArchive(state: NativeUiState, query: String, search: (String) -> Unit, modifier: Modifier = Modifier) = Panel("Registered kits / ${number(state.registryTotal)}", modifier) {
    SearchField(query, search, "Search serial, SIM or installer")
    if (state.registry.isEmpty()) EmptyState("No kits match this search.")
    state.registry.forEach { item ->
        Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f)) {
            Column(Modifier.padding(12.dp)) {
                Row(Modifier.fillMaxWidth()) { Text(item.mother, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(item.ownership.replace('_', ' ').uppercase(), style = MaterialTheme.typography.labelMedium, color = if (item.ownership == "owned") SignalGreen else DtcRed) }
                Text("B/C/D  ${item.subs.joinToString("  /  ")}", style = MaterialTheme.typography.bodyMedium)
                Text("SIM ${item.sim}  ·  ${item.actor}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(7.dp))
    }
}

@Composable
private fun InstallScreen(state: NativeUiState, model: DtcViewModel) {
    val context = LocalContext.current
    var query by remember { mutableStateOf("") }
    var truck by remember { mutableStateOf("") }
    var mother by remember { mutableStateOf("") }
    var subs by remember { mutableStateOf(listOf("", "", "")) }
    var company by remember { mutableStateOf("mrs") }
    var status by remember { mutableStateOf("successful") }
    var scanTarget by remember { mutableStateOf<Int?>(null) }
    var shareReady by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val message = remember(truck, company, mother, subs) { installMessage(truck, company, mother, subs) }
    LaunchedEffect(query) { delay(350); model.loadInstallations(query) }
    LaunchedEffect(shareReady) { if (shareReady) { delay(100); listState.animateScrollToItem(2) } }

    LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Field assignment", "Install", "Confirm the visible truck and lock serials. Internal database IDs stay hidden.") }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                if (maxWidth >= 760.dp) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    InstallForm(truck, { truck = it }, company, { company = it }, mother, { mother = it }, subs, { i, v -> subs = subs.toMutableList().also { it[i] = v } }, status, { status = it }, { scanTarget = it }, state.working, {
                        model.install(truck, company, mother, subs, status) { shareReady = true }
                    }, Modifier.weight(.85f))
                    InstallationArchive(state, query, { query = it }, Modifier.weight(1.15f))
                } else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    InstallForm(truck, { truck = it }, company, { company = it }, mother, { mother = it }, subs, { i, v -> subs = subs.toMutableList().also { it[i] = v } }, status, { status = it }, { scanTarget = it }, state.working, {
                        model.install(truck, company, mother, subs, status) { shareReady = true }
                    })
                    InstallationArchive(state, query, { query = it })
                }
            }
        }
        if (shareReady) item {
            LaunchedEffect(Unit) { /* LazyColumn brings newly inserted trailing content into the active layout. */ }
            Panel("Send installation report", Modifier.fillMaxWidth().padding(20.dp)) {
                Text(message, style = MaterialTheme.typography.bodyLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { openWhatsApp(context, message); shareReady = false }, shape = RoundedCornerShape(2.dp), colors = ButtonDefaults.buttonColors(containerColor = SignalGreen)) { Text("SEND TO WHATSAPP") }
                    OutlinedButton(onClick = { shareReady = false }, shape = RoundedCornerShape(2.dp)) { Text("Dismiss") }
                }
            }
        }
    }
    scanTarget?.let { target ->
        val label = if (target == 0) "mother lock" else "sub-lock ${listOf("B", "C", "D")[target - 1]}"
        ScannerDialog(label, onScanned = { value -> if (value.isNotBlank()) { if (target == 0) mother = value else subs = subs.toMutableList().also { it[target - 1] = value } }; scanTarget = null }, onDismiss = { scanTarget = null })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InstallForm(
    truck: String, setTruck: (String) -> Unit, company: String, setCompany: (String) -> Unit,
    mother: String, setMother: (String) -> Unit, subs: List<String>, setSub: (Int, String) -> Unit,
    status: String, setStatus: (String) -> Unit, scan: (Int) -> Unit, working: Boolean, submit: () -> Unit,
    modifier: Modifier = Modifier,
) = Panel("Installation workbench", modifier) {
    OutlinedTextField(truck, setTruck, Modifier.fillMaxWidth(), label = { Text("Truck plate") }, singleLine = true)
    Text("SERVING COMPANY", style = MaterialTheme.typography.labelMedium)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("mrs" to "MRS", "dangote" to "Dangote").forEach { (value, label) -> FilterChip(company == value, { setCompany(value) }, { Text(label) }) }
    }
    ScanField("Mother lock", mother, setMother) { scan(0) }
    subs.forEachIndexed { index, value -> ScanField("Sub-lock ${listOf("B", "C", "D")[index]}", value, { setSub(index, it) }) { scan(index + 1) } }
    Text("COMPLETION STATUS", style = MaterialTheme.typography.labelMedium)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("successful" to "Successful", "completed_with_issues" to "With issues", "failed" to "Failed").forEach { (value, label) -> FilterChip(status == value, { setStatus(value) }, { Text(label) }) }
    }
    Button(
        onClick = submit, enabled = !working && truck.isNotBlank() && mother.isNotBlank() && subs.all(String::isNotBlank),
        modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(2.dp), colors = ButtonDefaults.buttonColors(containerColor = DtcRed),
    ) { Text("RECORD INSTALLATION") }
}

@Composable
private fun InstallationArchive(state: NativeUiState, query: String, search: (String) -> Unit, modifier: Modifier = Modifier) = Panel("Installation history / ${number(state.installationTotal)}", modifier) {
    SearchField(query, search, "Search truck or lock serial")
    if (state.installations.isEmpty()) EmptyState("No installation events match this search.")
    state.installations.forEach { item ->
        Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .45f)) {
            Column(Modifier.padding(12.dp)) {
                Row(Modifier.fillMaxWidth()) { Text(item.truck, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(item.status.replace('_', ' ').uppercase(), style = MaterialTheme.typography.labelMedium, color = SignalGreen) }
                Text("Mother  ${item.mother}")
                Text("B/C/D  ${item.subs.joinToString("  /  ")}", style = MaterialTheme.typography.bodyMedium)
                Text(item.actor, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(7.dp))
    }
}

@Composable
private fun LookupScreen(result: LookupSnapshot?, lookup: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Single source of truth", "Lookup", "Search by truck plate or mother-lock serial.") }
        item {
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(query, { query = it }, Modifier.weight(1f), label = { Text("Truck or mother serial") }, singleLine = true)
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { lookup(query) }, enabled = query.isNotBlank(), modifier = Modifier.height(56.dp), shape = RoundedCornerShape(2.dp), colors = ButtonDefaults.buttonColors(containerColor = DtcRed)) { Icon(Icons.Outlined.Search, "Search") }
                }
                if (result == null) EmptyState("Enter a truck plate or mother serial to inspect its current state.")
                else if (result.targetKind == "unknown") EmptyState("No registered truck or mother lock matched ${result.label}.")
                else {
                    BoxWithConstraints(Modifier.fillMaxWidth()) {
                        if (maxWidth >= 650.dp) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            LookupIdentity(result, Modifier.weight(1f)); LookupKit(result, Modifier.weight(1f))
                        } else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { LookupIdentity(result); LookupKit(result) }
                    }
                    FeedPanel("Audit trail", result.audit)
                }
            }
        }
    }
}

@Composable
private fun LookupIdentity(result: LookupSnapshot, modifier: Modifier = Modifier) = Panel("Current state", modifier) {
    Text(result.label, style = MaterialTheme.typography.headlineMedium)
    ValueLine("Target", result.targetKind.replace('_', ' '))
    ValueLine("Serving company", result.company)
    ValueLine("Trust", result.trust.uppercase(), if (result.trust == "verified") SignalGreen else SafetyAmber)
    ValueLine("Open reviews", result.reviews.toString(), if (result.reviews > 0) DtcRed else null)
}

@Composable
private fun LookupKit(result: LookupSnapshot, modifier: Modifier = Modifier) = Panel("Assigned kit", modifier) {
    ValueLine("Mother", result.mother ?: "Not assigned")
    result.subs.forEach { (slot, serial) -> ValueLine("Sub-lock $slot", serial ?: "Not assigned") }
}

@Composable
private fun ReviewScreen(state: NativeUiState, model: DtcViewModel) {
    if (state.dashboard?.user?.role != "supervisor") {
        Column(Modifier.fillMaxSize()) { PageHeader("Supervisor control", "Review", "Conflict decisions are restricted to supervisors."); EmptyState("Your installer account can see operational state but cannot resolve reviews.") }
        return
    }
    var selected by remember { mutableStateOf<ReviewItem?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Exception control", "Open reviews / ${state.reviews.size}", "Inspect the full imported or observed payload before deciding.") }
        if (state.reviews.isEmpty()) item { EmptyState("No reviews need attention.") }
        items(state.reviews, key = { it.id }) { review ->
            Surface(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 5.dp).clickable { selected = review },
                shape = RoundedCornerShape(2.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            ) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Warning, null, tint = DtcRed)
                    Column(Modifier.padding(horizontal = 14.dp).weight(1f)) {
                        Text(review.kind.replace('_', ' ').uppercase(), style = MaterialTheme.typography.titleMedium)
                        Text(review.payload, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.Outlined.ChevronRight, null)
                }
            }
        }
    }
    selected?.let { review -> ReviewDialog(review, onDismiss = { selected = null }) { action, notes -> model.review(review.id, action, notes); selected = null } }
}

@Composable
private fun ReviewDialog(review: ReviewItem, onDismiss: () -> Unit, action: (String, String) -> Unit) {
    var notes by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(review.kind.replace('_', ' ').uppercase()) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("REVIEW PAYLOAD", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                Text(review.payload, style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("Decision notes") }, minLines = 3)
            }
        },
        confirmButton = { Button(onClick = { action("resolve", notes) }, colors = ButtonDefaults.buttonColors(containerColor = SignalGreen), shape = RoundedCornerShape(2.dp)) { Text("Resolve") } },
        dismissButton = { Row { TextButton(onClick = { action("dismiss", notes) }) { Text("Dismiss review") }; TextButton(onClick = onDismiss) { Text("Cancel") } } },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SettingsScreen(state: NativeUiState, model: DtcViewModel) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Application control", "Settings", "Appearance and secure profile controls for this Android device.") }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                val wide = maxWidth >= 650.dp
                if (wide) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    AppearancePanel(state, model, Modifier.weight(1f)); ProfilePanel(state, model, Modifier.weight(1f))
                } else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { AppearancePanel(state, model); ProfilePanel(state, model) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AppearancePanel(state: NativeUiState, model: DtcViewModel, modifier: Modifier = Modifier) = Panel("Appearance", modifier) {
    Text("Theme changes apply immediately across phone and tablet layouts.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(ThemeMode.System to Icons.Outlined.Settings, ThemeMode.Light to Icons.Outlined.LightMode, ThemeMode.Dark to Icons.Outlined.DarkMode).forEach { (mode, icon) ->
            FilterChip(state.themeMode == mode, { model.setTheme(mode) }, { Text(mode.name) }, leadingIcon = { Icon(icon, null, Modifier.size(18.dp)) })
        }
    }
}

@Composable
private fun ProfilePanel(state: NativeUiState, model: DtcViewModel, modifier: Modifier = Modifier) = Panel("Profile", modifier) {
    var changing by remember { mutableStateOf(false) }
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(Modifier.size(48.dp), color = DtcRed, shape = RoundedCornerShape(2.dp)) { Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Person, null, tint = Color.White) } }
        Column(Modifier.padding(start = 12.dp)) { Text(state.dashboard?.user?.name.orEmpty(), style = MaterialTheme.typography.titleMedium); Text(state.dashboard?.user?.role?.uppercase().orEmpty(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    Divider()
    OutlinedButton(onClick = { changing = !changing }, Modifier.fillMaxWidth(), shape = RoundedCornerShape(2.dp)) {
        Icon(Icons.Outlined.Lock, null); Spacer(Modifier.width(8.dp)); Text(if (changing) "CANCEL PASSWORD CHANGE" else "CHANGE PASSWORD")
    }
    if (changing) {
        OutlinedTextField(current, { current = it }, Modifier.fillMaxWidth(), label = { Text("Current password") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
        OutlinedTextField(next, { next = it }, Modifier.fillMaxWidth(), label = { Text("New password (12+ characters)") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
        OutlinedTextField(confirm, { confirm = it }, Modifier.fillMaxWidth(), label = { Text("Confirm new password") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
        Button(
            onClick = { model.changePassword(current, next, confirm) { current = ""; next = ""; confirm = ""; changing = false } },
            enabled = !state.working && current.isNotBlank() && next.length >= 12 && confirm == next,
            modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(2.dp), colors = ButtonDefaults.buttonColors(containerColor = DtcRed),
        ) { Text("UPDATE PASSWORD") }
    }
    OutlinedButton(onClick = model::logout, Modifier.fillMaxWidth(), shape = RoundedCornerShape(2.dp), border = BorderStroke(1.dp, DtcRed), colors = ButtonDefaults.outlinedButtonColors(contentColor = DtcRed)) { Icon(Icons.Outlined.Logout, null); Spacer(Modifier.width(8.dp)); Text("SIGN OUT") }
}

@Composable
private fun ScanField(label: String, value: String, setValue: (String) -> Unit, scan: () -> Unit) {
    OutlinedTextField(
        value, setValue, Modifier.fillMaxWidth(), label = { Text(label) }, singleLine = true,
        trailingIcon = { IconButton(onClick = scan) { Icon(Icons.Outlined.QrCodeScanner, "Scan $label", tint = DtcRed) } },
    )
}

@Composable
private fun SearchField(value: String, setValue: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value, setValue, Modifier.fillMaxWidth(), placeholder = { Text(placeholder) }, singleLine = true,
        leadingIcon = { Icon(Icons.Outlined.Search, null) }, trailingIcon = { if (value.isNotEmpty()) IconButton(onClick = { setValue("") }) { Icon(Icons.Outlined.Close, "Clear") } },
    )
}

@Composable
private fun Panel(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier, shape = RoundedCornerShape(2.dp), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .5f)).padding(horizontal = 14.dp, vertical = 11.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(3.dp).height(18.dp).background(DtcRed)); Spacer(Modifier.width(9.dp)); Text(title, style = MaterialTheme.typography.titleMedium)
            }
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
        }
    }
}

@Composable
private fun ValueLine(label: String, value: String, color: Color? = null) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) { Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, fontWeight = FontWeight.Bold, color = color ?: MaterialTheme.colorScheme.onSurface) }
}

@Composable
private fun EmptyState(message: String) {
    Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.CameraAlt, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(10.dp))
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun SectionTitle(title: String) { Text(title.uppercase(), Modifier.padding(horizontal = 20.dp, vertical = 12.dp), style = MaterialTheme.typography.labelMedium, color = DtcRed) }

@Composable
private fun DtcMark(compact: Boolean = false, light: Boolean = false) {
    Column {
        Text("DTC", style = if (compact) MaterialTheme.typography.titleLarge else MaterialTheme.typography.displaySmall, color = if (light) Color.White else MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Black)
        if (!compact) Text("DIRECT TRUCKING COMPANY", style = MaterialTheme.typography.labelMedium, color = DtcRed)
    }
}

private fun installMessage(truck: String, company: String, mother: String, subs: List<String>) = """Truck: ${truck.uppercase()}
Serving company: ${company.uppercase()}
Mother lock: ${mother.uppercase()}
Sub-lock B: ${subs.getOrNull(0).orEmpty().uppercase()}
Sub-lock C: ${subs.getOrNull(1).orEmpty().uppercase()}
Sub-lock D: ${subs.getOrNull(2).orEmpty().uppercase()}"""

private fun openWhatsApp(context: Context, message: String) {
    val uri = Uri.parse("https://wa.me/?text=${Uri.encode(message)}")
    context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

private fun number(value: Int): String = NumberFormat.getIntegerInstance().format(value)

private fun demoState(): NativeUiState {
    val registrations = listOf(
        RegistryItem("1", "487068942035", listOf("CAFD038AC43A", "D613D1C8E248", "C8292646A3A3"), "08030001111", "Musa", "owned"),
        RegistryItem("2", "487068942104", listOf("A91E4C83B012", "D171C4A2E940", "B8206E56A191"), "08030002222", "Miracle", "owned"),
        RegistryItem("3", "487068942188", listOf("C7E90518B333", "E1A293B835A2", "DF08516C0942"), "08030003333", "Jobi", "released_external"),
    )
    val installs = listOf(
        InstallationItem("FZE56DI", "487068942035", registrations[0].subs, "successful", "Musa"),
        InstallationItem("KJA214XP", "487068942104", registrations[1].subs, "completed_with_issues", "Miracle"),
    )
    return NativeUiState(
        booting = false,
        dashboard = DashboardSnapshot(
            NativeUser("Musa Abubakar", "supervisor"),
            "3 reviews need attention",
            "Items are waiting for a supervisor decision.",
            "danger",
            DashboardCounts(1_188, 3, 12, 38, 378, 379),
            DashboardTrust(351, 16, 11, 378),
            listOf(FeedItem("487068942035", "Registered by Musa"), FeedItem("487068942104", "Registered by Miracle")),
            listOf(FeedItem("kit mismatch", "Physical verification required"), FeedItem("duplicate registration", "Supervisor review")),
        ),
        registry = registrations,
        registryTotal = 1_188,
        installations = installs,
        installationTotal = 2_066,
        reviews = listOf(
            ReviewItem("r1", "import_conflict", "{expected: 487068942035, observed: 487068942104, truck: FZE56DI}", 0),
            ReviewItem("r2", "unlogged_swap", "{truck: KJA214XP, previous: 487068942188, current: 487068942035}", 0),
        ),
        lookup = LookupSnapshot("truck", "FZE56DI", "MRS", "verified", "487068942035", listOf("B" to "CAFD038AC43A", "C" to "D613D1C8E248", "D" to "C8292646A3A3"), 0, listOf(FeedItem("Installation recorded", "installation_logs"))),
    )
}
