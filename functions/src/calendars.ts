import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { verifyAuth } from "./middleware/auth";
import { ApiResponse } from "./types";
import { Timestamp } from "firebase-admin/firestore";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

const router = Router();
const db = admin.firestore();

// Load Google OAuth credentials from JSON file or environment variables
let GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
let GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

// Try to load from credentials JSON file
try {
  // Try multiple possible paths
  const possiblePaths = [
    path.join(__dirname, "../google-credentials.json"), // When compiled to lib/
    path.join(__dirname, "../../google-credentials.json"), // When running from src/
    path.join(process.cwd(), "google-credentials.json"), // From functions root
  ];
  
  let credentialsPath = null;
  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
      credentialsPath = testPath;
      console.log(`Found credentials file at: ${credentialsPath}`);
      break;
    }
  }
  
  if (credentialsPath) {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    if (credentials.web) {
      GOOGLE_CLIENT_ID = credentials.web.client_id || GOOGLE_CLIENT_ID;
      GOOGLE_CLIENT_SECRET = credentials.web.client_secret || GOOGLE_CLIENT_SECRET;
      console.log("Loaded Google OAuth credentials from JSON file");
      console.log("Client ID:", GOOGLE_CLIENT_ID ? `${GOOGLE_CLIENT_ID.substring(0, 20)}...` : "NOT SET");
    } else {
      console.log("Credentials file found but missing 'web' property");
    }
  } else {
    console.log("Google credentials JSON file not found in any expected location");
  }
} catch (error) {
  console.error("Error loading Google credentials from JSON file:", error);
  console.log("Using environment variables instead");
}

// Use environment variable or construct from request for local dev
const getGoogleRedirectUri = (req?: any) => {
  // Check if running in emulator FIRST (before checking env var)
  // This ensures we use the correct local URL even if GOOGLE_REDIRECT_URI is set
  const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || 
                     process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
                     process.env.FIRESTORE_EMULATOR_HOST !== undefined;
  
  if (isEmulator) {
    // For emulator, use the emulator URL
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "zeitlineai";
    const region = "us-central1";
    return `http://localhost:9000/${projectId}/${region}/api/calendars/google/callback`;
  }
  
  // If not in emulator, use environment variable if set
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  
  // Always use the Cloud Functions URL in production
  // This ensures the redirect URI matches what's configured in Google Cloud Console
  return "https://us-central1-zeitlineai.cloudfunctions.net/api/calendars/google/callback";
};

// Microsoft Graph OAuth configuration
const MS_CLIENT_ID = process.env.MS_GRAPH_CLIENT_ID || "";
const MS_CLIENT_SECRET = process.env.MS_GRAPH_CLIENT_SECRET || "";
const MS_REDIRECT_URI = process.env.MS_REDIRECT_URI || "";

/**
 * GET /calendars/test
 * Test endpoint to verify calendar routes are working
 */
router.get("/test", (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Calendar routes are working",
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /calendars/list
 * Get all connected calendars for the user
 */
router.get("/list", verifyAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.uid) {
      console.error("User not authenticated in /list");
      res.status(401).json({
        success: false,
        error: "User not authenticated",
      } as ApiResponse);
      return;
    }
    
    const uid = req.user.uid;
    console.log("Listing calendars for user:", uid);
    
    const calendarsRef = db.collection("users").doc(uid).collection("calendars");
    const snapshot = await calendarsRef.get();

    const calendars = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.log(`Found ${calendars.length} calendars for user ${uid}`);
    res.json({
      success: true,
      data: calendars,
    } as ApiResponse);
  } catch (error: any) {
    console.error("Error listing calendars:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to list calendars: ${error.message || "Unknown error"}`,
    } as ApiResponse);
  }
});

/**
 * POST /calendars/google/connect
 * Initiate Google Calendar OAuth flow
 */
