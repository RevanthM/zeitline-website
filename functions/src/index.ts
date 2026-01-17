// Load environment variables from .env file (for local development)
if (process.env.NODE_ENV !== "production") {
  try {
    require("dotenv").config();
  } catch (e) {
    // dotenv not available, continue without it
  }
}

import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

// Initialize Firebase Admin
// Check if we're running in the emulator
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || 
                   process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
                   process.env.FIRESTORE_EMULATOR_HOST !== undefined;

if (isEmulator) {
  console.log("Initializing Firebase Admin SDK for emulator");
  
  // Set Firestore emulator host if not set
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  }
  
  // Initialize Admin SDK with explicit credentials for production token verification
  if (!admin.apps.length) {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "zeitlineai";
    let credential = null;
    
    // Try to use service account key file first (most reliable)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      try {
        credential = admin.credential.cert(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        console.log("✅ Using service account key from GOOGLE_APPLICATION_CREDENTIALS");
      } catch (e: any) {
        console.warn("⚠️ Could not load service account key:", e.message);
      }
    }
    
    // Fallback to application default credentials
    if (!credential) {
      try {
        credential = admin.credential.applicationDefault();
        console.log("✅ Using application default credentials");
      } catch (credError: any) {
        console.warn("⚠️ Could not load application default credentials:", credError.message);
      }
    }
    
    // Initialize with credentials if available
    if (credential) {
      admin.initializeApp({
        projectId: projectId,
        credential: credential,
      });
      console.log("✅ Admin SDK initialized with credentials for project:", projectId);
    } else {
      // Last resort: initialize without credentials (won't work for production tokens)
      console.warn("⚠️ Initializing Admin SDK without credentials - token verification will fail");
      admin.initializeApp({
        projectId: projectId,
      });
    }
    
    // Configure Firestore to use emulator
    const db = admin.firestore();
    db.settings({
      host: process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080",
      ssl: false,
    });
    console.log("✅ Firestore configured for emulator");
  }
} else {
  // Production initialization
  if (!admin.apps.length) {
    admin.initializeApp();
  }
}

// Import routes
import usersRouter from "./users";
import stripeRouter from "./stripe";
import calendarsRouter from "./calendars";
import aiAssistantRouter from "./ai-assistant";
import nutritionRouter from "./nutrition";
import onboardingChatRouter from "./onboarding-chat";
import recordingsRouter from "./recordings";
import taskExtractionRouter from "./task-extraction";

// Import for file system operations
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Helper function to transcribe audio with Whisper API (for use in Firestore triggers)
 */
