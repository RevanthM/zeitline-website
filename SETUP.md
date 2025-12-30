# Zeitline Backend Setup Guide

This guide will help you set up the Zeitline backend with Firebase and Stripe.

## Prerequisites

- Node.js 20+
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project
- A Stripe account

## 1. Firebase Setup

### Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project named "zeitline-app" (or your preferred name)
3. Enable the following services:
   - **Authentication**: Enable Email/Password, Google, and Apple sign-in
   - **Firestore**: Create database in production mode
   - **Hosting**: Enable hosting

### Configure Firebase CLI

```bash
# Login to Firebase
firebase login

# Initialize project (select existing project)
cd zeitline-website
firebase use --add
# Select your project and give it an alias like "default"
```

### Update Firebase Config

Edit `public/js/firebase-config.js` with your Firebase project settings:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

You can find these values in Firebase Console > Project Settings > General > Your apps.

## 2. Stripe Setup

### Create Stripe Account

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Create an account or sign in

### Create Pro Plan Product

1. Go to **Products** > **Add Product**
2. Fill in:
   - Name: `Zeitline Pro`
   - Description: `Full access to all Zeitline features`
3. Add a price:
   - Pricing model: Recurring
   - Amount: $20.00 USD
   - Billing period: Monthly
4. Save and copy the **Price ID** (starts with `price_`)

### Get API Keys

1. Go to **Developers** > **API keys**
2. Copy your **Secret key** (starts with `sk_test_` or `sk_live_`)

### Set Up Webhook

1. Go to **Developers** > **Webhooks**
2. Click **Add endpoint**
3. Endpoint URL: `https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/api/stripe/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Copy the **Signing secret** (starts with `whsec_`)

### Configure Environment Variables

For local development, create `functions/.env`:

```bash
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRO_PRICE_ID=price_xxxxx
```

For production, set these in Firebase:

```bash
firebase functions:config:set stripe.secret_key="sk_live_xxxxx"
firebase functions:config:set stripe.webhook_secret="whsec_xxxxx"
firebase functions:config:set stripe.pro_price_id="price_xxxxx"
```

## 3. Install Dependencies

```bash
# Install functions dependencies
cd functions
npm install

# Build TypeScript
npm run build
```

## 4. Local Development

### Start Firebase Emulators

```bash
# From the zeitline-website directory
firebase emulators:start
```

This starts:
- **Hosting**: http://localhost:5000
- **Functions**: http://localhost:5001
- **Firestore**: http://localhost:8080
- **Auth**: http://localhost:9099
- **Emulator UI**: http://localhost:4000

### Test the Website

1. Open http://localhost:5000
2. Sign up with a test email
3. Complete the onboarding flow
4. Test Stripe checkout (use [test cards](https://stripe.com/docs/testing))

## 5. Deploy to Production

```bash
# Deploy everything
firebase deploy

# Or deploy specific services
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## 6. Post-Deployment

### Update Stripe Webhook URL

After deploying, update your Stripe webhook URL to the production Cloud Functions URL.

### Enable Google/Apple Sign-in

1. **Google**: Configure OAuth consent screen in Google Cloud Console
2. **Apple**: Configure Sign in with Apple in Apple Developer Console

### Set Up Custom Domain (Optional)

1. Firebase Console > Hosting > Add custom domain
2. Follow DNS verification steps

## Project Structure

```
zeitline-website/
├── public/                 # Frontend files (served by Firebase Hosting)
│   ├── index.html         # Landing page
│   ├── signup.html        # Sign up page
│   ├── login.html         # Login page
│   ├── onboarding.html    # Onboarding flow
│   ├── dashboard.html     # User dashboard
│   ├── css/
│   │   └── styles.css     # Shared styles
│   └── js/
│       ├── firebase-config.js  # Firebase initialization
│       ├── auth.js             # Auth helpers
│       └── onboarding.js       # Onboarding logic
├── functions/              # Cloud Functions (Node.js/TypeScript)
│   ├── src/
│   │   ├── index.ts       # Main entry point
│   │   ├── users.ts       # User API routes
│   │   ├── stripe.ts      # Stripe API routes
│   │   ├── types.ts       # TypeScript interfaces
│   │   └── middleware/
│   │       └── auth.ts    # Auth middleware
│   ├── package.json
│   └── tsconfig.json
├── firebase.json          # Firebase configuration
├── firestore.rules        # Security rules
└── .firebaserc           # Project aliases
```

## API Endpoints

### User Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/users/create` | Create user profile after signup |
| GET | `/api/users/profile` | Get current user's profile |
| POST | `/api/users/onboarding/personal` | Save personal info (Step 1) |
| POST | `/api/users/onboarding/lifestyle` | Save lifestyle preferences (Step 2) |
| POST | `/api/users/onboarding/financial` | Save financial info (Step 3) |
| PUT | `/api/users/profile` | Update user profile |

### Stripe Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/stripe/create-checkout` | Create Stripe checkout session |
| POST | `/api/stripe/create-portal` | Create customer portal session |
| GET | `/api/stripe/subscription` | Get subscription status |
| POST | `/api/stripe/webhook` | Stripe webhook handler |

## Troubleshooting

### "Permission denied" errors
- Check Firestore rules are deployed: `firebase deploy --only firestore:rules`
- Ensure user is authenticated before API calls

### Stripe checkout not working
- Verify `STRIPE_PRO_PRICE_ID` is set correctly
- Check Stripe dashboard for errors

### Auth issues
- Ensure Firebase Auth is enabled in console
- Check that `authDomain` in config matches your project

## Support

For issues, please open a GitHub issue or contact support@zeitline.app

