/**
 * Exercise Manager
 * Handles exercise logging and tracking
 */

// State
let currentDate = new Date();
let exerciseEntries = [];
let exerciseEntriesListener = null;
let selectedExercise = null;
let userWeight = 70; // Default weight in kg

// Exercise database with MET values
const exerciseDatabase = [
    // Cardio
    { id: 'running_moderate', name: 'Running (Moderate)', category: 'cardio', met: 9.8, icon: '🏃' },
    { id: 'running_fast', name: 'Running (Fast)', category: 'cardio', met: 11.5, icon: '🏃‍♂️' },
    { id: 'walking_brisk', name: 'Walking (Brisk)', category: 'cardio', met: 4.3, icon: '🚶' },
    { id: 'cycling', name: 'Cycling', category: 'cardio', met: 6.8, icon: '🚴' },
    { id: 'swimming', name: 'Swimming', category: 'cardio', met: 5.8, icon: '🏊' },
    { id: 'jump_rope', name: 'Jump Rope', category: 'cardio', met: 11.0, icon: '🪢' },
    { id: 'hiit', name: 'HIIT', category: 'cardio', met: 8.0, icon: '⚡' },
    { id: 'elliptical', name: 'Elliptical', category: 'cardio', met: 5.0, icon: '🏋️' },
    { id: 'rowing', name: 'Rowing', category: 'cardio', met: 7.0, icon: '🚣' },
    { id: 'hiking', name: 'Hiking', category: 'cardio', met: 5.3, icon: '🥾' },
    
    // Strength
    { id: 'weight_training', name: 'Weight Training', category: 'strength', met: 5.0, icon: '🏋️' },
    { id: 'pushups', name: 'Push-ups', category: 'strength', met: 3.8, icon: '💪' },
    { id: 'squats', name: 'Squats', category: 'strength', met: 5.5, icon: '🦵' },
    { id: 'planks', name: 'Planks', category: 'strength', met: 3.0, icon: '🧘' },
    { id: 'pullups', name: 'Pull-ups', category: 'strength', met: 4.8, icon: '💪' },
    
    // Flexibility
    { id: 'yoga', name: 'Yoga', category: 'flexibility', met: 2.5, icon: '🧘' },
    { id: 'stretching', name: 'Stretching', category: 'flexibility', met: 2.3, icon: '🤸' },
    { id: 'pilates', name: 'Pilates', category: 'flexibility', met: 3.0, icon: '🧘‍♀️' },
    
    // Sports
    { id: 'basketball', name: 'Basketball', category: 'sports', met: 6.5, icon: '🏀' },
    { id: 'soccer', name: 'Soccer', category: 'sports', met: 7.0, icon: '⚽' },
    { id: 'tennis', name: 'Tennis', category: 'sports', met: 7.3, icon: '🎾' },
    { id: 'golf', name: 'Golf', category: 'sports', met: 4.3, icon: '⛳' },
    { id: 'boxing', name: 'Boxing', category: 'sports', met: 7.8, icon: '🥊' },
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    renderExerciseGrid();
    initializeDateNav();
    
    // Wait for auth
    window.addEventListener('authStateChanged', (e) => {
        const user = e.detail;
        if (user) {
            startListening(user.uid);
            loadUserWeight(user.uid);
        }
    });
    
    // Fallback
    setTimeout(() => {
        if (typeof currentUser !== 'undefined' && currentUser) {
            startListening(currentUser.uid);
            loadUserWeight(currentUser.uid);
        }
    }, 2000);
});

// Render exercise grid
function renderExerciseGrid() {
    const grid = document.getElementById('exerciseGrid');
    
    // Show popular exercises
    const popularExercises = exerciseDatabase.slice(0, 8);
    
    grid.innerHTML = popularExercises.map(exercise => `
        <div class="exercise-card" onclick="selectExercise('${exercise.id}')">
            <div class="icon">${exercise.icon}</div>
            <div class="name">${exercise.name}</div>
            <div class="met">MET ${exercise.met}</div>
        </div>
    `).join('');
}

// Date Navigation
function initializeDateNav() {
    updateDateDisplay();
    
    document.getElementById('prevDay').addEventListener('click', () => {
        currentDate.setDate(currentDate.getDate() - 1);
        updateDateDisplay();
        refreshData();
    });
    
    document.getElementById('nextDay').addEventListener('click', () => {
        const tomorrow = new Date(currentDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow <= new Date()) {
            currentDate = tomorrow;
            updateDateDisplay();
            refreshData();
        }
    });
}

function updateDateDisplay() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    let dateText;
    if (isSameDay(currentDate, today)) {
        dateText = 'Today';
        document.getElementById('nextDay').disabled = true;
    } else if (isSameDay(currentDate, yesterday)) {
        dateText = 'Yesterday';
        document.getElementById('nextDay').disabled = false;
    } else {
        dateText = currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        document.getElementById('nextDay').disabled = false;
    }
    
    document.getElementById('currentDate').textContent = dateText;
}

function isSameDay(d1, d2) {
    return d1.getDate() === d2.getDate() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getFullYear() === d2.getFullYear();
}