router.post("/google/connect", verifyAuth, async (req: Request, res: Response) => {
  console.log("POST /calendars/google/connect - Request received");
  console.log("Request method:", req.method);
  console.log("Request path:", req.path);
  console.log("Request URL:", req.url);
  console.log("Request host:", req.headers.host);
  console.log("Authorization header present:", !!req.headers.authorization);
  console.log("User authenticated:", !!req.user);
  console.log("GOOGLE_CLIENT_ID set:", !!GOOGLE_CLIENT_ID);
  console.log("GOOGLE_CLIENT_SECRET set:", !!GOOGLE_CLIENT_SECRET);
  console.log("Is emulator:", process.env.FUNCTIONS_EMULATOR === "true" || 
                     process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
                     process.env.FIRESTORE_EMULATOR_HOST !== undefined);
  
  try {
    if (!req.user || !req.user.uid) {
      console.error("User not authenticated");
      res.status(401).json({
        success: false,
        error: "User not authenticated",
      } as ApiResponse);
      return;
    }
    
    const uid = req.user.uid;
    console.log("User ID:", uid);

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error("Google credentials not configured. CLIENT_ID:", !!GOOGLE_CLIENT_ID, "CLIENT_SECRET:", !!GOOGLE_CLIENT_SECRET);
      res.status(500).json({
        success: false,
        error: "Google Calendar integration not configured. Please check server logs and ensure google-credentials.json exists or environment variables are set.",
      } as ApiResponse);
      return;
    }

    // Generate state token for OAuth
    const state = Buffer.from(`${uid}:${Date.now()}`).toString("base64");

    // Store state in Firestore for verification
    await db.collection("oauth_states").doc(state).set({
      uid,
      provider: "google",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000), // 10 minutes
    });

    const redirectUri = getGoogleRedirectUri(req);
    console.log("Redirect URI:", redirectUri);
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent("https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events")}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${state}`;

    console.log("Generated auth URL (first 100 chars):", authUrl.substring(0, 100) + "...");
    
    res.json({
      success: true,
      data: { authUrl },
    } as ApiResponse);
  } catch (error: any) {
    console.error("Error initiating Google OAuth:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      error: `Failed to initiate Google Calendar connection: ${error.message || "Unknown error"}`,
    } as ApiResponse);
  }
});

/**
 * GET /calendars/google/callback
 * Handle Google Calendar OAuth callback
 */
router.get("/google/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;
    console.log("Google OAuth callback received");
    console.log("Code present:", !!code);
    console.log("State present:", !!state);
    console.log("Error:", error);

    if (error) {
      res.send(`
        <html>
          <body>
            <h2>Authorization Failed</h2>
            <p>${error}</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      return;
    }

    if (!code || !state) {
      res.send(`
        <html>
          <body>
            <h2>Invalid Request</h2>
            <p>Missing authorization code or state</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      return;
    }

    // Verify state
    const stateDoc = await db.collection("oauth_states").doc(state as string).get();
    if (!stateDoc.exists) {
      res.send(`
        <html>
          <body>
            <h2>Invalid State</h2>
            <p>State token not found or expired</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      return;
    }

    const stateData = stateDoc.data()!;
    const uid = stateData.uid;

    // Delete state token
    await db.collection("oauth_states").doc(state as string).delete();

    // Get redirect URI (use same logic as in connect endpoint)
    const redirectUri = getGoogleRedirectUri(req);
    console.log("Using redirect URI:", redirectUri);
    
    // Exchange code for tokens
    const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get user's calendar list
    const calendarsResponse = await axios.get(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    // Store calendar connection
    const calendarData = {
      type: "google",
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Timestamp.fromMillis(Date.now() + expires_in * 1000),
      calendars: calendarsResponse.data.items.map((cal: any) => ({
        id: cal.id,
        name: cal.summary,
        selected: true, // Auto-select all calendars
      })),
      connectedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    await db
      .collection("users")
      .doc(uid)
      .collection("calendars")
      .doc("google")
      .set(calendarData, { merge: true });

    // Import all events in the background (don't wait for it)
    importAllGoogleCalendarEvents(uid, access_token, calendarsResponse.data.items).catch((err) => {
      console.error("Error importing Google Calendar events:", err);
    });

    // Determine the base URL for redirect
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || 
                       process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
                       process.env.FIRESTORE_EMULATOR_HOST !== undefined;
    const baseUrl = isEmulator ? "http://localhost:5500" : "https://zeitlineai.web.app";
    
    res.send(`
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; background: #0a0a0f; color: #fff;">
          <h2 style="color: #c9ff57;">✅ Google Calendar Connected!</h2>
          <p style="color: #888;">Importing your events... Redirecting back to calendar...</p>
          <script>
            // Try to notify opener if this was a popup
            if (window.opener) {
              window.opener.postMessage({ type: 'calendar_connected', provider: 'google' }, '*');
              setTimeout(() => window.close(), 1500);
            } else {
              // Redirect back to calendar page
              setTimeout(() => {
                window.location.href = '${baseUrl}/calendar.html?connected=google';
              }, 1500);
            }
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Error in Google OAuth callback:", error);
    
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
    const baseUrl = isEmulator ? "http://localhost:5500" : "https://zeitlineai.web.app";
    
    res.send(`
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; text-align: center; background: #0a0a0f; color: #fff;">
          <h2 style="color: #ff4444;">❌ Connection Failed</h2>
          <p style="color: #888;">${error.message || "An error occurred"}</p>
          <p><a href="${baseUrl}/calendar.html" style="color: #c9ff57;">Return to Calendar</a></p>
          <script>
            setTimeout(() => {
              if (window.opener) {
                window.close();
              } else {
                window.location.href = '${baseUrl}/calendar.html?error=connection_failed';
              }
            }, 3000);
          </script>
        </body>
      </html>
    `);
  }
});

/**
 * POST /calendars/outlook/connect
 * Initiate Microsoft Outlook OAuth flow
 */
router.post("/outlook/connect", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;

    if (!MS_CLIENT_ID || !MS_CLIENT_SECRET) {
      res.status(500).json({
        success: false,
        error: "Microsoft Outlook integration not configured",
      } as ApiResponse);
      return;
    }

    const state = Buffer.from(`${uid}:${Date.now()}`).toString("base64");

    await db.collection("oauth_states").doc(state).set({
      uid,
      provider: "outlook",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    });

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${MS_CLIENT_ID}&` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(MS_REDIRECT_URI)}&` +
      `response_mode=query&` +
      `scope=${encodeURIComponent("https://graph.microsoft.com/Calendars.Read offline_access")}&` +
      `state=${state}`;

    res.json({
      success: true,
      data: { authUrl },
    } as ApiResponse);
  } catch (error) {
    console.error("Error initiating Outlook OAuth:", error);
    res.status(500).json({
      success: false,
      error: "Failed to initiate Outlook connection",
    } as ApiResponse);
  }
});

/**
 * GET /calendars/outlook/callback
 * Handle Microsoft Outlook OAuth callback
 */
router.get("/outlook/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      res.send(`
        <html>
          <body>
            <h2>Authorization Failed</h2>
            <p>${error}</p>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      return;
    }

    if (!code || !state) {
      res.send(`
        <html>
          <body>
            <h2>Invalid Request</h2>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      return;
    }

    const stateDoc = await db.collection("oauth_states").doc(state as string).get();
    if (!stateDoc.exists) {
      res.send(`
        <html>
          <body>
            <h2>Invalid State</h2>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
        </html>
      `);
      return;
    }

    const stateData = stateDoc.data()!;
    const uid = stateData.uid;

    await db.collection("oauth_states").doc(state as string).delete();

    // Exchange code for tokens
    const tokenResponse = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        code: code as string,
        grant_type: "authorization_code",
        redirect_uri: MS_REDIRECT_URI,
      })
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get user's calendars
    const calendarsResponse = await axios.get(
      "https://graph.microsoft.com/v1.0/me/calendars",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    const calendarData = {
      type: "outlook",
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt: Timestamp.fromMillis(Date.now() + expires_in * 1000),
      calendars: calendarsResponse.data.value.map((cal: any) => ({
        id: cal.id,
        name: cal.name,
        selected: true,
      })),
      connectedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    await db
      .collection("users")
      .doc(uid)
      .collection("calendars")
      .doc("outlook")
      .set(calendarData, { merge: true });

    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h2>✅ Microsoft Outlook Connected!</h2>
          <p>You can close this window now.</p>
          <script>
            window.opener.postMessage({ type: 'calendar_connected', provider: 'outlook' }, '*');
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Error in Outlook OAuth callback:", error);
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h2>❌ Connection Failed</h2>
          <p>${error.message || "An error occurred"}</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  }
});

/**
 * POST /calendars/google/import
 * Manually trigger a full import of all Google Calendar events
 */
router.post("/google/import", verifyAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.uid) {
      res.status(401).json({
        success: false,
        error: "User not authenticated",
      } as ApiResponse);
      return;
    }
    
    const uid = req.user.uid;
    
    // Get Google Calendar connection
    const calendarDoc = await db
      .collection("users")
      .doc(uid)
      .collection("calendars")
      .doc("google")
      .get();
    
    if (!calendarDoc.exists) {
      res.status(404).json({
        success: false,
        error: "Google Calendar not connected",
      } as ApiResponse);
      return;
    }
    
    const calendar = calendarDoc.data()!;
    
    // Refresh token if needed
    let accessToken = calendar.accessToken;
    if (calendar.expiresAt.toMillis() < Date.now()) {
      accessToken = await refreshGoogleToken(calendar.refreshToken, uid);
    }
    
    // Start import in background
    importAllGoogleCalendarEvents(uid, accessToken, calendar.calendars || []).catch((err) => {
      console.error("Error importing Google Calendar events:", err);
    });
    
    res.json({
      success: true,
      message: "Event import started. This may take a few minutes.",
    } as ApiResponse);
  } catch (error: any) {
    console.error("Error triggering Google Calendar import:", error);
    res.status(500).json({
      success: false,
      error: `Failed to start import: ${error.message || "Unknown error"}`,
    } as ApiResponse);
  }
});

/**
 * POST /calendars/apple/connect
 * Connect Apple Calendar via CalDAV
 */
router.post("/apple/connect", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: "Email and password required",
      } as ApiResponse);
      return;
    }

    // Store Apple Calendar credentials (encrypted in production)
    const calendarData = {
      type: "apple",
      email,
      password, // TODO: Encrypt this
      caldavUrl: `https://caldav.icloud.com/`,
      connectedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    await db
      .collection("users")
      .doc(uid)
      .collection("calendars")
      .doc("apple")
      .set(calendarData, { merge: true });

    res.json({
      success: true,
      message: "Apple Calendar connected",
    } as ApiResponse);
  } catch (error) {
    console.error("Error connecting Apple Calendar:", error);
    res.status(500).json({
      success: false,
      error: "Failed to connect Apple Calendar",
    } as ApiResponse);
  }
});

/**
 * GET /calendars/events
 * Get calendar events for a date range
 */
router.get("/events", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { start, end } = req.query;

    if (!start || !end) {
      res.status(400).json({
        success: false,
        error: "Start and end dates required",
      } as ApiResponse);
      return;
    }

    const startDate = new Date(start as string);
    const endDate = new Date(end as string);

    // Get all connected calendars
    const calendarsRef = db.collection("users").doc(uid).collection("calendars");
    const snapshot = await calendarsRef.get();

    const allEvents: any[] = [];

    // Get ALL Zeitline-generated events (from onboarding AND from tasks)
    try {
      console.log(`Fetching Zeitline events for user ${uid} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
      
      const zeitlineEventsRef = db
        .collection("users")
        .doc(uid)
        .collection("calendar_events")
        .where("calendarType", "==", "zeitline");
      
      const zeitlineSnapshot = await zeitlineEventsRef.get();
      console.log(`Found ${zeitlineSnapshot.docs.length} Zeitline events in Firestore`);
      
      let addedEventsCount = 0;
      for (const doc of zeitlineSnapshot.docs) {
        const event = doc.data();
        
        // Process ALL Zeitline events (onboarding, task, or any other source)
        console.log(`Processing Zeitline event: ${event.title} (source: ${event.source}, start: ${event.start})`);
        
        // Check if event falls within date range
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end || event.start);
        
        // For recurring events, generate instances for the date range
        if (event.recurring) {
          const instances = generateRecurringInstances(
            event,
            startDate,
            endDate
          );
          console.log(`Generated ${instances.length} recurring instances for ${event.title}`);
          allEvents.push(...instances);
          addedEventsCount += instances.length;
        } else if (eventStart <= endDate && eventEnd >= startDate) {
          console.log(`Adding event: ${event.title}`);
          allEvents.push(event);
          addedEventsCount++;
        } else {
          console.log(`Event ${event.title} is outside date range (${eventStart.toISOString()} not in ${startDate.toISOString()} - ${endDate.toISOString()})`);
        }
      }
      
      console.log(`✅ Added ${addedEventsCount} Zeitline events to results`);
    } catch (error: any) {
      console.error("❌ Error loading Zeitline events:", error);
      console.error("Error stack:", error.stack);
    }

    for (const doc of snapshot.docs) {
      const calendar = doc.data();
      // If calendars array exists, filter by selected. Otherwise, use all calendars or default to primary.
      let selectedCalendars = calendar.calendars?.filter((c: any) => c.selected) || [];
      
      // If no calendars are selected but calendars array exists, select all by default
      if (selectedCalendars.length === 0 && calendar.calendars && calendar.calendars.length > 0) {
        console.log(`No calendars selected for user ${uid}, selecting all calendars by default`);
        selectedCalendars = calendar.calendars;
      }
      
      // If no calendars array at all, create a default one from the calendar connection
      if (selectedCalendars.length === 0 && calendar.type === "google") {
        console.log(`No calendars array found, using primary calendar for user ${uid}`);
        selectedCalendars = [{
          id: calendar.email || "primary",
          name: calendar.email || "Primary Calendar",
          selected: true
        }];
      }

      console.log(`Processing ${calendar.type} calendar connection, ${selectedCalendars.length} calendars selected`);

      if (calendar.type === "google") {
        // Check if events have been imported and are within the cached range
        const eventsImported = calendar.eventsImported || false;
        const lastImportRange = calendar.lastImportRange;
        const useCache = eventsImported && lastImportRange && 
                        startDate >= lastImportRange.start.toDate() && 
                        endDate <= lastImportRange.end.toDate();
        
        let cachedEventsCount = 0;
        if (useCache) {
          // Try to use cached events from Firestore
          try {
            const eventsRef = db.collection("users").doc(uid).collection("calendar_events");
            const calendarIds = selectedCalendars.map((c: any) => c.id);
            
            // Firestore "in" queries are limited to 10 items, so we need to batch if needed
            const cachedEvents: any[] = [];
            const batchSize = 10;
            
            for (let i = 0; i < calendarIds.length; i += batchSize) {
              const batchIds = calendarIds.slice(i, i + batchSize);
              const eventsSnapshot = await eventsRef
                .where("calendarType", "==", "google")
                .where("calendarId", "in", batchIds)
                .where("start", ">=", startDate.toISOString())
                .where("start", "<=", endDate.toISOString())
                .get();
              
              const batchEvents = eventsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                  id: data.id,
                  title: data.title,
                  description: data.description || "",
                  start: data.start,
                  end: data.end,
                  calendarType: data.calendarType,
                  calendarId: data.calendarId,
                  calendarName: data.calendarName,
                  location: data.location || "",
                  recurrence: data.recurrence || null,
                };
              });
              
              cachedEvents.push(...batchEvents);
            }
            
            cachedEventsCount = cachedEvents.length;
            allEvents.push(...cachedEvents);
            console.log(`Using ${cachedEvents.length} cached events from Firestore`);
          } catch (error: any) {
            console.error("Error fetching cached events:", error.message);
            // Fall through to API fetch
          }
        }
        
        // Always fetch from API if cache is empty or not available
        // This ensures events are available even if import is still in progress
        // We fetch from API if:
        // 1. Cache is not available (import not done yet)
        // 2. Cache is empty (no events found in cache)
        // 3. Date range is outside cached range
        if (!useCache || cachedEventsCount === 0) {
          console.log(`Fetching events from Google Calendar API (cache: ${useCache}, cached events: ${cachedEventsCount})`);
          
          // Refresh token if needed
          let accessToken = calendar.accessToken;
          if (calendar.expiresAt.toMillis() < Date.now()) {
            accessToken = await refreshGoogleToken(calendar.refreshToken, uid);
          }

          // Fetch events from each selected calendar with pagination support
          for (const cal of selectedCalendars) {
            try {
              let allCalendarEvents: any[] = [];
              let pageToken: string | undefined = undefined;
              
              // Fetch all pages of events
              do {
                const params: any = {
                  timeMin: startDate.toISOString(),
                  timeMax: endDate.toISOString(),
                  singleEvents: true,
                  orderBy: "startTime",
                  maxResults: 2500, // Google Calendar API max per page
                };
                
                if (pageToken) {
                  params.pageToken = pageToken;
                }
                
                const eventsResponse = await axios.get(
                  `https://www.googleapis.com/calendar/v3/calendars/${cal.id}/events`,
                  {
                    params,
                    headers: { Authorization: `Bearer ${accessToken}` },
                  }
                );

                const events = eventsResponse.data.items.map((event: any) => ({
                  id: event.id,
                  title: event.summary || "No title",
                  description: event.description || "",
                  start: event.start.dateTime || event.start.date,
                  end: event.end.dateTime || event.end.date,
                  calendarType: "google",
                  calendarId: cal.id,
                  calendarName: cal.name,
                  location: event.location || "",
                  recurrence: event.recurrence || null,
                }));

                allCalendarEvents.push(...events);
                pageToken = eventsResponse.data.nextPageToken;
              } while (pageToken);

              allEvents.push(...allCalendarEvents);
              console.log(`Fetched ${allCalendarEvents.length} events from calendar ${cal.name}`);
            } catch (error: any) {
              console.error(`Error fetching events from calendar ${cal.id}:`, error.message);
              console.error(`Error details:`, error.response?.data || error);
            }
          }
        }
      } else if (calendar.type === "outlook") {
        // Refresh token if needed
        let accessToken = calendar.accessToken;
        if (calendar.expiresAt.toMillis() < Date.now()) {
          accessToken = await refreshOutlookToken(calendar.refreshToken, uid);
        }

        for (const cal of selectedCalendars) {
          try {
            const eventsResponse = await axios.get(
              `https://graph.microsoft.com/v1.0/me/calendars/${cal.id}/events`,
              {
                params: {
                  $filter: `start/dateTime ge '${startDate.toISOString()}' and start/dateTime le '${endDate.toISOString()}'`,
                  $orderby: "start/dateTime",
                },
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );

            const events = eventsResponse.data.value.map((event: any) => ({
              id: event.id,
              title: event.subject || "No title",
              description: event.body?.content || "",
              start: event.start.dateTime,
              end: event.end.dateTime,
              calendarType: "outlook",
              calendarId: cal.id,
              calendarName: cal.name,
            }));

            allEvents.push(...events);
          } catch (error) {
            console.error(`Error fetching events from calendar ${cal.id}:`, error);
          }
        }
      } else if (calendar.type === "apple") {
        // Fetch events from Apple Calendar via CalDAV
        try {
          const events = await fetchAppleCalendarEvents(
            calendar.email,
            calendar.password,
            calendar.caldavUrl || "https://caldav.icloud.com/",
            startDate,
            endDate
          );

          const appleEvents = events.map((event: any) => ({
            id: event.id,
            title: event.title || "No title",
            description: event.description || "",
            start: event.start,
            end: event.end,
            calendarType: "apple",
            calendarId: "apple",
            calendarName: "Apple Calendar",
            location: event.location || "",
          }));

          allEvents.push(...appleEvents);
        } catch (error) {
          console.error("Error fetching Apple Calendar events:", error);
        }
      }
    }

    // Deduplicate events
    const deduplicatedEvents = deduplicateEvents(allEvents);

    // Sort events by start time
    deduplicatedEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    console.log(`Returning ${deduplicatedEvents.length} events for date range ${startDate.toISOString()} to ${endDate.toISOString()}`);

    res.json({
      success: true,
      data: deduplicatedEvents,
    } as ApiResponse);
  } catch (error) {
    console.error("Error fetching calendar events:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch calendar events",
    } as ApiResponse);
  }
});

