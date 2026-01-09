// Recordings API Routes
// Handles syncing recordings from iOS app and managing transcripts

import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { verifyAuth } from "./middleware/auth";

const router = Router();

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

export default router;

