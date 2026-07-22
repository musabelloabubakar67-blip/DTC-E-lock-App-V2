package com.directtrucking.elock.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
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
import com.directtrucking.elock.core.RepairItem
import com.directtrucking.elock.core.RegistryItem
import com.directtrucking.elock.core.ReviewItem
import com.directtrucking.elock.core.SettingsSnapshot
import com.directtrucking.elock.core.NativeUser
import com.directtrucking.elock.R
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
    Repairs("Repairs", Icons.Outlined.HomeRepairService),
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
    val registryPage: Int = 0,
    val installations: List<InstallationItem> = emptyList(),
    val installationTotal: Int = 0,
    val installationPage: Int = 0,
    val repairPool: List<RepairItem> = emptyList(),
    val supervisors: List<Pair<String, String>> = emptyList(),
    val reviews: List<ReviewItem> = emptyList(),
    val lookup: LookupSnapshot? = null,
    val settings: SettingsSnapshot? = null,
    val message: String? = null,
    val error: String? = null,
    val themeMode: ThemeMode = ThemeMode.Dark,
    val compactMode: Boolean = false,
    val pendingSyncCount: Int = 0,
)

class DtcViewModel(private val api: DtcApi, private val demo: Boolean = false) : ViewModel() {
    private val _state = MutableStateFlow(
        if (demo) demoState() else NativeUiState(
            themeMode = runCatching { ThemeMode.valueOf(api.appearanceMode()) }.getOrDefault(ThemeMode.Dark),
            compactMode = api.compactMode(),
            pendingSyncCount = api.pendingMutationCount(),
        ),
    )
    val state = _state.asStateFlow()

    init {
        if (!demo) {
            viewModelScope.launch {
                try {
                    val restored = api.restoreSession()
                    val sync = if (restored != null) api.syncPending() else null
                    val dashboard = if (restored != null && (sync?.applied ?: 0) > 0) api.bootstrap() else restored
                    _state.update { it.copy(booting = false, dashboard = dashboard, pendingSyncCount = sync?.pending ?: api.pendingMutationCount()) }
                } catch (error: Exception) {
                    _state.update { it.copy(booting = false, error = error.message) }
                }
            }
            viewModelScope.launch {
                while (true) {
                    delay(30_000)
                    if (_state.value.dashboard != null) syncQueue(false)
                }
            }
        }
    }

    fun login(username: String, password: String) = launchWork {
        var dashboard = api.login(username, password)
        val sync = api.syncPending()
        if (sync.applied > 0) dashboard = api.bootstrap()
        _state.update { it.copy(dashboard = dashboard, selected = AppScreen.Dashboard, pendingSyncCount = sync.pending, message = "Signed in") }
    }

    fun logout() {
        api.logout()
        _state.update { NativeUiState(booting = false, themeMode = it.themeMode) }
    }

    fun open(screen: AppScreen) {
        _state.update { it.copy(selected = screen, message = null, error = null) }
        if (demo) return
        syncQueue(false)
        when (screen) {
            AppScreen.Register -> loadRegistry()
            AppScreen.Install -> loadInstallations()
            AppScreen.Repairs -> loadRepairs()
            AppScreen.Review -> loadReviews()
            AppScreen.Settings -> loadSettings()
            else -> Unit
        }
    }

    fun refreshDashboard() = launchWork {
        if (demo) return@launchWork
        val sync = api.syncPending()
        _state.update { it.copy(dashboard = api.bootstrap(), pendingSyncCount = sync.pending, message = if (sync.applied > 0) "Workspace refreshed / ${sync.applied} queued changes synced" else "Workspace refreshed") }
    }

    fun loadRegistry(query: String = "", page: Int = 0) = launchWork {
        if (demo) return@launchWork
        val (items, total) = api.registry(query, page)
        _state.update { it.copy(registry = items, registryTotal = total, registryPage = page) }
    }

    fun loadInstallations(query: String = "", page: Int = 0) = launchWork {
        if (demo) return@launchWork
        val (items, total) = api.installationHistory(query, page)
        _state.update { it.copy(installations = items, installationTotal = total, installationPage = page) }
    }

    fun loadRepairs() = launchWork {
        if (demo) return@launchWork
        _state.update { it.copy(repairPool = api.repairPool(), supervisors = api.supervisors()) }
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

    fun register(mother: String, subs: List<String>, sim: String, config: Map<String, String>, done: () -> Unit) = launchWork {
        if (demo) {
            _state.update { it.copy(message = "Demo registration complete - no data was written") }
            done()
            return@launchWork
        }
        api.registerKit(mother, subs, sim, config)
        val (items, total) = api.registry()
        _state.update { it.copy(registry = items, registryTotal = total, message = "Kit registered") }
        done()
    }

    fun register(mother: String, subs: List<String>, sim: String, done: () -> Unit) =
        register(mother, subs, sim, mapOf("ipConfigured" to "yes", "apnConfigured" to "yes", "apnAuthSet" to "yes", "btWriteDone" to "yes"), done)

    fun setRegistryOwnership(ids: List<String>, status: String, notes: String, query: String = "") = launchWork {
        api.setRegistryOwnership(ids, status, notes)
        val (items, total) = api.registry(query)
        _state.update { it.copy(registry = items, registryTotal = total, registryPage = 0, message = if (status == "owned") "Kits restored" else "Kits released") }
    }

    fun install(
        truckId: String,
        company: String,
        motherId: String,
        subIds: List<String>,
        mode: String,
        checklist: Map<String, String>,
        done: () -> Unit,
    ) = launchWork {
        if (demo) {
            _state.update { it.copy(message = "Demo installation complete - no data was written") }
            done()
            return@launchWork
        }
        api.installKit(truckId, company, motherId, subIds, mode, checklist)
        val (items, total) = api.installationHistory()
        _state.update { it.copy(installations = items, installationTotal = total, message = "Installation recorded") }
        done()
    }

    fun install(truck: String, company: String, mother: String, subs: List<String>, status: String, done: () -> Unit) = launchWork {
        val loaded = api.lookup(truck)
        val motherId = loaded.motherId ?: throw IllegalStateException("Load a registered truck kit before installation")
        val subIds = loaded.subIds.mapNotNull { it.second }
        if (loaded.targetId == null || subIds.size != 3) throw IllegalStateException("This truck does not have a complete registered kit")
        api.installKit(loaded.targetId, company, motherId, subIds, "same_kit", mapOf(
            "configConfirmed" to "yes", "deviceResponsive" to "yes", "sublocksResponsive" to "yes", "overallStatus" to status,
        ))
        _state.update { it.copy(message = "Installation recorded") }
        done()
    }

    fun installBySerials(
        truck: String,
        company: String,
        mother: String,
        subs: List<String>,
        mode: String,
        checklist: Map<String, String>,
        done: () -> Unit,
    ) = launchWork {
        val sync = api.installBySerials(truck, company, mother, subs, mode, checklist)
        if (sync.applied > 0) {
            val (items, total) = api.installationHistory()
            _state.update { it.copy(installations = items, installationTotal = total, installationPage = 0, pendingSyncCount = sync.pending, message = "Installation recorded") }
        } else {
            _state.update { it.copy(pendingSyncCount = sync.pending, message = "Installation saved on this device / pending sync") }
        }
        done()
    }

    fun triage(deviceId: String, outcome: String) = launchWork {
        val sync = api.triage(deviceId, outcome)
        val pool = if (sync.applied > 0) api.repairPool() else _state.value.repairPool
        _state.update { it.copy(repairPool = pool, pendingSyncCount = sync.pending, message = if (sync.applied > 0) {
            if (outcome == "revived") "Device returned to available" else "Device declared dead"
        } else "Repair decision saved on this device / pending sync") }
    }

    fun reportFault(payload: org.json.JSONObject, done: () -> Unit) = launchWork {
        val sync = api.reportFault(payload)
        _state.update { it.copy(pendingSyncCount = sync.pending, message = if (sync.applied > 0) "Fault report recorded" else "Fault report saved on this device / pending sync") }
        done()
    }

    fun syncQueue(showMessage: Boolean = true) {
        if (demo || _state.value.dashboard == null) return
        viewModelScope.launch {
            val sync = api.syncPending()
            val refreshed = if (sync.applied > 0) runCatching { api.bootstrap() }.getOrNull() else null
            _state.update { current -> current.copy(
                dashboard = refreshed ?: current.dashboard,
                pendingSyncCount = sync.pending,
                message = if (!showMessage) current.message else when {
                    sync.pending == 0 && sync.applied > 0 -> "${sync.applied} queued changes synced"
                    sync.pending == 0 -> "Sync queue is clear"
                    !sync.reachedServer -> "Still offline / ${sync.pending} changes safely queued"
                    else -> "${sync.pending} changes still need server review"
                },
            ) }
        }
    }

    fun setTruckCompany(truckId: String, company: String, notes: String, label: String) = launchWork {
        api.setTruckCompany(truckId, company, notes)
        _state.update { it.copy(lookup = api.lookup(label), message = "Serving company updated") }
    }

    fun loadSettings() = launchWork {
        if (demo) return@launchWork
        _state.update { it.copy(settings = api.settings()) }
    }

    fun createUser(username: String, displayName: String, password: String, role: String, company: String?, done: () -> Unit) = launchWork {
        api.createUser(username, displayName, password, role, company)
        _state.update { it.copy(settings = api.settings(), message = "User added") }
        done()
    }

    fun setUserActive(userId: String, active: Boolean) = launchWork {
        api.setUserActive(userId, active)
        _state.update { it.copy(settings = api.settings(), message = if (active) "User activated" else "User deactivated") }
    }

    fun exportData(dataset: String, format: String) = launchWork {
        val filename = api.downloadExport(dataset, format)
        _state.update { it.copy(message = "$filename saved to Downloads / DTC E-Lock") }
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

    fun setTheme(mode: ThemeMode) = _state.update { current -> api.setAppearance(mode.name, current.compactMode); current.copy(themeMode = mode) }
    fun setCompact(compact: Boolean) = _state.update { current -> api.setAppearance(current.themeMode.name, compact); current.copy(compactMode = compact) }
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
                else -> CompositionLocalProvider(LocalCompactMode provides state.compactMode) { NativeWorkspace(state, model) }
            }
        }
    }
}