/**
 * GET /calendars/events/:eventId
 * Get a specific calendar event
 */
router.get("/events/:eventId", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { eventId } = req.params;

    console.log(`Getting event ${eventId} for user ${uid}`);

    // First, check if this is a Zeitline event (stored in calendar_events collection)
    // Zeitline events have IDs starting with "zeitline_" or are stored in calendar_events with calendarType: "zeitline"
    if (eventId.startsWith("zeitline_")) {
      const zeitlineEventDoc = await db
        .collection("users")
        .doc(uid)
        .collection("calendar_events")
        .doc(eventId)
        .get();

      if (zeitlineEventDoc.exists) {
        const event = zeitlineEventDoc.data()!;
        console.log(`Found Zeitline event: ${event.title}`);
        return res.json({
          success: true,
          data: {
            id: eventId,
            title: event.title || "No title",
            description: event.description || "",
            start: event.start,
            end: event.end,
            calendarType: "zeitline",
            calendarId: "zeitline",
            calendarName: event.calendarName || "Zeitline",
            location: event.location || "",
            source: event.source || "",
            taskId: event.taskId || null,
            recurring: event.recurring || null,
          },
        } as ApiResponse);
      }
    }

    // Also try to find by document ID in calendar_events (for non-prefixed IDs)
    const calendarEventDoc = await db
      .collection("users")
      .doc(uid)
      .collection("calendar_events")
      .doc(eventId)
      .get();

    if (calendarEventDoc.exists) {
      const event = calendarEventDoc.data()!;
      if (event.calendarType === "zeitline") {
        console.log(`Found Zeitline event by direct ID: ${event.title}`);
        return res.json({
          success: true,
          data: {
            id: eventId,
            title: event.title || "No title",
            description: event.description || "",
            start: event.start,
            end: event.end,
            calendarType: "zeitline",
            calendarId: "zeitline",
            calendarName: event.calendarName || "Zeitline",
            location: event.location || "",
            source: event.source || "",
            taskId: event.taskId || null,
            recurring: event.recurring || null,
          },
        } as ApiResponse);
      }
    }

    // Find which calendar this event belongs to (external calendars)
    const calendarsRef = db.collection("users").doc(uid).collection("calendars");
    const snapshot = await calendarsRef.get();

    for (const doc of snapshot.docs) {
      const calendar = doc.data();
      const selectedCalendars = calendar.calendars?.filter((c: any) => c.selected) || [];

      if (calendar.type === "google") {
        let accessToken = calendar.accessToken;
        if (calendar.expiresAt.toMillis() < Date.now()) {
          accessToken = await refreshGoogleToken(calendar.refreshToken, uid);
        }

        for (const cal of selectedCalendars) {
          try {
            const eventResponse = await axios.get(
              `https://www.googleapis.com/calendar/v3/calendars/${cal.id}/events/${eventId}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );

            const event = eventResponse.data;
            return res.json({
              success: true,
              data: {
                id: event.id,
                title: event.summary || "No title",
                description: event.description || "",
                start: event.start.dateTime || event.start.date,
                end: event.end.dateTime || event.end.date,
                calendarType: "google",
                calendarId: cal.id,
                calendarName: cal.name,
              },
            } as ApiResponse);
          } catch (error) {
            // Event not found in this calendar, continue
          }
        }
      } else if (calendar.type === "outlook") {
        let accessToken = calendar.accessToken;
        if (calendar.expiresAt.toMillis() < Date.now()) {
          accessToken = await refreshOutlookToken(calendar.refreshToken, uid);
        }

        for (const cal of selectedCalendars) {
          try {
            const eventResponse = await axios.get(
              `https://graph.microsoft.com/v1.0/me/calendars/${cal.id}/events/${eventId}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );

            const event = eventResponse.data;
            return res.json({
              success: true,
              data: {
                id: event.id,
                title: event.subject || "No title",
                description: event.body?.content || "",
                start: event.start.dateTime,
                end: event.end.dateTime,
                calendarType: "outlook",
                calendarId: cal.id,
                calendarName: cal.name,
              },
            } as ApiResponse);
          } catch (error) {
            // Event not found in this calendar, continue
          }
        }
      } else if (calendar.type === "apple") {
        // For Apple Calendar, we'd need to query CalDAV again
        // This is a simplified implementation - in production, cache event data
        try {
          const startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 1);
          const endDate = new Date();
          endDate.setMonth(endDate.getMonth() + 1);
          
          const events = await fetchAppleCalendarEvents(
            calendar.email,
            calendar.password,
            calendar.caldavUrl || "https://caldav.icloud.com/",
            startDate,
            endDate
          );
          
          const event = events.find((e: any) => e.id === eventId);
          if (event) {
            return res.json({
              success: true,
              data: {
                id: event.id,
                title: event.title || "No title",
                description: event.description || "",
                start: event.start,
                end: event.end,
                calendarType: "apple",
                calendarId: "apple",
                calendarName: "Apple Calendar",
                location: event.location || "",
              },
            } as ApiResponse);
          }
        } catch (error) {
          // Event not found, continue
        }
      }
    }

    res.status(404).json({
      success: false,
      error: "Event not found",
    } as ApiResponse);
    return;
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch event",
    } as ApiResponse);
    return;
  }
});

