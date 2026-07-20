package com.directtrucking.elock.core

import android.content.Context
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
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class NativeUser(val name: String, val role: String)
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
data class RegistryItem(val id: String, val mother: String, val subs: List<String>, val sim: String, val actor: String, val ownership: String)
data class InstallationItem(val truck: String, val mother: String, val subs: List<String>, val status: String, val actor: String)
data class ReviewItem(val id: String, val kind: String, val payload: String, val createdAt: Long)
data class LookupSnapshot(
    val targetKind: String,
    val label: String,
    val company: String,
    val trust: String,
    val mother: String?,
    val subs: List<Pair<String, String?>>,
    val reviews: Int,
    val audit: List<FeedItem>,
)

class ApiException(message: String, val statusCode: Int = 0) : Exception(message)

class DtcApi(context: Context) {
    private val cookieJar = SecureCookieJar(context.applicationContext)
    private val client = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(35, TimeUnit.SECONDS)
        .build()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/')

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

    suspend fun registry(query: String = "", page: Int = 0): Pair<List<RegistryItem>, Int> = withContext(Dispatchers.IO) {
        val root = get("/api/registry?page=$page&pageSize=24&q=${query.encoded()}")
        val rows = root.getJSONArray("data")
        buildList {
            for (index in 0 until rows.length()) {
                val item = rows.getJSONObject(index)
                add(
                    RegistryItem(
                        item.getString("id"), item.optString("motherSerial", "-"), item.optJSONArray("subSerials").strings(),
                        item.nullableString("simNumber") ?: "-", item.nullableString("actorName") ?: item.optString("source", "-"),
                        item.optString("ownershipStatus", "owned"),
                    ),
                )
            }
        } to root.getJSONObject("pagination").optInt("total")
    }

    suspend fun installationHistory(query: String = "", page: Int = 0): Pair<List<InstallationItem>, Int> = withContext(Dispatchers.IO) {
        val root = get("/api/installations?page=$page&pageSize=24&q=${query.encoded()}")
        val rows = root.getJSONArray("data")
        buildList {
            for (index in 0 until rows.length()) {
                val item = rows.getJSONObject(index)
                add(
                    InstallationItem(
                        item.optString("truckLabel", "-"), item.optString("motherSerial", "-"), item.optJSONArray("subSerials").strings(),
                        item.nullableString("overallStatus") ?: "Recorded", item.nullableString("actorName") ?: "-",
                    ),
                )
            }
        } to root.getJSONObject("pagination").optInt("total")
    }

    suspend fun registerKit(mother: String, subs: List<String>, sim: String) = withContext(Dispatchers.IO) {
        post(
            "/api/registrations",
            JSONObject().put("motherSerial", mother).put("subSerials", JSONArray(subs)).put("simNumber", sim)
                .put("ipConfigured", "yes").put("apnConfigured", "yes").put("apnAuthSet", "yes").put("btWriteDone", "yes"),
        )
    }

    suspend fun installKit(truck: String, company: String, mother: String, subs: List<String>, status: String) = withContext(Dispatchers.IO) {
        post(
            "/api/mobile/installations",
            JSONObject().put("truckPlate", truck).put("company", company.lowercase()).put("motherSerial", mother)
                .put("subSerials", JSONArray(subs)).put("installMode", "changed")
                .put("checklist", JSONObject().put("overallStatus", status)),
        )
    }

    suspend fun lookup(query: String): LookupSnapshot = withContext(Dispatchers.IO) {
        val data = get("/api/lookup-cockpit?query=${query.encoded()}").getJSONObject("data")
        val kit = data.getJSONObject("kit")
        val subRows = kit.getJSONArray("subs")
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
            reviews = data.optJSONArray("reviews")?.length() ?: 0,
            audit = data.optJSONArray("audit").feed("summary", "entityTable"),
        )
    }

    suspend fun reviews(): List<ReviewItem> = withContext(Dispatchers.IO) {
        val rows = get("/api/reviews").getJSONArray("data")
        buildList {
            for (index in 0 until rows.length()) {
                val item = rows.getJSONObject(index)
                add(ReviewItem(item.getString("id"), item.optString("kind"), item.opt("payload").toString(), item.optLong("createdAt")))
            }
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
            NativeUser(user.optString("name", "DTC operator"), user.optString("role", "installer")),
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
private fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else buildList { for (index in 0 until length()) add(optString(index)) }
private fun JSONArray?.feed(title: String, detail: String): List<FeedItem> = if (this == null) emptyList() else buildList {
    for (index in 0 until length()) {
        val item = getJSONObject(index)
        add(FeedItem(item.optString(title, "Activity"), item.optString(detail, ""), item.optLong("createdAt", item.optLong("loggedDate"))))
    }
}
