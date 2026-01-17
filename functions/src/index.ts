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

/**
 * Helper function to check if a calendar event already exists
 * Prevents duplicate events by checking:
 * 1. Same recordingId + title + start time (within 5 minute tolerance)
 * 2. Same taskId (if provided)
 */
async function checkDuplicateCalendarEvent(
  db: admin.firestore.Firestore,
  userId: string,
  title: string,
  startTime: Date,
  recordingId: string,
  taskId?: string
): Promise<boolean> {
  const TIME_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes
  const normalizedTitle = title.toLowerCase().trim().replace(/\s+/g, " ");
  
  try {
    // Query calendar events for this recording
    const eventsRef = db.collection(`users/${userId}/calendar_events`);
    const snapshot = await eventsRef
      .where("recordingId", "==", recordingId)
      .get();
    
    for (const doc of snapshot.docs) {
      const event = doc.data();
      const eventTitle = (event.title || "").toLowerCase().trim().replace(/\s+/g, " ");
      const eventStart = new Date(event.start).getTime();
      const targetStart = startTime.getTime();
      
      // Check for duplicate by title + time
      if (eventTitle === normalizedTitle && 
          Math.abs(eventStart - targetStart) < TIME_TOLERANCE_MS) {
        console.log(`🔄 Duplicate event detected: "${title}" at ${startTime.toISOString()} (existing: ${event.id})`);
        return true;
      }
      
      // Check for duplicate by taskId
      if (taskId && event.taskId === taskId) {
        console.log(`🔄 Duplicate event detected by taskId: ${taskId} (existing: ${event.id})`);
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error("Error checking for duplicate calendar event:", error);
    return false; // On error, allow creation (fail open)
  }
}

// Firestore trigger - auto-transcribe and extract tasks when a new recording is created
export const onRecordingCreate = functions.firestore
  .document("users/{userId}/recordings/{recordingId}")
  .onCreate(async (snapshot, context) => {
    const { userId, recordingId } = context.params;
    let recordingData = snapshot.data();
    
    console.log(`🆕 === onRecordingCreate triggered ===`);
    console.log(`Recording ID: ${recordingId}`);
    console.log(`User ID: ${userId}`);
    console.log(`Has audioUrl: ${!!recordingData.audioUrl}`);
    console.log(`Has transcript: ${!!recordingData.transcript && recordingData.transcript.trim().length > 0}`);
    console.log(`tasksExtracted: ${recordingData.tasksExtracted}`);
    
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
          // Set extractionInProgress flag to prevent onRecordingUpdate from also extracting tasks
          await snapshot.ref.update({
            transcript: transcript,
            isTranscribing: false,
            transcribedAt: admin.firestore.FieldValue.serverTimestamp(),
            transcriptionModel: "whisper-1",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            extractionInProgress: true,  // Prevent race condition with onRecordingUpdate
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
    
    // Check if already extracted or extraction is in progress
    if (recordingData.tasksExtracted) {
      console.log("Tasks already extracted, skipping");
      return;
    }
    
    if (recordingData.extractionInProgress) {
      console.log("Extraction already in progress, skipping");
      return;
    }
    
    console.log(`🔄 Auto-extracting tasks from recording ${recordingId}...`);
    console.log(`📝 Transcript preview: "${transcript.substring(0, 200)}..."`);
    
    // Set extraction lock FIRST to prevent race condition with onRecordingUpdate
    // Use a transaction to ensure atomicity
    const db = admin.firestore();
    try {
      const lockAcquired = await db.runTransaction(async (transaction) => {
        const docRef = snapshot.ref;
        const doc = await transaction.get(docRef);
        const currentData = doc.data();
        
        // Double-check conditions inside transaction
        if (currentData?.extractionInProgress || currentData?.tasksExtracted) {
          console.log("🔒 Another process already started extraction, skipping");
          return false;
        }
        
        transaction.update(docRef, {
          extractionInProgress: true,
          extractionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
      
      if (!lockAcquired) {
        return;
      }
      console.log("🔒 Extraction lock acquired in onRecordingCreate");
    } catch (lockError) {
      console.error("Failed to acquire extraction lock:", lockError);
      return;
    }
    
    try {
      const { OpenAI } = await import("openai");
      
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error("❌ OpenAI API key not configured - cannot extract tasks");
        await snapshot.ref.update({
          tasksExtracted: false,
          extractionError: "OpenAI API key not configured",
          extractionInProgress: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }
      
      const openai = new OpenAI({ apiKey });
      
      // Fetch user's timezone from their profile
      // Note: db already initialized above for lock acquisition
      let userTimezone = "America/New_York"; // Default fallback
      
      try {
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.data();
        userTimezone = userData?.personal?.timezone || "America/New_York";
        console.log(`📍 User timezone: ${userTimezone}`);
      } catch (tzError) {
        console.error("⚠️ Error fetching user timezone, using default:", tzError);
      }
      
      // Get current date/time in user's timezone
      const now = new Date();
      let currentDateStr: string;
      let currentTimeStr: string;
      let tomorrowDateStr: string;
      
      try {
        const dateOptions: Intl.DateTimeFormatOptions = {
          timeZone: userTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        };
        const timeOptions: Intl.DateTimeFormatOptions = {
          timeZone: userTimezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        };
        
        // Format current date as YYYY-MM-DD
        const dateFormatter = new Intl.DateTimeFormat('en-CA', dateOptions);
        currentDateStr = dateFormatter.format(now);
        
        // Format current time as HH:MM
        const timeFormatter = new Intl.DateTimeFormat('en-GB', timeOptions);
        currentTimeStr = timeFormatter.format(now);
        
        // Calculate tomorrow's date in user's timezone
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        tomorrowDateStr = dateFormatter.format(tomorrow);
      } catch (formatError) {
        console.error("⚠️ Error formatting dates, using UTC fallback:", formatError);
        currentDateStr = now.toISOString().split('T')[0];
        currentTimeStr = now.toISOString().split('T')[1].substring(0, 5);
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        tomorrowDateStr = tomorrow.toISOString().split('T')[0];
      }
      
      console.log(`📅 Date context: Today=${currentDateStr}, Time=${currentTimeStr}, Tomorrow=${tomorrowDateStr}`);
      
      const prompt = `You are an AI assistant that analyzes voice memo transcripts to extract actionable items.

CURRENT DATE/TIME CONTEXT (in user's local timezone: ${userTimezone}):
- Today's date: ${currentDateStr}
- Current time: ${currentTimeStr}
- Tomorrow's date: ${tomorrowDateStr}

CRITICAL RULES:
1. ONLY extract items that are EXPLICITLY mentioned in the transcript
2. NEVER create placeholder, example, sample, or test tasks
3. If the transcript has no clear tasks or discussion points, return EMPTY arrays
4. Do NOT invent or make up any content - only use what is actually said
5. ANY mention of plans, events, appointments, or activities with a date/time MUST be extracted as a user_task

DEDUPLICATION RULES (VERY IMPORTANT):
6. NEVER create multiple user_tasks for the same event/meeting/appointment
7. If someone says "put X on my calendar", "add X to calendar", "schedule X", or "I'll calendar X" - extract ONLY the event X as a single user_task, NOT a separate "add to calendar" task
8. When the same event is mentioned multiple times or described in different ways, consolidate into ONE user_task
9. Example: "I'll put on my calendar the meeting with Jake tomorrow at 4pm" = ONE task titled "Meeting with Jake", NOT two tasks
10. The action of adding to calendar is automatic - never create a task for the action of calendaring itself

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
- Plans to attend or go somewhere ("I plan on X", "I'm going to X", "I have X scheduled", "going to X", "attending X")
- Events or appointments ("my meeting is at X", "birthday party at X", "appointment at X", "party at X")
- Deadlines ("due by X", "deadline is X")
- Social events ("seeing family", "dinner with X", "lunch with X")
- IMPORTANT: If user mentions adding something to calendar, extract the EVENT being added, not the action of adding

Fields for user_tasks:
- title: Clear, actionable task/event title from the transcript
- details: Additional context from the transcript
- location: Where it takes place (if mentioned)
- participants: People involved or mentioned (e.g., "family", specific names)
- suggestedDateTime: MUST be a complete ISO 8601 datetime string. Use 24-hour time format.
  DATE/TIME CONVERSION EXAMPLES (based on current context):
  - "tomorrow at 4pm" = "${tomorrowDateStr}T16:00:00"
  - "tomorrow at 4 p.m." = "${tomorrowDateStr}T16:00:00"
  - "today at 3pm" = "${currentDateStr}T15:00:00"
  - "tonight at 8" = "${currentDateStr}T20:00:00"
  - "this evening" = "${currentDateStr}T18:00:00"
  - "tomorrow morning" = "${tomorrowDateStr}T09:00:00"
  - If only date mentioned, default to 09:00:00
  - Return null if no date/time is mentioned
- priority: 1 (high), 2 (medium), 3 (low) based on urgency
- category: work, personal, meeting, call, errand, health, event, appointment, social, other
- isEvent: true if this is an event/appointment/social gathering to attend, false if it's a task to complete

IMPORTANT: 
- If the transcript is empty, unclear, just noise, or contains no actionable content, return empty arrays
- ALWAYS extract plans/events with dates as user_tasks, not just conversation_points

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
      console.log(`📦 Raw OpenAI response: ${content.substring(0, 500)}...`);
      
      const parsed = JSON.parse(content);
      
      const conversationPoints = parsed.conversation_points || [];
      const userTasks = parsed.user_tasks || [];
      
      console.log(`✅ Extracted ${conversationPoints.length} conversation points and ${userTasks.length} user tasks`);
      
      // Log each extracted task for debugging
      if (userTasks.length > 0) {
        userTasks.forEach((task: any, idx: number) => {
          console.log(`📋 Task ${idx + 1}: "${task.title}" | DateTime: ${task.suggestedDateTime} | Category: ${task.category} | isEvent: ${task.isEvent}`);
        });
      } else {
        console.log(`⚠️ No user_tasks extracted from transcript. Conversation points:`, JSON.stringify(conversationPoints.slice(0, 3)));
      }
      
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
        suggestedEndDate: null, // Required by iOS model
        isAllDay: task.isAllDay || false, // Required by iOS model
        priority: task.priority || null,
        category: task.category || "other",
        audioTimecode: 0,
        transcriptSection: null, // Required by iOS model
        sessionId: recordingId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        addedToCalendar: false,
        calendarEventId: null,
        status: "pending"
      }));
      
      // Helper function to parse datetime string in user's timezone
      function parseLocalDateTime(dateTimeStr: string, timezone: string): Date {
        // If the string already has timezone info, parse directly
        if (dateTimeStr.includes('Z') || dateTimeStr.includes('+') || (dateTimeStr.length > 10 && dateTimeStr.lastIndexOf('-') > 10)) {
          return new Date(dateTimeStr);
        }
        
        // Parse the datetime components
        const [datePart, timePart] = dateTimeStr.split('T');
        if (!datePart) return new Date(dateTimeStr);
        
        const [year, month, day] = datePart.split('-').map(Number);
        let hours = 9, minutes = 0, seconds = 0; // Default to 9 AM
        
        if (timePart) {
          const timeParts = timePart.split(':');
          hours = parseInt(timeParts[0]) || 9;
          minutes = parseInt(timeParts[1]) || 0;
          seconds = parseInt(timeParts[2]) || 0;
        }
        
        // Create a date string that will be interpreted as the user's local time
        try {
          const localFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
          });
          
          // Find what UTC time corresponds to the local time the user specified
          // Start with an estimate and adjust
          let testDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
          
          // Get the local time at this UTC moment
          const localParts = localFormatter.formatToParts(testDate);
          const localHour = parseInt(localParts.find(p => p.type === 'hour')?.value || '0');
          const localDay = parseInt(localParts.find(p => p.type === 'day')?.value || '1');
          
          // Calculate the offset in hours
          let hourDiff = hours - localHour;
          let dayDiff = day - localDay;
          
          // Adjust for day boundary crossings
          if (dayDiff > 0) hourDiff += 24;
          if (dayDiff < 0) hourDiff -= 24;
          
          // Apply the offset to get the correct UTC time
          testDate = new Date(testDate.getTime() + hourDiff * 60 * 60 * 1000);
          
          console.log(`🕐 Timezone conversion: "${dateTimeStr}" in ${timezone} → UTC: ${testDate.toISOString()}`);
          return testDate;
        } catch (e) {
          console.error("Error in timezone conversion, falling back:", e);
          return new Date(dateTimeStr);
        }
      }
      
      // AUTO-CREATE CALENDAR EVENTS for tasks/events with dates
      // Check user preference first
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      const autoAddToCalendar = userData?.autoAddTasksToCalendar || false;
      
      // Check for duplicates before creating to prevent race conditions
      let calendarEventsCreated = 0;
      let calendarEventsSkipped = 0;
      
      // Only auto-create calendar events if user preference is enabled
      if (autoAddToCalendar) {
        for (const task of newTasks) {
          if (task.suggestedDate) {
          try {
            const startDate = parseLocalDateTime(task.suggestedDate, userTimezone);
            // Only create calendar events for valid future or today's dates
            if (!isNaN(startDate.getTime())) {
              // Check for duplicate before creating
              const isDuplicate = await checkDuplicateCalendarEvent(
                db,
                userId,
                task.title,
                startDate,
                recordingId,
                task.id
              );
              
              if (isDuplicate) {
                console.log(`⏭️ Skipping duplicate calendar event: ${task.title}`);
                calendarEventsSkipped++;
                continue;
              }
              
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
              
              console.log(`📅 Auto-created calendar event: ${task.title} for ${startDate.toISOString()} (user timezone: ${userTimezone})`);
            }
          } catch (err) {
            console.error(`Failed to create calendar event for task ${task.title}:`, err);
          }
        }
      } else {
        console.log(`⏭️ Skipping auto-calendar creation - user preference disabled`);
      }
      
      if (calendarEventsSkipped > 0) {
        console.log(`⏭️ Skipped ${calendarEventsSkipped} duplicate calendar events`);
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
        extractedAt: admin.firestore.FieldValue.serverTimestamp(),
        extractionInProgress: false  // Clear the flag after extraction completes
      });
      
      await batch.commit();
      
      console.log(`✅ Auto-extracted ${userTasks.length} tasks, ${conversationPoints.length} points, and created ${calendarEventsCreated} calendar events for recording ${recordingId}`);
      
    } catch (error: any) {
      console.error("❌ Error auto-extracting tasks:", error);
      console.error("Error stack:", error.stack);
      
      // Save error to document for debugging
      try {
        await snapshot.ref.update({
          tasksExtracted: false,
          extractionError: error.message || "Unknown error",
          extractionErrorAt: admin.firestore.FieldValue.serverTimestamp(),
          extractionInProgress: false  // Clear the flag on error too
        });
      } catch (updateError) {
        console.error("Failed to save extraction error:", updateError);
      }
    }
  });

// Also trigger when recording is updated (e.g., audioUrl or transcript added later)
export const onRecordingUpdate = functions.firestore
  .document("users/{userId}/recordings/{recordingId}")
  .onUpdate(async (change, context) => {
    const { userId, recordingId } = context.params;
    const before = change.before.data();
    const after = change.after.data();
    
    console.log(`🔄 === onRecordingUpdate triggered ===`);
    console.log(`Recording ID: ${recordingId}`);
    console.log(`User ID: ${userId}`);
    console.log(`Before - audioUrl: ${!!before.audioUrl}, transcript: ${!!before.transcript && before.transcript?.trim?.()?.length > 0}, tasksExtracted: ${before.tasksExtracted}`);
    console.log(`After - audioUrl: ${!!after.audioUrl}, transcript: ${!!after.transcript && after.transcript?.trim?.()?.length > 0}, tasksExtracted: ${after.tasksExtracted}`);
    
    // Check if audioUrl was just added and there's no transcript yet
    const hadAudioUrl = before.audioUrl && before.audioUrl.trim().length > 0;
    const hasAudioUrl = after.audioUrl && after.audioUrl.trim().length > 0;
    const hadTranscript = before.transcript && before.transcript.trim().length > 0;
    let hasTranscript = after.transcript && after.transcript.trim().length > 0;
    
    console.log(`Conditions: hadAudioUrl=${hadAudioUrl}, hasAudioUrl=${hasAudioUrl}, hadTranscript=${hadTranscript}, hasTranscript=${hasTranscript}`);
    
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
    // Also check extractionInProgress to prevent race condition with onRecordingCreate
    console.log(`Extraction check: !hadTranscript=${!hadTranscript}, hasTranscript=${hasTranscript}, !tasksExtracted=${!after.tasksExtracted}, extractionInProgress=${after.extractionInProgress}`);
    
    if (!hadTranscript && hasTranscript && !after.tasksExtracted && !after.extractionInProgress) {
      console.log(`✅ Extraction conditions met! Triggering auto-extraction...`);
      const transcript = after.transcript;
      console.log(`📝 Transcript preview: "${transcript.substring(0, 200)}..."`);
      
      // Trigger the same extraction logic
      const snapshot = change.after;
      
      // Set extraction lock FIRST to prevent race condition with onRecordingCreate
      // Use a transaction to ensure atomicity
      const db = admin.firestore();
      try {
        const lockAcquired = await db.runTransaction(async (transaction) => {
          const docRef = snapshot.ref;
          const doc = await transaction.get(docRef);
          const currentData = doc.data();
          
          // Double-check conditions inside transaction
          if (currentData?.extractionInProgress || currentData?.tasksExtracted) {
            console.log("🔒 Another process already started extraction, skipping");
            return false;
          }
          
          transaction.update(docRef, {
            extractionInProgress: true,
            extractionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return true;
        });
        
        if (!lockAcquired) {
          return;
        }
        console.log("🔒 Extraction lock acquired in onRecordingUpdate");
      } catch (lockError) {
        console.error("Failed to acquire extraction lock:", lockError);
        return;
      }
      
      try {
        const { OpenAI } = await import("openai");
        
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          console.error("❌ OpenAI API key not configured - cannot extract tasks");
          await snapshot.ref.update({
            tasksExtracted: false,
            extractionError: "OpenAI API key not configured",
            extractionInProgress: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return;
        }
        
        const openai = new OpenAI({ apiKey });
        
        // Fetch user's timezone from their profile
        // Note: db already initialized above for lock acquisition
        let userTimezone = "America/New_York"; // Default fallback
        
        try {
          const userDoc = await db.collection("users").doc(userId).get();
          const userData = userDoc.data();
          userTimezone = userData?.personal?.timezone || "America/New_York";
          console.log(`📍 User timezone: ${userTimezone}`);
        } catch (tzError) {
          console.error("⚠️ Error fetching user timezone, using default:", tzError);
        }
        
        // Get current date/time in user's timezone
        const now = new Date();
        let currentDateStr: string;
        let currentTimeStr: string;
        let tomorrowDateStr: string;
        
        try {
          const dateOptions: Intl.DateTimeFormatOptions = {
            timeZone: userTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          };
          const timeOptions: Intl.DateTimeFormatOptions = {
            timeZone: userTimezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          };
          
          // Format current date as YYYY-MM-DD
          const dateFormatter = new Intl.DateTimeFormat('en-CA', dateOptions);
          currentDateStr = dateFormatter.format(now);
          
          // Format current time as HH:MM
          const timeFormatter = new Intl.DateTimeFormat('en-GB', timeOptions);
          currentTimeStr = timeFormatter.format(now);
          
          // Calculate tomorrow's date in user's timezone
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          tomorrowDateStr = dateFormatter.format(tomorrow);
        } catch (formatError) {
          console.error("⚠️ Error formatting dates, using UTC fallback:", formatError);
          currentDateStr = now.toISOString().split('T')[0];
          currentTimeStr = now.toISOString().split('T')[1].substring(0, 5);
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          tomorrowDateStr = tomorrow.toISOString().split('T')[0];
        }
        
        console.log(`📅 Date context: Today=${currentDateStr}, Time=${currentTimeStr}, Tomorrow=${tomorrowDateStr}`);
        
        const prompt = `You are an AI assistant that analyzes voice memo transcripts to extract actionable items.

CURRENT DATE/TIME CONTEXT (in user's local timezone: ${userTimezone}):
- Today's date: ${currentDateStr}
- Current time: ${currentTimeStr}
- Tomorrow's date: ${tomorrowDateStr}

CRITICAL RULES:
1. ONLY extract items that are EXPLICITLY mentioned in the transcript
2. NEVER create placeholder, example, sample, or test tasks
3. If the transcript has no clear tasks or discussion points, return EMPTY arrays
4. Do NOT invent or make up any content - only use what is actually said
5. ANY mention of plans, events, appointments, or activities with a date/time MUST be extracted as a user_task

DEDUPLICATION RULES (VERY IMPORTANT):
6. NEVER create multiple user_tasks for the same event/meeting/appointment
7. If someone says "put X on my calendar", "add X to calendar", "schedule X", or "I'll calendar X" - extract ONLY the event X as a single user_task, NOT a separate "add to calendar" task
8. When the same event is mentioned multiple times or described in different ways, consolidate into ONE user_task
9. Example: "I'll put on my calendar the meeting with Jake tomorrow at 4pm" = ONE task titled "Meeting with Jake", NOT two tasks
10. The action of adding to calendar is automatic - never create a task for the action of calendaring itself

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
- Plans to attend or go somewhere ("I plan on X", "I'm going to X", "I have X scheduled", "going to X", "attending X")
- Events or appointments ("my meeting is at X", "birthday party at X", "appointment at X", "party at X")
- Deadlines ("due by X", "deadline is X")
- Social events ("seeing family", "dinner with X", "lunch with X")
- IMPORTANT: If user mentions adding something to calendar, extract the EVENT being added, not the action of adding

Fields for user_tasks:
- title: Clear, actionable task/event title from the transcript
- details: Additional context from the transcript
- location: Where it takes place (if mentioned)
- participants: People involved or mentioned (e.g., "family", specific names)
- suggestedDateTime: MUST be a complete ISO 8601 datetime string. Use 24-hour time format.
  DATE/TIME CONVERSION EXAMPLES (based on current context):
  - "tomorrow at 4pm" = "${tomorrowDateStr}T16:00:00"
  - "tomorrow at 4 p.m." = "${tomorrowDateStr}T16:00:00"
  - "today at 3pm" = "${currentDateStr}T15:00:00"
  - "tonight at 8" = "${currentDateStr}T20:00:00"
  - "this evening" = "${currentDateStr}T18:00:00"
  - "tomorrow morning" = "${tomorrowDateStr}T09:00:00"
  - If only date mentioned, default to 09:00:00
  - Return null if no date/time is mentioned
- priority: 1 (high), 2 (medium), 3 (low) based on urgency
- category: work, personal, meeting, call, errand, health, event, appointment, social, other
- isEvent: true if this is an event/appointment/social gathering to attend, false if it's a task to complete

IMPORTANT: 
- If the transcript is empty, unclear, just noise, or contains no actionable content, return empty arrays
- ALWAYS extract plans/events with dates as user_tasks, not just conversation_points

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
        console.log(`📦 Raw OpenAI response: ${content.substring(0, 500)}...`);
        
        const parsed = JSON.parse(content);
        
        const conversationPoints = parsed.conversation_points || [];
        const userTasks = parsed.user_tasks || [];
        
        console.log(`✅ Extracted ${conversationPoints.length} conversation points and ${userTasks.length} user tasks`);
        
        // Log each extracted task for debugging
        if (userTasks.length > 0) {
          userTasks.forEach((task: any, idx: number) => {
            console.log(`📋 Task ${idx + 1}: "${task.title}" | DateTime: ${task.suggestedDateTime} | Category: ${task.category} | isEvent: ${task.isEvent}`);
          });
        } else {
          console.log(`⚠️ No user_tasks extracted from transcript. Conversation points:`, JSON.stringify(conversationPoints.slice(0, 3)));
        }
        
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
          suggestedEndDate: null, // Required by iOS model
          isAllDay: task.isAllDay || false, // Required by iOS model
          priority: task.priority || null,
          category: task.category || "other",
          audioTimecode: 0,
          transcriptSection: null, // Required by iOS model
          sessionId: recordingId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          addedToCalendar: false,
          calendarEventId: null,
          status: "pending"
        }));
        
        // Helper function to parse datetime string in user's timezone
        function parseLocalDateTime(dateTimeStr: string, timezone: string): Date {
          // If the string already has timezone info, parse directly
          if (dateTimeStr.includes('Z') || dateTimeStr.includes('+') || (dateTimeStr.length > 10 && dateTimeStr.lastIndexOf('-') > 10)) {
            return new Date(dateTimeStr);
          }
          
          // Parse the datetime components
          const [datePart, timePart] = dateTimeStr.split('T');
          if (!datePart) return new Date(dateTimeStr);
          
          const [year, month, day] = datePart.split('-').map(Number);
          let hours = 9, minutes = 0, seconds = 0; // Default to 9 AM
          
          if (timePart) {
            const timeParts = timePart.split(':');
            hours = parseInt(timeParts[0]) || 9;
            minutes = parseInt(timeParts[1]) || 0;
            seconds = parseInt(timeParts[2]) || 0;
          }
          
          // Create a date string that will be interpreted as the user's local time
          try {
            const localFormatter = new Intl.DateTimeFormat('en-US', {
              timeZone: timezone,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
              hour12: false
            });
            
            // Find what UTC time corresponds to the local time the user specified
            let testDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
            
            // Get the local time at this UTC moment
            const localParts = localFormatter.formatToParts(testDate);
            const localHour = parseInt(localParts.find(p => p.type === 'hour')?.value || '0');
            const localDay = parseInt(localParts.find(p => p.type === 'day')?.value || '1');
            
            // Calculate the offset in hours
            let hourDiff = hours - localHour;
            let dayDiff = day - localDay;
            
            // Adjust for day boundary crossings
            if (dayDiff > 0) hourDiff += 24;
            if (dayDiff < 0) hourDiff -= 24;
            
            // Apply the offset to get the correct UTC time
            testDate = new Date(testDate.getTime() + hourDiff * 60 * 60 * 1000);
            
            console.log(`🕐 Timezone conversion: "${dateTimeStr}" in ${timezone} → UTC: ${testDate.toISOString()}`);
            return testDate;
          } catch (e) {
            console.error("Error in timezone conversion, falling back:", e);
            return new Date(dateTimeStr);
          }
        }
        
        // AUTO-CREATE CALENDAR EVENTS for tasks/events with dates
        // Check user preference first
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const autoAddToCalendar = userData?.autoAddTasksToCalendar || false;
        
        // Check for duplicates before creating to prevent race conditions
        let calendarEventsCreated = 0;
        let calendarEventsSkipped = 0;
        
        // Only auto-create calendar events if user preference is enabled
        if (autoAddToCalendar) {
          for (const task of newTasks) {
            if (task.suggestedDate) {
            try {
              const startDate = parseLocalDateTime(task.suggestedDate, userTimezone);
              // Only create calendar events for valid future or today's dates
              if (!isNaN(startDate.getTime())) {
                // Check for duplicate before creating
                const isDuplicate = await checkDuplicateCalendarEvent(
                  db,
                  userId,
                  task.title,
                  startDate,
                  recordingId,
                  task.id
                );
                
                if (isDuplicate) {
                  console.log(`⏭️ Skipping duplicate calendar event: ${task.title}`);
                  calendarEventsSkipped++;
                  continue;
                }
                
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
                
                console.log(`📅 Auto-created calendar event: ${task.title} for ${startDate.toISOString()} (user timezone: ${userTimezone})`);
              }
            } catch (err) {
              console.error(`Failed to create calendar event for task ${task.title}:`, err);
            }
          }
        } else {
          console.log(`⏭️ Skipping auto-calendar creation - user preference disabled`);
        }
        
        if (calendarEventsSkipped > 0) {
          console.log(`⏭️ Skipped ${calendarEventsSkipped} duplicate calendar events`);
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
          extractedAt: admin.firestore.FieldValue.serverTimestamp(),
          extractionInProgress: false  // Clear the flag after extraction completes
        });
        
        await batch.commit();
        
        console.log(`✅ Auto-extracted ${userTasks.length} tasks, ${conversationPoints.length} points, and created ${calendarEventsCreated} calendar events from updated recording ${recordingId}`);
        
      } catch (error: any) {
        console.error("❌ Error auto-extracting tasks on update:", error);
        console.error("Error stack:", error.stack);
        
        // Save error to document for debugging
        try {
          await snapshot.ref.update({
            tasksExtracted: false,
            extractionError: error.message || "Unknown error",
            extractionErrorAt: admin.firestore.FieldValue.serverTimestamp(),
            extractionInProgress: false  // Clear the flag on error too
          });
        } catch (updateError) {
          console.error("Failed to save extraction error:", updateError);
        }
      }
    } else {
      console.log(`⏭️ Skipping extraction - conditions not met:`);
      if (hadTranscript) console.log(`  - Already had transcript before this update`);
      if (!hasTranscript) console.log(`  - No transcript available`);
      if (after.tasksExtracted) console.log(`  - Tasks already extracted`);
      if (after.extractionInProgress) console.log(`  - Extraction already in progress by onRecordingCreate`);
    }
  });

