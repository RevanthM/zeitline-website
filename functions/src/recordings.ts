// Recordings API Routes
// Handles syncing recordings from iOS app and managing transcripts

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { verifyAuth } from "./middleware/auth";
import OpenAI from "openai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const router = Router();

// Initialize OpenAI client
const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }
  return new OpenAI({ apiKey });
};

// Get all recordings for a user
router.get("/", verifyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.uid;
    const db = admin.firestore();

    const snapshot = await db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .orderBy("recordedAt", "desc")
      .limit(100)
      .get();

    const recordings = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      recordedAt: doc.data().recordedAt?.toDate?.()?.toISOString() || null,
    }));

    res.json({
      success: true,
      data: recordings,
      count: recordings.length,
    });
  } catch (error: any) {
    console.error("Error fetching recordings:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch recordings",
    });
  }
});

// Get a single recording
router.get("/:recordingId", verifyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.uid;
    const { recordingId } = req.params;
    const db = admin.firestore();

    const doc = await db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .doc(recordingId)
      .get();

    if (!doc.exists) {
      res.status(404).json({
        success: false,
        error: "Recording not found",
      });
      return;
    }

    const data = doc.data();
    res.json({
      success: true,
      data: {
        id: doc.id,
        ...data,
        recordedAt: data?.recordedAt?.toDate?.()?.toISOString() || null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching recording:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch recording",
    });
  }
});

// Create a new recording (from iOS app sync)
router.post("/", verifyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.uid;
    const {
      filename,
      recordedAt,
      duration,
      fileSize,
      transcript,
      audioUrl,
      watchFilename,
    } = req.body;

    if (!filename) {
      res.status(400).json({
        success: false,
        error: "Filename is required",
      });
      return;
    }

    const db = admin.firestore();

    const recordingData = {
      filename,
      recordedAt: recordedAt ? admin.firestore.Timestamp.fromDate(new Date(recordedAt)) : admin.firestore.Timestamp.now(),
      duration: duration || 0,
      fileSize: fileSize || 0,
      transcript: transcript || null,
      audioUrl: audioUrl || null,
      watchFilename: watchFilename || filename,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
      isTranscribing: false,
    };

    const docRef = await db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .add(recordingData);

    res.status(201).json({
      success: true,
      data: {
        id: docRef.id,
        ...recordingData,
        recordedAt: recordingData.recordedAt.toDate().toISOString(),
        createdAt: recordingData.createdAt.toDate().toISOString(),
        updatedAt: recordingData.updatedAt.toDate().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("Error creating recording:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create recording",
    });
  }
});

// Update a recording (e.g., add transcript)
router.patch("/:recordingId", verifyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.uid;
    const { recordingId } = req.params;
    const updates = req.body;

    const db = admin.firestore();

    // Only allow certain fields to be updated
    const allowedFields = ["transcript", "isTranscribing", "audioUrl"];
    const filteredUpdates: any = {
      updatedAt: admin.firestore.Timestamp.now(),
    };

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    await db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .doc(recordingId)
      .update(filteredUpdates);

    res.json({
      success: true,
      message: "Recording updated successfully",
    });
  } catch (error: any) {
    console.error("Error updating recording:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update recording",
    });
  }
});

// Delete a recording
router.delete("/:recordingId", verifyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.uid;
    const { recordingId } = req.params;
    const db = admin.firestore();

    // Get the recording first to check if it exists and get the file URL
    const doc = await db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .doc(recordingId)
      .get();

    if (!doc.exists) {
      res.status(404).json({
        success: false,
        error: "Recording not found",
      });
      return;
    }

    const data = doc.data();

    // Delete the audio file from Storage if it exists
    if (data?.audioUrl) {
      try {
        const storage = admin.storage();
        const bucket = storage.bucket();
        const filePath = `recordings/${userId}/${data.filename}`;
        await bucket.file(filePath).delete();
      } catch (storageError) {
        console.warn("Could not delete audio file:", storageError);
        // Continue with Firestore deletion even if Storage deletion fails
      }
    }

    // Delete from Firestore
    await db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .doc(recordingId)
      .delete();

    res.json({
      success: true,
      message: "Recording deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting recording:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete recording",
    });
  }
});

