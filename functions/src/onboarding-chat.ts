import express, { Request, Response, Router } from "express";
import { verifyAuth } from "./middleware/auth";
import * as admin from "firebase-admin";
import OpenAI from "openai";

const router: Router = express.Router();

// Initialize OpenAI lazily to avoid errors during deployment
let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

// System prompt for the onboarding AI
const SYSTEM_PROMPT = `You are Zara, the friendly and empathetic AI assistant for Zeitline - a personal life management app. You're conducting an onboarding conversation to learn about the user so you can automatically fill out their calendar and personalize their experience.

CRITICAL PURPOSE: The data you collect will be used to AUTOMATICALLY POPULATE their calendar with recurring events, routines, and activities. Ask SPECIFIC, TIME-BASED questions that help build their schedule.

Your personality:
- Warm, genuine, and curious about people
- You ask thoughtful follow-up questions based on their answers
- You share brief, relevant observations or encouragements
- You keep responses concise (1-3 sentences max) but personal
- You use occasional emojis naturally, not excessively
- You never lecture or give unsolicited advice during onboarding

CURRENT SECTION: {{SECTION}}
CONVERSATION CONTEXT: {{CONTEXT}}
ALREADY COLLECTED DATA: {{COLLECTED}}

CRITICAL: You MUST build your next question based on the user's previous response. Do NOT follow a fixed script. Instead:
1. Read their response carefully and identify what they shared
2. Ask a natural follow-up question that builds on what they just said
3. If they mentioned something interesting, ask about it specifically
4. If they gave a brief answer, ask for more detail in a natural way
5. If they shared multiple things, pick the most relevant one to follow up on
6. Make each question feel like a natural conversation, not an interrogation
7. ALWAYS ask about TIMES and SCHEDULES when relevant - this is critical for calendar auto-population

SECTIONS TO COVER (ask SPECIFIC, TIME-BASED questions for calendar auto-population):

1. LIFE: 
   - Full name, age/birthday, occupation, where they live, who they live with
   - Work style (remote/office/hybrid) - ASK: "What time do you usually start work?" "Does this differ on weekends?"
   - Morning person vs night owl - ASK: "What time do you usually wake up?" "What time do you go to bed?" "Does your sleep schedule change on weekends?"
   - Typical day structure - ASK: "Walk me through a typical weekday. What time do you wake up, have breakfast, start work, take breaks, finish work, have dinner, wind down?"
   - Weekend routines - ASK: "How does your weekend schedule differ from weekdays?" "What time do you usually wake up on Saturdays?"
   - Hobbies/interests - ASK: "When do you usually do [hobby]? Is it a weekday evening thing or more of a weekend activity?"

2. HEALTH: 
   - Exercise habits - ASK: "What time do you usually work out?" "Is it the same time every day or does it vary?" "Do you exercise on weekends too?"
   - Sleep patterns - ASK: "What time do you usually go to bed on weekdays vs weekends?" "How many hours of sleep do you aim for?"
   - Energy levels throughout the day - ASK: "When do you feel most energetic? Morning, afternoon, or evening?"
   - Health goals, stress level, any health conditions to track

3. DIET: 
   - Eating habits - ASK: "What time do you usually have breakfast/lunch/dinner?" "Do your meal times change on weekends?"
   - Dietary preferences/restrictions, cooking vs eating out
   - Hydration - ASK: "Do you have a routine for drinking water throughout the day?"
   - Caffeine/alcohol - ASK: "What time do you usually have your first coffee?" "Do you have a cut-off time for caffeine?"
   - Nutrition goals

4. FINANCIAL: 
   - Income range, savings habits, biggest expenses, financial goals, investment interests, debt situation (optional)
   - ASK about bill payment schedules if relevant: "When do you usually pay bills? Beginning or end of month?"

5. GOALS: 
   - Life dreams, 1-year goals, biggest priorities, current challenges, what success means to them
   - ASK: "When do you usually work on [goal]? Do you have dedicated time slots?"

EXAMPLES OF GOOD TIME-BASED QUESTIONS:
- "What time do you usually wake up on weekdays? And does that change on weekends?"
- "When do you typically have your first meal of the day?"
- "What time do you usually start and finish work? Does this vary day to day?"
- "Do you have a regular exercise routine? What time of day works best for you?"
- "When do you usually have dinner? Is it around the same time every day?"
- "What time do you wind down for bed? Does it differ on weekends?"
- "Do you have any recurring activities or commitments? When do those usually happen?"

RESPONSE FORMAT:
Always respond with a JSON object:
{
  "message": "Your conversational response that acknowledges what they said and asks a follow-up question",
  "dataCollected": { 
    "fieldName": "value",
    "wakeTimeWeekday": "7:00 AM",
    "wakeTimeWeekend": "9:00 AM",
    "bedtimeWeekday": "11:00 PM",
    "bedtimeWeekend": "12:30 AM",
    "workStartTime": "9:00 AM",
    "workEndTime": "5:00 PM",
    "breakfastTime": "8:00 AM",
    "lunchTime": "12:30 PM",
    "dinnerTime": "7:00 PM",
    "exerciseTime": "6:00 PM",
    "exerciseDays": ["Monday", "Wednesday", "Friday"]
  },
  "nextQuestion": true/false,
  "sectionComplete": true/false,
  "suggestedResponses": ["Quick response 1", "Quick response 2", "Quick response 3"] // optional, for questions with common answers
}

IMPORTANT DATA EXTRACTION RULES:
- Extract ALL time-related information: wake times, bedtimes, meal times, work hours, exercise times
- Store times in 24-hour format or with AM/PM clearly indicated
- Extract weekday vs weekend differences separately (e.g., wakeTimeWeekday vs wakeTimeWeekend)
- Extract recurring patterns: "I work out Monday, Wednesday, Friday" → exerciseDays: ["Monday", "Wednesday", "Friday"]
- Extract frequency: "every morning" → frequency: "daily", "3 times a week" → frequency: "3x/week"
- Store duration when mentioned: "I work out for an hour" → exerciseDuration: "60 minutes"

Important conversation rules:
- ALWAYS acknowledge what the user just said before asking the next question
- Build your question directly from their response - don't use generic questions
- PRIORITIZE asking about TIMES and SCHEDULES - this is critical for calendar auto-population
- When they mention an activity, ALWAYS ask "What time do you usually do that?" or "When does that typically happen?"
- Ask about weekday vs weekend differences for routines: "Does this differ on weekends?"
- Extract and store data in dataCollected even from conversational responses
- Be flexible with how users provide info - they might combine multiple answers
- If they skip or don't want to answer, that's okay - note it and move on
- Make the conversation feel natural, not like a form
- For sensitive topics (money, health conditions), be extra gentle and make skipping easy
- If they've already answered something in a previous response, don't ask about it again
- When they mention a routine, dig deeper: "What time does that usually happen?" "Is it the same every day?"`;

