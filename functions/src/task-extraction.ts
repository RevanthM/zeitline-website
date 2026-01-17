import express, { Request, Response } from "express";
import { OpenAI } from "openai";
import * as admin from "firebase-admin";
import { verifyAuth } from "./middleware/auth";

const router = express.Router();
const db = admin.firestore();

// Initialize OpenAI client lazily
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

// Types
interface ConversationPoint {
  content: string;
  type: string;
  speaker?: string;
  mentionedPeople?: string[];
  mentionedDateTime?: string;
  location?: string;
}

interface ExtractedTask {
  title: string;
  details?: string;
  location?: string;
  participants?: string[];
  suggestedDateTime?: string;
  priority?: number;
  category?: string;
}

interface ExtractionResult {
  conversationPoints: ConversationPoint[];
  userTasks: ExtractedTask[];
}

/**
 * POST /task-extraction/extract
 * Extract tasks and discussion points from a transcript
 */
router.post("/extract", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { transcript, recordingId } = req.body;
    if (!transcript) {
      res.status(400).json({ error: "Transcript is required" });
      return;
    }

    const prompt = `You are an AI assistant that analyzes voice memo transcripts to extract actionable items.

CRITICAL RULES:
1. ONLY extract items that are EXPLICITLY mentioned in the transcript
2. NEVER create placeholder, example, sample, or test tasks
3. If the transcript has no clear tasks or discussion points, return EMPTY arrays
4. Do NOT invent or make up any content - only use what is actually said

DEDUPLICATION RULES (VERY IMPORTANT):
5. NEVER create multiple user_tasks for the same event/meeting/appointment
6. If someone says "put X on my calendar", "add X to calendar", "schedule X", or "I'll calendar X" - extract ONLY the event X as a single user_task, NOT a separate "add to calendar" task
7. When the same event is mentioned multiple times or described in different ways, consolidate into ONE user_task
8. Example: "I'll put on my calendar the meeting with Jake tomorrow at 4pm" = ONE task titled "Meeting with Jake", NOT two tasks
9. The action of adding to calendar is automatic - never create a task for the action of calendaring itself

This is a voice memo recorded by the user. Extract:
1. Discussion points and topics that are ACTUALLY mentioned
2. Tasks, to-dos, and action items - ONLY if explicitly stated (e.g., "you need to do X", "get X done by Y", "I need to X")

For conversation_points (ONLY if actually discussed):
- content: What was discussed (exact or close paraphrase)
- type: user_task, meeting, event, deadline, reminder, decision, question, follow_up, information, idea, other
- speaker: Who said it (if identifiable, otherwise null)
- mentionedPeople: Array of people mentioned
- mentionedDateTime: ISO date string if a date/time was mentioned, null otherwise
- location: Location if mentioned, null otherwise

For user_tasks (ONLY if explicitly stated as something to do):
- title: Clear, actionable task title from the transcript
- details: Additional context from the transcript
- location: Where it needs to be done (if mentioned)
- participants: People involved
- suggestedDateTime: ISO date string if deadline mentioned (e.g., "Tuesday" = next Tuesday), null otherwise
- priority: 1 (high), 2 (medium), 3 (low) based on urgency
- category: work, personal, meeting, call, errand, health, other
- IMPORTANT: If user mentions adding something to calendar, extract the EVENT being added, not the action of adding

IMPORTANT: If the transcript is empty, unclear, just noise, or contains no actionable content, return:
{"conversation_points": [], "user_tasks": []}

Return ONLY valid JSON:
{
  "conversation_points": [],
  "user_tasks": []
}

Voice memo transcript:
${transcript}`;

    const completion = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: "You extract tasks and discussion points from transcripts. Return only valid JSON." 
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content || "{}";
    const parsed = JSON.parse(content);

    const result: ExtractionResult = {
      conversationPoints: parsed.conversation_points || [],
      userTasks: parsed.user_tasks || []
    };

    // Save to Firebase if recordingId provided
    if (recordingId) {
      await saveExtractionResults(uid, recordingId, result);
    }

    res.json({
      success: true,
      ...result,
      recordingId,
      extractedAt: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("Task extraction error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to extract tasks"
    });
  }
});

/**
 * Save extraction results to Firebase
 */