// Batch sync recordings (from iOS app)
router.post("/sync", verifyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.uid;
    const { recordings } = req.body;

    if (!Array.isArray(recordings)) {
      res.status(400).json({
        success: false,
        error: "Recordings array is required",
      });
      return;
    }

    const db = admin.firestore();
    const batch = db.batch();
    const results: any[] = [];

    for (const recording of recordings) {
      // Check if recording already exists by watchFilename
      const existingQuery = await db
        .collection("users")
        .doc(userId)
        .collection("recordings")
        .where("watchFilename", "==", recording.watchFilename || recording.filename)
        .limit(1)
        .get();

      if (existingQuery.empty) {
        // Create new recording
        const docRef = db
          .collection("users")
          .doc(userId)
          .collection("recordings")
          .doc();

        const recordingData = {
          filename: recording.filename,
          recordedAt: recording.recordedAt
            ? admin.firestore.Timestamp.fromDate(new Date(recording.recordedAt))
            : admin.firestore.Timestamp.now(),
          duration: recording.duration || 0,
          fileSize: recording.fileSize || 0,
          transcript: recording.transcript || null,
          audioUrl: recording.audioUrl || null,
          watchFilename: recording.watchFilename || recording.filename,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
          isTranscribing: false,
        };

        batch.set(docRef, recordingData);
        results.push({ id: docRef.id, status: "created" });
      } else {
        // Update existing recording if transcript is provided
        const existingDoc = existingQuery.docs[0];
        if (recording.transcript && !existingDoc.data().transcript) {
          batch.update(existingDoc.ref, {
            transcript: recording.transcript,
            updatedAt: admin.firestore.Timestamp.now(),
          });
          results.push({ id: existingDoc.id, status: "updated" });
        } else {
          results.push({ id: existingDoc.id, status: "skipped" });
        }
      }
    }

    await batch.commit();

    res.json({
      success: true,
      message: `Synced ${results.length} recordings`,
      data: results,
    });
  } catch (error: any) {
    console.error("Error syncing recordings:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to sync recordings",
    });
  }
});

// Get recording stats
router.get("/stats/summary", verifyAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.uid;
    const db = admin.firestore();

    const snapshot = await db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .get();

    let totalRecordings = 0;
    let totalDuration = 0;
    let transcribedCount = 0;
    let totalSize = 0;

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      totalRecordings++;
      totalDuration += data.duration || 0;
      totalSize += data.fileSize || 0;
      if (data.transcript) {
        transcribedCount++;
      }
    });

    res.json({
      success: true,
      data: {
        totalRecordings,
        totalDuration,
        transcribedCount,
        pendingCount: totalRecordings - transcribedCount,
        totalSize,
      },
    });
  } catch (error: any) {
    console.error("Error fetching recording stats:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch recording stats",
    });
  }
});

// ============================================
// WHISPER TRANSCRIPTION ENDPOINTS
// ============================================

/**
 * Transcribe a recording using OpenAI Whisper API
 * This provides much better accuracy than Apple's SFSpeechRecognizer
 * 
 * POST /recordings/:recordingId/transcribe
 */