/**
 * Import all events from Google Calendar (past 1 year to future 2 years)
 * This is called when a calendar is first connected
 */
async function importAllGoogleCalendarEvents(
  uid: string,
  accessToken: string,
  calendars: any[]
): Promise<void> {
  try {
    console.log(`Starting full import for user ${uid}, ${calendars.length} calendars`);
    
    // Set date range: 1 year ago to 2 years in the future
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 2);
    endDate.setHours(23, 59, 59, 999);
    
    let totalEventsImported = 0;
    
    // Import events from each calendar
    for (const cal of calendars) {
      try {
        let allCalendarEvents: any[] = [];
        let pageToken: string | undefined = undefined;
        
        // Fetch all pages of events
        do {
          const params: any = {
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 2500, // Google Calendar API max per page
          };
          
          if (pageToken) {
            params.pageToken = pageToken;
          }
          
          const eventsResponse = await axios.get(
            `https://www.googleapis.com/calendar/v3/calendars/${cal.id}/events`,
            {
              params,
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          const events = eventsResponse.data.items.map((event: any) => ({
            id: event.id,
            title: event.summary || "No title",
            description: event.description || "",
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            calendarType: "google",
            calendarId: cal.id,
            calendarName: cal.summary || cal.id,
            location: event.location || "",
            recurrence: event.recurrence || null,
            htmlLink: event.htmlLink || null,
            createdAt: Timestamp.now(),
          }));

          allCalendarEvents.push(...events);
          pageToken = eventsResponse.data.nextPageToken;
        } while (pageToken);
        
        // Store events in Firestore for efficient querying
        // Store in batches to avoid hitting Firestore limits
        const batchSize = 500;
        for (let i = 0; i < allCalendarEvents.length; i += batchSize) {
          const batch = db.batch();
          const batchEvents = allCalendarEvents.slice(i, i + batchSize);
          
          for (const event of batchEvents) {
            const eventRef = db
              .collection("users")
              .doc(uid)
              .collection("calendar_events")
              .doc(`${cal.id}_${event.id}`);
            batch.set(eventRef, event, { merge: true });
          }
          
          await batch.commit();
        }
        
        totalEventsImported += allCalendarEvents.length;
        console.log(`Imported ${allCalendarEvents.length} events from calendar ${cal.summary || cal.id}`);
      } catch (error: any) {
        console.error(`Error importing events from calendar ${cal.id}:`, error.message);
      }
    }
    
    // Update the calendar connection with import status
    await db
      .collection("users")
      .doc(uid)
      .collection("calendars")
      .doc("google")
      .update({
        eventsImported: true,
        eventsImportedAt: Timestamp.now(),
        totalEventsImported: totalEventsImported,
        lastImportRange: {
          start: Timestamp.fromDate(startDate),
          end: Timestamp.fromDate(endDate),
        },
      });
    
    console.log(`Completed full import for user ${uid}: ${totalEventsImported} total events`);
  } catch (error: any) {
    console.error("Error in importAllGoogleCalendarEvents:", error);
    throw error;
  }
}

// Helper function to refresh Google token
async function refreshGoogleToken(refreshToken: string, uid: string): Promise<string> {
  try {
    const response = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const { access_token, expires_in } = response.data;

    // Update stored token
    await db
      .collection("users")
      .doc(uid)
      .collection("calendars")
      .doc("google")
      .update({
        accessToken: access_token,
        expiresAt: Timestamp.fromMillis(Date.now() + expires_in * 1000),
        updatedAt: Timestamp.now(),
      });

    return access_token;
  } catch (error) {
    console.error("Error refreshing Google token:", error);
    throw error;
  }
}

// Helper function to refresh Outlook token
/**
 * Fetch Apple Calendar events via CalDAV
 */
async function fetchAppleCalendarEvents(
  email: string,
  password: string,
  caldavUrl: string,
  startDate: Date,
  endDate: Date
): Promise<any[]> {
  try {
    // Create basic auth header
    const auth = Buffer.from(`${email}:${password}`).toString("base64");

    // Discover calendars using PROPFIND
    const principalUrl = caldavUrl.replace(/\/$/, "") + "/";
    const calendarsResponse = await axios.request({
      method: "PROPFIND",
      url: principalUrl,
      headers: {
        Authorization: `Basic ${auth}`,
        Depth: "1",
        "Content-Type": "application/xml",
      },
      data: `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <c:calendar-description/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`,
    });

    // Parse calendar URLs from response (simplified - in production use proper XML parser)
    const calendarUrls: string[] = [];
    const responseText = calendarsResponse.data;
    
    // Extract calendar URLs using regex (simplified approach)
    const urlMatches = responseText.match(/<d:href>([^<]+)<\/d:href>/g);
    if (urlMatches) {
      urlMatches.forEach((match: string) => {
        const url = match.replace(/<\/?d:href>/g, "");
        if (url && url !== principalUrl && !url.endsWith("/")) {
          calendarUrls.push(url);
        }
      });
    }

    // If no calendars found, try default calendar path
    if (calendarUrls.length === 0) {
      calendarUrls.push(principalUrl + "calendars/");
    }

    const allEvents: any[] = [];

    // Fetch events from each calendar
    for (const calendarUrl of calendarUrls) {
      try {
        // Query events using CALDAV REPORT
        const reportResponse = await axios.request({
          method: "REPORT",
          url: calendarUrl,
          headers: {
            Authorization: `Basic ${auth}`,
            Depth: "1",
            "Content-Type": "application/xml",
          },
          data: `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${startDate.toISOString().replace(/[-:]/g, "").split(".")[0]}Z" end="${endDate.toISOString().replace(/[-:]/g, "").split(".")[0]}Z"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`,
        });

        // Parse iCalendar data from response
        const icalData = reportResponse.data;
        const events = parseICalendarEvents(icalData);
        allEvents.push(...events);
      } catch (error) {
        console.error(`Error fetching events from calendar ${calendarUrl}:`, error);
      }
    }

    return allEvents;
  } catch (error) {
    console.error("Error in fetchAppleCalendarEvents:", error);
    throw error;
  }
}

/**
 * Parse iCalendar (ICS) format events from CalDAV response
 */
function parseICalendarEvents(icalData: string): any[] {
  const events: any[] = [];
  
  // Simple iCalendar parser (for production, use a proper library like ical.js)
  const eventBlocks = icalData.split(/BEGIN:VEVENT/);
  
  for (let i = 1; i < eventBlocks.length; i++) {
    const eventBlock = eventBlocks[i].split(/END:VEVENT/)[0];
    const lines = eventBlock.split(/\r?\n/);
    
    let event: any = {
      id: "",
      title: "",
      description: "",
      start: "",
      end: "",
      location: "",
    };
    
    for (const line of lines) {
      if (line.startsWith("UID:")) {
        event.id = line.substring(4).trim();
      } else if (line.startsWith("SUMMARY:")) {
        event.title = line.substring(8).trim();
      } else if (line.startsWith("DESCRIPTION:")) {
        event.description = line.substring(12).trim().replace(/\\n/g, "\n");
      } else if (line.startsWith("DTSTART")) {
        const dateStr = line.split(":")[1]?.trim() || "";
        event.start = parseICalDate(dateStr);
      } else if (line.startsWith("DTEND")) {
        const dateStr = line.split(":")[1]?.trim() || "";
        event.end = parseICalDate(dateStr);
      } else if (line.startsWith("LOCATION:")) {
        event.location = line.substring(9).trim();
      }
    }
    
    if (event.id && event.start) {
      events.push(event);
    }
  }
  
  return events;
}

/**
 * Parse iCalendar date format to ISO string
 */
function parseICalDate(dateStr: string): string {
  // Handle both date-time (YYYYMMDDTHHMMSS) and date-only (YYYYMMDD) formats
  if (dateStr.length === 8) {
    // Date only: YYYYMMDD
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}T00:00:00Z`;
  } else if (dateStr.length >= 15) {
    // Date-time: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    const hour = dateStr.substring(9, 11);
    const minute = dateStr.substring(11, 13);
    const second = dateStr.substring(13, 15);
    const tz = dateStr.includes("Z") ? "Z" : "";
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${tz}`;
  }
  return dateStr;
}

async function refreshOutlookToken(refreshToken: string, uid: string): Promise<string> {
  try {
    const response = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        redirect_uri: MS_REDIRECT_URI,
      })
    );

    const { access_token, expires_in } = response.data;

    await db
      .collection("users")
      .doc(uid)
      .collection("calendars")
      .doc("outlook")
      .update({
        accessToken: access_token,
        expiresAt: Timestamp.fromMillis(Date.now() + expires_in * 1000),
        updatedAt: Timestamp.now(),
      });

    return access_token;
  } catch (error) {
    console.error("Error refreshing Outlook token:", error);
    throw error;
  }
}