// Firebase Listeners
function startListening(userId) {
    const startOfDay = new Date(currentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(currentDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    if (exerciseEntriesListener) exerciseEntriesListener();
    
    exerciseEntriesListener = db.collection('users').doc(userId)
        .collection('exerciseEntries')
        .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(startOfDay))
        .where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(endOfDay))
        .orderBy('timestamp', 'desc')
        .onSnapshot(snapshot => {
            exerciseEntries = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            renderWorkouts();
            updateSummary();
        });
}

function refreshData() {
    if (typeof currentUser !== 'undefined' && currentUser) {
        startListening(currentUser.uid);
    }
}

async function loadUserWeight(userId) {
    try {
        const doc = await db.collection('users').doc(userId).get();
        if (doc.exists && doc.data().weight) {
            userWeight = doc.data().weight;
        }
    } catch (error) {
        console.error('Failed to load user weight:', error);
    }
}

// Render Workouts
function renderWorkouts() {
    const container = document.getElementById('workoutList');
    
    if (exerciseEntries.length === 0) {
        container.innerHTML = `
            <div class="empty-log">
                <div class="icon">🏃</div>
                <p>No workouts logged yet</p>
                <p style="font-size: 0.85rem;">Click "Log Exercise" to add a workout</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = exerciseEntries.map(entry => {
        const categoryClass = entry.category || 'cardio';
        const icon = getExerciseIcon(entry.name);
        
        return `
            <div class="workout-item">
                <div class="workout-icon ${categoryClass}">${icon}</div>
                <div class="workout-info">
                    <div class="workout-name">${entry.name}</div>
                    <div class="workout-details">${entry.duration} min</div>
                </div>
                <div class="workout-calories">-${Math.round(entry.caloriesBurned)} cal</div>
                <button class="workout-delete" onclick="deleteWorkout('${entry.id}')">🗑️</button>
            </div>
        `;
    }).join('');
}

function getExerciseIcon(name) {
    const exercise = exerciseDatabase.find(e => e.name === name);
    return exercise ? exercise.icon : '🏃';
}

// Update Summary
function updateSummary() {
    const totalCalories = exerciseEntries.reduce((sum, e) => sum + (e.caloriesBurned || 0), 0);
    const totalDuration = exerciseEntries.reduce((sum, e) => sum + (e.duration || 0), 0);
    
    document.getElementById('totalCalories').textContent = Math.round(totalCalories);
    document.getElementById('totalDuration').textContent = Math.round(totalDuration);
    document.getElementById('totalWorkouts').textContent = exerciseEntries.length;
}

// Modal Functions
function showExercisePicker() {
    // Default to running
    selectExercise('running_moderate');
}

function selectExercise(exerciseId) {
    selectedExercise = exerciseDatabase.find(e => e.id === exerciseId);
    
    if (!selectedExercise) return;
    
    document.getElementById('selectedIcon').textContent = selectedExercise.icon;
    document.getElementById('selectedName').textContent = selectedExercise.name;
    document.getElementById('durationSlider').value = 30;
    document.getElementById('durationValue').textContent = '30';
    
    updateCalories();
    openModal();
}

function openModal() {
    document.getElementById('logModal').classList.add('active');
}

function closeModal() {
    document.getElementById('logModal').classList.remove('active');
}

function updateCalories() {
    const duration = parseInt(document.getElementById('durationSlider').value);
    document.getElementById('durationValue').textContent = duration;
    
    if (selectedExercise) {
        // Calories = MET × weight(kg) × duration(hours)
        const hours = duration / 60;
        const calories = selectedExercise.met * userWeight * hours;
        document.getElementById('caloriesPreview').textContent = Math.round(calories);
    }
}

// Log Exercise
async function logExercise() {
    if (!selectedExercise) return;
    
    const duration = parseInt(document.getElementById('durationSlider').value);
    const hours = duration / 60;
    const caloriesBurned = selectedExercise.met * userWeight * hours;
    
    const entry = {
        id: `exercise_${Date.now()}`,
        name: selectedExercise.name,
        category: selectedExercise.category,
        duration: duration,
        caloriesBurned: Math.round(caloriesBurned),
        met: selectedExercise.met,
        source: 'manual',
        timestamp: firebase.firestore.Timestamp.now()
    };
    
    try {
        await db.collection('users').doc(currentUser.uid)
            .collection('exerciseEntries').doc(entry.id)
            .set(entry);
        
        console.log('✅ Logged exercise:', entry.name);
        closeModal();
    } catch (error) {
        console.error('Failed to log exercise:', error);
        alert('Failed to log exercise. Please try again.');
    }
}

// Delete Workout
async function deleteWorkout(workoutId) {
    if (!confirm('Delete this workout?')) return;
    
    try {
        await db.collection('users').doc(currentUser.uid)
            .collection('exerciseEntries').doc(workoutId)
            .delete();
    } catch (error) {
        console.error('Failed to delete workout:', error);
    }
}

// Sign Out
function signOut() {
    firebase.auth().signOut().then(() => {
        window.location.href = '/login.html';
    });
}

