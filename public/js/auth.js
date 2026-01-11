// Auth page functionality

function hasCompletedOnboarding() {
  // Check the explicit flag first
  if (localStorage.getItem("zeitline_onboarding_complete") === "true") {
    return true;
  }
  
  // Check if full onboarding data exists
  const onboardingData = localStorage.getItem("zeitline_onboarding_data");
  if (onboardingData) {
    try {
      const data = JSON.parse(onboardingData);
      if (data.onboardingComplete) {
        localStorage.setItem("zeitline_onboarding_complete", "true");
        return true;
      }
    } catch (e) {
      // Parse error
    }
  }
  
  // Check if profile data exists with required fields filled
  const savedProfile = localStorage.getItem("zeitline_profile");
  if (savedProfile) {
    try {
      const profile = JSON.parse(savedProfile);
      // If they have personal info filled out, consider onboarding complete
      if (profile.personal && profile.personal.fullName && profile.personal.age) {
        localStorage.setItem("zeitline_onboarding_complete", "true");
        return true;
      }
      if (profile.onboardingComplete) {
        localStorage.setItem("zeitline_onboarding_complete", "true");
        return true;
      }
    } catch (e) {
      // Parse error
    }
  }
  
  return false;
}

document.addEventListener("DOMContentLoaded", () => {
  // Determine if we're on login or signup page
  const isLoginPage = window.location.pathname.includes("login");
  const isSignupPage = window.location.pathname.includes("signup");
  
  // Track if user explicitly wants to stay on login page (e.g., to switch accounts)
  let allowLoginPage = false;
  
  // Check URL parameter for explicit login intent
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('force') === 'true' || urlParams.get('switch') === 'true') {
    allowLoginPage = true;
  }
  
  // Check if user is already signed in
  window.addEventListener("authStateChanged", async (e) => {
    const user = e.detail;
    
    // Check if using test account (has test token but no real Firebase user)
    const authToken = localStorage.getItem("authToken");
    const isTestAccount = authToken === "test-token-12345" && !user;
    
    if (user || isTestAccount) {
      // If on login page, only redirect if user didn't explicitly navigate here
      // This allows users to switch accounts even if they're already logged in
      if (isLoginPage) {
        // Don't auto-redirect if user explicitly wants to stay on login page
        if (allowLoginPage || sessionStorage.getItem('stayOnLoginPage') === 'true') {
          console.log("User is signed in but staying on login page to allow account switching");
          sessionStorage.removeItem('stayOnLoginPage');
          return;
        }
        
        // Don't auto-redirect if URL has switch parameter
        if (window.location.search.includes('switch=true')) {
          console.log("Staying on login page due to switch parameter");
          return;
        }
        
        // Small delay to prevent immediate redirect if user just logged out
        setTimeout(() => {
          if (hasCompletedOnboarding()) {
            window.location.href = "/dashboard.html";
          } else {
            // Existing user but hasn't completed onboarding
            window.location.href = "/onboarding-chat.html?mode=continue";
          }
        }, 100);
        return;
      }
      
      // If on signup page, check if they've completed onboarding
      if (isSignupPage) {
        setTimeout(() => {
          if (hasCompletedOnboarding()) {
            window.location.href = "/dashboard.html";
            return;
          }
          
          // New signup - go to chat onboarding
          window.location.href = "/onboarding-chat.html?mode=new";
        }, 100);
      }
    }
  });
});

