/**
 * Health & Fitness Dashboard - Real-time Firebase Integration
 * Fetches health data from Firebase and updates the UI dynamically
 */

class HealthDashboard {
    constructor() {
        this.unsubscribeHealth = null;
        this.unsubscribeWorkouts = null;
        this.healthData = null;
        this.workouts = [];
        this.weeklyData = [];
        
        // Initialize when auth state is ready
        window.addEventListener('authStateChanged', (e) => {
            if (e.detail) {
                this.initializeHealthListener();
                this.initializeWorkoutsListener();
                this.fetchWeeklyData();
            } else {
                this.cleanup();
            }
        });
        
        // Check if already authenticated
        if (typeof auth !== 'undefined' && auth.currentUser) {
            this.initializeHealthListener();
            this.initializeWorkoutsListener();
            this.fetchWeeklyData();
        }
    }
    
    /**
     * Initialize real-time listener for health data
     */
    initializeHealthListener() {
        const user = auth.currentUser;
        if (!user) return;
        
        console.log('🏥 Starting health data listener...');
        
        // Listen to the "today" summary document for real-time updates
        this.unsubscribeHealth = db.collection('users').doc(user.uid)
            .collection('healthSummaries').doc('today')
            .onSnapshot((doc) => {
                if (doc.exists) {
                    this.healthData = doc.data();
                    console.log('📊 Health data received:', this.healthData);
                    this.updateUI();
                } else {
                    console.log('⚠️ No health data found - waiting for Apple Watch sync');
                    this.showNoDataState();
                }
            }, (error) => {
                console.error('❌ Health listener error:', error);
            });
    }
    
    /**
     * Initialize real-time listener for workouts
     */
    initializeWorkoutsListener() {
        const user = auth.currentUser;
        if (!user) return;
        
        console.log('🏋️ Starting workouts listener...');
        
        this.unsubscribeWorkouts = db.collection('users').doc(user.uid)
            .collection('workouts')
            .orderBy('startDate', 'desc')
            .limit(10)
            .onSnapshot((snapshot) => {
                this.workouts = [];
                snapshot.forEach((doc) => {
                    this.workouts.push({ id: doc.id, ...doc.data() });
                });
                console.log('🏃 Workouts received:', this.workouts.length);
                this.updateWorkoutsUI();
            }, (error) => {
                console.error('❌ Workouts listener error:', error);
            });
    }
    
    /**
     * Fetch weekly health data for trends
     */
    async fetchWeeklyData() {
        const user = auth.currentUser;
        if (!user) return;
        
        try {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const snapshot = await db.collection('users').doc(user.uid)
                .collection('healthSummaries')
                .where('date', '>=', sevenDaysAgo)
                .orderBy('date', 'asc')
                .get();
            
            this.weeklyData = [];
            snapshot.forEach((doc) => {
                if (doc.id !== 'today') {
                    this.weeklyData.push({ id: doc.id, ...doc.data() });
                }
            });
            
            console.log('📈 Weekly data fetched:', this.weeklyData.length, 'days');
            this.updateTrendsUI();
        } catch (error) {
            console.error('❌ Weekly data fetch error:', error);
        }
    }
    
    /**
     * Update all UI elements with health data
     */
    updateUI() {
        if (!this.healthData) return;
        
        const data = this.healthData;
        
        // Update sync status
        this.updateSyncStatus(data.lastUpdated);
        
        // Update date
        this.updateDate();
        
        // Update Activity Rings
        this.updateActivityRings(data.activityRings || {});
        
        // Update Health Metrics
        this.updateHealthMetrics(data);
        
        // Update Sleep
        this.updateSleep(data);
    }
    
    /**
     * Update sync status indicator
     */
    updateSyncStatus(lastUpdated) {
        const statusEl = document.querySelector('.sync-status');
        if (statusEl && lastUpdated) {
            const date = lastUpdated.toDate ? lastUpdated.toDate() : new Date(lastUpdated);
            const now = new Date();
            const diffMinutes = Math.floor((now - date) / 60000);
            
            if (diffMinutes < 1) {
                statusEl.innerHTML = 'Live Sync Active';
                statusEl.style.background = 'rgba(52, 199, 89, 0.15)';
                statusEl.style.color = '#34c759';
            } else if (diffMinutes < 10) {
                statusEl.innerHTML = `Synced ${diffMinutes}m ago`;
                statusEl.style.background = 'rgba(52, 199, 89, 0.15)';
                statusEl.style.color = '#34c759';
            } else {
                statusEl.innerHTML = `Last sync: ${diffMinutes}m ago`;
                statusEl.style.background = 'rgba(255, 149, 0, 0.15)';
                statusEl.style.color = '#ff9500';
            }
        }
    }
    