/**
 * Deduplicate events from multiple calendars
 * Events are considered duplicates if they have:
 * - Same normalized title (case-insensitive, trimmed)
 * - Same start time (within 5 minutes)
 */
function deduplicateEvents(events: any[]): any[] {
  const seen = new Map<string, any>();
  const TIME_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

  for (const event of events) {
    // Normalize title for comparison
    const normalizedTitle = (event.title || "No title")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");

    const startTime = new Date(event.start).getTime();

    // Create a key based on normalized title and approximate start time
    // Round start time to nearest 5 minutes for comparison
    const roundedStartTime =
      Math.round(startTime / TIME_TOLERANCE_MS) * TIME_TOLERANCE_MS;
    const key = `${normalizedTitle}|${roundedStartTime}`;

    if (seen.has(key)) {
      // Event is a duplicate - merge information
      const existing = seen.get(key);
      
      // Merge calendar sources
      if (!existing.calendarSources) {
        existing.calendarSources = [
          {
            type: existing.calendarType,
            id: existing.calendarId,
            name: existing.calendarName,
          },
        ];
      }
      
      // Add this calendar as a source if not already present
      const sourceExists = existing.calendarSources.some(
        (s: any) =>
          s.type === event.calendarType && s.id === event.calendarId
      );
      
      if (!sourceExists) {
        existing.calendarSources.push({
          type: event.calendarType,
          id: event.calendarId,
          name: event.calendarName,
        });
      }

      // Use longer description if available
      if (
        event.description &&
        event.description.length > (existing.description?.length || 0)
      ) {
        existing.description = event.description;
      }

      // Update calendar type to show it's from multiple sources
      if (existing.calendarSources.length > 1) {
        existing.calendarType = "multiple";
      }
    } else {
      // New event - add it
      const newEvent = {
        ...event,
        calendarSources: [
          {
            type: event.calendarType,
            id: event.calendarId,
            name: event.calendarName,
          },
        ],
      };
      seen.set(key, newEvent);
    }
  }

  return Array.from(seen.values());
}