// Sign up form handler
async function handleSignUp(event) {
  event.preventDefault();

  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  // Get form values
  const fullName = form.querySelector('input[name="fullName"]').value;
  const email = form.querySelector('input[name="email"]').value;
  const password = form.querySelector('input[name="password"]').value;
  const confirmPassword = form.querySelector(
    'input[name="confirmPassword"]'
  )?.value;

  // Validate
  if (confirmPassword && password !== confirmPassword) {
    showError("Passwords do not match");
    return;
  }

  if (password.length < 8) {
    showError("Password must be at least 8 characters");
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account...";

    // Create Firebase Auth user
    const user = await signUpWithEmail(email, password);

    // Update display name
    await user.updateProfile({ displayName: fullName });

    // Wait for token
    const token = await user.getIdToken();
    localStorage.setItem("authToken", token);

    // Pre-populate onboarding data with the name
    const initialOnboardingData = {
      life: {
        fullName: fullName,
        age: 0,
        occupation: "",
        city: "",
        state: "",
        country: "USA",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        livingWith: "",
        relationshipStatus: "",
        hasKids: false,
        kidsCount: 0,
        workStyle: "",
        morningPerson: null,
        sleepTime: "",
        wakeTime: ""
      },
      health: {},
      diet: {},
      financial: {},
      goals: {}
    };
    localStorage.setItem("zeitline_onboarding_data", JSON.stringify(initialOnboardingData));
    
    // Clear completion flag for new users
    localStorage.removeItem("zeitline_onboarding_complete");

    // Try to create user profile via API
    try {
      await apiCall("/users/create", {
        method: "POST",
        body: JSON.stringify({ email, fullName }),
      });
    } catch (apiError) {
      console.log("API call failed, continuing with local storage");
    }

    // Redirect to chat onboarding
    window.location.href = "/onboarding-chat.html?mode=new";
  } catch (error) {
    console.error("Sign up error:", error);
    showError(getAuthErrorMessage(error));
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Sign in form handler
async function handleSignIn(event) {
  event.preventDefault();

  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  const email = form.querySelector('input[name="email"]').value;
  const password = form.querySelector('input[name="password"]').value;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";

    await signInWithEmail(email, password);

    // Auth state observer will handle redirect
  } catch (error) {
    console.error("Sign in error:", error);
    showError(getAuthErrorMessage(error));
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

// Google sign in handler
async function handleGoogleSignIn() {
  try {
    showLoading("Signing in with Google...");
    
    // Clear any stayOnLoginPage flag that might have been set during logout
    sessionStorage.removeItem('stayOnLoginPage');
    
    const user = await signInWithGoogle();

    // Check if this is a new user
    const token = await user.getIdToken();
    localStorage.setItem("authToken", token);

    let isNewUser = false;
    try {
      await apiCall("/users/profile");
      // Profile exists
    } catch {
      // New user, create profile
      isNewUser = true;
      try {
        await apiCall("/users/create", {
          method: "POST",
          body: JSON.stringify({
            email: user.email,
            fullName: user.displayName || "",
          }),
        });
      } catch (e) {
        console.log("API call failed, continuing with local storage");
      }
    }

    if (isNewUser) {
      // Pre-populate onboarding data
      const initialOnboardingData = {
        life: {
          fullName: user.displayName || "",
          age: 0,
          occupation: "",
          city: "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        health: {},
        diet: {},
        financial: {},
        goals: {}
      };
      localStorage.setItem("zeitline_onboarding_data", JSON.stringify(initialOnboardingData));
      localStorage.removeItem("zeitline_onboarding_complete");
    }

    hideLoading();
    
    // Explicitly redirect after successful login (don't rely on auth observer alone)
    // This ensures redirect happens even if the stayOnLoginPage flag was set during logout
    if (isNewUser || !hasCompletedOnboarding()) {
      window.location.href = "/onboarding-chat.html?mode=new";
    } else {
      window.location.href = "/dashboard.html";
    }
  } catch (error) {
    hideLoading();
    console.error("Google sign in error:", error);
    showError(getAuthErrorMessage(error));
  }
}

// Apple sign in handler
async function handleAppleSignIn() {
  try {
    showLoading("Signing in with Apple...");
    
    // Clear any stayOnLoginPage flag that might have been set during logout
    sessionStorage.removeItem('stayOnLoginPage');
    
    const user = await signInWithApple();

    const token = await user.getIdToken();
    localStorage.setItem("authToken", token);

    let isNewUser = false;
    try {
      await apiCall("/users/profile");
    } catch {
      isNewUser = true;
      try {
        await apiCall("/users/create", {
          method: "POST",
          body: JSON.stringify({
            email: user.email,
            fullName: user.displayName || "",
          }),
        });
      } catch (e) {
        console.log("API call failed, continuing with local storage");
      }
    }

    if (isNewUser) {
      const initialOnboardingData = {
        life: {
          fullName: user.displayName || "",
          age: 0,
          occupation: "",
          city: "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        health: {},
        diet: {},
        financial: {},
        goals: {}
      };
      localStorage.setItem("zeitline_onboarding_data", JSON.stringify(initialOnboardingData));
      localStorage.removeItem("zeitline_onboarding_complete");
    }

    hideLoading();
    
    // Explicitly redirect after successful login
    if (isNewUser || !hasCompletedOnboarding()) {
      window.location.href = "/onboarding-chat.html?mode=new";
    } else {
      window.location.href = "/dashboard.html";
    }
  } catch (error) {
    hideLoading();
    console.error("Apple sign in error:", error);
    showError(getAuthErrorMessage(error));
  }
}

// Password reset handler
async function handlePasswordReset(event) {
  event.preventDefault();

  const form = event.target;
  const email = form.querySelector('input[name="email"]').value;

  try {
    await resetPassword(email);
    showSuccess("Password reset email sent! Check your inbox.");
  } catch (error) {
    console.error("Password reset error:", error);
    showError(getAuthErrorMessage(error));
  }
}

// Error message helper
function getAuthErrorMessage(error) {
  const code = error.code || "";

  const messages = {
    "auth/email-already-in-use": "This email is already registered. Try signing in instead.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/operation-not-allowed": "This sign-in method is not enabled.",
    "auth/weak-password": "Password is too weak. Use at least 8 characters.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password. Please try again.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/popup-closed-by-user": "Sign-in popup was closed.",
    "auth/cancelled-popup-request": "Sign-in was cancelled.",
    "auth/popup-blocked": "Sign-in popup was blocked by the browser.",
  };

  return messages[code] || error.message || "An error occurred. Please try again.";
}

// UI helpers
function showError(message) {
  const existing = document.querySelector(".error-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "error-toast";
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">×</button>
  `;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 5000);
}

function showSuccess(message) {
  const existing = document.querySelector(".success-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "success-toast";
  toast.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">×</button>
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
