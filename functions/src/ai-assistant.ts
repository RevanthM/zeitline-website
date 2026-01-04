import express, { Request, Response } from "express";
import { OpenAI } from "openai";
import * as admin from "firebase-admin";
import { verifyAuth } from "./middleware/auth";

const router = express.Router();
const db = admin.firestore();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Types for recurring event patterns
interface RecurringPattern {
  frequency: "daily" | "weekly" | "monthly" | "yearly" | "custom";
  interval?: number; // e.g., every 2 weeks = interval: 2
  daysOfWeek?: number[]; // 0 = Sunday, 1 = Monday, etc.
  dayOfMonth?: number; // For monthly patterns
  weekOfMonth?: number; // 1-5 for "first Monday", "last Friday", etc.
  endDate?: string; // ISO string
  occurrences?: number; // Number of occurrences
  timezone?: string;
}

interface AISuggestion {
  shouldRecur: boolean;
  confidence: number; // 0-1
  pattern?: RecurringPattern;
  reasoning?: string;
  naturalLanguagePattern?: string; // User's original request
}

interface EventAnalysis {
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  existingPattern?: RecurringPattern;
}

// System prompt for recurring event AI
const RECURRING_EVENTS_SYSTEM_PROMPT = `You are Zeitline, a friendly and intelligent AI calendar assistant specializing in recurring events.

Your role is to:
1. Analyze event details and suggest if they should be recurring
2. Parse natural language requests into structured recurring patterns
3. Learn from user behavior to improve suggestions
4. Generate recurring event instances from patterns

RECURRING PATTERN FORMAT:
- frequency: "daily" | "weekly" | "monthly" | "yearly" | "custom"
- interval: number (e.g., every 2 weeks = 2)
- daysOfWeek: array of numbers (0=Sunday, 1=Monday, ..., 6=Saturday)
- dayOfMonth: number (1-31) for monthly patterns
- weekOfMonth: number (1-5, where 1=first, 5=last) for patterns like "first Monday"
- endDate: ISO string (optional)
- occurrences: number (optional, alternative to endDate)
- timezone: string (e.g., "America/Los_Angeles")

EXAMPLES:
- "Every Monday at 9am" → {frequency: "weekly", daysOfWeek: [1], interval: 1}
- "Daily standup" → {frequency: "daily", interval: 1}
- "First Friday of every month" → {frequency: "monthly", weekOfMonth: 1, daysOfWeek: [5]}
- "Every other Tuesday" → {frequency: "weekly", daysOfWeek: [2], interval: 2}
- "Weekdays at 8am" → {frequency: "weekly", daysOfWeek: [1,2,3,4,5], interval: 1}
- "Monthly on the 15th" → {frequency: "monthly", dayOfMonth: 15, interval: 1}
- "Twice a week on Monday and Thursday" → {frequency: "weekly", daysOfWeek: [1,4], interval: 1}

Be friendly, helpful, and accurate. Always provide reasoning for your suggestions.`;

/**
 * POST /ai-assistant/suggest-recurrence
 * Analyze an event and suggest if it should be recurring
 */
