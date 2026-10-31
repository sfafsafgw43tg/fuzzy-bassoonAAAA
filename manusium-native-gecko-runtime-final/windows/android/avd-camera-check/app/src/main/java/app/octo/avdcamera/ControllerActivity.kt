package app.octo.avdcamera

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.VideoView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.io.FileOutputStream
import java.util.Locale

/**
 * Device-side media controller. It does not pretend to be a Camera2 HAL. It
 * stores the selected media in the app sandbox so the host can retrieve it
 * with `adb shell run-as` and relaunch the emulator with imagefile:/videofile:.
 */
class ControllerActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var previewImage: ImageView
    private lateinit var previewVideo: VideoView
    private val selectionFile get() = File(filesDir, "selection.json")
    private val mediaFile get() = File(filesDir, "selected-media")

    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) saveSelection(uri)
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        setContentView(buildView())
        restoreSelection()
    }

    private fun buildView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
        }
        val title = TextView(this).apply {
            text = "Octo Camera Controller"
            textSize = 24f
            setGravity(Gravity.CENTER_HORIZONTAL)
        }
        status = TextView(this).apply {
            text = "Choose a photo or video for the emulator camera."
            textSize = 16f
            setPadding(0, 20, 0, 20)
        }
        previewImage = ImageView(this).apply {
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
            visibility = View.GONE
        }
        previewVideo = VideoView(this).apply {
            visibility = View.GONE
            setOnPreparedListener { it.isLooping = true }
        }
        val photo = Button(this).apply {
            text = "Choose photo"
            setOnClickListener { picker.launch(arrayOf("image/png", "image/jpeg")) }
        }
        val video = Button(this).apply {
            text = "Choose video"
            setOnClickListener { picker.launch(arrayOf("video/mp4", "video/*")) }
        }
        val clear = Button(this).apply {
            text = "Clear selection"
            setOnClickListener { clearSelection() }
        }
        root.addView(title)
        root.addView(status)
        root.addView(previewImage, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(previewVideo, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(photo)
        root.addView(video)
        root.addView(clear)
        return root
    }

    private fun saveSelection(uri: Uri) {
        try {
            val mime = contentResolver.getType(uri).orEmpty()
            val type = if (mime.startsWith("video/")) "video" else "photo"
            val extension = if (type == "video") "mp4" else if (mime.contains("png")) "png" else "jpg"
            contentResolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "The selected media could not be opened." }
                FileOutputStream(mediaFile).use { output -> input.copyTo(output) }
            }
            val displayName = queryName(uri)
            selectionFile.writeText("{\"type\":\"$type\",\"file\":\"selected-media\",\"extension\":\"$extension\",\"name\":\"${escape(displayName)}\"}\n")
            showSelection(type, displayName)
        } catch (error: Exception) {
            status.text = "Selection failed: ${error.message ?: "unknown error"}"
        }
    }

    private fun restoreSelection() {
        if (!selectionFile.exists() || !mediaFile.exists()) return
        val type = if (selectionFile.readText().contains("\"type\":\"video\"")) "video" else "photo"
        showSelection(type, "previous selection")
    }

    private fun showSelection(type: String, name: String) {
        status.text = "Selected $type: $name\nOctoSuite can sync this selection to the host and restart the emulator camera."
        if (type == "video") {
            previewImage.visibility = View.GONE
            previewVideo.visibility = View.VISIBLE
            previewVideo.setVideoURI(Uri.fromFile(mediaFile))
            previewVideo.start()
        } else {
            previewVideo.stopPlayback()
            previewVideo.visibility = View.GONE
            previewImage.visibility = View.VISIBLE
            previewImage.setImageURI(Uri.fromFile(mediaFile))
        }
    }

    private fun clearSelection() {
        selectionFile.delete()
        mediaFile.delete()
        previewVideo.stopPlayback()
        previewVideo.visibility = View.GONE
        previewImage.setImageDrawable(null)
        previewImage.visibility = View.GONE
        status.text = "Choose a photo or video for the emulator camera."
    }

    private fun queryName(uri: Uri): String = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else "selected media"
    } ?: "selected media"

    private fun escape(value: String): String = value.replace("\\", "\\\\").replace("\"", "\\\"")
}
