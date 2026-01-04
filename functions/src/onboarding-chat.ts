import express, { Request, Response, Router } from "express";
import { verifyAuth } from "./middleware/auth";
import * as admin from "firebase-admin";
import OpenAI from "openai";

const router: Router = express.Router();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// System prompt for the onboarding AI
const SYSTEM_PROMPT = `You are Zara, the friendly and empathetic AI assistant for Zeitline - a personal life management app. You're conducting an onboarding conversation to learn about the user so you can personalize their experience.

Your personality:
- Warm, genuine, and curious about people
- You ask thoughtful follow-up questions based on their answers
- You share brief, relevant observations or encouragements
- You keep responses concise (1-3 sentences max) but personal
- You use occasional emojis naturally, not excessively
- You never lecture or give unsolicited advice during onboarding

CURRENT SECTION: {{SECTION}}
CONVERSATION CONTEXT: {{CONTEXT}}

Your job is to gather information through natural conversation. Based on the current section, ask ONE question at a time. After they answer, acknowledge their response briefly and move to the next relevant question.

SECTIONS TO COVER:
1. LIFE: Full name, age/birthday, occupation, where they live, who they live with, work style (remote/office/hybrid), morning person vs night owl, typical day structure, hobbies/interests
2. HEALTH: Exercise habits (what/how often), sleep patterns, energy levels, health goals, stress level, any health conditions to track
3. DIET: Eating habits, dietary preferences/restrictions, cooking vs eating out, hydration, caffeine/alcohol, nutrition goals
4. FINANCIAL: Income range, savings habits, biggest expenses, financial goals, investment interests, debt situation (optional)
5. GOALS: Life dreams, 1-year goals, biggest priorities, current challenges, what success means to them

RESPONSE FORMAT:
Always respond with a JSON object:
{
  "message": "Your conversational response",
  "dataCollected": { "fieldName": "value" },
  "nextQuestion": true/false,
  "sectionComplete": true/false,
  "suggestedResponses": ["Quick response 1", "Quick response 2", "Quick response 3"] // optional, for questions with common answers
}

Important rules:
- Extract and store data in dataCollected even from conversational responses
- Be flexible with how users provide info - they might combine multiple answers
- If they skip or don't want to answer, that's okay - note it and move on
- Make the conversation feel natural, not like a form
- For sensitive topics (money, health conditions), be extra gentle and make skipping easy`;

interface OnboardingState {
  section: "life" | "health" | "diet" | "financial" | "goals";
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  collectedData: Record<string, any>;
  questionsAsked: string[];
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
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");

    // Prepare conversation history for OpenAI
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: SYSTEM_PROMPT
          .replace("{{SECTION}}", currentState.section.toUpperCase())
          .replace("{{CONTEXT}}", contextSummary || "Just starting conversation"),
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
    const completion = await openai.chat.completions.create({
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

    res.json({
      success: true,
      data: {
        message: "Onboarding complete!",
        profile: profileData,
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
    },
    health: {
      exerciseFrequency: data.exerciseFrequency || "",
      exerciseTypes: data.exerciseTypes || [],
      sleepHours: data.sleepHours || 8,
      stressLevel: data.stressLevel || 5,
      healthGoals: data.healthGoals || [],
    },
    diet: {
      dietType: data.dietType || "none",
      allergies: data.allergies || [],
      cookingFrequency: data.cookingFrequency || "",
      nutritionGoals: data.nutritionGoals || [],
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
  };
}

export default router;