router.post("/suggest-recurrence", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid || req.body.uid;
    if (!uid) {
      res.status(400).json({ error: "User ID required" });
      return;
    }

    const eventAnalysis: EventAnalysis = req.body.event;
    if (!eventAnalysis || !eventAnalysis.title) {
      res.status(400).json({ error: "Event title required" });
      return;
    }

    // Get user's event history for learning
    const userEventsRef = db.collection(`users/${uid}/calendar_events`);
    const recentEvents = await userEventsRef
      .orderBy("start", "desc")
      .limit(50)
      .get();

    const eventHistory = recentEvents.docs.map((doc) => doc.data());

    // Build context for AI
    const userContext = `
User's recent events (for pattern learning):
${eventHistory
  .slice(0, 10)
  .map(
    (e) =>
      `- ${e.title} (${e.start ? new Date(e.start).toLocaleDateString() : "no date"})`
  )
  .join("\n")}
`;

    const prompt = `
Analyze this event and suggest if it should be recurring:

Event Title: ${eventAnalysis.title}
${eventAnalysis.description ? `Description: ${eventAnalysis.description}` : ""}
${eventAnalysis.startTime ? `Start Time: ${eventAnalysis.startTime}` : ""}
${eventAnalysis.location ? `Location: ${eventAnalysis.location}` : ""}

${userContext}

Based on the event title, description, and user's history, determine:
1. Should this event be recurring? (consider common recurring patterns like meetings, workouts, classes)
2. If yes, what pattern would make sense?
3. What's your confidence level (0-1)?

Respond in JSON format:
{
  "shouldRecur": boolean,
  "confidence": number (0-1),
  "pattern": {
    "frequency": "daily" | "weekly" | "monthly" | "yearly" | "custom",
    "interval": number,
    "daysOfWeek": [number],
    "dayOfMonth": number,
    "weekOfMonth": number,
    "endDate": "ISO string",
    "occurrences": number,
    "timezone": "string"
  },
  "reasoning": "explanation of why this should/shouldn't recur"
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: RECURRING_EVENTS_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const response = JSON.parse(
      completion.choices[0].message.content || "{}"
    ) as AISuggestion;

    // Save suggestion to user's learning history
    await db
      .collection(`users/${uid}/ai_suggestions`)
      .add({
        eventTitle: eventAnalysis.title,
        suggestion: response,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        accepted: false, // Will be updated when user accepts/rejects
      });

    res.json({
      success: true,
      suggestion: response,
    });
    return;
  } catch (error: any) {
    console.error("Error suggesting recurrence:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate suggestion",
    });
    return;
  }
});

/**
 * POST /ai-assistant/parse-natural-language
 * Parse natural language into a recurring pattern
 */
router.post("/parse-natural-language", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { naturalLanguage, eventContext } = req.body;

    if (!naturalLanguage) {
      res.status(400).json({ error: "Natural language input required" });
      return;
    }

    const prompt = `
Parse this natural language request into a structured recurring pattern:

User Request: "${naturalLanguage}"
${eventContext ? `Event Context: ${JSON.stringify(eventContext)}` : ""}

Examples:
- "every Monday" → weekly, Monday
- "daily at 9am" → daily
- "first Friday of the month" → monthly, first week, Friday
- "every other Tuesday" → weekly, Tuesday, interval 2
- "weekdays at 8am" → weekly, Monday-Friday
- "twice a week on Monday and Thursday" → weekly, Monday and Thursday
- "monthly on the 15th" → monthly, day 15
- "every 2 weeks on Wednesday" → weekly, Wednesday, interval 2

Respond in JSON format:
{
  "pattern": {
    "frequency": "daily" | "weekly" | "monthly" | "yearly" | "custom",
    "interval": number,
    "daysOfWeek": [number],
    "dayOfMonth": number,
    "weekOfMonth": number,
    "endDate": "ISO string",
    "occurrences": number,
    "timezone": "string"
  },
  "confidence": number (0-1),
  "interpretation": "what you understood from the request",
  "naturalLanguagePattern": "cleaned up version of user's request"
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: RECURRING_EVENTS_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3, // Lower temperature for more consistent parsing
    });

    const response = JSON.parse(
      completion.choices[0].message.content || "{}"
    );

    res.json({
      success: true,
      pattern: response.pattern,
      confidence: response.confidence,
      interpretation: response.interpretation,
      naturalLanguagePattern: response.naturalLanguagePattern,
    });
    return;
  } catch (error: any) {
    console.error("Error parsing natural language:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to parse natural language",
    });
    return;
  }
});

/**
 * POST /ai-assistant/analyze-existing-events
 * Analyze user's existing events to suggest recurring patterns
 */
