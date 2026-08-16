package com.directtrucking.elock.core

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.directtrucking.elock.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class NativeUser(val name: String, val role: String, val id: String = "")
data class DashboardCounts(val registeredKits: Int, val openReviews: Int, val pendingRepair: Int, val availableMothers: Int, val inServiceMothers: Int, val trucks: Int)
data class DashboardTrust(val verified: Int, val stale: Int, val unverified: Int, val total: Int)
data class FeedItem(val title: String, val detail: String, val timestamp: Long = 0)
data class DashboardSnapshot(
    val user: NativeUser,
    val healthTitle: String,
    val healthDetail: String,
    val healthTone: String,
    val counts: DashboardCounts,
    val trust: DashboardTrust,
    val registrations: List<FeedItem>,
    val reviews: List<FeedItem>,
)
data class RegistryItem(
    val id: String,
    val mother: String,
    val subs: List<String>,
    val sim: String,
    val actor: String,
    val ownership: String,
    val loggedDate: Long = 0,
    val source: String = "app",
    val ownershipNotes: String? = null,
)
data class InstallationItem(
    val truck: String,
    val mother: String,
    val subs: List<String>,
    val status: String,
    val actor: String,
    val id: String = "",
    val loggedDate: Long = 0,
    val company: String = "Not declared",
)
data class ReviewDetail(val label: String, val value: String)
data class ReviewItem(
    val id: String,
    val kind: String,
    val payload: String,
    val createdAt: Long,
    val status: String = "open",
    val title: String = "",
    val summary: String = "",
    val details: List<ReviewDetail> = emptyList(),
    val recommendedAction: String = "",
)
data class RepairItem(
    val deviceId: String,
    val serial: String,
    val deviceType: String,
    val enteredRepairAt: Long?,
    val removalReason: String?,
    val removalNotes: String?,
)
data class SettingsUser(
    val id: String,
    val username: String,
    val displayName: String,
    val role: String,
    val company: String?,
    val isActive: Boolean,
    val lastLogin: Long?,
)
data class ExportSummary(val key: String, val label: String, val rowCount: Int)
data class SettingsSnapshot(
    val organisation: String,
    val currentUserId: String,
    val currentRole: String,
    val users: List<SettingsUser>,
    val exports: List<ExportSummary>,
)
data class LookupSnapshot(
    val targetKind: String,
    val label: String,
    val company: String,
    val trust: String,
    val mother: String?,
    val subs: List<Pair<String, String?>>,
    val reviews: Int,
    val audit: List<FeedItem>,
    val targetId: String? = null,
    val companyDeclared: Boolean = false,
    val latestVerifiedAt: Long? = null,
    val weakestTier: String? = null,
    val motherId: String? = null,
    val subIds: List<Pair<String, String?>> = emptyList(),
    val kitStatus: String = "not_confirmed",
    val reviewItems: List<ReviewItem> = emptyList(),
    val pendingSyncCount: Int = 0,
)
data class NativeSyncResult(
    val pending: Int,
    val applied: Int,
    val reachedServer: Boolean,
    val submittedStatus: String? = null,
    val submittedMessage: String? = null,
    val submittedReviewId: String? = null,
) {
    val submittedApplied: Boolean
        get() = submittedStatus == "applied"
}

private data class PendingNativeMutation(
    val id: String,
    val endpoint: String,
    val payload: JSONObject,
    val clientTs: Long,
    val seq: Long,
)

class ApiException(message: String, val statusCode: Int = 0) : Exception(message)

