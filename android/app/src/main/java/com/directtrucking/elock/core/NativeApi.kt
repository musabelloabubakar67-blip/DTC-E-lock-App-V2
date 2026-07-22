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
)
data class ReviewItem(val id: String, val kind: String, val payload: String, val createdAt: Long, val status: String = "open")
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
data class NativeSyncResult(val pending: Int, val applied: Int, val reachedServer: Boolean)

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
                        item.optString("truckLabel", "-"), item.optString("motherSerial", "-"), item.optJSONArray("subSerials").strings(),
                        item.nullableString("overallStatus") ?: "Recorded", item.nullableString("actorName") ?: "-",
                        item.optString("id"), item.optLong("loggedDate"),
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

    suspend fun lookup(query: String): LookupSnapshot = withContext(Dispatchers.IO) {
        val data = get("/api/lookup-cockpit?query=${query.encoded()}").getJSONObject("data")
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
            audit = data.optJSONArray("audit").feed("summary", "entityTable"),
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
        get("/api/reviews").getJSONArray("data").reviewItems()
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

    suspend fun reviewAction(id: String, action: String, notes: String) = withContext(Dispatchers.IO) {
        post("/api/reviews", JSONObject().put("reviewId", id).put("action", action).put("resolutionNotes", notes))
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
        val pending = readMutations().toMutableList().apply {
            add(PendingNativeMutation(UUID.randomUUID().toString(), endpoint, JSONObject(payload.toString()), System.currentTimeMillis(), nextSeq))
        }
        writeMutations(pending, nextSeq)
        return syncPendingBlocking()
    }

    @Synchronized
    private fun syncPendingBlocking(): NativeSyncResult {
        val pending = readMutations()
        if (pending.isEmpty()) return NativeSyncResult(0, 0, true)
        return try {
            val batch = JSONArray()
            pending.sortedWith(compareBy<PendingNativeMutation> { it.clientTs }.thenBy { it.seq }).forEach { mutation ->
                batch.put(JSONObject().put("id", mutation.id).put("endpoint", mutation.endpoint).put("payload", mutation.payload)
                    .put("clientTs", mutation.clientTs).put("seq", mutation.seq))
            }
            val response = post("/api/sync", JSONObject().put("mutations", batch))
            val results = response.optJSONArray("results") ?: JSONArray()
            val applied = mutableSetOf<String>()
            for (index in 0 until results.length()) {
                val result = results.getJSONObject(index)
                if (result.optString("status") == "applied") applied += result.optString("id")
            }
            val remaining = pending.filterNot { it.id in applied }
            writeMutations(remaining)
            NativeSyncResult(remaining.size, applied.size, true)
        } catch (_: Exception) {
            NativeSyncResult(pending.size, 0, false)
        }
    }

    @Synchronized
    private fun readMutations(): List<PendingNativeMutation> = try {
        val rows = JSONArray(mutationStore.getString(MUTATION_ROWS, "[]") ?: "[]")
        buildList {
            for (index in 0 until rows.length()) rows.getJSONObject(index).let { row ->
                add(PendingNativeMutation(
                    row.getString("id"), row.getString("endpoint"), row.getJSONObject("payload"),
                    row.getLong("clientTs"), row.getLong("seq"),
                ))
            }
        }
    } catch (_: Exception) {
        mutationStore.edit().putString(MUTATION_ROWS, "[]").apply()
        emptyList()
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
private fun JSONArray?.reviewItems(): List<ReviewItem> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) {
        val item = getJSONObject(index)
        val payload = when (val raw = item.opt("payload")) {
            is JSONObject -> raw.toString(2)
            is JSONArray -> raw.toString(2)
            else -> raw?.toString().orEmpty()
        }
        add(ReviewItem(
            item.getString("id"), item.optString("kind"), payload, item.optLong("createdAt"),
            item.optString("status", "open"),
        ))
    }
}
private fun JSONArray?.feed(title: String, detail: String): List<FeedItem> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) {
        val item = getJSONObject(index)
        add(FeedItem(item.optString(title, "Activity"), item.optString(detail, ""), item.optLong("createdAt", item.optLong("loggedDate"))))
    }
}