    /**
     * Update date display
     */
    updateDate() {
        const dateSpan = document.querySelector('.activity-rings-header span');
        if (dateSpan) {
            const options = { year: 'numeric', month: 'long', day: 'numeric' };
            dateSpan.textContent = new Date().toLocaleDateString('en-US', options);
        }
    }
    
    /**
     * Update Activity Rings visualization and stats
     */
    updateActivityRings(rings) {
        const move = rings.moveCalories || 0;
        const moveGoal = rings.moveGoal || 600;
        const moveProgress = Math.min((move / moveGoal) * 100, 100);
        
        const exercise = rings.exerciseMinutes || 0;
        const exerciseGoal = rings.exerciseGoal || 30;
        const exerciseProgress = Math.min((exercise / exerciseGoal) * 100, 100);
        
        const stand = rings.standHours || 0;
        const standGoal = rings.standGoal || 12;
        const standProgress = Math.min((stand / standGoal) * 100, 100);
        
        // Update ring animations using CSS custom properties
        this.updateRingAnimation('.ring-move', moveProgress);
        this.updateRingAnimation('.ring-exercise', exerciseProgress);
        this.updateRingAnimation('.ring-stand', standProgress);
        
        // Update ring stats
        this.updateRingStat('move', move, moveGoal, moveProgress, 'CAL');
        this.updateRingStat('exercise', exercise, exerciseGoal, exerciseProgress, 'MIN');
        this.updateRingStat('stand', stand, standGoal, standProgress, 'HRS');
    }
    
    /**
     * Update ring animation
     */
    updateRingAnimation(selector, progress) {
        const ring = document.querySelector(selector);
        if (ring) {
            // Convert progress percentage to rotation degrees (0-360)
            const degrees = (progress / 100) * 360;
            ring.style.animation = 'none';
            ring.offsetHeight; // Trigger reflow
            ring.style.transform = `translate(-50%, -50%) rotate(${degrees - 90}deg)`;
        }
    }
    
    /**
     * Update ring stat display
     */
    updateRingStat(type, value, goal, progress, unit) {
        const stats = document.querySelectorAll('.ring-stat');
        stats.forEach(stat => {
            const icon = stat.querySelector('.ring-stat-icon');
            if (icon && icon.classList.contains(type)) {
                const valueEl = stat.querySelector('.ring-stat-value');
                const goalEl = stat.querySelector('.ring-stat-goal');
                
                if (valueEl) {
                    valueEl.innerHTML = `${this.formatNumber(value)} <span style="font-size: 0.9rem; color: var(--text-muted);">/ ${goal} ${unit}</span>`;
                }
                if (goalEl) {
                    goalEl.textContent = `${Math.round(progress)}%`;
                }
            }
        });
    }
    
    /**
     * Update health metrics cards
     */
    updateHealthMetrics(data) {
        // Heart Rate
        const heartRate = data.heartRate || {};
        this.updateMetricCard('heart', heartRate.current || data.heartRateCurrent || 0, 'BPM');
        this.updateHeartRateStats(heartRate);
        
        // Steps
        const steps = data.steps || 0;
        this.updateMetricCard('steps', this.formatNumber(steps), '');
        this.updateStepsProgress(steps, 10000);
        
        // Calories
        const calories = data.calories || 0;
        this.updateMetricCard('calories', calories, 'CAL');
        
        // Distance
        const distance = data.distance || 0;
        this.updateMetricCard('distance', distance.toFixed(1), 'MI');
    }
    
    /**
     * Update a metric card value
     */
    updateMetricCard(type, value, unit) {
        const cards = document.querySelectorAll('.metric-card');
        cards.forEach(card => {
            const icon = card.querySelector('.metric-icon');
            if (icon && icon.classList.contains(type)) {
                const valueEl = card.querySelector('.metric-value');
                if (valueEl) {
                    if (unit) {
                        valueEl.innerHTML = `${value} <span class="unit">${unit}</span>`;
                    } else {
                        valueEl.textContent = value;
                    }
                }
            }
        });
    }
    
