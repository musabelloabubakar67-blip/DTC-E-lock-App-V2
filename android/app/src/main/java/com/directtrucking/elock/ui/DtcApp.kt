package com.directtrucking.elock.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddBox
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HomeRepairService
import androidx.compose.material.icons.outlined.InstallMobile
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.ListAlt
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.SwapVert
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
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
    val workflowTruck: String = "",
    val workflowDevice: String = "",
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
        _state.update {
            it.copy(
                selected = screen,
                workflowTruck = "",
                workflowDevice = "",
                message = null,
                error = null,
            )
        }
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

    fun refreshCurrent() = launchWork {
        val current = _state.value
        if (demo) {
            _state.update { it.copy(message = "${current.selected.label} refreshed in demo mode") }
            return@launchWork
        }
        when (current.selected) {
            AppScreen.Dashboard -> {
                val sync = api.syncPending()
                _state.update {
                    it.copy(
                        dashboard = api.bootstrap(),
                        pendingSyncCount = sync.pending,
                        message = if (sync.applied > 0) "Workspace refreshed / ${sync.applied} queued changes synced" else "Workspace refreshed",
                    )
                }
            }
            AppScreen.Register -> {
                val (items, total) = api.registry()
                _state.update { it.copy(registry = items, registryTotal = total, registryPage = 0, message = "Registry refreshed") }
            }
            AppScreen.Install -> {
                val (items, total) = api.installationHistory()
                _state.update { it.copy(installations = items, installationTotal = total, installationPage = 0, message = "Installation history refreshed") }
            }
            AppScreen.Repairs -> {
                _state.update { it.copy(repairPool = api.repairPool(), supervisors = api.supervisors(), message = "Repair pool refreshed") }
            }
            AppScreen.Lookup -> {
                val query = current.lookup?.label?.takeIf(String::isNotBlank)
                _state.update {
                    if (query == null) it.copy(message = "Enter a truck or mother lock to refresh its lookup")
                    else it.copy(lookup = api.lookup(query), message = "Lookup refreshed")
                }
            }
            AppScreen.Review -> {
                _state.update { it.copy(reviews = api.reviews(), message = "Reviews refreshed") }
            }
            AppScreen.Settings -> {
                _state.update { it.copy(settings = api.settings(), message = "Settings refreshed") }
            }
        }
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

    fun openInstallFromLookup() {
        val lookup = _state.value.lookup ?: return
        val truck = lookup.label.takeIf { lookup.targetKind == "truck" }.orEmpty()
        _state.update {
            it.copy(
                selected = AppScreen.Install,
                workflowTruck = truck,
                workflowDevice = lookup.mother.orEmpty(),
                message = null,
                error = null,
            )
        }
        loadInstallations()
    }

    fun openRepairsFromLookup() {
        val lookup = _state.value.lookup ?: return
        _state.update {
            it.copy(
                selected = AppScreen.Repairs,
                workflowTruck = lookup.label.takeIf { lookup.targetKind == "truck" }.orEmpty(),
                workflowDevice = lookup.mother.orEmpty(),
                message = null,
                error = null,
            )
        }
        loadRepairs()
    }

    fun verifyLookupKit(
        truck: String?,
        mother: String,
        subs: List<String>,
        motherSource: String,
        subSources: List<String>,
        done: () -> Unit,
    ) = launchWork {
        val sync = api.verifyKit(truck, mother, subs, motherSource, subSources)
        val query = truck?.takeIf(String::isNotBlank) ?: mother
        _state.update {
            it.copy(
                lookup = if (sync.applied > 0) api.lookup(query) else it.lookup,
                reviews = if (sync.applied > 0 && it.dashboard?.user?.role == "supervisor") api.reviews() else it.reviews,
                pendingSyncCount = sync.pending,
                message = if (sync.applied > 0) "Physical kit verified" else "Verification saved on this device / pending sync",
            )
        }
        done()
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

    fun resetUserPassword(userId: String, password: String, done: () -> Unit) = launchWork {
        api.resetUserPassword(userId, password)
        _state.update { it.copy(message = "Password reset. Existing sessions have been revoked.") }
        done()
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
private enum class NativeLayout { Phone, CompactTablet, WideTablet }
private val LocalNativeLayout = staticCompositionLocalOf { NativeLayout.Phone }
private val PageEndPadding = 88.dp

@Composable
private fun LoadingScreen(label: String) {
    Box(Modifier.fillMaxSize()) {
        Box(Modifier.align(Alignment.TopStart).width(6.dp).fillMaxHeight().background(DtcRed))
        Column(
            Modifier.align(Alignment.Center).padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            DtcMark()
            Spacer(Modifier.height(32.dp))
            CircularProgressIndicator(Modifier.size(28.dp), color = DtcRed, strokeWidth = 3.dp)
            Spacer(Modifier.height(16.dp))
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun LoginScreen(working: Boolean, error: String?, login: (String, String) -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding().imePadding().padding(20.dp)) {
        val wide = maxWidth >= 700.dp
        val loginWidth = if (wide) 430.dp else maxWidth
        Box(Modifier.align(Alignment.TopStart).width(6.dp).fillMaxHeight().background(DtcRed))
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
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            ) {
                Column(
                    Modifier.padding(if (wide) 28.dp else 22.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(17.dp),
                ) {
                    if (!wide) DtcMark()
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(7.dp).background(DtcRed, CircleShape))
                        Spacer(Modifier.width(8.dp))
                        Text("SECURE ACCESS", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
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
                        shape = RoundedCornerShape(7.dp),
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
        val layout = when {
            maxWidth >= 900.dp -> NativeLayout.WideTablet
            maxWidth >= 600.dp || (maxWidth >= 500.dp && maxHeight >= 760.dp) -> NativeLayout.CompactTablet
            else -> NativeLayout.Phone
        }
        CompositionLocalProvider(LocalNativeLayout provides layout) {
            if (layout != NativeLayout.Phone) {
                val compactTablet = layout == NativeLayout.CompactTablet
                val railWidth = if (compactTablet) 92.dp else 196.dp
                Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
                    TopBar(state, model::refreshDashboard, railWidth)
                    Row(Modifier.weight(1f)) {
                        TabletRail(state, compactTablet, model::open, model::logout)
                        ScreenContent(
                            state,
                            model,
                            Modifier.weight(1f).padding(
                                start = if (compactTablet) 14.dp else 20.dp,
                                top = 16.dp,
                                end = if (compactTablet) 14.dp else 20.dp,
                                bottom = 14.dp,
                            ),
                        )
                    }
                }
            } else {
                Scaffold(
                    contentWindowInsets = WindowInsets.safeDrawing,
                    topBar = { TopBar(state, model::refreshDashboard) },
                    bottomBar = { PhoneNav(state.selected, model::open) { moreOpen = true } },
                ) { padding ->
                    ScreenContent(
                        state,
                        model,
                        Modifier.padding(padding).padding(horizontal = 12.dp, vertical = 12.dp),
                    )
                }
            }
        }
    }
    if (moreOpen) {
        ModalBottomSheet(
            onDismissRequest = { moreOpen = false },
            containerColor = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
        ) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("MORE", style = MaterialTheme.typography.titleLarge)
                        Text("Additional operations", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = { moreOpen = false }) { Icon(Icons.Outlined.Close, "Close menu") }
                }
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
    Surface(surfaceModifier, color = Ink, contentColor = IndustrialText) {
        Row(
            Modifier.fillMaxWidth().height(if (brandWidth == null) 64.dp else 72.dp)
                .border(width = 1.dp, color = Rule, shape = RectangleShape),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (brandWidth != null) {
                Box(Modifier.width(brandWidth).fillMaxHeight().padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                    DtcMark(compact = brandWidth < 100.dp, light = true)
                }
            }
            Row(Modifier.weight(1f).fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).fillMaxHeight().padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (brandWidth == null) {
                        DtcMark(compact = true, light = true)
                    } else {
                        Box(Modifier.size(8.dp).background(DtcRed, CircleShape))
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text("E-LOCK CONTROL", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("FIELD OPERATIONS", style = MaterialTheme.typography.labelMedium, color = IndustrialMuted)
                        }
                    }
                }
                if (brandWidth != null) {
                    if (state.working) CircularProgressIndicator(Modifier.size(18.dp), color = DtcRed, strokeWidth = 2.dp)
                    Surface(
                        Modifier.padding(horizontal = 8.dp),
                        color = PanelRaised,
                        shape = CircleShape,
                        border = BorderStroke(1.dp, Rule),
                    ) {
                        IconButton(onClick = refresh, modifier = Modifier.size(42.dp)) {
                            Icon(Icons.Outlined.Refresh, "Refresh", Modifier.size(19.dp))
                        }
                    }
                    SyncBadge(state.pendingSyncCount)
                } else if (state.working) {
                    CircularProgressIndicator(Modifier.size(15.dp), color = DtcRed, strokeWidth = 2.dp)
                }
                if (brandWidth == null && !state.working) {
                    SyncBadge(state.pendingSyncCount, compact = true)
                }
                Column(Modifier.fillMaxHeight().padding(horizontal = if (brandWidth == null) 12.dp else 16.dp), verticalArrangement = Arrangement.Center) {
                    Text(state.dashboard?.user?.role?.uppercase().orEmpty(), style = MaterialTheme.typography.labelMedium, maxLines = 1)
                    if (brandWidth != null) {
                        Text(state.dashboard?.user?.name?.substringBefore(' ').orEmpty(), style = MaterialTheme.typography.bodyMedium, color = IndustrialMuted, maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
private fun SyncBadge(count: Int, compact: Boolean = false) {
    val pending = count > 0
    val tone = if (pending) SafetyAmber else SignalGreen
    Surface(
        color = PanelRaised,
        shape = RoundedCornerShape(7.dp),
        border = BorderStroke(1.dp, Rule),
    ) {
        Row(
            Modifier.padding(horizontal = if (compact) 9.dp else 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (pending) Icons.Outlined.CloudUpload else Icons.Outlined.CloudDone,
                if (pending) "$count changes waiting to sync" else "All changes synchronized",
                Modifier.size(17.dp),
                tint = tone,
            )
            if (!compact) {
                Spacer(Modifier.width(7.dp))
                Text(if (pending) "$count QUEUED" else "SYNCED", style = MaterialTheme.typography.labelMedium, color = tone)
            }
        }
    }
}

@Composable
private fun TabletRail(state: NativeUiState, compact: Boolean, open: (AppScreen) -> Unit, logout: () -> Unit) {
    Surface(Modifier.width(if (compact) 92.dp else 184.dp).fillMaxHeight(), color = Ink, contentColor = IndustrialText) {
        BoxWithConstraints {
        val short = maxHeight < 560.dp
        Column(Modifier.fillMaxSize().padding(horizontal = 8.dp, vertical = if (short) 6.dp else 10.dp)) {
            AppScreen.entries.forEach { screen ->
                if (screen != AppScreen.Review || state.dashboard?.user?.role == "supervisor") {
                    if (compact) {
                        Surface(
                            Modifier.fillMaxWidth().height(if (short) 54.dp else 66.dp).clickable { open(screen) },
                            color = if (state.selected == screen) PanelRaised else Color.Transparent,
                            shape = RoundedCornerShape(8.dp),
                            border = if (state.selected == screen) BorderStroke(1.dp, RuleStrong) else null,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Spacer(Modifier.height(10.dp))
                                Icon(screen.icon, screen.label, Modifier.size(22.dp), tint = if (state.selected == screen) DtcRed else IndustrialMuted)
                                Text(screen.label.uppercase(), style = MaterialTheme.typography.labelMedium, color = if (state.selected == screen) IndustrialText else IndustrialMuted)
                            }
                        }
                    } else NavRow(screen, state.selected == screen, dark = true, dense = short) { open(screen) }
                    Spacer(Modifier.height(if (short) 2.dp else 4.dp))
                }
            }
            Spacer(Modifier.weight(1f))
            if (!compact && !short) {
                Column(
                    Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(8.dp))
                        .border(BorderStroke(1.dp, Rule), RoundedCornerShape(8.dp))
                        .padding(12.dp),
                ) {
                    Text("SYSTEM ONLINE", style = MaterialTheme.typography.labelMedium, color = SignalGreen)
                    Spacer(Modifier.height(4.dp))
                    Text("Revision 03.0", style = MaterialTheme.typography.bodyMedium, color = IndustrialMuted)
                    Text("${state.pendingSyncCount} queued changes", style = MaterialTheme.typography.bodyMedium, color = if (state.pendingSyncCount > 0) SafetyAmber else IndustrialMuted)
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(
                Modifier.fillMaxWidth().clickable(onClick = logout).padding(horizontal = 12.dp, vertical = if (short) 10.dp else 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = if (compact) Arrangement.Center else Arrangement.Start,
            ) {
                Icon(Icons.Outlined.Logout, null, Modifier.size(20.dp))
                if (!compact) { Spacer(Modifier.width(12.dp)); Text("Sign out", style = MaterialTheme.typography.labelLarge) }
            }
        }
        }
    }
}

@Composable
private fun NavRow(screen: AppScreen, active: Boolean, dark: Boolean = false, dense: Boolean = false, onClick: () -> Unit) {
    val activeColor = if (dark) IndustrialText else MaterialTheme.colorScheme.onSurface
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick)
            .background(if (active) PanelRaised else Color.Transparent, RoundedCornerShape(8.dp))
            .then(if (active) Modifier.border(BorderStroke(1.dp, if (dark) RuleStrong else MaterialTheme.colorScheme.outline), RoundedCornerShape(8.dp)) else Modifier)
            .height(if (dense) 44.dp else 52.dp).padding(horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(screen.icon, null, Modifier.size(21.dp), tint = if (active) DtcRed else activeColor.copy(alpha = .72f))
        Spacer(Modifier.width(12.dp))
        Text(screen.label, style = MaterialTheme.typography.labelLarge, color = activeColor)
        if (active) {
            Spacer(Modifier.weight(1f))
            Box(Modifier.size(6.dp).background(DtcRed, CircleShape))
        }
    }
}

@Composable
private fun PhoneNav(selected: AppScreen, open: (AppScreen) -> Unit, more: () -> Unit) {
    Surface(color = Ink, contentColor = IndustrialText, border = BorderStroke(1.dp, Rule)) {
        Row(Modifier.fillMaxWidth().navigationBarsPadding().height(76.dp).padding(horizontal = 6.dp, vertical = 5.dp), horizontalArrangement = Arrangement.SpaceAround) {
            listOf(AppScreen.Dashboard, AppScreen.Register, AppScreen.Install, AppScreen.Lookup).forEach { screen ->
                PhoneNavItem(screen.label, screen.icon, selected == screen) { open(screen) }
            }
            PhoneNavItem("More", Icons.Outlined.MoreHoriz, selected in listOf(AppScreen.Repairs, AppScreen.Review, AppScreen.Settings), more)
        }
    }
}

@Composable
private fun RowScope.PhoneNavItem(label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.weight(1f).fillMaxHeight().clickable(onClick = onClick)
            .padding(horizontal = 2.dp)
            .background(if (selected) PanelRaised else Color.Transparent, RoundedCornerShape(8.dp)),
    ) {
        Column(
            Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(icon, label, Modifier.size(22.dp), tint = if (selected) DtcRed else IndustrialMuted)
            Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = if (selected) IndustrialText else IndustrialMuted)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScreenContent(state: NativeUiState, model: DtcViewModel, modifier: Modifier = Modifier) {
    val view = LocalView.current
    LaunchedEffect(state.message) {
        if (state.message != null) {
            view.performHapticFeedback(
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM
                else HapticFeedbackConstants.LONG_PRESS,
            )
        }
    }
    LaunchedEffect(state.error) {
        if (state.error != null) {
            view.performHapticFeedback(
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT
                else HapticFeedbackConstants.LONG_PRESS,
            )
        }
    }
    Column(modifier.fillMaxSize()) {
        if (state.error != null) StatusStrip(state.error, true, model::clearNotice)
        else if (state.message != null) StatusStrip(state.message, false, model::clearNotice)
        if (state.pendingSyncCount > 0) PendingQueueStrip(state.pendingSyncCount, state.working) { model.syncQueue() }
        AnimatedVisibility(visible = state.working, enter = fadeIn(), exit = fadeOut()) {
            LinearProgressIndicator(
                Modifier.fillMaxWidth().height(3.dp),
                color = DtcRed,
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )
        }
        PullToRefreshBox(
            isRefreshing = state.working,
            onRefresh = model::refreshCurrent,
            modifier = Modifier.fillMaxSize().weight(1f).imePadding(),
        ) {
            Crossfade(
                targetState = state.selected,
                animationSpec = tween(durationMillis = 160),
                label = "native-screen",
            ) { screen ->
                when (screen) {
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
    val tone = if (error) DtcRed else SignalGreen
    Row(
        Modifier.fillMaxWidth()
            .background(tone.copy(alpha = .14f), RoundedCornerShape(6.dp))
            .border(BorderStroke(1.dp, tone), RoundedCornerShape(6.dp))
            .semantics { liveRegion = if (error) LiveRegionMode.Assertive else LiveRegionMode.Polite }
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (error) Icons.Outlined.ErrorOutline else Icons.Outlined.CheckCircle, null, tint = tone)
        Text(message, Modifier.padding(horizontal = 10.dp).weight(1f), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyMedium)
        if (close != null) IconButton(onClick = close) { Icon(Icons.Outlined.Close, "Dismiss", tint = tone) }
    }
}

@Composable
private fun PageHeader(kicker: String, title: String, accent: String, metric: String, detail: String) {
    val tablet = LocalNativeLayout.current != NativeLayout.Phone
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Box {
            Box(Modifier.align(Alignment.CenterStart).width(5.dp).fillMaxHeight().background(DtcRed))
            if (tablet) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 128.dp).padding(start = 24.dp, top = 20.dp, end = 18.dp, bottom = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(kicker.uppercase(), style = MaterialTheme.typography.labelMedium, color = DtcRed)
                            Spacer(Modifier.width(10.dp))
                            Box(Modifier.width(28.dp).height(1.dp).background(MaterialTheme.colorScheme.outline))
                        }
                        Spacer(Modifier.height(9.dp))
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(title, style = MaterialTheme.typography.headlineMedium)
                            if (accent.isNotBlank()) {
                                Spacer(Modifier.width(8.dp))
                                Text(accent, style = MaterialTheme.typography.headlineMedium, color = DtcRed)
                            }
                        }
                        Spacer(Modifier.height(7.dp))
                        Text(
                            detail,
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    ) {
                        Column(
                            Modifier.widthIn(min = 126.dp, max = 158.dp).padding(horizontal = 18.dp, vertical = 15.dp),
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text("LIVE TOTAL", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(3.dp))
                            Text(metric, style = MaterialTheme.typography.headlineMedium, maxLines = 1)
                        }
                    }
                }
            } else {
                Column(Modifier.fillMaxWidth().padding(start = 21.dp, top = 18.dp, end = 16.dp, bottom = 18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(kicker.uppercase(), style = MaterialTheme.typography.labelMedium, color = DtcRed)
                        Spacer(Modifier.weight(1f))
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            shape = RoundedCornerShape(6.dp),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        ) {
                            Text(metric, Modifier.padding(horizontal = 10.dp, vertical = 5.dp), style = MaterialTheme.typography.labelLarge)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(title, style = MaterialTheme.typography.titleLarge)
                        if (accent.isNotBlank()) {
                            Spacer(Modifier.width(7.dp))
                            Text(accent, style = MaterialTheme.typography.titleLarge, color = DtcRed)
                        }
                    }
                    Spacer(Modifier.height(7.dp))
                    Text(
                        detail,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DashboardScreen(data: DashboardSnapshot, open: (AppScreen) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
        item { PageHeader("Fleet operational register", "Fleet", number(data.counts.inServiceMothers), "32%", "${number(data.counts.availableMothers)} mother locks remain available for assignment.") }
        item {
            Surface(
                Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(8.dp),
                color = when (data.healthTone) {
                    "danger" -> DtcRed.copy(alpha = .12f)
                    "warning" -> SafetyAmber.copy(alpha = .11f)
                    else -> SignalGreen.copy(alpha = .09f)
                },
                border = BorderStroke(1.dp, when (data.healthTone) { "danger" -> DtcRed.copy(alpha = .72f); "warning" -> SafetyAmber.copy(alpha = .72f); else -> SignalGreen.copy(alpha = .6f) }),
            ) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        Modifier.size(42.dp),
                        color = MaterialTheme.colorScheme.surface.copy(alpha = .72f),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                if (data.healthTone == "ok") Icons.Outlined.Shield else Icons.Outlined.Warning,
                                null,
                                Modifier.size(22.dp),
                                tint = if (data.healthTone == "ok") SignalGreen else if (data.healthTone == "warning") SafetyAmber else DtcRed,
                            )
                        }
                    }
                    Column(Modifier.padding(start = 13.dp).weight(1f)) {
                        Text(data.healthTitle, style = MaterialTheme.typography.titleMedium)
                        Text(data.healthDetail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
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
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    metrics.chunked(columns).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            row.forEach { item -> Metric(item.label, item.value, item.icon, item.accent, Modifier.weight(1f)) }
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
        item {
            Panel("Quick operations") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(AppScreen.Lookup, AppScreen.Register, AppScreen.Install, AppScreen.Review).forEach { screen ->
                        Surface(
                            Modifier.weight(1f).height(78.dp).clickable { open(screen) },
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            shape = RoundedCornerShape(8.dp),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                Icon(screen.icon, null, Modifier.size(23.dp), tint = DtcRed)
                                Spacer(Modifier.height(7.dp))
                                Text(screen.label.uppercase(), style = MaterialTheme.typography.labelMedium)
                            }
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
    Surface(
        modifier.height(124.dp),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    Modifier.size(34.dp),
                    color = (accent ?: MaterialTheme.colorScheme.onSurfaceVariant).copy(alpha = .12f),
                    shape = RoundedCornerShape(7.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(icon, null, tint = accent ?: MaterialTheme.colorScheme.onSurface, modifier = Modifier.size(19.dp))
                    }
                }
                Spacer(Modifier.weight(1f))
                Box(Modifier.size(6.dp).background(accent ?: MaterialTheme.colorScheme.outline, CircleShape))
            }
            Text(number(value), style = MaterialTheme.typography.headlineMedium)
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    feed.take(8).forEachIndexed { index, item ->
        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.padding(top = 6.dp).size(8.dp).background(if (index == 0) DtcRed else MaterialTheme.colorScheme.outline, CircleShape))
            Column(Modifier.padding(start = 12.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(item.title.replace('_', ' '), style = MaterialTheme.typography.titleMedium)
                Text(item.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (index < feed.take(8).lastIndex) Divider(color = MaterialTheme.colorScheme.outlineVariant)
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
    var scanError by remember { mutableStateOf<String?>(null) }
    var ownershipFilter by remember { mutableStateOf("all") }
    var registryAscending by remember { mutableStateOf(true) }
    var expandedRegistry by remember { mutableStateOf(setOf<String>()) }

    val effectiveRegistryQuery = remember(query, ownershipFilter) {
        listOf(query.trim(), ownershipFilter.takeUnless { it == "all" }.orEmpty()).filter(String::isNotBlank).joinToString(" ")
    }
    LaunchedEffect(effectiveRegistryQuery) { delay(350); model.loadRegistry(effectiveRegistryQuery, 0) }
    val duplicateSerials = duplicateLockSerials(mother, subs)
    val visibleRegistry = remember(state.registry, ownershipFilter, registryAscending) {
        state.registry
            .filter { ownershipFilter == "all" || it.ownership == ownershipFilter }
            .let { items -> if (registryAscending) items.sortedBy { it.mother } else items.sortedByDescending { it.mother } }
    }

    fun submit(entry: RegistrationSessionRow) {
        session = listOf(entry) + session.filterNot { it.id == entry.id }
        model.register(entry.mother, entry.subs, entry.sim, entry.config) {
            session = session.map { if (it.id == entry.id) it.copy(status = "COMPLETED") else it }
            mother = ""; subs = listOf("", "", ""); sim = ""
        }
    }

    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
        item { PageHeader("Inventory intake", "Register", "Kit", number(state.registryTotal), "The same registration checks, session retry, ownership controls and archive used on the web app.") }
        item {
            WorkspaceModeSwitch(
                primaryLabel = "Registration",
                primaryIcon = Icons.Outlined.AddBox,
                secondaryLabel = "Registered kits",
                secondaryIcon = Icons.Outlined.ListAlt,
                secondaryCount = state.registryTotal,
                primarySelected = formOpen,
                selectPrimary = { formOpen = true; archiveOpen = false },
                selectSecondary = { archiveOpen = true; formOpen = false },
            )
        }
        if (formOpen) item {
            Panel("New kit") {
                scanError?.let { StatusStrip(it, true) { scanError = null } }
                ScanField("Mother lock", mother, { mother = it }) { scanTarget = 0 }
                subs.forEachIndexed { index, value -> ScanField("Sub-lock ${listOf("B", "C", "D")[index]}", value, { updated -> subs = subs.toMutableList().also { it[index] = updated } }) { scanTarget = index + 1 } }
                if (duplicateSerials.isNotEmpty()) {
                    StatusStrip("Each lock must be unique. Repeated serial: ${duplicateSerials.first()}", true)
                }
                OutlinedTextField(sim, { sim = it }, Modifier.fillMaxWidth(), label = { Text("SIM number") }, singleLine = true)
                Text("CONFIGURATION CHECKS", style = MaterialTheme.typography.labelMedium)
                listOf("ipConfigured" to "IP configured", "apnConfigured" to "APN configured", "apnAuthSet" to "APN authentication", "btWriteDone" to "Bluetooth write").forEach { (key, label) ->
                    ChoiceLine(label, config[key] ?: "yes", listOf("yes" to "Yes", "no" to "No")) { config = config + (key to it) }
                }
                Button(
                    onClick = { submit(RegistrationSessionRow(System.nanoTime(), mother, subs, sim, config, "PENDING")) },
                    enabled = !state.working && mother.isNotBlank() && subs.all(String::isNotBlank) && duplicateSerials.isEmpty() && sim.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(7.dp),
                ) { Text("REGISTER KIT") }
            }
        }
        if (formOpen) item {
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
        if (archiveOpen) item {
            Panel("Registered kits / ${number(state.registryTotal)}") {
                SearchField(query, { query = it }, "Search serial, SIM or installer")
                RegistryArchiveControls(ownershipFilter, { ownershipFilter = it }, registryAscending) { registryAscending = !registryAscending }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { selected = visibleRegistry.map { it.id }.toSet() }, shape = RoundedCornerShape(7.dp)) { Text("SELECT VISIBLE") }
                    OutlinedButton(onClick = { selected = emptySet() }, enabled = selected.isNotEmpty(), shape = RoundedCornerShape(7.dp)) { Text("CLEAR") }
                }
                if (selected.isNotEmpty()) {
                    OutlinedTextField(releaseNote, { releaseNote = it }, Modifier.fillMaxWidth(), label = { Text("Company, handover reference or reason") }, minLines = 2)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { model.setRegistryOwnership(selected.toList(), "released_external", releaseNote, effectiveRegistryQuery); selected = emptySet(); releaseNote = "" }, shape = RoundedCornerShape(7.dp), colors = ButtonDefaults.buttonColors(containerColor = DtcRed)) { Text("RELEASE ${selected.size}") }
                        OutlinedButton(onClick = { model.setRegistryOwnership(selected.toList(), "owned", releaseNote, effectiveRegistryQuery); selected = emptySet(); releaseNote = "" }, shape = RoundedCornerShape(7.dp)) { Text("RESTORE ${selected.size}") }
                    }
                }
                if (visibleRegistry.isEmpty()) EmptyState("No kits match these filters.")
                visibleRegistry.forEach { item ->
                    key(item.id) {
                    Surface(
                        Modifier.fillMaxWidth().clickable { selected = if (item.id in selected) selected - item.id else selected + item.id },
                        shape = RoundedCornerShape(8.dp),
                        color = if (item.id in selected) DtcRed.copy(alpha = .08f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .34f),
                        border = BorderStroke(1.dp, if (item.id in selected) DtcRed.copy(alpha = .7f) else MaterialTheme.colorScheme.outline),
                    ) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
                            Icon(
                                if (item.id in selected) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
                                if (item.id in selected) "Selected" else "Not selected",
                                Modifier.padding(top = 2.dp).size(22.dp),
                                tint = if (item.id in selected) DtcRed else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Column(Modifier.padding(start = 10.dp).weight(1f)) {
                                ArchiveItemHeader(
                                    item.mother,
                                    item.ownership.replace('_', ' '),
                                    if (item.ownership == "owned") SignalGreen else DtcRed,
                                )
                                item.subs.forEachIndexed { index, serial -> Text("Sub-lock ${listOf("B", "C", "D")[index]}  $serial") }
                                Text("SIM ${item.sim} / ${item.actor}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                item.ownershipNotes?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                TextButton(onClick = {
                                    expandedRegistry = if (item.id in expandedRegistry) expandedRegistry - item.id else expandedRegistry + item.id
                                }) {
                                    Text(if (item.id in expandedRegistry) "LESS DETAILS" else "MORE DETAILS")
                                }
                                if (item.id in expandedRegistry) {
                                    Divider(color = MaterialTheme.colorScheme.outlineVariant)
                                    ValueLine("Registered", formatInstallationTimestamp(item.loggedDate))
                                    ValueLine("Source", item.source)
                                    ValueLine("Record reference", item.id)
                                }
                            }
                        }
                    }
                    }
                }
                ArchivePager(
                    page = state.registryPage,
                    pages = maxOf(1, (state.registryTotal + 7) / 8),
                    previousEnabled = state.registryPage > 0,
                    nextEnabled = (state.registryPage + 1) * 8 < state.registryTotal,
                    previous = { model.loadRegistry(effectiveRegistryQuery, state.registryPage - 1) },
                    next = { model.loadRegistry(effectiveRegistryQuery, state.registryPage + 1) },
                )
            }
        }
    }
    scanTarget?.let { target ->
        val label = if (target == 0) "mother lock" else "sub-lock ${listOf("B", "C", "D")[target - 1]}"
        key(target) {
            ScannerDialog(
                label,
                onScanned = { value ->
                    val existing = buildList {
                        if (target != 0) add(mother)
                        subs.forEachIndexed { index, serial -> if (target != index + 1) add(serial) }
                    }.filter(String::isNotBlank)
                    if (existing.any { it.equals(value, ignoreCase = true) }) {
                        scanError = "$value is already used in this kit."
                        scanTarget = null
                    } else {
                        scanError = null
                        if (target == 0) mother = value else subs = subs.toMutableList().also { it[target - 1] = value }
                        scanTarget = if (target < 3) target + 1 else null
                    }
                },
                onDismiss = { scanTarget = null },
            )
        }
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
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
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
                    OutlinedButton(onClick = { showForm = !showForm }, Modifier.fillMaxWidth(), shape = RoundedCornerShape(7.dp)) { Icon(if (showForm) Icons.Outlined.Close else Icons.Outlined.AddBox, null); Spacer(Modifier.width(8.dp)); Text(if (showForm) "COLLAPSE REGISTRATION FORM" else "NEW REGISTRATION") }
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
        modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(7.dp),
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
    var truck by remember(state.workflowTruck) { mutableStateOf(state.workflowTruck) }
    var company by remember { mutableStateOf("") }
    var mother by remember { mutableStateOf("") }
    var subs by remember { mutableStateOf(listOf("", "", "")) }
    var mode by remember { mutableStateOf("changed") }
    var loadedTruck by remember { mutableStateOf("") }
    var checklist by remember { mutableStateOf(mapOf<String, String>()) }
    var query by remember { mutableStateOf("") }
    var archiveOpen by remember { mutableStateOf(false) }
    var workbenchOpen by remember { mutableStateOf(true) }
    var scanTarget by remember { mutableStateOf<Int?>(null) }
    var scanError by remember { mutableStateOf<String?>(null) }
    var shareReady by remember { mutableStateOf(false) }
    var historyFilter by remember { mutableStateOf("all") }
    var historyNewestFirst by remember { mutableStateOf(true) }
    var expandedInstallations by remember { mutableStateOf(setOf<String>()) }
    val listState = rememberLazyListState()

    val effectiveHistoryQuery = remember(query, historyFilter) {
        val statusTerm = when (historyFilter) {
            "successful" -> "successful"
            "issues" -> "completed_with_issues"
            "failed" -> "failed"
            else -> ""
        }
        listOf(query.trim(), statusTerm).filter(String::isNotBlank).joinToString(" ")
    }
    LaunchedEffect(effectiveHistoryQuery) { delay(350); model.loadInstallations(effectiveHistoryQuery, 0) }
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
    LaunchedEffect(shareReady) {
        if (shareReady) {
            workbenchOpen = true
            archiveOpen = false
            delay(120)
            listState.animateScrollToItem(4)
        }
    }
    val message = remember(truck, company, mother, subs) { installMessage(truck, company, mother, subs) }
    val requiredComplete = listOf("configConfirmed", "deviceResponsive", "sublocksResponsive", "overallStatus").all { !checklist[it].isNullOrBlank() }
    val kitComplete = mother.isNotBlank() && subs.all(String::isNotBlank)
    val duplicateSerials = duplicateLockSerials(mother, subs)
    val installStep = when {
        loadedTruck.isBlank() -> 0
        company.isBlank() || !kitComplete || duplicateSerials.isNotEmpty() -> 1
        !requiredComplete -> 2
        else -> 3
    }
    val visibleInstallations = remember(state.installations, historyFilter, historyNewestFirst) {
        state.installations
            .filter { item ->
                when (historyFilter) {
                    "successful" -> item.status == "successful"
                    "issues" -> item.status == "completed_with_issues"
                    "failed" -> item.status == "failed"
                    else -> true
                }
            }
            .let { items -> if (historyNewestFirst) items.sortedByDescending { it.loggedDate } else items.sortedBy { it.loggedDate } }
    }

    LazyColumn(Modifier.fillMaxSize(), state = listState, verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
        item { PageHeader("Truck and kit assignment", "Install", "Truck", if (loadedTruck.isBlank()) "00" else "01", "Load the truck first, confirm the serving company, reuse the same kit or scan a changed kit, then complete the re-check.") }
        item {
            WorkspaceModeSwitch(
                primaryLabel = "Installation",
                primaryIcon = Icons.Outlined.Build,
                secondaryLabel = "History",
                secondaryIcon = Icons.Outlined.ListAlt,
                secondaryCount = state.installationTotal,
                primarySelected = workbenchOpen,
                selectPrimary = { workbenchOpen = true; archiveOpen = false },
                selectSecondary = { archiveOpen = true; workbenchOpen = false },
            )
        }
        if (workbenchOpen) item {
            InstallationProgress(installStep)
        }
        if (workbenchOpen) {
        item {
            Panel("Truck assignment") {
                OutlinedTextField(truck, { truck = it.uppercase(); loadedTruck = "" }, Modifier.fillMaxWidth(), label = { Text("Truck plate") }, singleLine = true)
                Button(onClick = { model.lookup(truck) }, enabled = truck.isNotBlank() && !state.working, modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(7.dp)) { Text("LOAD TRUCK KIT") }
                if (loadedTruck.isBlank()) Text("Load the truck before submitting this installation.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else {
                    ValueLine("Truck", loadedTruck)
                    ValueLine("Current mother", state.lookup?.mother ?: "Not assigned")
                    ValueLine("Current kit", state.lookup?.kitStatus?.replace('_', ' ') ?: "Not confirmed")
                }
                Text("SERVING COMPANY", style = MaterialTheme.typography.labelMedium)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("mrs" to "MRS", "dangote" to "Dangote").forEach { (value, label) -> SelectionChip(company == value, { company = value }, label) }
                }
                if (loadedTruck.isNotBlank() && state.lookup?.mother != null) {
                    Text("INSTALL MODE", style = MaterialTheme.typography.labelMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SelectionChip(mode == "same_kit", { mode = "same_kit"; mother = state.lookup?.mother.orEmpty(); subs = state.lookup?.subs?.map { it.second.orEmpty() } ?: subs }, "Same kit")
                        SelectionChip(mode == "changed", { mode = "changed"; mother = ""; subs = listOf("", "", "") }, "Kit changed")
                    }
                }
                if (mode == "same_kit") {
                    ValueLine("Mother lock", mother)
                    subs.forEachIndexed { index, serial -> ValueLine("Sub-lock ${listOf("B", "C", "D")[index]}", serial) }
                } else {
                    scanError?.let { StatusStrip(it, true) { scanError = null } }
                    ScanField("Mother lock", mother, { mother = it }) { scanTarget = 0 }
                    subs.forEachIndexed { index, value -> ScanField("Sub-lock ${listOf("B", "C", "D")[index]}", value, { updated -> subs = subs.toMutableList().also { it[index] = updated } }) { scanTarget = index + 1 } }
                    if (duplicateSerials.isNotEmpty()) {
                        StatusStrip("Each lock must be unique. Repeated serial: ${duplicateSerials.first()}", true)
                    }
                }
            }
        }
        item {
            Panel("Config re-check") {
                ChoiceLine("Device responsive", checklist["deviceResponsive"].orEmpty(), listOf("yes" to "Yes", "no" to "No")) { checklist = checklist + ("deviceResponsive" to it) }
                ChoiceLine("Sub-locks responsive", checklist["sublocksResponsive"].orEmpty(), listOf("yes" to "Yes", "no" to "No")) { checklist = checklist + ("sublocksResponsive" to it) }
                ChoiceLine("Configuration confirmed", checklist["configConfirmed"].orEmpty(), listOf("yes" to "Yes", "changed" to "Changed", "no" to "No")) { checklist = checklist + ("configConfirmed" to it) }
                ChoiceLine("Overall status", checklist["overallStatus"].orEmpty(), listOf("successful" to "Successful", "completed_with_issues" to "With issues", "failed" to "Failed")) { checklist = checklist + ("overallStatus" to it) }
                OutlinedTextField(checklist["configNotes"].orEmpty(), { checklist = checklist + ("configNotes" to it) }, Modifier.fillMaxWidth(), label = { Text("Configuration notes") }, minLines = 2)
                OutlinedTextField(checklist["issuesNotes"].orEmpty(), { checklist = checklist + ("issuesNotes" to it) }, Modifier.fillMaxWidth(), label = { Text("Issues and follow-up notes") }, minLines = 2)
                Button(
                    onClick = { model.installBySerials(truck, company, mother, subs, mode, checklist) { shareReady = true } },
                    enabled = !state.working && loadedTruck.isNotBlank() && company.isNotBlank() && kitComplete && duplicateSerials.isEmpty() && requiredComplete,
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(7.dp),
                ) { Text("RECORD INSTALLATION") }
                if (!requiredComplete) Text("Device, sub-lock, configuration and overall status checks are required.", color = SafetyAmber)
            }
        }
        if (shareReady) item {
            Panel("Send installation report") {
                Text(message, style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { openWhatsApp(context, message); shareReady = false }, shape = RoundedCornerShape(7.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF12351F), contentColor = SignalGreen)) { Text("SEND TO WHATSAPP") }
                    OutlinedButton(onClick = { shareReady = false }, shape = RoundedCornerShape(7.dp)) { Text("DISMISS") }
                }
            }
        }
        }
        if (archiveOpen) item {
            Panel("Installation history / ${number(state.installationTotal)}") {
                SearchField(query, { query = it }, "Search truck, lock, status or installer")
                InstallationArchiveControls(historyFilter, { historyFilter = it }, historyNewestFirst) { historyNewestFirst = !historyNewestFirst }
                if (visibleInstallations.isEmpty()) EmptyState("No installation events match these filters.")
                visibleInstallations.forEach { item ->
                    key(item.id.ifBlank { "${item.truck}-${item.loggedDate}" }) {
                        val itemKey = item.id.ifBlank { "${item.truck}-${item.loggedDate}" }
                        Surface(
                            Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = .34f),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        ) {
                            Column(Modifier.padding(13.dp)) {
                                ArchiveItemHeader(item.truck, item.status.replace('_', ' '), if (item.status == "failed") DtcRed else SignalGreen)
                                Text("Mother  ${item.mother}")
                                item.subs.forEachIndexed { index, serial -> Text("Sub-lock ${listOf("B", "C", "D")[index]}  $serial") }
                                InstallationMetadata(item.loggedDate, item.actor)
                                TextButton(onClick = {
                                    expandedInstallations = if (itemKey in expandedInstallations) expandedInstallations - itemKey else expandedInstallations + itemKey
                                }) {
                                    Text(if (itemKey in expandedInstallations) "LESS DETAILS" else "MORE DETAILS")
                                }
                                if (itemKey in expandedInstallations) {
                                    Divider(color = MaterialTheme.colorScheme.outlineVariant)
                                    ValueLine("Event reference", item.id.ifBlank { "Imported history" })
                                    ValueLine("Recorded status", item.status.replace('_', ' '))
                                }
                            }
                        }
                    }
                }
                ArchivePager(
                    page = state.installationPage,
                    pages = maxOf(1, (state.installationTotal + 4) / 5),
                    previousEnabled = state.installationPage > 0,
                    nextEnabled = (state.installationPage + 1) * 5 < state.installationTotal,
                    previous = { model.loadInstallations(effectiveHistoryQuery, state.installationPage - 1) },
                    next = { model.loadInstallations(effectiveHistoryQuery, state.installationPage + 1) },
                )
            }
        }
    }
    scanTarget?.let { target ->
        val label = if (target == 0) "mother lock" else "sub-lock ${listOf("B", "C", "D")[target - 1]}"
        key(target) {
            ScannerDialog(
                label,
                onScanned = { value ->
                    val existing = buildList {
                        if (target != 0) add(mother)
                        subs.forEachIndexed { index, serial -> if (target != index + 1) add(serial) }
                    }.filter(String::isNotBlank)
                    if (existing.any { it.equals(value, ignoreCase = true) }) {
                        scanError = "$value is already used in this kit."
                        scanTarget = null
                    } else {
                        scanError = null
                        if (target == 0) mother = value else subs = subs.toMutableList().also { it[target - 1] = value }
                        scanTarget = if (target < 3) target + 1 else null
                    }
                },
                onDismiss = { scanTarget = null },
            )
        }
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

    LazyColumn(Modifier.fillMaxSize(), state = listState, verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
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
                    Button(onClick = { openWhatsApp(context, message); shareReady = false }, shape = RoundedCornerShape(7.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF12351F), contentColor = SignalGreen)) { Text("SEND TO WHATSAPP") }
                    OutlinedButton(onClick = { shareReady = false }, shape = RoundedCornerShape(7.dp)) { Text("DISMISS") }
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
        listOf("mrs" to "MRS", "dangote" to "Dangote").forEach { (value, label) -> SelectionChip(company == value, { setCompany(value) }, label) }
    }
    ScanField("Mother lock", mother, setMother) { scan(0) }
    subs.forEachIndexed { index, value -> ScanField("Sub-lock ${listOf("B", "C", "D")[index]}", value, { setSub(index, it) }) { scan(index + 1) } }
    Text("COMPLETION STATUS", style = MaterialTheme.typography.labelMedium)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("successful" to "Successful", "completed_with_issues" to "With issues", "failed" to "Failed").forEach { (value, label) -> SelectionChip(status == value, { setStatus(value) }, label) }
    }
    Button(
        onClick = submit, enabled = !working && truck.isNotBlank() && mother.isNotBlank() && subs.all(String::isNotBlank),
        modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(7.dp),
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
                InstallationMetadata(item.loggedDate, item.actor)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RepairsScreen(state: NativeUiState, model: DtcViewModel) {
    var faultOpen by remember(state.workflowTruck, state.workflowDevice) {
        mutableStateOf(state.workflowTruck.isNotBlank() || state.workflowDevice.isNotBlank())
    }
    var truck by remember(state.workflowTruck) { mutableStateOf(state.workflowTruck) }
    var device by remember(state.workflowDevice) { mutableStateOf(state.workflowDevice) }
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

    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
        item { PageHeader("Fault and lifecycle control", "Repair", "Operations", number(state.repairPool.size), "Report field faults and disposition the same repair pool used by the web app.") }
        item {
            OutlinedButton(onClick = { faultOpen = !faultOpen }, Modifier.fillMaxWidth(), shape = RoundedCornerShape(7.dp)) {
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
                    listOf("mother" to "Mother", "B" to "B", "C" to "C", "D" to "D").forEach { (value, label) -> SelectionChip(value in affected, { affected = if (value in affected) affected - value else affected + value }, label) }
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
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(7.dp),
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
                                Button(onClick = { model.triage(item.deviceId, "revived") }, enabled = !state.working, shape = RoundedCornerShape(7.dp), colors = ButtonDefaults.buttonColors(containerColor = SignalGreen)) { Text("REVIVE") }
                                OutlinedButton(onClick = { model.triage(item.deviceId, "dead") }, enabled = !state.working, shape = RoundedCornerShape(7.dp), border = BorderStroke(1.dp, DtcRed), colors = ButtonDefaults.outlinedButtonColors(contentColor = DtcRed)) { Text("DECLARE DEAD") }
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
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
        item { PageHeader("Asset intelligence", "Asset", "Lookup", "01", "Search by truck plate or mother-lock serial.") }
        item {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(query, { query = it }, Modifier.weight(1f), label = { Text("Truck or mother serial") }, singleLine = true)
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { lookup(query) }, enabled = query.isNotBlank(), modifier = Modifier.height(56.dp), shape = RoundedCornerShape(7.dp)) { Icon(Icons.Outlined.Search, "Search") }
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
    var verifyOpen by remember(result?.targetId) { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
        item { PageHeader("Asset intelligence", "Asset", "Lookup", if (result?.targetKind == "unknown" || result == null) "00" else "01", "Search a truck plate or mother serial and inspect the complete operational cockpit.") }
        item {
            Panel("Lookup target") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(query, { query = it.uppercase() }, Modifier.weight(1f), label = { Text("Truck or mother serial") }, singleLine = true)
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { recent = listOf(query) + recent.filterNot { it == query }.take(4); model.lookup(query) }, enabled = query.isNotBlank(), modifier = Modifier.height(56.dp), shape = RoundedCornerShape(7.dp)) { Icon(Icons.Outlined.Search, "Search") }
                }
                if (recent.isNotEmpty()) {
                    Text("RECENT LOOKUPS", style = MaterialTheme.typography.labelMedium)
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        recent.forEach { value -> SelectionChip(false, { query = value; model.lookup(value) }, value) }
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
                    Text("Choose the next operation for ${result.label}. The truck and current kit will stay loaded.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OperationAction(
                            icon = Icons.Outlined.Shield,
                            title = "Verify physical kit",
                            detail = "Compare the locks on the truck with the current registry.",
                            primary = true,
                            onClick = { verifyOpen = true },
                        )
                        OperationAction(
                            icon = Icons.Outlined.Build,
                            title = "Install or replace kit",
                            detail = "Open Install with this truck and its assignment preloaded.",
                            onClick = model::openInstallFromLookup,
                        )
                        OperationAction(
                            icon = Icons.Outlined.HomeRepairService,
                            title = "Report fault",
                            detail = "Open Repairs with this asset already selected.",
                            onClick = model::openRepairsFromLookup,
                        )
                    }
                    if (state.dashboard?.user?.role == "supervisor" && result.targetKind == "truck" && result.targetId != null) {
                        Divider()
                        Text("SUPERVISOR COMPANY CORRECTION", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                        ChoiceLine("Serving company", correctionCompany, listOf("mrs" to "MRS", "dangote" to "Dangote")) { correctionCompany = it }
                        OutlinedTextField(correctionNotes, { correctionNotes = it }, Modifier.fillMaxWidth(), label = { Text("Correction notes") }, minLines = 2)
                        Button(
                            onClick = { model.setTruckCompany(result.targetId, correctionCompany, correctionNotes, result.label) },
                            enabled = !state.working && correctionCompany.isNotBlank(),
                            shape = RoundedCornerShape(7.dp),
                        ) { Text("UPDATE SERVING COMPANY") }
                    }
                }
            }
            if (result.reviewItems.isNotEmpty()) item {
                Panel("Reviews for ${result.label}") {
                    Text(
                        "Only open reviews linked to this searched asset are shown here.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    result.reviewItems.forEach { review ->
                        Column(Modifier.fillMaxWidth().border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(review.title.ifBlank { review.kind.replace('_', ' ') }, color = DtcRed, style = MaterialTheme.typography.titleMedium)
                            Text(review.summary.ifBlank { "This asset has an open review." }, style = MaterialTheme.typography.bodyMedium)
                            review.details.take(4).forEach { detail -> ValueLine(detail.label, detail.value) }
                            if (state.dashboard?.user?.role == "supervisor") {
                                OutlinedButton(onClick = { model.open(AppScreen.Review) }, Modifier.fillMaxWidth(), shape = RoundedCornerShape(7.dp)) { Text("OPEN REVIEW") }
                            }
                        }
                    }
                }
            }
            item { FeedPanel("Audit trail", result.audit) }
        }
    }
    if (verifyOpen && result != null && result.targetKind != "unknown") {
        VerifyKitDialog(
            result = result,
            working = state.working,
            onDismiss = { verifyOpen = false },
            onSubmit = { truck, mother, subs, motherSource, subSources ->
                model.verifyLookupKit(truck, mother, subs, motherSource, subSources) { verifyOpen = false }
            },
        )
    }
}

@Composable
private fun VerifyKitDialog(
    result: LookupSnapshot,
    working: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (String?, String, List<String>, String, List<String>) -> Unit,
) {
    var mother by remember(result.targetId) { mutableStateOf(result.mother.orEmpty()) }
    var subs by remember(result.targetId) {
        mutableStateOf(List(3) { index -> result.subs.getOrNull(index)?.second.orEmpty() })
    }
    var motherSource by remember(result.targetId) { mutableStateOf("manual") }
    var subSources by remember(result.targetId) { mutableStateOf(List(3) { "manual" }) }
    var scanTarget by remember { mutableStateOf<Int?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("VERIFY PHYSICAL KIT") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "Compare each value with the locks on ${result.label}. Scan any lock whose value has changed.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                ScanField("Mother lock", mother, {
                    mother = it.uppercase()
                    motherSource = "manual"
                }) { scanTarget = 0 }
                subs.forEachIndexed { index, value ->
                    val slot = listOf("B", "C", "D")[index]
                    ScanField("Sub-lock $slot", value, { updated ->
                        subs = subs.toMutableList().also { it[index] = updated.uppercase() }
                        subSources = subSources.toMutableList().also { it[index] = "manual" }
                    }) { scanTarget = index + 1 }
                }
                Text(
                    "Submitting records a physical verification. Any mismatch remains visible for supervisor review.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = SafetyAmber,
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSubmit(
                        result.label.takeIf { result.targetKind == "truck" },
                        mother,
                        subs,
                        motherSource,
                        subSources,
                    )
                },
                enabled = mother.isNotBlank() && !working,
                shape = RoundedCornerShape(7.dp),
            ) {
                if (working) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("RECORD VERIFICATION")
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("CANCEL") } },
    )

    scanTarget?.let { target ->
        ScannerDialog(
            label = if (target == 0) "Mother lock" else "Sub-lock ${listOf("B", "C", "D")[target - 1]}",
            onScanned = { value ->
                if (target == 0) {
                    mother = value.uppercase()
                    motherSource = "qr_scan"
                } else {
                    subs = subs.toMutableList().also { it[target - 1] = value.uppercase() }
                    subSources = subSources.toMutableList().also { it[target - 1] = "qr_scan" }
                }
                scanTarget = null
            },
            onDismiss = { scanTarget = null },
        )
    }
}

@Composable
private fun ReviewScreen(state: NativeUiState, model: DtcViewModel) {
    val canDecide = state.dashboard?.user?.role == "supervisor"
    var selected by remember { mutableStateOf<ReviewItem?>(null) }
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
        item { PageHeader("Exception control", "Open", "Reviews", state.reviews.size.toString().padStart(2, '0'), if (canDecide) "Inspect the complete evidence before resolving or dismissing." else "Review evidence is visible; supervisor authority is required for decisions.") }
        if (state.reviews.isEmpty()) item { EmptyState("No reviews need attention.") }
        items(state.reviews, key = { it.id }) { review ->
            Surface(
                Modifier.fillMaxWidth().clickable { selected = review },
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Surface(Modifier.size(38.dp), color = DtcRed.copy(alpha = .14f), shape = RoundedCornerShape(6.dp)) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.Warning, null, Modifier.size(21.dp), tint = DtcRed)
                            }
                        }
                        Column(Modifier.padding(start = 11.dp).weight(1f)) {
                            Text("OPEN REVIEW", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                            Text(review.kind.replace('_', ' ').uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(4.dp)) {
                            Text(
                                "${review.details.size} EVIDENCE",
                                Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                                style = MaterialTheme.typography.labelMedium,
                            )
                        }
                    }
                    Text(
                        review.title.ifBlank { review.kind.replace('_', ' ') },
                        style = MaterialTheme.typography.titleLarge,
                    )
                    Text(
                        review.summary.ifBlank { "This record needs a supervisor to check its evidence." },
                        maxLines = 4,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("OPEN DETAILS", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
                        Icon(Icons.Outlined.ChevronRight, null, Modifier.size(20.dp), tint = DtcRed)
                    }
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
        title = { Text(review.title.ifBlank { review.kind.replace('_', ' ') }) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("WHAT HAPPENED", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                Text(
                    review.summary.ifBlank { "This record needs a supervisor to check its evidence." },
                    style = MaterialTheme.typography.bodyLarge,
                )
                if (review.details.isNotEmpty()) {
                    Divider()
                    Text("EVIDENCE", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                    review.details.forEach { detail ->
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                detail.label.uppercase(),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(detail.value, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                Divider()
                Text("WHAT TO DO", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                Text(
                    review.recommendedAction.ifBlank { "Confirm the evidence, then mark the review appropriately." },
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (canDecide) {
                    Text(
                        "These decisions close the review only. They do not change the registry or installation record.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = SafetyAmber,
                    )
                    OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("Decision notes") }, minLines = 3)
                } else {
                    Text("Supervisor authority is required to close this review.", color = SafetyAmber)
                }
            }
        },
        confirmButton = {
            if (canDecide) {
                Button(
                    onClick = { action("resolve", notes) },
                    colors = ButtonDefaults.buttonColors(containerColor = SignalGreen),
                    shape = RoundedCornerShape(6.dp),
                ) { Text("RESOLVE REVIEW") }
            } else {
                TextButton(onClick = onDismiss) { Text("CLOSE") }
            }
        },
        dismissButton = {
            if (canDecide) {
                Column(horizontalAlignment = Alignment.End) {
                    TextButton(onClick = { action("dismiss", notes) }) { Text("DISMISS REVIEW") }
                    TextButton(onClick = onDismiss) { Text("CANCEL") }
                }
            }
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SettingsScreen(state: NativeUiState, model: DtcViewModel) {
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
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
            SelectionChip(state.themeMode == mode, { model.setTheme(mode) }, mode.name, icon)
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
    var resetUserId by remember { mutableStateOf<String?>(null) }
    var resetUserName by remember { mutableStateOf("") }
    var resetPassword by remember { mutableStateOf("") }
    var resetPasswordVisible by remember { mutableStateOf(false) }
    val settings = state.settings
    LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = PageEndPadding)) {
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
                            modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(7.dp),
                        ) { Text("ADD USER") }
                    }
                    settings?.users?.forEach { user ->
                        Surface(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(user.displayName, style = MaterialTheme.typography.titleMedium)
                                        Text("${user.username} / ${user.role.uppercase()}${user.company?.let { " / ${it.uppercase()}" } ?: ""}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    Text(if (user.isActive) "ACTIVE" else "INACTIVE", color = if (user.isActive) SignalGreen else DtcRed, style = MaterialTheme.typography.labelMedium)
                                    IconButton(
                                        onClick = {
                                            if (resetUserId == user.id) {
                                                resetUserId = null
                                                resetUserName = ""
                                                resetPassword = ""
                                            } else {
                                                resetUserId = user.id
                                                resetUserName = user.displayName
                                                resetPassword = ""
                                            }
                                        },
                                        enabled = !state.working && user.isActive,
                                    ) {
                                        Icon(Icons.Outlined.Lock, "Reset password for ${user.displayName}")
                                    }
                                    OutlinedButton(
                                        onClick = { model.setUserActive(user.id, !user.isActive) },
                                        enabled = !state.working && user.id != settings.currentUserId,
                                        shape = RoundedCornerShape(7.dp),
                                    ) { Text(if (user.isActive) "DEACTIVATE" else "ACTIVATE") }
                                }
                                if (resetUserId == user.id) {
                                    Divider()
                                    Text("RESET PASSWORD / ${resetUserName.uppercase()}", style = MaterialTheme.typography.labelMedium, color = DtcRed)
                                    OutlinedTextField(
                                        resetPassword,
                                        { resetPassword = it },
                                        Modifier.fillMaxWidth(),
                                        label = { Text("Temporary password (12+ characters)") },
                                        singleLine = true,
                                        visualTransformation = if (resetPasswordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                                        trailingIcon = {
                                            IconButton(onClick = { resetPasswordVisible = !resetPasswordVisible }) {
                                                Icon(if (resetPasswordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, "Toggle password")
                                            }
                                        },
                                    )
                                    Text(
                                        "Resetting revokes this user's existing sessions.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = SafetyAmber,
                                    )
                                    Button(
                                        onClick = {
                                            model.resetUserPassword(user.id, resetPassword) {
                                                resetUserId = null
                                                resetUserName = ""
                                                resetPassword = ""
                                            }
                                        },
                                        enabled = !state.working && resetPassword.length >= 12,
                                        modifier = Modifier.fillMaxWidth(),
                                        shape = RoundedCornerShape(7.dp),
                                        colors = ButtonDefaults.buttonColors(containerColor = DtcRed),
                                    ) { Text("RESET PASSWORD") }
                                }
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

@Composable
private fun InstallationProgress(currentStep: Int) {
    val steps = listOf("Load truck", "Confirm kit", "Re-check", "Ready")
    Surface(
        Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp)) {
            val showLabels = maxWidth >= 560.dp
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    steps.forEachIndexed { index, label ->
                        val complete = index < currentStep
                        val active = index == currentStep
                        Column(
                            Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Surface(
                                Modifier.size(30.dp),
                                color = when {
                                    complete -> SignalGreen.copy(alpha = .16f)
                                    active -> DtcRed
                                    else -> MaterialTheme.colorScheme.surfaceVariant
                                },
                                shape = CircleShape,
                                border = BorderStroke(
                                    1.dp,
                                    when {
                                        complete -> SignalGreen
                                        active -> DtcRed
                                        else -> MaterialTheme.colorScheme.outline
                                    },
                                ),
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    if (complete) {
                                        Icon(Icons.Outlined.CheckCircle, "Completed", Modifier.size(17.dp), tint = SignalGreen)
                                    } else {
                                        Text(
                                            "${index + 1}",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = if (active) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                            if (showLabels) {
                                Text(
                                    label,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (active || complete) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                if (!showLabels) {
                    Text(
                        "STEP ${currentStep + 1} OF ${steps.size}  /  ${steps[currentStep].uppercase()}",
                        style = MaterialTheme.typography.labelMedium,
                        color = DtcRed,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun InstallationArchiveControls(
    filter: String,
    setFilter: (String) -> Unit,
    newestFirst: Boolean,
    toggleSort: () -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        listOf("all" to "All", "successful" to "Successful", "issues" to "Issues", "failed" to "Failed").forEach { (value, label) ->
            SelectionChip(filter == value, { setFilter(value) }, label)
        }
        OutlinedButton(onClick = toggleSort, shape = RoundedCornerShape(7.dp)) {
            Icon(Icons.Outlined.SwapVert, null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(if (newestFirst) "NEWEST" else "OLDEST")
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RegistryArchiveControls(
    filter: String,
    setFilter: (String) -> Unit,
    ascending: Boolean,
    toggleSort: () -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        listOf("all" to "All", "owned" to "Owned", "released_external" to "Released").forEach { (value, label) ->
            SelectionChip(filter == value, { setFilter(value) }, label)
        }
        OutlinedButton(onClick = toggleSort, shape = RoundedCornerShape(7.dp)) {
            Icon(Icons.Outlined.SwapVert, null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(if (ascending) "A-Z" else "Z-A")
        }
    }
}

@Composable
private fun OperationAction(
    icon: ImageVector,
    title: String,
    detail: String,
    primary: Boolean = false,
    onClick: () -> Unit,
) {
    val container = if (primary) DtcRed else MaterialTheme.colorScheme.surfaceVariant
    val content = if (primary) Color.White else MaterialTheme.colorScheme.onSurface
    Surface(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        color = container,
        contentColor = content,
        shape = RoundedCornerShape(7.dp),
        border = if (primary) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                Modifier.size(40.dp),
                color = if (primary) Color.White.copy(alpha = .16f) else MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(7.dp),
            ) {
                Box(contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(21.dp)) }
            }
            Column(Modifier.padding(horizontal = 12.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = content.copy(alpha = .78f))
            }
            Icon(Icons.Outlined.ChevronRight, null, Modifier.size(20.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChoiceLine(label: String, value: String, options: List<Pair<String, String>>, setValue: (String) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            options.forEach { (option, text) -> SelectionChip(value == option, { setValue(option) }, text) }
        }
    }
}

@Composable
private fun SelectionChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: String,
    leadingIcon: ImageVector? = null,
) {
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium) },
        leadingIcon = if (leadingIcon == null) null else {
            { Icon(leadingIcon, null, Modifier.size(18.dp)) }
        },
        colors = FilterChipDefaults.filterChipColors(
            containerColor = MaterialTheme.colorScheme.surface,
            labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
            iconColor = MaterialTheme.colorScheme.onSurfaceVariant,
            selectedContainerColor = DtcRed.copy(alpha = 0.22f),
            selectedLabelColor = MaterialTheme.colorScheme.onSurface,
            selectedLeadingIconColor = DtcRed,
        ),
        border = FilterChipDefaults.filterChipBorder(
            enabled = true,
            selected = selected,
            borderColor = MaterialTheme.colorScheme.outline,
            selectedBorderColor = DtcRed,
            borderWidth = 1.dp,
            selectedBorderWidth = 2.dp,
        ),
    )
}

@Composable
private fun ScanField(label: String, value: String, setValue: (String) -> Unit, scan: () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            if (maxWidth < 390.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(
                        value,
                        setValue,
                        Modifier.fillMaxWidth(),
                        placeholder = { Text("Scan or enter $label") },
                        singleLine = true,
                        trailingIcon = {
                            if (value.isNotBlank()) Icon(Icons.Outlined.CheckCircle, "$label captured", tint = SignalGreen)
                        },
                    )
                    OutlinedButton(onClick = scan, Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(7.dp)) {
                        Icon(Icons.Outlined.QrCodeScanner, "Scan $label", Modifier.size(18.dp))
                        Spacer(Modifier.width(7.dp))
                        Text("SCAN $label".uppercase())
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value,
                        setValue,
                        Modifier.weight(1f),
                        placeholder = { Text("Scan or enter $label") },
                        singleLine = true,
                        trailingIcon = {
                            if (value.isNotBlank()) Icon(Icons.Outlined.CheckCircle, "$label captured", tint = SignalGreen)
                        },
                    )
                    Button(onClick = scan, Modifier.height(56.dp), shape = RoundedCornerShape(7.dp)) {
                        Icon(Icons.Outlined.QrCodeScanner, "Scan $label", Modifier.size(18.dp))
                        Spacer(Modifier.width(7.dp))
                        Text("SCAN")
                    }
                }
            }
        }
    }
}

@Composable
private fun ArchiveItemHeader(title: String, status: String, statusColor: Color) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth < 380.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                StatusBadge(status, statusColor)
            }
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                StatusBadge(status, statusColor)
            }
        }
    }
}

@Composable
private fun StatusBadge(label: String, tone: Color) {
    Surface(
        color = tone.copy(alpha = .12f),
        shape = RoundedCornerShape(6.dp),
        border = BorderStroke(1.dp, tone.copy(alpha = .42f)),
    ) {
        Text(
            label.replace('_', ' ').uppercase(),
            Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
            color = tone,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun InstallationMetadata(loggedDate: Long, actor: String) {
    Row(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Schedule, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.padding(start = 8.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(
                formatInstallationTimestamp(loggedDate),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                "Recorded by $actor",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ArchivePager(
    page: Int,
    pages: Int,
    previousEnabled: Boolean,
    nextEnabled: Boolean,
    previous: () -> Unit,
    next: () -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        if (maxWidth < 390.dp) {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("PAGE ${page + 1} / $pages", style = MaterialTheme.typography.labelMedium)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(previous, Modifier.weight(1f), enabled = previousEnabled, shape = RoundedCornerShape(7.dp)) { Text("PREV") }
                    OutlinedButton(next, Modifier.weight(1f), enabled = nextEnabled, shape = RoundedCornerShape(7.dp)) { Text("NEXT") }
                }
            }
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(previous, enabled = previousEnabled, shape = RoundedCornerShape(7.dp)) { Text("PREV") }
                Text("PAGE ${page + 1} / $pages", style = MaterialTheme.typography.labelMedium)
                OutlinedButton(next, enabled = nextEnabled, shape = RoundedCornerShape(7.dp)) { Text("NEXT") }
            }
        }
    }
}

@Composable
private fun WorkspaceModeSwitch(
    primaryLabel: String,
    primaryIcon: ImageVector,
    secondaryLabel: String,
    secondaryIcon: ImageVector,
    secondaryCount: Int,
    primarySelected: Boolean,
    selectPrimary: () -> Unit,
    selectSecondary: () -> Unit,
) {
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.fillMaxWidth().padding(5.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            WorkspaceModeOption(
                label = primaryLabel,
                icon = primaryIcon,
                selected = primarySelected,
                onClick = selectPrimary,
                modifier = Modifier.weight(1f),
            )
            WorkspaceModeOption(
                label = if (secondaryCount > 0) "$secondaryLabel  ${number(secondaryCount)}" else secondaryLabel,
                icon = secondaryIcon,
                selected = !primarySelected,
                onClick = selectSecondary,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun WorkspaceModeOption(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(6.dp),
        color = if (selected) DtcRed.copy(alpha = 0.18f) else Color.Transparent,
        border = if (selected) BorderStroke(1.5.dp, DtcRed) else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 10.dp, vertical = 9.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, null, Modifier.size(19.dp), tint = if (selected) DtcRed else MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(7.dp))
            Text(
                label.uppercase(),
                style = MaterialTheme.typography.labelMedium,
                color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SearchField(value: String, setValue: (String) -> Unit, placeholder: String) {
    OutlinedTextField(
        value, setValue, Modifier.fillMaxWidth(), placeholder = { Text(placeholder) }, singleLine = true,
        leadingIcon = { Icon(Icons.Outlined.Search, null) }, trailingIcon = { if (value.isNotEmpty()) IconButton(onClick = { setValue("") }) { Icon(Icons.Outlined.Close, "Clear") } },
        shape = RoundedCornerShape(8.dp),
    )
}

@Composable
private fun Panel(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val compact = LocalCompactMode.current
    Surface(
        modifier.animateContentSize(),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.fillMaxWidth()) {
            Row(
                Modifier.fillMaxWidth().height(if (compact) 46.dp else 54.dp)
                    .padding(horizontal = if (compact) 12.dp else 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(7.dp).background(DtcRed, CircleShape))
                Spacer(Modifier.width(11.dp))
                Text(title, style = MaterialTheme.typography.titleMedium)
            }
            Divider(Modifier.padding(horizontal = if (compact) 12.dp else 16.dp), color = MaterialTheme.colorScheme.outlineVariant)
            Column(
                Modifier.fillMaxWidth().padding(if (compact) 12.dp else 16.dp),
                verticalArrangement = Arrangement.spacedBy(if (compact) 10.dp else 14.dp),
                content = content,
            )
        }
    }
}

@Composable
private fun ValueLine(label: String, value: String, color: Color? = null) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 44.dp)
            .border(width = 0.dp, color = Color.Transparent)
            .padding(horizontal = 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value,
            Modifier.weight(1f),
            style = MaterialTheme.typography.labelLarge,
            color = color ?: MaterialTheme.colorScheme.onSurface,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
    Divider(color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun EmptyState(message: String) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Surface(Modifier.size(48.dp), color = MaterialTheme.colorScheme.surfaceVariant, shape = CircleShape) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Inbox, null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text("Nothing to show", style = MaterialTheme.typography.titleMedium)
        Text(
            message,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
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

private fun duplicateLockSerials(mother: String, subs: List<String>): List<String> =
    (listOf(mother) + subs)
        .map(String::trim)
        .filter(String::isNotEmpty)
        .groupBy(String::uppercase)
        .filterValues { it.size > 1 }
        .values
        .map { it.first() }

private fun formatInstallationTimestamp(unixSeconds: Long): String {
    if (unixSeconds <= 0) return "Date unavailable"
    return SimpleDateFormat("d MMM yyyy, HH:mm", Locale.getDefault()).format(Date(unixSeconds * 1000))
}

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
