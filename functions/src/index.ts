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

// Mount routes
app.use("/users", usersRouter);
app.use("/stripe", stripeRouter);
app.use("/calendars", calendarsRouter);
app.use("/ai-assistant", aiAssistantRouter);
app.use("/nutrition", nutritionRouter);
app.use("/onboarding", onboardingChatRouter);

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

