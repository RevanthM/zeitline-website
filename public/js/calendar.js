// Calendar functionality for Zeitline
// Version: 2.0 - Firestore activity loading disabled

let currentMonth = new Date();
let currentView = 'month';
let selectedDate = null;
let calendarEvents = {};
let connectedCalendars = [];
let zoomLevel = 0; // 0 = default hourly (max zoom out), 1 = 15-min intervals, 2 = 1-min intervals for 2 hours (max zoom in)

// Auto-detect user's system timezone
let selectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';

// Calendar color preferences (theme-friendly colors)
let calendarColors = {
    google: '#4285f4',
    outlook: '#0078d4',
    apple: '#86868b',
    zeitline: '#c9ff57', // var(--accent-primary)
    multiple: '#57ffd4' // var(--accent-secondary)
};

// Initialize calendar
// Check and populate calendar from onboarding data
async function checkAndPopulateFromOnboarding() {
    try {
        // Check if onboarding data exists and calendar hasn't been populated yet
        const onboardingData = localStorage.getItem('zeitline_onboarding_data');
        const calendarPopulated = localStorage.getItem('zeitline_calendar_populated');
        
        if (!onboardingData || calendarPopulated === 'true') {
            return; // No onboarding data or already populated
        }
        
        const parsed = JSON.parse(onboardingData);
        const collectedData = parsed.collectedData || {};
        
        // Check if we have routine data
        if (!collectedData.routines && !collectedData.wakeTime && !collectedData.workStartTime) {
            return; // No routine data to populate
        }
        
        // Wait for auth
        await waitForAuth();
        
        if (typeof firebase === 'undefined' || !firebase.auth) {
            return;
        }
        
        const user = firebase.auth().currentUser;
        if (!user) {
            return; // Not logged in
        }
        
        // Transform data to include routines if not already present
        const routines = collectedData.routines || {
            weekday: {
                wakeTime: collectedData.wakeTimeWeekday || collectedData.wakeTime,
                bedtime: collectedData.bedtimeWeekday || collectedData.bedtime,
                workStart: collectedData.workStartTime,
                workEnd: collectedData.workEndTime,
                meals: {
                    breakfast: collectedData.breakfastTime,
                    lunch: collectedData.lunchTime,
                    dinner: collectedData.dinnerTime,
                },
                exercise: collectedData.exerciseTime ? {
                    time: collectedData.exerciseTime,
                    days: collectedData.exerciseDays || [],
                    duration: collectedData.exerciseDuration || "60",
                } : null,
            },
            weekend: {
                wakeTime: collectedData.wakeTimeWeekend,
                bedtime: collectedData.bedtimeWeekend,
                meals: collectedData.mealTimesWeekend || {},
            },
        };
        
        const onboardingDataForAPI = {
            ...collectedData,
            routines,
        };
        
        // Call API to populate calendar
        try {
            const response = await apiCall('/calendars/populate-from-onboarding', {
                method: 'POST',
                body: JSON.stringify({ onboardingData: onboardingDataForAPI })
            });
            
            if (response.success) {
                console.log(`✅ Populated calendar with ${response.data.eventsCreated} events from onboarding`);
                localStorage.setItem('zeitline_calendar_populated', 'true');
                
                // Reload calendar events to show the new ones
                setTimeout(() => {
                    loadCalendarEvents();
                }, 1000);
            }
        } catch (error) {
            console.error('Error populating calendar from onboarding:', error);
        }
    } catch (error) {
        console.error('Error checking onboarding data:', error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('Calendar: Initializing...');
        loadUserInfo();
        
        // Check if we need to populate calendar from onboarding data
        await checkAndPopulateFromOnboarding();
        
        // Load timezone preference from localStorage, or use system timezone
        const savedTimezone = localStorage.getItem('calendarTimezone');
        if (savedTimezone) {
            selectedTimezone = savedTimezone;
        } else {
            // Auto-save the detected system timezone
            const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            if (systemTimezone) {
                selectedTimezone = systemTimezone;
                localStorage.setItem('calendarTimezone', systemTimezone);
                console.log('Auto-detected timezone:', systemTimezone);
            }
        }
        
        // Load calendar color preferences from localStorage
        const savedColors = localStorage.getItem('calendarColors');
        if (savedColors) {
            try {
                calendarColors = { ...calendarColors, ...JSON.parse(savedColors) };
            } catch (e) {
                console.error('Error loading calendar colors:', e);
            }
        }
        
        // Apply saved colors
        applyCalendarColors();
        
        // Render calendar connections immediately (with empty array)
        // Use setTimeout to ensure DOM is fully ready
        setTimeout(() => {
            try {
                console.log('Attempting to render calendar connections and timezone selector...');
                renderCalendarConnections();
                // Initialize timezone selector after DOM is ready
                initializeTimezoneSelector();
                console.log('Calendar UI initialization complete');
            } catch (e) {
                console.error('Error initializing calendar UI:', e);
                // Show error in UI if elements exist
                const connectionsContainer = document.getElementById('calendarConnections');
                if (connectionsContainer) {
                    connectionsContainer.innerHTML = '<p style="color: var(--error);">Error loading calendar connections. Please refresh the page.</p>';
                }
            }
        }, 100);
        
        // Wait for Firebase Auth to be ready
        await waitForAuth();
        
        await loadConnectedCalendars();
        
        // Set initial selected date if not set
        if (!selectedDate) {
            const today = new Date();
            const year = today.getFullYear();
            const month = today.getMonth() + 1;
            const day = today.getDate();
            selectedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        
        await loadCalendarEvents();
        
        // Initialize time column
        renderTimeColumn();
        
        // Render based on current view
        if (currentView === 'month') {
            renderCalendar();
        } else if (currentView === 'week') {
            renderWeekView();
        } else if (currentView === 'day') {
            renderDayView();
        } else {
            renderCalendar();
        }
        
        // Check if user signed in with Google and auto-connect calendar
        checkGoogleSignIn();
        
        // Listen for OAuth callback messages
        window.addEventListener('message', async (event) => {
            if (event.data && event.data.type === 'calendar_connected') {
                hideLoading();
                await loadConnectedCalendars();
                await loadCalendarEvents();
                showSuccess(`${event.data.provider} calendar connected successfully!`);
            }
        });
        
        console.log('Calendar: Initialization complete');
    } catch (error) {
        console.error('Calendar: Fatal error during initialization:', error);
        // Show error to user
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 1rem; background: #ff4444; color: white; border-radius: 8px; z-index: 10000;';
        errorDiv.textContent = 'Error loading calendar. Please refresh the page.';
        document.body.appendChild(errorDiv);
    }
});

// Check and populate calendar from onboarding data
async function checkAndPopulateFromOnboarding() {
    try {
        // Check if onboarding data exists and calendar hasn't been populated yet
        const onboardingData = localStorage.getItem('zeitline_onboarding_data');
        const calendarPopulated = localStorage.getItem('zeitline_calendar_populated');
        
        if (!onboardingData || calendarPopulated === 'true') {
            return; // No onboarding data or already populated
        }
        
        const parsed = JSON.parse(onboardingData);
        const collectedData = parsed.collectedData || {};
        
        // Check if we have routine data
        if (!collectedData.routines && !collectedData.wakeTime && !collectedData.workStartTime) {
            return; // No routine data to populate
        }
        
        // Wait for auth
        await waitForAuth();
        
        if (typeof firebase === 'undefined' || !firebase.auth) {
            return;
        }
        
        const user = firebase.auth().currentUser;
        if (!user) {
            return; // Not logged in
        }
        
        // Transform data to include routines if not already present
        const routines = collectedData.routines || {
            weekday: {
                wakeTime: collectedData.wakeTimeWeekday || collectedData.wakeTime,
                bedtime: collectedData.bedtimeWeekday || collectedData.bedtime,
                workStart: collectedData.workStartTime,
                workEnd: collectedData.workEndTime,
                meals: {
                    breakfast: collectedData.breakfastTime,
                    lunch: collectedData.lunchTime,
                    dinner: collectedData.dinnerTime,
                },
                exercise: collectedData.exerciseTime ? {
                    time: collectedData.exerciseTime,
                    days: collectedData.exerciseDays || [],
                    duration: collectedData.exerciseDuration || "60",
                } : null,
            },
            weekend: {
                wakeTime: collectedData.wakeTimeWeekend,
                bedtime: collectedData.bedtimeWeekend,
                meals: collectedData.mealTimesWeekend || {},
            },
        };
        
        const onboardingDataForAPI = {
            ...collectedData,
            routines,
        };
        
        // Call API to populate calendar
        try {
            const response = await apiCall('/calendars/populate-from-onboarding', {
                method: 'POST',
                body: JSON.stringify({ onboardingData: onboardingDataForAPI })
            });
            
            if (response.success) {
                console.log(`✅ Populated calendar with ${response.data.eventsCreated} events from onboarding`);
                localStorage.setItem('zeitline_calendar_populated', 'true');
                
                // Reload calendar events to show the new ones
                setTimeout(() => {
                    loadCalendarEvents();
                }, 1000);
            }
        } catch (error) {
            console.error('Error populating calendar from onboarding:', error);
        }
    } catch (error) {
        console.error('Error checking onboarding data:', error);
    }
}

// Wait for Firebase Auth to be initialized
function waitForAuth() {
    return new Promise((resolve) => {
        // Check if Firebase is loaded
        if (typeof firebase === 'undefined') {
            setTimeout(() => waitForAuth().then(resolve), 100);
            return;
        }
        
        // Check if Firebase app is initialized
        try {
            const apps = firebase.apps;
            if (!apps || apps.length === 0) {
                // Firebase not initialized yet, wait
                setTimeout(() => waitForAuth().then(resolve), 100);
                return;
            }
        } catch (e) {
            // Can't check apps, wait and retry
            setTimeout(() => waitForAuth().then(resolve), 100);
            return;
        }
        
        // Check if auth is available
        if (!firebase.auth) {
            setTimeout(() => waitForAuth().then(resolve), 100);
            return;
        }
        
        try {
            // Get auth instance - this should work now
            const auth = firebase.auth();
            
            // Auth is ready - we can now safely use auth.currentUser
            // The currentUser might be null (if not logged in), which is fine
            resolve();
        } catch (error) {
            console.error('Error waiting for auth:', error);
            // If there's an error, wait a bit and try again
            setTimeout(() => waitForAuth().then(resolve), 100);
        }
    });
}

function loadUserInfo() {
    const savedProfile = localStorage.getItem('zeitline_profile');
    if (savedProfile) {
        try {
            const profile = JSON.parse(savedProfile);
            const firstName = profile?.personal?.fullName?.split(' ')[0] || 'U';
            document.getElementById('userAvatar').textContent = firstName.charAt(0).toUpperCase();
        } catch (e) {}
    }
}

async function checkGoogleSignIn() {
    try {
        if (typeof firebase === 'undefined' || !firebase.auth) {
            return;
        }
        
        const auth = firebase.auth();
        
        // Safely get current user - it might be null
        let user = null;
        try {
            user = auth.currentUser;
        } catch (e) {
            // If we can't access currentUser yet, just return
            console.log('Auth not ready yet for Google sign-in check');
            return;
        }
        
        if (user && user.providerData && user.providerData.some(p => p.providerId === 'google.com')) {
            // Check if Google Calendar is already connected
            const hasGoogle = connectedCalendars.some(c => c.type === 'google');
            if (!hasGoogle) {
                // Auto-connect Google Calendar
                await connectCalendar('google');
            }
        }
    } catch (error) {
        console.error('Error checking Google sign-in:', error);
    }
}

// Timezone management functions
function initializeTimezoneSelector() {
    const timezoneSelect = document.getElementById('timezoneSelect');
    const applyBtn = document.getElementById('applyTimezoneBtn');
    const statusText = document.getElementById('timezoneStatus');
    
    if (!timezoneSelect) {
        console.warn('Timezone selector not found - may not be on calendar page');
        return; // Not on calendar page
    }
    
    console.log('Initializing timezone selector...', timezoneSelect);
    
    // Get all available timezones
    let allTimezones = [];
    try {
        // Use Intl.supportedValuesOf if available (modern browsers)
        if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) {
            const timezoneValues = Intl.supportedValuesOf('timeZone');
            allTimezones = timezoneValues.map(tz => {
                // Format timezone name for display
                const parts = tz.split('/');
                const city = parts[parts.length - 1].replace(/_/g, ' ');
                const region = parts.length > 1 ? parts[0].replace(/_/g, ' ') : '';
                
                // Get timezone offset for better labeling
                try {
                    const now = new Date();
                    const formatter = new Intl.DateTimeFormat('en-US', {
                        timeZone: tz,
                        timeZoneName: 'short'
                    });
                    const parts2 = formatter.formatToParts(now);
                    const tzName = parts2.find(p => p.type === 'timeZoneName')?.value || '';
                    const label = `${city}${region ? ` (${region})` : ''} ${tzName ? `(${tzName})` : ''}`;
                    return { value: tz, label: label.trim() };
                } catch (e) {
                    return { value: tz, label: `${city}${region ? ` (${region})` : ''}` };
                }
            });
        } else {
            // Fallback: comprehensive list of common timezones
            allTimezones = [
                { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
                { value: 'America/New_York', label: 'New York (EST/EDT)' },
                { value: 'America/Chicago', label: 'Chicago (CST/CDT)' },
                { value: 'America/Denver', label: 'Denver (MST/MDT)' },
                { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
                { value: 'America/Phoenix', label: 'Phoenix (MST)' },
                { value: 'America/Anchorage', label: 'Anchorage (AKST/AKDT)' },
                { value: 'Pacific/Honolulu', label: 'Honolulu (HST)' },
                { value: 'America/Toronto', label: 'Toronto (EST/EDT)' },
                { value: 'America/Vancouver', label: 'Vancouver (PST/PDT)' },
                { value: 'America/Mexico_City', label: 'Mexico City (CST/CDT)' },
                { value: 'America/Sao_Paulo', label: 'São Paulo (BRT/BRST)' },
                { value: 'America/Buenos_Aires', label: 'Buenos Aires (ART)' },
                { value: 'Europe/London', label: 'London (GMT/BST)' },
                { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
                { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
                { value: 'Europe/Rome', label: 'Rome (CET/CEST)' },
                { value: 'Europe/Madrid', label: 'Madrid (CET/CEST)' },
                { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
                { value: 'Europe/Stockholm', label: 'Stockholm (CET/CEST)' },
                { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
                { value: 'Asia/Dubai', label: 'Dubai (GST)' },
                { value: 'Asia/Kolkata', label: 'Mumbai/New Delhi (IST)' },
                { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
                { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
                { value: 'Asia/Seoul', label: 'Seoul (KST)' },
                { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
                { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
                { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
                { value: 'Australia/Sydney', label: 'Sydney (AEDT/AEST)' },
                { value: 'Australia/Melbourne', label: 'Melbourne (AEDT/AEST)' },
                { value: 'Australia/Perth', label: 'Perth (AWST)' },
                { value: 'Pacific/Auckland', label: 'Auckland (NZDT/NZST)' },
            ];
        }
        
        // Sort timezones alphabetically by label
        allTimezones.sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
        console.error('Error getting timezones:', e);
        // Fallback to basic list
        allTimezones = [
            { value: 'UTC', label: 'UTC' },
            { value: 'America/New_York', label: 'New York' },
            { value: 'America/Chicago', label: 'Chicago' },
            { value: 'America/Denver', label: 'Denver' },
            { value: 'America/Los_Angeles', label: 'Los Angeles' },
        ];
    }
    
    // Populate timezone selector
    const optionsHTML = allTimezones.map(tz => 
        `<option value="${tz.value}" ${tz.value === selectedTimezone ? 'selected' : ''}>${tz.label}</option>`
    ).join('');
    
    timezoneSelect.innerHTML = optionsHTML;
    
    console.log(`Populated timezone selector with ${allTimezones.length} options, selected: ${selectedTimezone}`);
    
    // Update status text
    updateTimezoneStatus();
    
    // Apply button handler - remove existing listeners first
    if (applyBtn) {
        // Clone and replace to remove old listeners
        const newApplyBtn = applyBtn.cloneNode(true);
        applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);
        
        newApplyBtn.addEventListener('click', () => {
            const newTimezone = timezoneSelect.value;
            console.log('Timezone changed to:', newTimezone);
            selectedTimezone = newTimezone;
            localStorage.setItem('calendarTimezone', newTimezone);
            updateTimezoneStatus();
            showSuccess('Timezone updated! Refreshing calendar...');
            
            // Reload events with new timezone
            setTimeout(() => {
                loadCalendarEvents().then(() => {
                    if (currentView === 'month') {
                        renderCalendar();
                    } else if (currentView === 'week') {
                        renderWeekView();
                    } else if (currentView === 'day') {
                        renderDayView();
                    }
                });
            }, 500);
        });
    }
}

function updateTimezoneStatus() {
    const statusText = document.getElementById('timezoneStatus');
    if (!statusText) return;
    
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: selectedTimezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZoneName: 'short'
        });
        const localTime = formatter.format(now);
        statusText.textContent = `Current time in selected timezone: ${localTime}`;
    } catch (e) {
        statusText.textContent = `Timezone: ${selectedTimezone}`;
    }
}

// Convert event time to selected timezone
function convertEventTimeToTimezone(isoString, targetTimezone) {
    try {
        // Parse the ISO string (handles timezone info automatically)
        const date = new Date(isoString);
        
        // Get the time components in the target timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: targetTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        
        const parts = formatter.formatToParts(date);
        const year = parseInt(parts.find(p => p.type === 'year').value);
        const month = parseInt(parts.find(p => p.type === 'month').value) - 1; // JS months are 0-indexed
        const day = parseInt(parts.find(p => p.type === 'day').value);
        const hour = parseInt(parts.find(p => p.type === 'hour').value);
        const minute = parseInt(parts.find(p => p.type === 'minute').value);
        const second = parseInt(parts.find(p => p.type === 'second').value);
        
        // Create a new date object in local time with the target timezone's values
        // This gives us the correct local representation
        return new Date(year, month, day, hour, minute, second);
    } catch (e) {
        console.error('Error converting timezone:', e);
        // Fallback to original parsing
        return new Date(isoString);
    }
}

async function loadConnectedCalendars() {
    try {
        const response = await apiCall('/calendars/list');
        connectedCalendars = response.data || [];
    } catch (error) {
        console.error('Error loading calendars:', error);
        connectedCalendars = [];
    } finally {
        // Always render, even if loading failed
        renderCalendarConnections();
    }
}

function renderCalendarConnections() {
    const container = document.getElementById('calendarConnections');
    if (!container) {
        console.warn('Calendar connections container not found - checking if page loaded correctly');
        return; // Container doesn't exist on this page
    }
    console.log('Rendering calendar connections in container:', container);
    
    // Ensure connectedCalendars is initialized
    if (!connectedCalendars) {
        connectedCalendars = [];
    }
    
    const calendarTypes = [
        { 
            type: 'google', 
            name: 'Google Calendar',
            icon: `<img src="/images/google-calendar-transparent.png" alt="Google Calendar" style="width: 24px; height: 24px; object-fit: contain;">`
        },
        { 
            type: 'outlook', 
            name: 'Microsoft Outlook',
            icon: `<img src="/images/outlook-calendar-transparent.png" alt="Microsoft Outlook" style="width: 24px; height: 24px; object-fit: contain;">`
        },
        { 
            type: 'apple', 
            name: 'Apple Calendar',
            icon: `<img src="/images/apple-calendar-transparent.png" alt="Apple Calendar" style="width: 24px; height: 24px; object-fit: contain;">`
        },
        { 
            type: 'zeitline', 
            name: 'Zeitline Events',
            icon: `<div style="width: 24px; height: 24px; border-radius: 4px; background: var(--accent-primary);"></div>`
        }
    ];
    
    try {
        container.innerHTML = calendarTypes.map(cal => {
            const connected = connectedCalendars.find(c => c.type === cal.type);
            const isConnected = !!connected || cal.type === 'zeitline'; // Zeitline is always "connected"
            const currentColor = calendarColors[cal.type] || calendarColors.zeitline;
            
            return `
                <div class="calendar-connection ${isConnected ? 'connected' : ''}">
                    <div class="calendar-icon ${cal.type}">${cal.icon}</div>
                    <div class="calendar-info" style="flex: 1;">
                        <div class="calendar-name">${cal.name}</div>
                        <div class="calendar-status ${isConnected ? 'connected' : ''}">
                            ${isConnected ? '✓ Connected' : 'Not connected'}
                        </div>
                    </div>
                    <div class="calendar-color-picker" style="display: flex; align-items: center; gap: 0.5rem; margin-right: 0.75rem;">
                        <label style="font-size: 0.75rem; color: var(--text-muted);">Color:</label>
                        <input type="color" 
                               value="${currentColor}" 
                               onchange="updateCalendarColor('${cal.type}', this.value)"
                               style="width: 36px; height: 36px; border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; background: transparent;"
                               title="Change ${cal.name} color">
                    </div>
                    ${cal.type !== 'zeitline' ? `
                    <button class="connect-btn ${isConnected ? 'connected' : ''}" 
                            onclick="connectCalendar('${cal.type}')">
                        ${isConnected ? 'Disconnect' : 'Connect'}
                    </button>
                    ` : ''}
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error rendering calendar connections:', error);
        container.innerHTML = '<p style="color: var(--text-muted);">Error loading calendar connections. Please refresh the page.</p>';
    }
}

function updateCalendarColor(calendarType, color) {
    calendarColors[calendarType] = color;
    localStorage.setItem('calendarColors', JSON.stringify(calendarColors));
    applyCalendarColors();
    
    // Re-render calendar to apply new colors
    if (currentView === 'month') {
        renderCalendar();
    } else if (currentView === 'week') {
        renderWeekView();
    } else if (currentView === 'day') {
        renderDayView();
    }
    
    showSuccess('Calendar color updated!');
}

function applyCalendarColors() {
    // Apply colors using CSS custom properties
    let style = document.getElementById('dynamic-calendar-colors');
    if (!style) {
        style = document.createElement('style');
        style.id = 'dynamic-calendar-colors';
        document.head.appendChild(style);
    }
    
    let css = '';
    
    // Generate CSS for each calendar type
    Object.keys(calendarColors).forEach(type => {
        const color = calendarColors[type];
        const rgb = hexToRgb(color);
        
        if (rgb) {
            css += `
                .day-event-item.${type} {
                    border-left-color: ${color} !important;
                    background: linear-gradient(90deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1) 100%) !important;
                }
                .day-event-item.${type}:hover {
                    background: linear-gradient(90deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15) 100%) !important;
                }
                .event-item.${type} {
                    border-left-color: ${color} !important;
                    background: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1) !important;
                }
            `;
        }
    });
    
    style.textContent = css;
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// Make functions globally accessible
window.updateCalendarColor = updateCalendarColor;

// Make connectCalendar globally accessible
window.connectCalendar = async function(type) {
    // Log immediately - this should always show
    console.log('🔵🔵🔵 connectCalendar CALLED with type:', type);
    console.log('🔵 Window object:', {
        connectCalendarExists: typeof window.connectCalendar !== 'undefined',
        firebaseExists: typeof firebase !== 'undefined',
        authExists: typeof firebase !== 'undefined' && !!firebase.auth
    });
    
    // Alert for debugging (remove after fixing)
    // alert('connectCalendar called with type: ' + type);
    
    try {
        // Check if Firebase is available
        if (typeof firebase === 'undefined') {
            console.error('❌ Firebase is not loaded');
            showError('Firebase is not loaded. Please refresh the page.');
            return;
        }
        
        // Check if Firebase app is initialized
        let app = null;
        try {
            app = firebase.app();
        } catch (error) {
            console.error('❌ Firebase app not initialized:', error);
            showError('Firebase is not initialized. Please refresh the page.');
            return;
        }
        
        // Check if auth is available
        if (!firebase.auth) {
            console.error('❌ Firebase auth not available');
            showError('Firebase Auth is not available. Please refresh the page.');
            return;
        }
        
        console.log('✅ Firebase is available and initialized');
        
        // Get auth instance
        let auth = null;
        try {
            auth = firebase.auth();
        } catch (error) {
            console.error('❌ Error getting auth instance:', error);
            showError('Firebase Auth is not available. Please refresh the page.');
            return;
        }
        
        // ALWAYS check auth.currentUser directly first - this is the most reliable
        let user = auth.currentUser;
        
        console.log('connectCalendar: Direct auth.currentUser check:', {
            hasUser: !!user,
            userEmail: user?.email,
            userUid: user?.uid
        });
        
        // If no user from direct check, try other methods
        if (!user) {
            // Check window.currentUser
            user = window.currentUser;
            console.log('connectCalendar: window.currentUser check:', {
                hasUser: !!user,
                userEmail: user?.email
            });
        }
        
        // If still no user, wait a moment and check again (auth might still be initializing)
        if (!user) {
            console.log('connectCalendar: No user found, waiting 1 second and rechecking...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            user = auth.currentUser || window.currentUser;
            console.log('connectCalendar: After wait, user:', {
                hasUser: !!user,
                userEmail: user?.email,
                fromAuth: !!auth.currentUser,
                fromWindow: !!window.currentUser
            });
        }
        
        // Final check - if still no user, show helpful error
        if (!user) {
            console.error('❌ connectCalendar: No user found');
            console.error('Debug info:', {
                authCurrentUser: auth.currentUser,
                windowCurrentUser: window.currentUser,
                authStateReady: window.authStateReady
            });
            
            // Check if user might be logged in on a different page/tab
            showError('Please make sure you are logged in. If you just signed in, please refresh the page. You can check your login status by looking for "User signed in: [your email]" in the console.');
            return;
        }
        
        console.log('✅ connectCalendar: User confirmed:', user.email);
        
        console.log('connectCalendar: ✅ User confirmed, proceeding with connection');
        
        console.log('connectCalendar: User confirmed', {
            email: user.email,
            uid: user.uid,
            providerData: user.providerData?.map(p => p.providerId)
        });
        
        if (type === 'google') {
            // Check if user signed in with Google
            const isGoogleUser = user.providerData && user.providerData.some(p => p.providerId === 'google.com');
            
            if (!isGoogleUser) {
                // Show popup explaining they need to sign in with Google
                showGoogleCalendarPopup();
                return;
            }
            
            showLoading(`Connecting Google Calendar...`);
            
            try {
                console.log('Starting Google Calendar connection...');
                // Start Google OAuth flow
                const response = await apiCall('/calendars/google/connect', {
                    method: 'POST'
                });
                
                console.log('API response received:', response);
            
                if (response && response.data && response.data.authUrl) {
                    console.log('Redirecting to Google OAuth:', response.data.authUrl);
                    // Use redirect instead of popup (more reliable, no popup blocker issues)
                    sessionStorage.setItem('oauth_return_url', window.location.href);
                    window.location.href = response.data.authUrl;
                } else {
                    hideLoading();
                    console.error('Invalid response from API:', response);
                    showError('Failed to get authorization URL. Please try again.');
                }
            } catch (apiError) {
                hideLoading();
                console.error('Error connecting Google Calendar:', apiError);
                
                // Provide more helpful error messages
                let errorMessage = apiError.message || 'Failed to connect Google Calendar.';
                
                if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
                    errorMessage = 'Please make sure you are logged in and try again.';
                } else if (errorMessage.includes('Failed to fetch')) {
                    errorMessage = 'Cannot connect to the server. Make sure Firebase Functions are running.';
                } else if (apiError.error) {
                    errorMessage = apiError.error;
                }
                
                showError(errorMessage);
            }
        } else if (type === 'outlook') {
            showLoading(`Connecting Microsoft Outlook...`);
            
            // Start Outlook OAuth flow
            const response = await apiCall('/calendars/outlook/connect', {
                method: 'POST'
            });
            
            if (response.data.authUrl) {
                // Open OAuth popup
                const popup = window.open(
                    response.data.authUrl,
                    'Microsoft Outlook Auth',
                    'width=600,height=700,scrollbars=yes,resizable=yes'
                );
                
                if (!popup) {
                    hideLoading();
                    showError('Popup blocked. Please allow popups for this site and try again.');
                    return;
                }
                
                // Listen for OAuth callback via postMessage
                const messageListener = (event) => {
                    if (event.data && event.data.type === 'calendar_connected' && event.data.provider === 'outlook') {
                        window.removeEventListener('message', messageListener);
                        clearInterval(checkClosed);
                        hideLoading();
                        popup.close();
                        showSuccess('Microsoft Outlook connected successfully!');
                        loadConnectedCalendars();
                        loadCalendarEvents();
                    }
                };
                window.addEventListener('message', messageListener);
                
                // Also check if popup closed (fallback)
                const checkClosed = setInterval(() => {
                    if (popup.closed) {
                        clearInterval(checkClosed);
                        window.removeEventListener('message', messageListener);
                        hideLoading();
                        // Check if connection was successful
                        setTimeout(async () => {
                            await loadConnectedCalendars();
                            const hasOutlook = connectedCalendars.some(c => c.type === 'outlook');
                            if (hasOutlook) {
                                showSuccess('Microsoft Outlook connected successfully!');
                                await loadCalendarEvents();
                            }
                        }, 1000);
                    }
                }, 1000);
            }
        } else if (type === 'apple') {
            // Apple Calendar uses CalDAV - show modal for credentials
            showAppleCalendarModal();
        }
    } catch (error) {
        hideLoading();
        console.error('Error connecting calendar:', error);
        showError(error.message || 'Failed to connect calendar');
    }
}


// Generate events from onboarding data (AI conversation)
function generateEventsFromOnboarding(startDate, endDate) {
    const onboardingData = localStorage.getItem('zeitline_onboarding_data');
    if (!onboardingData) {
        console.log('ℹ️ No onboarding data found in localStorage');
        return [];
    }
    
    try {
        const parsed = JSON.parse(onboardingData);
        const collectedData = parsed.collectedData || parsed;
        
        // Check for routine data
        const routines = collectedData.routines || {};
        const weekday = routines.weekday || {};
        const weekend = routines.weekend || {};
        
        // Also check for flat data structure
        const wakeTime = weekday.wakeTime || collectedData.wakeTime || collectedData.wakeTimeWeekday;
        const workStart = weekday.workStart || collectedData.workStartTime;
        const workEnd = weekday.workEnd || collectedData.workEndTime;
        const breakfastTime = weekday.meals?.breakfast || collectedData.breakfastTime;
        const lunchTime = weekday.meals?.lunch || collectedData.lunchTime;
        const dinnerTime = weekday.meals?.dinner || collectedData.dinnerTime;
        const bedtime = weekday.bedtime || collectedData.bedtime || collectedData.bedtimeWeekday;
        const exerciseTime = weekday.exercise?.time || collectedData.exerciseTime;
        const exerciseDays = weekday.exercise?.days || collectedData.exerciseDays || ['monday', 'wednesday', 'friday'];
        
        if (!wakeTime && !workStart && !breakfastTime) {
            console.log('ℹ️ No routine times found in onboarding data');
            return [];
        }
        
        console.log('📅 Generating events from onboarding data...');
        console.log('  Wake time:', wakeTime);
        console.log('  Work:', workStart, '-', workEnd);
        console.log('  Meals:', breakfastTime, lunchTime, dinnerTime);
        console.log('  Exercise:', exerciseTime, 'on', exerciseDays);
        
        const events = [];
        const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
        
        // Helper to parse time string
        function parseTime(timeStr) {
            if (!timeStr) return null;
            const formats = [
                /(\d{1,2}):(\d{2})\s*(AM|PM)/i,
                /(\d{1,2}):(\d{2})/,
                /(\d{1,2})\s*(AM|PM)/i,
            ];
            for (const format of formats) {
                const match = timeStr.match(format);
                if (match) {
                    let hours = parseInt(match[1]);
                    const minutes = match[2] && !isNaN(parseInt(match[2])) ? parseInt(match[2]) : 0;
                    const ampm = match[3]?.toUpperCase();
                    if (ampm === 'PM' && hours !== 12) hours += 12;
                    if (ampm === 'AM' && hours === 12) hours = 0;
                    return { hours, minutes };
                }
            }
            return null;
        }
        
        // Generate recurring events for the date range
        function createRecurringEvents(title, timeStr, durationMinutes, daysOfWeek, source = 'onboarding') {
            const parsedTime = parseTime(timeStr);
            if (!parsedTime) return;
            
            const currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                const dayOfWeek = currentDate.getDay();
                if (daysOfWeek.includes(dayOfWeek)) {
                    const eventStart = new Date(currentDate);
                    eventStart.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
                    const eventEnd = new Date(eventStart);
                    eventEnd.setMinutes(eventEnd.getMinutes() + durationMinutes);
                    
                    events.push({
                        id: `onboarding-${title.toLowerCase().replace(/\s+/g, '-')}-${eventStart.toISOString()}`,
                        title: title,
                        start: eventStart.toISOString(),
                        end: eventEnd.toISOString(),
                        calendarType: 'zeitline',
                        calendarName: 'My Routine',
                        source: source,
                        isFromOnboarding: true
                    });
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }
        
        const weekdays = [1, 2, 3, 4, 5]; // Mon-Fri
        const weekends = [0, 6]; // Sun, Sat
        
        // Generate weekday events
        if (wakeTime) createRecurringEvents('🌅 Wake Up', wakeTime, 30, weekdays);
        if (breakfastTime) createRecurringEvents('🍳 Breakfast', breakfastTime, 45, weekdays);
        if (workStart && workEnd) {
            const workStartParsed = parseTime(workStart);
            const workEndParsed = parseTime(workEnd);
            if (workStartParsed && workEndParsed) {
                const durationMinutes = (workEndParsed.hours * 60 + workEndParsed.minutes) - (workStartParsed.hours * 60 + workStartParsed.minutes);
                if (durationMinutes > 0) {
                    createRecurringEvents('💼 Work', workStart, durationMinutes, weekdays);
                }
            }
        }
        if (lunchTime) createRecurringEvents('🥗 Lunch', lunchTime, 60, weekdays);
        if (dinnerTime) createRecurringEvents('🍽️ Dinner', dinnerTime, 60, weekdays);
        if (exerciseTime && exerciseDays.length > 0) {
            const exerciseDayNumbers = exerciseDays.map(d => dayMap[d.toLowerCase()]).filter(d => d !== undefined);
            createRecurringEvents('🏋️ Exercise', exerciseTime, 60, exerciseDayNumbers);
        }
        if (bedtime) createRecurringEvents('😴 Bedtime', bedtime, 30, weekdays);
        
        // Generate weekend events (if different from weekday)
        const weekendWake = weekend.wakeTime || collectedData.wakeTimeWeekend;
        const weekendBedtime = weekend.bedtime || collectedData.bedtimeWeekend;
        if (weekendWake) createRecurringEvents('🌅 Weekend Wake Up', weekendWake, 30, weekends);
        if (weekendBedtime) createRecurringEvents('😴 Weekend Bedtime', weekendBedtime, 30, weekends);
        
        console.log(`✅ Generated ${events.length} events from onboarding data`);
        return events;
    } catch (error) {
        console.warn('⚠️ Error parsing onboarding data:', error);
        return [];
    }
}

async function loadCalendarEvents() {
    try {
        let startDate, endDate;
        
        if (currentView === 'day' && selectedDate) {
            // Load single day - use 'T00:00:00' to parse as local time, not UTC
            startDate = new Date(selectedDate + 'T00:00:00');
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(selectedDate + 'T00:00:00');
            endDate.setHours(23, 59, 59, 999);
        } else if (currentView === 'week') {
            // Load week - use 'T00:00:00' to parse as local time, not UTC
            const date = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date();
            const dayOfWeek = date.getDay();
            startDate = new Date(date);
            startDate.setDate(date.getDate() - dayOfWeek);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            endDate.setHours(23, 59, 59, 999);
        } else {
            // Load month
            const year = currentMonth.getFullYear();
            const month = currentMonth.getMonth();
            startDate = new Date(year, month, 1);
            endDate = new Date(year, month + 1, 0);
            endDate.setHours(23, 59, 59, 999);
        }
        
        // Load calendar events from user's connected calendars via API
        console.log(`Loading events from ${startDate.toISOString()} to ${endDate.toISOString()}`);
        
        let events = [];
        
        // First, try to load from API (user's connected calendars like Google, Outlook)
        try {
            const response = await apiCall(`/calendars/events?start=${startDate.toISOString()}&end=${endDate.toISOString()}`);
            
            // Check if response has data
            if (response && response.data) {
                events = Array.isArray(response.data) ? response.data : [];
            } else if (response && response.success && response.data) {
                events = Array.isArray(response.data) ? response.data : [];
            } else {
                console.warn('⚠️ API response format unexpected:', response);
                events = [];
            }
            
            console.log(`✅ Received ${events.length} events from API (connected calendars)`);
            if (events.length > 0) {
                console.log('Sample events:', events.slice(0, 3).map(e => ({
                    title: e.title,
                    start: e.start,
                    calendarType: e.calendarType
                })));
            } else {
                console.log('ℹ️ No events from connected calendars. User may need to connect a calendar.');
            }
        } catch (apiError) {
            console.warn('⚠️ Could not load events from API:', apiError.message || apiError);
            // Continue with onboarding events only
        }
        
        // Add events from onboarding data (AI conversation)
        // These are generated from the user's routines collected during onboarding
        try {
            const onboardingEvents = generateEventsFromOnboarding(startDate, endDate);
            if (onboardingEvents && onboardingEvents.length > 0) {
                console.log(`📅 Adding ${onboardingEvents.length} events from onboarding data`);
                events = [...events, ...onboardingEvents];
            }
        } catch (onboardingError) {
            console.warn('⚠️ Error loading onboarding events:', onboardingError);
        }
        
        calendarEvents = {};
        
        events.forEach(event => {
            try {
                // Handle both date-time and date-only formats
                let dateStr;
                const eventDate = new Date(event.start);
                if (isNaN(eventDate.getTime())) {
                    console.warn('Invalid event date:', event.start, event);
                    return;
                }
                
                // Use local date to avoid timezone issues
                const year = eventDate.getFullYear();
                const month = eventDate.getMonth() + 1;
                const day = eventDate.getDate();
                dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                
                if (!calendarEvents[dateStr]) {
                    calendarEvents[dateStr] = [];
                }
                calendarEvents[dateStr].push(event);
                
                // Log Zeitline events for debugging
                if (event.calendarType === 'zeitline' && event.source === 'onboarding') {
                    console.log('📅 Zeitline onboarding event loaded:', {
                        title: event.title,
                        date: dateStr,
                        start: event.start,
                        recurring: event.recurring ? 'Yes' : 'No'
                    });
                }
            } catch (error) {
                console.error('Error processing event:', error, event);
            }
        });
        
        console.log(`Organized events into ${Object.keys(calendarEvents).length} days`);
        
        // Count Zeitline onboarding events
        const zeitlineEvents = Object.values(calendarEvents).flat().filter(e => 
            e.calendarType === 'zeitline' && e.source === 'onboarding'
        );
        if (zeitlineEvents.length > 0) {
            console.log(`✅ Found ${zeitlineEvents.length} Zeitline onboarding events:`, 
                zeitlineEvents.map(e => e.title));
        } else {
            console.log('ℹ️ No Zeitline onboarding events found. Check if onboarding data exists and calendar was populated.');
        }
        
        if (Object.keys(calendarEvents).length > 0) {
            console.log('Calendar events by date:', Object.keys(calendarEvents).slice(0, 10).map(date => ({
                date,
                count: calendarEvents[date].length,
                zeitlineCount: calendarEvents[date].filter(e => e.calendarType === 'zeitline' && e.source === 'onboarding').length,
                sample: calendarEvents[date][0]?.title
            })));
        } else {
            console.warn('⚠️ No events found for this date range.');
        }
        
        // DISABLED: Activity data loading from Firestore
        // This was causing permissions errors. Google Calendar events work without this.
        // Activity data is not needed for Google Calendar events to display.
        // If you want to enable this later, uncomment the line below and configure Firestore rules:
        // loadActivityData(startDate, endDate).catch(() => {});
        
        // Render the appropriate view
        if (currentView === 'month') {
            renderCalendar();
        } else if (currentView === 'week') {
            renderWeekView();
        } else if (currentView === 'day') {
            renderDayView();
        }
    } catch (error) {
        console.error('Error loading events:', error);
        calendarEvents = {};
    }
}

async function loadActivityData(startDate, endDate) {
    // DISABLED: This function is currently disabled to prevent Firestore permissions errors
    // Google Calendar events work perfectly without this activity data
    // To re-enable, uncomment the code below and configure Firestore rules
    // This function does nothing now - it's completely disabled
    // Early return prevents any Firestore access
    return Promise.resolve();
    
    /* DISABLED CODE - Uncomment to enable
    // This function loads additional activity data (HLO predictions, Firestore sessions)
    // It's non-critical - calendar events from Google Calendar will still work if this fails
    try {
        // Load from HLO client if available
        if (typeof hloClient !== 'undefined') {
            const startStr = hloClient.formatDate(startDate);
            const endStr = hloClient.formatDate(endDate);
            
            try {
                const predictions = await hloClient.getDateRange(startStr, endStr);
                
                // Convert predictions to calendar events
                Object.keys(predictions).forEach(dateStr => {
                    const dayData = predictions[dateStr];
                    if (!calendarEvents[dateStr]) {
                        calendarEvents[dateStr] = [];
                    }
                    
                    // Add predicted activities as events
                    if (dayData.activities && Array.isArray(dayData.activities)) {
                        dayData.activities.forEach(activity => {
                            if (activity.start_time && activity.end_time) {
                                calendarEvents[dateStr].push({
                                    id: `hlo_${dateStr}_${activity.id || Date.now()}`,
                                    title: activity.name || activity.title || 'Activity',
                                    description: activity.description || '',
                                    start: `${dateStr}T${activity.start_time}`,
                                    end: `${dateStr}T${activity.end_time}`,
                                    calendarType: 'zeitline',
                                    calendarName: 'Zeitline AI',
                                    source: 'hlo'
                                });
                            }
                        });
                    }
                });
            } catch (hloError) {
                // HLO client not available - this is fine
            }
        }
        
        // DISABLED: Firestore activity data loading
        // This was causing permissions errors and is not needed for Google Calendar events
        // If you want to enable this later, make sure Firestore rules allow reading from users/{uid}/sessions
        // Uncomment the code below and configure Firestore rules if needed
        /*
        if (typeof firebase !== 'undefined' && firebase.auth) {
            const auth = firebase.auth();
            let user = null;
            try {
                user = auth.currentUser;
            } catch (e) {
                return;
            }
            if (user) {
                try {
                    const uid = user.uid;
                    const db = firebase.firestore();
                    const sessionsRef = db.collection('users').doc(uid).collection('sessions');
                    // ... rest of Firestore code
                } catch (firestoreError) {
                    return;
                }
            }
        }
    } catch (error) {
        // Silently handle all errors - activity data is optional
        // Calendar events from Google Calendar don't depend on this
    }
    */
    // End of disabled code - function returns early above
}

function renderTimeColumn() {
    const timeColumn = document.getElementById('calendarTimeColumn');
    if (!timeColumn) return;
    
    // Add extra space at the top to align with weekday headers
    let html = '<div class="time-column-spacer"></div>';
    
    // Start with 12 AM (midnight) at the top
    html += `<div class="time-label hour-line midnight">12 AM</div>`;
    html += `<div class="time-label half-hour"></div>`;
    
    // Generate hours from 1 AM to 11 PM with half-hour markers
    for (let hour = 1; hour < 24; hour++) {
        const hourTime = new Date();
        hourTime.setHours(hour, 0, 0, 0);
        const timeLabel = hourTime.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            hour12: true 
        });
        html += `<div class="time-label hour-line">${timeLabel}</div>`;
        html += `<div class="time-label half-hour"></div>`;
    }
    
    timeColumn.innerHTML = html;
}

function renderWeekdayHeaders(dates) {
    // For month view, weekday headers are static in HTML, so we don't need to render them
    // For week/day view, render the headers with dates
    const weekdays = document.querySelector('#weekDayViewContainer .calendar-weekdays');
    if (!weekdays) return;
    
    const today = new Date();
    const todayStr = today.toDateString();
    
    let html = '';
    dates.forEach(date => {
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
        const dayNumber = date.getDate();
        const dateStr = date.toISOString().split('T')[0];
        const isToday = date.toDateString() === todayStr;
        const isSelected = selectedDate && dateStr === selectedDate;
        
        let classes = 'weekday';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';
        
        html += `
            <div class="${classes}" onclick="selectDate('${dateStr}')">
                <div class="weekday-name">${dayName}</div>
                <div class="weekday-date">${dayNumber}</div>
            </div>
        `;
    });
    
    weekdays.innerHTML = html;
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const title = document.getElementById('calendarTitle');
    const monthViewContainer = document.getElementById('monthViewContainer');
    const weekDayViewContainer = document.getElementById('weekDayViewContainer');
    const timeColumn = document.getElementById('calendarTimeColumn');
    
    // Show month view, hide week/day view
    if (monthViewContainer) {
        monthViewContainer.style.display = 'block';
    }
    if (weekDayViewContainer) {
        weekDayViewContainer.style.display = 'none';
    }
    
    if (!grid) {
        console.error('Calendar grid element not found');
        return;
    }
    
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    // Update title
    if (title) {
        title.textContent = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    
    // Get previous month's last days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    
    // Start building the calendar grid
    let html = '';
    
    // Previous month's days
    for (let i = 0; i < firstDay; i++) {
        const day = prevMonthLastDay - i;
        const date = new Date(year, month - 1, day);
        const prevYear = date.getFullYear();
        const prevMonth = date.getMonth() + 1;
        const dateStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        html += createDayCell(date, dateStr, true);
    }
    
    // Current month's days
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        // Use local date string to avoid timezone issues
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        html += createDayCell(date, dateStr, false);
    }
    
    // Next month's days to fill the grid
    const totalCells = 42; // 6 weeks * 7 days
    const cellsUsed = firstDay + daysInMonth;
    const remainingCells = totalCells - cellsUsed;
    
    for (let day = 1; day <= remainingCells; day++) {
        const date = new Date(year, month + 1, day);
        const nextYear = date.getFullYear();
        const nextMonth = date.getMonth() + 1;
        const dateStr = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        html += createDayCell(date, dateStr, true);
    }
    
    grid.innerHTML = html;
}

function createDayCell(date, dateStr, isOtherMonth) {
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const isSelected = selectedDate && dateStr === selectedDate;
    const isPast = date < today && !isToday;
    
    let classes = ['calendar-day'];
    if (isOtherMonth) classes.push('other-month');
    if (isToday) classes.push('today');
    if (isSelected) classes.push('selected');
    if (isPast) classes.push('past');
    
    const events = calendarEvents[dateStr] || [];
    const dayNumber = date.getDate();
    
    // Debug logging for first few days with events
    if (events.length > 0 && Math.random() < 0.1) {
        console.log(`Day ${dateStr} has ${events.length} events:`, events.map(e => e.title));
        console.log('Calendar events keys:', Object.keys(calendarEvents).slice(0, 10));
    }
    
    // Sort events by start time
    const sortedEvents = [...events].sort((a, b) => {
        const timeA = new Date(a.start).getTime();
        const timeB = new Date(b.start).getTime();
        return timeA - timeB;
    });
    
    // Show up to 3 events in month view (like Google Calendar)
    const visibleEvents = sortedEvents.slice(0, 3);
    const moreEventsCount = sortedEvents.length - 3;
    
    // Build event list HTML - Google Calendar style
    let eventsHTML = '';
    if (visibleEvents.length > 0) {
        eventsHTML = '<div class="day-events">';
        visibleEvents.forEach((event, index) => {
            const eventStart = new Date(event.start);
            const hasTime = event.start.includes('T') && !event.start.includes('00:00:00');
            const timeStr = hasTime ? eventStart.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            }) : '';
            
            const calendarType = event.calendarType || 'zeitline';
            const eventClass = `event-item ${calendarType}`;
            const displayTitle = event.title.length > 25 ? event.title.substring(0, 25) + '...' : event.title;
            
            eventsHTML += `
                <div class="${eventClass}" 
                     onclick="event.stopPropagation(); selectDate('${dateStr}'); setTimeout(() => openEventModal('${event.id}', event), 100);"
                     title="${event.title}${timeStr ? ' - ' + timeStr : ''}">
                    ${displayTitle}${timeStr ? ` <span style="color: var(--text-muted); font-size: 0.7rem;">${timeStr}</span>` : ''}
                </div>
            `;
        });
        
        if (moreEventsCount > 0) {
            eventsHTML += `
                <div class="event-item" style="color: var(--text-secondary); font-style: italic;" onclick="event.stopPropagation(); selectDate('${dateStr}');">
                    +${moreEventsCount} more
                </div>
            `;
        }
        
        eventsHTML += '</div>';
    }
    
    // Ensure events are visible - add debug info
    if (events.length > 0 && !eventsHTML) {
        console.warn(`Events found for ${dateStr} but HTML not generated:`, events);
    }
    
    return `
        <div class="${classes.join(' ')}" onclick="selectDate('${dateStr}')" ${isOtherMonth ? 'style="opacity: 0.3; pointer-events: none;"' : ''}>
            <div class="day-number">${dayNumber}</div>
            ${eventsHTML}
        </div>
    `;
}

function selectDate(dateStr) {
    selectedDate = dateStr;
    
    // If in month view, switch to day view for a detailed look at that day
    if (currentView === 'month') {
        currentView = 'day';
        
        // Update view toggle buttons to show Day as active
        document.querySelectorAll('.view-toggle button').forEach(btn => {
            btn.classList.remove('active');
        });
        const dayBtn = document.querySelector('.view-toggle button[onclick*="day"]');
        if (dayBtn) dayBtn.classList.add('active');
        
        // Reload events for the day view date range and render
        loadCalendarEvents();
    } else if (currentView === 'day') {
        renderDayView();
    } else if (currentView === 'week') {
        renderWeekView();
    } else {
        renderCalendar();
    }
}

function renderWeekView() {
    const grid = document.getElementById('calendarGridWeekDay');
    const monthViewContainer = document.getElementById('monthViewContainer');
    const weekDayViewContainer = document.getElementById('weekDayViewContainer');
    const weekdays = weekDayViewContainer?.querySelector('.calendar-weekdays');
    const timeColumn = document.getElementById('calendarTimeColumn');
    
    // Hide month view, show week/day view
    if (monthViewContainer) {
        monthViewContainer.style.display = 'none';
    }
    if (weekDayViewContainer) {
        weekDayViewContainer.style.display = 'block';
    }
    
    // Show weekday headers in week view
    if (weekdays) {
        weekdays.classList.remove('hidden');
    }
    
    // Show time column in week view
    if (timeColumn) {
        timeColumn.classList.remove('hidden');
        renderTimeColumn();
    }
    
    if (!grid) {
        console.error('Calendar grid element not found');
        return;
    }
    
    // Update container classes
    const container = document.querySelector('.calendar-grid-container');
    if (container) {
        container.classList.remove('day-view-active');
        container.classList.add('week-view-active');
    }
    
    // Calculate week start (Sunday)
    const date = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date();
    const dayOfWeek = date.getDay();
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    // Build weekday headers with dates
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        const currentDate = new Date(weekStart);
        currentDate.setDate(weekStart.getDate() + i);
        weekDates.push(currentDate);
    }
    renderWeekdayHeaders(weekDates);
    
    // Build calendar grid with 7 days (Sunday to Saturday) with time slots
    let html = '';
    
    for (let i = 0; i < 7; i++) {
        const currentDate = new Date(weekStart);
        currentDate.setDate(weekStart.getDate() + i);
        // Use local date format to match event storage
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
        const day = currentDate.getDate();
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = currentDate.toDateString() === new Date().toDateString();
        const isSelected = selectedDate && dateStr === selectedDate;
        
        let classes = 'calendar-day';
        if (isToday) classes += ' today';
        if (isSelected) classes += ' selected';
        
        // Get events for this day
        const dayEvents = calendarEvents[dateStr] || [];
        
        // Debug logging (only log once per render to avoid spam)
        if (dayEvents.length > 0 && i === 0) {
            console.log(`Week view - Checking events for ${dateStr}:`, dayEvents.length, 'events found');
            console.log('All calendar events keys:', Object.keys(calendarEvents));
        }
        
        html += `<div class="${classes}" data-date="${dateStr}" 
                     ondragover="handleDayDragOver(event)" 
                     ondrop="handleDayDrop(event)"
                     ondragleave="handleDayDragLeave(event)">`;
        html += `<div class="week-view-day-events" 
                     onclick="handleTimeSlotClick(event, '${dateStr}')"
                     data-date="${dateStr}">`;
        
        // Separate all-day events from timed events
        const allDayEvents = dayEvents.filter(e => !e.start.includes('T'));
        const timedEvents = dayEvents.filter(e => e.start.includes('T'));
        
        // Render all-day events at the top
        if (allDayEvents.length > 0) {
            html += `<div class="all-day-events-section">`;
            allDayEvents.forEach(event => {
                const calendarType = event.calendarType || 'zeitline';
                html += `
                    <div class="all-day-event ${calendarType}" 
                         onclick="openEventModal('${event.id}', event)"
                         title="${event.title}">
                        ${event.title}
                    </div>
                `;
            });
            html += `</div>`;
        }
        
        // Render timed events positioned by time
        timedEvents.forEach(event => {
            // Parse event times - handle date-time formats
            let eventStart, eventEnd;
            
            // Date-time format - convert to selected timezone
            eventStart = convertEventTimeToTimezone(event.start, selectedTimezone);
            eventEnd = convertEventTimeToTimezone(event.end, selectedTimezone);
            
            // Validate the date was parsed correctly
            if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) {
                console.error(`Invalid date for event "${event.title}":`, event.start, event.end);
                return; // Skip invalid events
            }
            
            // Get time components in selected timezone (already converted above)
            const startHours = eventStart.getHours();
            const startMins = eventStart.getMinutes();
            const endHours = eventEnd.getHours();
            const endMins = eventEnd.getMinutes();
            
            // Calculate position (minutes from midnight in local time)
            const startMinutes = startHours * 60 + startMins;
            const endMinutes = endHours * 60 + endMins;
            let duration = endMinutes - startMinutes;
            
            // Handle events that span midnight or have invalid duration
            if (duration < 0) {
                // Event might span midnight, use minimum duration
                duration = 30; // Default to 30 minutes
            }
            
            // Calculate position in pixels for exact alignment with time column
            // Google Calendar structure: each hour = 60px (fixed)
            // Half-hour markers are visual only and don't affect positioning
            // Events container is 1440px tall (24 hours * 60px)
            // Calculation: 1 hour = 60px, so 1 minute = 1px
            const topPixels = startMinutes; // 1 minute = 1 pixel (60px per hour / 60 minutes)
            const heightPixels = Math.max(duration, 20); // Minimum 20px height for visibility
            
            // Convert to percentage for CSS (container is 1440px)
            const topPercent = (topPixels / 1440) * 100;
            const heightPercent = (heightPixels / 1440) * 100;
            
            // Position logging is now in the debug block above
            
            const calendarType = event.calendarType || (event.calendarSources && event.calendarSources.length > 1 ? 'multiple' : 'zeitline');
            const calendarName = event.calendarSources && event.calendarSources.length > 1 
                ? `${event.calendarSources.length} calendars` 
                : (event.calendarName || 'Zeitline');
            
            // Format times for display (use local time)
            const startTime = eventStart.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
            const endTime = eventEnd.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
            
            // Debug: Log positioning for first event to verify alignment
            if (dayEvents.indexOf(event) === 0) {
                console.log(`Event "${event.title}" positioning:`, {
                    startTime: `${startHours}:${String(startMins).padStart(2, '0')}`,
                    endTime: `${endHours}:${String(endMins).padStart(2, '0')}`,
                    startMinutes,
                    topPixels,
                    topPercent: `${topPercent.toFixed(2)}%`,
                    heightPixels,
                    heightPercent: `${heightPercent.toFixed(2)}%`
                });
            }
            
            html += `
                <div class="day-event-item week-event ${calendarType}" 
                     draggable="true"
                     data-event-id="${event.id}"
                     data-event-start="${event.start}"
                     data-event-end="${event.end}"
                     data-event-duration="${duration}"
                     data-event-date="${dateStr}"
                     style="top: ${topPercent}%; height: ${heightPercent}%;"
                     onclick="openEventModal('${event.id}', event)"
                     ondragstart="handleEventDragStart(event)"
                     ondragend="handleEventDragEnd(event)"
                     title="${event.title} (${calendarName})">
                    <div class="event-title">${event.title}</div>
                    <div class="event-time">${startTime} - ${endTime}</div>
                </div>
            `;
        });
        
        html += '</div>';
        html += '</div>';
    }
    
    grid.innerHTML = html;
    
    // Add current time indicator for today
    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();
    const todayStr = `${todayYear}-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;
    const todayIndex = weekDates.findIndex(d => {
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return dateStr === todayStr;
    });
    if (todayIndex >= 0) {
        const now = new Date();
        // Get hours and minutes in the selected timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: selectedTimezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(now);
        const hourPart = parts.find(p => p.type === 'hour');
        const minutePart = parts.find(p => p.type === 'minute');
        const currentHours = parseInt(hourPart?.value || '0', 10);
        const currentMins = parseInt(minutePart?.value || '0', 10);
        const currentMinutes = currentHours * 60 + currentMins;
        const topPercent = (currentMinutes / 1440) * 100;
        const dayCell = grid.children[todayIndex];
        if (dayCell) {
            const timeIndicator = document.createElement('div');
            timeIndicator.className = 'week-view-current-time';
            timeIndicator.style.top = `${topPercent}%`;
            dayCell.querySelector('.week-view-day-events').appendChild(timeIndicator);
        }
    }
}

function renderDayView() {
    const grid = document.getElementById('calendarGridWeekDay');
    const monthViewContainer = document.getElementById('monthViewContainer');
    const weekDayViewContainer = document.getElementById('weekDayViewContainer');
    const weekdays = weekDayViewContainer?.querySelector('.calendar-weekdays');
    const timeColumn = document.getElementById('calendarTimeColumn');
    
    // Hide month view, show week/day view
    if (monthViewContainer) {
        monthViewContainer.style.display = 'none';
    }
    if (weekDayViewContainer) {
        weekDayViewContainer.style.display = 'block';
    }
    
    // Show weekday headers in day view
    if (weekdays) {
        weekdays.classList.remove('hidden');
    }
    
    // Show time column in day view
    if (timeColumn) {
        timeColumn.classList.remove('hidden');
        renderTimeColumn();
    }
    
    if (!grid) {
        console.error('Calendar grid element not found');
        return;
    }
    
    // Update container classes
    const container = document.querySelector('.calendar-grid-container');
    if (container) {
        container.classList.add('day-view-active');
        container.classList.remove('week-view-active');
    }
    
    // Get the selected date or use today
    const date = selectedDate ? new Date(selectedDate + 'T00:00:00') : new Date();
    
    // Build weekday headers - show the week containing this day
    const dayOfWeek = date.getDay();
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        const currentDate = new Date(weekStart);
        currentDate.setDate(weekStart.getDate() + i);
        weekDates.push(currentDate);
    }
    renderWeekdayHeaders(weekDates);
    
    // Build calendar grid with just one day
    // Use local date format to match event storage
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = date.toDateString() === new Date().toDateString();
    const isSelected = selectedDate && dateStr === selectedDate;
    
    let classes = 'calendar-day';
    if (isToday) classes += ' today';
    if (isSelected) classes += ' selected';
    
    // Get events for this day
    const dayEvents = calendarEvents[dateStr] || [];
    
    // Debug logging
    if (dayEvents.length > 0) {
        console.log(`Day view - ${dateStr} has ${dayEvents.length} events:`, dayEvents.map(e => e.title));
    }
    
    let html = '';
    
    // Add 6 empty cells before the day to align with week view
    for (let i = 0; i < dayOfWeek; i++) {
        html += '<div class="calendar-day empty"></div>';
    }
    
    // Add the single day cell with time-based events
    html += `<div class="${classes}" data-date="${dateStr}">`;
    html += `<div class="week-view-day-events" 
                 onclick="handleTimeSlotClick(event, '${dateStr}')"
                 data-date="${dateStr}">`;
    
    // Separate all-day events from timed events
    const allDayEvents = dayEvents.filter(e => !e.start.includes('T'));
    const timedEvents = dayEvents.filter(e => e.start.includes('T'));
    
    // Render all-day events at the top
    if (allDayEvents.length > 0) {
        html += `<div class="all-day-events-section">`;
        allDayEvents.forEach(event => {
            const calendarType = event.calendarType || 'zeitline';
            html += `
                <div class="all-day-event ${calendarType}" 
                     onclick="openEventModal('${event.id}', event)"
                     title="${event.title}">
                    ${event.title}
                </div>
            `;
        });
        html += `</div>`;
    }
    
    // Render timed events positioned by time
    timedEvents.forEach(event => {
        // Parse event times - handle date-time formats
        let eventStart, eventEnd;
        
        // Date-time format - convert to selected timezone
        eventStart = convertEventTimeToTimezone(event.start, selectedTimezone);
        eventEnd = convertEventTimeToTimezone(event.end, selectedTimezone);
        
        // Validate the date was parsed correctly
        if (isNaN(eventStart.getTime()) || isNaN(eventEnd.getTime())) {
            console.error(`Invalid date for event "${event.title}":`, event.start, event.end);
            return; // Skip invalid events
        }
        
        // Get time components in selected timezone (already converted above)
        const startHours = eventStart.getHours();
        const startMins = eventStart.getMinutes();
        const endHours = eventEnd.getHours();
        const endMins = eventEnd.getMinutes();
        
        // Calculate position (minutes from midnight in local time)
        const startMinutes = startHours * 60 + startMins;
        const endMinutes = endHours * 60 + endMins;
        let duration = endMinutes - startMinutes;
        
        // Handle events that span midnight or have invalid duration
        if (duration < 0) {
            // Event might span midnight, use minimum duration
            duration = 30; // Default to 30 minutes
        }
        
        // Calculate position in pixels for exact alignment with time column
        // Google Calendar structure: each hour = 60px (fixed)
        // Half-hour markers are visual only and don't affect positioning
        // Events container is 1440px tall (24 hours * 60px)
        // Calculation: 1 hour = 60px, so 1 minute = 1px
        const topPixels = startMinutes; // 1 minute = 1 pixel (60px per hour / 60 minutes)
        const heightPixels = Math.max(duration, 20); // Minimum 20px height for visibility
        
        // Convert to percentage for CSS (container is 1440px)
        const topPercent = (topPixels / 1440) * 100;
        const heightPercent = (heightPixels / 1440) * 100;
        
        // Debug: Log event time and calculated position (only for first few events)
        if (dayEvents.indexOf(event) < 5) {
            const localTimeString = eventStart.toLocaleString('en-US', {
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            console.log(`Event "${event.title.substring(0, 30)}":`, {
                originalISO: event.start,
                parsedLocal: eventStart.toString(),
                localTime: localTimeString,
                hours: startHours,
                minutes: startMins,
                calculatedPosition: `${topPixels}px (${topPercent.toFixed(1)}%)`,
                timezoneOffset: eventStart.getTimezoneOffset(),
                browserTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            });
        }
        
        const calendarType = event.calendarType || (event.calendarSources && event.calendarSources.length > 1 ? 'multiple' : 'zeitline');
        const calendarName = event.calendarSources && event.calendarSources.length > 1 
            ? `${event.calendarSources.length} calendars` 
            : (event.calendarName || 'Zeitline');
        
        const startTime = eventStart.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        const endTime = eventEnd.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        
        html += `
            <div class="day-event-item ${calendarType}" 
                 draggable="true"
                 data-event-id="${event.id}"
                 data-event-start="${event.start}"
                 data-event-end="${event.end}"
                 data-event-duration="${duration}"
                 data-event-date="${dateStr}"
                 style="top: ${topPercent}%; height: ${heightPercent}%;"
                 onclick="openEventModal('${event.id}', event)"
                 ondragstart="handleEventDragStart(event)"
                 ondragend="handleEventDragEnd(event)"
                 title="${event.title} (${calendarName}) - ${startTime} to ${endTime}">
                <div class="event-title">${event.title}</div>
                <div class="event-time">${startTime} - ${endTime}</div>
                ${event.location ? `<div class="event-location">${event.location}</div>` : ''}
            </div>
        `;
    });
    
    html += '</div>';
    html += '</div>';
    
    // Add empty cells after the day to fill the week
    for (let i = dayOfWeek + 1; i < 7; i++) {
        html += '<div class="calendar-day empty"></div>';
    }
    
    if (grid) {
        grid.innerHTML = html;
    }
    
    // Add current time indicator for today
    if (isToday) {
        const now = new Date();
        // Get hours and minutes in the selected timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: selectedTimezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: false
        });
        const parts = formatter.formatToParts(now);
        const hourPart = parts.find(p => p.type === 'hour');
        const minutePart = parts.find(p => p.type === 'minute');
        const currentHours = parseInt(hourPart?.value || '0', 10);
        const currentMins = parseInt(minutePart?.value || '0', 10);
        const currentMinutes = currentHours * 60 + currentMins;
        const topPercent = (currentMinutes / 1440) * 100;
        const dayCell = grid.children[dayOfWeek];
        if (dayCell) {
            const eventsContainer = dayCell.querySelector('.week-view-day-events');
            if (eventsContainer) {
                const timeIndicator = document.createElement('div');
                timeIndicator.className = 'week-view-current-time';
                timeIndicator.style.top = `${topPercent}%`;
                eventsContainer.appendChild(timeIndicator);
            }
        }
    }
}

function prevMonth() {
    if (currentView === 'day') {
        const date = selectedDate ? new Date(selectedDate) : new Date();
        date.setDate(date.getDate() - 1);
        selectedDate = date.toISOString().split('T')[0];
        loadCalendarEvents();
    } else if (currentView === 'week') {
        const date = selectedDate ? new Date(selectedDate) : new Date();
        date.setDate(date.getDate() - 7);
        selectedDate = date.toISOString().split('T')[0];
        loadCalendarEvents();
    } else {
        currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1);
        renderCalendar();
        loadCalendarEvents();
    }
}

function nextMonth() {
    if (currentView === 'day') {
        const date = selectedDate ? new Date(selectedDate) : new Date();
        date.setDate(date.getDate() + 1);
        selectedDate = date.toISOString().split('T')[0];
        loadCalendarEvents();
    } else if (currentView === 'week') {
        const date = selectedDate ? new Date(selectedDate) : new Date();
        date.setDate(date.getDate() + 7);
        selectedDate = date.toISOString().split('T')[0];
        loadCalendarEvents();
    } else {
        currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1);
        renderCalendar();
        loadCalendarEvents();
    }
}

function today() {
    const today = new Date();
    currentMonth = new Date(today.getFullYear(), today.getMonth());
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    selectedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    loadCalendarEvents();
}

window.setView = function setView(view, event) {
    currentView = view;
    document.querySelectorAll('.view-toggle button').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // Find button by data-view attribute
        const button = document.querySelector(`.view-toggle button[data-view="${view}"]`);
        if (button) button.classList.add('active');
    }
    
    // Hide zoom controls if not in day view
    const zoomControls = document.getElementById('calendarZoomControls');
    if (zoomControls) {
        if (view === 'day') {
            zoomControls.classList.add('visible');
        } else {
            zoomControls.classList.remove('visible');
        }
    }
    
    // Reset zoom when switching views
    if (view !== 'day') {
        zoomLevel = 0;
    }
    
    // Render the appropriate view
    if (view === 'month') {
        renderCalendar();
        loadCalendarEvents();
    } else if (view === 'week') {
        renderWeekView();
        loadCalendarEvents();
    } else if (view === 'day') {
        renderDayView();
        loadCalendarEvents();
    }
}

function zoomIn() {
    if (zoomLevel < 2) {
        zoomLevel++;
        renderDayView();
    }
}

function zoomOut() {
    if (zoomLevel > 0) {
        zoomLevel--;
        renderDayView();
    }
}

let currentEventData = null;

async function openEventModal(eventId, e) {
    if (e) e.stopPropagation();
    
    try {
        // First, try to find the event in already-loaded calendarEvents
        let event = null;
        
        // Search through all dates in calendarEvents
        for (const dateStr in calendarEvents) {
            const eventsForDate = calendarEvents[dateStr];
            const foundEvent = eventsForDate.find(ev => ev.id === eventId);
            if (foundEvent) {
                event = foundEvent;
                console.log(`Found event ${eventId} in loaded calendarEvents for date ${dateStr}`);
                break;
            }
        }
        
        // If not found in loaded events, try API call as fallback
        if (!event) {
            console.log(`Event ${eventId} not found in loaded events, trying API...`);
            try {
                const response = await apiCall(`/calendars/events/${eventId}`);
                event = response.data;
            } catch (apiError) {
                console.warn('API call failed, event not available:', apiError);
            }
        }
        
        if (!event) {
            showError('Event not found');
            return;
        }
        
        currentEventData = event;
        
        // Update header
        document.getElementById('eventTitle').textContent = event.title || 'Untitled Event';
        document.getElementById('eventTimeText').textContent = formatEventTime(event);
        
        // Update calendar badge
        const calendarBadge = document.getElementById('eventCalendarBadge');
        const calendarType = event.calendarType || 'zeitline';
        const calendarName = event.calendarName || 'Zeitline';
        calendarBadge.innerHTML = `
            <div class="event-detail-calendar-badge ${calendarType}">
                <span>${calendarName}</span>
            </div>
        `;
        
        // Update time display section
        const timeDisplayEl = document.getElementById('eventTimeDisplay');
        if (timeDisplayEl) {
            timeDisplayEl.textContent = formatEventTime(event);
        }
        
        // Update description
        const descriptionSection = document.getElementById('eventDescriptionSection');
        const descriptionEl = document.getElementById('eventDescription');
        if (event.description && event.description.trim()) {
            descriptionEl.textContent = event.description;
            descriptionSection.style.display = 'block';
        } else {
            descriptionEl.textContent = 'No description';
            descriptionSection.style.display = 'block';
        }
        
        // Update location
        const locationSection = document.getElementById('eventLocationSection');
        const locationEl = document.getElementById('eventLocation');
        if (event.location && event.location.trim()) {
            locationEl.textContent = event.location;
            locationSection.style.display = 'block';
        } else {
            locationSection.style.display = 'none';
        }
        
        // Update duration
        const durationEl = document.getElementById('eventDuration');
        const start = new Date(event.start);
        const end = new Date(event.end);
        const durationMs = end - start;
        const durationMins = Math.round(durationMs / 60000);
        
        if (durationMins < 60) {
            durationEl.textContent = `${durationMins} minute${durationMins !== 1 ? 's' : ''}`;
        } else {
            const hours = Math.floor(durationMins / 60);
            const mins = durationMins % 60;
            if (mins === 0) {
                durationEl.textContent = `${hours} hour${hours !== 1 ? 's' : ''}`;
            } else {
                durationEl.textContent = `${hours} hour${hours !== 1 ? 's' : ''} ${mins} minute${mins !== 1 ? 's' : ''}`;
            }
        }
        
        document.getElementById('eventModal').classList.add('active');
    } catch (error) {
        console.error('Error loading event:', error);
        showError('Failed to load event details');
    }
}

function closeEventModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('eventModal').classList.remove('active');
}

function formatEventTime(event) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    
    const startStr = start.toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    
    const endStr = end.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    
    return `${startStr} - ${endStr}`;
}

function editEvent() {
    if (!currentEventData) {
        showError('No event selected');
        return;
    }
    
    // Check if this is a Zeitline event (editable)
    if (currentEventData.calendarType !== 'zeitline') {
        showError(`Cannot edit events from ${currentEventData.calendarType || 'external'} calendar. Please edit in the original calendar app.`);
        return;
    }
    
    // Open edit modal
    openEditEventModal(currentEventData);
}

function openEditEventModal(event) {
    // Check if edit modal exists, if not create it
    let editModal = document.getElementById('editEventModal');
    if (!editModal) {
        editModal = createEditEventModal();
        document.body.appendChild(editModal);
    }
    
    // Populate the form with current event data
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);
    
    document.getElementById('editEventTitle').value = event.title || '';
    document.getElementById('editEventDate').value = formatDateForInput(startDate);
    document.getElementById('editEventStartTime').value = formatTimeForInput(startDate);
    document.getElementById('editEventEndTime').value = formatTimeForInput(endDate);
    document.getElementById('editEventLocation').value = event.location || '';
    document.getElementById('editEventDescription').value = event.description || '';
    
    // Store the event ID for saving
    editModal.dataset.eventId = event.id;
    
    // Close the detail modal and open edit modal
    document.getElementById('eventModal').classList.remove('active');
    editModal.classList.add('active');
}