router.post("/analyze-existing-events", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid || req.body.uid;
    const { limit = 100 } = req.body;

    if (!uid) {
      res.status(400).json({ error: "User ID required" });
      return;
    }

    // Get user's events
    const eventsRef = db.collection(`users/${uid}/calendar_events`);
    const eventsSnapshot = await eventsRef
      .orderBy("start", "desc")
      .limit(limit)
      .get();

    const events = eventsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (events.length === 0) {
      res.json({
        success: true,
        suggestions: [],
        message: "No events found to analyze",
      });
      return;
    }

    // Group events by title to find potential recurring patterns
    const eventsByTitle: { [key: string]: any[] } = {};
    events.forEach((event: any) => {
      const title = event.title || "Untitled";
      if (!eventsByTitle[title]) {
        eventsByTitle[title] = [];
      }
      eventsByTitle[title].push(event);
    });

    // Find events that appear multiple times (potential recurring events)
    const potentialRecurring = Object.entries(eventsByTitle)
      .filter(([_, eventList]) => eventList.length >= 2)
      .map(([title, eventList]) => ({
        title,
        events: eventList
          .map((e) => ({
            start: e.start,
            end: e.end,
            location: e.location,
          }))
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
      }));

    if (potentialRecurring.length === 0) {
      res.json({
        success: true,
        suggestions: [],
        message: "No recurring patterns detected",
      });
      return;
    }

    // Use AI to analyze patterns
    const prompt = `
Analyze these event groups and suggest recurring patterns:

${potentialRecurring
  .slice(0, 10)
  .map(
    (group) => `
Title: "${group.title}"
Events:
${group.events
  .map(
    (e) =>
      `  - ${new Date(e.start).toLocaleString()} to ${new Date(e.end).toLocaleString()}`
  )
  .join("\n")}
`
  )
  .join("\n")}

For each group, determine:
1. Is this a recurring pattern? (confidence 0-1)
2. If yes, what's the pattern?
3. Should we suggest converting these to a recurring event?

Respond in JSON format:
{
  "suggestions": [
    {
      "title": "event title",
      "shouldBeRecurring": boolean,
      "confidence": number,
      "pattern": { ... recurring pattern ... },
      "reasoning": "explanation"
    }
  ]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: RECURRING_EVENTS_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const response = JSON.parse(
      completion.choices[0].message.content || "{}"
    );

    res.json({
      success: true,
      suggestions: response.suggestions || [],
    });
    return;
  } catch (error: any) {
    console.error("Error analyzing existing events:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to analyze events",
    });
    return;
  }
});

/**
 * POST /ai-assistant/generate-instances
 * Generate recurring event instances from a pattern
 */
router.post("/generate-instances", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { pattern, startDate, count = 10 } = req.body;

    if (!pattern || !startDate) {
      res.status(400).json({
        error: "Pattern and startDate required",
      });
      return;
    }

    const instances = generateRecurringInstances(
      pattern as RecurringPattern,
      new Date(startDate),
      count
    );

    res.json({
      success: true,
      instances,
    });
    return;
  } catch (error: any) {
    console.error("Error generating instances:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate instances",
    });
    return;
  }
});

/**
 * POST /ai-assistant/chat
 * Friendly chatbot interface for recurring events
 */
router.post("/chat", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid || req.body.uid;
    const { message, conversationHistory = [] } = req.body;

    if (!uid || !message) {
      res.status(400).json({
        error: "User ID and message required",
      });
      return;
    }

    // Get user's recent events for context
    const eventsRef = db.collection(`users/${uid}/calendar_events`);
    const recentEvents = await eventsRef
      .orderBy("start", "desc")
      .limit(20)
      .get();

    const eventsContext = recentEvents.docs
      .map((doc) => {
        const data = doc.data();
        return `${data.title} - ${data.start ? new Date(data.start).toLocaleString() : "no date"}`;
      })
      .join("\n");

    const systemPrompt = `${RECURRING_EVENTS_SYSTEM_PROMPT}

You are having a friendly conversation with the user about their calendar and recurring events.
Be warm, helpful, and conversational. You can help them:
- Create recurring events using natural language
- Understand and modify recurring patterns
- Analyze their calendar for recurring patterns
- Answer questions about their events

User's recent events:
${eventsContext || "No events yet"}

Keep responses concise (2-3 sentences max) and friendly.`;

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-10), // Last 10 messages for context
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.8, // More creative for conversational responses
      max_tokens: 300,
    });

    const assistantMessage = completion.choices[0].message.content || "";

    // Check if the message contains a request to create/modify recurring events
    // If so, also parse it and include the pattern
    let parsedPattern = null;
    if (
      message.toLowerCase().includes("recur") ||
      message.toLowerCase().includes("repeat") ||
      message.toLowerCase().includes("every") ||
      message.toLowerCase().includes("schedule")
    ) {
      try {
        const parseResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: RECURRING_EVENTS_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: `Extract recurring pattern from: "${message}". Respond with JSON: {"pattern": {...}, "confidence": number}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const parsed = JSON.parse(
          parseResponse.choices[0].message.content || "{}"
        );
        if (parsed.pattern && parsed.confidence > 0.5) {
          parsedPattern = parsed.pattern;
        }
      } catch (e) {
        // Ignore parsing errors, just continue with text response
        console.log("Could not parse pattern from chat message:", e);
      }
    }

    res.json({
      success: true,
      message: assistantMessage,
      pattern: parsedPattern,
    });
    return;
  } catch (error: any) {
    console.error("Error in AI chat:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process chat message",
    });
    return;
  }
});