private val LocalCompactMode = staticCompositionLocalOf { false }

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
            val railWidth = if (compactTablet) 80.dp else 176.dp
            Column(Modifier.fillMaxSize().statusBarsPadding()) {
                TopBar(state, model::refreshDashboard, railWidth)
                Row(Modifier.weight(1f)) {
                    TabletRail(state, compactTablet, model::open, model::logout)
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
        ModalBottomSheet(onDismissRequest = { moreOpen = false }, containerColor = MaterialTheme.colorScheme.surface, shape = RectangleShape) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
                Text("MORE OPERATIONS", Modifier.padding(horizontal = 20.dp, vertical = 10.dp), style = MaterialTheme.typography.labelMedium, color = DtcRed)
                listOf(AppScreen.Repairs, AppScreen.Review, AppScreen.Settings).forEach { screen ->
                    NavRow(screen, state.selected == screen) { model.open(screen); moreOpen = false }
                }
            }
        }
    }
}

@Composable
private fun TopBar(state: NativeUiState, refresh: () -> Unit, brandWidth: androidx.compose.ui.unit.Dp? = null) {
    val surfaceModifier = if (brandWidth == null) Modifier.statusBarsPadding() else Modifier
    Surface(surfaceModifier, color = Ink, contentColor = IndustrialText, border = BorderStroke(1.dp, Rule)) {
        Row(Modifier.fillMaxWidth().height(if (brandWidth == null) 54.dp else 76.dp), verticalAlignment = Alignment.CenterVertically) {
            if (brandWidth != null) {
                Box(Modifier.width(brandWidth).fillMaxHeight().border(BorderStroke(1.dp, Rule)).padding(10.dp), contentAlignment = Alignment.Center) {
                    DtcMark(compact = false, light = true)
                }
            }
            Row(Modifier.weight(1f).fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("01", color = DtcRed, style = MaterialTheme.typography.labelMedium)
                    Spacer(Modifier.width(9.dp))
                    Text("DTC / E-LOCK CONTROL SYSTEM", style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (brandWidth != null) {
                    if (state.working) CircularProgressIndicator(Modifier.size(16.dp), color = DtcRed, strokeWidth = 2.dp)
                    IconButton(onClick = refresh, modifier = Modifier.fillMaxHeight().border(BorderStroke(1.dp, Rule))) { Icon(Icons.Outlined.Refresh, "Refresh", Modifier.size(18.dp)) }
                    Row(Modifier.fillMaxHeight().border(BorderStroke(1.dp, Rule)).padding(horizontal = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).background(DtcRed))
                        Spacer(Modifier.width(8.dp))
                        Text("ONLINE", style = MaterialTheme.typography.labelMedium)
                    }
                } else if (state.working) {
                    CircularProgressIndicator(Modifier.size(15.dp), color = DtcRed, strokeWidth = 2.dp)
                }
                Column(Modifier.fillMaxHeight().padding(horizontal = 13.dp), verticalArrangement = Arrangement.Center) {
                    Text(state.dashboard?.user?.role?.uppercase().orEmpty(), style = MaterialTheme.typography.labelMedium, maxLines = 1)
                    Text(state.dashboard?.user?.name?.substringBefore(' ')?.uppercase().orEmpty(), style = MaterialTheme.typography.labelMedium, color = IndustrialMuted, maxLines = 1)
                }
            }
        }
    }
}

@Composable
private fun TabletRail(state: NativeUiState, compact: Boolean, open: (AppScreen) -> Unit, logout: () -> Unit) {
    Surface(Modifier.width(if (compact) 80.dp else 176.dp).fillMaxHeight(), color = Ink, contentColor = IndustrialText, border = BorderStroke(1.dp, Rule)) {
        Column(Modifier.fillMaxSize()) {
            AppScreen.entries.forEach { screen ->
                if (screen != AppScreen.Review || state.dashboard?.user?.role == "supervisor") {
                    if (compact) {
                        Box(
                            Modifier.fillMaxWidth().height(64.dp).clickable { open(screen) }
                                .background(if (state.selected == screen) Color(0xFF252B30) else Color.Transparent)
                                .border(BorderStroke(1.dp, Rule)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Icon(screen.icon, screen.label, Modifier.size(22.dp), tint = if (state.selected == screen) IndustrialText else IndustrialMuted)
                                Text(screen.label.uppercase(), style = MaterialTheme.typography.labelMedium, color = if (state.selected == screen) IndustrialText else IndustrialMuted)
                            }
                            if (state.selected == screen) Box(Modifier.align(Alignment.CenterStart).width(4.dp).fillMaxHeight().background(DtcRed))
                        }
                    } else NavRow(screen, state.selected == screen, dark = true) { open(screen) }
                }
            }
            Spacer(Modifier.weight(1f))
            Column(Modifier.fillMaxWidth().border(BorderStroke(1.dp, Rule)).padding(12.dp)) {
                if (!compact) {
                    Text("SYSTEM / ONLINE", style = MaterialTheme.typography.labelMedium)
                    Text("REVISION / 03.0", style = MaterialTheme.typography.labelMedium)
                    Text("SYNC QUEUE / ${state.pendingSyncCount.toString().padStart(3, '0')}", style = MaterialTheme.typography.labelMedium, color = if (state.pendingSyncCount > 0) SafetyAmber else IndustrialText)
                }
            }
            Row(Modifier.fillMaxWidth().clickable(onClick = logout).border(BorderStroke(1.dp, Rule)).padding(18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = if (compact) Arrangement.Center else Arrangement.Start) {
                Icon(Icons.Outlined.Logout, null, Modifier.size(20.dp))
                if (!compact) { Spacer(Modifier.width(12.dp)); Text("Sign out", style = MaterialTheme.typography.labelLarge) }
            }
        }
    }
}

@Composable
private fun NavRow(screen: AppScreen, active: Boolean, dark: Boolean = false, onClick: () -> Unit) {
    val activeColor = if (dark) IndustrialText else MaterialTheme.colorScheme.onSurface
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick)
            .background(if (active) Color(0xFF252B30) else Color.Transparent)
            .border(BorderStroke(1.dp, if (dark) Rule else MaterialTheme.colorScheme.outline))
            .height(49.dp).padding(horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (active) Box(Modifier.width(3.dp).height(22.dp).background(DtcRed))
        if (active) Spacer(Modifier.width(9.dp)) else Spacer(Modifier.width(12.dp))
        Icon(screen.icon, null, Modifier.size(20.dp), tint = activeColor)
        Spacer(Modifier.width(12.dp))
        Text(screen.label.uppercase(), style = MaterialTheme.typography.labelMedium, color = activeColor)
        if (active) { Spacer(Modifier.weight(1f)); Text("///", style = MaterialTheme.typography.labelMedium, color = DtcRed) }
    }
}