async function transcribeWithWhisperFromTrigger(audioUrl: string, filename: string): Promise<string> {
  const { OpenAI } = await import("openai");
  
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }
  
  console.log(`🎤 Downloading audio for Whisper transcription: ${filename}`);
  console.log(`   Audio URL: ${audioUrl.substring(0, 100)}...`);
  
  // Download the audio file
  const tempDir = os.tmpdir();
  
  // Determine file extension from multiple sources (prioritize URL over filename)
  // The URL should have the correct extension since iPhone converts CAF to M4A/WAV before upload
  let ext = ".m4a"; // default fallback
  
  // First, try to get extension from URL (most reliable after conversion)
  try {
    const decodedUrl = decodeURIComponent(audioUrl);
    const urlPath = new URL(decodedUrl).pathname;
    const urlFilename = urlPath.split("/").pop() || "";
    const urlExt = path.extname(urlFilename).toLowerCase();
    
    console.log(`   URL filename: ${urlFilename}, extension: ${urlExt}`);
    
    const supportedFormats = [".m4a", ".wav", ".mp3", ".mp4", ".ogg", ".flac", ".webm", ".oga"];
    if (urlExt && supportedFormats.includes(urlExt)) {
      ext = urlExt;
      console.log(`   Using extension from URL: ${ext}`);
    } else if (urlExt === ".caf") {
      // CAF is not supported by Whisper - but the URL might still have .caf if conversion failed
      // Check if there's an M4A or WAV version in the URL path
      console.log(`   ⚠️ CAF format detected in URL - this format is not supported by Whisper`);
      throw new Error("Invalid file format. The audio file is in CAF format which is not supported by Whisper. The iPhone app should convert CAF to M4A or WAV before uploading. Please re-sync this recording from the iPhone app. Supported formats: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm");
    }
  } catch (e) {
    if ((e as Error).message?.includes("Invalid file format")) {
      throw e; // Re-throw the CAF format error
    }
    console.log(`   Could not parse URL for extension: ${e}`);
  }
  
  // Fallback to filename extension only if URL didn't provide one AND it's not .caf
  if (ext === ".m4a") {
    const filenameExt = path.extname(filename).toLowerCase();
    if (filenameExt && filenameExt !== ".caf") {
      ext = filenameExt;
      console.log(`   Using extension from filename: ${ext}`);
    } else if (filenameExt === ".caf") {
      // The filename has .caf but we couldn't get a better extension from URL
      // This means the file might not have been converted properly
      console.log(`   ⚠️ Filename has .caf extension but URL didn't have a supported format`);
      console.log(`   Attempting to use .m4a as the URL may have been converted`);
      // Keep the default .m4a and hope the actual file content is correct
    }
  }
  
  console.log(`   Final extension: ${ext}`);
  
  const tempFilePath = path.join(tempDir, `audio_${Date.now()}${ext}`);
  
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(tempFilePath, buffer);
  
  const stats = fs.statSync(tempFilePath);
  console.log(`Downloaded ${stats.size} bytes to ${tempFilePath}`);
  
  if (stats.size === 0) {
    fs.unlinkSync(tempFilePath);
    throw new Error("Audio file is empty");
  }
  
  // Transcribe with Whisper
  const { toFile } = await import("openai");
  const openai = new OpenAI({ apiKey });
  
  try {
    // Read file as buffer and convert using toFile helper for OpenAI SDK v6+
    const fileBuffer = fs.readFileSync(tempFilePath);
    const filename = path.basename(tempFilePath);
    const fileExt = path.extname(tempFilePath).toLowerCase();
    
    // Map file extensions to MIME types for proper content-type handling
    const mimeTypes: Record<string, string> = {
      ".flac": "audio/flac",
      ".mp3": "audio/mpeg",
      ".mp4": "audio/mp4",
      ".mpeg": "audio/mpeg",
      ".mpga": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".ogg": "audio/ogg",
      ".oga": "audio/ogg",
      ".wav": "audio/wav",
      ".webm": "audio/webm",
    };
    const contentType = mimeTypes[fileExt] || "audio/mpeg";
    
    console.log(`   Using content type: ${contentType} for file: ${filename}`);
    
    const file = await toFile(fileBuffer, filename, { type: contentType });
    
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "en",
      response_format: "text",
      prompt: "This is a voice memo or conversation recording. It may contain names, dates, tasks, meetings, and personal notes.",
    });
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);
    
    return typeof transcription === "string" ? transcription : (transcription as any).text || "";
  } catch (error: any) {
    // Clean up temp file on error
    try {
      fs.unlinkSync(tempFilePath);
    } catch (e) {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// Create Express app
const app = express();

// Middleware - CORS must be first to handle preflight and errors
app.use(
  cors({
    origin: [
      'http://localhost:5500',
      'http://127.0.0.1:5500',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://zeitline.ai',
      'https://www.zeitline.ai',
      /\.firebaseapp\.com$/,
      /\.web\.app$/
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Type'],
  })
);

// Handle preflight requests explicitly
app.options('*', cors(), (req: Request, res: Response) => {
  res.sendStatus(200);
});

// Request logging middleware (for debugging)
app.use((req: Request, res: Response, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Parse JSON for all routes except Stripe webhook
app.use((req: Request, res: Response, next) => {
  if (req.path === "/stripe/webhook") {
    // Stripe webhook needs raw body for signature verification
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// Health check
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Mount routes - both with and without /api prefix
// Direct access (functions emulator): /users, /calendars, etc.
// Hosting rewrite access: /api/users, /api/calendars, etc.
app.use("/users", usersRouter);
app.use("/stripe", stripeRouter);
app.use("/calendars", calendarsRouter);
app.use("/ai-assistant", aiAssistantRouter);
app.use("/nutrition", nutritionRouter);
app.use("/onboarding", onboardingChatRouter);
app.use("/recordings", recordingsRouter);
app.use("/task-extraction", taskExtractionRouter);

// Also mount under /api for Firebase hosting rewrites
app.use("/api/users", usersRouter);
app.use("/api/stripe", stripeRouter);
app.use("/api/calendars", calendarsRouter);
app.use("/api/ai-assistant", aiAssistantRouter);
app.use("/api/nutrition", nutritionRouter);
app.use("/api/onboarding", onboardingChatRouter);
app.use("/api/recordings", recordingsRouter);
app.use("/api/task-extraction", taskExtractionRouter);

// Error handling middleware - must be before 404 handler
// Note: Express error handlers must have 4 parameters
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error:", err);
  // Ensure CORS headers are set even on errors
  res.status(err.status || 500).json({
    success: false,
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  console.log(`404: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: "Not found",
    path: req.path,
  });
});

// Export the Express app as a Cloud Function
export const api = functions.https.onRequest(app);

// Firebase Auth trigger - create user profile on signup
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  const db = admin.firestore();

  try {
    // Check if profile already exists (might be created by API)
    const existingProfile = await db.collection("users").doc(user.uid).get();
    if (existingProfile.exists) {
      console.log(`Profile already exists for user ${user.uid}`);
      return;
    }

    // Create minimal profile
    await db
      .collection("users")
      .doc(user.uid)
      .set({
        uid: user.uid,
        email: user.email || "",
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        plan: "free",
        onboardingComplete: false,
        onboardingStep: 1,
        personal: {
          fullName: user.displayName || "",
          age: 0,
          occupation: "",
          location: "",
          timezone: "",
          interests: [],
          lifeGoals: [],
          lifestyle: {
            morningPerson: true,
            workStyle: "",
            sleepHours: 8,
          },
        },
        financial: {
          salary: 0,
          netWorth: 0,
          currency: "USD",
          spendingCategories: [],
          financialGoals: [],
        },
      });

    console.log(`Created profile for new user ${user.uid}`);
  } catch (error) {
    console.error("Error creating user profile:", error);
  }
});

// Firebase Auth trigger - cleanup on user delete
export const onUserDelete = functions.auth.user().onDelete(async (user) => {
  const db = admin.firestore();

  try {
    // Delete user profile
    await db.collection("users").doc(user.uid).delete();

    // Delete user's subscriptions
    const subscriptions = await db
      .collection("subscriptions")
      .where("uid", "==", user.uid)
      .get();

    const batch = db.batch();
    subscriptions.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    console.log(`Cleaned up data for deleted user ${user.uid}`);
  } catch (error) {
    console.error("Error cleaning up user data:", error);
  }
});

// Firestore trigger - auto-transcribe and extract tasks when a new recording is created
export const onRecordingCreate = functions.firestore
  .document("users/{userId}/recordings/{recordingId}")
  .onCreate(async (snapshot, context) => {
    const { userId, recordingId } = context.params;
    let recordingData = snapshot.data();
    
    console.log(`New recording created: ${recordingId} for user ${userId}`);
    
    // Check if recording has a transcript
    let transcript = recordingData.transcript;
    
    // If no transcript but has audioUrl, try to transcribe with Whisper
    if ((!transcript || transcript.trim().length === 0) && recordingData.audioUrl) {
      console.log("No transcript but has audio URL - attempting Whisper transcription...");
      
      try {
        const transcriptionResult = await transcribeWithWhisperFromTrigger(
          recordingData.audioUrl,
          recordingData.filename || "audio.m4a"
        );
        
        if (transcriptionResult && transcriptionResult.trim().length > 0) {
          transcript = transcriptionResult;
          
          // Update the recording with the transcript
          await snapshot.ref.update({
            transcript: transcript,
            isTranscribing: false,
            transcribedAt: admin.firestore.FieldValue.serverTimestamp(),
            transcriptionModel: "whisper-1",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          
          console.log(`✅ Whisper transcription complete: ${transcript.substring(0, 100)}...`);
        } else {
          console.log("Whisper returned empty transcript");
          await snapshot.ref.update({
            transcript: "[No speech detected]",
            isTranscribing: false,
            transcriptionModel: "whisper-1",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }
      } catch (transcriptionError: any) {
        console.error("Whisper transcription failed:", transcriptionError.message);
        await snapshot.ref.update({
          transcript: `[Transcription failed: ${transcriptionError.message}]`,
          isTranscribing: false,
          transcriptionError: transcriptionError.message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }
    }
    
    if (!transcript || transcript.trim().length === 0) {
      console.log("No transcript available and no audio URL, skipping");
      return;
    }
    
    // Check if already extracted
    if (recordingData.tasksExtracted) {
      console.log("Tasks already extracted, skipping");
      return;
    }
    
    console.log(`Auto-extracting tasks from recording ${recordingId}...`);
    
    try {
      const { OpenAI } = await import("openai");
      
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error("OpenAI API key not configured");
        return;
      }
      
      const openai = new OpenAI({ apiKey });
      
      // Get current date for relative date parsing
      const currentDate = new Date();
      const currentDateStr = currentDate.toISOString().split('T')[0];
      
      const prompt = `You are an AI assistant that analyzes voice memo transcripts to extract actionable items.

Today's date is: ${currentDateStr}

CRITICAL RULES:
1. ONLY extract items that are EXPLICITLY mentioned in the transcript
2. NEVER create placeholder, example, sample, or test tasks
3. If the transcript has no clear tasks or discussion points, return EMPTY arrays
4. Do NOT invent or make up any content - only use what is actually said

This is a voice memo recorded by the user. Extract:
1. Discussion points and topics that are ACTUALLY mentioned
2. Tasks, to-dos, action items, PLANS, EVENTS, and APPOINTMENTS that the user mentions doing or attending

For conversation_points (ONLY if actually discussed):
- content: What was discussed (exact or close paraphrase)
- type: user_task, meeting, event, deadline, reminder, decision, question, follow_up, information, idea, other
- speaker: Who said it (if identifiable, otherwise null)
- mentionedPeople: Array of people mentioned
- mentionedDateTime: ISO date string if a date/time was mentioned, null otherwise
- location: Location if mentioned, null otherwise

For user_tasks - extract if the user mentions ANY of these:
- Something they need to do ("I need to X", "I have to X", "you need to do X")
- Plans to attend or go somewhere ("I plan on X", "I'm going to X", "I have X scheduled", "going to X")
- Events or appointments ("my meeting is at X", "birthday party at X", "appointment at X", "party at X")
- Deadlines ("due by X", "deadline is X")
- Social events ("seeing family", "dinner with X", "lunch with X")

Fields for user_tasks:
- title: Clear, actionable task/event title from the transcript
- details: Additional context from the transcript
- location: Where it takes place (if mentioned)
- participants: People involved or mentioned (e.g., "family", specific names)
- suggestedDateTime: ISO date string with time if mentioned (e.g., "tomorrow at 4pm" -> calculate from today's date ${currentDateStr}), null otherwise
- priority: 1 (high), 2 (medium), 3 (low) based on urgency
- category: work, personal, meeting, call, errand, health, event, appointment, social, other
- isEvent: true if this is an event/appointment/social gathering to attend, false if it's a task to complete

IMPORTANT: If the transcript is empty, unclear, just noise, or contains no actionable content, return:
{"conversation_points": [], "user_tasks": []}

Return ONLY valid JSON:
{
  "conversation_points": [],
  "user_tasks": []
}

Voice memo transcript:
${transcript}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You extract tasks and discussion points from transcripts. Return only valid JSON." },
          { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" }
      });

      const content = completion.choices[0].message.content || "{}";
      const parsed = JSON.parse(content);
      
      const conversationPoints = parsed.conversation_points || [];
      const userTasks = parsed.user_tasks || [];
      
      console.log(`Extracted ${conversationPoints.length} points and ${userTasks.length} tasks`);
      
      const db = admin.firestore();
      const batch = db.batch();
      
      // Save conversation points to session
      const sessionRef = db.collection(`users/${userId}/conversationSessions`).doc(recordingId);
      const points = conversationPoints.map((point: any, index: number) => ({
        id: `point_${Date.now()}_${index}`,
        ...point,
        recordingId,
        sessionId: recordingId,
        createdAt: new Date().toISOString(),
        addedToTaskList: point.type === "user_task"
      }));
      
      batch.set(sessionRef, {
        recordingId,
        points,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      // Save user tasks to master task list
      const taskListRef = db.collection(`users/${userId}/taskLists`).doc("master");
      const taskListDoc = await taskListRef.get();
      
      let existingTasks: any[] = [];
      if (taskListDoc.exists) {
        existingTasks = taskListDoc.data()?.tasks || [];
      }
      
      const newTasks = userTasks.map((task: any, index: number) => ({
        id: `task_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        title: task.title,
        details: task.details || null,
        location: task.location || null,
        participants: task.participants || [],
        subtasks: [],
        suggestedDate: task.suggestedDateTime || null,
        priority: task.priority || null,
        category: task.category || "other",
        isEvent: task.isEvent || false,
        audioTimecode: 0,
        sessionId: recordingId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        addedToCalendar: false,
        calendarEventId: null,
        status: "pending"
      }));
      
      // AUTO-CREATE CALENDAR EVENTS for tasks/events with dates
      let calendarEventsCreated = 0;
      for (const task of newTasks) {
        if (task.suggestedDate) {
          try {
            const startDate = new Date(task.suggestedDate);
            // Only create calendar events for valid future or today's dates
            if (!isNaN(startDate.getTime())) {
              const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour default duration
              
              const eventId = `zeitline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              const eventData = {
                id: eventId,
                title: task.title,
                description: task.details || "",
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                location: task.location || null,
                calendarType: "zeitline",
                calendarName: "Zeitline",
                source: "voice_memo",
                taskId: task.id,
                recordingId: recordingId,
                isEvent: task.isEvent || false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              
              batch.set(
                db.collection(`users/${userId}/calendar_events`).doc(eventId),
                eventData
              );
              
              // Update task to mark it as added to calendar
              task.addedToCalendar = true;
              task.calendarEventId = eventId;
              calendarEventsCreated++;
              
              console.log(`📅 Auto-created calendar event: ${task.title} for ${startDate.toISOString()}`);
            }
          } catch (err) {
            console.error(`Failed to create calendar event for task ${task.title}:`, err);
          }
        }
      }
      
      batch.set(taskListRef, {
        userId,
        tasks: [...existingTasks, ...newTasks],
        lastUpdated: new Date().toISOString()
      }, { merge: true });
      
      // Update recording document
      batch.update(snapshot.ref, {
        tasksExtracted: true,
        extractedTaskCount: userTasks.length,
        extractedPointCount: conversationPoints.length,
        calendarEventsCreated: calendarEventsCreated,
        extractedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await batch.commit();
      
      console.log(`✅ Auto-extracted ${userTasks.length} tasks, ${conversationPoints.length} points, and created ${calendarEventsCreated} calendar events for recording ${recordingId}`);
      
    } catch (error) {
      console.error("Error auto-extracting tasks:", error);
    }
  });

// Also trigger when recording is updated (e.g., audioUrl or transcript added later)
export const onRecordingUpdate = functions.firestore
  .document("users/{userId}/recordings/{recordingId}")
  .onUpdate(async (change, context) => {
    const { userId, recordingId } = context.params;
    const before = change.before.data();
    const after = change.after.data();
    
    // Check if audioUrl was just added and there's no transcript yet
    const hadAudioUrl = before.audioUrl && before.audioUrl.trim().length > 0;
    const hasAudioUrl = after.audioUrl && after.audioUrl.trim().length > 0;
    const hadTranscript = before.transcript && before.transcript.trim().length > 0;
    let hasTranscript = after.transcript && after.transcript.trim().length > 0;
    
    // If audioUrl was just added and no transcript, transcribe with Whisper
    if (!hadAudioUrl && hasAudioUrl && !hasTranscript && !after.isTranscribing) {
      console.log(`Audio URL added to recording ${recordingId}, triggering Whisper transcription...`);
      
      try {
        // Mark as transcribing
        await change.after.ref.update({
          isTranscribing: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        const transcript = await transcribeWithWhisperFromTrigger(
          after.audioUrl,
          after.filename || "audio.m4a"
        );
        
        if (transcript && transcript.trim().length > 0) {
          await change.after.ref.update({
            transcript: transcript,
            isTranscribing: false,
            transcribedAt: admin.firestore.FieldValue.serverTimestamp(),
            transcriptionModel: "whisper-1",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          
          console.log(`✅ Whisper transcription complete for ${recordingId}`);
          hasTranscript = true;
        } else {
          await change.after.ref.update({
            transcript: "[No speech detected]",
            isTranscribing: false,
            transcriptionModel: "whisper-1",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }
      } catch (error: any) {
        console.error(`Whisper transcription failed for ${recordingId}:`, error.message);
        await change.after.ref.update({
          transcript: `[Transcription failed: ${error.message}]`,
          isTranscribing: false,
          transcriptionError: error.message,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }
    }
    
    // Check if transcript was just added (either by Whisper above or iOS)
    if (!hadTranscript && hasTranscript && !after.tasksExtracted) {
      console.log(`Transcript added to recording ${recordingId}, triggering auto-extraction...`);
      
      // Trigger the same extraction logic
      // We'll call the onCreate handler logic by creating a fake snapshot
      const snapshot = change.after;
      
      try {
        const { OpenAI } = await import("openai");
        
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          console.error("OpenAI API key not configured");
          return;
        }
        
        const openai = new OpenAI({ apiKey });
        const transcript = after.transcript;
        
        // Get current date for relative date parsing
        const currentDate = new Date();
        const currentDateStr = currentDate.toISOString().split('T')[0];
        
        const prompt = `You are an AI assistant that analyzes voice memo transcripts to extract actionable items.

Today's date is: ${currentDateStr}

CRITICAL RULES:
1. ONLY extract items that are EXPLICITLY mentioned in the transcript
2. NEVER create placeholder, example, sample, or test tasks
3. If the transcript has no clear tasks or discussion points, return EMPTY arrays
4. Do NOT invent or make up any content - only use what is actually said

This is a voice memo recorded by the user. Extract:
1. Discussion points and topics that are ACTUALLY mentioned
2. Tasks, to-dos, action items, PLANS, EVENTS, and APPOINTMENTS that the user mentions doing or attending

For conversation_points (ONLY if actually discussed):
- content: What was discussed (exact or close paraphrase)
- type: user_task, meeting, event, deadline, reminder, decision, question, follow_up, information, idea, other
- speaker: Who said it (if identifiable, otherwise null)
- mentionedPeople: Array of people mentioned
- mentionedDateTime: ISO date string if a date/time was mentioned, null otherwise
- location: Location if mentioned, null otherwise

For user_tasks - extract if the user mentions ANY of these:
- Something they need to do ("I need to X", "I have to X", "you need to do X")
- Plans to attend or go somewhere ("I plan on X", "I'm going to X", "I have X scheduled", "going to X")
- Events or appointments ("my meeting is at X", "birthday party at X", "appointment at X", "party at X")
- Deadlines ("due by X", "deadline is X")
- Social events ("seeing family", "dinner with X", "lunch with X")

Fields for user_tasks:
- title: Clear, actionable task/event title from the transcript
- details: Additional context from the transcript
- location: Where it takes place (if mentioned)
- participants: People involved or mentioned (e.g., "family", specific names)
- suggestedDateTime: ISO date string with time if mentioned (e.g., "tomorrow at 4pm" -> calculate from today's date ${currentDateStr}), null otherwise
- priority: 1 (high), 2 (medium), 3 (low) based on urgency
- category: work, personal, meeting, call, errand, health, event, appointment, social, other
- isEvent: true if this is an event/appointment/social gathering to attend, false if it's a task to complete

IMPORTANT: If the transcript is empty, unclear, just noise, or contains no actionable content, return:
{"conversation_points": [], "user_tasks": []}

Return ONLY valid JSON:
{
  "conversation_points": [],
  "user_tasks": []
}

Voice memo transcript:
${transcript}`;

        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You extract tasks and discussion points from transcripts. Return only valid JSON." },
            { role: "user", content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: "json_object" }
        });

        const content = completion.choices[0].message.content || "{}";
        const parsed = JSON.parse(content);
        
        const conversationPoints = parsed.conversation_points || [];
        const userTasks = parsed.user_tasks || [];
        
        const db = admin.firestore();
        const batch = db.batch();
        
        // Save conversation points
        const sessionRef = db.collection(`users/${userId}/conversationSessions`).doc(recordingId);
        const points = conversationPoints.map((point: any, index: number) => ({
          id: `point_${Date.now()}_${index}`,
          ...point,
          recordingId,
          sessionId: recordingId,
          createdAt: new Date().toISOString(),
          addedToTaskList: point.type === "user_task"
        }));
        
        batch.set(sessionRef, {
          recordingId,
          points,
          startedAt: admin.firestore.FieldValue.serverTimestamp(),
          endedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Save user tasks
        const taskListRef = db.collection(`users/${userId}/taskLists`).doc("master");
        const taskListDoc = await taskListRef.get();
        
        let existingTasks: any[] = [];
        if (taskListDoc.exists) {
          existingTasks = taskListDoc.data()?.tasks || [];
        }
        
        const newTasks = userTasks.map((task: any, index: number) => ({
          id: `task_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
          title: task.title,
          details: task.details || null,
          location: task.location || null,
          participants: task.participants || [],
          subtasks: [],
          suggestedDate: task.suggestedDateTime || null,
          priority: task.priority || null,
          category: task.category || "other",
          isEvent: task.isEvent || false,
          sessionId: recordingId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          addedToCalendar: false,
          calendarEventId: null,
          status: "pending"
        }));
        
        // AUTO-CREATE CALENDAR EVENTS for tasks/events with dates
        let calendarEventsCreated = 0;
        for (const task of newTasks) {
          if (task.suggestedDate) {
            try {
              const startDate = new Date(task.suggestedDate);
              // Only create calendar events for valid future or today's dates
              if (!isNaN(startDate.getTime())) {
                const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour default duration
                
                const eventId = `zeitline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const eventData = {
                  id: eventId,
                  title: task.title,
                  description: task.details || "",
                  start: startDate.toISOString(),
                  end: endDate.toISOString(),
                  location: task.location || null,
                  calendarType: "zeitline",
                  calendarName: "Zeitline",
                  source: "voice_memo",
                  taskId: task.id,
                  recordingId: recordingId,
                  isEvent: task.isEvent || false,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
                
                batch.set(
                  db.collection(`users/${userId}/calendar_events`).doc(eventId),
                  eventData
                );
                
                // Update task to mark it as added to calendar
                task.addedToCalendar = true;
                task.calendarEventId = eventId;
                calendarEventsCreated++;
                
                console.log(`📅 Auto-created calendar event: ${task.title} for ${startDate.toISOString()}`);
              }
            } catch (err) {
              console.error(`Failed to create calendar event for task ${task.title}:`, err);
            }
          }
        }
        
        batch.set(taskListRef, {
          userId,
          tasks: [...existingTasks, ...newTasks],
          lastUpdated: new Date().toISOString()
        }, { merge: true });
        
        // Update recording
        batch.update(snapshot.ref, {
          tasksExtracted: true,
          extractedTaskCount: userTasks.length,
          extractedPointCount: conversationPoints.length,
          calendarEventsCreated: calendarEventsCreated,
          extractedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        await batch.commit();
        
        console.log(`✅ Auto-extracted ${userTasks.length} tasks, ${conversationPoints.length} points, and created ${calendarEventsCreated} calendar events from updated recording ${recordingId}`);
        
      } catch (error) {
        console.error("Error auto-extracting tasks on update:", error);
      }
    }
  });