class DtcApi(private val context: Context) {
    private val cookieJar = SecureCookieJar(context.applicationContext)
    private val client = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(35, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')
    private val appearance = context.getSharedPreferences("dtc_native_appearance", Context.MODE_PRIVATE)
    private val mutationStore = context.getSharedPreferences("dtc_native_mutations", Context.MODE_PRIVATE)

    fun appearanceMode(): String = appearance.getString("theme", "Dark") ?: "Dark"
    fun compactMode(): Boolean = appearance.getBoolean("compact", false)
    fun setAppearance(mode: String, compact: Boolean) {
        appearance.edit().putString("theme", mode).putBoolean("compact", compact).apply()
    }

    suspend fun restoreSession(): DashboardSnapshot? = try {
        bootstrap()
    } catch (error: ApiException) {
        if (error.statusCode == 401) null else throw error
    }

    suspend fun login(username: String, password: String): DashboardSnapshot = withContext(Dispatchers.IO) {
        cookieJar.clear()
        val csrf = executeJson(Request.Builder().url("$baseUrl/api/auth/csrf").get().build()).getString("csrfToken")
        val form = FormBody.Builder()
            .add("csrfToken", csrf)
            .add("username", username.trim())
            .add("password", password)
            .add("callbackUrl", "$baseUrl/")
            .add("json", "true")
            .build()
        executeJson(
            Request.Builder().url("$baseUrl/api/auth/callback/credentials")
                .header("X-Auth-Return-Redirect", "1").post(form).build(),
        )
        bootstrapBlocking()
    }

    suspend fun bootstrap(): DashboardSnapshot = withContext(Dispatchers.IO) { bootstrapBlocking() }
    fun logout() = cookieJar.clear()
    fun pendingMutationCount(): Int = readMutations().size

    suspend fun registry(query: String = "", page: Int = 0): Pair<List<RegistryItem>, Int> = withContext(Dispatchers.IO) {
        val root = get("/api/registry?page=$page&pageSize=8&q=${query.encoded()}")
        val rows = root.getJSONArray("data")
        buildList {
            for (index in 0 until rows.length()) {
                val item = rows.getJSONObject(index)
                add(
                    RegistryItem(
                        item.getString("id"), item.optString("motherSerial", "-"), item.optJSONArray("subSerials").strings(),
                        item.nullableString("simNumber") ?: "-", item.nullableString("actorName") ?: item.optString("source", "-"),
                        item.optString("ownershipStatus", "owned"), item.optLong("loggedDate"), item.optString("source", "app"),
                        item.nullableString("ownershipNotes"),
                    ),
                )
            }
        } to root.getJSONObject("pagination").optInt("total")
    }

    suspend fun installationHistory(query: String = "", page: Int = 0): Pair<List<InstallationItem>, Int> = withContext(Dispatchers.IO) {
        val root = get("/api/installations?page=$page&pageSize=5&q=${query.encoded()}")
        val rows = root.getJSONArray("data")
        buildList {
            for (index in 0 until rows.length()) {
                val item = rows.getJSONObject(index)
                add(
                    InstallationItem(
                        truck = item.optString("truckLabel", "-"),
                        mother = item.optString("motherSerial", "-"),
                        subs = item.optJSONArray("subSerials").strings(),
                        status = item.nullableString("overallStatus") ?: "Recorded",
                        actor = item.nullableString("actorName") ?: "-",
                        id = item.optString("id"),
                        loggedDate = item.optLong("loggedDate"),
                        company = item.nullableString("company")?.uppercase() ?: "Not declared",
                    ),
                )
            }
        } to root.getJSONObject("pagination").optInt("total")
    }

    suspend fun registerKit(mother: String, subs: List<String>, sim: String, config: Map<String, String>) = withContext(Dispatchers.IO) {
        post(
            "/api/registrations",
            JSONObject().put("motherSerial", mother).put("subSerials", JSONArray(subs)).put("simNumber", sim)
                .putOptional("ipConfigured", config["ipConfigured"])
                .putOptional("apnConfigured", config["apnConfigured"])
                .putOptional("apnAuthSet", config["apnAuthSet"])
                .putOptional("btWriteDone", config["btWriteDone"]),
        )
    }

    suspend fun registerIncompleteKit(mother: String, subs: List<String>, sim: String?, notes: String?) = withContext(Dispatchers.IO) {
        post(
            "/api/registrations/incomplete",
            JSONObject().put("motherSerial", mother).put("subSerials", JSONArray(subs))
                .putOptional("simNumber", sim).putOptional("notes", notes),
        )
    }

    suspend fun runOrphanSweep(): Int = withContext(Dispatchers.IO) {
        post("/api/registrations/orphan-sweep", JSONObject()).optJSONObject("data")?.optInt("assignedCount") ?: 0
    }

    suspend fun backfillRegistration(mother: String, subs: List<String>, sim: String?, notes: String?): Int = withContext(Dispatchers.IO) {
        val result = post(
            "/api/registrations/backfill",
            JSONObject().put("motherSerial", mother).put("subSerials", JSONArray(subs))
                .putOptional("simNumber", sim).putOptional("notes", notes),
        )
        result.optJSONObject("data")?.optJSONArray("reclaimedFromMotherIds")?.length() ?: 0
    }

    suspend fun setRegistryOwnership(registrationIds: List<String>, status: String, notes: String) = withContext(Dispatchers.IO) {
        post(
            "/api/registry/ownership",
            JSONObject().put("registrationIds", JSONArray(registrationIds)).put("ownershipStatus", status).put("notes", notes),
        )
    }

    suspend fun installKit(
        truckId: String,
        company: String,
        motherDeviceId: String,
        subDeviceIds: List<String>,
        installMode: String,
        checklist: Map<String, String>,
    ) = withContext(Dispatchers.IO) {
        val checklistJson = JSONObject()
        checklist.forEach { (key, value) -> if (value.isNotBlank()) checklistJson.put(key, value) }
        post(
            "/api/installations",
            JSONObject().put("truckId", truckId).put("company", company.lowercase())
                .put("motherDeviceId", motherDeviceId).put("subDeviceIds", JSONArray(subDeviceIds))
                .put("installMode", installMode).put("checklist", checklistJson),
        )
    }

    suspend fun installBySerials(
        truckPlate: String,
        company: String,
        motherSerial: String,
        subSerials: List<String>,
        installMode: String,
        checklist: Map<String, String>,
    ): NativeSyncResult = withContext(Dispatchers.IO) {
        val checklistJson = JSONObject()
        checklist.forEach { (key, value) -> if (value.isNotBlank()) checklistJson.put(key, value) }
        enqueueAndSync(
            "/api/mobile/installations",
            JSONObject().put("truckPlate", truckPlate).put("company", company.lowercase())
                .put("motherSerial", motherSerial).put("subSerials", JSONArray(subSerials))
                .put("installMode", installMode).put("checklist", checklistJson),
        )
    }

    suspend fun lookup(query: String, minimal: Boolean = false): LookupSnapshot = withContext(Dispatchers.IO) {
        val detailMode = if (minimal) "&details=minimal" else ""
        val data = get("/api/lookup-cockpit?query=${query.encoded()}$detailMode").getJSONObject("data")
        val kit = data.getJSONObject("kit")
        val subRows = kit.getJSONArray("subs")
        val reviews = data.optJSONArray("reviews").reviewItems()
        LookupSnapshot(
            targetKind = data.getJSONObject("target").optString("kind", "unknown"),
            label = data.getJSONObject("target").optString("label", query),
            company = data.getJSONObject("company").nullableString("value")?.uppercase() ?: "Not declared",
            trust = data.getJSONObject("trust").optString("state", "unverified"),
            mother = kit.optJSONObject("mother")?.nullableString("serial"),
            subs = buildList {
                for (index in 0 until subRows.length()) {
                    val item = subRows.getJSONObject(index)
                    add(item.optString("slot") to item.nullableString("serial"))
                }
            },
            reviews = reviews.size,
            audit = data.optJSONArray("audit").lookupAuditFeed(),
            targetId = data.getJSONObject("target").nullableString("id"),
            companyDeclared = data.getJSONObject("company").optBoolean("declared"),
            latestVerifiedAt = data.getJSONObject("trust").nullableLong("latestVerifiedAt"),
            weakestTier = data.getJSONObject("trust").nullableString("weakestTier"),
            motherId = kit.optJSONObject("mother")?.nullableString("id"),
            subIds = buildList {
                for (index in 0 until subRows.length()) {
                    val item = subRows.getJSONObject(index)
                    add(item.optString("slot") to item.nullableString("id"))
                }
            },
            kitStatus = kit.optString("status", "not_confirmed"),
            reviewItems = reviews,
            pendingSyncCount = data.optJSONObject("sync")?.optInt("pendingCount") ?: 0,
        )
    }

    suspend fun reviews(): List<ReviewItem> = withContext(Dispatchers.IO) {
        get("/api/reviews").getJSONArray("data").reviewItems().sortedByDescending { it.createdAt }
    }

    suspend fun verifyKit(
        truckPlate: String,
        motherSerial: String,
        subSerials: List<String>,
        motherSource: String,
        subSources: List<String>,
    ): NativeSyncResult = withContext(Dispatchers.IO) {
        val target = lookup(truckPlate)
        if (target.targetKind != "truck" || target.targetId == null) {
            throw ApiException(
                "Truck ${truckPlate.uppercase()} is not registered. Use Install to create its first assignment.",
                400,
            )
        }
        enqueueAndSync(
            "/api/verifications",
            JSONObject()
                .put("truckId", truckPlate)
                .put("motherSerial", motherSerial)
                .put("motherSource", motherSource)
                .put("subs", JSONArray().apply {
                    subSerials.forEachIndexed { index, serial ->
                        if (serial.isNotBlank()) {
                            put(JSONObject().put("serial", serial).put("source", subSources.getOrNull(index) ?: "manual"))
                        }
                    }
                }),
        )
    }

    suspend fun repairBatch(
        truckPlate: String,
        reason: String,
        description: String,
        notes: String,
        items: List<Pair<String, String?>>,
    ): NativeSyncResult = withContext(Dispatchers.IO) {
        enqueueAndSync(
            "/api/repairs",
            JSONObject()
                .put("truck", truckPlate.uppercase())
                .put("reason", reason)
                .put("description", description)
                .putOptional("notes", notes.takeIf { it.isNotBlank() })
                .put("items", JSONArray().apply {
                    items.forEach { (position, replacementSerial) ->
                        put(
                            JSONObject()
                                .put("position", position)
                                .putOptional("replacementSerial", replacementSerial?.takeIf { it.isNotBlank() }?.uppercase()),
                        )
                    }
                }),
        )
    }

    suspend fun repairPool(): List<RepairItem> = withContext(Dispatchers.IO) {
        val rows = get("/api/triage").getJSONArray("data")
        buildList {
            for (index in 0 until rows.length()) {
                val item = rows.getJSONObject(index)
                add(RepairItem(
                    item.getString("deviceId"), item.optString("serial", "-"), item.optString("deviceType", "sub"),
                    item.nullableLong("enteredRepairAt"), item.nullableString("removalReason"), item.nullableString("removalNotes"),
                ))
            }
        }
    }

    suspend fun triage(deviceId: String, outcome: String): NativeSyncResult = withContext(Dispatchers.IO) {
        enqueueAndSync("/api/triage", JSONObject().put("deviceId", deviceId).put("outcome", outcome))
    }

    suspend fun reportFault(payload: JSONObject): NativeSyncResult = withContext(Dispatchers.IO) {
        enqueueAndSync("/api/mobile/faults", payload)
    }

    suspend fun syncPending(): NativeSyncResult = withContext(Dispatchers.IO) { syncPendingBlocking() }

    suspend fun setTruckCompany(truckId: String, company: String, notes: String) = withContext(Dispatchers.IO) {
        post("/api/trucks/${truckId.encoded()}/company", JSONObject().put("company", company.lowercase()).put("notes", notes))
    }

    suspend fun supervisors(): List<Pair<String, String>> = withContext(Dispatchers.IO) {
        val rows = get("/api/users/supervisors").getJSONArray("data")
        buildList { for (index in 0 until rows.length()) rows.getJSONObject(index).let { add(it.getString("id") to it.optString("displayName")) } }
    }

    suspend fun settings(): SettingsSnapshot = withContext(Dispatchers.IO) {
        val data = get("/api/mobile/settings").getJSONObject("data")
        val settings = data.getJSONObject("settings")
        val users = settings.getJSONArray("users")
        val exports = data.optJSONArray("exports")
        SettingsSnapshot(
            organisation = settings.optJSONObject("organisation")?.optString("name") ?: "DTC",
            currentUserId = data.optString("currentUserId"),
            currentRole = data.optString("currentRole"),
            users = buildList {
                for (index in 0 until users.length()) users.getJSONObject(index).let { item ->
                    add(SettingsUser(
                        item.getString("id"), item.optString("username"), item.optString("displayName"), item.optString("role"),
                        item.nullableString("company"), item.optBoolean("isActive"), item.nullableLong("lastLogin"),
                    ))
                }
            },
            exports = buildList {
                if (exports != null) for (index in 0 until exports.length()) exports.getJSONObject(index).let { item ->
                    add(ExportSummary(item.optString("key"), item.optString("label"), item.optInt("rowCount")))
                }
            },
        )
    }

    suspend fun createUser(username: String, displayName: String, password: String, role: String, company: String?) = withContext(Dispatchers.IO) {
        post("/api/mobile/settings", JSONObject().put("action", "create_user").put("username", username)
            .put("displayName", displayName).put("password", password).put("role", role).put("company", company))
    }

    suspend fun setUserActive(userId: String, active: Boolean) = withContext(Dispatchers.IO) {
        post("/api/mobile/settings", JSONObject().put("action", "set_user_active").put("userId", userId).put("isActive", active))
    }

    suspend fun resetUserPassword(userId: String, password: String) = withContext(Dispatchers.IO) {
        post(
            "/api/mobile/settings",
            JSONObject()
                .put("action", "reset_user_password")
                .put("userId", userId)
                .put("newPassword", password)
                .put("confirmPassword", password),
        )
    }

    suspend fun downloadExport(dataset: String, format: String): String = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$baseUrl/api/settings/exports?dataset=${dataset.encoded()}&format=${format.encoded()}").get().build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw ApiException("Export failed (${response.code})", response.code)
            val bytes = response.body?.bytes() ?: throw ApiException("Export returned no data")
            val disposition = response.header("Content-Disposition").orEmpty()
            val filename = Regex("filename=\"?([^\";]+)").find(disposition)?.groupValues?.get(1)
                ?: "dtc-$dataset-${System.currentTimeMillis()}.$format"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, filename)
                    put(MediaStore.Downloads.MIME_TYPE, if (format == "json") "application/json" else "text/csv")
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/DTC E-Lock")
                }
                val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw ApiException("Could not create export file")
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    ?: throw ApiException("Could not write export file")
            } else {
                val directory = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "DTC E-Lock").apply { mkdirs() }
                File(directory, filename).writeBytes(bytes)
            }
            filename
        }
    }

    suspend fun reviewAction(id: String, action: String, notes: String): String = withContext(Dispatchers.IO) {
        val response = post("/api/reviews", JSONObject().put("reviewId", id).put("action", action).put("resolutionNotes", notes))
        response.optJSONObject("data")?.optString("message").orEmpty()
    }

    suspend fun changePassword(current: String, next: String, confirm: String) = withContext(Dispatchers.IO) {
        post(
            "/api/mobile/profile/password",
            JSONObject().put("currentPassword", current).put("newPassword", next).put("confirmPassword", confirm),
        )
    }

    private fun bootstrapBlocking(): DashboardSnapshot {
        val root = get("/api/mobile/bootstrap").getJSONObject("data")
        val user = root.getJSONObject("user")
        val dashboard = root.getJSONObject("dashboard")
        val health = dashboard.getJSONObject("health")
        val counts = dashboard.getJSONObject("counts")
        val trust = dashboard.getJSONObject("trust")
        return DashboardSnapshot(
            NativeUser(user.optString("name", "DTC operator"), user.optString("role", "installer"), user.optString("id")),
            health.optString("title", "Operations ready"), health.optString("detail", ""), health.optString("tone", "ok"),
            DashboardCounts(
                counts.optInt("registeredKits"), counts.optInt("openReviews"), counts.optInt("pendingRepair"),
                counts.optInt("availableMothers"), counts.optInt("inServiceMothers"), counts.optInt("trucks"),
            ),
            DashboardTrust(trust.optInt("verified"), trust.optInt("stale"), trust.optInt("unverified"), trust.optInt("total")),
            dashboard.optJSONArray("registrations").feed("motherSerial", "source"),
            dashboard.optJSONArray("reviews").feed("kind", "status"),
        )
    }

    private fun get(path: String): JSONObject = executeJson(Request.Builder().url("$baseUrl$path").get().build())
    private fun post(path: String, body: JSONObject): JSONObject = executeJson(
        Request.Builder().url("$baseUrl$path").post(body.toString().toRequestBody(jsonType)).build(),
    )

    private fun executeJson(request: Request): JSONObject {
        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val json = if (text.trimStart().startsWith("{")) JSONObject(text) else JSONObject()
            if (!response.isSuccessful) {
                val message = json.optJSONObject("error")?.optString("message")
                    ?: if (response.code == 401) "Your session has expired" else "Request failed (${response.code})"
                throw ApiException(message, response.code)
            }
            return json
        }
    }

    @Synchronized
    private fun enqueueAndSync(endpoint: String, payload: JSONObject): NativeSyncResult {
        val nextSeq = mutationStore.getLong(MUTATION_SEQ, 0L) + 1L
        val mutationId = UUID.randomUUID().toString()
        val pending = readMutations().toMutableList().apply {
            add(PendingNativeMutation(mutationId, endpoint, JSONObject(payload.toString()), System.currentTimeMillis(), nextSeq))
        }
        writeMutations(pending, nextSeq)
        val result = syncPendingBlocking(mutationId)
        if (result.submittedStatus == "conflicted" || result.submittedStatus == "rejected") {
            throw ApiException(
                result.submittedMessage ?: "This change could not be applied to the current server record",
                409,
            )
        }
        return result
    }

    @Synchronized
    private fun syncPendingBlocking(submittedMutationId: String? = null): NativeSyncResult {
        val stored = readMutations()
        val pending = stored.filter { it.hasKnownVerificationTruck() }
        if (pending.size != stored.size) writeMutations(pending)
        if (pending.isEmpty()) return NativeSyncResult(
            pending = 0,
            applied = 0,
            reachedServer = true,
            submittedStatus = submittedMutationId?.let { "rejected" },
            submittedMessage = submittedMutationId?.let { "The queued change was incomplete and was not sent" },
        )
        return try {
            val batch = JSONArray()
            pending.sortedWith(compareBy<PendingNativeMutation> { it.clientTs }.thenBy { it.seq }).forEach { mutation ->
                batch.put(JSONObject().put("id", mutation.id).put("endpoint", mutation.endpoint).put("payload", mutation.payload)
                    .put("clientTs", mutation.clientTs).put("seq", mutation.seq))
            }
            val response = post("/api/sync", JSONObject().put("mutations", batch))
            val results = response.optJSONArray("results") ?: JSONArray()
            val applied = mutableSetOf<String>()
            val terminal = mutableSetOf<String>()
            var submittedStatus: String? = null
            var submittedMessage: String? = null
            var submittedReviewId: String? = null
            for (index in 0 until results.length()) {
                val result = results.getJSONObject(index)
                val id = result.optString("id")
                val status = result.optString("status")
                if (id == submittedMutationId) {
                    submittedStatus = status
                    submittedMessage = result.nullableString("message")
                    submittedReviewId = result.nullableString("conflictReviewId")
                }
                when (status) {
                    "applied" -> {
                        applied += id
                        terminal += id
                    }
                    "conflicted", "rejected" -> terminal += id
                }
            }
            val remaining = pending.filterNot { it.id in terminal }
            writeMutations(remaining)
            NativeSyncResult(
                pending = remaining.size,
                applied = applied.size,
                reachedServer = true,
                submittedStatus = submittedStatus ?: submittedMutationId?.let { "pending" },
                submittedMessage = submittedMessage,
                submittedReviewId = submittedReviewId,
            )
        } catch (_: Exception) {
            NativeSyncResult(
                pending = pending.size,
                applied = 0,
                reachedServer = false,
                submittedStatus = submittedMutationId?.let { "pending" },
            )
        }
    }

    @Synchronized
    private fun readMutations(): List<PendingNativeMutation> = try {
        val rows = JSONArray(mutationStore.getString(MUTATION_ROWS, "[]") ?: "[]")
        val parsed = buildList {
            for (index in 0 until rows.length()) rows.getJSONObject(index).let { row ->
                add(PendingNativeMutation(
                    row.getString("id"), row.getString("endpoint"), row.getJSONObject("payload"),
                    row.getLong("clientTs"), row.getLong("seq"),
                ))
            }
        }
        val valid = parsed.filter { it.isLocallyValid() }
        if (valid.size != parsed.size) writeMutations(valid)
        valid
    } catch (_: Exception) {
        mutationStore.edit().putString(MUTATION_ROWS, "[]").apply()
        emptyList()
    }

    private fun PendingNativeMutation.isLocallyValid(): Boolean {
        if (endpoint != "/api/verifications") return true
        val subs = payload.optJSONArray("subs") ?: return false
        return payload.optString("truckId").isNotBlank() &&
            payload.optString("motherSerial").isNotBlank() &&
            subs.length() == 3 &&
            (0 until subs.length()).all { index ->
                subs.optJSONObject(index)?.optString("serial").orEmpty().isNotBlank()
            }
    }

    private fun PendingNativeMutation.hasKnownVerificationTruck(): Boolean {
        if (endpoint != "/api/verifications") return true
        return try {
            val target = get("/api/lookup-cockpit?query=${payload.optString("truckId").encoded()}")
                .getJSONObject("data")
                .getJSONObject("target")
            target.optString("kind") == "truck" && target.nullableString("id") != null
        } catch (_: Exception) {
            true
        }
    }

    @Synchronized
    private fun writeMutations(rows: List<PendingNativeMutation>, seq: Long? = null) {
        val json = JSONArray()
        rows.forEach { row ->
            json.put(JSONObject().put("id", row.id).put("endpoint", row.endpoint).put("payload", row.payload)
                .put("clientTs", row.clientTs).put("seq", row.seq))
        }
        mutationStore.edit().putString(MUTATION_ROWS, json.toString()).apply {
            if (seq != null) putLong(MUTATION_SEQ, seq)
        }.apply()
    }

    private companion object {
        const val MUTATION_ROWS = "rows"
        const val MUTATION_SEQ = "sequence"
    }
}

