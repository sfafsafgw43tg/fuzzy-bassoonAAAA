package app.octo.avdcamera

import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Device-side live receiver for Realme 12 Pro Studio / Unity Capture.
 *
 * OctoSuite creates an ADB reverse tunnel and passes the local stream port in
 * the launch intent. This activity connects automatically to the host MJPEG
 * stream, renders the received frames, and reports frame health. It does not
 * claim to create an Android Camera2/HAL device; ordinary APKs cannot do that.
 */
class ControllerActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var sourceStatus: TextView
    private lateinit var endpointStatus: TextView
    private lateinit var frameInfo: TextView
    private lateinit var preview: ImageView
    private lateinit var emptyPreview: TextView
    private lateinit var reconnect: Button
    private lateinit var pauseButton: Button
    private lateinit var fitButton: Button
    private lateinit var portInput: EditText
    private val main = Handler(Looper.getMainLooper())
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private val sourcePoller: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val connecting = AtomicBoolean(false)
    private val closing = AtomicBoolean(false)
    private var streamPort = 8765
    private var frameCount = 0L
    private var connectedAt = 0L
    @Volatile private var lastSourceVersion = -1L
    @Volatile private var paused = false
    @Volatile private var fitCrop = false
    @Volatile private var activeConnection: HttpURLConnection? = null

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        streamPort = intent.getIntExtra(EXTRA_STREAM_PORT, 8765).coerceIn(1, 65535)
        setContentView(buildView())
        connect()
        sourcePoller.scheduleWithFixedDelay({ pollSourceVersion() }, 0, SOURCE_POLL_SECONDS, TimeUnit.SECONDS)
    }

    private fun buildView(): ScrollView {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.rgb(246, 247, 251))
            isFillViewport = true
            contentDescription = "Realme 12 Pro Studio live camera receiver"
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(28))
        }

        val header = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        val mark = TextView(this).apply {
            text = "O"
            textSize = 25f
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            background = rounded(Color.rgb(91, 74, 214), 18)
            contentDescription = "OctoSuite"
        }
        header.addView(mark, LinearLayout.LayoutParams(dp(54), dp(54)))
        val heading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), 0, 0, 0)
        }
        heading.addView(label("Realme 12 Pro Studio", 22f, Color.rgb(25, 27, 38), true))
        heading.addView(label("Live Unity Capture receiver", 14f, Color.rgb(92, 96, 112), false))
        header.addView(heading, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(header)
        root.addView(space(18))

        val connection = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(15), dp(16), dp(15))
            background = rounded(Color.WHITE, 16)
            elevation = dp(2).toFloat()
        }
        val connectionTitle = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        val dot = TextView(this).apply {
            text = "●"
            textSize = 18f
            setTextColor(Color.rgb(214, 148, 25))
            contentDescription = "Connection status"
        }
        connectionTitle.addView(dot, LinearLayout.LayoutParams(dp(24), -2))
        sourceStatus = label("Connecting to vStudio stream…", 16f, Color.rgb(26, 29, 43), true)
        connectionTitle.addView(sourceStatus, LinearLayout.LayoutParams(0, -2, 1f))
        connection.addView(connectionTitle)
        endpointStatus = label("ADB reverse tunnel  •  127.0.0.1:$streamPort/mjpeg", 13f, Color.rgb(87, 91, 108), false)
        connection.addView(endpointStatus)
        frameInfo = label("Waiting for the first frame", 13f, Color.rgb(87, 91, 108), false)
        frameInfo.setPadding(0, dp(8), 0, 0)
        connection.addView(frameInfo)
        root.addView(connection)
        root.addView(space(16))

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = rounded(Color.WHITE, 16)
        }
        controls.addView(label("MJPEG stream controls", 16f, Color.rgb(26, 29, 43), true))
        controls.addView(label("These controls affect this receiver preview only. The Android system Camera uses the emulator's native imagefile/videofile source.", 13f, Color.rgb(87, 91, 108), false).apply {
            setPadding(0, dp(5), 0, dp(10))
        })
        val portRow = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        portInput = EditText(this).apply {
            setText(streamPort.toString())
            hint = "Port"
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
            setSelectAllOnFocus(true)
            contentDescription = "MJPEG server port"
        }
        portRow.addView(portInput, LinearLayout.LayoutParams(0, dp(50), 1f))
        reconnect = Button(this).apply {
            text = "Connect"
            isAllCaps = false
            minHeight = dp(50)
            setTextColor(Color.rgb(48, 42, 116))
            background = rounded(Color.rgb(235, 233, 255), 12)
            setOnClickListener { reconnectToEnteredPort() }
            contentDescription = "Connect to the MJPEG server port"
        }
        portRow.addView(reconnect, LinearLayout.LayoutParams(dp(112), dp(50)))
        controls.addView(portRow)
        val actionRow = LinearLayout(this).apply {
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        pauseButton = Button(this).apply {
            text = "Pause preview"
            isAllCaps = false
            setOnClickListener { togglePause() }
            contentDescription = "Pause or resume MJPEG preview rendering"
        }
        actionRow.addView(pauseButton, LinearLayout.LayoutParams(0, dp(50), 1f))
        fitButton = Button(this).apply {
            text = "Fit: contain"
            isAllCaps = false
            setOnClickListener { toggleFit() }
            contentDescription = "Toggle image contain or crop mode"
        }
        actionRow.addView(fitButton, LinearLayout.LayoutParams(0, dp(50), 1f))
        controls.addView(actionRow)
        root.addView(controls)
        root.addView(space(16))

        val previewCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = rounded(Color.WHITE, 16)
        }
        previewCard.addView(label("Live camera preview", 16f, Color.rgb(26, 29, 43), true))
        previewCard.addView(label("Frames received from the host Realme 12 Pro Studio producer", 13f, Color.rgb(87, 91, 108), false).apply {
            setPadding(0, dp(5), 0, dp(12))
        })
        val previewFrame = FrameLayout(this).apply {
            background = rounded(Color.rgb(239, 240, 247), 14)
            minimumHeight = dp(280)
            contentDescription = "Live Unity Capture frame preview"
        }
        preview = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "Current Unity Capture camera frame"
        }
        previewFrame.addView(preview, FrameLayout.LayoutParams(-1, -1))
        emptyPreview = label("Waiting for Unity Capture frames…", 14f, Color.rgb(105, 108, 124), false).apply {
            gravity = android.view.Gravity.CENTER
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }
        previewFrame.addView(emptyPreview, FrameLayout.LayoutParams(-1, -1))
        previewCard.addView(previewFrame)
        root.addView(previewCard)
        root.addView(space(14))

        val note = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = rounded(Color.rgb(234, 232, 252), 14)
        }
        note.addView(label("Connection model", 14f, Color.rgb(57, 45, 130), true))
        note.addView(label("OctoSuite sends the stream through an ADB reverse tunnel. This APK displays the live frames and verifies the bridge. It cannot create a system Camera2 device for Chrome or another unrelated Android app; that still requires the emulator's native camera HAL.", 13f, Color.rgb(57, 45, 130), false).apply {
            setPadding(0, dp(6), 0, 0)
        })
        root.addView(note)
        scroll.addView(root)
        return scroll
    }

    private fun reconnectToEnteredPort() {
        val requested = portInput.text.toString().trim().toIntOrNull()
        if (requested == null || requested !in 1..65535) {
            frameInfo.text = "Enter a valid port from 1 to 65535"
            return
        }
        streamPort = requested
        endpointStatus.text = "ADB reverse tunnel  •  127.0.0.1:$streamPort/mjpeg"
        activeConnection?.disconnect()
        main.postDelayed({ if (!closing.get()) connect() }, 500)
    }

    private fun togglePause() {
        paused = !paused
        pauseButton.text = if (paused) "Resume preview" else "Pause preview"
        frameInfo.text = if (paused) "Stream connected • preview rendering paused" else "Preview rendering resumed"
    }

    private fun toggleFit() {
        fitCrop = !fitCrop
        preview.scaleType = if (fitCrop) ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER
        fitButton.text = if (fitCrop) "Fit: crop" else "Fit: contain"
    }

    private fun connect() {
        if (!connecting.compareAndSet(false, true) || closing.get()) return
        main.post {
            sourceStatus.text = "Connecting to vStudio stream…"
            sourceStatus.setTextColor(Color.rgb(26, 29, 43))
            reconnect.isEnabled = false
        }
        worker.execute {
            var connection: HttpURLConnection? = null
            try {
                connection = (URL("http://127.0.0.1:$streamPort/mjpeg").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 2500
                    readTimeout = 0
                    requestMethod = "GET"
                    setRequestProperty("Cache-Control", "no-cache")
                    connect()
                }
                activeConnection = connection
                if (connection.responseCode != HttpURLConnection.HTTP_OK) throw IllegalStateException("HTTP ${connection.responseCode}")
                connectedAt = System.currentTimeMillis()
                Log.i(TAG, "stream-connected port=$streamPort")
                main.post { sourceStatus.text = "Connected to vStudio MJPEG stream"; sourceStatus.setTextColor(Color.rgb(24, 155, 92)) }
                readMultipart(connection.inputStream)
            } catch (error: Exception) {
                Log.e(TAG, "stream-error", error)
                if (!closing.get()) {
                    main.post {
                        sourceStatus.text = "Waiting for vStudio stream"
                        sourceStatus.setTextColor(Color.rgb(190, 54, 70))
                        frameInfo.text = "Reconnect failed: ${error.message ?: "stream unavailable"}"
                    }
                    main.postDelayed({ connect() }, 1500)
                }
            } finally {
                connection?.disconnect()
                if (activeConnection === connection) activeConnection = null
                connecting.set(false)
                main.post { reconnect.isEnabled = true }
            }
        }
    }

    /** Poll the producer every three seconds so source changes are explicit in the receiver UI. */
    private fun pollSourceVersion() {
        if (closing.get()) return
        var connection: HttpURLConnection? = null
        try {
            connection = (URL("http://127.0.0.1:$streamPort/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = 1200
                readTimeout = 1200
                requestMethod = "GET"
                setRequestProperty("Cache-Control", "no-cache")
                connect()
            }
            if (connection.responseCode != HttpURLConnection.HTTP_OK) return
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val version = Regex("\\\"frameVersion\\\"\\s*:\\s*(\\d+)").find(body)?.groupValues?.get(1)?.toLongOrNull() ?: return
            if (lastSourceVersion >= 0L && version > lastSourceVersion) {
                Log.i(TAG, "source-image-changed frameVersion=$version")
                main.post {
                    if (!closing.get()) {
                        frameInfo.text = "Selected vStudio image updated • live frame $version"
                        sourceStatus.text = "Connected • selected image updated"
                        sourceStatus.setTextColor(Color.rgb(24, 155, 92))
                    }
                }
            }
            lastSourceVersion = version
        } catch (error: Exception) {
            if (!closing.get()) Log.d(TAG, "source-health-unavailable", error)
        } finally {
            connection?.disconnect()
        }
    }

    private fun readMultipart(input: java.io.InputStream) {
        val stream = BufferedInputStream(input)
        while (!closing.get()) {
            val header = readUntil(stream, "\r\n\r\n".toByteArray()) ?: return
            val length = Regex("(?im)^Content-Length:\\s*(\\d+)").find(String(header, Charsets.ISO_8859_1))?.groupValues?.get(1)?.toIntOrNull() ?: return
            if (length <= 0 || length > 8 * 1024 * 1024) return
            val bytes = ByteArray(length)
            stream.readFully(bytes)
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: continue
            main.post { render(bitmap) }
            readUntil(stream, "\r\n".toByteArray()) ?: return
        }
    }

    private fun render(bitmap: android.graphics.Bitmap) {
        if (closing.get()) { bitmap.recycle(); return }
        if (paused) { bitmap.recycle(); return }
        preview.setImageBitmap(bitmap)
        emptyPreview.visibility = android.view.View.GONE
        frameCount += 1
        if (frameCount == 1L || frameCount % 30L == 0L) Log.i(TAG, "frame-received count=$frameCount")
        val elapsed = ((System.currentTimeMillis() - connectedAt).coerceAtLeast(1)) / 1000.0
        frameInfo.text = "Receiving frame $frameCount  •  ${String.format("%.1f", frameCount / elapsed)} fps"
    }

    private fun readUntil(input: BufferedInputStream, marker: ByteArray): ByteArray? {
        val output = ByteArrayOutputStream()
        var matched = 0
        while (!closing.get()) {
            val value = input.read()
            if (value < 0) return null
            output.write(value)
            if (value == marker[matched].toInt()) {
                matched += 1
                if (matched == marker.size) return output.toByteArray()
            } else matched = if (value == marker[0].toInt()) 1 else 0
            if (output.size() > 64 * 1024) return null
        }
        return null
    }

    private fun java.io.InputStream.readFully(buffer: ByteArray) {
        var offset = 0
        while (offset < buffer.size) {
            val count = read(buffer, offset, buffer.size - offset)
            if (count < 0) throw java.io.EOFException("stream ended")
            offset += count
        }
    }

    override fun onDestroy() {
        closing.set(true)
        activeConnection?.disconnect()
        main.removeCallbacksAndMessages(null)
        worker.shutdownNow()
        sourcePoller.shutdownNow()
        super.onDestroy()
    }

    private fun label(text: String, size: Float, color: Int, bold: Boolean): TextView = TextView(this).apply {
        this.text = text
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun rounded(color: Int, radiusDp: Int): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
    }

    private fun space(height: Int): android.view.View = android.view.View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(height))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val TAG = "OctoLiveReceiver"
        private const val SOURCE_POLL_SECONDS = 3L
        const val EXTRA_STREAM_PORT = "octo_stream_port"
    }
}