    /**
     * Update heart rate stats (low, avg, high)
     */
    updateHeartRateStats(heartRate) {
        const lowEl = document.querySelector('.heart-stat-value.low');
        const avgEl = document.querySelector('.heart-stat-value.avg');
        const highEl = document.querySelector('.heart-stat-value.high');
        
        if (lowEl) lowEl.textContent = heartRate.low || 0;
        if (avgEl) avgEl.textContent = heartRate.avg || 0;
        if (highEl) highEl.textContent = heartRate.high || 0;
    }
    
    /**
     * Update steps progress bar
     */
    updateStepsProgress(steps, goal) {
        const progress = Math.min((steps / goal) * 100, 100);
        const remaining = Math.max(goal - steps, 0);
        
        const cards = document.querySelectorAll('.metric-card');
        cards.forEach(card => {
            const icon = card.querySelector('.metric-icon');
            if (icon && icon.classList.contains('steps')) {
                const progressBar = card.querySelector('div[style*="width:"]');
                const progressText = card.querySelector('div[style*="justify-content: space-between"] span:first-child');
                const remainingText = card.querySelector('div[style*="justify-content: space-between"] span:last-child');
                
                if (progressBar) {
                    progressBar.style.width = `${progress}%`;
                }
                if (progressText) {
                    progressText.textContent = `${Math.round(progress)}% of daily goal`;
                }
                if (remainingText) {
                    remainingText.textContent = `${this.formatNumber(remaining)} to go`;
                }
            }
        });
    }
    
    /**
     * Update sleep card
     */
    updateSleep(data) {
        const sleepSeconds = data.sleepDuration || 0;
        const hours = Math.floor(sleepSeconds / 3600);
        const minutes = Math.floor((sleepSeconds % 3600) / 60);
        
        const cards = document.querySelectorAll('.metric-card');
        cards.forEach(card => {
            const icon = card.querySelector('.metric-icon');
            if (icon && icon.classList.contains('sleep')) {
                const valueEl = card.querySelector('.metric-value');
                if (valueEl) {
                    valueEl.textContent = `${hours}h ${minutes}m`;
                }
            }
        });
    }
    
