import { Timestamp } from "firebase-admin/firestore";

export interface UserProfile {
  uid: string;
  email: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  plan: "free" | "pro";
  stripeCustomerId?: string;
  onboardingComplete: boolean;
  onboardingStep: number;

  // Personal Info
  personal: {
    fullName: string;
    age: number;
    occupation: string;
    location: string;
    timezone: string;
    interests: string[];
    lifeGoals: string[];
    lifestyle: {
      morningPerson: boolean;
      workStyle: string;
      sleepHours: number;
    };
  };

  // Financial Info
  financial: {
    salary: number;
    netWorth: number;
    currency: string;
    spendingCategories: string[];
    financialGoals: string[];
    monthlyBudget?: number;
    savingsRate?: number;
  };
}

export interface CreateUserRequest {
  email: string;
  fullName: string;
}

export interface OnboardingPersonalRequest {
  fullName: string;
  age: number;
  occupation: string;
  location: string;
  timezone: string;
}

export interface OnboardingLifestyleRequest {
  interests: string[];
  lifeGoals: string[];
  morningPerson: boolean;
  workStyle: string;
  sleepHours: number;
}

export interface OnboardingFinancialRequest {
  salary: number;
  netWorth: number;
  currency: string;
  spendingCategories: string[];
  financialGoals: string[];
  monthlyBudget?: number;
  savingsRate?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

