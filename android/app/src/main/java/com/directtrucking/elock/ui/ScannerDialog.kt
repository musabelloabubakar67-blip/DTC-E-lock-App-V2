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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
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
    var permissionGranted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permissionGranted = it }
    LaunchedEffect(Unit) { if (!permissionGranted) permission.launch(Manifest.permission.CAMERA) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            Modifier.widthIn(max = 210.dp).fillMaxWidth().padding(8.dp),
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(2.dp, MaterialTheme.colorScheme.outline),
        ) {
            Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (permissionGranted) {
                CameraScanner(label = label, onScanned = onScanned, onDismiss = onDismiss)
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

@OptIn(ExperimentalGetImage::class)
@Composable
private fun CameraScanner(label: String, onScanned: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).build(),
        )
    }
    var torch by remember { mutableStateOf(false) }
    var cameraControl by remember { mutableStateOf<androidx.camera.core.CameraControl?>(null) }
    var consumed by remember { mutableStateOf(false) }
    val previewView = remember {
        PreviewView(context).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }

    Box(Modifier.fillMaxWidth().height(120.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxWidth().height(120.dp))
        Row(
            Modifier.align(Alignment.TopCenter).fillMaxWidth().background(Ink.copy(alpha = .88f)).padding(start = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("[ SCAN ${label.uppercase()} ]", Modifier.weight(1f), color = androidx.compose.ui.graphics.Color.White, style = MaterialTheme.typography.labelMedium)
            IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Close scanner", tint = androidx.compose.ui.graphics.Color.White) }
        }
        Text(
            "ALIGN CODE WITHIN FRAME",
            modifier = Modifier.align(Alignment.Center).background(Ink.copy(alpha = .82f)).padding(horizontal = 8.dp, vertical = 5.dp),
            color = androidx.compose.ui.graphics.Color.White,
            style = MaterialTheme.typography.labelMedium,
        )
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Ink.copy(alpha = .88f)).padding(start = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(if (torch) "TORCH / ON" else "TORCH / OFF", style = MaterialTheme.typography.labelMedium, color = if (torch) DtcRed else androidx.compose.ui.graphics.Color.White)
            IconButton(onClick = {
                torch = !torch
                cameraControl?.enableTorch(torch)
            }) { Icon(if (torch) Icons.Outlined.FlashOn else Icons.Outlined.FlashOff, "Toggle torch", tint = if (torch) DtcRed else androidx.compose.ui.graphics.Color.White) }
        }
    }

    DisposableEffect(lifecycleOwner) {
        val providerFuture = ProcessCameraProvider.getInstance(context)
        val listener = Runnable {
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
                                onScanned(value)
                            }
                        }
                        .addOnCompleteListener { imageProxy.close() }
                }
            }
            try {
                provider.unbindAll()
                val camera = provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                cameraControl = camera.cameraControl
            } catch (_: Exception) {
                onScanned("")
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
