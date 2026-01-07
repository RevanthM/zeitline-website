// Test account setup script
// This creates a dummy account in localStorage for testing without backend

function createTestAccount() {
    const testProfile = {
        uid: "test-user-123",
        email: "test@zeitline.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        plan: "free",
        onboardingComplete: true,
        onboardingStep: 4,
        personal: {
            fullName: "Test User",
            age: 25,
            occupation: "Software Developer",
            location: "San Francisco, CA",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            interests: ["Technology", "Productivity", "Health"],
            lifeGoals: ["Build great products", "Stay healthy", "Learn continuously"],
            lifestyle: {
                morningPerson: true,
                workStyle: "Remote",
                sleepHours: 8
            }
        },
        financial: {
            salary: 100000,
            netWorth: 50000,
            currency: "USD",
            spendingCategories: ["Food", "Transportation", "Entertainment"],
            financialGoals: ["Save for house", "Invest in stocks"]
        }
    };

    // Store profile
    localStorage.setItem("zeitline_profile", JSON.stringify(testProfile));
    localStorage.setItem("zeitline_onboarding_complete", "true");
    
    // Create a mock Firebase auth token
    localStorage.setItem("authToken", "test-token-12345");
    
    // Clear any real Firebase auth state to prevent conflicts
    if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().signOut().catch(() => {
            // Ignore errors if not signed in
        });
    }
    
    console.log("Test account created successfully!");
    return testProfile;
}

// DISABLED: Auto-create test account
// Users should explicitly click the "Use Test Account" button if they want to use it
// if (window.location.pathname.includes("login") || window.location.pathname.includes("signup")) {
//     createTestAccount();
//     // Redirect to dashboard
//     setTimeout(() => {
//         window.location.href = "/dashboard.html";
//     }, 500);
// }


