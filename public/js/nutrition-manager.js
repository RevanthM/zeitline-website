/**
 * Nutrition Manager
 * Handles food tracking, barcode scanning, and exercise logging
 */

// State
let currentDate = new Date();
let currentMealType = 'breakfast';
let foodEntries = [];
let exerciseEntries = [];
let html5QrCode = null;
let foodEntriesListener = null;
let exerciseEntriesListener = null;

// Goals (will be loaded from Firebase)
let nutritionGoals = {
    calories: 2000,
    protein: 50,
    carbs: 250,
    fat: 65
};

let exerciseGoals = {
    caloriesPerDay: 300,
    minutesPerDay: 30
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    initializeDateNav();
    
    // Wait for auth
    window.addEventListener('authStateChanged', (e) => {
        const user = e.detail;
        if (user) {
            loadGoals(user.uid);
            startListening(user.uid);
        }
    });
    
    // Fallback
    setTimeout(() => {
        if (typeof currentUser !== 'undefined' && currentUser) {
            loadGoals(currentUser.uid);
            startListening(currentUser.uid);
        }
    }, 2000);
});

// Tab Navigation
function initializeTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`${tab}-tab`).classList.add('active');
        });
    });
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
    
    // Stop existing listeners
    if (foodEntriesListener) foodEntriesListener();
    if (exerciseEntriesListener) exerciseEntriesListener();
    
    // Listen to food entries
    foodEntriesListener = db.collection('users').doc(userId)
        .collection('foodEntries')
        .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(startOfDay))
        .where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(endOfDay))
        .orderBy('timestamp', 'asc')
        .onSnapshot(snapshot => {
            foodEntries = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            renderFoodEntries();
            updateSummary();
        });
    
    // Listen to exercise entries
    exerciseEntriesListener = db.collection('users').doc(userId)
        .collection('exerciseEntries')
        .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(startOfDay))
        .where('timestamp', '<=', firebase.firestore.Timestamp.fromDate(endOfDay))
        .orderBy('timestamp', 'asc')
        .onSnapshot(snapshot => {
            exerciseEntries = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            renderExerciseEntries();
            updateExerciseSummary();
        });
}

function refreshData() {
    if (typeof currentUser !== 'undefined' && currentUser) {
        startListening(currentUser.uid);
    }
}

// Load Goals
async function loadGoals(userId) {
    try {
        const doc = await db.collection('users').doc(userId).get();
        if (doc.exists) {
            const data = doc.data();
            if (data.nutritionGoals) {
                nutritionGoals = { ...nutritionGoals, ...data.nutritionGoals };
            }
            if (data.exerciseGoals) {
                exerciseGoals = { ...exerciseGoals, ...data.exerciseGoals };
            }
        }
        
        // Update goal displays
        document.getElementById('calorieGoal').textContent = nutritionGoals.calories;
        document.getElementById('proteinGoal').textContent = nutritionGoals.protein;
        document.getElementById('carbsGoal').textContent = nutritionGoals.carbs;
        document.getElementById('fatGoal').textContent = nutritionGoals.fat;
    } catch (error) {
        console.error('Failed to load goals:', error);
    }
}

// Render Food Entries
function renderFoodEntries() {
    const meals = ['breakfast', 'lunch', 'dinner', 'snack'];
    
    meals.forEach(meal => {
        const container = document.getElementById(`${meal}-foods`);
        const mealEntries = foodEntries.filter(e => e.mealType === meal);
        
        if (mealEntries.length === 0) {
            container.innerHTML = '<div class="empty-meal">No food logged yet</div>';
        } else {
            container.innerHTML = mealEntries.map(entry => `
                <div class="food-item" data-id="${entry.id}">
                    <div class="food-thumb">🍽️</div>
                    <div class="food-info">
                        <div class="food-name">${entry.name}</div>
                        <div class="food-serving">${entry.numberOfServings || 1} × ${entry.servingSize || 100}${entry.servingUnit || 'g'}</div>
                    </div>
                    <div class="food-calories">${Math.round((entry.calories || 0) * (entry.numberOfServings || 1))} cal</div>
                    <button class="food-delete" onclick="deleteFood('${entry.id}')">🗑️</button>
                </div>
            `).join('');
        }
        
        // Update meal calories
        const mealCalories = mealEntries.reduce((sum, e) => sum + (e.calories || 0) * (e.numberOfServings || 1), 0);
        document.getElementById(`${meal}-cals`).textContent = `${Math.round(mealCalories)} cal`;
    });
}