// Helper function to generate recurring event instances
function generateRecurringInstances(
  event: any,
  startDate: Date,
  endDate: Date
): any[] {
  const instances: any[] = [];
  const baseStart = new Date(event.start);
  const baseEnd = new Date(event.end || event.start);
  const duration = baseEnd.getTime() - baseStart.getTime();

  if (!event.recurring || event.recurring.frequency !== "weekly") {
    // For non-weekly or missing recurrence, just return the base event if in range
    if (baseStart <= endDate && baseEnd >= startDate) {
      return [event];
    }
    return [];
  }

  const daysOfWeek = event.recurring.daysOfWeek || [];
  if (daysOfWeek.length === 0) return [];

  // Generate instances for each occurrence in the date range
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, etc.

    if (daysOfWeek.includes(dayOfWeek)) {
      const instanceStart = new Date(currentDate);
      instanceStart.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0);

      const instanceEnd = new Date(instanceStart);
      instanceEnd.setTime(instanceStart.getTime() + duration);

      instances.push({
        ...event,
        id: `${event.id}_${instanceStart.toISOString()}`,
        start: instanceStart.toISOString(),
        end: instanceEnd.toISOString(),
        isRecurringInstance: true,
        originalEventId: event.id,
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return instances;
}

/**
 * POST /calendars/populate-from-onboarding-test
 * TEST ENDPOINT - Create recurring calendar events without auth
 * This is for development/testing only - remove in production!
 */
router.post("/populate-from-onboarding-test", async (req: Request, res: Response) => {
  try {
    // Use a test user ID or the provided one
    const uid = req.body.uid || "test-user-calendar";
    const { onboardingData } = req.body;

    console.log("🧪 TEST endpoint called - populate-from-onboarding-test");
    console.log("Using UID:", uid);

    if (!onboardingData) {
      res.status(400).json({
        success: false,
        error: "Onboarding data required",
      } as ApiResponse);
      return;
    }

    const routines = onboardingData.routines || {};
    const eventsCreated: any[] = [];

    // Helper to parse time string (e.g., "7:00 AM", "09:30", "17:00")
    function parseTime(timeStr: string): { hours: number; minutes: number } | null {
      if (!timeStr) return null;
      
      // Try different formats
      const formats = [
        /(\d{1,2}):(\d{2})\s*(AM|PM)/i, // "7:00 AM"
        /(\d{1,2}):(\d{2})/, // "07:00" or "7:00"
        /(\d{1,2})\s*(AM|PM)/i, // "7 AM"
      ];

      for (const format of formats) {
        const match = timeStr.match(format);
        if (match) {
          let hours = parseInt(match[1]);
          const minutes = match[2] ? parseInt(match[2]) : 0;
          const ampm = match[3]?.toUpperCase();

          if (ampm === "PM" && hours !== 12) hours += 12;
          if (ampm === "AM" && hours === 12) hours = 0;

          return { hours, minutes };
        }
      }

      return null;
    }

    // Helper to create recurring event
    function createRecurringEvent(
      title: string,
      time: string,
      duration: number, // in minutes
      daysOfWeek: number[], // 0 = Sunday, 1 = Monday, etc.
      startDate: Date = new Date()
    ) {
      const parsedTime = parseTime(time);
      if (!parsedTime) return null;

      const eventDate = new Date(startDate);
      eventDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
      
      const endDate = new Date(eventDate);
      endDate.setMinutes(endDate.getMinutes() + duration);

      return {
        title,
        start: eventDate.toISOString(),
        end: endDate.toISOString(),
        recurring: {
          frequency: "weekly",
          daysOfWeek,
          interval: 1,
        },
        calendarType: "zeitline",
        calendarName: "Zeitline Routines",
        source: "onboarding",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
    }

    const dayMap: { [key: string]: number } = {
      "sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3,
      "thursday": 4, "friday": 5, "saturday": 6
    };

    // Process weekday routines
    const weekdayRoutine = routines.weekday;
    if (weekdayRoutine) {
      const allWeekdays = [1, 2, 3, 4, 5]; // Monday to Friday
      const defaultDuration = 60; // 1 hour

      if (weekdayRoutine.wakeTime) {
        const event = createRecurringEvent("Wake Up", weekdayRoutine.wakeTime, 30, allWeekdays);
        if (event) eventsCreated.push(event);
      }
      if (weekdayRoutine.meals?.breakfast) {
        const event = createRecurringEvent("Breakfast", weekdayRoutine.meals.breakfast, defaultDuration, allWeekdays);
        if (event) eventsCreated.push(event);
      }
      if (weekdayRoutine.workStart && weekdayRoutine.workEnd) {
        const workStartTime = parseTime(weekdayRoutine.workStart);
        const workEndTime = parseTime(weekdayRoutine.workEnd);
        if (workStartTime && workEndTime) {
          const startMinutes = workStartTime.hours * 60 + workStartTime.minutes;
          const endMinutes = workEndTime.hours * 60 + workEndTime.minutes;
          const duration = endMinutes - startMinutes;
          if (duration > 0) {
            const event = createRecurringEvent("Work", weekdayRoutine.workStart, duration, allWeekdays);
            if (event) eventsCreated.push(event);
          }
        }
      }
      if (weekdayRoutine.meals?.lunch) {
        const event = createRecurringEvent("Lunch", weekdayRoutine.meals.lunch, defaultDuration, allWeekdays);
        if (event) eventsCreated.push(event);
      }
      if (weekdayRoutine.meals?.dinner) {
        const event = createRecurringEvent("Dinner", weekdayRoutine.meals.dinner, defaultDuration, allWeekdays);
        if (event) eventsCreated.push(event);
      }
      if (weekdayRoutine.exercise?.time && weekdayRoutine.exercise?.days?.length > 0) {
        const exerciseDays = weekdayRoutine.exercise.days.map((day: string) => dayMap[day.toLowerCase()]).filter((d: any) => d !== undefined);
        const duration = parseInt(weekdayRoutine.exercise.duration) || 60;
        const event = createRecurringEvent("Exercise", weekdayRoutine.exercise.time, duration, exerciseDays);
        if (event) eventsCreated.push(event);
      }
      if (weekdayRoutine.bedtime) {
        const event = createRecurringEvent("Bedtime", weekdayRoutine.bedtime, 30, allWeekdays);
        if (event) eventsCreated.push(event);
      }
    }

    // Process weekend routines
    const weekendRoutine = routines.weekend;
    if (weekendRoutine) {
      const allWeekends = [0, 6]; // Sunday and Saturday
      const defaultDuration = 60;

      if (weekendRoutine.wakeTime) {
        const event = createRecurringEvent("Weekend Wake Up", weekendRoutine.wakeTime, 30, allWeekends);
        if (event) eventsCreated.push(event);
      }
      if (weekendRoutine.meals?.breakfast) {
        const event = createRecurringEvent("Weekend Breakfast", weekendRoutine.meals.breakfast, defaultDuration, allWeekends);
        if (event) eventsCreated.push(event);
      }
      if (weekendRoutine.meals?.lunch) {
        const event = createRecurringEvent("Weekend Lunch", weekendRoutine.meals.lunch, defaultDuration, allWeekends);
        if (event) eventsCreated.push(event);
      }
      if (weekendRoutine.meals?.dinner) {
        const event = createRecurringEvent("Weekend Dinner", weekendRoutine.meals.dinner, defaultDuration, allWeekends);
        if (event) eventsCreated.push(event);
      }
      if (weekendRoutine.bedtime) {
        const event = createRecurringEvent("Weekend Bedtime", weekendRoutine.bedtime, 30, allWeekends);
        if (event) eventsCreated.push(event);
      }
    }

    // Save events to Firestore
    const batch = db.batch();
    for (const event of eventsCreated) {
      const eventRef = db.collection("users").doc(uid).collection("calendar_events").doc();
      batch.set(eventRef, event);
    }
    await batch.commit();

    // Mark calendar as populated from onboarding
    await db.collection("users").doc(uid).set({
      calendarPopulatedFromOnboarding: true,
      updatedAt: Timestamp.now(),
    }, { merge: true });

    console.log(`✅ TEST: Successfully created ${eventsCreated.length} events from onboarding for user ${uid}`);

    res.json({
      success: true,
      data: {
        eventsCreated: eventsCreated.length,
        events: eventsCreated, // Return events for verification
        message: "Calendar populated from onboarding data (TEST)",
      },
    });
  } catch (error: any) {
    console.error("Error in TEST populate-from-onboarding:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to populate calendar from onboarding",
    });
  }
});

/**
 * POST /calendars/populate-from-onboarding
 * Create recurring calendar events based on onboarding data
 */
router.post("/populate-from-onboarding", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { onboardingData } = req.body;

    if (!onboardingData) {
      res.status(400).json({
        success: false,
        error: "Onboarding data required",
      } as ApiResponse);
      return;
    }

    const routines = onboardingData.routines || {};
    const eventsCreated: any[] = [];

    // Helper to parse time string (e.g., "7:00 AM", "09:30", "17:00")
    function parseTime(timeStr: string): { hours: number; minutes: number } | null {
      if (!timeStr) return null;
      
      // Try different formats
      const formats = [
        /(\d{1,2}):(\d{2})\s*(AM|PM)/i, // "7:00 AM"
        /(\d{1,2}):(\d{2})/, // "07:00" or "7:00"
        /(\d{1,2})\s*(AM|PM)/i, // "7 AM"
      ];

      for (const format of formats) {
        const match = timeStr.match(format);
        if (match) {
          let hours = parseInt(match[1]);
          const minutes = match[2] ? parseInt(match[2]) : 0;
          const ampm = match[3]?.toUpperCase();

          if (ampm === "PM" && hours !== 12) hours += 12;
          if (ampm === "AM" && hours === 12) hours = 0;

          return { hours, minutes };
        }
      }

      return null;
    }

    // Helper to create recurring event
    function createRecurringEvent(
      title: string,
      time: string,
      duration: number, // in minutes
      daysOfWeek: number[], // 0 = Sunday, 1 = Monday, etc.
      startDate: Date = new Date()
    ) {
      const parsedTime = parseTime(time);
      if (!parsedTime) return null;

      const eventDate = new Date(startDate);
      eventDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
      
      const endDate = new Date(eventDate);
      endDate.setMinutes(endDate.getMinutes() + duration);

      return {
        title,
        start: eventDate.toISOString(),
        end: endDate.toISOString(),
        recurring: {
          frequency: "weekly",
          daysOfWeek,
        },
        calendarType: "zeitline",
        calendarName: "Zeitline Routine",
        source: "onboarding",
      };
    }

    // Create weekday events
    if (routines.weekday) {
      const weekday = routines.weekday;
      const weekdays = [1, 2, 3, 4, 5]; // Monday to Friday

      // Wake up time
      if (weekday.wakeTime) {
        const event = createRecurringEvent("Wake Up", weekday.wakeTime, 0, weekdays);
        if (event) eventsCreated.push(event);
      }

      // Breakfast
      if (weekday.meals?.breakfast) {
        const event = createRecurringEvent("Breakfast", weekday.meals.breakfast, 30, weekdays);
        if (event) eventsCreated.push(event);
      }

      // Work start
      if (weekday.workStart) {
        const event = createRecurringEvent("Work Start", weekday.workStart, 0, weekdays);
        if (event) eventsCreated.push(event);
      }

      // Lunch
      if (weekday.meals?.lunch) {
        const event = createRecurringEvent("Lunch", weekday.meals.lunch, 60, weekdays);
        if (event) eventsCreated.push(event);
      }

      // Work end
      if (weekday.workEnd) {
        const event = createRecurringEvent("Work End", weekday.workEnd, 0, weekdays);
        if (event) eventsCreated.push(event);
      }

      // Exercise
      if (weekday.exercise?.time && weekday.exercise?.days) {
        const exerciseDays = weekday.exercise.days.map((day: string) => {
          const dayMap: Record<string, number> = {
            Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
            Thursday: 4, Friday: 5, Saturday: 6
          };
          return dayMap[day] ?? 1;
        });
        const duration = parseInt(weekday.exercise.duration) || 60;
        const event = createRecurringEvent(
          "Exercise",
          weekday.exercise.time,
          duration,
          exerciseDays
        );
        if (event) eventsCreated.push(event);
      }

      // Dinner
      if (weekday.meals?.dinner) {
        const event = createRecurringEvent("Dinner", weekday.meals.dinner, 60, weekdays);
        if (event) eventsCreated.push(event);
      }

      // Bedtime
      if (weekday.bedtime) {
        const event = createRecurringEvent("Bedtime", weekday.bedtime, 0, weekdays);
        if (event) eventsCreated.push(event);
      }
    }

    // Create weekend events
    if (routines.weekend) {
      const weekend = routines.weekend;
      const weekendDays = [0, 6]; // Sunday and Saturday

      // Wake up time
      if (weekend.wakeTime) {
        const event = createRecurringEvent("Wake Up (Weekend)", weekend.wakeTime, 0, weekendDays);
        if (event) eventsCreated.push(event);
      }

      // Meals
      if (weekend.meals) {
        if (weekend.meals.breakfast) {
          const event = createRecurringEvent("Breakfast (Weekend)", weekend.meals.breakfast, 30, weekendDays);
          if (event) eventsCreated.push(event);
        }
        if (weekend.meals.lunch) {
          const event = createRecurringEvent("Lunch (Weekend)", weekend.meals.lunch, 60, weekendDays);
          if (event) eventsCreated.push(event);
        }
        if (weekend.meals.dinner) {
          const event = createRecurringEvent("Dinner (Weekend)", weekend.meals.dinner, 60, weekendDays);
          if (event) eventsCreated.push(event);
        }
      }

      // Bedtime
      if (weekend.bedtime) {
        const event = createRecurringEvent("Bedtime (Weekend)", weekend.bedtime, 0, weekendDays);
        if (event) eventsCreated.push(event);
      }
    }

    // Store events in Firestore
    const eventsRef = db.collection("users").doc(uid).collection("calendar_events");
    const batch = db.batch();

    console.log(`Creating ${eventsCreated.length} calendar events for user ${uid}`);

    for (const event of eventsCreated) {
      const eventId = `zeitline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const eventRef = eventsRef.doc(eventId);
      const eventData = {
        ...event,
        id: eventId,
        userId: uid,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      
      console.log(`Creating event: ${event.title} at ${event.start}`);
      batch.set(eventRef, eventData);
    }

    await batch.commit();
    console.log(`✅ Successfully created ${eventsCreated.length} events in Firestore`);

    res.json({
      success: true,
      data: {
        eventsCreated: eventsCreated.length,
        events: eventsCreated,
      },
    } as ApiResponse);
  } catch (error: any) {
    console.error("Error populating calendar from onboarding:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to populate calendar",
    } as ApiResponse);
  }
});

/**
 * POST /calendars/suggest-time
 * Find the first available time slot in user's calendar (9 AM - 10 PM)
 * Returns date/time strings in user's local timezone
 */
router.post("/suggest-time", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { taskTitle, taskDuration, timezoneOffset, excludeSlots } = req.body;

    // Default duration to 60 minutes if not specified
    const duration = taskDuration || 60;
    
    // timezoneOffset is in minutes (e.g., PST is 480, EST is 300)
    // Negative offset means ahead of UTC (e.g., India is -330)
    const offsetMs = (timezoneOffset || 0) * 60 * 1000;
    
    // Get current time in user's timezone
    const nowUTC = new Date();
    const nowLocal = new Date(nowUTC.getTime() - offsetMs);

    console.log(`Finding time slot for task: "${taskTitle}", duration: ${duration} mins`);
    console.log(`User timezone offset: ${timezoneOffset} mins, Local time: ${nowLocal.toISOString()}`);

    // Fetch all calendar events
    const eventsRef = db.collection("users").doc(uid).collection("calendar_events");
    const eventsSnapshot = await eventsRef.get();

    const allEvents: Array<{start: Date; end: Date; title: string}> = [];
    
    eventsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.start && data.end) {
        const startDate = new Date(data.start);
        const endDate = new Date(data.end);
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          allEvents.push({
            start: startDate,
            end: endDate,
            title: data.title || 'Event'
          });
        }
      }
    });

    // Also add excluded slots (events we just scheduled in this session but not yet in DB)
    if (excludeSlots && Array.isArray(excludeSlots)) {
      console.log(`Adding ${excludeSlots.length} excluded slots from current session`);
      for (const slot of excludeSlots) {
        if (slot.start && slot.end) {
          const startDate = new Date(slot.start);
          const endDate = new Date(slot.end);
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            allEvents.push({
              start: startDate,
              end: endDate,
              title: 'Reserved (just scheduled)'
            });
          }
        }
      }
    }

    console.log(`Found ${allEvents.length} total events to avoid (including ${excludeSlots?.length || 0} just scheduled)`);

    // Sort events by start time
    allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Helper function to check if a time slot conflicts with existing events
    const hasConflict = (slotStart: Date, slotEnd: Date): boolean => {
      for (const event of allEvents) {
        if (slotStart < event.end && slotEnd > event.start) {
          return true;
        }
      }
      return false;
    };

    // Helper to format date as YYYY-MM-DD
    const formatDate = (d: Date): string => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Helper to format time as HH:MM
    const formatTime = (hour: number, minute: number = 0): string => {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    };

    // Working hours: 9 AM to 10 PM
    const WORK_START_HOUR = 9;
    const WORK_END_HOUR = 22;
    
    // Get current hour in user's local time
    const currentLocalHour = nowLocal.getUTCHours();
    
    let foundSlot = false;
    let resultDate = "";
    let resultStartTime = "";
    let resultEndTime = "";
    let reason = "";

    // Search for the next 14 days
    for (let dayOffset = 0; dayOffset < 14 && !foundSlot; dayOffset++) {
      const checkDate = new Date(nowLocal);
      checkDate.setUTCDate(nowLocal.getUTCDate() + dayOffset);
      
      // Skip weekends (0 = Sunday, 6 = Saturday)
      const dayOfWeek = checkDate.getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      // Determine start hour for this day
      let startHour = WORK_START_HOUR;
      if (dayOffset === 0) {
        // Today - start from next available hour
        startHour = Math.max(WORK_START_HOUR, currentLocalHour + 1);
      }

      // Try each hour from start to 10 PM
      for (let hour = startHour; hour <= WORK_END_HOUR - 1 && !foundSlot; hour++) {
        // Calculate end hour based on duration
        const endMinutes = hour * 60 + duration;
        const endHour = Math.floor(endMinutes / 60);
        const endMin = endMinutes % 60;
        
        // Make sure slot doesn't extend past 10 PM
        if (endHour > WORK_END_HOUR || (endHour === WORK_END_HOUR && endMin > 0)) {
          continue;
        }
        
        // Create slot times for conflict checking (in UTC for comparison with stored events)
        const slotStartUTC = new Date(checkDate);
        slotStartUTC.setUTCHours(hour, 0, 0, 0);
        // Convert local time back to UTC for comparison
        const slotStartForCheck = new Date(slotStartUTC.getTime() + offsetMs);
        
        const slotEndUTC = new Date(slotStartUTC);
        slotEndUTC.setUTCMinutes(slotEndUTC.getUTCMinutes() + duration);
        const slotEndForCheck = new Date(slotEndUTC.getTime() + offsetMs);
        
        // Check if this slot is available
        if (!hasConflict(slotStartForCheck, slotEndForCheck)) {
          foundSlot = true;
          
          // Format the result in user's local time
          resultDate = formatDate(checkDate);
          resultStartTime = formatTime(hour);
          resultEndTime = formatTime(endHour, endMin);
          
          // Generate a reason
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayName = dayNames[dayOfWeek];
          const timeStr = hour <= 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
          
          if (dayOffset === 0) {
            reason = `First available slot today at ${timeStr}`;
          } else if (dayOffset === 1) {
            reason = `First available slot tomorrow at ${timeStr}`;
          } else {
            reason = `First available slot on ${dayName} at ${timeStr}`;
          }
          
          if (hour >= 9 && hour < 12) {
            reason += " - great time for focused work";
          } else if (hour >= 14 && hour < 17) {
            reason += " - ideal for meetings and collaboration";
          }
          
          console.log(`Found available slot: ${resultDate} ${resultStartTime} - ${resultEndTime}`);
          break;
        }
      }
    }

    // If no slot found, default to tomorrow at 10 AM
    if (!foundSlot) {
      console.log("No available slots found, using default (tomorrow 10 AM)");
      const tomorrow = new Date(nowLocal);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      
      resultDate = formatDate(tomorrow);
      resultStartTime = "10:00";
      const endHour = Math.floor((10 * 60 + duration) / 60);
      const endMin = (10 * 60 + duration) % 60;
      resultEndTime = formatTime(endHour, endMin);
      reason = "Suggested tomorrow morning at 10:00 AM - great time for focused work";
    }

    console.log(`Returning: ${resultDate} ${resultStartTime} - ${resultEndTime}`);

    res.json({
      success: true,
      data: {
        startDate: resultDate,
        startTime: resultStartTime,
        endDate: resultDate,
        endTime: resultEndTime,
        reason: reason
      }
    });

  } catch (error: any) {
    console.error("Error suggesting time:", error);
    
    // On error, return tomorrow at 10 AM
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    
    res.json({
      success: true,
      data: {
        startDate: `${year}-${month}-${day}`,
        startTime: "10:00",
        endDate: `${year}-${month}-${day}`,
        endTime: "11:00",
        reason: "Suggested tomorrow morning at 10:00 AM"
      }
    });
  }
});

/**
 * POST /calendars/events
 * Create a new calendar event
 */
router.post("/events", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { title, description, start, end, location, taskId } = req.body;

    if (!title || !start || !end) {
      res.status(400).json({ 
        success: false, 
        error: "Title, start, and end are required" 
      });
      return;
    }

    const eventId = `zeitline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const eventData = {
      id: eventId,
      title,
      description: description || "",
      start,
      end,
      location: location || null,
      calendarType: "zeitline",
      calendarName: "Zeitline",
      source: "task",
      taskId: taskId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save to Firestore
    await db.collection("users").doc(uid)
      .collection("calendar_events").doc(eventId)
      .set(eventData);

    // If taskId provided, update the task to mark it as added to calendar
    if (taskId) {
      const taskListRef = db.collection("users").doc(uid)
        .collection("taskLists").doc("master");
      
      const taskListDoc = await taskListRef.get();
      if (taskListDoc.exists) {
        const tasks = taskListDoc.data()?.tasks || [];
        const updatedTasks = tasks.map((t: any) => 
          t.id === taskId ? { ...t, addedToCalendar: true, calendarEventId: eventId } : t
        );
        await taskListRef.update({ tasks: updatedTasks });
      }
    }

    console.log(`✅ Created calendar event: ${title} for user ${uid}`);

    res.json({
      success: true,
      data: {
        event: eventData
      }
    });

  } catch (error: any) {
    console.error("Error creating calendar event:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to create event"
    });
  }
});

/**
 * PUT /calendars/events/:eventId
 * Update a Zeitline calendar event
 */
router.put("/events/:eventId", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { eventId } = req.params;
    const { title, description, start, end, location } = req.body;

    console.log(`Updating event ${eventId} for user ${uid}`);

    // Check if the event exists and is a Zeitline event
    const eventRef = db.collection("users").doc(uid).collection("calendar_events").doc(eventId);
    const eventDoc = await eventRef.get();

    if (!eventDoc.exists) {
      console.log(`Event ${eventId} not found`);
      res.status(404).json({
        success: false,
        error: "Event not found",
      } as ApiResponse);
      return;
    }

    const existingEvent = eventDoc.data()!;
    
    // Only allow editing Zeitline events
    if (existingEvent.calendarType !== "zeitline") {
      console.log(`Event ${eventId} is not a Zeitline event (type: ${existingEvent.calendarType})`);
      res.status(403).json({
        success: false,
        error: "Cannot edit events from external calendars. Please edit them in the original calendar app.",
      } as ApiResponse);
      return;
    }

    // Build update object with only provided fields
    const updateData: any = {
      updatedAt: new Date().toISOString(),
    };

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (start !== undefined) updateData.start = start;
    if (end !== undefined) updateData.end = end;
    if (location !== undefined) updateData.location = location;

    // Update the event
    await eventRef.update(updateData);

    // Get the updated event
    const updatedEventDoc = await eventRef.get();
    const updatedEvent = updatedEventDoc.data()!;

    console.log(`✅ Updated calendar event: ${updatedEvent.title} for user ${uid}`);

    res.json({
      success: true,
      data: {
        event: {
          id: eventId,
          ...updatedEvent,
        },
      },
    } as ApiResponse);

  } catch (error: any) {
    console.error("Error updating calendar event:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update event",
    } as ApiResponse);
  }
});