router.post("/:recordingId/transcribe", verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.uid;
  const { recordingId } = req.params;
  const { forceRetranscribe = false } = req.body;

  console.log(`🎤 Transcription request for recording ${recordingId} by user ${userId}`);

  try {
    const db = admin.firestore();
    const recordingRef = db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .doc(recordingId);

    // Get the recording document
    const recordingDoc = await recordingRef.get();
    if (!recordingDoc.exists) {
      res.status(404).json({
        success: false,
        error: "Recording not found",
      });
      return;
    }

    const recordingData = recordingDoc.data()!;

    // Check if already transcribed (unless forced)
    if (recordingData.transcript && !forceRetranscribe) {
      console.log(`Recording ${recordingId} already has transcript, skipping`);
      res.json({
        success: true,
        data: {
          transcript: recordingData.transcript,
          cached: true,
        },
      });
      return;
    }

    // Get the audio URL
    const audioUrl = recordingData.audioUrl;
    if (!audioUrl) {
      res.status(400).json({
        success: false,
        error: "No audio file available for this recording. Please sync from the iOS app first.",
      });
      return;
    }

    // Mark as transcribing
    await recordingRef.update({
      isTranscribing: true,
      updatedAt: admin.firestore.Timestamp.now(),
    });

    console.log(`📥 Downloading audio from: ${audioUrl.substring(0, 80)}...`);

    // Download the audio file to temp storage
    const tempFilePath = await downloadAudioFile(audioUrl, recordingData.filename);
    
    console.log(`✅ Audio downloaded to: ${tempFilePath}`);

    // Transcribe using Whisper
    const transcript = await transcribeWithWhisper(tempFilePath);

    // Clean up temp file
    try {
      fs.unlinkSync(tempFilePath);
    } catch (e) {
      console.warn("Could not delete temp file:", e);
    }

    // Handle empty transcription
    if (!transcript || transcript.trim().length === 0) {
      await recordingRef.update({
        transcript: "[No speech detected - audio may be silent or corrupted]",
        isTranscribing: false,
        transcribedAt: admin.firestore.Timestamp.now(),
        transcriptionModel: "whisper-1",
        updatedAt: admin.firestore.Timestamp.now(),
      });

      res.json({
        success: true,
        data: {
          transcript: "[No speech detected - audio may be silent or corrupted]",
          model: "whisper-1",
        },
      });
      return;
    }

    // Update the recording with the transcript
    await recordingRef.update({
      transcript: transcript,
      isTranscribing: false,
      transcribedAt: admin.firestore.Timestamp.now(),
      transcriptionModel: "whisper-1",
      updatedAt: admin.firestore.Timestamp.now(),
    });

    console.log(`✅ Transcription complete for ${recordingId}: ${transcript.substring(0, 100)}...`);

    res.json({
      success: true,
      data: {
        transcript: transcript,
        model: "whisper-1",
      },
    });

  } catch (error: any) {
    console.error("Transcription error:", error);

    // Update recording to mark transcription failed
    try {
      const db = admin.firestore();
      await db
        .collection("users")
        .doc(userId)
        .collection("recordings")
        .doc(recordingId)
        .update({
          isTranscribing: false,
          transcriptionError: error.message,
          updatedAt: admin.firestore.Timestamp.now(),
        });
    } catch (updateError) {
      console.error("Failed to update recording error status:", updateError);
    }

    res.status(500).json({
      success: false,
      error: error.message || "Transcription failed",
    });
  }
});

/**
 * Transcribe audio from a URL directly (without needing a recording document)
 * Useful for testing or transcribing audio from other sources
 * 
 * POST /recordings/transcribe-url
 */
router.post("/transcribe-url", verifyAuth, async (req: Request, res: Response) => {
  const { audioUrl } = req.body;

  if (!audioUrl) {
    res.status(400).json({
      success: false,
      error: "audioUrl is required",
    });
    return;
  }

  try {
    console.log(`🎤 Direct URL transcription request`);

    // Download the audio file
    const tempFilePath = await downloadAudioFile(audioUrl, "temp_audio.m4a");

    // Transcribe using Whisper
    const transcript = await transcribeWithWhisper(tempFilePath);

    // Clean up temp file
    try {
      fs.unlinkSync(tempFilePath);
    } catch (e) {
      console.warn("Could not delete temp file:", e);
    }

    res.json({
      success: true,
      data: {
        transcript: transcript || "[No speech detected]",
        model: "whisper-1",
      },
    });

  } catch (error: any) {
    console.error("Direct transcription error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Transcription failed",
    });
  }
});

