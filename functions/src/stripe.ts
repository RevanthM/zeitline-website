import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import { verifyAuth } from "./middleware/auth";
import { ApiResponse } from "./types";
import { Timestamp } from "firebase-admin/firestore";

const router = Router();
const db = admin.firestore();

// Initialize Stripe - use environment variable
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

// Stripe Price ID for Pro plan ($20/month)
const PRO_PLAN_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || "";

/**
 * POST /stripe/create-checkout
 * Create a Stripe Checkout session for Pro plan upgrade
 */
router.post(
  "/create-checkout",
  verifyAuth,
  async (req: Request, res: Response) => {
    try {
      const uid = req.user!.uid;
      const { successUrl, cancelUrl } = req.body;

      // Get user from Firestore
      const userDoc = await db.collection("users").doc(uid).get();
      if (!userDoc.exists) {
        res.status(404).json({
          success: false,
          error: "User not found",
        } as ApiResponse);
        return;
      }

      const userData = userDoc.data()!;

      // Check if user already has Pro plan
      if (userData.plan === "pro") {
        res.status(400).json({
          success: false,
          error: "User already has Pro plan",
        } as ApiResponse);
        return;
      }

      // Get or create Stripe customer
      let customerId = userData.stripeCustomerId;

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: userData.email,
          metadata: {
            firebaseUid: uid,
          },
        });
        customerId = customer.id;

        // Save Stripe customer ID to Firestore
        await db.collection("users").doc(uid).update({
          stripeCustomerId: customerId,
          updatedAt: Timestamp.now(),
        });
      }

      // Create Checkout session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        mode: "subscription",
        line_items: [
          {
            price: PRO_PLAN_PRICE_ID,
            quantity: 1,
          },
        ],
        success_url:
          successUrl || `${req.headers.origin}/dashboard?upgraded=true`,
        cancel_url: cancelUrl || `${req.headers.origin}/pricing?cancelled=true`,
        metadata: {
          firebaseUid: uid,
        },
        subscription_data: {
          metadata: {
            firebaseUid: uid,
          },
        },
      });

      res.json({
        success: true,
        data: {
          sessionId: session.id,
          url: session.url,
        },
      } as ApiResponse);
    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create checkout session",
      } as ApiResponse);
    }
  }
);

/**
 * POST /stripe/create-portal
 * Create a Stripe Customer Portal session for managing subscription
 */
router.post(
  "/create-portal",
  verifyAuth,
  async (req: Request, res: Response) => {
    try {
      const uid = req.user!.uid;
      const { returnUrl } = req.body;

      // Get user from Firestore
      const userDoc = await db.collection("users").doc(uid).get();
      if (!userDoc.exists) {
        res.status(404).json({
          success: false,
          error: "User not found",
        } as ApiResponse);
        return;
      }

      const userData = userDoc.data()!;

      if (!userData.stripeCustomerId) {
        res.status(400).json({
          success: false,
          error: "No subscription found",
        } as ApiResponse);
        return;
      }

      // Create portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: userData.stripeCustomerId,
        return_url: returnUrl || `${req.headers.origin}/dashboard`,
      });

      res.json({
        success: true,
        data: {
          url: session.url,
        },
      } as ApiResponse);
    } catch (error) {
      console.error("Error creating portal session:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create portal session",
      } as ApiResponse);
    }
  }
);

/**
 * POST /stripe/webhook
 * Handle Stripe webhook events
 */
router.post("/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

  let event: Stripe.Event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (error) {
    console.error("Webhook signature verification failed:", error);
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  // Handle the event
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.metadata?.firebaseUid;

      if (uid) {
        // Update user to Pro plan
        await db.collection("users").doc(uid).update({
          plan: "pro",
          updatedAt: Timestamp.now(),
        });

        // Store subscription info
        if (session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );

          await db.collection("subscriptions").doc(subscription.id).set({
            uid,
            stripeCustomerId: session.customer,
            subscriptionId: subscription.id,
            status: subscription.status,
            priceId: PRO_PLAN_PRICE_ID,
            currentPeriodStart: Timestamp.fromMillis(
              subscription.current_period_start * 1000
            ),
            currentPeriodEnd: Timestamp.fromMillis(
              subscription.current_period_end * 1000
            ),
            createdAt: Timestamp.now(),
          });
        }

        console.log(`User ${uid} upgraded to Pro plan`);
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const uid = subscription.metadata?.firebaseUid;

      if (uid) {
        // Update subscription status
        await db.collection("subscriptions").doc(subscription.id).update({
          status: subscription.status,
          currentPeriodStart: Timestamp.fromMillis(
            subscription.current_period_start * 1000
          ),
          currentPeriodEnd: Timestamp.fromMillis(
            subscription.current_period_end * 1000
          ),
          updatedAt: Timestamp.now(),
        });

        // If subscription is no longer active, downgrade to free
        if (
          subscription.status === "canceled" ||
          subscription.status === "unpaid"
        ) {
          await db.collection("users").doc(uid).update({
            plan: "free",
            updatedAt: Timestamp.now(),
          });
          console.log(`User ${uid} downgraded to Free plan`);
        }
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const uid = subscription.metadata?.firebaseUid;

      if (uid) {
        // Downgrade user to free plan
        await db.collection("users").doc(uid).update({
          plan: "free",
          updatedAt: Timestamp.now(),
        });

        // Update subscription record
        await db.collection("subscriptions").doc(subscription.id).update({
          status: "canceled",
          canceledAt: Timestamp.now(),
        });

        console.log(`User ${uid} subscription canceled, downgraded to Free`);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      // Find user by Stripe customer ID
      const usersSnapshot = await db
        .collection("users")
        .where("stripeCustomerId", "==", customerId)
        .limit(1)
        .get();

      if (!usersSnapshot.empty) {
        const userDoc = usersSnapshot.docs[0];
        console.log(
          `Payment failed for user ${userDoc.id}. Invoice: ${invoice.id}`
        );
        // Could send notification email here
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

/**
 * GET /stripe/subscription
 * Get current user's subscription status
 */
router.get("/subscription", verifyAuth, async (req: Request, res: Response) => {
  try {
    const uid = req.user!.uid;

    // Get user's subscription
    const subscriptionsSnapshot = await db
      .collection("subscriptions")
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (subscriptionsSnapshot.empty) {
      res.json({
        success: true,
        data: {
          hasSubscription: false,
          plan: "free",
        },
      } as ApiResponse);
      return;
    }

    const subscription = subscriptionsSnapshot.docs[0].data();

    res.json({
      success: true,
      data: {
        hasSubscription: true,
        plan: "pro",
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    } as ApiResponse);
  } catch (error) {
    console.error("Error fetching subscription:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch subscription",
    } as ApiResponse);
  }
});

export default router;