private class SecureCookieJar(context: Context) : CookieJar {
    private val preferences = context.getSharedPreferences("dtc_native_session", Context.MODE_PRIVATE)
    private val cookies = mutableListOf<Cookie>()

    init { cookies += read() }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, newCookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        cookies.removeAll { old -> old.expiresAt < now || newCookies.any { it.name == old.name && it.domain == old.domain && it.path == old.path } }
        cookies += newCookies.filter { it.expiresAt >= now }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        cookies.removeAll { it.expiresAt < System.currentTimeMillis() }
        return cookies.filter { it.matches(url) }
    }

    @Synchronized
    fun clear() {
        cookies.clear()
        preferences.edit().remove(COOKIE_PREF).apply()
    }

    private fun persist() {
        val rows = JSONArray()
        cookies.forEach { cookie -> rows.put(JSONObject().apply {
            put("name", cookie.name); put("value", cookie.value); put("domain", cookie.domain); put("path", cookie.path)
            put("expires", cookie.expiresAt); put("secure", cookie.secure); put("http", cookie.httpOnly); put("host", cookie.hostOnly)
        }) }
        preferences.edit().putString(COOKIE_PREF, encrypt(rows.toString())).apply()
    }

    private fun read(): List<Cookie> = try {
        val saved = preferences.getString(COOKIE_PREF, null) ?: return emptyList()
        val rows = JSONArray(decrypt(saved))
        buildList {
            for (index in 0 until rows.length()) {
                val item = rows.getJSONObject(index)
                val builder = Cookie.Builder().name(item.getString("name")).value(item.getString("value"))
                    .path(item.optString("path", "/")).expiresAt(item.optLong("expires", Long.MAX_VALUE))
                if (item.optBoolean("host", true)) builder.hostOnlyDomain(item.getString("domain")) else builder.domain(item.getString("domain"))
                if (item.optBoolean("secure")) builder.secure()
                if (item.optBoolean("http")) builder.httpOnly()
                add(builder.build())
            }
        }
    } catch (_: Exception) {
        preferences.edit().remove(COOKIE_PREF).apply()
        emptyList()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, IV_SIZE)))
        return cipher.doFinal(bytes.copyOfRange(IV_SIZE, bytes.size)).toString(Charsets.UTF_8)
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build(),
            )
            generateKey()
        }
    }

    private companion object {
        const val COOKIE_PREF = "cookies"
        const val KEY_ALIAS = "dtc_native_session_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
    }
}

