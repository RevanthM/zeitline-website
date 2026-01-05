import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
    }
  }
}

/**
 * Middleware to verify Firebase ID token from Authorization header
 */
export const verifyAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("verifyAuth: Missing or invalid Authorization header");
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing or invalid Authorization header",
    });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1]?.trim();
  
  if (!idToken) {
    res.status(401).json({
      error: "Unauthorized",
      message: "Missing token in Authorization header",
    });
    return;
  }

  try {
    // Verify token - Admin SDK will use production Auth if FIREBASE_AUTH_EMULATOR_HOST is not set
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error: any) {
    console.error("verifyAuth: Error verifying token", {
      code: error.code,
      message: error.message
    });
    
    let errorMessage = "Invalid or expired token";
    if (error.code === "auth/argument-error") {
      errorMessage = "Token format is invalid";
    } else if (error.code === "auth/id-token-expired") {
      errorMessage = "Token has expired. Please sign in again.";
    }
    
    res.status(401).json({
      error: "Unauthorized",
      message: errorMessage,
    });
  }
};

/**
 * Optional auth middleware - sets user if token present but doesn't require it
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const idToken = authHeader.split("Bearer ")[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
    } catch (error) {
      // Token invalid, but we continue without user
      console.warn("Invalid token in optional auth:", error);
    }
  }

  next();
};