/**
 * Batch transcribe multiple recordings that don't have transcripts
 * 
 * POST /recordings/transcribe-batch
 */
router.post("/transcribe-batch", verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.uid;
  const { limit = 5 } = req.body;

  try {
    const db = admin.firestore();

    // Find recordings without transcripts
    const snapshot = await db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .where("transcript", "==", null)
      .where("isTranscribing", "==", false)
      .limit(Math.min(limit, 10)) // Max 10 at a time
      .get();

    if (snapshot.empty) {
      res.json({
        success: true,
        message: "No recordings need transcription",
        data: { processed: 0 },
      });
      return;
    }

    console.log(`🎤 Batch transcribing ${snapshot.size} recordings for user ${userId}`);

    const results: any[] = [];
    for (const doc of snapshot.docs) {
      const recordingData = doc.data();
      
      if (!recordingData.audioUrl) {
        results.push({
          id: doc.id,
          status: "skipped",
          reason: "No audio URL",
        });
        continue;
      }

      try {
        // Mark as transcribing
        await doc.ref.update({
          isTranscribing: true,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // Download and transcribe
        const tempFilePath = await downloadAudioFile(recordingData.audioUrl, recordingData.filename);
        const transcript = await transcribeWithWhisper(tempFilePath);

        // Clean up temp file
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          console.warn("Could not delete temp file:", e);
        }

        // Update recording
        await doc.ref.update({
          transcript: transcript || "[No speech detected]",
          isTranscribing: false,
          transcribedAt: admin.firestore.Timestamp.now(),
          transcriptionModel: "whisper-1",
          updatedAt: admin.firestore.Timestamp.now(),
        });

        results.push({
          id: doc.id,
          status: "success",
          transcriptPreview: (transcript || "").substring(0, 100),
        });

      } catch (error: any) {
        console.error(`Failed to transcribe ${doc.id}:`, error);
        
        await doc.ref.update({
          isTranscribing: false,
          transcriptionError: error.message,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        results.push({
          id: doc.id,
          status: "error",
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      data: {
        processed: results.length,
        results,
      },
    });

  } catch (error: any) {
    console.error("Batch transcription error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Batch transcription failed",
    });
  }
});

/**
 * Convert a recording's audio from CAF to M4A (browser-compatible)
 * This is useful for old recordings that were uploaded in CAF format
 * 
 * POST /recordings/:recordingId/convert
 */
router.post("/:recordingId/convert", verifyAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.uid;
  const { recordingId } = req.params;

  console.log(`🔄 Audio conversion request for recording ${recordingId}`);

  try {
    const db = admin.firestore();
    const recordingRef = db
      .collection("users")
      .doc(userId)
      .collection("recordings")
      .doc(recordingId);

    const recordingDoc = await recordingRef.get();
    if (!recordingDoc.exists) {
      res.status(404).json({
        success: false,
        error: "Recording not found",
      });
      return;
    }

    const recordingData = recordingDoc.data()!;
    const audioUrl = recordingData.audioUrl;

    if (!audioUrl) {
      res.status(400).json({
        success: false,
        error: "No audio file available for this recording",
      });
      return;
    }

    // Check if already in M4A format
    if (audioUrl.includes('.m4a') && !audioUrl.includes('.caf')) {
      res.json({
        success: true,
        data: {
          audioUrl: audioUrl,
          message: "Audio is already in M4A format",
          converted: false,
        },
      });
      return;
    }

    // For CAF files, we need to re-sync from the iOS app
    // Cloud Functions don't have ffmpeg installed by default
    res.status(400).json({
      success: false,
      error: "Audio is in CAF format which requires conversion. Please re-sync this recording from the iPhone app to convert it to a browser-compatible format.",
      format: "caf",
      suggestion: "Re-sync from iPhone app",
    });

  } catch (error: any) {
    console.error("Audio conversion error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Conversion failed",
    });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Download audio file from URL to temp storage
 */
async function downloadAudioFile(url: string, filename: string): Promise<string> {
  const tempDir = os.tmpdir();
  
  // Try to get extension from URL first (more reliable), then filename
  let ext = ".m4a"; // default
  
  // Check URL for extension
  const urlPath = new URL(url).pathname;
  const urlExt = path.extname(urlPath);
  if (urlExt && [".m4a", ".wav", ".mp3", ".mp4", ".ogg", ".flac", ".webm"].includes(urlExt.toLowerCase())) {
    ext = urlExt.toLowerCase();
  } else if (filename) {
    const filenameExt = path.extname(filename);
    if (filenameExt) {
      ext = filenameExt.toLowerCase();
    }
  }
  
  // Map CAF to WAV since Whisper doesn't support CAF
  if (ext === ".caf") {
    console.log("⚠️ CAF format detected, this may not transcribe properly");
    ext = ".caf"; // Keep as-is but warn
  }
  
  const tempFilePath = path.join(tempDir, `audio_${Date.now()}${ext}`);

  console.log(`📥 Downloading audio from ${url.substring(0, 80)}...`);
  console.log(`   Extension: ${ext}, Target: ${tempFilePath}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
  }

  // Convert response to buffer using arrayBuffer (native fetch)
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(tempFilePath, buffer);

  const stats = fs.statSync(tempFilePath);
  console.log(`✅ Downloaded ${stats.size} bytes to ${tempFilePath}`);

  return tempFilePath;
}

/**
 * Transcribe audio file using OpenAI Whisper API
 * Supported formats: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm
 */
async function transcribeWithWhisper(filePath: string): Promise<string> {
  const openai = getOpenAIClient();

  const fileExt = path.extname(filePath).toLowerCase();
  const supportedFormats = [".flac", ".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".ogg", ".wav", ".webm"];
  
  console.log(`🎤 Transcribing with Whisper: ${filePath}`);
  console.log(`   File extension: ${fileExt}`);

  // Warn if format might not be supported
  if (!supportedFormats.includes(fileExt)) {
    console.log(`⚠️ Format ${fileExt} may not be supported by Whisper. Supported: ${supportedFormats.join(", ")}`);
  }

  // Check file exists and has content
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error("Audio file is empty");
  }

  console.log(`   File size: ${stats.size} bytes`);

  // Minimum file size check (very short files might fail)
  if (stats.size < 1000) {
    console.log(`⚠️ File is very small (${stats.size} bytes), may not contain enough audio`);
  }

  // Create a readable stream for the file
  const fileStream = fs.createReadStream(filePath);

  try {
    const response = await openai.audio.transcriptions.create({
      file: fileStream,
      model: "whisper-1",
      language: "en", // Can be made dynamic based on user preferences
      response_format: "text",
      // Prompt helps with accuracy for specific domain vocabulary
      prompt: "This is a voice memo or conversation recording. It may contain names, dates, tasks, meetings, and personal notes.",
    });

    const transcript = typeof response === "string" ? response : (response as any).text || "";
    
    if (transcript && transcript.trim().length > 0) {
      console.log(`✅ Whisper transcription complete: "${transcript.substring(0, 100)}..."`);
    } else {
      console.log(`⚠️ Whisper returned empty transcript for ${fileExt} file of ${stats.size} bytes`);
    }

    return transcript;

  } catch (error: any) {
    console.error("❌ Whisper API error:", error.message || error);

    // Check for specific error types
    if (error.message?.includes("Invalid file format") || error.message?.includes("could not be decoded")) {
      throw new Error(`Invalid audio format (${fileExt}). Whisper supports: ${supportedFormats.join(", ")}`);
    }

    if (error.message?.includes("File is too short") || error.message?.includes("too short")) {
      throw new Error("Audio file is too short for transcription (minimum ~0.1 seconds needed)");
    }
    
    if (error.message?.includes("Could not process audio")) {
      throw new Error(`Could not process audio file. The file may be corrupted or in an unsupported format (${fileExt})`);
    }

    throw error;
  }
}

export default router;

