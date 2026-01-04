# Fix Google OAuth 403 Error: access_denied

## Problem
You're seeing: "Error 403: access_denied - The app is currently being tested, and can only be accessed by developer-approved testers."

This happens because your OAuth consent screen is in "Testing" mode.

## Solution: Add Test Users

### Step 1: Go to Google Cloud Console
1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (zeitlineai)
3. Navigate to **APIs & Services** → **OAuth consent screen**

### Step 2: Add Test Users
1. Scroll down to the **Test users** section
2. Click **+ ADD USERS**
3. Add your Google account email address (the one you're using to sign in)
4. Click **ADD**
5. Save the changes

### Step 3: Verify Redirect URIs
While you're there, make sure these redirect URIs are added in **Credentials**:

1. Go to **APIs & Services** → **Credentials**
2. Click on your OAuth 2.0 Client ID
3. Under **Authorized redirect URIs**, ensure you have:
   - `http://localhost:9000/zeitlineai/us-central1/api/calendars/google/callback` (for local emulator)
   - `https://us-central1-zeitlineai.cloudfunctions.net/api/calendars/google/callback` (for production)

### Step 4: Try Again
1. Go back to your app at http://localhost:5500
2. Try connecting Google Calendar again
3. You should now be able to authorize the app

## Alternative: Publish Your App (For Production)

If you want anyone to use your app (not just test users):

1. Go to **OAuth consent screen**
2. Change **Publishing status** from "Testing" to "In production"
3. Complete the verification process (may require app verification for sensitive scopes)

**Note:** For development/testing, adding test users is the quickest solution.

## Troubleshooting

- **Still getting 403?** Make sure you're signed in with the exact email you added as a test user
- **Redirect URI mismatch?** The redirect URI must match EXACTLY (including http vs https, port numbers, etc.)
- **Scopes not showing?** Make sure Google Calendar API is enabled in your project


