# Calendar Integration Setup Guide

This guide explains how to set up calendar integrations (Google Calendar, Microsoft Outlook, and Apple Calendar) for the Zeitline website.

## Overview

The calendar integration allows users to:
- Connect their Google Calendar, Microsoft Outlook, or Apple Calendar
- Sync events from connected calendars
- View calendar events alongside Zeitline predictions
- Have calendar events influence AI predictions

## Backend Setup

### 1. Install Dependencies

```bash
cd functions
npm install
```

This will install `axios` which is required for making API calls to calendar providers.

### 2. Configure Environment Variables

Copy the environment template and fill in your OAuth credentials:

```bash
cp functions/env.template functions/.env
```

Then edit `functions/.env` with your credentials:

#### Google Calendar OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google Calendar API
4. Go to "Credentials" → "Create Credentials" → "OAuth client ID"
5. Choose "Web application"
6. Add authorized redirect URIs:
   - For production: `https://your-project.cloudfunctions.net/api/calendars/google/callback`
   - For local emulator: `http://localhost:9000/zeitlineai/us-central1/api/calendars/google/callback`
7. Copy the Client ID and Client Secret to your `.env` file or place them in `functions/google-credentials.json`

#### Microsoft Outlook OAuth Setup

1. Go to [Azure Portal](https://portal.azure.com/)
2. Navigate to "Azure Active Directory" → "App registrations"
3. Click "New registration"
4. Set redirect URI: `https://your-project.cloudfunctions.net/api/calendars/outlook/callback`
5. Go to "Certificates & secrets" → Create a new client secret
6. Copy the Application (client) ID and client secret to your `.env` file
7. Add API permissions: `Calendars.Read` and `offline_access`

#### Apple Calendar Setup

Apple Calendar uses CalDAV, which requires:
- User's Apple ID email
- App-specific password (generated at appleid.apple.com)

No OAuth setup needed for Apple Calendar, but users will need to provide their credentials.

### 3. Deploy Functions

```bash
cd functions
npm run build
firebase deploy --only functions
```

After deployment, update your redirect URIs in Google and Microsoft consoles to match your deployed function URLs.

## Frontend Setup

The calendar page is already set up at `/calendar.html`. Users can:

1. Navigate to the Calendar page
2. Click "Connect" next to their preferred calendar provider
3. Complete the OAuth flow
4. Events will automatically sync and display

### Automatic Google Calendar Connection

If a user signs in with Google, the system will automatically attempt to connect their Google Calendar. This happens in the background when they first visit the calendar page.

## Features

### Calendar Connection
- **Google Calendar**: Full OAuth 2.0 flow with automatic token refresh
- **Microsoft Outlook**: Microsoft Graph API integration with OAuth 2.0
- **Apple Calendar**: CalDAV integration (requires user credentials)

### Event Syncing
- Events are fetched for the current month view
- Events are automatically refreshed when tokens expire
- Multiple calendars from the same provider are supported
- Users can select which calendars to sync

### Event Display
- Events appear on the calendar grid
- Color-coded by calendar provider (Google: blue, Outlook: blue, Apple: black)
- Click events to view details
- Events are integrated with the timeline view

## API Endpoints

### GET `/calendars/list`
Get all connected calendars for the current user.

### POST `/calendars/google/connect`
Initiate Google Calendar OAuth flow. Returns an authorization URL.

### GET `/calendars/google/callback`
Handle Google OAuth callback. This is called by Google after user authorization.

### POST `/calendars/outlook/connect`
Initiate Microsoft Outlook OAuth flow. Returns an authorization URL.

### GET `/calendars/outlook/callback`
Handle Microsoft OAuth callback.

### POST `/calendars/apple/connect`
Connect Apple Calendar via CalDAV. Requires email and app-specific password.

### GET `/calendars/events`
Get calendar events for a date range. Query parameters:
- `start`: ISO date string (required)
- `end`: ISO date string (required)

### GET `/calendars/events/:eventId`
Get details for a specific calendar event.

## Data Storage

Calendar connections are stored in Firestore at:
```
users/{uid}/calendars/{provider}
```

Each calendar document contains:
- `type`: "google", "outlook", or "apple"
- `accessToken`: OAuth access token (encrypted in production)
- `refreshToken`: OAuth refresh token (for Google/Outlook)
- `expiresAt`: Token expiration timestamp
- `calendars`: Array of calendar objects with `id`, `name`, and `selected` flag
- `connectedAt`: Connection timestamp
- `updatedAt`: Last update timestamp

## Security Notes

1. **Token Storage**: In production, encrypt access tokens and refresh tokens before storing in Firestore
2. **HTTPS Only**: All OAuth redirects must use HTTPS
3. **State Tokens**: OAuth state tokens expire after 10 minutes
4. **Apple Credentials**: Consider encrypting Apple Calendar passwords before storage

## Troubleshooting

### Google Calendar not connecting
- Verify redirect URI matches exactly in Google Cloud Console
- Check that Google Calendar API is enabled
- Ensure OAuth consent screen is configured

### Outlook not connecting
- Verify redirect URI in Azure Portal
- Check API permissions are granted
- Verify tenant allows external users (if applicable)

### Events not showing
- Check browser console for errors
- Verify calendar is selected in the connection settings
- Ensure date range includes current month
- Check Firestore for stored calendar connections

## Future Enhancements

- [ ] Event creation/editing
- [ ] AI-powered event suggestions
- [ ] Calendar event influence on predictions
- [ ] Two-way sync (create events in external calendars)
- [ ] Calendar conflict detection
- [ ] Recurring event support
- [ ] Event reminders and notifications