private fun String.encoded(): String = java.net.URLEncoder.encode(this, "UTF-8")
private fun JSONObject.nullableString(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }
private fun JSONObject.nullableLong(key: String): Long? = if (!has(key) || isNull(key)) null else optLong(key)
private fun JSONObject.putOptional(key: String, value: String?): JSONObject = apply { if (!value.isNullOrBlank()) put(key, value) }
private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else buildList { for (index in 0 until length()) add(optString(index)) }
private data class NativeReviewPresentation(
    val title: String,
    val summary: String,
    val details: List<ReviewDetail>,
    val recommendedAction: String,
)

private fun JSONArray?.reviewItems(): List<ReviewItem> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) {
        val item = getJSONObject(index)
        val rawPayload = item.opt("payload")
        val payloadObject = rawPayload as? JSONObject ?: JSONObject()
        val payload = when (rawPayload) {
            is JSONObject -> rawPayload.toString(2)
            is JSONArray -> rawPayload.toString(2)
            else -> rawPayload?.toString().orEmpty()
        }
        val fallback = localReviewPresentation(item.optString("kind"), payloadObject)
        val presentation = item.optJSONObject("presentation")
        val details = presentation?.optJSONArray("details")
        val parsedDetails = buildList {
            if (details != null) {
                for (detailIndex in 0 until details.length()) {
                    val detail = details.getJSONObject(detailIndex)
                    add(ReviewDetail(detail.optString("label"), detail.optString("value")))
                }
            }
        }
        add(ReviewItem(
            id = item.getString("id"),
            kind = item.optString("kind"),
            payload = payload,
            createdAt = item.optLong("createdAt"),
            status = item.optString("status", "open"),
            title = presentation?.optString("title")?.takeIf(String::isNotBlank) ?: fallback.title,
            summary = presentation?.optString("summary")?.takeIf(String::isNotBlank) ?: fallback.summary,
            details = parsedDetails.ifEmpty { fallback.details },
            recommendedAction = presentation?.optString("recommendedAction")?.takeIf(String::isNotBlank)
                ?: fallback.recommendedAction,
        ))
    }
}