@Composable
private fun PhoneNav(selected: AppScreen, open: (AppScreen) -> Unit, more: () -> Unit) {
    Surface(color = Ink, contentColor = IndustrialText, border = BorderStroke(1.dp, Rule)) {
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(66.dp), horizontalArrangement = Arrangement.SpaceAround) {
            listOf(AppScreen.Dashboard, AppScreen.Register, AppScreen.Install, AppScreen.Lookup).forEach { screen ->
                PhoneNavItem(screen.label, screen.icon, selected == screen) { open(screen) }
            }
            PhoneNavItem("More", Icons.Outlined.MoreHoriz, selected in listOf(AppScreen.Repairs, AppScreen.Review, AppScreen.Settings), more)
        }
    }
}

@Composable
private fun RowScope.PhoneNavItem(label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.weight(1f).fillMaxHeight().clickable(onClick = onClick)
            .background(if (selected) Color(0xFF252B30) else Ink)
            .border(BorderStroke(1.dp, Rule)).padding(horizontal = 4.dp, vertical = 7.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (selected) Box(Modifier.fillMaxWidth().height(4.dp).background(DtcRed))
        Spacer(Modifier.height(4.dp))
        Icon(icon, label, Modifier.size(20.dp), tint = if (selected) IndustrialText else IndustrialMuted)
        Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = if (selected) IndustrialText else IndustrialMuted)
    }
}

@Composable
private fun ScreenContent(state: NativeUiState, model: DtcViewModel, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxSize()) {
        if (state.error != null) StatusStrip(state.error, true, model::clearNotice)
        else if (state.message != null) StatusStrip(state.message, false, model::clearNotice)
        if (state.pendingSyncCount > 0) PendingQueueStrip(state.pendingSyncCount, state.working) { model.syncQueue() }
        when (state.selected) {
            AppScreen.Dashboard -> DashboardScreen(state.dashboard!!, model::open)
            AppScreen.Register -> RegisterParityScreen(state, model)
            AppScreen.Install -> InstallParityScreen(state, model)
            AppScreen.Repairs -> RepairsScreen(state, model)
            AppScreen.Lookup -> LookupParityScreen(state, model)
            AppScreen.Review -> ReviewScreen(state, model)
            AppScreen.Settings -> SettingsParityScreen(state, model)
        }
    }
}

