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
    // The emulator runs on port 9000 and uses the format: http://localhost:9000/{project}/{region}/{function}/api/...
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "zeitlineai";
    const region = "us-central1";
    return `http://localhost:9000/${projectId}/${region}/api/calendars/google/callback`;
  }
  
  // If not in emulator, use environment variable if set
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  
  // For local development with request, construct from request
  // Note: In emulator, the request path already includes project/region, so we need to extract it
  if (req && req.headers.host) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    // Check if this is an emulator request (host contains port 9000)
    if (req.headers.host.includes(':9000')) {
      // Extract project and region from the request path if available
      // The path format is: /{project}/{region}/api/...
      const pathMatch = req.path?.match(/\/([^\/]+)\/([^\/]+)\/api/);
      if (pathMatch) {
        const projectId = pathMatch[1];
        const region = pathMatch[2];
        return `${protocol}://${req.headers.host}/${projectId}/${region}/api/calendars/google/callback`;
      }
      // Fallback to environment variables
      const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "zeitlineai";
      const region = "us-central1";
      return `${protocol}://${req.headers.host}/${projectId}/${region}/api/calendars/google/callback`;
    }
    return `${protocol}://${req.headers.host}/api/calendars/google/callback`;
  }
  
  // Production fallback
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

    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h2>✅ Google Calendar Connected!</h2>
          <p>Importing your events... This may take a moment.</p>
          <script>
            window.opener.postMessage({ type: 'calendar_connected', provider: 'google' }, '*');
            setTimeout(() => window.close(), 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Error in Google OAuth callback:", error);
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

    // Find which calendar this event belongs to
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

export default router;