function createEditEventModal() {
    const modal = document.createElement('div');
    modal.className = 'event-detail-modal';
    modal.id = 'editEventModal';
    modal.onclick = function(e) { closeEditEventModal(e); };
    
    modal.innerHTML = `
        <div class="event-detail-content" onclick="event.stopPropagation()" style="max-width: 500px;">
            <div class="event-detail-header">
                <button class="event-detail-close" onclick="closeEditEventModal()" aria-label="Close">×</button>
                <h2 class="event-detail-title">✏️ Edit Event</h2>
            </div>
            
            <div class="event-detail-body">
                <form id="editEventForm" onsubmit="saveEditedEvent(event)">
                    <div style="margin-bottom: 1rem;">
                        <label for="editEventTitle" style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">Event Title *</label>
                        <input type="text" id="editEventTitle" required placeholder="Enter event title" 
                            style="width: 100%; padding: 0.75rem 1rem; background: var(--bg-deep); border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-primary); font-size: 0.9375rem; box-sizing: border-box;">
                    </div>
                    
                    <div style="margin-bottom: 1rem;">
                        <label for="editEventDate" style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">Date *</label>
                        <input type="date" id="editEventDate" required 
                            style="width: 100%; padding: 0.75rem 1rem; background: var(--bg-deep); border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-primary); font-size: 0.9375rem; box-sizing: border-box;">
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label for="editEventStartTime" style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">Start Time *</label>
                            <input type="time" id="editEventStartTime" required
                                style="width: 100%; padding: 0.75rem 1rem; background: var(--bg-deep); border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-primary); font-size: 0.9375rem; box-sizing: border-box;">
                        </div>
                        <div>
                            <label for="editEventEndTime" style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">End Time *</label>
                            <input type="time" id="editEventEndTime" required
                                style="width: 100%; padding: 0.75rem 1rem; background: var(--bg-deep); border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-primary); font-size: 0.9375rem; box-sizing: border-box;">
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 1rem;">
                        <label for="editEventLocation" style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">Location</label>
                        <input type="text" id="editEventLocation" placeholder="Add location (optional)" 
                            style="width: 100%; padding: 0.75rem 1rem; background: var(--bg-deep); border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-primary); font-size: 0.9375rem; box-sizing: border-box;">
                    </div>
                    
                    <div style="margin-bottom: 1.5rem;">
                        <label for="editEventDescription" style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">Description</label>
                        <textarea id="editEventDescription" placeholder="Add description (optional)" rows="3"
                            style="width: 100%; padding: 0.75rem 1rem; background: var(--bg-deep); border: 1px solid var(--border-subtle); border-radius: 8px; color: var(--text-primary); font-size: 0.9375rem; box-sizing: border-box; resize: vertical;"></textarea>
                    </div>
                    
                    <div style="display: flex; gap: 0.75rem;">
                        <button type="button" onclick="closeEditEventModal()" class="btn btn-secondary" style="flex: 1; padding: 0.875rem;">
                            Cancel
                        </button>
                        <button type="submit" id="editEventSaveBtn" class="btn btn-primary" style="flex: 1; padding: 0.875rem;">
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    return modal;
}

function closeEditEventModal(e) {
    if (e && e.target !== e.currentTarget) return;
    const modal = document.getElementById('editEventModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function formatDateForInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTimeForInput(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

async function saveEditedEvent(e) {
    e.preventDefault();
    
    const modal = document.getElementById('editEventModal');
    const eventId = modal.dataset.eventId;
    
    if (!eventId) {
        showError('No event to update');
        return;
    }
    
    const saveBtn = document.getElementById('editEventSaveBtn');
    const originalText = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
    
    try {
        const title = document.getElementById('editEventTitle').value.trim();
        const date = document.getElementById('editEventDate').value;
        const startTime = document.getElementById('editEventStartTime').value;
        const endTime = document.getElementById('editEventEndTime').value;
        const location = document.getElementById('editEventLocation').value.trim();
        const description = document.getElementById('editEventDescription').value.trim();
        
        if (!title || !date || !startTime || !endTime) {
            showError('Please fill in all required fields');
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
            return;
        }
        
        // Construct ISO date strings
        const startISO = `${date}T${startTime}:00`;
        const endISO = `${date}T${endTime}:00`;
        
        const updateData = {
            title,
            start: startISO,
            end: endISO,
            location: location || null,
            description: description || ''
        };
        
        console.log('Updating event:', eventId, updateData);
        
        const response = await apiCall(`/calendars/events/${eventId}`, {
            method: 'PUT',
            body: JSON.stringify(updateData)
        });
        
        if (response.success || response.data) {
            showSuccess('Event updated successfully!');
            closeEditEventModal();
            
            // Reload calendar events to show the updated event
            await loadCalendarEvents();
        } else {
            throw new Error(response.error || 'Failed to update event');
        }
    } catch (error) {
        console.error('Error updating event:', error);
        showError(error.message || 'Failed to update event');
    } finally {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
    }
}

async function deleteEvent() {
    if (!currentEventData) {
        showError('No event selected');
        return;
    }
    
    // Check if this is a Zeitline event (deletable)
    if (currentEventData.calendarType !== 'zeitline') {
        showError(`Cannot delete events from ${currentEventData.calendarType || 'external'} calendar. Please delete in the original calendar app.`);
        return;
    }
    
    if (confirm(`Are you sure you want to delete "${currentEventData.title}"?`)) {
        try {
            console.log('Deleting event:', currentEventData.id);
            
            const response = await apiCall(`/calendars/events/${currentEventData.id}`, {
                method: 'DELETE'
            });
            
            if (response.success || response.data) {
                showSuccess('Event deleted successfully!');
                closeEventModal();
                
                // Reload calendar events to reflect the deletion
                await loadCalendarEvents();
            } else {
                throw new Error(response.error || 'Failed to delete event');
            }
        } catch (error) {
            console.error('Error deleting event:', error);
            showError(error.message || 'Failed to delete event');
        }
    }
}

function duplicateEvent() {
    if (!currentEventData) {
        showError('No event selected');
        return;
    }
    
    // TODO: Implement event duplication
    showError('Event duplication coming soon');
    // This would create a copy of the event with a new time (e.g., 1 hour later)
}

// Drag and Drop Event Handlers
let draggedEvent = null;
let draggedEventElement = null;

function handleEventDragStart(e) {
    draggedEvent = {
        id: e.target.dataset.eventId,
        start: e.target.dataset.eventStart,
        end: e.target.dataset.eventEnd,
        duration: parseInt(e.target.dataset.eventDuration) || 30,
        date: e.target.dataset.eventDate
    };
    draggedEventElement = e.target;
    
    // Add visual feedback
    e.target.style.opacity = '0.5';
    e.target.style.cursor = 'grabbing';
    
    // Set drag data
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedEvent.id);
    
    // Add dragging class to all calendar days for drop zone highlighting
    document.querySelectorAll('.calendar-day').forEach(day => {
        day.classList.add('drop-zone');
    });
}

function handleEventDragEnd(e) {
    // Restore visual state
    if (e.target) {
        e.target.style.opacity = '1';
        e.target.style.cursor = 'pointer';
    }
    
    // Remove drop zone highlighting
    document.querySelectorAll('.calendar-day').forEach(day => {
        day.classList.remove('drop-zone', 'drag-over');
    });
    
    draggedEvent = null;
    draggedEventElement = null;
}

function handleDayDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const dayElement = e.currentTarget;
    if (!dayElement.classList.contains('drag-over')) {
        dayElement.classList.add('drag-over');
    }
    
    // Calculate drop position for time-based views
    if (currentView === 'week' || currentView === 'day') {
        const eventsContainer = dayElement.querySelector('.week-view-day-events');
        if (eventsContainer && draggedEvent) {
            const rect = eventsContainer.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const minutes = Math.max(0, Math.min(1439, Math.round(y))); // 0-1439 minutes in a day
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            
            // Show visual indicator
            showDropIndicator(dayElement, minutes);
        }
    }
}

function handleDayDragLeave(e) {
    const dayElement = e.currentTarget;
    dayElement.classList.remove('drag-over');
    removeDropIndicator(dayElement);
}

function handleDayDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const dayElement = e.currentTarget;
    const targetDate = dayElement.dataset.date;
    
    if (!draggedEvent || !targetDate) {
        return;
    }
    
    let newStartTime, newEndTime;
    
    if (currentView === 'week' || currentView === 'day') {
        // Calculate time from drop position
        const eventsContainer = dayElement.querySelector('.week-view-day-events');
        if (eventsContainer) {
            const rect = eventsContainer.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const minutes = Math.max(0, Math.min(1439, Math.round(y)));
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            
            // Create new start time
            const newStart = new Date(targetDate + 'T00:00:00');
            newStart.setHours(hours, mins, 0, 0);
            
            // Calculate end time based on original duration
            const newEnd = new Date(newStart);
            newEnd.setMinutes(newEnd.getMinutes() + draggedEvent.duration);
            
            newStartTime = newStart.toISOString();
            newEndTime = newEnd.toISOString();
        } else {
            // Fallback: keep same time, just change date
            const originalStart = new Date(draggedEvent.start);
            const newStart = new Date(targetDate + 'T00:00:00');
            newStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
            
            const newEnd = new Date(newStart);
            newEnd.setMinutes(newEnd.getMinutes() + draggedEvent.duration);
            
            newStartTime = newStart.toISOString();
            newEndTime = newEnd.toISOString();
        }
    } else {
        // Month view: keep same time, just change date
        const originalStart = new Date(draggedEvent.start);
        const newStart = new Date(targetDate + 'T00:00:00');
        newStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
        
        const newEnd = new Date(newStart);
        newEnd.setMinutes(newEnd.getMinutes() + draggedEvent.duration);
        
        newStartTime = newStart.toISOString();
        newEndTime = newEnd.toISOString();
    }
    
    // Update event in calendarEvents
    updateEventTime(draggedEvent.id, newStartTime, newEndTime, targetDate);
    
    // Remove visual feedback
    dayElement.classList.remove('drag-over');
    removeDropIndicator(dayElement);
    
    // Re-render the calendar
    if (currentView === 'month') {
        renderCalendar();
    } else if (currentView === 'week') {
        renderWeekView();
    } else if (currentView === 'day') {
        renderDayView();
    }
    
    showSuccess('Event moved successfully!');
}

function updateEventTime(eventId, newStart, newEnd, newDate) {
    // Find and update the event in calendarEvents
    for (const dateStr in calendarEvents) {
        const events = calendarEvents[dateStr];
        const eventIndex = events.findIndex(e => e.id === eventId);
        
        if (eventIndex !== -1) {
            const event = events[eventIndex];
            
            // Remove from old date
            events.splice(eventIndex, 1);
            
            // Update event times
            event.start = newStart;
            event.end = newEnd;
            
            // Add to new date
            if (!calendarEvents[newDate]) {
                calendarEvents[newDate] = [];
            }
            calendarEvents[newDate].push(event);
            
            // TODO: Call backend API to save the change
            // For now, just update locally
            console.log('Event moved:', {
                eventId,
                oldDate: dateStr,
                newDate,
                newStart,
                newEnd
            });
            
            break;
        }
    }
}

function showDropIndicator(dayElement, minutes) {
    removeDropIndicator(dayElement);
    
    const eventsContainer = dayElement.querySelector('.week-view-day-events');
    if (!eventsContainer) return;
    
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
    indicator.style.cssText = `
        position: absolute;
        left: 0;
        right: 0;
        top: ${minutes}px;
        height: 2px;
        background: var(--accent-primary);
        z-index: 100;
        pointer-events: none;
        box-shadow: 0 0 8px var(--accent-primary);
    `;
    
    eventsContainer.style.position = 'relative';
    eventsContainer.appendChild(indicator);
}

function removeDropIndicator(dayElement) {
    const indicator = dayElement.querySelector('.drop-indicator');
    if (indicator) {
        indicator.remove();
    }
}

// Make functions globally accessible
window.handleEventDragStart = handleEventDragStart;
window.handleEventDragEnd = handleEventDragEnd;
window.handleDayDragOver = handleDayDragOver;
window.handleDayDragLeave = handleDayDragLeave;
window.handleDayDrop = handleDayDrop;

function showGoogleCalendarPopup() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(5, 5, 8, 0.9); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; z-index: 1000;';
    modal.innerHTML = `
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 24px; padding: 2rem; max-width: 500px; width: 90%; position: relative;">
            <button onclick="this.closest('.modal-overlay').remove()" style="position: absolute; top: 1rem; right: 1rem; width: 36px; height: 36px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-secondary); border-radius: 50%; cursor: pointer; font-size: 1.25rem;">×</button>
            <h2 style="font-family: \'Instrument Serif\', Georgia, serif; font-size: 1.5rem; margin-bottom: 1rem;">Connect Google Calendar</h2>
            <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">To connect your Google Calendar, you'll need to sign in with your Google account and grant calendar access.</p>
            <div style="display: flex; gap: 0.75rem;">
                <button onclick="this.closest('.modal-overlay').remove(); connectGoogleCalendar()" class="btn btn-primary" style="flex: 1;">Continue with Google</button>
                <button onclick="this.closest('.modal-overlay').remove()" class="btn btn-secondary">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
}