interface OnboardingState {
  section: "life" | "health" | "diet" | "financial" | "goals";
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  collectedData: Record<string, any>;
  questionsAsked?: string[];
}

// Chat endpoint for onboarding
router.post("/chat", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, state } = req.body;
    const uid = (req as any).uid;

    if (!message || !state) {
      res.status(400).json({
        success: false,
        error: "Message and state are required",
      });
      return;
    }

    const currentState: OnboardingState = state;

    // Build context from collected data
    const contextSummary = Object.entries(currentState.collectedData)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: ${value.join(", ")}`;
        }
        return `${key}: ${value}`;
      })
      .join("\n");

    // Build collected data summary for the AI
    const collectedSummary = Object.keys(currentState.collectedData)
      .filter(key => !key.startsWith("_"))
      .map(key => key)
      .join(", ");

    // Prepare conversation history for OpenAI
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT
          .replace("{{SECTION}}", currentState.section.toUpperCase())
          .replace("{{CONTEXT}}", contextSummary || "Just starting conversation")
          .replace("{{COLLECTED}}", collectedSummary || "Nothing collected yet"),
      },
      ...currentState.conversationHistory.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      {
        role: "user" as const,
        content: message,
      },
    ];

    // Call OpenAI
    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.8,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0]?.message?.content || "{}";
    let parsedResponse;

    try {
      parsedResponse = JSON.parse(responseText);
    } catch (e) {
      parsedResponse = {
        message: responseText,
        dataCollected: {},
        nextQuestion: true,
        sectionComplete: false,
      };
    }

    // Update conversation history
    const updatedHistory = [
      ...currentState.conversationHistory,
      { role: "user" as const, content: message },
      { role: "assistant" as const, content: parsedResponse.message },
    ];

    // Merge collected data
    const updatedData = {
      ...currentState.collectedData,
      ...parsedResponse.dataCollected,
    };

    // Save progress to Firestore
    const db = admin.firestore();
    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          onboardingProgress: {
            section: currentState.section,
            conversationHistory: updatedHistory.slice(-20), // Keep last 20 messages
            collectedData: updatedData,
            lastUpdated: admin.firestore.Timestamp.now(),
          },
        },
        { merge: true }
      );

    res.json({
      success: true,
      data: {
        message: parsedResponse.message,
        dataCollected: parsedResponse.dataCollected,
        nextQuestion: parsedResponse.nextQuestion,
        sectionComplete: parsedResponse.sectionComplete,
        suggestedResponses: parsedResponse.suggestedResponses,
        updatedState: {
          ...currentState,
          conversationHistory: updatedHistory,
          collectedData: updatedData,
        },
      },
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to process message",
    });
  }
});

// Start or resume onboarding
router.post("/start", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = (req as any).uid;
    const { mode, section } = req.body; // mode: 'new' | 'continue' | 'edit'

    const db = admin.firestore();
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data();

    let initialState: OnboardingState;
    let welcomeMessage: string;
    let suggestedResponses: string[] = [];

    if (mode === "edit" && section) {
      // Edit mode - load existing data and focus on specific section
      const existingData = userData?.onboardingData || {};
      initialState = {
        section: section,
        conversationHistory: [],
        collectedData: existingData,
        questionsAsked: [],
      };
      
      const sectionNames: Record<string, string> = {
        life: "life and personal details",
        health: "health and fitness",
        diet: "diet and nutrition",
        financial: "finances",
        goals: "goals and aspirations",
      };
      
      welcomeMessage = `Hey! Let's update your ${sectionNames[section] || section} information. What would you like to change? You can tell me anything new or different about this area of your life.`;
      
    } else if (mode === "continue" && userData?.onboardingProgress) {
      // Resume from saved progress
      initialState = userData.onboardingProgress;
      welcomeMessage = `Welcome back! Let's continue where we left off. We were talking about your ${initialState.section}. Ready to pick up?`;
      suggestedResponses = ["Yes, let's continue!", "Start fresh instead", "Skip to a different section"];
      
    } else {
      // New onboarding
      const userName = userData?.personal?.fullName?.split(" ")[0] || "";
      const greeting = getTimeGreeting();
      
      initialState = {
        section: "life",
        conversationHistory: [],
        collectedData: {},
        questionsAsked: [],
      };
      
      if (userName) {
        welcomeMessage = `${greeting}, ${userName}! 👋 I'm Zara, your Zeitline companion. I'm here to learn about you so we can personalize your experience. This should take about 5-10 minutes, and you can always update things later.\n\nLet's start simple - what do you do for work? Or if you're a student or retired, tell me about that!`;
      } else {
        welcomeMessage = `${greeting}! 👋 I'm Zara, your Zeitline companion. I'm excited to get to know you and help personalize your experience.\n\nLet's start with the basics - what's your name?`;
      }
    }

    // Update initial message in history
    initialState.conversationHistory = [
      { role: "assistant", content: welcomeMessage },
    ];

    // Save initial state
    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          onboardingProgress: {
            ...initialState,
            lastUpdated: admin.firestore.Timestamp.now(),
          },
        },
        { merge: true }
      );

    res.json({
      success: true,
      data: {
        message: welcomeMessage,
        state: initialState,
        suggestedResponses,
      },
    });
  } catch (error: any) {
    console.error("Start error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to start onboarding",
    });
  }
});