// Update Summary
function updateSummary() {
    const totals = foodEntries.reduce((acc, entry) => {
        const servings = entry.numberOfServings || 1;
        return {
            calories: acc.calories + (entry.calories || 0) * servings,
            protein: acc.protein + (entry.protein || 0) * servings,
            carbs: acc.carbs + (entry.carbs || 0) * servings,
            fat: acc.fat + (entry.fat || 0) * servings
        };
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
    
    // Update displays
    document.getElementById('caloriesEaten').textContent = Math.round(totals.calories);
    document.getElementById('proteinValue').textContent = Math.round(totals.protein);
    document.getElementById('carbsValue').textContent = Math.round(totals.carbs);
    document.getElementById('fatValue').textContent = Math.round(totals.fat);
    
    // Update calorie ring
    const caloriePercent = Math.min(totals.calories / nutritionGoals.calories, 1);
    const circumference = 2 * Math.PI * 50; // r=50
    const offset = circumference * (1 - caloriePercent);
    document.getElementById('calorieProgress').style.strokeDashoffset = offset;
    
    // Update macro bars
    document.getElementById('proteinBar').style.width = `${Math.min(totals.protein / nutritionGoals.protein * 100, 100)}%`;
    document.getElementById('carbsBar').style.width = `${Math.min(totals.carbs / nutritionGoals.carbs * 100, 100)}%`;
    document.getElementById('fatBar').style.width = `${Math.min(totals.fat / nutritionGoals.fat * 100, 100)}%`;
}

// Render Exercise Entries
function renderExerciseEntries() {
    const container = document.getElementById('exercise-list');
    
    if (exerciseEntries.length === 0) {
        container.innerHTML = '<div class="empty-meal">No exercises logged yet</div>';
    } else {
        container.innerHTML = exerciseEntries.map(entry => `
            <div class="food-item" data-id="${entry.id}">
                <div class="food-thumb">${getCategoryEmoji(entry.category)}</div>
                <div class="food-info">
                    <div class="food-name">${entry.name}</div>
                    <div class="food-serving">${entry.duration} min</div>
                </div>
                <div class="food-calories" style="color: var(--accent-tertiary);">-${Math.round(entry.caloriesBurned)} cal</div>
                <button class="food-delete" onclick="deleteExercise('${entry.id}')">🗑️</button>
            </div>
        `).join('');
    }
}

function getCategoryEmoji(category) {
    const emojis = {
        cardio: '🏃',
        strength: '🏋️',
        flexibility: '🧘',
        sports: '⚽',
        other: '🏅'
    };
    return emojis[category] || '🏃';
}

// Update Exercise Summary
function updateExerciseSummary() {
    const totalCalories = exerciseEntries.reduce((sum, e) => sum + (e.caloriesBurned || 0), 0);
    const totalDuration = exerciseEntries.reduce((sum, e) => sum + (e.duration || 0), 0);
    
    document.getElementById('caloriesBurned').textContent = Math.round(totalCalories);
    document.getElementById('exerciseDuration').textContent = Math.round(totalDuration);
    document.getElementById('exerciseCount').textContent = exerciseEntries.length;
    
    // Update ring
    const exercisePercent = Math.min(totalCalories / exerciseGoals.caloriesPerDay, 1);
    const circumference = 2 * Math.PI * 50;
    const offset = circumference * (1 - exercisePercent);
    document.getElementById('exerciseProgress').style.strokeDashoffset = offset;
}

// Modal Functions
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    stopScanner();
    showAddOptions();
}

function openAddFood(mealType) {
    currentMealType = mealType;
    document.getElementById('addFoodTitle').textContent = `Add ${mealType.charAt(0).toUpperCase() + mealType.slice(1)}`;
    openModal('addFoodModal');
}

function showAddOptions() {
    document.getElementById('addOptions').style.display = 'flex';
    document.getElementById('scanner-view').style.display = 'none';
    document.getElementById('search-view').style.display = 'none';
    document.getElementById('manual-view').style.display = 'none';
    document.getElementById('nutrition-scanner-view').style.display = 'none';
}

// Barcode Scanner
function startBarcodeScanner() {
    document.getElementById('addOptions').style.display = 'none';
    document.getElementById('scanner-view').style.display = 'block';
    
    html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start(
        { facingMode: "environment" },
        {
            fps: 10,
            qrbox: { width: 250, height: 150 }
        },
        onBarcodeScanned,
        () => {} // Ignore scan errors
    ).catch(err => {
        console.error('Failed to start scanner:', err);
        alert('Could not access camera. Please check permissions.');
        showAddOptions();
    });
}

function stopScanner() {
    if (html5QrCode) {
        html5QrCode.stop().catch(() => {});
        html5QrCode = null;
    }
}

async function onBarcodeScanned(barcode) {
    stopScanner();
    
    // Show loading
    document.getElementById('scanner-view').innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 1rem; color: var(--text-secondary);">Looking up product...</p>
        </div>
    `;
    
    try {
        const product = await lookupBarcode(barcode);
        if (product) {
            await addFoodFromProduct(product);
            closeModal('addFoodModal');
        } else {
            alert('Product not found. Try manual entry.');
            showAddOptions();
        }
    } catch (error) {
        console.error('Barcode lookup failed:', error);
        alert('Failed to look up product. Try again.');
        showAddOptions();
    }
}

// OpenFoodFacts API
async function lookupBarcode(barcode) {
    const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    const data = await response.json();
    
    if (data.status === 1 && data.product) {
        return data.product;
    }
    return null;
}

async function searchFoodsAPI(query) {
    const response = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20&fields=code,product_name,product_name_en,brands,image_front_small_url,nutriments`);
    const data = await response.json();
    return data.products || [];
}

