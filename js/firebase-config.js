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
    ? "http://localhost:5001/zeitlineai/us-central1/api"
    : "/api";

// Auth state observer
let currentUser = null;

auth.onAuthStateChanged((user) => {
  currentUser = user;
  if (user) {
    console.log("User signed in:", user.email);
    // Store token for API calls
    user.getIdToken().then((token) => {
      localStorage.setItem("authToken", token);
    });
  } else {
    console.log("User signed out");
    localStorage.removeItem("authToken");
  }

  // Dispatch custom event for page-specific handling
  window.dispatchEvent(new CustomEvent("authStateChanged", { detail: user }));
});

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
  const token = localStorage.getItem("authToken");

  const headers = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();

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