// Change section
router.post("/section", verifyAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = (req as any).uid;
    const { section, state } = req.body;

    const validSections = ["life", "health", "diet", "financial", "goals"];
    if (!validSections.includes(section)) {
      res.status(400).json({
        success: false,
        error: "Invalid section",
      });
      return;
    }

    const sectionIntros: Record<string, string> = {
      life: "Let's talk about your life and daily routine! Tell me a bit about yourself - where do you live, what's your work situation like?",
      health: "Now let's chat about health and fitness! How would you describe your current relationship with exercise? Do you work out regularly, or is it something you want to get into?",
      diet: "Time to talk food! 🍽️ I'm curious about your eating habits. Do you cook much, or are you more of a takeout person?",
      financial: "Let's discuss your financial life a bit. Don't worry - you can skip anything you're not comfortable sharing. What's your main financial goal right now?",
      goals: "This is my favorite part - let's dream big! 🎯 What's something you really want to achieve? Could be this year, or a bigger life goal.",
    };

    const updatedState = {
      ...state,
      section,
      conversationHistory: [
        ...state.conversationHistory,
        { role: "assistant", content: sectionIntros[section] },
      ],
    };

    // Save to Firestore
    const db = admin.firestore();
    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          onboardingProgress: {
            ...updatedState,
            lastUpdated: admin.firestore.Timestamp.now(),
          },
        },
        { merge: true }
      );

    res.json({
      success: true,
      data: {
        message: sectionIntros[section],
        state: updatedState,
      },
    });
  } catch (error: any) {
    console.error("Section change error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to change section",
    });
  }
});

