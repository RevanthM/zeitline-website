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

// Connect to emulators when running on localhost
// NOTE: Auth emulator doesn't support OAuth providers (Google, Apple)
// So we only connect Firestore to emulator, but use production Auth for OAuth
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
  console.log("Configuring Firebase for local development...");
  
  // Only connect Firestore to emulator (Auth emulator doesn't support OAuth)
  try {
    db.useEmulator("localhost", 8080);
    console.log("✓ Connected to Firestore emulator at localhost:8080");
  } catch (error) {
    // Emulators already connected, that's fine
    if (error.message && !error.message.includes("already been initialized") && !error.message.includes("Cannot call useEmulator")) {
      console.warn("Error connecting Firestore to emulator:", error);
    }
  }
  
  // For Auth: Use production Auth (not emulator) so OAuth providers work
  // The backend will still work because it can verify tokens from production Auth
  console.log("ℹ️ Using production Firebase Auth (emulator doesn't support OAuth providers)");
}

// Set persistence to LOCAL - keeps user logged in even after browser closes
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
    : "/api";

// Auth state observer
let currentUser = null;
let authStateReady = false;
let authStateResolvers = [];

// Make currentUser globally accessible
window.currentUser = null;
window.authStateReady = false; // Make authStateReady globally accessible for debugging

// Function to wait for auth state to be determined
window.waitForAuthState = function() {
  return new Promise((resolve) => {
    if (authStateReady) {
      resolve(currentUser);
    } else {
      authStateResolvers.push(resolve);
    }
  });
};

auth.onAuthStateChanged((user) => {
  console.log("🔐 Auth state changed:", user ? `User: ${user.email}` : "No user");
  currentUser = user;
  window.currentUser = user; // Make it globally accessible
  authStateReady = true;
  window.authStateReady = true; // Make it globally accessible for debugging
  
  // Resolve all waiting promises
  authStateResolvers.forEach(resolve => resolve(user));
  authStateResolvers = [];
  
  if (user) {
    console.log("✅ User signed in:", user.email, "UID:", user.uid);
    // Store token for API calls
    user.getIdToken().then((token) => {
      localStorage.setItem("authToken", token);
      console.log("✅ Auth token stored");
    }).catch((error) => {
      console.error("❌ Error getting token:", error);
    });
  } else {
    console.log("⚠️ User signed out - checking if user still exists...");
    // Double-check: sometimes the observer fires before auth is fully ready
    setTimeout(() => {
      const directCheck = auth.currentUser;
      if (directCheck) {
        console.log("✅ Found user via direct check after observer said signed out:", directCheck.email);
        currentUser = directCheck;
        window.currentUser = directCheck;
        directCheck.getIdToken().then((token) => {
          localStorage.setItem("authToken", token);
          console.log("✅ Auth token stored from direct check");
        });
      } else {
        console.log("❌ Confirmed: No user logged in");
        localStorage.removeItem("authToken");
      }
    }, 1000);
  }

  // Dispatch custom event for page-specific handling
  window.dispatchEvent(new CustomEvent("authStateChanged", { detail: user }));
});