// Food Search
function showFoodSearch() {
    document.getElementById('addOptions').style.display = 'none';
    document.getElementById('search-view').style.display = 'block';
    document.getElementById('foodSearchInput').focus();
}

let searchTimeout;
function searchFoods(query) {
    clearTimeout(searchTimeout);
    
    if (query.length < 2) {
        document.getElementById('searchResults').innerHTML = '';
        return;
    }
    
    document.getElementById('searchResults').innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--text-muted);">Searching...</div>';
    
    searchTimeout = setTimeout(async () => {
        try {
            const products = await searchFoodsAPI(query);
            renderSearchResults(products);
        } catch (error) {
            document.getElementById('searchResults').innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--error);">Search failed</div>';
        }
    }, 500);
}

function renderSearchResults(products) {
    if (products.length === 0) {
        document.getElementById('searchResults').innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--text-muted);">No results found</div>';
        return;
    }
    
    document.getElementById('searchResults').innerHTML = products.map(product => {
        const name = product.product_name || product.product_name_en || 'Unknown';
        const brand = product.brands || '';
        const calories = product.nutriments?.['energy-kcal_100g'] || 0;
        const image = product.image_front_small_url || '';
        
        return `
            <div class="search-result" onclick='selectSearchResult(${JSON.stringify(product).replace(/'/g, "\\'")})'>
                ${image ? `<img src="${image}" class="search-result-img" onerror="this.style.display='none'">` : '<div class="search-result-img">🍽️</div>'}
                <div class="search-result-info">
                    <div class="search-result-name">${name}</div>
                    <div class="search-result-brand">${brand}</div>
                </div>
                <div class="search-result-cals">${Math.round(calories)} cal/100g</div>
            </div>
        `;
    }).join('');
}