async function connectGoogleCalendar() {
    try {
        // Check if Firebase is available
        if (typeof firebase === 'undefined' || !firebase.auth) {
            showError('Firebase is not initialized. Please refresh the page.');
            return;
        }
        
        // Check if user is logged in
        const auth = firebase.auth();
        
        let user = null;
        try {
            user = auth.currentUser;
        } catch (e) {
            showError('Firebase Auth is not ready. Please refresh the page.');
            return;
        }
        
        if (!user) {
            showError('Please log in first before connecting Google Calendar.');
            return;
        }
        
        showLoading('Connecting Google Calendar...');
        
        // Start Google OAuth flow
        const response = await apiCall('/calendars/google/connect', {
            method: 'POST'
        });
        
        if (response.data && response.data.authUrl) {
            // Use redirect instead of popup (more reliable, no popup blocker issues)
            // Store current page to return after OAuth
            sessionStorage.setItem('oauth_return_url', window.location.href);
            
            // Redirect to Google OAuth
            window.location.href = response.data.authUrl;
        } else {
            hideLoading();
            showError('Failed to get authorization URL. Please try again.');
        }
    } catch (error) {
        hideLoading();
        console.error('Error connecting Google Calendar:', error);
        showError(error.message || 'Failed to connect Google Calendar. Make sure the backend is running.');
    }
}

function showAppleCalendarModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(5, 5, 8, 0.9); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; z-index: 1000;';
    modal.innerHTML = `
        <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 24px; padding: 2rem; max-width: 500px; width: 90%; position: relative;">
            <button onclick="this.closest('.modal-overlay').remove()" style="position: absolute; top: 1rem; right: 1rem; width: 36px; height: 36px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-secondary); border-radius: 50%; cursor: pointer; font-size: 1.25rem;">×</button>
            <h2 style="font-family: \'Instrument Serif\', Georgia, serif; font-size: 1.5rem; margin-bottom: 1rem;">Connect Apple Calendar</h2>
            <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.9rem;">Connect your Apple Calendar using CalDAV. You'll need an app-specific password from appleid.apple.com</p>
            <form onsubmit="connectAppleCalendar(event, this.closest('.modal-overlay'))">
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; font-size: 0.85rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.5rem;">Apple ID Email</label>
                    <input type="email" name="email" class="form-input" placeholder="your@email.com" required style="width: 100%; padding: 0.75rem; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 12px; color: var(--text-primary);">
                </div>
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; font-size: 0.85rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 0.5rem;">App-Specific Password</label>
                    <input type="password" name="password" class="form-input" placeholder="xxxx-xxxx-xxxx-xxxx" required style="width: 100%; padding: 0.75rem; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 12px; color: var(--text-primary);">
                    <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">Generate at <a href="https://appleid.apple.com" target="_blank" style="color: var(--accent-primary);">appleid.apple.com</a></p>
                </div>
                <div style="display: flex; gap: 0.75rem;">
                    <button type="submit" class="btn btn-primary" style="flex: 1;">Connect</button>
                    <button type="button" onclick="this.closest('.modal-overlay').remove()" class="btn btn-secondary">Cancel</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
}

async function connectAppleCalendar(event, modal) {
    event.preventDefault();
    const form = event.target;
    const email = form.querySelector('input[name="email"]').value;
    const password = form.querySelector('input[name="password"]').value;
    
    try {
        showLoading('Connecting Apple Calendar...');
        
        await apiCall('/calendars/apple/connect', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        
        modal.remove();
        hideLoading();
        showSuccess('Apple Calendar connected successfully!');
        await loadConnectedCalendars();
        await loadCalendarEvents();
    } catch (error) {
        hideLoading();
        console.error('Error connecting Apple Calendar:', error);
        showError(error.message || 'Failed to connect Apple Calendar');
    }
}

// UI helpers
function showError(message) {
    const existing = document.querySelector(".error-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "error-toast";
    toast.style.cssText = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 1rem 1.5rem; border-radius: 12px; display: flex; align-items: center; gap: 1rem; z-index: 10000; box-shadow: 0 4px 20px rgba(0,0,0,0.3);";
    toast.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="background: none; border: none; color: inherit; font-size: 1.25rem; cursor: pointer; opacity: 0.7;">×</button>
    `;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 5000);
}

