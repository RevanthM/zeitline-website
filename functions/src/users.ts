import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { verifyAuth } from "./middleware/auth";
import {
  UserProfile,
  CreateUserRequest,
  OnboardingPersonalRequest,
  OnboardingLifestyleRequest,
  OnboardingFinancialRequest,
  ApiResponse,
} from "./types";
import { Timestamp } from "firebase-admin/firestore";

const router = Router();
const db = admin.firestore();

/**
 * POST /users/create
 * Create a new user profile after Firebase Auth signup
 */
router.post("/create", verifyAuth, async (req: Request, res: Response) => {
  try {
    const { email, fullName } = req.body as CreateUserRequest;
    const uid = req.user!.uid;

    // Check if user already exists
    const existingUser = await db.collection("users").doc(uid).get();
    if (existingUser.exists) {
      res.status(400).json({
        success: false,
        error: "User already exists",
      } as ApiResponse);
      return;
    }

    // Create initial user profile
    const userProfile: Partial<UserProfile> = {
      uid,
      email: email || req.user!.email || "",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      plan: "free",
      onboardingComplete: false,
      onboardingStep: 1,
      personal: {
        fullName: fullName || "",
        age: 0,
        occupation: "",
        location: "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    };

    await db.collection("users").doc(uid).set(userProfile);

    res.status(201).json({
      success: true,
      data: userProfile,
      message: "User profile created successfully",
    } as ApiResponse<Partial<UserProfile>>);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({
      success: false,
      error: "Failed to create user profile",
    } as ApiResponse);
  }
});

/**
 * GET /users/profile
 * Get the current user's profile
 */
router.get("/profile", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      res.status(404).json({
        success: false,
        error: "User profile not found",
      } as ApiResponse);
      return;
    }

    res.json({
      success: true,
      data: userDoc.data() as UserProfile,
    } as ApiResponse<UserProfile>);
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user profile",
    } as ApiResponse);
  }
});

/**
 * POST /users/onboarding/personal
 * Save personal info (Step 2 of onboarding)
 */
router.post(
  "/onboarding/personal",
  verifyAuth,
  async (req: Request, res: Response) => {
    try {
      const uid = req.user!.uid;
      const data = req.body as OnboardingPersonalRequest;

      // Validate required fields
      if (!data.fullName || !data.age || data.age < 13) {
        res.status(400).json({
          success: false,
          error: "Invalid personal information. Name and age (13+) required.",
        } as ApiResponse);
        return;
      }

      await db
        .collection("users")
        .doc(uid)
        .update({
          "personal.fullName": data.fullName,
          "personal.age": data.age,
          "personal.occupation": data.occupation || "",
          "personal.location": data.location || "",
          "personal.timezone": data.timezone || "",
          onboardingStep: 2,
          updatedAt: Timestamp.now(),
        });

      res.json({
        success: true,
        message: "Personal information saved",
      } as ApiResponse);
    } catch (error) {
      console.error("Error saving personal info:", error);
      res.status(500).json({
        success: false,
        error: "Failed to save personal information",
      } as ApiResponse);
    }
  }
);

/**
 * POST /users/onboarding/lifestyle
 * Save lifestyle preferences (Step 3 of onboarding)
 */
router.post(
  "/onboarding/lifestyle",
  verifyAuth,
  async (req: Request, res: Response) => {
    try {
      const uid = req.user!.uid;
      const data = req.body as OnboardingLifestyleRequest;

      await db
        .collection("users")
        .doc(uid)
        .update({
          "personal.interests": data.interests || [],
          "personal.lifeGoals": data.lifeGoals || [],
          "personal.lifestyle.morningPerson": data.morningPerson ?? true,
          "personal.lifestyle.workStyle": data.workStyle || "",
          "personal.lifestyle.sleepHours": data.sleepHours || 8,
          onboardingStep: 3,
          updatedAt: Timestamp.now(),
        });

      res.json({
        success: true,
        message: "Lifestyle preferences saved",
      } as ApiResponse);
    } catch (error) {
      console.error("Error saving lifestyle:", error);
      res.status(500).json({
        success: false,
        error: "Failed to save lifestyle preferences",
      } as ApiResponse);
    }
  }
);

/**
 * POST /users/onboarding/financial
 * Save financial info (Step 4 of onboarding)
 */
router.post(
  "/onboarding/financial",
  verifyAuth,
  async (req: Request, res: Response) => {
    try {
      const uid = req.user!.uid;
      const data = req.body as OnboardingFinancialRequest;

      await db
        .collection("users")
        .doc(uid)
        .update({
          "financial.salary": data.salary || 0,
          "financial.netWorth": data.netWorth || 0,
          "financial.currency": data.currency || "USD",
          "financial.spendingCategories": data.spendingCategories || [],
          "financial.financialGoals": data.financialGoals || [],
          "financial.monthlyBudget": data.monthlyBudget,
          "financial.savingsRate": data.savingsRate,
          onboardingStep: 4,
          onboardingComplete: true,
          updatedAt: Timestamp.now(),
        });

      res.json({
        success: true,
        message: "Financial information saved. Onboarding complete!",
      } as ApiResponse);
    } catch (error) {
      console.error("Error saving financial info:", error);
      res.status(500).json({
        success: false,
        error: "Failed to save financial information",
      } as ApiResponse);
    }
  }
);

/**
 * PUT /users/profile
 * Update user profile (after onboarding)
 */
router.put("/profile", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const updates = req.body;

    // Prevent updating protected fields
    delete updates.uid;
    delete updates.email;
    delete updates.createdAt;
    delete updates.plan;
    delete updates.stripeCustomerId;

    await db
      .collection("users")
      .doc(uid)
      .update({
        ...updates,
        updatedAt: Timestamp.now(),
      });

    res.json({
      success: true,
      message: "Profile updated successfully",
    } as ApiResponse);
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update profile",
    } as ApiResponse);
  }
});

/**
 * POST /users/fix-onboarding
 * Fix onboarding status for a user (temporary admin endpoint)
 */
router.post("/fix-onboarding", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;
    const userEmail = req.user!.email;
    
    console.log(`Fixing onboarding for user: ${userEmail} (${uid})`);
    
    // Update the user's onboarding status
    await db.collection("users").doc(uid).set({
      onboardingComplete: true,
      updatedAt: Timestamp.now(),
    }, { merge: true });
    
    // Get the updated profile
    const userDoc = await db.collection("users").doc(uid).get();
    const profile = userDoc.data();
    
    console.log(`Onboarding fixed for ${userEmail}`);
    
    res.json({
      success: true,
      message: "Onboarding status fixed",
      data: profile,
    } as ApiResponse);
  } catch (error: any) {
    console.error("Error fixing onboarding:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fix onboarding",
    } as ApiResponse);
  }
});

export default router;





