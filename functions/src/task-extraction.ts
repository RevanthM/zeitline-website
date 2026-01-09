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

    const prompt = `You are an AI assistant that analyzes conversation transcripts. Extract:
1. ALL discussion points (meetings, decisions, tasks mentioned, ideas, etc.)
2. USER's actionable tasks only (things the user needs to do)

For each item, provide:
- content: Brief description
- type: user_task, other_person_task, meeting, event, deadline, reminder, decision, question, follow_up, information, idea, other
- speaker: Who said it (if identifiable)
- mentionedPeople: Array of people mentioned
- mentionedDateTime: ISO date if mentioned, null otherwise
- location: Location if mentioned, null otherwise

Return ONLY valid JSON:
{
  "conversation_points": [
    {"content": "...", "type": "meeting", "speaker": "John", "mentionedPeople": ["Sarah"], "mentionedDateTime": null, "location": "Office"}
  ],
  "user_tasks": [
    {"title": "...", "details": "...", "location": null, "participants": [], "suggestedDateTime": null, "priority": 2, "category": "work"}
  ]
}

Transcript:
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
    priority: task.priority || null,
    category: task.category || "other",
    audioTimecode: 0,
    sessionId: recordingId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    addedToCalendar: false,
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