function showSuccess(message) {
    const existing = document.querySelector(".success-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "success-toast";
    toast.style.cssText = "position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 1rem 1.5rem; border-radius: 12px; display: flex; align-items: center; gap: 1rem; z-index: 10000; box-shadow: 0 4px 20px rgba(0,0,0,0.3);";
    toast.innerHTML = `
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="background: none; border: none; color: inherit; font-size: 1.25rem; cursor: pointer; opacity: 0.7;">×</button>
    `;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 5000);
}

function showLoading(message = "Loading...") {
    const existing = document.querySelector(".loading-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "loading-overlay";
    overlay.innerHTML = `
        <div class="loading-spinner"></div>
        <p>${message}</p>
    `;
    document.body.appendChild(overlay);
}

function hideLoading() {
    const overlay = document.querySelector(".loading-overlay");
    if (overlay) overlay.remove();
}

// ============================================
// AI ASSISTANT FOR RECURRING EVENTS
// ============================================

let aiConversationHistory = [];
let currentAISuggestion = null;

// Toggle AI Assistant Panel
window.toggleAIAssistant = function() {
    const panel = document.getElementById('aiAssistantPanel');
    if (panel) {
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            document.getElementById('aiAssistantInput')?.focus();
        }
    }
};

// Handle Enter key in AI input
window.handleAIAssistantKeyPress = function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendAIMessage();
    }
};