// Complete onboarding
router.post("/complete", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = (req as any).uid;
    const { collectedData } = req.body;

    const db = admin.firestore();

    // Transform collected data into profile format
    const profileData = transformToProfile(collectedData);

    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          ...profileData,
          onboardingComplete: true,
          onboardingCompletedAt: admin.firestore.Timestamp.now(),
          onboardingData: collectedData,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true }
      );

    // Trigger calendar population (async, don't wait)
    // The frontend will also check and populate, but this ensures it happens
    if (profileData.routines) {
      // Import the calendars router to call populate function
      // For now, we'll let the frontend handle it when they view the calendar
      console.log(`Onboarding complete for ${uid}. Calendar will be populated on next calendar view.`);
    }

    res.json({
      success: true,
      data: {
        message: "Onboarding complete!",
        profile: profileData,
        shouldPopulateCalendar: !!profileData.routines,
      },
    });
  } catch (error: any) {
    console.error("Complete error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to complete onboarding",
    });
  }
});

// Helper functions
function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function transformToProfile(data: Record<string, any>): Record<string, any> {
  return {
    personal: {
      fullName: data.fullName || data.name || "",
      age: data.age || 0,
      birthday: data.birthday || data.birthdate || "",
      occupation: data.occupation || data.job || "",
      city: data.city || data.location || "",
      timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    lifestyle: {
      workStyle: data.workStyle || "",
      morningPerson: data.morningPerson || data.chronotype === "morning",
      livingWith: data.livingWith || "",
      hobbies: data.hobbies || [],
      // Schedule data for calendar auto-population
      wakeTimeWeekday: data.wakeTimeWeekday || data.wakeTime || "",
      wakeTimeWeekend: data.wakeTimeWeekend || "",
      bedtimeWeekday: data.bedtimeWeekday || data.bedtime || "",
      bedtimeWeekend: data.bedtimeWeekend || "",
      workStartTime: data.workStartTime || "",
      workEndTime: data.workEndTime || "",
      workDays: data.workDays || ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
    health: {
      exerciseFrequency: data.exerciseFrequency || "",
      exerciseTypes: data.exerciseTypes || [],
      exerciseTime: data.exerciseTime || "",
      exerciseDays: data.exerciseDays || [],
      exerciseDuration: data.exerciseDuration || "",
      sleepHours: data.sleepHours || 8,
      stressLevel: data.stressLevel || 5,
      healthGoals: data.healthGoals || [],
    },
    diet: {
      dietType: data.dietType || "none",
      allergies: data.allergies || [],
      cookingFrequency: data.cookingFrequency || "",
      nutritionGoals: data.nutritionGoals || [],
      // Meal times for calendar
      breakfastTime: data.breakfastTime || "",
      lunchTime: data.lunchTime || "",
      dinnerTime: data.dinnerTime || "",
      mealTimesWeekend: data.mealTimesWeekend || {},
    },
    financial: {
      incomeRange: data.incomeRange || "",
      savingsRate: data.savingsRate || 0,
      housingType: data.housingType || "",
      financialGoals: data.financialGoals || [],
    },
    goals: {
      lifeGoals: data.lifeGoals || [],
      oneYearGoals: data.oneYearGoals || [],
      priorities: data.priorities || [],
      challenges: data.challenges || [],
    },
    // Calendar routines extracted from conversation
    routines: {
      weekday: {
        wakeTime: data.wakeTimeWeekday || data.wakeTime || "",
        bedtime: data.bedtimeWeekday || data.bedtime || "",
        workStart: data.workStartTime || "",
        workEnd: data.workEndTime || "",
        meals: {
          breakfast: data.breakfastTime || "",
          lunch: data.lunchTime || "",
          dinner: data.dinnerTime || "",
        },
        exercise: data.exerciseTime ? {
          time: data.exerciseTime,
          days: data.exerciseDays || [],
          duration: data.exerciseDuration || "",
        } : null,
      },
      weekend: {
        wakeTime: data.wakeTimeWeekend || "",
        bedtime: data.bedtimeWeekend || "",
        meals: data.mealTimesWeekend || {},
      },
    },
  };
}

export default router;

