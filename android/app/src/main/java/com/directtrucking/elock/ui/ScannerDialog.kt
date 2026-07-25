package com.directtrucking.elock.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.FlashOff
import androidx.compose.material.icons.outlined.FlashOn
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@Composable
fun ScannerDialog(label: String, onScanned: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val cameraHeight = if (configuration.screenWidthDp >= 600) 204.dp else 178.dp
    var permissionGranted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permissionGranted = it }
    LaunchedEffect(Unit) { if (!permissionGranted) permission.launch(Manifest.permission.CAMERA) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(16.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (permissionGranted) {
                CameraScanner(label = label, cameraHeight = cameraHeight, onScanned = onScanned, onDismiss = onDismiss)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Camera permission is needed to scan lock labels.")
                    Button(onClick = { permission.launch(Manifest.permission.CAMERA) }) { Text("Allow camera") }
                }
            }
            }
        }
    }
}

@androidx.annotation.OptIn(ExperimentalGetImage::class)
@Composable
private fun CameraScanner(label: String, cameraHeight: Dp, onScanned: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val haptic = LocalHapticFeedback.current
    var retryGeneration by remember { mutableStateOf(0) }
    val executor = remember(retryGeneration) { Executors.newSingleThreadExecutor() }
    val scanner = remember(retryGeneration) {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).build(),
        )
    }
    var torch by remember { mutableStateOf(false) }
    var hasTorch by remember { mutableStateOf<Boolean?>(null) }
    var cameraControl by remember { mutableStateOf<androidx.camera.core.CameraControl?>(null) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var consumed by remember { mutableStateOf(false) }
    val previewView = remember {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(4.dp).height(40.dp).background(DtcRed, androidx.compose.foundation.shape.RoundedCornerShape(3.dp)))
            Column(Modifier.padding(start = 11.dp).weight(1f)) {
                Text("Scan $label", style = MaterialTheme.typography.titleLarge)
                Text("Hold the label steady inside the guide.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Close scanner") }
        }
        Box(
            Modifier.fillMaxWidth().height(cameraHeight)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), androidx.compose.foundation.shape.RoundedCornerShape(8.dp))
                .clip(androidx.compose.foundation.shape.RoundedCornerShape(8.dp)),
        ) {
            AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
            Box(
                Modifier.align(Alignment.Center).fillMaxWidth(.70f).height(92.dp)
                    .border(BorderStroke(2.dp, DtcRed)),
            )
            Text(
                "ALIGN CODE WITHIN FRAME",
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp)
                    .background(Ink.copy(alpha = .84f), androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                    .padding(horizontal = 9.dp, vertical = 5.dp),
                color = androidx.compose.ui.graphics.Color.White,
                style = MaterialTheme.typography.labelMedium,
            )
            if (cameraError != null) {
                Column(
                    Modifier.align(Alignment.Center).fillMaxWidth().background(Ink.copy(alpha = .94f)).padding(18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(cameraError!!, color = androidx.compose.ui.graphics.Color.White, style = MaterialTheme.typography.bodyMedium)
                    Button(onClick = {
                        cameraError = null
                        consumed = false
                        retryGeneration += 1
                    }) { Text("Retry camera") }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().height(48.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), androidx.compose.foundation.shape.RoundedCornerShape(7.dp))
                .padding(start = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                when {
                    hasTorch == false -> "TORCH / UNAVAILABLE"
                    torch -> "TORCH / ON"
                    else -> "TORCH / READY"
                },
                style = MaterialTheme.typography.labelMedium,
                color = if (torch) DtcRed else MaterialTheme.colorScheme.onSurface,
            )
            IconButton(onClick = {
                torch = !torch
                cameraControl?.enableTorch(torch)
            }, enabled = hasTorch == true) {
                Icon(
                    if (torch) Icons.Outlined.FlashOn else Icons.Outlined.FlashOff,
                    if (hasTorch == false) "Torch unavailable" else "Toggle torch",
                    tint = if (torch) DtcRed else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }

    DisposableEffect(lifecycleOwner, retryGeneration) {
        cameraError = null
        val providerFuture = ProcessCameraProvider.getInstance(context)
        val listener = Runnable {
            try {
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { imageProxy ->
                    val image = imageProxy.image
                    if (image == null || consumed) {
                        imageProxy.close()
                    } else {
                        scanner.process(InputImage.fromMediaImage(image, imageProxy.imageInfo.rotationDegrees))
                            .addOnSuccessListener { barcodes ->
                                val value = barcodes.firstNotNullOfOrNull { it.rawValue?.trim()?.takeIf(String::isNotEmpty) }
                                if (value != null && !consumed) {
                                    consumed = true
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onScanned(value)
                                }
                            }
                            .addOnCompleteListener { imageProxy.close() }
                    }
                }
                provider.unbindAll()
                val camera = provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                cameraControl = camera.cameraControl
                hasTorch = camera.cameraInfo.hasFlashUnit()
            } catch (_: Exception) {
                cameraControl = null
                hasTorch = null
                cameraError = "The camera could not start. Close other camera apps, then retry."
            }
        }
        providerFuture.addListener(listener, ContextCompat.getMainExecutor(context))
        onDispose {
            runCatching { providerFuture.get().unbindAll() }
            scanner.close()
            executor.shutdown()
        }
    }
}
