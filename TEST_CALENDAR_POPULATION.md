# Testing Calendar Population from Onboarding

## Current Status

Based on browser console logs:
- ❌ User is **not logged in** - this is required for onboarding events to be created
- ⚠️ API calls are failing because authentication is required
- ✅ Calendar is loading demo events as fallback

## How to Test

### Step 1: Complete Onboarding
1. Go to `/onboarding-chat.html`
2. Complete the AI conversation with time-based questions like:
   - "What time do you wake up?"
   - "Does this differ on weekends?"
   - "What time do you have breakfast/lunch/dinner?"
   - "What time do you start and end work?"
   - "When do you exercise?"

### Step 2: Check Onboarding Data
Open browser console and run:
```javascript
const data = localStorage.getItem('zeitline_onboarding_data');
console.log('Onboarding data:', JSON.parse(data));
```

### Step 3: View Calendar
1. Go to `/calendar.html` (must be logged in)
2. Check browser console for logs:
   - `🔄 Calling API to populate calendar from onboarding data...`
   - `✅ Populated calendar with X events from onboarding`
   - `📅 Zeitline onboarding event loaded:`
   - `✅ Found X Zeitline onboarding events:`

### Step 4: Verify Events Appear
- Events should appear in the calendar view
- Look for events like:
  - "Wake Up"
  - "Breakfast"
  - "Work Start"
  - "Lunch"
  - "Work End"
  - "Exercise"
  - "Dinner"
  - "Bedtime"

## Debugging

If events don't appear:

1. **Check if user is logged in:**
   ```javascript
   firebase.auth().currentUser
   ```

2. **Check if calendar was populated:**
   ```javascript
   localStorage.getItem('zeitline_calendar_populated')
   ```

3. **Check onboarding data:**
   ```javascript
   const data = JSON.parse(localStorage.getItem('zeitline_onboarding_data'));
   console.log('Routines:', data.collectedData?.routines);
   ```

4. **Check Firestore events:**
   - Events are stored in: `users/{uid}/calendar_events`
   - Filter by: `calendarType == "zeitline"` AND `source == "onboarding"`

5. **Check API response:**
   - Open Network tab in browser DevTools
   - Look for `/calendars/populate-from-onboarding` request
   - Check response for `eventsCreated` count

## Expected Flow

1. User completes onboarding → Data saved to `localStorage` and Firestore
2. User visits calendar page → `checkAndPopulateFromOnboarding()` runs
3. Function checks if calendar already populated → If not, calls API
4. API creates recurring events in Firestore
5. Calendar loads events from `/calendars/events` endpoint
6. Events appear in calendar view

## Known Issues

- User must be logged in for events to be created
- Backend must be running (Firebase Functions)
- Events are created as recurring weekly events
- Weekend events are separate from weekday events

