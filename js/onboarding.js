// Onboarding flow functionality

let currentStep = 1;
const totalSteps = 4;

// Data collected during onboarding
const onboardingData = {
  personal: {
    fullName: "",
    age: 0,
    occupation: "",
    city: "",
    state: "",
    zipCode: "",
    address: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  lifestyle: {
    interests: [],
    lifeGoals: [],
    morningPerson: true,
    workStyle: "",
    sleepHours: 8,
  },
  financial: {
    salary: 0,
    netWorth: 0,
    currency: "USD",
    housingType: "rent", // rent or own
    rentAmount: 0,
    mortgageAmount: 0,
    spendingCategories: [],
    financialGoals: [],
    monthlyBudget: 0,
    savingsRate: 0,
  },
};

// Predefined options
const interestOptions = [
  "Fitness & Health",
  "Travel",
  "Reading",
  "Gaming",
  "Music",
  "Art & Design",
  "Technology",
  "Cooking",
  "Sports",
  "Photography",
  "Movies & TV",
  "Outdoors",
  "Fashion",
  "Investing",
  "Meditation",
  "Writing",
];

const lifeGoalOptions = [
  "Build wealth",
  "Improve health",
  "Learn new skills",
  "Travel more",
  "Start a business",
  "Better work-life balance",
  "Spend more time with family",
  "Achieve financial freedom",
  "Get promoted",
  "Buy a home",
  "Retire early",
  "Give back to community",
];

const spendingCategoryOptions = [
  "Housing",
  "Transportation",
  "Food & Dining",
  "Entertainment",
  "Shopping",
  "Healthcare",
  "Travel",
  "Education",
  "Subscriptions",
  "Savings & Investments",
  "Debt Payments",
  "Gifts & Donations",
];

const financialGoalOptions = [
  "Emergency fund",
  "Retirement savings",
  "Pay off debt",
  "Buy a home",
  "Invest more",
  "Start a business",
  "Build passive income",
  "Save for vacation",
  "Education fund",
  "Early retirement",
];

const workStyleOptions = [
  { value: "remote", label: "Remote / Work from home" },
  { value: "office", label: "Office / In-person" },
  { value: "hybrid", label: "Hybrid" },
  { value: "freelance", label: "Freelance / Self-employed" },
  { value: "student", label: "Student" },
  { value: "retired", label: "Retired" },
];

const currencyOptions = [
  { value: "USD", label: "USD ($)", symbol: "$" },
  { value: "EUR", label: "EUR (€)", symbol: "€" },
  { value: "GBP", label: "GBP (£)", symbol: "£" },
  { value: "CAD", label: "CAD (C$)", symbol: "C$" },
  { value: "AUD", label: "AUD (A$)", symbol: "A$" },
  { value: "INR", label: "INR (₹)", symbol: "₹" },
  { value: "JPY", label: "JPY (¥)", symbol: "¥" },
];

const usStates = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

document.addEventListener("DOMContentLoaded", () => {
  // Load from localStorage if available
  const savedProfile = localStorage.getItem("zeitline_profile");
  if (savedProfile) {
    try {
      const profile = JSON.parse(savedProfile);
      Object.assign(onboardingData, profile);
    } catch (e) {
      console.log("Could not parse saved profile");
    }
  }
  
  // Check if Firebase is available and configured
  if (typeof firebase === "undefined" || typeof auth === "undefined") {
    console.log("Firebase not available - running in demo mode");
    initializeOnboarding();
    return;
  }
  
  // Set a timeout to init anyway if auth takes too long
  const authTimeout = setTimeout(() => {
    console.log("Auth timeout - initializing anyway");
    initializeOnboarding();
  }, 2000);
  
  // Check auth state
  window.addEventListener("authStateChanged", async (e) => {
    clearTimeout(authTimeout);
    const user = e.detail;
    if (!user) {
      // In demo mode, just continue without auth
      console.log("No user logged in - continuing in demo mode");
      initializeOnboarding();
      return;
    }

    // Load existing profile data
    try {
      const response = await apiCall("/users/profile");
      if (response.data) {
        const profile = response.data;

        // Check if already completed
        if (profile.onboardingComplete) {
          window.location.href = "/dashboard.html";
          return;
        }

        // Pre-fill data
        if (profile.personal) {
          Object.assign(onboardingData.personal, profile.personal);
        }
        if (profile.lifestyle) {
          Object.assign(onboardingData.lifestyle, profile.lifestyle);
        }
        if (profile.financial) {
          Object.assign(onboardingData.financial, profile.financial);
        }

        // Resume from last step
        currentStep = profile.onboardingStep || 1;
      }
    } catch (error) {
      console.log("No existing profile, starting fresh");
    }

    initializeOnboarding();
  });
});

function initializeOnboarding() {
  renderStep(currentStep);
  updateProgress();
  
  // Set up browser back button handling
  setupBrowserBackButton();
}

// Handle browser back button to go to dashboard
function setupBrowserBackButton() {
  // Push initial state so we can detect back button
  history.pushState({ step: currentStep, onboarding: true }, '', window.location.href);
  
  window.addEventListener('popstate', (event) => {
    // User pressed browser back button - go to dashboard
    goToDashboard();
  });
}

// Navigate to dashboard (skip/finish later)
function goToDashboard() {
  // Save current progress before leaving
  saveOnboardingProgress();
  
  // Redirect to dashboard
  window.location.href = '/dashboard.html';
}

// Save current onboarding progress to localStorage
function saveOnboardingProgress() {
  localStorage.setItem('zeitline_profile', JSON.stringify(onboardingData));
  localStorage.setItem('zeitline_onboarding_step', currentStep.toString());
  // Don't mark as complete - user is leaving early
}

function updateProgress() {
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");

  if (progressBar) {
    const percent = ((currentStep - 1) / (totalSteps - 1)) * 100;
    progressBar.style.width = `${percent}%`;
  }

  if (progressText) {
    progressText.textContent = `Step ${currentStep} of ${totalSteps}`;
  }

  // Update step indicators
  document.querySelectorAll(".step-indicator").forEach((el, i) => {
    el.classList.remove("active", "completed");
    if (i + 1 < currentStep) {
      el.classList.add("completed");
    } else if (i + 1 === currentStep) {
      el.classList.add("active");
    }
  });
}

function renderStep(step) {
  const container = document.getElementById("onboardingContent");
  if (!container) return;

  switch (step) {
    case 1:
      container.innerHTML = renderPersonalInfoStep();
      // Try to get location
      detectLocation();
      break;
    case 2:
      container.innerHTML = renderLifestyleStep();
      initializeMultiSelect("interests", interestOptions, onboardingData.lifestyle.interests);
      initializeMultiSelect("lifeGoals", lifeGoalOptions, onboardingData.lifestyle.lifeGoals);
      break;
    case 3:
      container.innerHTML = renderFinancialStep();
      initializeMultiSelect("spendingCategories", spendingCategoryOptions, onboardingData.financial.spendingCategories);
      initializeMultiSelect("financialGoals", financialGoalOptions, onboardingData.financial.financialGoals);
      updateHousingFields();
      break;
    case 4:
      container.innerHTML = renderReviewStep();
      break;
  }

  updateProgress();
  setupFormListeners();
}

// Detect user's location using Geolocation API
async function detectLocation() {
  const locationStatus = document.getElementById("locationStatus");
  
  if (!navigator.geolocation) {
    if (locationStatus) locationStatus.textContent = "Geolocation not supported";
    return;
  }

  if (locationStatus) {
    locationStatus.innerHTML = '<span class="detecting">📍 Detecting your location...</span>';
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        // Use reverse geocoding API
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`
        );
        const data = await response.json();
        
        if (data.address) {
          const city = data.address.city || data.address.town || data.address.village || "";
          const state = data.address.state || "";
          const zipCode = data.address.postcode || "";
          
          // Update form fields
          const cityInput = document.querySelector('input[name="city"]');
          const stateSelect = document.querySelector('select[name="state"]');
          const zipInput = document.querySelector('input[name="zipCode"]');
          
          if (cityInput && city) {
            cityInput.value = city;
            onboardingData.personal.city = city;
          }
          if (stateSelect && state) {
            // Try to match state abbreviation
            const stateAbbr = getStateAbbreviation(state);
            if (stateAbbr) {
              stateSelect.value = stateAbbr;
              onboardingData.personal.state = stateAbbr;
            }
          }
          if (zipInput && zipCode) {
            zipInput.value = zipCode;
            onboardingData.personal.zipCode = zipCode;
          }
          
          if (locationStatus) {
            locationStatus.innerHTML = `<span class="detected">✓ Location detected: ${city}, ${state}</span>`;
          }
        }
      } catch (error) {
        console.error("Error getting location details:", error);
        if (locationStatus) {
          locationStatus.innerHTML = '<span class="error">Could not detect location. Please enter manually.</span>';
        }
      }
    },
    (error) => {
      console.log("Geolocation error:", error.message);
      if (locationStatus) {
        locationStatus.innerHTML = '<span class="manual">Please enter your location manually.</span>';
      }
    },
    { timeout: 10000 }
  );
}

function getStateAbbreviation(stateName) {
  const stateMap = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
    "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
    "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
    "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
    "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
  };
  return stateMap[stateName] || usStates.find(s => stateName.includes(s)) || "";
}

function renderPersonalInfoStep() {
  return `
    <div class="step-content">
      <div class="step-header">
        <h2>Let's get to know you</h2>
        <p>Tell us a bit about yourself so we can personalize your experience.</p>
      </div>
      
      <form id="personalForm" class="onboarding-form">
        <div class="form-group">
          <label class="form-label">Full Name</label>
          <input 
            type="text" 
            name="fullName" 
            class="form-input" 
            placeholder="John Doe"
            value="${onboardingData.personal.fullName}"
            required
          >
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Age</label>
            <input 
              type="number" 
              name="age" 
              class="form-input" 
              placeholder="25"
              min="13"
              max="120"
              value="${onboardingData.personal.age || ""}"
              required
            >
          </div>
          
          <div class="form-group">
            <label class="form-label">Occupation</label>
            <input 
              type="text" 
              name="occupation" 
              class="form-input" 
              placeholder="Software Engineer"
              value="${onboardingData.personal.occupation}"
            >
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Home Address</label>
          <input 
            type="text" 
            name="address" 
            class="form-input" 
            placeholder="123 Main Street, Apt 4B"
            value="${onboardingData.personal.address || ""}"
          >
          <p class="form-hint">Street address (optional, for personalized insights)</p>
        </div>
        
        <div class="form-group">
          <div id="locationStatus" style="margin-bottom: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);"></div>
        </div>
        
        <div class="form-row" style="grid-template-columns: 2fr 1fr 1fr;">
          <div class="form-group">
            <label class="form-label">City</label>
            <input 
              type="text" 
              name="city" 
              class="form-input" 
              placeholder="Los Angeles"
              value="${onboardingData.personal.city || ""}"
              required
            >
          </div>
          
          <div class="form-group">
            <label class="form-label">State</label>
            <select name="state" class="form-input" required>
              <option value="">State</option>
              ${usStates.map(s => `<option value="${s}" ${onboardingData.personal.state === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">ZIP Code</label>
            <input 
              type="text" 
              name="zipCode" 
              class="form-input" 
              placeholder="90001"
              pattern="[0-9]{5}"
              value="${onboardingData.personal.zipCode || ""}"
              required
            >
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Timezone</label>
          <select name="timezone" class="form-input">
            ${getTimezoneOptions()}
          </select>
        </div>
        
        <div class="form-actions">
          <div></div>
          <button type="submit" class="btn btn-primary btn-next">
            Continue
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderLifestyleStep() {
  return `
    <div class="step-content">
      <div class="step-header">
        <h2>Your lifestyle</h2>
        <p>Help us understand your daily habits and what matters to you.</p>
      </div>
      
      <form id="lifestyleForm" class="onboarding-form">
        <div class="form-group">
          <label class="form-label">What are your interests?</label>
          <p class="form-hint">Select all that apply</p>
          <div id="interests" class="multi-select-container"></div>
        </div>
        
        <div class="form-group">
          <label class="form-label">What are your life goals?</label>
          <p class="form-hint">Select your top priorities</p>
          <div id="lifeGoals" class="multi-select-container"></div>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Are you a morning person?</label>
            <div class="toggle-group">
              <button type="button" class="toggle-btn ${onboardingData.lifestyle.morningPerson ? "active" : ""}" data-value="true" onclick="setToggle('morningPerson', true, this)">
                ☀️ Yes, early bird
              </button>
              <button type="button" class="toggle-btn ${!onboardingData.lifestyle.morningPerson ? "active" : ""}" data-value="false" onclick="setToggle('morningPerson', false, this)">
                🌙 No, night owl
              </button>
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Average sleep hours</label>
            <input 
              type="number" 
              name="sleepHours" 
              class="form-input" 
              placeholder="8"
              min="4"
              max="12"
              step="0.5"
              value="${onboardingData.lifestyle.sleepHours}"
            >
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Work style</label>
          <select name="workStyle" class="form-input">
            <option value="">Select your work style</option>
            ${workStyleOptions.map((opt) => `<option value="${opt.value}" ${onboardingData.lifestyle.workStyle === opt.value ? "selected" : ""}>${opt.label}</option>`).join("")}
          </select>
        </div>
        
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="prevStep()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <button type="submit" class="btn btn-primary btn-next">
            Continue
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderFinancialStep() {
  const selectedCurrency = currencyOptions.find((c) => c.value === onboardingData.financial.currency) || currencyOptions[0];

  return `
    <div class="step-content">
      <div class="step-header">
        <h2>Financial profile</h2>
        <p>This information helps us provide better predictions and insights. All data is encrypted and private.</p>
      </div>
      
      <form id="financialForm" class="onboarding-form">
        <div class="form-group">
          <label class="form-label">Currency</label>
          <select name="currency" class="form-input" onchange="updateCurrencySymbols(this.value)">
            ${currencyOptions.map((opt) => `<option value="${opt.value}" ${onboardingData.financial.currency === opt.value ? "selected" : ""}>${opt.label}</option>`).join("")}
          </select>
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Annual Salary</label>
            <div class="input-with-prefix">
              <span class="input-prefix" id="salaryPrefix">${selectedCurrency.symbol}</span>
              <input 
                type="number" 
                name="salary" 
                class="form-input" 
                placeholder="75000"
                min="0"
                step="1000"
                value="${onboardingData.financial.salary || ""}"
                onchange="calculateMonthlyBudget()"
              >
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">Net Worth</label>
            <div class="input-with-prefix">
              <span class="input-prefix" id="netWorthPrefix">${selectedCurrency.symbol}</span>
              <input 
                type="number" 
                name="netWorth" 
                class="form-input" 
                placeholder="100000"
                step="1000"
                value="${onboardingData.financial.netWorth || ""}"
              >
            </div>
            <p class="form-hint">Can be negative if you have more debt than assets</p>
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Do you rent or own your home?</label>
          <div class="toggle-group">
            <button type="button" class="toggle-btn ${onboardingData.financial.housingType === "rent" ? "active" : ""}" onclick="setHousingType('rent', this)">
              🏠 Rent
            </button>
            <button type="button" class="toggle-btn ${onboardingData.financial.housingType === "own" ? "active" : ""}" onclick="setHousingType('own', this)">
              🏡 Own
            </button>
          </div>
        </div>
        
        <div id="housingCostField" class="form-group">
          <!-- Will be populated by updateHousingFields() -->
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Savings Rate</label>
            <div class="input-with-suffix">
              <input 
                type="number" 
                name="savingsRate" 
                class="form-input" 
                placeholder="20"
                min="0"
                max="100"
                value="${onboardingData.financial.savingsRate || ""}"
                onchange="calculateMonthlyBudget()"
              >
              <span class="input-suffix">%</span>
            </div>
            <p class="form-hint">Percentage of income you save</p>
          </div>
          
          <div class="form-group">
            <label class="form-label">Monthly Budget</label>
            <div class="input-with-prefix">
              <span class="input-prefix" id="budgetPrefix">${selectedCurrency.symbol}</span>
              <input 
                type="number" 
                name="monthlyBudget" 
                class="form-input" 
                placeholder="Auto-calculated"
                min="0"
                step="100"
                value="${onboardingData.financial.monthlyBudget || ""}"
                id="monthlyBudgetInput"
              >
            </div>
            <p class="form-hint" id="budgetHint">We'll calculate this based on your income and savings</p>
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Top spending categories</label>
          <p class="form-hint">Where does most of your money go?</p>
          <div id="spendingCategories" class="multi-select-container"></div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Financial goals</label>
          <p class="form-hint">What are you working towards?</p>
          <div id="financialGoals" class="multi-select-container"></div>
        </div>
        
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="prevStep()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
          <button type="submit" class="btn btn-primary btn-next">
            Continue
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  `;
}

function updateHousingFields() {
  const container = document.getElementById("housingCostField");
  if (!container) return;

  const currency = currencyOptions.find((c) => c.value === onboardingData.financial.currency) || currencyOptions[0];
  const isRent = onboardingData.financial.housingType === "rent";

  container.innerHTML = `
    <label class="form-label">${isRent ? "Monthly Rent" : "Monthly Mortgage Payment"}</label>
    <div class="input-with-prefix">
      <span class="input-prefix">${currency.symbol}</span>
      <input 
        type="number" 
        name="${isRent ? "rentAmount" : "mortgageAmount"}" 
        class="form-input" 
        placeholder="${isRent ? "2000" : "2500"}"
        min="0"
        step="50"
        value="${isRent ? (onboardingData.financial.rentAmount || "") : (onboardingData.financial.mortgageAmount || "")}"
        onchange="calculateMonthlyBudget()"
      >
    </div>
    <p class="form-hint">${isRent ? "Your monthly rent payment" : "Your monthly mortgage payment (principal + interest)"}</p>
  `;
}

function setHousingType(type, button) {
  onboardingData.financial.housingType = type;
  
  // Update UI
  const group = button.parentElement;
  group.querySelectorAll(".toggle-btn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");
  
  updateHousingFields();
  calculateMonthlyBudget();
}

function calculateMonthlyBudget() {
  const salary = parseFloat(document.querySelector('input[name="salary"]')?.value) || 0;
  const savingsRate = parseFloat(document.querySelector('input[name="savingsRate"]')?.value) || 0;
  
  if (salary > 0) {
    const monthlyIncome = salary / 12;
    const savingsAmount = monthlyIncome * (savingsRate / 100);
    const monthlyBudget = Math.round(monthlyIncome - savingsAmount);
    
    const budgetInput = document.getElementById("monthlyBudgetInput");
    const budgetHint = document.getElementById("budgetHint");
    
    if (budgetInput) {
      budgetInput.value = monthlyBudget;
      onboardingData.financial.monthlyBudget = monthlyBudget;
    }
    if (budgetHint) {
      budgetHint.textContent = `Based on $${monthlyIncome.toLocaleString()}/mo income - ${savingsRate}% savings`;
    }
  }
}

function renderReviewStep() {
  const currency = currencyOptions.find((c) => c.value === onboardingData.financial.currency) || currencyOptions[0];
  const isRent = onboardingData.financial.housingType === "rent";
  const housingCost = isRent ? onboardingData.financial.rentAmount : onboardingData.financial.mortgageAmount;

  return `
    <div class="step-content">
      <div class="step-header">
        <h2>Review your profile</h2>
        <p>Make sure everything looks correct before we finish setting up your account.</p>
      </div>
      
      <div class="review-sections">
        <div class="review-section">
          <h3>👤 Personal Information</h3>
          <div class="review-grid">
            <div class="review-item">
              <span class="review-label">Name</span>
              <span class="review-value">${onboardingData.personal.fullName}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Age</span>
              <span class="review-value">${onboardingData.personal.age}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Occupation</span>
              <span class="review-value">${onboardingData.personal.occupation || "Not specified"}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Location</span>
              <span class="review-value">${onboardingData.personal.city}, ${onboardingData.personal.state} ${onboardingData.personal.zipCode}</span>
            </div>
            ${onboardingData.personal.address ? `
            <div class="review-item full-width">
              <span class="review-label">Address</span>
              <span class="review-value">${onboardingData.personal.address}</span>
            </div>
            ` : ""}
          </div>
        </div>
        
        <div class="review-section">
          <h3>🎯 Lifestyle</h3>
          <div class="review-grid">
            <div class="review-item full-width">
              <span class="review-label">Interests</span>
              <span class="review-value">${onboardingData.lifestyle.interests.join(", ") || "None selected"}</span>
            </div>
            <div class="review-item full-width">
              <span class="review-label">Life Goals</span>
              <span class="review-value">${onboardingData.lifestyle.lifeGoals.join(", ") || "None selected"}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Schedule</span>
              <span class="review-value">${onboardingData.lifestyle.morningPerson ? "Morning person" : "Night owl"}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Work Style</span>
              <span class="review-value">${workStyleOptions.find((w) => w.value === onboardingData.lifestyle.workStyle)?.label || "Not specified"}</span>
            </div>
          </div>
        </div>
        
        <div class="review-section">
          <h3>💰 Financial Profile</h3>
          <div class="review-grid">
            <div class="review-item">
              <span class="review-label">Annual Salary</span>
              <span class="review-value">${currency.symbol}${onboardingData.financial.salary.toLocaleString()}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Net Worth</span>
              <span class="review-value">${currency.symbol}${onboardingData.financial.netWorth.toLocaleString()}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Housing</span>
              <span class="review-value">${isRent ? "Renting" : "Homeowner"} - ${currency.symbol}${(housingCost || 0).toLocaleString()}/mo</span>
            </div>
            <div class="review-item">
              <span class="review-label">Monthly Budget</span>
              <span class="review-value">${currency.symbol}${(onboardingData.financial.monthlyBudget || 0).toLocaleString()}</span>
            </div>
            <div class="review-item">
              <span class="review-label">Savings Rate</span>
              <span class="review-value">${onboardingData.financial.savingsRate || 0}%</span>
            </div>
            <div class="review-item full-width">
              <span class="review-label">Financial Goals</span>
              <span class="review-value">${onboardingData.financial.financialGoals.join(", ") || "None selected"}</span>
            </div>
          </div>
        </div>
      </div>
      
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="prevStep()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        <button type="button" class="btn btn-primary" onclick="completeOnboarding()">
          Complete Setup
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 13l4 4L19 7"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function setupFormListeners() {
  const forms = ["personalForm", "lifestyleForm", "financialForm"];

  forms.forEach((formId) => {
    const form = document.getElementById(formId);
    if (form) {
      form.addEventListener("submit", handleFormSubmit);
    }
  });
}

async function handleFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData);

  // Save data based on current step
  switch (currentStep) {
    case 1:
      Object.assign(onboardingData.personal, {
        fullName: data.fullName,
        age: parseInt(data.age),
        occupation: data.occupation,
        address: data.address,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        timezone: data.timezone,
      });
      break;
    case 2:
      Object.assign(onboardingData.lifestyle, {
        sleepHours: parseFloat(data.sleepHours) || 8,
        workStyle: data.workStyle,
      });
      break;
    case 3:
      const isRent = onboardingData.financial.housingType === "rent";
      Object.assign(onboardingData.financial, {
        salary: parseFloat(data.salary) || 0,
        netWorth: parseFloat(data.netWorth) || 0,
        currency: data.currency,
        rentAmount: isRent ? parseFloat(data.rentAmount) || 0 : 0,
        mortgageAmount: !isRent ? parseFloat(data.mortgageAmount) || 0 : 0,
        monthlyBudget: parseFloat(data.monthlyBudget) || 0,
        savingsRate: parseFloat(data.savingsRate) || 0,
      });
      break;
  }

  nextStep();
}

async function completeOnboarding() {
  showLoading("Setting up your account...");

  try {
    // Mark onboarding as complete
    onboardingData.onboardingComplete = true;
    
    // Save all data to localStorage as backup (works without backend)
    localStorage.setItem("zeitline_profile", JSON.stringify(onboardingData));
    localStorage.setItem("zeitline_onboarding_complete", "true");
    
    // Try to save to backend if available
    try {
      await apiCall("/users/onboarding/personal", {
        method: "POST",
        body: JSON.stringify(onboardingData.personal),
      });
      
      await apiCall("/users/onboarding/lifestyle", {
        method: "POST",
        body: JSON.stringify(onboardingData.lifestyle),
      });
      
      await apiCall("/users/onboarding/financial", {
        method: "POST",
        body: JSON.stringify(onboardingData.financial),
      });
    } catch (apiError) {
      console.log("Backend not available, data saved locally:", apiError);
    }

    hideLoading();

    // Show success and redirect
    showSuccess("Welcome to Zeitline! Redirecting to your dashboard...");
    setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 1500);
  } catch (error) {
    hideLoading();
    console.error("Error completing onboarding:", error);
    
    // Still redirect even if backend fails - data is in localStorage
    localStorage.setItem("zeitline_onboarding_complete", "true");
    showSuccess("Setup complete! Redirecting...");
    setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 1500);
  }
}

function nextStep() {
  if (currentStep < totalSteps) {
    currentStep++;
    renderStep(currentStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function prevStep() {
  if (currentStep > 1) {
    currentStep--;
    renderStep(currentStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    // On step 1, go to dashboard
    goToDashboard();
  }
}

// Multi-select functionality
function initializeMultiSelect(containerId, options, selectedValues = []) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = options
    .map(
      (option) => `
    <button 
      type="button" 
      class="multi-select-option ${selectedValues.includes(option) ? "selected" : ""}"
      data-value="${option}"
      onclick="toggleMultiSelect('${containerId}', '${option}', this)"
    >
      ${option}
    </button>
  `
    )
    .join("");
}

function toggleMultiSelect(containerId, value, button) {
  button.classList.toggle("selected");

  // Update data based on container
  let dataArray;
  switch (containerId) {
    case "interests":
      dataArray = onboardingData.lifestyle.interests;
      break;
    case "lifeGoals":
      dataArray = onboardingData.lifestyle.lifeGoals;
      break;
    case "spendingCategories":
      dataArray = onboardingData.financial.spendingCategories;
      break;
    case "financialGoals":
      dataArray = onboardingData.financial.financialGoals;
      break;
    default:
      return;
  }

  const index = dataArray.indexOf(value);
  if (index > -1) {
    dataArray.splice(index, 1);
  } else {
    dataArray.push(value);
  }
}

function setToggle(field, value, button) {
  // Update UI
  const group = button.parentElement;
  group.querySelectorAll(".toggle-btn").forEach((btn) => btn.classList.remove("active"));
  button.classList.add("active");

  // Update data
  onboardingData.lifestyle[field] = value;
}

function updateCurrencySymbols(currencyCode) {
  const currency = currencyOptions.find((c) => c.value === currencyCode);
  if (!currency) return;

  onboardingData.financial.currency = currencyCode;

  const prefixes = ["salaryPrefix", "netWorthPrefix", "budgetPrefix"];
  prefixes.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = currency.symbol;
  });
  
  updateHousingFields();
}

function getTimezoneOptions() {
  const timezones = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Toronto",
    "America/Vancouver",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];

  const currentTz = onboardingData.personal.timezone;

  return timezones
    .map((tz) => `<option value="${tz}" ${currentTz === tz ? "selected" : ""}>${tz.replace(/_/g, " ")}</option>`)
    .join("");
}

// UI helpers
function showError(message) {
  const existing = document.querySelector(".error-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "error-toast";
  toast.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()">×</button>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function showSuccess(message) {
  const existing = document.querySelector(".success-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "success-toast";
  toast.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()">×</button>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function showLoading(message = "Loading...") {
  const existing = document.querySelector(".loading-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "loading-overlay";
  overlay.innerHTML = `<div class="loading-spinner"></div><p>${message}</p>`;
  document.body.appendChild(overlay);
}

function hideLoading() {
  const overlay = document.querySelector(".loading-overlay");
  if (overlay) overlay.remove();
}