// Send message to AI Assistant
window.sendAIMessage = async function(messageText) {
    const input = document.getElementById('aiAssistantInput');
    const messagesContainer = document.getElementById('aiAssistantMessages');
    const sendBtn = document.getElementById('aiAssistantSendBtn');
    
    if (!messagesContainer) return;
    
    // Get message text
    const message = messageText || (input?.value?.trim() || '');
    if (!message) return;
    
    // Clear input
    if (input) input.value = '';
    if (sendBtn) sendBtn.disabled = true;
    
    // Add user message to UI
    addAIMessage('user', message);
    
    // Add to conversation history
    aiConversationHistory.push({ role: 'user', content: message });
    
    // Show loading indicator
    const loadingId = addAIMessage('assistant', '', true);
    
    try {
        const user = firebase.auth().currentUser;
        if (!user) {
            // Remove loading indicator
            const loadingMsg = document.getElementById(loadingId);
            if (loadingMsg) loadingMsg.remove();
            addAIMessage('assistant', 'Please sign in to use the AI Assistant. Click the user menu to sign in.');
            if (sendBtn) sendBtn.disabled = false;
            return;
        }
        
        // Ensure we have a fresh token
        try {
            await user.getIdToken(true);
        } catch (tokenError) {
            console.error('Token refresh error:', tokenError);
            const loadingMsg = document.getElementById(loadingId);
            if (loadingMsg) loadingMsg.remove();
            addAIMessage('assistant', 'Your session has expired. Please sign in again.');
            if (sendBtn) sendBtn.disabled = false;
            return;
        }
        
        // Call AI chat endpoint
        const response = await apiCall('/ai-assistant/chat', {
            method: 'POST',
            body: JSON.stringify({
                uid: user.uid,
                message: message,
                conversationHistory: aiConversationHistory.slice(-10) // Last 10 messages
            })
        });
        
        // Remove loading indicator
        const loadingMsg = document.getElementById(loadingId);
        if (loadingMsg) loadingMsg.remove();
        
        if (response.success) {
            // Add assistant response
            addAIMessage('assistant', response.message);
            aiConversationHistory.push({ role: 'assistant', content: response.message });
            
            // If AI detected a recurring pattern, offer to create event
            if (response.pattern) {
                currentAISuggestion = response.pattern;
                addAIPatternSuggestion(response.pattern, message);
            }
        } else {
            throw new Error(response.error || 'Failed to get AI response');
        }
    } catch (error) {
        console.error('AI Assistant error:', error);
        const loadingMsg = document.getElementById(loadingId);
        if (loadingMsg) loadingMsg.remove();
        addAIMessage('assistant', `Sorry, I encountered an error: ${error.message}. Please try again.`);
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        if (input) input.focus();
    }
};