    /**
     * Update workouts list
     */
    updateWorkoutsUI() {
        const workoutList = document.querySelector('.workout-list');
        if (!workoutList || this.workouts.length === 0) return;
        
        workoutList.innerHTML = this.workouts.slice(0, 5).map(workout => {
            const date = workout.startDate?.toDate ? workout.startDate.toDate() : new Date(workout.startDate);
            const formattedDate = this.formatWorkoutDate(date);
            const type = this.getWorkoutType(workout.workoutType);
            
            const duration = workout.duration ? this.formatDuration(workout.duration) : '--';
            const distance = workout.totalDistance ? `${(workout.totalDistance / 1609.34).toFixed(1)} mi` : '--';
            const calories = workout.totalEnergyBurned ? Math.round(workout.totalEnergyBurned) : '--';
            
            return `
                <div class="workout-item">
                    <div class="workout-icon ${type.class}">${type.icon}</div>
                    <div class="workout-details">
                        <div class="workout-name">${workout.workoutType || 'Workout'}</div>
                        <div class="workout-meta">${formattedDate}</div>
                    </div>
                    <div class="workout-stats">
                        <div>
                            <div class="workout-stat-value">${distance}</div>
                            <div class="workout-stat-label">Distance</div>
                        </div>
                        <div>
                            <div class="workout-stat-value">${duration}</div>
                            <div class="workout-stat-label">Time</div>
                        </div>
                        <div>
                            <div class="workout-stat-value">${calories}</div>
                            <div class="workout-stat-label">Cal</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    /**
     * Update weekly trends UI
     */
    updateTrendsUI() {
        // For now, use the weekly data to update the trend bars
        // This is a simplified version - you could make it more sophisticated
        const trendBars = document.querySelectorAll('.trend-bar');
        
        if (this.weeklyData.length > 0 && trendBars.length > 0) {
            const maxSteps = Math.max(...this.weeklyData.map(d => d.steps || 0), 10000);
            
            this.weeklyData.slice(-7).forEach((day, index) => {
                if (trendBars[index]) {
                    const height = Math.min(((day.steps || 0) / maxSteps) * 100, 100);
                    trendBars[index].style.height = `${Math.max(height, 5)}%`;
                }
            });
            
            // Update weekly average
            const avgSteps = this.weeklyData.reduce((sum, d) => sum + (d.steps || 0), 0) / this.weeklyData.length;
            const avgEl = document.querySelector('.trends-section div[style*="font-size: 1.5rem"]');
            if (avgEl) {
                avgEl.textContent = `${this.formatNumber(Math.round(avgSteps))} steps`;
            }
        }
    }
    
    /**
     * Show no data state
     */
    showNoDataState() {
        const statusEl = document.querySelector('.sync-status');
        if (statusEl) {
            statusEl.innerHTML = 'Waiting for Apple Watch...';
            statusEl.style.background = 'rgba(255, 149, 0, 0.15)';
            statusEl.style.color = '#ff9500';
        }
    }
    
    /**
     * Format number with commas
     */
    formatNumber(num) {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    
    /**
     * Format duration from seconds
     */
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    /**
     * Format workout date
     */
    formatWorkoutDate(date) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const workoutDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        
        const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        
        if (workoutDay.getTime() === today.getTime()) {
            return `Today at ${time}`;
        } else if (workoutDay.getTime() === yesterday.getTime()) {
            return `Yesterday at ${time}`;
        } else {
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return `${dateStr} at ${time}`;
        }
    }
    
    /**
     * Get workout type info for display
     */
    getWorkoutType(type) {
        const types = {
            'Running': { icon: '🏃', class: 'run' },
            'Walking': { icon: '🚶', class: 'run' },
            'Cycling': { icon: '🚴', class: 'cycle' },
            'Swimming': { icon: '🏊', class: 'swim' },
            'Weight Training': { icon: '🏋️', class: 'strength' },
            'Strength Training': { icon: '🏋️', class: 'strength' },
            'Yoga': { icon: '🧘', class: 'yoga' },
            'HIIT': { icon: '💪', class: 'strength' },
            'Dance': { icon: '💃', class: 'yoga' },
            'Hiking': { icon: '🥾', class: 'run' },
        };
        
        return types[type] || { icon: '🏃', class: 'run' };
    }
    
    /**
     * Cleanup listeners
     */
    cleanup() {
        if (this.unsubscribeHealth) {
            this.unsubscribeHealth();
            this.unsubscribeHealth = null;
        }
        if (this.unsubscribeWorkouts) {
            this.unsubscribeWorkouts();
            this.unsubscribeWorkouts = null;
        }
    }
}

// Initialize the health dashboard when the page loads
let healthDashboard;

document.addEventListener('DOMContentLoaded', () => {
    healthDashboard = new HealthDashboard();
});

// Trend tab switching with data
document.querySelectorAll('.trend-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.trend-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        const type = tab.textContent.toLowerCase();
        if (healthDashboard && healthDashboard.weeklyData.length > 0) {
            const trendBars = document.querySelectorAll('.trend-bar');
            const data = healthDashboard.weeklyData;
            
            let values, maxValue, unit;
            
            switch (type) {
                case 'steps':
                    values = data.map(d => d.steps || 0);
                    maxValue = Math.max(...values, 10000);
                    unit = 'steps';
                    break;
                case 'calories':
                    values = data.map(d => d.calories || 0);
                    maxValue = Math.max(...values, 600);
                    unit = 'cal';
                    break;
                case 'exercise':
                    values = data.map(d => d.activeMinutes || 0);
                    maxValue = Math.max(...values, 30);
                    unit = 'min';
                    break;
                case 'sleep':
                    values = data.map(d => (d.sleepDuration || 0) / 3600);
                    maxValue = Math.max(...values, 8);
                    unit = 'hours';
                    break;
                default:
                    values = data.map(d => d.steps || 0);
                    maxValue = Math.max(...values, 10000);
                    unit = 'steps';
            }
            
            values.slice(-7).forEach((value, index) => {
                if (trendBars[index]) {
                    const height = Math.min((value / maxValue) * 100, 100);
                    trendBars[index].style.height = `${Math.max(height, 5)}%`;
                }
            });
            
            // Update average display
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const avgEl = document.querySelector('.trends-section div[style*="font-size: 1.5rem"]');
            if (avgEl) {
                if (type === 'sleep') {
                    avgEl.textContent = `${avg.toFixed(1)} ${unit}`;
                } else {
                    avgEl.textContent = `${healthDashboard.formatNumber(Math.round(avg))} ${unit}`;
                }
            }
        }
    });
});

