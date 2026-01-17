// Firebase Configuration for Zeitline
const firebaseConfig = {
  apiKey: "AIzaSyCh1_h1BRyDR7xyGeokxTXJ5ie_q_w7778",
  authDomain: "zeitlineai.firebaseapp.com",
  projectId: "zeitlineai",
  storageBucket: "zeitlineai.firebasestorage.app",
  messagingSenderId: "78709689112",
  appId: "1:78709689112:web:eeb08e745cdd9c6880ac6d"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();

// Set persistence to LOCAL - keeps user logged in across browser sessions and tabs
// User stays signed in until they explicitly log out
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .then(() => {
    console.log("Auth persistence set to LOCAL");
  })
  .catch((error) => {
    console.error("Error setting persistence:", error);
  });

// API base URL - change for production
const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:9000/zeitlineai/us-central1/api"
    : "https://us-central1-zeitlineai.cloudfunctions.net/api";

// Auth state observer
let currentUser = null;
let authInitialized = false; // Track if auth has been checked to prevent false "signed out" on page load

auth.onAuthStateChanged(async (user) => {
  const wasInitialized = authInitialized;
  authInitialized = true;
  currentUser = user;
  
  if (user) {
    console.log("User signed in:", user.email);
    // Store token for API calls
    const token = await user.getIdToken();
    localStorage.setItem("authToken", token);
    
    // Fetch profile from API to sync onboarding status
    try {
      const response = await fetch(`${API_BASE_URL}/users/profile`, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.data) {
          const profile = data.data;
          
          // Save profile to localStorage
          localStorage.setItem("zeitline_profile", JSON.stringify(profile));
          
          // Sync onboarding status
          if (profile.onboardingComplete || 
              (profile.personal && profile.personal.fullName && profile.personal.age)) {
            localStorage.setItem("zeitline_onboarding_complete", "true");
          }
          
          console.log("Profile synced from server, onboarding complete:", 
            profile.onboardingComplete || false);
        }
      }
    } catch (e) {
      console.log("Could not fetch profile from API:", e.message);
    }
  } else {
    // Only log "signed out" if auth was already initialized (actual sign out, not initial check)
    if (wasInitialized) {
      console.log("User signed out");
      localStorage.removeItem("authToken");
    } else {
      // First check returned null - user might not be signed in, or Firebase is still loading
      console.log("Auth initialized - no user session found");
      // Don't remove token immediately - let the next check confirm
    }
  }

  // Dispatch custom event for page-specific handling
  window.dispatchEvent(new CustomEvent("authStateChanged", { detail: user }));
});

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
  // Try to get a fresh token from Firebase first, fall back to localStorage
  let token = null;
  const user = firebase.auth().currentUser;
  if (user) {
    try {
      token = await user.getIdToken(true); // Force refresh
      localStorage.setItem("authToken", token); // Update stored token
    } catch (tokenError) {
      console.warn("Could not refresh token, using stored token:", tokenError);
      token = localStorage.getItem("authToken");
    }
  } else {
    token = localStorage.getItem("authToken");
  }

  const headers = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  // Handle non-JSON responses gracefully
  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    console.error("Failed to parse API response:", parseError);
    throw new Error("Failed to fetch - server returned invalid response");
  }

  if (!response.ok) {
    throw new Error(data.error || "API request failed");
  }

  return data;
}

// Auth helper functions
async function signUpWithEmail(email, password) {
  const userCredential = await auth.createUserWithEmailAndPassword(
    email,
    password
  );
  return userCredential.user;
}

async function signInWithEmail(email, password) {
  const userCredential = await auth.signInWithEmailAndPassword(email, password);
  return userCredential.user;
}

async function signInWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  // Force account selection - this ensures users can choose a different account
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  const userCredential = await auth.signInWithPopup(provider);
  return userCredential.user;
}

async function signInWithApple() {
  const provider = new firebase.auth.OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  const userCredential = await auth.signInWithPopup(provider);
  return userCredential.user;
}

async function signOut() {
  try {
    // Set flag to allow staying on login page after logout
    sessionStorage.setItem('stayOnLoginPage', 'true');
    
    // Check if using test account before clearing
    const authToken = localStorage.getItem("authToken");
    const isTestAccount = authToken === "test-token-12345";
    
    // Sign out from Firebase
    await auth.signOut();
    
    // Clear auth token
    localStorage.removeItem("authToken");
    
    // Clear test account data if it exists
    if (isTestAccount) {
      localStorage.removeItem("zeitline_profile");
      localStorage.removeItem("zeitline_onboarding_complete");
    }
    
    // Clear any cached Google account selection
    // Keep the stayOnLoginPage flag for a moment
    const stayFlag = sessionStorage.getItem('stayOnLoginPage');
    sessionStorage.clear();
    if (stayFlag) {
      sessionStorage.setItem('stayOnLoginPage', 'true');
    }
    
    // Small delay to ensure auth state is cleared before redirect
    setTimeout(() => {
      // Redirect to login page with force parameter to prevent auto-login
      window.location.href = "/login.html?switch=true";
    }, 100);
  } catch (error) {
    console.error("Error signing out:", error);
    // Still redirect even if there's an error
    localStorage.removeItem("authToken");
    localStorage.removeItem("zeitline_profile");
    localStorage.removeItem("zeitline_onboarding_complete");
    sessionStorage.setItem('stayOnLoginPage', 'true');
    window.location.href = "/login.html?switch=true";
  }
}

async function resetPassword(email) {
  await auth.sendPasswordResetEmail(email);
}

// Get current auth token (refreshes if needed)
async function getAuthToken() {
  if (currentUser) {
    const token = await currentUser.getIdToken(true);
    localStorage.setItem("authToken", token);
    return token;
  }
  return null;
}