async function selectSearchResult(product) {
    await addFoodFromProduct(product);
    closeModal('addFoodModal');
}

async function addFoodFromProduct(product) {
    const nutriments = product.nutriments || {};
    
    const entry = {
        id: `food_${Date.now()}`,
        name: product.product_name || product.product_name_en || 'Unknown',
        brand: product.brands || null,
        barcode: product.code || null,
        servingSize: product.serving_quantity || 100,
        servingUnit: 'g',
        numberOfServings: 1,
        calories: nutriments['energy-kcal_100g'] || 0,
        protein: nutriments['proteins_100g'] || 0,
        carbs: nutriments['carbohydrates_100g'] || 0,
        fat: nutriments['fat_100g'] || 0,
        fiber: nutriments['fiber_100g'] || null,
        sugar: nutriments['sugars_100g'] || null,
        mealType: currentMealType,
        timestamp: firebase.firestore.Timestamp.now(),
        source: 'openfoodfacts',
        imageUrl: product.image_front_small_url || null
    };
    
    await db.collection('users').doc(currentUser.uid)
        .collection('foodEntries').doc(entry.id)
        .set(entry);
    
    console.log('✅ Added food:', entry.name);
}

// Manual Entry
function showManualEntry() {
    document.getElementById('addOptions').style.display = 'none';
    document.getElementById('manual-view').style.display = 'block';
}

async function addManualFood() {
    const name = document.getElementById('manualName').value.trim();
    const calories = parseFloat(document.getElementById('manualCalories').value) || 0;
    
    if (!name) {
        alert('Please enter a food name');
        return;
    }
    
    const entry = {
        id: `food_${Date.now()}`,
        name,
        servingSize: 100,
        servingUnit: document.getElementById('manualServing').value || 'g',
        numberOfServings: 1,
        calories,
        protein: parseFloat(document.getElementById('manualProtein').value) || 0,
        carbs: parseFloat(document.getElementById('manualCarbs').value) || 0,
        fat: parseFloat(document.getElementById('manualFat').value) || 0,
        mealType: currentMealType,
        timestamp: firebase.firestore.Timestamp.now(),
        source: 'manual'
    };
    
    await db.collection('users').doc(currentUser.uid)
        .collection('foodEntries').doc(entry.id)
        .set(entry);
    
    // Clear form
    document.getElementById('manualName').value = '';
    document.getElementById('manualCalories').value = '';
    document.getElementById('manualProtein').value = '';
    document.getElementById('manualCarbs').value = '';
    document.getElementById('manualFat').value = '';
    
    closeModal('addFoodModal');
}

// Nutrition Label Scanner
function showNutritionScanner() {
    document.getElementById('addOptions').style.display = 'none';
    document.getElementById('nutrition-scanner-view').style.display = 'block';
}

async function processNutritionImage(input) {
    if (!input.files || !input.files[0]) return;
    
    const file = input.files[0];
    const reader = new FileReader();
    
    reader.onload = async (e) => {
        const base64 = e.target.result.split(',')[1];
        
        // Show preview
        document.getElementById('nutritionImage').src = e.target.result;
        document.getElementById('nutritionPreview').style.display = 'block';
        document.getElementById('nutritionLoading').style.display = 'block';
        document.getElementById('nutritionResults').style.display = 'none';
        
        try {
            // Call Cloud Function
            const response = await fetch('/api/nutrition/scan-label', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64 })
            });
            
            if (!response.ok) throw new Error('Scan failed');
            
            const result = await response.json();
            showNutritionResults(result);
        } catch (error) {
            console.error('Nutrition scan failed:', error);
            document.getElementById('nutritionLoading').style.display = 'none';
            document.getElementById('nutritionResults').innerHTML = `
                <div style="color: var(--error); text-align: center;">
                    Failed to analyze image. Try again or use manual entry.
                </div>
            `;
            document.getElementById('nutritionResults').style.display = 'block';
        }
    };
    
    reader.readAsDataURL(file);
}