private fun localReviewPresentation(kind: String, payload: JSONObject): NativeReviewPresentation {
    if (kind == "unlogged_swap") {
        val truck = payload.firstReviewText("truckLabel", "truckId").ifBlank { "the selected truck" }
        return NativeReviewPresentation(
            title = "Physical kit differed from the registry",
            summary = "A verification on $truck found different physical lock serials from the registry.",
            details = reviewDetails(
                "Truck" to truck,
                "Previously recorded mother" to payload.reviewText("expectedMotherSerial").ifBlank { "None recorded" },
                "Scanned mother" to payload.reviewText("observedMotherSerial"),
                "Previously recorded sub-locks" to payload.reviewList("expectedSubSerials"),
                "Scanned sub-locks" to payload.reviewList("observedSubSerials"),
            ),
            recommendedAction = "Confirm the physical scan. If it is correct, mark this review as reviewed.",
        )
    }

    if (kind == "sync_conflict") {
        val queued = payload.optJSONObject("queuedMutation") ?: JSONObject()
        val endpoint = queued.reviewText("endpoint")
        val operation = queued.optJSONObject("payload") ?: JSONObject()
        val reason = payload.reviewText("error").ifBlank { "The server could not apply this saved change" }
        if (endpoint == "/api/mobile/installations") {
            val truck = operation.reviewText("truckPlate").ifBlank { "Unknown truck" }
            return NativeReviewPresentation(
                title = "Installation for $truck was not recorded",
                summary = "The scanned installation reached the server, but the assignment was not changed. $reason",
                details = reviewDetails(
                    "Truck" to truck,
                    "Install type" to if (operation.reviewText("installMode") == "changed") "Kit change / override" else "Installation",
                    "Serving company" to operation.reviewText("company").uppercase(),
                    "Scanned mother" to operation.reviewText("motherSerial"),
                    "Scanned sub-locks" to operation.reviewList("subSerials"),
                    "Why it failed" to reason,
                ),
                recommendedAction = "Check that all four locks are registered and owned by DTC, then repeat Install. A kit-change scan moves locks from stale assignments automatically.",
            )
        }
        if (endpoint == "/api/repairs") {
            val truck = operation.reviewText("truck").ifBlank { "Unknown truck" }
            return NativeReviewPresentation(
                title = "Repair for $truck was not applied",
                summary = "The remove/replace operation reached the server, but the installed kit was left unchanged. $reason",
                details = reviewDetails(
                    "Truck" to truck,
                    "Requested operations" to operation.reviewRepairOperations(),
                    "Reason selected" to operation.reviewText("reason").replace('_', ' '),
                    "Fault description" to operation.reviewText("description"),
                    "Why it failed" to reason,
                ),
                recommendedAction = "Reload the truck in Repairs and confirm its current serials. A replacement lock must be registered, owned by DTC and available before retrying.",
            )
        }
        if (endpoint == "/api/verifications") {
            val truck = operation.reviewText("truckId").ifBlank { "the selected truck" }
            return NativeReviewPresentation(
                title = "Verification for $truck was not recorded",
                summary = "The physical-kit verification reached the server but could not be applied. $reason",
                details = reviewDetails(
                    "Truck" to truck,
                    "Scanned mother" to operation.reviewText("motherSerial"),
                    "Why it failed" to reason,
                ),
                recommendedAction = "Reload the truck and repeat verification using the current plate and all four lock serials.",
            )
        }
        return NativeReviewPresentation(
            title = "Offline change could not be applied",
            summary = "A saved field operation reached the server but was not applied. $reason",
            details = reviewDetails(
                "Operation" to endpoint.ifBlank { "Offline change" },
                "Reason" to reason,
                "Saved on device" to queued.reviewText("clientTs"),
            ),
            recommendedAction = "Check the current truck or kit state and repeat the intended action if it is still required.",
        )
    }

    val reason = payload.reviewText("reason")
    val row = payload.optJSONObject("row") ?: JSONObject()
    if (reason == "kit_mismatch_updated_registry") {
        val truck = row.reviewText("truck")
        return NativeReviewPresentation(
            title = "Installation history differs from the registered kit",
            summary = "The installation entry${truck.takeIf(String::isNotBlank)?.let { " for $it" }.orEmpty()} lists different lock serials from the registration record.",
            details = reviewDetails(
                "Truck" to truck,
                "Mother lock" to row.reviewText("mother"),
                "Installation B / C / D" to row.reviewSlots("install_sub_"),
                "Registered B / C / D" to row.reviewSlots("registry_sub_"),
                "Installation source row" to row.reviewText("install_row"),
                "Registry source row" to row.reviewText("registry_row"),
            ),
            recommendedAction = "Verify the physical kit. If it matches the registry, mark this review as reviewed.",
        )
    }
    if (reason == "invalid_masterlist_kit") {
        val subs = row.reviewValues("sub_b", "sub_c", "sub_d")
        val motherOnly = subs.isEmpty()
        return NativeReviewPresentation(
            title = if (motherOnly) "Mother-only registration record" else "Incomplete registration record",
            summary = if (motherOnly) {
                "This registration contains a mother lock without sub-locks. That can be valid, but it should be confirmed."
            } else {
                "This registration lists ${subs.size} of the three expected sub-locks."
            },
            details = reviewDetails(
                "Mother lock" to row.reviewText("mother"),
                "Sub-locks listed" to subs.joinToString(", ").ifBlank { "None" },
                "SIM" to row.reviewText("sim"),
                "Source row" to row.reviewText("source_row"),
            ),
            recommendedAction = "Confirm whether this was intentionally registered as mother-only or complete the actual kit.",
        )
    }
    if (reason == "masterlist_sub_in_multiple_kits") {
        return NativeReviewPresentation(
            title = "Sub-lock appears in more than one registered kit",
            summary = "One or more sub-lock serials are assigned to multiple registration kits.",
            details = reviewDetails(
                "Mother lock" to row.reviewText("mother"),
                "Duplicated sub-locks" to payload.reviewList("duplicated_subs"),
                "Kit B / C / D" to row.reviewValues("sub_b", "sub_c", "sub_d").joinToString(", "),
                "Source row" to row.reviewText("source_row"),
            ),
            recommendedAction = "Check the physical kits and keep each sub-lock with the correct mother.",
        )
    }
    if (reason == "mother_missing_registration_masterlist") {
        return NativeReviewPresentation(
            title = "Installed mother is missing from registration records",
            summary = "An installation uses a mother lock that was not found in the registration masterlist.",
            details = reviewDetails(
                "Truck" to row.reviewText("truck"),
                "Mother lock" to row.reviewText("mother"),
                "Sub-locks" to row.reviewValues("sub_b", "sub_c", "sub_d").joinToString(", "),
                "Installer" to row.reviewText("team_member"),
                "Installation source row" to row.reviewText("source_row"),
            ),
            recommendedAction = "Confirm the physical kit, then register the missing mother with only its actual sub-locks.",
        )
    }

    val identity = row.firstReviewText("truck", "mother", "source_row")
    return NativeReviewPresentation(
        title = reason.reviewSentence().ifBlank { "Data conflict needs review" },
        summary = if (identity.isBlank()) "Two records disagree and need a supervisor decision."
            else "A conflict affecting $identity needs a supervisor decision.",
        details = buildList {
            val keys = row.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val value = row.reviewText(key)
                if (value.isNotBlank()) add(ReviewDetail(key.reviewSentence(), value))
            }
        },
        recommendedAction = "Check the listed source record and current physical state before closing this review.",
    )
}

