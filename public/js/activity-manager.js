/**
 * ActivityManager - Manages activity tracking with Firestore sync
 * 
 * Writes to Firestore ONLY on state changes (start/stop).
 * Listens for real-time updates from all devices via onSnapshot.
 */
class ActivityManager {
  constructor() {
    this.activeSession = null;
    this.activities = [];
    this.unsubscribe = null;
    this.onActivitiesChanged = null;
    this.onActiveSessionChanged = null;
    
    // Default activities (matching iOS app)
    this.defaultActivities = [
      { name: "Eat", icon: "🍽️", color: "orange" },
      { name: "Sleep", icon: "🛏️", color: "indigo" },
      { name: "Cook", icon: "🍳", color: "red" },
      { name: "Read", icon: "📚", color: "green" },
      { name: "Watch TV", icon: "📺", color: "blue" },
      { name: "Gaming", icon: "🎮", color: "purple" },
      { name: "Exercise", icon: "🏃", color: "mint" },
      { name: "Work", icon: "💻", color: "cyan" },
      { name: "Meditate", icon: "🧠", color: "teal" },
      { name: "Walk", icon: "🚶", color: "green" },
      { name: "Shop", icon: "🛒", color: "pink" },
      { name: "Clean", icon: "🧹", color: "yellow" }
    ];
  }

