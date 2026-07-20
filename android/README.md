# DTC E-Lock Android

This project packages the production PWA as a Trusted Web Activity (TWA).

## Local debug build

1. Install dependencies with `npm install`.
2. Regenerate native files with `npm run twa:update` after changing `twa-manifest.json`.
3. Set `JAVA_HOME` to JDK 17 and `ANDROID_HOME` to an Android SDK containing API 36.
4. Run `gradlew.bat assembleDebug` on Windows.

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

`LauncherActivity` pins `com.android.chrome` as the TWA provider because the Samsung Internet version on the fleet tablet only opens the app as a Custom Tab. Keep Chrome updated on managed tablets.

## Domain verification

The website must serve `/.well-known/assetlinks.json` with this package name and the SHA-256 fingerprint of every trusted signing certificate. The committed fingerprint is for local device testing only. Before Play Store release, add the Play App Signing certificate fingerprint and build with the permanent release key.

Never commit a keystore, signing password, APK, or app bundle.