/**
 * DELETE /calendars/events/:eventId
 * Delete a Zeitline calendar event
 */
router.delete("/events/:eventId", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { eventId } = req.params;

    console.log(`Deleting event ${eventId} for user ${uid}`);

    // Check if the event exists
    const eventRef = db.collection("users").doc(uid).collection("calendar_events").doc(eventId);
    const eventDoc = await eventRef.get();

    if (!eventDoc.exists) {
      console.log(`Event ${eventId} not found`);
      res.status(404).json({
        success: false,
        error: "Event not found",
      } as ApiResponse);
      return;
    }

    const existingEvent = eventDoc.data()!;
    
    // Only allow deleting Zeitline events
    if (existingEvent.calendarType !== "zeitline") {
      console.log(`Event ${eventId} is not a Zeitline event (type: ${existingEvent.calendarType})`);
      res.status(403).json({
        success: false,
        error: "Cannot delete events from external calendars. Please delete them in the original calendar app.",
      } as ApiResponse);
      return;
    }

    const eventTitle = existingEvent.title;
    const taskId = existingEvent.taskId;

    // Delete the event
    await eventRef.delete();

    // If this event was linked to a task, update the task
    if (taskId) {
      try {
        const taskListRef = db.collection("users").doc(uid).collection("taskLists").doc("master");
        const taskListDoc = await taskListRef.get();
        
        if (taskListDoc.exists) {
          const tasks = taskListDoc.data()?.tasks || [];
          const updatedTasks = tasks.map((t: any) => {
            if (t.id === taskId) {
              return {
                ...t,
                addedToCalendar: false,
                calendarEventId: null,
              };
            }
            return t;
          });
          await taskListRef.update({ tasks: updatedTasks });
          console.log(`Updated task ${taskId} to remove calendar link`);
        }
      } catch (taskError) {
        console.error("Error updating task after event deletion:", taskError);
        // Don't fail the delete operation if task update fails
      }
    }

    console.log(`✅ Deleted calendar event: ${eventTitle} for user ${uid}`);

    res.json({
      success: true,
      data: {
        message: "Event deleted successfully",
        eventId: eventId,
      },
    } as ApiResponse);

  } catch (error: any) {
    console.error("Error deleting calendar event:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to delete event",
    } as ApiResponse);
  }
});