async function saveExtractionResults(
  uid: string, 
  recordingId: string, 
  result: ExtractionResult
): Promise<void> {
  const batch = db.batch();

  // Save conversation points to session
  const sessionRef = db.collection(`users/${uid}/conversationSessions`).doc(recordingId);
  
  const points = result.conversationPoints.map((point, index) => ({
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
  const taskListRef = db.collection(`users/${uid}/taskLists`).doc("master");
  const taskListDoc = await taskListRef.get();
  
  let existingTasks: any[] = [];
  if (taskListDoc.exists) {
    existingTasks = taskListDoc.data()?.tasks || [];
  }

  const newTasks = result.userTasks.map((task, index) => ({
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

  batch.set(taskListRef, {
    userId: uid,
    tasks: [...existingTasks, ...newTasks],
    lastUpdated: new Date().toISOString()
  }, { merge: true });

  // Update recording document
  const recordingRef = db.collection(`users/${uid}/recordings`).doc(recordingId);
  batch.update(recordingRef, {
    tasksExtracted: true,
    extractedTaskCount: result.userTasks.length,
    extractedPointCount: result.conversationPoints.length,
    extractedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await batch.commit();
}

/**
 * GET /task-extraction/tasks
 * Get user's task list
 */
router.get("/tasks", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const taskListDoc = await db.collection(`users/${uid}/taskLists`).doc("master").get();
    
    if (!taskListDoc.exists) {
      res.json({ success: true, tasks: [] });
      return;
    }

    res.json({
      success: true,
      tasks: taskListDoc.data()?.tasks || []
    });

  } catch (error: any) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /task-extraction/conversation-points
 * Get user's conversation points
 */
router.get("/conversation-points", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const sessionsSnapshot = await db.collection(`users/${uid}/conversationSessions`)
      .orderBy("startedAt", "desc")
      .limit(50)
      .get();

    const allPoints: any[] = [];
    
    sessionsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.points && Array.isArray(data.points)) {
        allPoints.push(...data.points.map((p: any) => ({
          ...p,
          sessionId: doc.id
        })));
      }
    });

    res.json({
      success: true,
      conversationPoints: allPoints
    });

  } catch (error: any) {
    console.error("Error fetching conversation points:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /task-extraction/move-to-tasks
 * Move a conversation point to the task list
 */
router.post("/move-to-tasks", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { pointId, sessionId } = req.body;
    if (!pointId || !sessionId) {
      res.status(400).json({ error: "pointId and sessionId required" });
      return;
    }

    // Get the conversation point
    const sessionRef = db.collection(`users/${uid}/conversationSessions`).doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const points = sessionDoc.data()?.points || [];
    const point = points.find((p: any) => p.id === pointId);

    if (!point) {
      res.status(404).json({ error: "Point not found" });
      return;
    }

    // Create task from point
    const newTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: point.content,
      details: null,
      location: point.location || null,
      participants: point.mentionedPeople || [],
      subtasks: [],
      suggestedDate: point.mentionedDateTime || null,
      priority: null,
      category: mapTypeToCategory(point.type),
      sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      addedToCalendar: false,
      status: "pending"
    };

    // Add to task list
    const taskListRef = db.collection(`users/${uid}/taskLists`).doc("master");
    const taskListDoc = await taskListRef.get();
    
    const existingTasks = taskListDoc.exists ? (taskListDoc.data()?.tasks || []) : [];
    
    await taskListRef.set({
      userId: uid,
      tasks: [newTask, ...existingTasks],
      lastUpdated: new Date().toISOString()
    }, { merge: true });

    // Mark point as added
    const updatedPoints = points.map((p: any) => 
      p.id === pointId ? { ...p, addedToTaskList: true, linkedTaskId: newTask.id } : p
    );
    
    await sessionRef.update({ points: updatedPoints });

    res.json({
      success: true,
      task: newTask
    });

  } catch (error: any) {
    console.error("Error moving point to tasks:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function mapTypeToCategory(type: string): string {
  const mapping: { [key: string]: string } = {
    user_task: "work",
    meeting: "meeting",
    deadline: "deadline",
    reminder: "reminder",
    follow_up: "work"
  };
  return mapping[type] || "other";
}

export default router;
