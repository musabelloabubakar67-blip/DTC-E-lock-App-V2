# DTC E-Lock Android

This directory contains the native Android client. It is a Kotlin and Jetpack Compose app; it does not open Chrome, a Trusted Web Activity, or an embedded WebView.

## Targets

- Android phones: compact bottom navigation and single-column field workflows.
- Android tablets: persistent navigation rail, wider workbenches, and adaptive archive layouts.
- Minimum Android version: API 23.
- Production API: `https://web-production-2265c.up.railway.app`.

## Native capabilities

- Android Keystore-encrypted NextAuth session cookies.
- Native login, dashboard, register, install, lookup, review, settings, password change, and sign-out.
- CameraX and bundled ML Kit barcode scanning with a native torch toggle.
- Searchable registration and installation archives.
- Serial- and plate-based forms; internal database IDs are never shown.
- Native WhatsApp handoff after installation.
- Light, dark, and system themes.

## Build

From `android/` on this workstation:

```powershell
$env:JAVA_HOME='C:\dev\dtc-elock\.android-tools\jdk-17'
$env:ANDROID_HOME='C:\dev\dtc-elock\.android-tools\android-sdk'
$env:GRADLE_USER_HOME='C:\dev\dtc-elock\.gradle-home'
.\gradlew.bat :app:assembleDebug --offline --no-daemon
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

For local API testing over `adb reverse tcp:3107 tcp:3107`, build with:

```powershell
.\gradlew.bat :app:assembleDebug -PDTC_API_BASE_URL=http://127.0.0.1:3107
```

Cleartext traffic is permitted only by the debug manifest. Release builds remain HTTPS-only.

## Install

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

The debug package is `com.directtrucking.elock.nativealpha`, so it can be tested beside the existing `com.directtrucking.elock` wrapper. The final signed release should replace the wrapper package after data and workflow parity testing.

## Release checklist

1. Deploy the `/api/mobile/*` routes with the web backend.
2. Run phone and tablet smoke tests against Railway.
3. Add Room and WorkManager before claiming offline installation parity.
4. Create and securely store the Play signing key outside the repository.
5. Configure release signing in CI secrets and build an Android App Bundle.
6. Remove the `.nativealpha` debug application suffix only for the signed release.