  /**
   * Start an activity - SINGLE write to Firestore
   * Only called when user clicks "Start"
   */
  async startActivity(activityName, activityIcon, activityColor) {
    const user = firebase.auth().currentUser;
    if (!user) {
      throw new Error('Not authenticated');
    }

    // Stop any existing activity first
    if (this.activeSession) {
      await this.stopActivity();
    }

    const sessionId = this._generateUUID();
    const now = new Date();

    const activityDoc = {
      id: sessionId,
      session_id: sessionId,
      activity_name: activityName,
      activity_icon: activityIcon,
      activity_color: activityColor,
      event_type: 'started',
      start_time: firebase.firestore.Timestamp.fromDate(now),
      timestamp: firebase.firestore.Timestamp.fromDate(now),
      device_id: 'web',
      synced_at: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Single write to Firestore - only happens on user action
    await db.collection('users').doc(user.uid)
      .collection('activities').doc(sessionId)
      .set(activityDoc);

    this.activeSession = {
      id: sessionId,
      startTime: now,
      activityName,
      activityIcon,
      activityColor
    };

    console.log(`✅ Started activity: ${activityName}`);
    
    if (this.onActiveSessionChanged) {
      this.onActiveSessionChanged(this.activeSession);
    }

    return this.activeSession;
  }

  /**
   * Stop the current activity - SINGLE write to Firestore
   * Only called when user clicks "Stop"
   */
  async stopActivity() {
    if (!this.activeSession) {
      console.log('No active session to stop');
      return null;
    }

    const user = firebase.auth().currentUser;
    if (!user) {
      throw new Error('Not authenticated');
    }

    const now = new Date();
    const duration = (now - this.activeSession.startTime) / 1000; // seconds

    // Single write to Firestore - only happens on user action
    await db.collection('users').doc(user.uid)
      .collection('activities').doc(this.activeSession.id)
      .update({
        event_type: 'stopped',
        end_time: firebase.firestore.Timestamp.fromDate(now),
        duration: duration,
        synced_at: firebase.firestore.FieldValue.serverTimestamp()
      });

    const stoppedSession = { ...this.activeSession, endTime: now, duration };
    this.activeSession = null;

    console.log(`✅ Stopped activity: ${stoppedSession.activityName} (${this._formatDuration(duration)})`);

    if (this.onActiveSessionChanged) {
      this.onActiveSessionChanged(null);
    }

    return stoppedSession;
  }

  /**
   * Subscribe to real-time activity updates
   * Firebase PUSHES changes to us - no polling
   */
  subscribeToActivities(onActivities, onActiveSession) {
    const user = firebase.auth().currentUser;
    if (!user) {
      console.error('Cannot subscribe: not authenticated');
      return null;
    }

    this.onActivitiesChanged = onActivities;
    this.onActiveSessionChanged = onActiveSession;

    // onSnapshot maintains a WebSocket connection
    // Firebase pushes changes when they occur - NOT polling
    this.unsubscribe = db.collection('users').doc(user.uid)
      .collection('activities')
      .orderBy('timestamp', 'desc')
      .limit(100)
      .onSnapshot(
        snapshot => {
          this.activities = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
              ...data,
              start_time: data.start_time?.toDate?.() || new Date(data.start_time),
              end_time: data.end_time?.toDate?.() || (data.end_time ? new Date(data.end_time) : null),
              timestamp: data.timestamp?.toDate?.() || new Date(data.timestamp)
            };
          });

          // Find active session (started but not stopped)
          this._detectActiveSession();

          if (this.onActivitiesChanged) {
            this.onActivitiesChanged(this.activities);
          }
        },
        error => {
          console.error('Activities listener error:', error);
        }
      );

    console.log('📡 Subscribed to real-time activity updates');
    return this.unsubscribe;
  }

  /**
   * Detect if there's an active session from any device
   */
  _detectActiveSession() {
    // Group activities by session_id
    const sessions = new Map();
    
    for (const activity of this.activities) {
      const sessionId = activity.session_id;
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, { started: null, stopped: null });
      }
      
      if (activity.event_type === 'started') {
        sessions.get(sessionId).started = activity;
      } else if (activity.event_type === 'stopped') {
        sessions.get(sessionId).stopped = activity;
      }
    }

    // Find sessions that started but haven't stopped
    let mostRecentActive = null;
    
    for (const [sessionId, session] of sessions) {
      if (session.started && !session.stopped) {
        if (!mostRecentActive || session.started.timestamp > mostRecentActive.startTime) {
          mostRecentActive = {
            id: sessionId,
            startTime: session.started.start_time,
            activityName: session.started.activity_name,
            activityIcon: session.started.activity_icon,
            activityColor: session.started.activity_color,
            deviceId: session.started.device_id
          };
        }
      }
    }

    // Only update if changed
    const currentId = this.activeSession?.id;
    const newId = mostRecentActive?.id;
    
    if (currentId !== newId) {
      this.activeSession = mostRecentActive;
      
      if (this.onActiveSessionChanged) {
        this.onActiveSessionChanged(this.activeSession);
      }

      if (mostRecentActive) {
        console.log(`📱 Active session detected: ${mostRecentActive.activityName} (from ${mostRecentActive.deviceId})`);
      }
    }
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribeFromActivities() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      console.log('📡 Unsubscribed from activity updates');
    }
  }

  /**
   * Get activities for a specific date
   */
  getActivitiesForDate(date) {
    const targetDate = new Date(date).toDateString();
    return this.activities.filter(a => {
      const activityDate = new Date(a.start_time).toDateString();
      return activityDate === targetDate;
    });
  }

  /**
   * Get completed activities (stopped sessions)
   */
  getCompletedActivities() {
    return this.activities.filter(a => a.event_type === 'stopped');
  }

  /**
   * Get total duration for today
   */
  getTodayTotalDuration() {
    const today = new Date().toDateString();
    return this.activities
      .filter(a => {
        return a.event_type === 'stopped' && 
               new Date(a.start_time).toDateString() === today;
      })
      .reduce((total, a) => total + (a.duration || 0), 0);
  }

  /**
   * Format duration in seconds to human readable
   */
  _formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}h ${m}m`;
    } else if (m > 0) {
      return `${m}m ${s}s`;
    } else {
      return `${s}s`;
    }
  }

  /**
   * Get elapsed time for active session
   */
  getActiveSessionElapsed() {
    if (!this.activeSession) return 0;
    return (Date.now() - this.activeSession.startTime.getTime()) / 1000;
  }

  /**
   * Format elapsed time for display
   */
  getActiveSessionElapsedFormatted() {
    const seconds = this.getActiveSessionElapsed();
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    } else {
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Generate a UUID
   */
  _generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Get color CSS value from color name
   */
  getColorValue(colorName) {
    const colors = {
      red: '#ef4444',
      orange: '#f97316',
      yellow: '#eab308',
      green: '#22c55e',
      blue: '#3b82f6',
      purple: '#a855f7',
      pink: '#ec4899',
      cyan: '#06b6d4',
      mint: '#34d399',
      indigo: '#6366f1',
      teal: '#14b8a6',
      lime: '#84cc16',
      gray: '#6b7280'
    };
    return colors[colorName] || colors.gray;
  }
}

// Create global instance
const activityManager = new ActivityManager();