private fun reviewDetails(vararg rows: Pair<String, String>): List<ReviewDetail> =
    rows.filter { it.second.isNotBlank() }.map { ReviewDetail(it.first, it.second) }

private fun JSONObject.reviewText(key: String): String {
    val value = opt(key)
    return when (value) {
        null, JSONObject.NULL -> ""
        is String, is Number, is Boolean -> value.toString().trim()
        else -> ""
    }
}

private fun JSONObject.firstReviewText(vararg keys: String): String =
    keys.firstNotNullOfOrNull { key -> reviewText(key).takeIf(String::isNotBlank) }.orEmpty()

private fun JSONObject.reviewList(key: String): String {
    val values = optJSONArray(key) ?: return reviewText(key)
    return buildList {
        for (index in 0 until values.length()) {
            values.optString(index).trim().takeIf(String::isNotBlank)?.let(::add)
        }
    }.joinToString(", ")
}

private fun JSONObject.reviewRepairOperations(): String {
    val values = optJSONArray("items") ?: return ""
    return buildList {
        for (index in 0 until values.length()) {
            val item = values.optJSONObject(index) ?: continue
            val position = item.optString("position")
            if (position.isBlank()) continue
            val label = if (position == "mother") "Mother lock" else "Sub-lock $position"
            val replacement = item.optString("replacementSerial")
            add(if (replacement.isBlank()) "$label: remove only" else "$label: replace with $replacement")
        }
    }.joinToString("; ")
}

private fun JSONObject.reviewValues(vararg keys: String): List<String> =
    keys.map(::reviewText).filter(String::isNotBlank)

private fun JSONObject.reviewSlots(prefix: String): String =
    listOf("b", "c", "d").joinToString(" / ") { slot -> reviewText("$prefix$slot").ifBlank { "Missing" } }

private fun String.reviewSentence(): String {
    val words = replace('_', ' ').trim()
    return words.replaceFirstChar { character -> character.uppercase() }
}

private fun JSONArray?.lookupAuditFeed(): List<FeedItem> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) {
        val item = getJSONObject(index)
        add(FeedItem(
            title = item.optString("summary", "Activity"),
            detail = item.optString("detail", item.optString("entityTable")),
            timestamp = item.optLong("createdAt"),
        ))
    }
}
private fun JSONArray?.feed(title: String, detail: String): List<FeedItem> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) {
        val item = getJSONObject(index)
        add(FeedItem(item.optString(title, "Activity"), item.optString(detail, ""), item.optLong("createdAt", item.optLong("loggedDate"))))
    }
}