// Add message to AI chat UI
function addAIMessage(role, content, isLoading = false) {
    const messagesContainer = document.getElementById('aiAssistantMessages');
    if (!messagesContainer) return;
    
    const messageId = 'ai-msg-' + Date.now();
    const messageDiv = document.createElement('div');
    messageDiv.id = messageId;
    messageDiv.className = `ai-message ai-message-${role}`;
    
    if (isLoading) {
        messageDiv.innerHTML = `
            <div class="ai-message-avatar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
            </div>
            <div class="ai-message-content">
                <div class="ai-loading">
                    <div class="ai-loading-dot"></div>
                    <div class="ai-loading-dot"></div>
                    <div class="ai-loading-dot"></div>
                </div>
            </div>
        `;
    } else {
        const avatarSvg = role === 'user' 
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>';
        
        messageDiv.innerHTML = `
            <div class="ai-message-avatar">${avatarSvg}</div>
            <div class="ai-message-content">
                <p>${content.replace(/\n/g, '<br>')}</p>
            </div>
        `;
    }
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return messageId;
}

// Add pattern suggestion with action buttons
function addAIPatternSuggestion(pattern, originalMessage) {
    const messagesContainer = document.getElementById('aiAssistantMessages');
    if (!messagesContainer) return;
    
    const suggestionDiv = document.createElement('div');
    suggestionDiv.className = 'ai-message ai-message-assistant';
    suggestionDiv.style.marginTop = '0.5rem';
    
    const patternText = formatRecurringPattern(pattern);
    
    suggestionDiv.innerHTML = `
        <div class="ai-message-avatar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
            </svg>
        </div>
        <div class="ai-message-content">
            <p><strong>I detected a recurring pattern:</strong></p>
            <p style="margin: 0.5rem 0; padding: 0.75rem; background: rgba(201, 255, 87, 0.1); border-radius: 8px; border-left: 3px solid var(--accent-primary);">
                ${patternText}
            </p>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.75rem;">
                <button onclick="createRecurringEventFromAI('${encodeURIComponent(JSON.stringify(pattern))}', '${encodeURIComponent(originalMessage)}')" 
                        style="flex: 1; padding: 0.5rem; background: var(--accent-primary); color: var(--bg-deep); border: none; border-radius: 8px; cursor: pointer; font-weight: 500; font-size: 0.875rem;">
                    Create Event
                </button>
                <button onclick="this.closest('.ai-message').remove()" 
                        style="padding: 0.5rem 1rem; background: transparent; color: var(--text-secondary); border: 1px solid var(--border-subtle); border-radius: 8px; cursor: pointer; font-size: 0.875rem;">
                    Dismiss
                </button>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(suggestionDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Format recurring pattern for display
function formatRecurringPattern(pattern) {
    if (!pattern) return 'No pattern';
    
    const parts = [];
    
    if (pattern.frequency === 'daily') {
        parts.push('Daily');
        if (pattern.interval && pattern.interval > 1) {
            parts.push(`every ${pattern.interval} days`);
        }
    } else if (pattern.frequency === 'weekly') {
        if (pattern.daysOfWeek && pattern.daysOfWeek.length > 0) {
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const days = pattern.daysOfWeek.map(d => dayNames[d]).join(', ');
            parts.push(`Every ${days}`);
        } else {
            parts.push('Weekly');
        }
        if (pattern.interval && pattern.interval > 1) {
            parts.push(`(every ${pattern.interval} weeks)`);
        }
    } else if (pattern.frequency === 'monthly') {
        if (pattern.weekOfMonth && pattern.daysOfWeek) {
            const weekNames = ['', 'first', 'second', 'third', 'fourth', 'last'];
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            parts.push(`${weekNames[pattern.weekOfMonth]} ${dayNames[pattern.daysOfWeek[0]]} of every month`);
        } else if (pattern.dayOfMonth) {
            parts.push(`Monthly on the ${pattern.dayOfMonth}${getOrdinalSuffix(pattern.dayOfMonth)}`);
        } else {
            parts.push('Monthly');
        }
        if (pattern.interval && pattern.interval > 1) {
            parts.push(`(every ${pattern.interval} months)`);
        }
    } else if (pattern.frequency === 'yearly') {
        parts.push('Yearly');
        if (pattern.interval && pattern.interval > 1) {
            parts.push(`(every ${pattern.interval} years)`);
        }
    } else {
        parts.push('Custom pattern');
    }
    
    if (pattern.endDate) {
        const endDate = new Date(pattern.endDate);
        parts.push(`until ${endDate.toLocaleDateString()}`);
    } else if (pattern.occurrences) {
        parts.push(`(${pattern.occurrences} occurrences)`);
    }
    
    return parts.join(' ');
}

function getOrdinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

// Create recurring event from AI suggestion
window.createRecurringEventFromAI = async function(patternJson, originalMessage) {
    try {
        const pattern = JSON.parse(decodeURIComponent(patternJson));
        const message = decodeURIComponent(originalMessage);
        
        // Extract event details from message using AI
        const user = firebase.auth().currentUser;
        if (!user) {
            showError('Please sign in to create events');
            return;
        }
        
        showLoading('Creating recurring event...');
        
        // Use AI to extract event details from the message
        const parseResponse = await apiCall('/ai-assistant/parse-natural-language', {
            method: 'POST',
            body: JSON.stringify({
                uid: user.uid,
                naturalLanguage: message,
                eventContext: { pattern: pattern }
            })
        });
        
        if (parseResponse.success) {
            // Open quick create modal with AI-suggested details
            const today = new Date();
            const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            
            // Generate first instance time (default to 9am if not specified)
            const defaultHour = 9;
            const defaultMinute = 0;
            const minutesFromMidnight = defaultHour * 60 + defaultMinute;
            
            // Open quick create modal
            if (window.openQuickCreateModal) {
                window.openQuickCreateModal(dateStr, minutesFromMidnight);
                
                // Pre-fill with AI suggestions
                setTimeout(() => {
                    const titleInput = document.getElementById('quickCreateTitle');
                    if (titleInput && message) {
                        // Extract title from message (simple heuristic)
                        const titleMatch = message.match(/(?:create|schedule|add|make)\s+(?:a|an|the)?\s*(.+?)(?:\s+(?:every|at|on|for))|(.+?)(?:\s+(?:every|at|on|for))/i);
                        if (titleMatch) {
                            titleInput.value = (titleMatch[1] || titleMatch[2] || message.split(' ').slice(0, 5).join(' ')).trim();
                        }
                    }
                    
                    // Store pattern for when event is created
                    window.pendingRecurringPattern = pattern;
                }, 100);
            }
            
            showSuccess('AI suggestion applied! Fill in the event details and save.');
        } else {
            throw new Error(parseResponse.error || 'Failed to parse event details');
        }
    } catch (error) {
        console.error('Error creating recurring event:', error);
        showError(error.message || 'Failed to create recurring event');
    } finally {
        hideLoading();
    }
};

// Suggest recurrence when creating/editing events
window.suggestRecurrence = async function(eventData) {
    try {
        const user = firebase.auth().currentUser;
        if (!user) return null;
        
        const response = await apiCall('/ai-assistant/suggest-recurrence', {
            method: 'POST',
            body: JSON.stringify({
                uid: user.uid,
                event: eventData
            })
        });
        
        if (response.success && response.suggestion.shouldRecur) {
            return response.suggestion;
        }
        
        return null;
    } catch (error) {
        console.error('Error getting recurrence suggestion:', error);
        return null;
    }
};

// Analyze existing events for recurring patterns
window.analyzeExistingEvents = async function() {
    try {
        const user = firebase.auth().currentUser;
        if (!user) {
            showError('Please sign in to analyze events');
            return;
        }
        
        showLoading('Analyzing your calendar for recurring patterns...');
        
        const response = await apiCall('/ai-assistant/analyze-existing-events', {
            method: 'POST',
            body: JSON.stringify({
                uid: user.uid,
                limit: 100
            })
        });
        
        hideLoading();
        
        if (response.success && response.suggestions && response.suggestions.length > 0) {
            // Show suggestions in AI chat
            const messagesContainer = document.getElementById('aiAssistantMessages');
            if (messagesContainer) {
                addAIMessage('assistant', `I found ${response.suggestions.length} potential recurring patterns in your calendar!`);
                
                response.suggestions.forEach((suggestion, index) => {
                    if (suggestion.shouldBeRecurring && suggestion.confidence > 0.7) {
                        setTimeout(() => {
                            addAIPatternSuggestion(suggestion.pattern, `Convert "${suggestion.title}" to recurring event`);
                        }, (index + 1) * 500);
                    }
                });
            }
            
            showSuccess(`Found ${response.suggestions.length} recurring pattern suggestions!`);
        } else {
            showSuccess('No recurring patterns detected in your calendar.');
        }
    } catch (error) {
        console.error('Error analyzing events:', error);
        hideLoading();
        showError(error.message || 'Failed to analyze events');
    }
};

// Fix overlapping events

// =====================================================
// Quick Create Event Modal Functions
// =====================================================

// Open the quick create event modal
window.openQuickCreateModal = function(dateStr, timeMinutes) {
    const modal = document.getElementById('quickCreateModal');
    if (!modal) {
        console.error('Quick create modal not found');
        return;
    }
    
    // Set default date to today or provided date
    const dateInput = document.getElementById('quickCreateDate');
    if (dateInput) {
        if (dateStr) {
            dateInput.value = dateStr;
        } else {
            const today = new Date();
            dateInput.value = today.toISOString().split('T')[0];
        }
    }
    
    // Set default time if provided
    const timeInput = document.getElementById('quickCreateTime');
    if (timeInput && timeMinutes !== undefined) {
        const hours = Math.floor(timeMinutes / 60);
        const mins = timeMinutes % 60;
        timeInput.value = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
    
    // Clear form
    const titleInput = document.getElementById('quickCreateTitle');
    if (titleInput) titleInput.value = '';
    
    const locationInput = document.getElementById('quickCreateLocation');
    if (locationInput) locationInput.value = '';
    
    const descriptionInput = document.getElementById('quickCreateDescription');
    if (descriptionInput) descriptionInput.value = '';
    
    const recurrenceInput = document.getElementById('quickCreateRecurrence');
    if (recurrenceInput) recurrenceInput.value = '';
    
    const durationInput = document.getElementById('quickCreateDuration');
    if (durationInput) durationInput.value = '60';
    
    // Show modal
    modal.classList.add('active');
};

// Close the quick create event modal
window.closeQuickCreateModal = function(event) {
    if (event && event.target !== event.currentTarget) return;
    
    const modal = document.getElementById('quickCreateModal');
    if (modal) {
        modal.classList.remove('active');
    }
    
    // Clear pending pattern
    window.pendingRecurringPattern = null;
};

// Save the quick create event
window.saveQuickCreateEvent = async function(event) {
    if (event) event.preventDefault();
    
    const titleInput = document.getElementById('quickCreateTitle');
    const dateInput = document.getElementById('quickCreateDate');
    const timeInput = document.getElementById('quickCreateTime');
    const durationInput = document.getElementById('quickCreateDuration');
    const locationInput = document.getElementById('quickCreateLocation');
    const descriptionInput = document.getElementById('quickCreateDescription');
    const recurrenceInput = document.getElementById('quickCreateRecurrence');
    const saveBtn = document.getElementById('quickCreateSaveBtn');
    
    // Validate required fields
    if (!titleInput?.value || !dateInput?.value) {
        showError('Please fill in the required fields');
        return;
    }
    
    // Show loading state
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Creating...';
    }
    
    try {
        // Build event data
        const startDateTime = new Date(`${dateInput.value}T${timeInput?.value || '09:00'}:00`);
        const durationMinutes = parseInt(durationInput?.value || '60');
        const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);
        
        const eventData = {
            title: titleInput.value,
            start: startDateTime.toISOString(),
            end: endDateTime.toISOString(),
            location: locationInput?.value || '',
            description: descriptionInput?.value || '',
            recurrence: recurrenceInput?.value || null,
            calendarType: 'zeitline',
            source: 'web'
        };
        
        // Check for pending recurring pattern from AI
        if (window.pendingRecurringPattern) {
            eventData.recurring = window.pendingRecurringPattern;
            window.pendingRecurringPattern = null;
        }
        
        console.log('Creating event:', eventData);
        
        // Save to Firestore via API
        const response = await apiCall('/calendars/events', {
            method: 'POST',
            body: JSON.stringify(eventData)
        });
        
        if (response.success || response.data) {
            showSuccess('Event created successfully!');
            closeQuickCreateModal();
            
            // Reload calendar events to show the new event
            await loadCalendarEvents();
        } else {
            throw new Error(response.error || 'Failed to create event');
        }
    } catch (error) {
        console.error('Error creating event:', error);
        showError(error.message || 'Failed to create event. Please try again.');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Create Event';
        }
    }
};

// =====================================================
// Clear Calendar Cache Function
// =====================================================

window.clearCalendarCache = async function() {
    if (!confirm('This will clear all cached calendar events and remove any demo/test data. Your connected calendars will re-sync fresh. Continue?')) {
        return;
    }
    
    showLoading('Clearing calendar cache...');
    
    try {
        console.log('🗑️ Clearing calendar cache...');
        
        const response = await apiCall('/calendars/clear-cache', {
            method: 'DELETE'
        });
        
        if (response && response.success) {
            console.log('✅ Cache cleared:', response.data);
            
            // Clear local calendarEvents
            calendarEvents = {};
            
            // Re-render the calendar
            renderCalendar();
            
            hideLoading();
            showSuccess(`Cleared ${response.data.deletedCount || 0} cached events. Syncing fresh data...`);
            
            // Trigger a fresh sync
            await syncCalendars();
        } else {
            hideLoading();
            showError(response?.error || 'Failed to clear cache');
        }
    } catch (error) {
        console.error('❌ Error clearing cache:', error);
        hideLoading();
        showError('Failed to clear calendar cache. Please try again.');
    }
};

// =====================================================
// Sync Calendars Function
// =====================================================

window.syncCalendars = async function() {
    const syncBtn = document.getElementById('syncBtn');
    const syncIcon = document.getElementById('syncIcon');
    const syncBtnText = document.getElementById('syncBtnText');
    const lastSyncInfo = document.getElementById('lastSyncInfo');
    
    // Show loading state
    if (syncBtn) syncBtn.disabled = true;
    if (syncIcon) syncIcon.style.animation = 'spin 1s linear infinite';
    if (syncBtnText) syncBtnText.textContent = 'Syncing...';
    
    // Add spin animation if not exists
    if (!document.getElementById('syncSpinStyle')) {
        const style = document.createElement('style');
        style.id = 'syncSpinStyle';
        style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
        document.head.appendChild(style);
    }
    
    try {
        console.log('🔄 Starting calendar sync...');
        
        // Reload connected calendars
        await loadConnectedCalendars();
        
        // Reload calendar events
        await loadCalendarEvents();
        
        // Update last sync time
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (lastSyncInfo) {
            lastSyncInfo.textContent = `Last synced: ${timeStr}`;
        }
        
        showSuccess('Calendar synced successfully!');
        console.log('✅ Calendar sync complete');
    } catch (error) {
        console.error('❌ Sync error:', error);
        showError('Failed to sync calendar. Please try again.');
    } finally {
        // Reset button state
        if (syncBtn) syncBtn.disabled = false;
        if (syncIcon) syncIcon.style.animation = '';
        if (syncBtnText) syncBtnText.textContent = 'Sync';
    }
};

// =====================================================
// Helper functions for notifications
// =====================================================

function showSuccess(message) {
    // Check if showSuccess is already defined globally
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, 'success');
        return;
    }
    
    // Fallback: create a simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #c9ff57, #57ffd4);
        color: #1a1a2e;
        padding: 12px 24px;
        border-radius: 8px;
        font-weight: 500;
        z-index: 10000;
        animation: slideUp 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showError(message) {
    // Check if showError is already defined globally
    if (typeof window.showNotification === 'function') {
        window.showNotification(message, 'error');
        return;
    }
    
    // Fallback: create a simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #ff6b6b;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-weight: 500;
        z-index: 10000;
        animation: slideUp 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Initialize AI Assistant on page load
document.addEventListener('DOMContentLoaded', () => {
    // Add "Analyze Calendar" button to AI suggestions
    setTimeout(() => {
        const suggestionsContainer = document.getElementById('aiAssistantSuggestions');
        if (suggestionsContainer) {
            const analyzeBtn = document.createElement('button');
            analyzeBtn.className = 'ai-suggestion-chip';
            analyzeBtn.textContent = 'Analyze my calendar';
            analyzeBtn.onclick = () => {
                sendAIMessage('Analyze my calendar for recurring patterns');
                analyzeExistingEvents();
            };
            suggestionsContainer.appendChild(analyzeBtn);
        }
    }, 500);
});