/**
 * POST /calendars/fix-overlaps
 * Find and fix overlapping Zeitline events by rescheduling them
 * Considers ALL calendar events (Google, Apple, Outlook, Zeitline) when finding conflicts
 */
router.post("/fix-overlaps", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const { timezoneOffset } = req.body;
    
    const offsetMs = (timezoneOffset || 0) * 60 * 1000;
    const nowUTC = new Date();
    const nowLocal = new Date(nowUTC.getTime() - offsetMs);

    console.log(`Checking for overlapping events for user ${uid}`);

    // Fetch ALL calendar events (Zeitline + Google + Apple + Outlook)
    const eventsRef = db.collection("users").doc(uid).collection("calendar_events");
    const allEventsSnapshot = await eventsRef.get();

    interface CalendarEvent {
      id: string;
      start: Date;
      end: Date;
      title: string;
      calendarType: string;
      docRef: FirebaseFirestore.DocumentReference | null;
      isZeitline: boolean;
    }

    const allEvents: CalendarEvent[] = [];
    const zeitlineEvents: CalendarEvent[] = [];
    
    allEventsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.start && data.end) {
        const startDate = new Date(data.start);
        const endDate = new Date(data.end);
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          const event: CalendarEvent = {
            id: doc.id,
            start: startDate,
            end: endDate,
            title: data.title || 'Event',
            calendarType: data.calendarType || 'unknown',
            docRef: doc.ref,
            isZeitline: data.calendarType === 'zeitline'
          };
          allEvents.push(event);
          if (event.isZeitline) {
            zeitlineEvents.push(event);
          }
        }
      }
    });

    console.log(`Found ${allEvents.length} total events (${zeitlineEvents.length} Zeitline, ${allEvents.length - zeitlineEvents.length} external)`);

    // Sort by start time
    allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Find Zeitline events that overlap with ANY other event (including external calendars)
    const overlappingZeitlineEvents = new Set<string>();
    const overlaps: Array<{zeitlineEvent: CalendarEvent; conflictsWith: CalendarEvent}> = [];
    
    for (const zeitlineEvent of zeitlineEvents) {
      for (const otherEvent of allEvents) {
        // Don't compare with itself
        if (zeitlineEvent.id === otherEvent.id) continue;
        
        // Check if they overlap
        if (zeitlineEvent.start < otherEvent.end && zeitlineEvent.end > otherEvent.start) {
          overlaps.push({ zeitlineEvent, conflictsWith: otherEvent });
          overlappingZeitlineEvents.add(zeitlineEvent.id);
        }
      }
    }

    console.log(`Found ${overlaps.length} overlaps involving Zeitline events`);

    if (overlaps.length === 0) {
      res.json({
        success: true,
        data: {
          message: "No overlapping events found!",
          overlapsFixed: 0
        }
      });
      return;
    }

    // Collect unique Zeitline events that need to be rescheduled
    const eventsToReschedule = Array.from(overlappingZeitlineEvents);
    console.log(`Need to reschedule ${eventsToReschedule.length} Zeitline events`);

    // Helper functions
    const formatDate = (d: Date): string => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const formatTime = (hour: number, minute: number = 0): string => {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    };

    // Build list of fixed events (ALL events not being rescheduled - includes external calendars)
    const fixedEvents: Array<{start: Date; end: Date; title: string}> = allEvents
      .filter(e => !eventsToReschedule.includes(e.id))
      .map(e => ({ start: e.start, end: e.end, title: e.title }));

    console.log(`Fixed events to avoid: ${fixedEvents.length} (including ${allEvents.length - zeitlineEvents.length} from external calendars)`);

    // Reschedule each conflicting Zeitline event
    let rescheduledCount = 0;
    const WORK_START_HOUR = 9;
    const WORK_END_HOUR = 22;

    for (const eventId of eventsToReschedule) {
      const event = zeitlineEvents.find(e => e.id === eventId);
      if (!event || !event.docRef) continue;

      // Calculate duration
      const durationMs = event.end.getTime() - event.start.getTime();
      const durationMins = Math.max(60, Math.round(durationMs / 60000)); // At least 60 mins

      // Find next available slot
      let foundSlot = false;
      let newStartDate = "";
      let newStartTime = "";
      let newEndTime = "";

      // Start searching from today
      for (let dayOffset = 0; dayOffset < 30 && !foundSlot; dayOffset++) {
        const checkDate = new Date(nowLocal);
        checkDate.setUTCDate(nowLocal.getUTCDate() + dayOffset);
        
        // Skip weekends
        const dayOfWeek = checkDate.getUTCDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        // Determine start hour for this day
        let startHour = WORK_START_HOUR;
        if (dayOffset === 0) {
          startHour = Math.max(WORK_START_HOUR, nowLocal.getUTCHours() + 1);
        }

        // Try each hour
        for (let hour = startHour; hour <= WORK_END_HOUR - 1 && !foundSlot; hour++) {
          const endMinutes = hour * 60 + durationMins;
          const endHour = Math.floor(endMinutes / 60);
          const endMin = endMinutes % 60;

          if (endHour > WORK_END_HOUR || (endHour === WORK_END_HOUR && endMin > 0)) continue;

          // Create slot times for checking
          const slotStart = new Date(checkDate);
          slotStart.setUTCHours(hour, 0, 0, 0);
          const slotStartForCheck = new Date(slotStart.getTime() + offsetMs);

          const slotEnd = new Date(slotStart);
          slotEnd.setUTCMinutes(slotEnd.getUTCMinutes() + durationMins);
          const slotEndForCheck = new Date(slotEnd.getTime() + offsetMs);

          // Check for conflicts with fixed events
          let hasConflict = false;
          for (const fixed of fixedEvents) {
            if (slotStartForCheck < fixed.end && slotEndForCheck > fixed.start) {
              hasConflict = true;
              break;
            }
          }

          if (!hasConflict) {
            foundSlot = true;
            newStartDate = formatDate(checkDate);
            newStartTime = formatTime(hour);
            newEndTime = formatTime(endHour, endMin);

            // Add this to fixed events so subsequent events don't overlap
            fixedEvents.push({
              start: slotStartForCheck,
              end: slotEndForCheck,
              title: event.title
            });
          }
        }
      }

      if (foundSlot) {
        // Update the event in Firestore
        const newStart = `${newStartDate}T${newStartTime}:00`;
        const newEnd = `${newStartDate}T${newEndTime}:00`;

        await event.docRef.update({
          start: newStart,
          end: newEnd,
          updatedAt: new Date().toISOString(),
          rescheduledAt: new Date().toISOString(),
          rescheduledReason: "Overlap fix"
        });

        console.log(`Rescheduled "${event.title}" to ${newStart} - ${newEnd}`);
        rescheduledCount++;
      } else {
        console.warn(`Could not find slot for "${event.title}"`);
      }
    }

    res.json({
      success: true,
      data: {
        message: `Fixed ${rescheduledCount} overlapping events`,
        overlapsFound: overlaps.length,
        overlapsFixed: rescheduledCount,
        eventsRescheduled: Array.from(eventsToReschedule)
      }
    });

  } catch (error: any) {
    console.error("Error fixing overlaps:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fix overlaps"
    });
  }
});

/**
 * DELETE /calendars/clear-cache
 * Clear all cached calendar events from Firestore
 * This removes demo/test events and forces a fresh sync from connected calendars
 */
router.delete("/clear-cache", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    
    console.log(`Clearing cached calendar events for user ${uid}`);
    
    // Get all events in the calendar_events subcollection
    const eventsRef = db.collection("users").doc(uid).collection("calendar_events");
    const snapshot = await eventsRef.get();
    
    if (snapshot.empty) {
      res.json({
        success: true,
        data: {
          message: "No cached events to clear",
          deletedCount: 0
        }
      });
      return;
    }
    
    // Delete in batches (Firestore limit is 500 per batch)
    const batchSize = 500;
    let deletedCount = 0;
    const docs = snapshot.docs;
    
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      const batchDocs = docs.slice(i, i + batchSize);
      
      batchDocs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      deletedCount += batchDocs.length;
    }
    
    console.log(`✅ Deleted ${deletedCount} cached calendar events for user ${uid}`);
    
    res.json({
      success: true,
      data: {
        message: `Successfully cleared ${deletedCount} cached events`,
        deletedCount
      }
    });
    
  } catch (error: any) {
    console.error("Error clearing calendar cache:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to clear calendar cache"
    });
  }
});

export default router;