// Also check auth state immediately after a short delay (in case observer hasn't fired)
setTimeout(() => {
  const immediateCheck = auth.currentUser;
  if (immediateCheck && !currentUser) {
    console.log("✅ Found user via immediate check:", immediateCheck.email);
    currentUser = immediateCheck;
    window.currentUser = immediateCheck;
    authStateReady = true;
    window.authStateReady = true;
    immediateCheck.getIdToken().then((token) => {
      localStorage.setItem("authToken", token);
      console.log("✅ Auth token stored from immediate check");
    });
  }
}, 2000);

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
  // Get fresh token (refreshes if expired)
  let token = localStorage.getItem("authToken");
  
  // Always check auth.currentUser directly as a fallback
  const auth = firebase.auth();
  const directUser = auth.currentUser;
  
  // Use directUser if currentUser is null
  const userToUse = currentUser || directUser;
  
  if (userToUse) {
    // Update currentUser if we found it via direct check
    if (!currentUser && directUser) {
      console.log("⚠️ currentUser was null, using direct auth.currentUser:", directUser.email);
      currentUser = directUser;
      window.currentUser = directUser;
    }
    
    // If we have a current user, get a fresh token
    if (currentUser) {
      try {
        token = await currentUser.getIdToken(true); // Force refresh
        if (!token || typeof token !== 'string' || token.length < 100) {
          console.error("❌ Invalid token received:", { hasToken: !!token, type: typeof token, length: token ? token.length : 0 });
          throw new Error("Invalid token format");
        }
        localStorage.setItem("authToken", token);
        console.log("✅ Got fresh token for API call, length:", token.length);
      } catch (error) {
        console.error("Error getting auth token:", error);
        // If token refresh fails, user needs to sign in again
        if (error.code === "auth/user-token-expired" || error.code === "auth/user-disabled") {
          localStorage.removeItem("authToken");
          throw new Error("Please sign in again");
        }
      }
    } else {
      // Try to get current user directly if currentUser variable is null
      const authCheck = firebase.auth();
      const directUserCheck = authCheck.currentUser;
      if (directUserCheck) {
        console.log("⚠️ currentUser was null but auth.currentUser exists, using it");
        try {
          token = await directUserCheck.getIdToken(true);
          if (!token || typeof token !== 'string' || token.length < 100) {
            console.error("❌ Invalid token received from direct user");
            throw new Error("Invalid token format");
          }
          localStorage.setItem("authToken", token);
          currentUser = directUserCheck; // Update the variable
          window.currentUser = directUserCheck;
          console.log("✅ Got token from direct auth.currentUser, length:", token.length);
        } catch (error) {
          console.error("Error getting token from direct user:", error);
        }
      } else {
        console.warn("⚠️ No user found for API call - user needs to sign in");
      }
    }
  }

  // Validate token before sending
  if (!token || typeof token !== 'string' || token.trim().length < 100) {
    console.error("❌ Invalid token format before sending:", { 
      hasToken: !!token, 
      type: typeof token, 
      length: token ? token.length : 0
    });
    localStorage.removeItem("authToken");
    throw new Error("Invalid authentication token. Please sign in again.");
  }

  // Ensure token is properly trimmed and formatted
  token = token.trim();
  
  // Validate JWT format (should have 3 parts separated by dots)
  const tokenParts = token.split('.');
  if (tokenParts.length !== 3) {
    console.error("❌ Token is not a valid JWT format (should have 3 parts):", tokenParts.length);
    localStorage.removeItem("authToken");
    throw new Error("Invalid token format. Please sign in again.");
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  console.log(`Making API call to: ${API_BASE_URL}${endpoint}`);
  console.log('Token info:', { 
    length: token.length, 
    parts: tokenParts.length,
    firstPartLength: tokenParts[0]?.length || 0,
    preview: token.substring(0, 30) + '...' + token.substring(token.length - 20)
  });
  console.log('Headers:', { ...headers, Authorization: headers.Authorization ? `Bearer ${token.substring(0, 20)}...` : 'none' });
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();
  
  console.log(`API response status: ${response.status}`, data);

  if (!response.ok) {
    // If token expired, try refreshing once more
    if (response.status === 401 && currentUser) {
      try {
        token = await currentUser.getIdToken(true);
        localStorage.setItem("authToken", token);
        
        // Retry the request with new token
        headers.Authorization = `Bearer ${token}`;
        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
          ...options,
          headers,
        });
        const retryData = await retryResponse.json();
        
        if (!retryResponse.ok) {
          throw new Error(retryData.error || "API request failed");
        }
        return retryData;
      } catch (retryError) {
        throw new Error(data.error || "Invalid or expired token. Please sign in again.");
      }
    }
    throw new Error(data.error || "API request failed");
  }

  return data;
}

// Make apiCall globally accessible
window.apiCall = apiCall;

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
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    // Add additional scopes if needed
    provider.addScope('email');
    provider.addScope('profile');
    
    console.log('Attempting Google sign-in...');
    const userCredential = await auth.signInWithPopup(provider);
    console.log('Google sign-in successful:', userCredential.user.email);
    return userCredential.user;
  } catch (error) {
    console.error('Google sign-in error:', error);
    // If popup is blocked or fails, try redirect
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
      console.log('Popup blocked, trying redirect method...');
      // For emulator, we might need to handle this differently
      throw new Error('Popup was blocked. Please allow popups for this site and try again.');
    }
    throw error;
  }
}

async function signInWithApple() {
  const provider = new firebase.auth.OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  const userCredential = await auth.signInWithPopup(provider);
  return userCredential.user;
}

async function signOut() {
  await auth.signOut();
  localStorage.removeItem("authToken");
  window.location.href = "/";
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