/**
 * POST /ai-assistant/learn-from-feedback
 * Update AI learning based on user acceptance/rejection of suggestions
 */
router.post("/learn-from-feedback", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid || req.body.uid;
    const { suggestionId, accepted, modifiedPattern } = req.body;

    if (!uid || !suggestionId) {
      res.status(400).json({
        error: "User ID and suggestion ID required",
      });
      return;
    }

    // Update the suggestion record
    const suggestionRef = db
      .collection(`users/${uid}/ai_suggestions`)
      .doc(suggestionId);

    await suggestionRef.update({
      accepted,
      modifiedPattern: modifiedPattern || null,
      feedbackTimestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Store learning data for future improvements
    await db.collection(`users/${uid}/ai_learning`).add({
      suggestionId,
      accepted,
      modifiedPattern,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      message: "Feedback recorded",
    });
    return;
  } catch (error: any) {
    console.error("Error recording feedback:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to record feedback",
    });
    return;
  }
});

// Helper function to generate recurring instances
function generateRecurringInstances(
  pattern: RecurringPattern,
  startDate: Date,
  count: number
): string[] {
  const instances: Date[] = [];
  let currentDate = new Date(startDate);

  for (let i = 0; i < count; i++) {
    instances.push(new Date(currentDate));

    switch (pattern.frequency) {
      case "daily":
        currentDate.setDate(currentDate.getDate() + (pattern.interval || 1));
        break;

      case "weekly":
        if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
          // Find next occurrence of any specified day
          let daysToAdd = 0;
          const currentDay = currentDate.getDay();
          const sortedDays = [...pattern.daysOfWeek].sort((a, b) => a - b);

          // Find next day in the week
          const nextDay = sortedDays.find((day) => day > currentDay);
          if (nextDay !== undefined) {
            daysToAdd = nextDay - currentDay;
          } else {
            // Next occurrence is in the following week
            daysToAdd = 7 - currentDay + sortedDays[0];
          }

          currentDate.setDate(
            currentDate.getDate() + daysToAdd + (pattern.interval || 1) * 7 - 7
          );
        } else {
          currentDate.setDate(
            currentDate.getDate() + 7 * (pattern.interval || 1)
          );
        }
        break;

      case "monthly":
        if (pattern.weekOfMonth && pattern.daysOfWeek) {
          // "First Monday of month" pattern
          currentDate.setMonth(currentDate.getMonth() + (pattern.interval || 1));
          const year = currentDate.getFullYear();
          const month = currentDate.getMonth();
          const dayOfWeek = pattern.daysOfWeek[0];
          const week = pattern.weekOfMonth;

          // Calculate the date
          const firstDay = new Date(year, month, 1);
          const firstDayOfWeek = firstDay.getDay();
          let targetDate = 1 + ((dayOfWeek - firstDayOfWeek + 7) % 7);
          if (week > 1) {
            targetDate += (week - 1) * 7;
          }
          if (week === 5) {
            // Last occurrence - find last occurrence of the day
            const lastDay = new Date(year, month + 1, 0);
            const lastDayOfWeek = lastDay.getDay();
            const daysFromEnd = (lastDayOfWeek - dayOfWeek + 7) % 7;
            targetDate = lastDay.getDate() - daysFromEnd;
          }

          currentDate.setDate(targetDate);
        } else if (pattern.dayOfMonth) {
          // "15th of every month" pattern
          currentDate.setMonth(currentDate.getMonth() + (pattern.interval || 1));
          currentDate.setDate(pattern.dayOfMonth);
        } else {
          currentDate.setMonth(currentDate.getMonth() + (pattern.interval || 1));
        }
        break;

      case "yearly":
        currentDate.setFullYear(
          currentDate.getFullYear() + (pattern.interval || 1)
        );
        break;

      default:
        // Custom - just add interval days as fallback
        currentDate.setDate(currentDate.getDate() + (pattern.interval || 1));
    }

    // Check end conditions
    if (pattern.endDate && currentDate > new Date(pattern.endDate)) {
      break;
    }
    if (pattern.occurrences && i >= pattern.occurrences - 1) {
      break;
    }
  }

  return instances.map((d) => d.toISOString());
}

export default router;

