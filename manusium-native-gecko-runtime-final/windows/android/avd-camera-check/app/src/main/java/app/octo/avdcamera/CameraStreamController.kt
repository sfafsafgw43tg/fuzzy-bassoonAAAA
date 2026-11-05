package app.octo.avdcamera

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.nio.ByteBuffer
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Immutable copy of one YUV_420_888 frame. The buffers are owned by this value;
 * callers may retain them after [FrameListener.onFrame] returns.
 */
data class RawCameraFrame(
    val width: Int,
    val height: Int,
    val rotationDegrees: Int,
    val timestampNs: Long,
    val planes: List<RawCameraPlane>,
)

data class RawCameraPlane(
    val bytes: ByteArray,
    val rowStride: Int,
    val pixelStride: Int,
)

fun interface FrameListener {
    fun onFrame(frame: RawCameraFrame)
}

/**
 * CameraX stream for an emulator camera exposed to Android as a Camera2 id
 * such as "webcam0". Preview and analysis are bound together so they use the
 * same selected camera and lifecycle.
 *
 * ImageProxy is always closed by this class. The listener receives detached
 * byte-array copies and therefore may process them asynchronously.
 */
class CameraStreamController(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
    private val frameListener: FrameListener,
    private val analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor(),
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val closed = AtomicBoolean(false)
    private var provider: ProcessCameraProvider? = null
    private var selectedCameraId: String? = null

    init {
        // TextureView/COMPATIBLE is more tolerant of emulator and virtual-camera
        // surfaces than the hardware-only path, and mirrors the safe preview
        // choice used by the reference CameraX scanner.
        previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        previewView.scaleType = PreviewView.ScaleType.FILL_CENTER
    }

    fun start(cameraId: String) {
        check(!closed.get()) { "CameraStreamController is closed" }
        selectedCameraId = cameraId
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (closed.get()) return@addListener
            try {
                provider = future.get()
                bindSelectedCamera()
            } catch (error: Exception) {
                Diagnostics.log("stream provider failed: ${error.javaClass.simpleName}: ${error.message}")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /** Bind to a provider that the host activity already obtained. */
    fun bind(cameraProvider: ProcessCameraProvider, cameraId: String) {
        check(!closed.get()) { "CameraStreamController is closed" }
        provider = cameraProvider
        selectedCameraId = cameraId
        bindSelectedCamera()
    }

    fun switchTo(cameraId: String) {
        check(!closed.get()) { "CameraStreamController is closed" }
        selectedCameraId = cameraId
        if (provider != null) bindSelectedCamera()
    }

    fun stop() {
        provider?.unbindAll()
        provider = null
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        stop()
        analysisExecutor.shutdown()
        mainHandler.removeCallbacksAndMessages(null)
    }

    private fun bindSelectedCamera() {
        val currentProvider = provider ?: return
        val cameraId = selectedCameraId ?: return
        val present = currentProvider.availableCameraInfos.any { info ->
            runCatching { Camera2CameraInfo.from(info).cameraId == cameraId }.getOrDefault(false)
        }
        if (!present) {
            Diagnostics.log("camera id $cameraId is no longer available; refusing to bind")
            previewView.post { previewView.visibility = android.view.View.INVISIBLE }
            return
        }
        previewView.visibility = android.view.View.VISIBLE
        val selector = CameraSelector.Builder()
            .addCameraFilter { infos ->
                infos.filter { info ->
                    runCatching { Camera2CameraInfo.from(info).cameraId == cameraId }.getOrDefault(false)
                }
            }
            .build()

        val rotation = previewView.display?.rotation ?: android.view.Surface.ROTATION_0
        val preview = Preview.Builder()
            .setTargetRotation(rotation)
            .build()
            .also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val analysis = ImageAnalysis.Builder()
            .setTargetRotation(rotation)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
            .build()
        analysis.setAnalyzer(analysisExecutor) { image -> analyze(image) }

        try {
            currentProvider.unbindAll()
            currentProvider.bindToLifecycle(lifecycleOwner, selector, preview, analysis)
            Diagnostics.log("stream bound to $cameraId")
        } catch (error: Exception) {
            analysis.clearAnalyzer()
            currentProvider.unbindAll()
            Diagnostics.log("stream bind failed for $cameraId: ${error.javaClass.simpleName}: ${error.message}")
        }
    }

    private fun analyze(image: ImageProxy) {
        try {
            if (closed.get()) return
            val planes = image.planes.map { plane ->
                RawCameraPlane(
                    bytes = plane.buffer.copyRemainingBytes(),
                    rowStride = plane.rowStride,
                    pixelStride = plane.pixelStride,
                )
            }
            frameListener.onFrame(
                RawCameraFrame(
                    width = image.width,
                    height = image.height,
                    rotationDegrees = image.imageInfo.rotationDegrees,
                    timestampNs = image.imageInfo.timestamp,
                    planes = planes,
                ),
            )
        } catch (error: Exception) {
            Diagnostics.log("stream frame failed: ${error.javaClass.simpleName}: ${error.message}")
        } finally {
            image.close()
        }
    }

    private fun ByteBuffer.copyRemainingBytes(): ByteArray {
        val copy = duplicate()
        val bytes = ByteArray(copy.remaining())
        copy.get(bytes)
        return bytes
    }
}