function showNutritionResults(result) {
    document.getElementById('nutritionLoading').style.display = 'none';
    
    const nutrition = result.nutrition || {};
    
    document.getElementById('nutritionResults').innerHTML = `
        <div class="card" style="padding: 1rem; margin-bottom: 1rem;">
            <h4 style="margin-bottom: 1rem; font-family: 'DM Sans', sans-serif;">Detected Nutrition</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                <div>Calories: <strong>${nutrition.calories || 0}</strong></div>
                <div>Protein: <strong>${nutrition.protein || 0}g</strong></div>
                <div>Carbs: <strong>${nutrition.carbs || 0}g</strong></div>
                <div>Fat: <strong>${nutrition.fat || 0}g</strong></div>
            </div>
        </div>
        <div class="form-group">
            <label class="form-label">Food Name</label>
            <input type="text" class="form-input" id="scannedFoodName" value="${result.foodName || 'Scanned Food'}">
        </div>
        <button class="btn btn-primary" style="width: 100%;" onclick="addScannedFood(${JSON.stringify(nutrition).replace(/"/g, '&quot;')})">Add to ${currentMealType}</button>
    `;
    document.getElementById('nutritionResults').style.display = 'block';
}

async function addScannedFood(nutrition) {
    const name = document.getElementById('scannedFoodName').value || 'Scanned Food';
    
    const entry = {
        id: `food_${Date.now()}`,
        name,
        servingSize: 100,
        servingUnit: 'g',
        numberOfServings: 1,
        calories: nutrition.calories || 0,
        protein: nutrition.protein || 0,
        carbs: nutrition.carbs || 0,
        fat: nutrition.fat || 0,
        mealType: currentMealType,
        timestamp: firebase.firestore.Timestamp.now(),
        source: 'scan'
    };
    
    await db.collection('users').doc(currentUser.uid)
        .collection('foodEntries').doc(entry.id)
        .set(entry);
    
    closeModal('addFoodModal');
}

// Delete Food
async function deleteFood(foodId) {
    if (!confirm('Delete this food entry?')) return;
    
    await db.collection('users').doc(currentUser.uid)
        .collection('foodEntries').doc(foodId)
        .delete();
}

// Exercise Functions
function openAddExercise() {
    // For now, show a simple prompt - can be expanded to a full modal later
    const name = prompt('Exercise name:');
    if (!name) return;
    
    const duration = parseInt(prompt('Duration (minutes):'));
    if (!duration) return;
    
    const calories = parseInt(prompt('Calories burned (estimate):')) || duration * 7;
    
    addExercise({
        name,
        duration,
        caloriesBurned: calories,
        category: 'other'
    });
}

async function addExercise(exerciseData) {
    const entry = {
        id: `exercise_${Date.now()}`,
        name: exerciseData.name,
        category: exerciseData.category || 'other',
        duration: exerciseData.duration,
        caloriesBurned: exerciseData.caloriesBurned,
        source: 'manual',
        timestamp: firebase.firestore.Timestamp.now()
    };
    
    await db.collection('users').doc(currentUser.uid)
        .collection('exerciseEntries').doc(entry.id)
        .set(entry);
}

async function deleteExercise(exerciseId) {
    if (!confirm('Delete this exercise?')) return;
    
    await db.collection('users').doc(currentUser.uid)
        .collection('exerciseEntries').doc(exerciseId)
        .delete();
}

// Sign Out
function signOut() {
    firebase.auth().signOut().then(() => {
        window.location.href = '/login.html';
    });
}