@Composable
private fun PendingQueueStrip(count: Int, working: Boolean, retry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Color(0xFF3A2C0A)).border(BorderStroke(1.dp, SafetyAmber)).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Refresh, null, tint = SafetyAmber, modifier = Modifier.size(18.dp))
        Text("$count CHANGE${if (count == 1) "" else "S"} SAFELY QUEUED", Modifier.padding(horizontal = 9.dp).weight(1f), color = Color.White, style = MaterialTheme.typography.labelMedium)
        TextButton(onClick = retry, enabled = !working) { Text("RETRY", color = SafetyAmber) }
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
private fun PageHeader(kicker: String, title: String, accent: String, metric: String, detail: String) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val titleBlock: @Composable () -> Unit = {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 18.dp)) {
                Text("[ ${kicker.uppercase()} ]", style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(12.dp))
                Text(title.uppercase(), style = MaterialTheme.typography.displaySmall)
                if (accent.isNotBlank()) Text(accent.uppercase(), style = MaterialTheme.typography.displaySmall, color = DtcRed)
            }
        }
        val briefBlock: @Composable () -> Unit = {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.Center) {
                Text(metric, style = MaterialTheme.typography.headlineMedium)
                Spacer(Modifier.height(8.dp))
                Text(detail.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (maxWidth >= 600.dp) {
            Row(Modifier.fillMaxWidth().height(160.dp).border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline))) {
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.CenterStart) { titleBlock() }
                Box(Modifier.width(2.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outline))
                Box(Modifier.weight(.42f).fillMaxHeight(), contentAlignment = Alignment.CenterStart) { briefBlock() }
            }
        } else {
            Column(Modifier.fillMaxWidth().border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline))) {
                titleBlock()
                Divider(color = MaterialTheme.colorScheme.outline)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(metric, Modifier.width(86.dp).padding(14.dp), style = MaterialTheme.typography.headlineMedium)
                    Text(detail.uppercase(), Modifier.weight(1f).padding(14.dp), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DashboardScreen(data: DashboardSnapshot, open: (AppScreen) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 0.dp)) {
        item { PageHeader("Fleet operational register", "Fleet", number(data.counts.inServiceMothers), "32%", "${number(data.counts.availableMothers)} mother locks remain available for assignment.") }
        item {
            Surface(
                Modifier.fillMaxWidth(), shape = RectangleShape,
                color = when (data.healthTone) { "danger" -> Color(0xFF2B141D); "warning" -> Color(0xFF2B2218); else -> MaterialTheme.colorScheme.surfaceVariant },
                border = BorderStroke(1.dp, when (data.healthTone) { "danger" -> DtcRed; "warning" -> SafetyAmber; else -> SignalGreen }),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (data.healthTone == "ok") Icons.Outlined.Shield else Icons.Outlined.Warning, null, tint = if (data.healthTone == "ok") SignalGreen else DtcRed)
                    Column(Modifier.padding(start = 14.dp).weight(1f)) { Text(data.healthTitle.uppercase(), style = MaterialTheme.typography.titleMedium); Text(data.healthDetail.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (data.counts.openReviews > 0) IconButton(onClick = { open(AppScreen.Review) }) { Icon(Icons.Outlined.ChevronRight, "Open reviews") }
                }
            }
        }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val metrics = listOf(
                    MetricData("Open reviews", data.counts.openReviews, Icons.Outlined.ListAlt, if (data.counts.openReviews > 0) DtcRed else null),
                    MetricData("Repair pool", data.counts.pendingRepair, Icons.Outlined.HomeRepairService, if (data.counts.pendingRepair > 0) SafetyAmber else null),
                    MetricData("Registered kits", data.counts.registeredKits, Icons.Outlined.AddBox, null),
                    MetricData("In service", data.counts.inServiceMothers, Icons.Outlined.InstallMobile, SignalGreen),
                    MetricData("Available mothers", data.counts.availableMothers, Icons.Outlined.Lock, null),
                )
                val columns = if (maxWidth >= 900.dp) 5 else if (maxWidth >= 600.dp) 3 else 2
                Column {
                    metrics.chunked(columns).forEach { row ->
                        Row(Modifier.fillMaxWidth()) {
                            row.forEach { item -> Metric(item.label, item.value, item.icon, item.accent, Modifier.weight(1f)) }
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
        item {
            Panel("Quick operations") {
                Row(Modifier.fillMaxWidth()) {
                    listOf(AppScreen.Lookup, AppScreen.Register, AppScreen.Install, AppScreen.Review).forEach { screen ->
                        Column(Modifier.weight(1f).height(70.dp).clickable { open(screen) }.border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                            Icon(screen.icon, null, Modifier.size(23.dp))
                            Spacer(Modifier.height(5.dp))
                            Text(screen.label.uppercase(), style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                if (maxWidth >= 650.dp) {
                    Row {
                        TrustPanel(data, Modifier.weight(1f)); FeedPanel("Recent registrations", data.registrations, Modifier.weight(1f)); FeedPanel("Attention queue", data.reviews, Modifier.weight(1f))
                    }
                } else {
                    Column { TrustPanel(data); FeedPanel("Recent registrations", data.registrations); FeedPanel("Attention queue", data.reviews) }
                }
            }
        }
    }
}

private data class MetricData(val label: String, val value: Int, val icon: ImageVector, val accent: Color?)

@Composable
private fun Metric(label: String, value: Int, icon: ImageVector, accent: Color? = null, modifier: Modifier = Modifier) {
    Surface(modifier.height(112.dp), shape = RectangleShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
        Column(Modifier.padding(14.dp)) {
            Icon(icon, null, tint = accent ?: MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(22.dp))
            Text(number(value), style = MaterialTheme.typography.headlineMedium)
            Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
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

private data class RegistrationSessionRow(
    val id: Long,
    val mother: String,
    val subs: List<String>,
    val sim: String,
    val config: Map<String, String>,
    val status: String,
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RegisterParityScreen(state: NativeUiState, model: DtcViewModel) {
    var query by remember { mutableStateOf("") }
    var mother by remember { mutableStateOf("") }
    var subs by remember { mutableStateOf(listOf("", "", "")) }
    var sim by remember { mutableStateOf("") }
    var config by remember { mutableStateOf(mapOf("ipConfigured" to "yes", "apnConfigured" to "yes", "apnAuthSet" to "yes", "btWriteDone" to "yes")) }
    var session by remember { mutableStateOf(listOf<RegistrationSessionRow>()) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var releaseNote by remember { mutableStateOf("") }
    var archiveOpen by remember { mutableStateOf(false) }
    var formOpen by remember { mutableStateOf(true) }
    var scanTarget by remember { mutableStateOf<Int?>(null) }

    LaunchedEffect(query) { delay(350); model.loadRegistry(query, 0) }

    fun submit(entry: RegistrationSessionRow) {
        session = listOf(entry) + session.filterNot { it.id == entry.id }
        model.register(entry.mother, entry.subs, entry.sim, entry.config) {
            session = session.map { if (it.id == entry.id) it.copy(status = "COMPLETED") else it }
            mother = ""; subs = listOf("", "", ""); sim = ""
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Inventory intake", "Register", "Kit", number(state.registryTotal), "The same registration checks, session retry, ownership controls and archive used on the web app.") }
        item {
            OutlinedButton(onClick = { formOpen = !formOpen }, Modifier.fillMaxWidth(), shape = RectangleShape) {
                Icon(if (formOpen) Icons.Outlined.Close else Icons.Outlined.AddBox, null); Spacer(Modifier.width(8.dp)); Text(if (formOpen) "COLLAPSE REGISTRATION FORM" else "NEW REGISTRATION")
            }
        }
        if (formOpen) item {
            Panel("New kit") {
                ScanField("Mother lock", mother, { mother = it }) { scanTarget = 0 }
                subs.forEachIndexed { index, value -> ScanField("Sub-lock ${listOf("B", "C", "D")[index]}", value, { updated -> subs = subs.toMutableList().also { it[index] = updated } }) { scanTarget = index + 1 } }
                OutlinedTextField(sim, { sim = it }, Modifier.fillMaxWidth(), label = { Text("SIM number") }, singleLine = true)
                Text("CONFIGURATION CHECKS", style = MaterialTheme.typography.labelMedium)
                listOf("ipConfigured" to "IP configured", "apnConfigured" to "APN configured", "apnAuthSet" to "APN authentication", "btWriteDone" to "Bluetooth write").forEach { (key, label) ->
                    ChoiceLine(label, config[key] ?: "yes", listOf("yes" to "Yes", "no" to "No")) { config = config + (key to it) }
                }
                Button(
                    onClick = { submit(RegistrationSessionRow(System.nanoTime(), mother, subs, sim, config, "PENDING")) },
                    enabled = !state.working && mother.isNotBlank() && subs.all(String::isNotBlank) && sim.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(50.dp), shape = RectangleShape,
                ) { Text("REGISTER KIT") }
            }
        }
        item {
            Panel("Session summary / ${session.size}") {
                if (session.isEmpty()) Text("No kits submitted in this session.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                session.forEach { row ->
                    Row(Modifier.fillMaxWidth().border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(row.mother, style = MaterialTheme.typography.labelLarge); Text(row.status, color = if (row.status == "COMPLETED") SignalGreen else SafetyAmber) }
                        if (row.status != "COMPLETED") TextButton(onClick = { submit(row.copy(status = "PENDING")) }) { Text("RETRY") }
                    }
                }
            }
        }
        item {
            OutlinedButton(onClick = { archiveOpen = !archiveOpen }, Modifier.fillMaxWidth(), shape = RectangleShape) {
                Icon(Icons.Outlined.ListAlt, null); Spacer(Modifier.width(8.dp)); Text(if (archiveOpen) "CLOSE REGISTERED KITS" else "OPEN REGISTERED KITS (${state.registryTotal})")
            }
        }
        if (archiveOpen) item {
            Panel("Registered kits / ${number(state.registryTotal)}") {
                SearchField(query, { query = it }, "Search serial, SIM or installer")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { selected = state.registry.map { it.id }.toSet() }, shape = RectangleShape) { Text("SELECT VISIBLE") }
                    OutlinedButton(onClick = { selected = emptySet() }, enabled = selected.isNotEmpty(), shape = RectangleShape) { Text("CLEAR") }
                }
                if (selected.isNotEmpty()) {
                    OutlinedTextField(releaseNote, { releaseNote = it }, Modifier.fillMaxWidth(), label = { Text("Company, handover reference or reason") }, minLines = 2)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { model.setRegistryOwnership(selected.toList(), "released_external", releaseNote, query); selected = emptySet(); releaseNote = "" }, shape = RectangleShape, colors = ButtonDefaults.buttonColors(containerColor = DtcRed)) { Text("RELEASE ${selected.size}") }
                        OutlinedButton(onClick = { model.setRegistryOwnership(selected.toList(), "owned", releaseNote, query); selected = emptySet(); releaseNote = "" }, shape = RectangleShape) { Text("RESTORE ${selected.size}") }
                    }
                }
                if (state.registry.isEmpty()) EmptyState("No kits match this search.")
                state.registry.forEach { item ->
                    Surface(Modifier.fillMaxWidth().clickable { selected = if (item.id in selected) selected - item.id else selected + item.id }, color = if (item.id in selected) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                        Column(Modifier.padding(12.dp)) {
                            Row { Text(if (item.id in selected) "[X] ${item.mother}" else "[ ] ${item.mother}", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(item.ownership.replace('_', ' ').uppercase(), color = if (item.ownership == "owned") SignalGreen else DtcRed, style = MaterialTheme.typography.labelMedium) }
                            Text("B/C/D  ${item.subs.joinToString(" / ")}")
                            Text("SIM ${item.sim} / ${item.actor}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            item.ownershipNotes?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { model.loadRegistry(query, state.registryPage - 1) }, enabled = state.registryPage > 0, shape = RectangleShape) { Text("PREV") }
                    Text("PAGE ${state.registryPage + 1} / ${maxOf(1, (state.registryTotal + 7) / 8)}", style = MaterialTheme.typography.labelMedium)
                    OutlinedButton(onClick = { model.loadRegistry(query, state.registryPage + 1) }, enabled = (state.registryPage + 1) * 8 < state.registryTotal, shape = RectangleShape) { Text("NEXT") }
                }
            }
        }
    }
    scanTarget?.let { target ->
        val label = if (target == 0) "mother lock" else "sub-lock ${listOf("B", "C", "D")[target - 1]}"
        ScannerDialog(label, onScanned = { value -> if (target == 0) mother = value else subs = subs.toMutableList().also { it[target - 1] = value }; scanTarget = null }, onDismiss = { scanTarget = null })
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
        item { PageHeader("Inventory intake", "Register", "Kit", number(state.registryTotal), "Create an unassigned four-lock kit and keep the full registry searchable.") }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val twoPane = maxWidth >= 760.dp
                if (twoPane) Row {
                    RegisterForm(mother, { mother = it }, subs, { i, value -> subs = subs.toMutableList().also { it[i] = value } }, sim, { sim = it }, { scanTarget = it }, state.working, {
                        model.register(mother, subs, sim) { mother = ""; subs = listOf("", "", ""); sim = "" }
                    }, Modifier.weight(.8f))
                    RegistryArchive(state, query, { query = it }, Modifier.weight(1.2f))
                } else Column {
                    OutlinedButton(onClick = { showForm = !showForm }, Modifier.fillMaxWidth(), shape = RectangleShape) { Icon(if (showForm) Icons.Outlined.Close else Icons.Outlined.AddBox, null); Spacer(Modifier.width(8.dp)); Text(if (showForm) "COLLAPSE REGISTRATION FORM" else "NEW REGISTRATION") }
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
        modifier = Modifier.fillMaxWidth().height(50.dp), shape = RectangleShape,
    ) { Text("REGISTER KIT") }
}

@Composable
private fun RegistryArchive(state: NativeUiState, query: String, search: (String) -> Unit, modifier: Modifier = Modifier) = Panel("Registered kits / ${number(state.registryTotal)}", modifier) {
    SearchField(query, search, "Search serial, SIM or installer")
    if (state.registry.isEmpty()) EmptyState("No kits match this search.")
    state.registry.forEach { item ->
        Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
            Column(Modifier.padding(12.dp)) {
                Row(Modifier.fillMaxWidth()) { Text(item.mother, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(item.ownership.replace('_', ' ').uppercase(), style = MaterialTheme.typography.labelMedium, color = if (item.ownership == "owned") SignalGreen else DtcRed) }
                Text("B/C/D  ${item.subs.joinToString("  /  ")}", style = MaterialTheme.typography.bodyMedium)
                Text("SIM ${item.sim}  ·  ${item.actor}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InstallParityScreen(state: NativeUiState, model: DtcViewModel) {
    val context = LocalContext.current
    var truck by remember { mutableStateOf("") }
    var company by remember { mutableStateOf("") }
    var mother by remember { mutableStateOf("") }
    var subs by remember { mutableStateOf(listOf("", "", "")) }
    var mode by remember { mutableStateOf("changed") }
    var loadedTruck by remember { mutableStateOf("") }
    var checklist by remember { mutableStateOf(mapOf<String, String>()) }
    var query by remember { mutableStateOf("") }
    var archiveOpen by remember { mutableStateOf(false) }
    var scanTarget by remember { mutableStateOf<Int?>(null) }
    var shareReady by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(query) { delay(350); model.loadInstallations(query, 0) }
    LaunchedEffect(state.lookup) {
        val loaded = state.lookup
        if (loaded != null && loaded.targetKind == "truck" && loaded.label.equals(truck, ignoreCase = true)) {
            loadedTruck = loaded.label
            company = loaded.company.takeIf { loaded.companyDeclared }?.lowercase() ?: ""
            if (loaded.mother != null && loaded.subs.all { it.second != null }) {
                mother = loaded.mother
                subs = loaded.subs.map { it.second.orEmpty() }
                mode = "same_kit"
            } else {
                mode = "changed"
            }
        }
    }
    LaunchedEffect(shareReady) { if (shareReady) { delay(120); listState.animateScrollToItem(2) } }
    val message = remember(truck, company, mother, subs) { installMessage(truck, company, mother, subs) }
    val requiredComplete = listOf("configConfirmed", "deviceResponsive", "sublocksResponsive", "overallStatus").all { !checklist[it].isNullOrBlank() }

    LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Truck and kit assignment", "Install", "Truck", if (loadedTruck.isBlank()) "00" else "01", "Load the truck first, confirm the serving company, reuse the same kit or scan a changed kit, then complete the re-check.") }
        item {
            Panel("Truck assignment") {
                OutlinedTextField(truck, { truck = it.uppercase(); loadedTruck = "" }, Modifier.fillMaxWidth(), label = { Text("Truck plate") }, singleLine = true)
                Button(onClick = { model.lookup(truck) }, enabled = truck.isNotBlank() && !state.working, modifier = Modifier.fillMaxWidth().height(50.dp), shape = RectangleShape) { Text("LOAD TRUCK KIT") }
                if (loadedTruck.isBlank()) Text("Load the truck before submitting this installation.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else {
                    ValueLine("Truck", loadedTruck)
                    ValueLine("Current mother", state.lookup?.mother ?: "Not assigned")
                    ValueLine("Current kit", state.lookup?.kitStatus?.replace('_', ' ') ?: "Not confirmed")
                }
                Text("SERVING COMPANY", style = MaterialTheme.typography.labelMedium)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("mrs" to "MRS", "dangote" to "Dangote").forEach { (value, label) -> FilterChip(company == value, { company = value }, { Text(label) }) }
                }
                if (loadedTruck.isNotBlank() && state.lookup?.mother != null) {
                    Text("INSTALL MODE", style = MaterialTheme.typography.labelMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(mode == "same_kit", { mode = "same_kit"; mother = state.lookup?.mother.orEmpty(); subs = state.lookup?.subs?.map { it.second.orEmpty() } ?: subs }, { Text("Same kit") })
                        FilterChip(mode == "changed", { mode = "changed"; mother = ""; subs = listOf("", "", "") }, { Text("Kit changed") })
                    }
                }
                if (mode == "same_kit") {
                    ValueLine("Mother lock", mother)
                    subs.forEachIndexed { index, serial -> ValueLine("Sub-lock ${listOf("B", "C", "D")[index]}", serial) }
                } else {
                    ScanField("Mother lock", mother, { mother = it }) { scanTarget = 0 }
                    subs.forEachIndexed { index, value -> ScanField("Sub-lock ${listOf("B", "C", "D")[index]}", value, { updated -> subs = subs.toMutableList().also { it[index] = updated } }) { scanTarget = index + 1 } }
                }
            }
        }
        item {
            Panel("Config re-check") {
                ChoiceLine("Device responsive", checklist["deviceResponsive"].orEmpty(), listOf("yes" to "Yes", "no" to "No")) { checklist = checklist + ("deviceResponsive" to it) }
                ChoiceLine("Sub-locks responsive", checklist["sublocksResponsive"].orEmpty(), listOf("yes" to "Yes", "no" to "No")) { checklist = checklist + ("sublocksResponsive" to it) }
                ChoiceLine("Configuration confirmed", checklist["configConfirmed"].orEmpty(), listOf("yes" to "Yes", "changed" to "Changed", "no" to "No")) { checklist = checklist + ("configConfirmed" to it) }
                ChoiceLine("Overall status", checklist["overallStatus"].orEmpty(), listOf("successful" to "Successful", "completed_with_issues" to "With issues", "failed" to "Failed")) { checklist = checklist + ("overallStatus" to it) }
                Divider()
                ChoiceLine("Battery", checklist["batteryLevel"].orEmpty(), listOf("full" to "Full", "adequate" to "Adequate", "low" to "Low", "dead" to "Dead")) { checklist = checklist + ("batteryLevel" to it) }
                ChoiceLine("Physical damage", checklist["physicalDamage"].orEmpty(), listOf("none" to "None", "minor" to "Minor", "significant" to "Significant")) { checklist = checklist + ("physicalDamage" to it) }
                ChoiceLine("Bluetooth unlock", checklist["btUnlockDone"].orEmpty(), listOf("yes" to "Yes", "no" to "No")) { checklist = checklist + ("btUnlockDone" to it) }
                ChoiceLine("Online after install", checklist["onlineAfter"].orEmpty(), listOf("yes" to "Yes", "intermittent" to "Intermittent", "no" to "No")) { checklist = checklist + ("onlineAfter" to it) }
                ChoiceLine("Mother locked", checklist["motherLocked"].orEmpty(), listOf("yes" to "Yes", "no" to "No")) { checklist = checklist + ("motherLocked" to it) }
                ChoiceLine("Mother secured", checklist["motherSecured"].orEmpty(), listOf("yes" to "Yes", "no" to "No")) { checklist = checklist + ("motherSecured" to it) }
                ChoiceLine("Sub-locks locked", checklist["sublocksLocked"].orEmpty(), listOf("all" to "All", "partial" to "Partial", "none" to "None")) { checklist = checklist + ("sublocksLocked" to it) }
                ChoiceLine("Sub-locks secured", checklist["sublocksSecured"].orEmpty(), listOf("yes" to "Yes", "no" to "No")) { checklist = checklist + ("sublocksSecured" to it) }
                OutlinedTextField(checklist["configNotes"].orEmpty(), { checklist = checklist + ("configNotes" to it) }, Modifier.fillMaxWidth(), label = { Text("Configuration notes") }, minLines = 2)
                OutlinedTextField(checklist["issuesNotes"].orEmpty(), { checklist = checklist + ("issuesNotes" to it) }, Modifier.fillMaxWidth(), label = { Text("Issues and follow-up notes") }, minLines = 2)
                Button(
                    onClick = { model.installBySerials(truck, company, mother, subs, mode, checklist) { shareReady = true } },
                    enabled = !state.working && loadedTruck.isNotBlank() && company.isNotBlank() && mother.isNotBlank() && subs.all(String::isNotBlank) && requiredComplete,
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = RectangleShape,
                ) { Text("RECORD INSTALLATION") }
                if (!requiredComplete) Text("Device, sub-lock, configuration and overall status checks are required.", color = SafetyAmber)
            }
        }
        if (shareReady) item {
            Panel("Send installation report") {
                Text(message, style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { openWhatsApp(context, message); shareReady = false }, shape = RectangleShape, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF12351F), contentColor = SignalGreen)) { Text("SEND TO WHATSAPP") }
                    OutlinedButton(onClick = { shareReady = false }, shape = RectangleShape) { Text("DISMISS") }
                }
            }
        }
        item {
            OutlinedButton(onClick = { archiveOpen = !archiveOpen }, Modifier.fillMaxWidth(), shape = RectangleShape) {
                Icon(Icons.Outlined.ListAlt, null); Spacer(Modifier.width(8.dp)); Text(if (archiveOpen) "CLOSE INSTALLATION HISTORY" else "OPEN INSTALLATION HISTORY (${state.installationTotal})")
            }
        }
        if (archiveOpen) item {
            Panel("Installation history / ${number(state.installationTotal)}") {
                SearchField(query, { query = it }, "Search truck, lock, status or installer")
                if (state.installations.isEmpty()) EmptyState("No installation events match this search.")
                state.installations.forEach { item ->
                    Surface(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                        Column(Modifier.padding(12.dp)) {
                            Row { Text(item.truck, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(item.status.replace('_', ' ').uppercase(), color = if (item.status == "failed") DtcRed else SignalGreen, style = MaterialTheme.typography.labelMedium) }
                            Text("Mother ${item.mother}"); Text("B/C/D ${item.subs.joinToString(" / ")}"); Text(item.actor, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { model.loadInstallations(query, state.installationPage - 1) }, enabled = state.installationPage > 0, shape = RectangleShape) { Text("PREV") }
                    Text("PAGE ${state.installationPage + 1} / ${maxOf(1, (state.installationTotal + 4) / 5)}", style = MaterialTheme.typography.labelMedium)
                    OutlinedButton(onClick = { model.loadInstallations(query, state.installationPage + 1) }, enabled = (state.installationPage + 1) * 5 < state.installationTotal, shape = RectangleShape) { Text("NEXT") }
                }
            }
        }
    }
    scanTarget?.let { target ->
        val label = if (target == 0) "mother lock" else "sub-lock ${listOf("B", "C", "D")[target - 1]}"
        ScannerDialog(label, onScanned = { value -> if (target == 0) mother = value else subs = subs.toMutableList().also { it[target - 1] = value }; scanTarget = null }, onDismiss = { scanTarget = null })
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
        item { PageHeader("Truck and kit assignment", "Install", "Truck", "00", "Record the current truck assignment and configuration check without mixing it with archive history.") }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                if (maxWidth >= 760.dp) Row {
                    InstallForm(truck, { truck = it }, company, { company = it }, mother, { mother = it }, subs, { i, v -> subs = subs.toMutableList().also { it[i] = v } }, status, { status = it }, { scanTarget = it }, state.working, {
                        model.install(truck, company, mother, subs, status) { shareReady = true }
                    }, Modifier.weight(.85f))
                    InstallationArchive(state, query, { query = it }, Modifier.weight(1.15f))
                } else Column {
                    InstallForm(truck, { truck = it }, company, { company = it }, mother, { mother = it }, subs, { i, v -> subs = subs.toMutableList().also { it[i] = v } }, status, { status = it }, { scanTarget = it }, state.working, {
                        model.install(truck, company, mother, subs, status) { shareReady = true }
                    })
                    InstallationArchive(state, query, { query = it })
                }
            }
        }
        if (shareReady) item {
            LaunchedEffect(Unit) { /* LazyColumn brings newly inserted trailing content into the active layout. */ }
            Panel("Send installation report", Modifier.fillMaxWidth()) {
                Text(message, style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { openWhatsApp(context, message); shareReady = false }, shape = RectangleShape, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF12351F), contentColor = SignalGreen)) { Text("SEND TO WHATSAPP") }
                    OutlinedButton(onClick = { shareReady = false }, shape = RectangleShape) { Text("DISMISS") }
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
        modifier = Modifier.fillMaxWidth().height(50.dp), shape = RectangleShape,
    ) { Text("RECORD INSTALLATION") }
}

@Composable
private fun InstallationArchive(state: NativeUiState, query: String, search: (String) -> Unit, modifier: Modifier = Modifier) = Panel("Installation history / ${number(state.installationTotal)}", modifier) {
    SearchField(query, search, "Search truck or lock serial")
    if (state.installations.isEmpty()) EmptyState("No installation events match this search.")
    state.installations.forEach { item ->
        Surface(Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
            Column(Modifier.padding(12.dp)) {
                Row(Modifier.fillMaxWidth()) { Text(item.truck, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(item.status.replace('_', ' ').uppercase(), style = MaterialTheme.typography.labelMedium, color = SignalGreen) }
                Text("Mother  ${item.mother}")
                Text("B/C/D  ${item.subs.joinToString("  /  ")}", style = MaterialTheme.typography.bodyMedium)
                Text(item.actor, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RepairsScreen(state: NativeUiState, model: DtcViewModel) {
    var faultOpen by remember { mutableStateOf(false) }
    var truck by remember { mutableStateOf("") }
    var device by remember { mutableStateOf("") }
    var reportedBy by remember { mutableStateOf("self_identified") }
    var faultType by remember { mutableStateOf("device_offline") }
    var affected by remember { mutableStateOf(setOf("mother")) }
    var location by remember { mutableStateOf("installation_point") }
    var online by remember { mutableStateOf("no") }
    var description by remember { mutableStateOf("") }
    var remoteOpen by remember { mutableStateOf("not_applicable") }
    var staticUsed by remember { mutableStateOf("no") }
    var staticAuthBy by remember { mutableStateOf("") }
    var resolution by remember { mutableStateOf("pending") }
    var minutes by remember { mutableStateOf("") }
    var followup by remember { mutableStateOf("no") }
    var followupDetails by remember { mutableStateOf("") }
    var incidentStatus by remember { mutableStateOf("open_pending_followup") }
    var closureBy by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var scanDevice by remember { mutableStateOf(false) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Fault and lifecycle control", "Repair", "Operations", number(state.repairPool.size), "Report field faults and disposition the same repair pool used by the web app.") }
        item {
            OutlinedButton(onClick = { faultOpen = !faultOpen }, Modifier.fillMaxWidth(), shape = RectangleShape) {
                Icon(if (faultOpen) Icons.Outlined.Close else Icons.Outlined.Warning, null); Spacer(Modifier.width(8.dp)); Text(if (faultOpen) "CLOSE FAULT REPORT" else "REPORT FAULT")
            }
        }
        if (faultOpen) item {
            Panel("Fault report") {
                OutlinedTextField(truck, { truck = it.uppercase() }, Modifier.fillMaxWidth(), label = { Text("Truck plate") }, singleLine = true)
                ScanField("Affected device", device, { device = it }) { scanDevice = true }
                ChoiceLine("Reported by", reportedBy, listOf("station_manager" to "Station manager", "customer_rep" to "Customer rep", "driver" to "Driver", "team_member" to "Team member", "self_identified" to "Self")) { reportedBy = it }
                ChoiceLine("Fault type", faultType, listOf("device_offline" to "Offline", "dynamic_password_failed" to "Password failed", "sub_lock_not_opening" to "Sub-lock", "charging_failure" to "Charging", "configuration_error" to "Configuration", "hardware_damage" to "Damage", "seal_discrepancy" to "Seal", "other" to "Other")) { faultType = it }
                Text("LOCKS AFFECTED", style = MaterialTheme.typography.labelMedium)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    listOf("mother" to "Mother", "B" to "B", "C" to "C", "D" to "D").forEach { (value, label) -> FilterChip(value in affected, { affected = if (value in affected) affected - value else affected + value }, { Text(label) }) }
                }
                ChoiceLine("Truck location", location, listOf("in_transit" to "In transit", "customer_location" to "Customer", "installation_point" to "Install point")) { location = it }
                ChoiceLine("Device online", online, listOf("yes" to "Yes", "intermittent" to "Intermittent", "no" to "No")) { online = it }
                OutlinedTextField(description, { description = it }, Modifier.fillMaxWidth(), label = { Text("Fault description") }, minLines = 3)
                ChoiceLine("Remote open", remoteOpen, listOf("success" to "Success", "failed" to "Failed", "not_applicable" to "N/A")) { remoteOpen = it }
                ChoiceLine("Static password used", staticUsed, listOf("yes" to "Yes", "no" to "No")) { staticUsed = it }
                if (staticUsed == "yes") ChoiceLine("Static password authorised by", staticAuthBy, state.supervisors) { staticAuthBy = it }
                ChoiceLine("Resolution", resolution, listOf("resolved_remotely" to "Remote", "static_password_issued" to "Static PW", "device_reconfigured" to "Reconfigured", "device_replaced" to "Replaced", "pending" to "Pending", "escalated" to "Escalated")) { resolution = it }
                OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit) }, Modifier.fillMaxWidth(), label = { Text("Minutes to resolve") }, singleLine = true)
                ChoiceLine("Follow-up required", followup, listOf("yes" to "Yes", "no" to "No")) { followup = it }
                if (followup == "yes") OutlinedTextField(followupDetails, { followupDetails = it }, Modifier.fillMaxWidth(), label = { Text("Follow-up details") }, minLines = 2)
                ChoiceLine("Incident status", incidentStatus, listOf("closed" to "Closed", "open_pending_followup" to "Open / follow-up")) { incidentStatus = it }
                if (incidentStatus == "closed") ChoiceLine("Closure approved by", closureBy, state.supervisors) { closureBy = it }
                OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("Notes") }, minLines = 2)
                Button(
                    onClick = {
                        val payload = org.json.JSONObject()
                            .put("truckPlate", truck).put("deviceSerial", device).put("reportedBy", reportedBy).put("faultType", faultType)
                            .put("locksAffected", org.json.JSONArray(affected.toList())).put("truckLocation", location).put("deviceOnline", online)
                            .put("description", description).put("remoteOpen", remoteOpen).put("staticPwUsed", staticUsed).put("resolution", resolution)
                            .put("followupRequired", followup).put("followupDetails", followupDetails).put("incidentStatus", incidentStatus).put("notes", notes)
                            .put("staticPwAuthBy", if (staticUsed == "yes") staticAuthBy else org.json.JSONObject.NULL)
                            .put("closureBy", if (incidentStatus == "closed") closureBy else org.json.JSONObject.NULL)
                        minutes.toIntOrNull()?.let { payload.put("minutesToResolve", it) }
                        model.reportFault(payload) { description = ""; notes = ""; faultOpen = false }
                    },
                    enabled = !state.working && truck.isNotBlank() && device.isNotBlank() && description.isNotBlank() && affected.isNotEmpty()
                        && (staticUsed != "yes" || staticAuthBy.isNotBlank()) && (incidentStatus != "closed" || closureBy.isNotBlank()),
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = RectangleShape,
                ) { Text("SUBMIT FAULT REPORT") }
            }
        }
        item {
            Panel("Repair pool / ${state.repairPool.size}") {
                if (state.repairPool.isEmpty()) EmptyState("No devices are awaiting repair.")
                state.repairPool.forEach { item ->
                    Surface(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row { Text(item.serial, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(item.deviceType.uppercase(), style = MaterialTheme.typography.labelMedium) }
                            Text(item.removalReason?.replace('_', ' ') ?: "Reason not recorded", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            item.removalNotes?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            if (state.dashboard?.user?.role == "supervisor") FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { model.triage(item.deviceId, "revived") }, enabled = !state.working, shape = RectangleShape, colors = ButtonDefaults.buttonColors(containerColor = SignalGreen)) { Text("REVIVE") }
                                OutlinedButton(onClick = { model.triage(item.deviceId, "dead") }, enabled = !state.working, shape = RectangleShape, border = BorderStroke(1.dp, DtcRed), colors = ButtonDefaults.outlinedButtonColors(contentColor = DtcRed)) { Text("DECLARE DEAD") }
                            } else Text("Supervisor approval is required for disposition.", color = SafetyAmber)
                        }
                    }
                }
            }
        }
    }
    if (scanDevice) ScannerDialog("affected device", onScanned = { device = it; scanDevice = false }, onDismiss = { scanDevice = false })
}

@Composable
private fun LookupScreen(result: LookupSnapshot?, lookup: (String) -> Unit) {
    var query by remember { mutableStateOf("") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Asset intelligence", "Asset", "Lookup", "01", "Search by truck plate or mother-lock serial.") }
        item {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(query, { query = it }, Modifier.weight(1f), label = { Text("Truck or mother serial") }, singleLine = true)
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { lookup(query) }, enabled = query.isNotBlank(), modifier = Modifier.height(56.dp), shape = RectangleShape) { Icon(Icons.Outlined.Search, "Search") }
                }
                if (result == null) EmptyState("Enter a truck plate or mother serial to inspect its current state.")
                else if (result.targetKind == "unknown") EmptyState("No registered truck or mother lock matched ${result.label}.")
                else {
                    BoxWithConstraints(Modifier.fillMaxWidth()) {
                        if (maxWidth >= 650.dp) Row {
                            LookupIdentity(result, Modifier.weight(1f)); LookupKit(result, Modifier.weight(1f))
                        } else Column { LookupIdentity(result); LookupKit(result) }
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
private fun LookupParityScreen(state: NativeUiState, model: DtcViewModel) {
    var query by remember { mutableStateOf("") }
    var recent by remember { mutableStateOf(listOf<String>()) }
    val result = state.lookup
    var correctionCompany by remember(result?.targetId) { mutableStateOf(result?.company?.lowercase()?.takeIf { result.companyDeclared }.orEmpty()) }
    var correctionNotes by remember(result?.targetId) { mutableStateOf("") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Asset intelligence", "Asset", "Lookup", if (result?.targetKind == "unknown" || result == null) "00" else "01", "Search a truck plate or mother serial and inspect the complete operational cockpit.") }
        item {
            Panel("Lookup target") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(query, { query = it.uppercase() }, Modifier.weight(1f), label = { Text("Truck or mother serial") }, singleLine = true)
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { recent = listOf(query) + recent.filterNot { it == query }.take(4); model.lookup(query) }, enabled = query.isNotBlank(), modifier = Modifier.height(56.dp), shape = RectangleShape) { Icon(Icons.Outlined.Search, "Search") }
                }
                if (recent.isNotEmpty()) {
                    Text("RECENT LOOKUPS", style = MaterialTheme.typography.labelMedium)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        recent.forEach { value -> FilterChip(false, { query = value; model.lookup(value) }, { Text(value) }) }
                    }
                }
            }
        }
        if (result == null) item { EmptyState("Enter a truck plate or mother serial to inspect its current state.") }
        else if (result.targetKind == "unknown") item { EmptyState("No registered truck or mother lock matched ${result.label}.") }
        else {
            item {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    if (maxWidth >= 700.dp) Row {
                        Panel("Current state", Modifier.weight(1f)) {
                            Text(result.label, style = MaterialTheme.typography.headlineMedium)
                            ValueLine("Target", result.targetKind.replace('_', ' '))
                            ValueLine("Serving company", if (result.companyDeclared) result.company else "Not yet declared")
                            ValueLine("Trust", result.trust, if (result.trust == "verified") SignalGreen else SafetyAmber)
                            ValueLine("Verification tier", result.weakestTier?.replace('_', ' ') ?: "Not verified")
                            ValueLine("Open reviews", result.reviews.toString(), if (result.reviews > 0) DtcRed else null)
                            ValueLine("Pending sync", result.pendingSyncCount.toString(), if (result.pendingSyncCount > 0) SafetyAmber else null)
                        }
                        Panel("Current kit", Modifier.weight(1f)) {
                            ValueLine("Status", result.kitStatus.replace('_', ' '), if (result.kitStatus == "confirmed") SignalGreen else SafetyAmber)
                            ValueLine("Mother", result.mother ?: "Not assigned")
                            result.subs.forEach { (slot, serial) -> ValueLine("Sub-lock $slot", serial ?: "Not assigned") }
                        }
                    } else Column {
                        Panel("Current state") {
                            Text(result.label, style = MaterialTheme.typography.headlineMedium)
                            ValueLine("Target", result.targetKind.replace('_', ' ')); ValueLine("Serving company", if (result.companyDeclared) result.company else "Not yet declared")
                            ValueLine("Trust", result.trust, if (result.trust == "verified") SignalGreen else SafetyAmber); ValueLine("Open reviews", result.reviews.toString(), if (result.reviews > 0) DtcRed else null)
                        }
                        Panel("Current kit") { ValueLine("Status", result.kitStatus.replace('_', ' ')); ValueLine("Mother", result.mother ?: "Not assigned"); result.subs.forEach { (slot, serial) -> ValueLine("Sub-lock $slot", serial ?: "Not assigned") } }
                    }
                }
            }
            item {
                Panel("Operational actions") {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { model.open(AppScreen.Install) }, shape = RectangleShape) { Text("OPEN INSTALL") }
                        OutlinedButton(onClick = { model.open(AppScreen.Repairs) }, shape = RectangleShape) { Text("REPORT / REPAIR") }
                        if (result.reviews > 0 && state.dashboard?.user?.role == "supervisor") OutlinedButton(onClick = { model.open(AppScreen.Review) }, shape = RectangleShape) { Text("OPEN REVIEWS") }
                    }
                    if (state.dashboard?.user?.role == "supervisor" && result.targetKind == "truck" && result.targetId != null) {
                        Divider()
                        Text("SUPERVISOR COMPANY CORRECTION", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                        ChoiceLine("Serving company", correctionCompany, listOf("mrs" to "MRS", "dangote" to "Dangote")) { correctionCompany = it }
                        OutlinedTextField(correctionNotes, { correctionNotes = it }, Modifier.fillMaxWidth(), label = { Text("Correction notes") }, minLines = 2)
                        Button(
                            onClick = { model.setTruckCompany(result.targetId, correctionCompany, correctionNotes, result.label) },
                            enabled = !state.working && correctionCompany.isNotBlank(),
                            shape = RectangleShape,
                        ) { Text("UPDATE SERVING COMPANY") }
                    }
                }
            }
            if (result.reviewItems.isNotEmpty()) item {
                Panel("Conflict reviews") {
                    result.reviewItems.forEach { review -> Column(Modifier.fillMaxWidth().border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)).padding(10.dp)) { Text(review.kind.replace('_', ' ').uppercase(), color = DtcRed, style = MaterialTheme.typography.labelLarge); Text(review.payload, maxLines = 5, overflow = TextOverflow.Ellipsis) } }
                }
            }
            item { FeedPanel("Audit trail", result.audit) }
        }
    }
}

@Composable
private fun ReviewScreen(state: NativeUiState, model: DtcViewModel) {
    val canDecide = state.dashboard?.user?.role == "supervisor"
    var selected by remember { mutableStateOf<ReviewItem?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Exception control", "Open", "Reviews", state.reviews.size.toString().padStart(2, '0'), if (canDecide) "Inspect the complete evidence before resolving or dismissing." else "Review evidence is visible; supervisor authority is required for decisions.") }
        if (state.reviews.isEmpty()) item { EmptyState("No reviews need attention.") }
        items(state.reviews, key = { it.id }) { review ->
            Surface(
                Modifier.fillMaxWidth().clickable { selected = review },
                shape = RectangleShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
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
    selected?.let { review -> ReviewDialog(review, canDecide, onDismiss = { selected = null }) { action, notes -> model.review(review.id, action, notes); selected = null } }
}

@Composable
private fun ReviewDialog(review: ReviewItem, canDecide: Boolean, onDismiss: () -> Unit, action: (String, String) -> Unit) {
    var notes by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(review.kind.replace('_', ' ').uppercase()) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("REVIEW PAYLOAD", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                Text(review.payload, style = MaterialTheme.typography.bodyMedium)
                if (canDecide) OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("Decision notes") }, minLines = 3)
                else Text("Supervisor authority is required to resolve or dismiss this review.", color = SafetyAmber)
            }
        },
        confirmButton = { if (canDecide) Button(onClick = { action("resolve", notes) }, colors = ButtonDefaults.buttonColors(containerColor = SignalGreen), shape = RoundedCornerShape(2.dp)) { Text("Resolve") } else TextButton(onClick = onDismiss) { Text("Close") } },
        dismissButton = { if (canDecide) Row { TextButton(onClick = { action("dismiss", notes) }) { Text("Dismiss review") }; TextButton(onClick = onDismiss) { Text("Cancel") } } },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SettingsScreen(state: NativeUiState, model: DtcViewModel) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Application control", "System", "Settings", "02", "Appearance and secure profile controls for this Android device.") }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val wide = maxWidth >= 650.dp
                if (wide) Row {
                    AppearancePanel(state, model, Modifier.weight(1f)); ProfilePanel(state, model, Modifier.weight(1f))
                } else Column { AppearancePanel(state, model); ProfilePanel(state, model) }
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
    Divider()
    ChoiceLine("Layout density", if (state.compactMode) "compact" else "standard", listOf("standard" to "Standard", "compact" to "Compact")) { model.setCompact(it == "compact") }
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SettingsParityScreen(state: NativeUiState, model: DtcViewModel) {
    var addOpen by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var role by remember { mutableStateOf("installer") }
    var company by remember { mutableStateOf("") }
    val settings = state.settings
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item { PageHeader("Application control", "System", "Settings", if (state.dashboard?.user?.role == "supervisor") "04" else "02", "Profile and appearance for every operator; team access and exports for supervisors.") }
        item {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                if (maxWidth >= 700.dp) Row { AppearancePanel(state, model, Modifier.weight(1f)); ProfilePanel(state, model, Modifier.weight(1f)) }
                else Column { AppearancePanel(state, model); ProfilePanel(state, model) }
            }
        }
        if (state.dashboard?.user?.role == "supervisor") {
            item {
                Panel("Team access / ${settings?.users?.size ?: 0}") {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(settings?.organisation ?: "DTC", style = MaterialTheme.typography.titleMedium); Text("Installer and supervisor accounts", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        IconButton(onClick = { addOpen = !addOpen }) { Icon(if (addOpen) Icons.Outlined.Close else Icons.Outlined.AddBox, if (addOpen) "Close add user form" else "Add user") }
                    }
                    if (addOpen) {
                        Divider()
                        OutlinedTextField(displayName, { displayName = it }, Modifier.fillMaxWidth(), label = { Text("Display name") }, singleLine = true)
                        OutlinedTextField(username, { username = it.lowercase() }, Modifier.fillMaxWidth(), label = { Text("Username") }, singleLine = true)
                        OutlinedTextField(
                            password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Temporary password (12+ characters)") }, singleLine = true,
                            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                            trailingIcon = { IconButton(onClick = { passwordVisible = !passwordVisible }) { Icon(if (passwordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, "Toggle password") } },
                        )
                        ChoiceLine("Role", role, listOf("installer" to "Installer", "supervisor" to "Supervisor")) { role = it }
                        ChoiceLine("Company", company, listOf("" to "Unassigned", "mrs" to "MRS", "dangote" to "Dangote")) { company = it }
                        Button(
                            onClick = { model.createUser(username, displayName, password, role, company.ifBlank { null }) { username = ""; displayName = ""; password = ""; addOpen = false } },
                            enabled = !state.working && username.length >= 3 && displayName.isNotBlank() && password.length >= 12,
                            modifier = Modifier.fillMaxWidth().height(50.dp), shape = RectangleShape,
                        ) { Text("ADD USER") }
                    }
                    settings?.users?.forEach { user ->
                        Surface(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(user.displayName, style = MaterialTheme.typography.titleMedium)
                                    Text("${user.username} / ${user.role.uppercase()}${user.company?.let { " / ${it.uppercase()}" } ?: ""}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Text(if (user.isActive) "ACTIVE" else "INACTIVE", color = if (user.isActive) SignalGreen else DtcRed, style = MaterialTheme.typography.labelMedium)
                                Spacer(Modifier.width(8.dp))
                                OutlinedButton(
                                    onClick = { model.setUserActive(user.id, !user.isActive) },
                                    enabled = !state.working && user.id != settings.currentUserId,
                                    shape = RectangleShape,
                                ) { Text(if (user.isActive) "DEACTIVATE" else "ACTIVATE") }
                            }
                        }
                    }
                }
            }
            item {
                Panel("Data exports / ${settings?.exports?.size ?: 0}") {
                    Text("Exports use the same organisation-scoped datasets and supervisor checks as the web app.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    settings?.exports?.forEach { export ->
                        Row(Modifier.fillMaxWidth().border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text(export.label, style = MaterialTheme.typography.labelLarge); Text("${number(export.rowCount)} rows", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            TextButton(onClick = { model.exportData(export.key, "csv") }) { Text("CSV") }
                            TextButton(onClick = { model.exportData(export.key, "json") }) { Text("JSON") }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChoiceLine(label: String, value: String, options: List<Pair<String, String>>, setValue: (String) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            options.forEach { (option, text) -> FilterChip(value == option, { setValue(option) }, { Text(text) }) }
        }
    }
}

@Composable
private fun ScanField(label: String, value: String, setValue: (String) -> Unit, scan: () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelMedium)
        Row(Modifier.fillMaxWidth()) {
            OutlinedTextField(value, setValue, Modifier.weight(1f), placeholder = { Text("SCAN OR ENTER ${label.uppercase()}") }, singleLine = true)
            Button(onClick = scan, Modifier.height(56.dp), shape = RectangleShape) {
                Icon(Icons.Outlined.QrCodeScanner, "Scan $label", Modifier.size(18.dp))
                Spacer(Modifier.width(7.dp))
                Text("SCAN")
            }
        }
    }
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
    val compact = LocalCompactMode.current
    Surface(modifier, shape = RectangleShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().height(if (compact) 36.dp else 42.dp).background(MaterialTheme.colorScheme.surfaceVariant).border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)).padding(horizontal = if (compact) 10.dp else 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("[ ${title.uppercase()} ]", style = MaterialTheme.typography.titleMedium)
            }
            Column(Modifier.fillMaxWidth().padding(if (compact) 8.dp else 12.dp), verticalArrangement = Arrangement.spacedBy(if (compact) 7.dp else 10.dp), content = content)
        }
    }
}

@Composable
private fun ValueLine(label: String, value: String, color: Color? = null) {
    Row(Modifier.fillMaxWidth().height(46.dp).border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label.uppercase(), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value.uppercase(), style = MaterialTheme.typography.labelLarge, color = color ?: MaterialTheme.colorScheme.onSurface)
    }
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
    Image(
        painter = painterResource(R.drawable.dtc_logo_white_cropped),
        contentDescription = "Direct Trucking Company",
        modifier = if (compact) Modifier.width(82.dp) else Modifier.width(142.dp),
        colorFilter = if (light) null else ColorFilter.tint(MaterialTheme.colorScheme.onSurface),
    )
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
