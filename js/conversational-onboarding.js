// Conversational AI Onboarding System

// ==================== DATA STRUCTURES ====================

const onboardingData = {
    life: {
        fullName: "",
        birthdate: "",
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
        wakeTime: "",
    },
    health: {
        exerciseFrequency: "",
        fitnessGoals: [],
        currentWeight: 0,
        weightUnit: "lbs",
        targetWeight: 0,
        height: "",
        healthConditions: [],
        stressLevel: 5,
        sleepQuality: 5,
        dailySteps: 0,
        workoutTypes: [],
    },
    diet: {
        dietType: "",
        allergies: [],
        mealsPerDay: 3,
        cookingFrequency: "",
        waterIntake: 8,
        caffeineIntake: "",
        alcoholFrequency: "",
        nutritionGoals: [],
        favoritesCuisines: [],
        mealPrepFrequency: "",
    },
    financial: {
        salary: 0,
        salaryFrequency: "yearly",
        netWorth: 0,
        currency: "USD",
        housingType: "",
        monthlyRent: 0,
        monthlyMortgage: 0,
        savingsRate: 0,
        investmentTypes: [],
        debtTypes: [],
        financialGoals: [],
        monthlyBudget: 0,
        biggestExpenses: [],
    },
    goals: {
        lifeGoals: [],
        oneYearGoals: [],
        priorities: [],
        motivations: [],
        challenges: [],
        learningGoals: [],
        travelGoals: [],
    }
};

// Section definitions with their question flows
const sections = {
    life: {
        icon: "🌱",
        title: "Life & Personal",
        description: "Let's start with some basics about you and your daily life.",
        questions: [
            {
                id: "greeting",
                type: "intro",
                message: () => {
                    const hour = new Date().getHours();
                    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
                    return `${greeting}! I'm excited to help you set up your Zeitline experience. I'll ask you some questions about different areas of your life so we can personalize everything for you.\n\nLet's start with the basics. **What's your name?**`;
                },
                field: "fullName",
                validation: (v) => v.length >= 2,
                response: (v) => `Nice to meet you, **${v.split(' ')[0]}**! Great name.`
            },
            {
                id: "birthdate",
                type: "text",
                message: () => "When were you born? You can type something like 'March 15, 1990' or '03/15/1990'.",
                field: "birthdate",
                parse: parseDate,
                validation: (v) => v !== null,
                response: (v) => {
                    const age = calculateAge(v);
                    onboardingData.life.age = age;
                    return `Got it! So you're **${age} years old**. ${age < 25 ? "Still young and full of possibilities!" : age < 40 ? "The prime of your life!" : age < 60 ? "Experience and wisdom are on your side!" : "You've got amazing life experience to draw from!"}`;
                }
            },
            {
                id: "occupation",
                type: "text",
                message: () => "What do you do for work? (or are you a student, retired, etc.)",
                field: "occupation",
                validation: (v) => v.length >= 2,
                response: (v) => {
                    const occupationResponses = {
                        student: "That's great! Learning new things is one of life's greatest adventures.",
                        retired: "Wonderful! More time to enjoy life and focus on what truly matters to you.",
                        engineer: "Nice! Building things that matter takes real skill.",
                        developer: "Awesome! Shaping the digital world one line of code at a time.",
                        doctor: "Incredible! Helping people stay healthy is such meaningful work.",
                        teacher: "Amazing! Shaping minds and futures is one of the most important jobs.",
                        default: `Interesting! Being a ${v.toLowerCase()} sounds like meaningful work.`
                    };
                    const key = Object.keys(occupationResponses).find(k => v.toLowerCase().includes(k));
                    return occupationResponses[key] || occupationResponses.default;
                }
            },
            {
                id: "location",
                type: "text",
                message: () => "Where do you live? Just the city is fine, or city and state.",
                field: "city",
                parse: parseLocation,
                validation: (v) => v.length >= 2,
                response: (v) => `${v}! ${getLocationComment(v)}`
            },
            {
                id: "workStyle",
                type: "choice",
                message: () => "How do you typically work?",
                options: [
                    { value: "remote", label: "🏠 Remote / Work from home" },
                    { value: "office", label: "🏢 In the office" },
                    { value: "hybrid", label: "🔄 Hybrid (mix of both)" },
                    { value: "freelance", label: "💼 Freelance / Self-employed" },
                    { value: "onsite", label: "🔧 On-site / Field work" },
                    { value: "other", label: "📋 Other" }
                ],
                field: "workStyle",
                response: (v) => {
                    const responses = {
                        remote: "Working from home has its perks! No commute and more flexibility.",
                        office: "There's something nice about separating work and home life.",
                        hybrid: "Best of both worlds! Flexibility when you need it, office time when it helps.",
                        freelance: "The freedom of being your own boss! That takes courage and discipline.",
                        onsite: "Hands-on work keeps things interesting every day!",
                        other: "Unique work situation - that's totally fine!"
                    };
                    return responses[v] || "Interesting work style!";
                }
            },
            {
                id: "morningPerson",
                type: "choice",
                message: () => "Are you more of a morning person or a night owl?",
                options: [
                    { value: "morning", label: "☀️ Early bird - mornings are my thing" },
                    { value: "night", label: "🌙 Night owl - I come alive at night" },
                    { value: "neither", label: "😅 Somewhere in between" }
                ],
                field: "morningPerson",
                response: (v) => {
                    const responses = {
                        morning: "Early risers get the worm! We'll optimize your schedule for productive mornings.",
                        night: "Night owls have their own magic. We'll make sure your evenings are productive.",
                        neither: "Flexibility is a superpower! You can adapt to whatever life throws at you."
                    };
                    return responses[v];
                }
            },
            {
                id: "livingWith",
                type: "choice",
                message: () => "Who do you live with?",
                options: [
                    { value: "alone", label: "🏠 I live alone" },
                    { value: "partner", label: "💑 With my partner/spouse" },
                    { value: "family", label: "👨‍👩‍👧‍👦 With family" },
                    { value: "roommates", label: "👥 With roommates" },
                    { value: "kids", label: "👶 With my kids" }
                ],
                field: "livingWith",
                response: (v) => {
                    const responses = {
                        alone: "Living solo! That means full control over your space and schedule.",
                        partner: "Having a partner to share life with is wonderful!",
                        family: "Family time is precious. We'll help you balance everything.",
                        roommates: "Roommates keep life interesting! Social time built in.",
                        kids: "Parenting is the ultimate adventure! We'll help you track family activities too."
                    };
                    return responses[v];
                }
            }
        ]
    },
    health: {
        icon: "💪",
        title: "Health & Fitness",
        description: "Now let's talk about your health and fitness journey.",
        questions: [
            {
                id: "health_intro",
                type: "intro",
                message: () => "Great! Now let's talk about your health and fitness. This helps us give you better insights and track what matters to you.\n\n**How often do you exercise?**"
            },
            {
                id: "exerciseFrequency",
                type: "choice",
                message: () => "How often do you currently exercise?",
                options: [
                    { value: "daily", label: "💪 Every day" },
                    { value: "4-6", label: "🏃 4-6 times a week" },
                    { value: "2-3", label: "🚶 2-3 times a week" },
                    { value: "weekly", label: "📅 Once a week" },
                    { value: "rarely", label: "😅 Rarely or never" }
                ],
                field: "exerciseFrequency",
                response: (v) => {
                    const responses = {
                        daily: "Wow, that's impressive dedication! You're in the top tier of consistent exercisers.",
                        "4-6": "That's a solid routine! You're taking great care of your body.",
                        "2-3": "Good foundation! Consistency is what matters most.",
                        weekly: "Once a week is a start! We can help you build from there if you want.",
                        rarely: "No judgment here! Everyone starts somewhere, and awareness is step one."
                    };
                    return responses[v];
                }
            },
            {
                id: "workoutTypes",
                type: "multiselect",
                message: () => "What types of exercise do you enjoy or want to try?",
                options: [
                    { value: "running", label: "🏃 Running / Jogging" },
                    { value: "walking", label: "🚶 Walking" },
                    { value: "weights", label: "🏋️ Weight training" },
                    { value: "yoga", label: "🧘 Yoga / Pilates" },
                    { value: "cycling", label: "🚴 Cycling" },
                    { value: "swimming", label: "🏊 Swimming" },
                    { value: "sports", label: "⚽ Team sports" },
                    { value: "hiit", label: "🔥 HIIT / CrossFit" },
                    { value: "dance", label: "💃 Dance" },
                    { value: "hiking", label: "🥾 Hiking" }
                ],
                field: "workoutTypes",
                response: (v) => {
                    if (v.length === 0) return "No worries! We can explore options together.";
                    if (v.length === 1) return `${v[0].charAt(0).toUpperCase() + v[0].slice(1)} is a great choice!`;
                    return `Nice variety! Mixing up workouts keeps things interesting and works different muscle groups.`;
                }
            },
            {
                id: "fitnessGoals",
                type: "multiselect",
                message: () => "What are your main fitness goals?",
                options: [
                    { value: "lose_weight", label: "⚖️ Lose weight" },
                    { value: "build_muscle", label: "💪 Build muscle" },
                    { value: "flexibility", label: "🧘 Improve flexibility" },
                    { value: "endurance", label: "🏃 Build endurance" },
                    { value: "strength", label: "🏋️ Get stronger" },
                    { value: "energy", label: "⚡ More energy" },
                    { value: "stress", label: "🧠 Reduce stress" },
                    { value: "maintain", label: "✅ Maintain current fitness" }
                ],
                field: "fitnessGoals",
                response: (v) => {
                    if (v.length === 0) return "That's okay! Goals can develop over time.";
                    return "Those are solid goals! We'll track your progress toward all of them.";
                }
            },
            {
                id: "weight",
                type: "text",
                message: () => "What's your current weight? (just a number is fine, like '165' or '75 kg')",
                field: "currentWeight",
                parse: parseWeight,
                validation: (v) => v > 0,
                response: (v) => "Got it! This helps us track changes over time if you want.",
                optional: true
            },
            {
                id: "stressLevel",
                type: "slider",
                message: () => "On a scale of 1-10, how would you rate your typical stress level?",
                field: "stressLevel",
                min: 1,
                max: 10,
                default: 5,
                labels: { min: "Very Low", max: "Very High" },
                response: (v) => {
                    if (v <= 3) return "That's great! Low stress is a blessing. Let's keep it that way!";
                    if (v <= 6) return "Moderate stress is normal. We can help you find patterns and manage it better.";
                    return "Managing high stress is important. We'll help you identify triggers and find balance.";
                }
            },
            {
                id: "sleepQuality",
                type: "slider",
                message: () => "How would you rate your sleep quality? (1 = terrible, 10 = amazing)",
                field: "sleepQuality",
                min: 1,
                max: 10,
                default: 6,
                labels: { min: "Terrible", max: "Amazing" },
                response: (v) => {
                    if (v <= 4) return "Sleep struggles are tough. Tracking patterns can help identify what's affecting your rest.";
                    if (v <= 7) return "Decent sleep! There might be room to optimize for even better rest.";
                    return "Excellent! Quality sleep is a superpower for productivity and health.";
                }
            }
        ]
    },
    diet: {
        icon: "🥗",
        title: "Diet & Nutrition",
        description: "Let's learn about your eating habits and nutritional preferences.",
        questions: [
            {
                id: "diet_intro",
                type: "intro",
                message: () => "Now let's talk about food! Your eating habits play a huge role in your energy and wellbeing.\n\n**Do you follow any particular diet?**"
            },
            {
                id: "dietType",
                type: "choice",
                message: () => "Do you follow any particular diet?",
                options: [
                    { value: "none", label: "🍽️ No specific diet" },
                    { value: "vegetarian", label: "🥬 Vegetarian" },
                    { value: "vegan", label: "🌱 Vegan" },
                    { value: "keto", label: "🥑 Keto / Low-carb" },
                    { value: "paleo", label: "🥩 Paleo" },
                    { value: "mediterranean", label: "🫒 Mediterranean" },
                    { value: "pescatarian", label: "🐟 Pescatarian" },
                    { value: "other", label: "📋 Other" }
                ],
                field: "dietType",
                response: (v) => {
                    const responses = {
                        none: "Flexibility! That's totally valid - eating what works for you is what matters.",
                        vegetarian: "Vegetarian diet! Lots of great plant-based options to track.",
                        vegan: "Vegan lifestyle! We'll help you track nutrition to make sure you're getting everything you need.",
                        keto: "Keto! We can help track macros and keep you in your carb range.",
                        paleo: "Paleo! Back to basics with whole foods.",
                        mediterranean: "Mediterranean diet is consistently rated as one of the healthiest!",
                        pescatarian: "Fish and plants - a great balance of nutrients!",
                        other: "Custom approach! Whatever works for your body."
                    };
                    return responses[v];
                }
            },
            {
                id: "allergies",
                type: "multiselect",
                message: () => "Any food allergies or intolerances we should know about?",
                options: [
                    { value: "none", label: "✅ None" },
                    { value: "gluten", label: "🌾 Gluten" },
                    { value: "dairy", label: "🥛 Dairy" },
                    { value: "nuts", label: "🥜 Nuts" },
                    { value: "shellfish", label: "🦐 Shellfish" },
                    { value: "eggs", label: "🥚 Eggs" },
                    { value: "soy", label: "🫘 Soy" },
                    { value: "other", label: "📋 Other" }
                ],
                field: "allergies",
                response: (v) => {
                    if (v.includes("none") || v.length === 0) return "Great! No restrictions to worry about.";
                    return "Good to know! We'll keep these in mind when suggesting meals or tracking nutrition.";
                }
            },
            {
                id: "mealsPerDay",
                type: "choice",
                message: () => "How many meals do you typically eat per day?",
                options: [
                    { value: "1-2", label: "1-2 meals" },
                    { value: "3", label: "3 meals" },
                    { value: "4-5", label: "4-5 smaller meals" },
                    { value: "grazing", label: "I graze throughout the day" }
                ],
                field: "mealsPerDay",
                response: (v) => {
                    const responses = {
                        "1-2": "Fewer meals means each one counts! Intermittent fasting style.",
                        "3": "Classic three meals a day - a time-tested approach!",
                        "4-5": "Frequent smaller meals can help maintain steady energy.",
                        "grazing": "Constant snacking! We can help you track that grazing pattern."
                    };
                    return responses[v];
                }
            },
            {
                id: "cookingFrequency",
                type: "choice",
                message: () => "How often do you cook at home?",
                options: [
                    { value: "daily", label: "🍳 Every day" },
                    { value: "often", label: "👨‍🍳 Most days" },
                    { value: "sometimes", label: "🥡 Sometimes (mix of cooking and takeout)" },
                    { value: "rarely", label: "🍕 Rarely - mostly order out" }
                ],
                field: "cookingFrequency",
                response: (v) => {
                    const responses = {
                        daily: "Home cooking every day! That gives you great control over what you eat.",
                        often: "Cooking most days is excellent for health and budget!",
                        sometimes: "A balance of convenience and home cooking - very relatable!",
                        rarely: "Takeout convenience! We can help track nutrition from restaurant meals too."
                    };
                    return responses[v];
                }
            },
            {
                id: "waterIntake",
                type: "slider",
                message: () => "How many glasses of water do you drink per day? (8oz glasses)",
                field: "waterIntake",
                min: 0,
                max: 15,
                default: 6,
                labels: { min: "0", max: "15+" },
                response: (v) => {
                    if (v < 4) return "Hydration is important! We can help you track and improve water intake.";
                    if (v < 8) return "Good hydration! You're in a healthy range.";
                    return "Excellent hydration habits! Staying well-watered is great for everything.";
                }
            },
            {
                id: "nutritionGoals",
                type: "multiselect",
                message: () => "Any specific nutrition goals?",
                options: [
                    { value: "protein", label: "🥩 Eat more protein" },
                    { value: "less_sugar", label: "🍬 Reduce sugar" },
                    { value: "more_veggies", label: "🥬 Eat more vegetables" },
                    { value: "less_processed", label: "🏭 Less processed foods" },
                    { value: "portion", label: "📏 Better portion control" },
                    { value: "track_calories", label: "🔢 Track calories" },
                    { value: "balanced", label: "⚖️ More balanced meals" },
                    { value: "none", label: "😊 I'm happy with my diet" }
                ],
                field: "nutritionGoals",
                response: (v) => {
                    if (v.includes("none") || v.length === 0) return "Content with your current diet - that's great!";
                    return "Solid nutrition goals! We'll help you work toward these.";
                }
            }
        ]
    },
    financial: {
        icon: "💰",
        title: "Financial Profile",
        description: "Understanding your finances helps us provide personalized insights.",
        questions: [
            {
                id: "financial_intro",
                type: "intro",
                message: () => "Let's talk money! This information stays completely private and helps us give you financial insights.\n\n**What's your approximate annual income?**\n\n*Feel free to skip any questions you're not comfortable with.*"
            },
            {
                id: "salary",
                type: "text",
                message: () => "What's your approximate annual income? (like '75000' or '75k')",
                field: "salary",
                parse: parseNumber,
                validation: (v) => v >= 0,
                response: (v) => {
                    if (v === 0) return "No worries, we can skip this one!";
                    return "Got it! This helps us give you relevant financial insights.";
                },
                optional: true
            },
            {
                id: "housingType",
                type: "choice",
                message: () => "What's your housing situation?",
                options: [
                    { value: "rent", label: "🏠 I rent" },
                    { value: "own", label: "🏡 I own my home" },
                    { value: "family", label: "👨‍👩‍👧 Living with family" },
                    { value: "other", label: "📋 Other arrangement" }
                ],
                field: "housingType",
                response: (v) => {
                    const responses = {
                        rent: "Renting gives flexibility! We can track housing costs for you.",
                        own: "Homeowner! We can help track mortgage and home expenses.",
                        family: "Living with family can be a smart financial move!",
                        other: "Every situation is unique!"
                    };
                    return responses[v];
                }
            },
            {
                id: "savingsRate",
                type: "slider",
                message: () => "What percentage of your income do you typically save?",
                field: "savingsRate",
                min: 0,
                max: 50,
                default: 10,
                labels: { min: "0%", max: "50%+" },
                response: (v) => {
                    if (v === 0) return "Every little bit helps! We can work on building savings habits.";
                    if (v < 10) return "You're saving something - that's what matters!";
                    if (v < 20) return "Solid savings rate! You're building a good financial foundation.";
                    return "Impressive savings rate! You're really prioritizing your future.";
                }
            },
            {
                id: "investmentTypes",
                type: "multiselect",
                message: () => "Do you invest in any of these?",
                options: [
                    { value: "stocks", label: "📈 Individual stocks" },
                    { value: "etfs", label: "📊 ETFs / Index funds" },
                    { value: "401k", label: "💼 401(k) / Retirement" },
                    { value: "real_estate", label: "🏢 Real estate" },
                    { value: "crypto", label: "₿ Cryptocurrency" },
                    { value: "bonds", label: "📑 Bonds" },
                    { value: "none", label: "❌ Not investing yet" }
                ],
                field: "investmentTypes",
                response: (v) => {
                    if (v.includes("none") || v.length === 0) return "No investments yet? That's okay - it's never too late to start!";
                    if (v.length >= 3) return "Nice diversification! Spreading investments is a smart strategy.";
                    return "Good investment choices! Building wealth takes time and consistency.";
                }
            },
            {
                id: "financialGoals",
                type: "multiselect",
                message: () => "What are your main financial goals?",
                options: [
                    { value: "emergency_fund", label: "🆘 Build emergency fund" },
                    { value: "debt_free", label: "💳 Become debt-free" },
                    { value: "save_more", label: "💰 Save more money" },
                    { value: "invest_more", label: "📈 Invest more" },
                    { value: "buy_home", label: "🏠 Buy a home" },
                    { value: "retire_early", label: "🏖️ Retire early" },
                    { value: "passive_income", label: "💸 Build passive income" },
                    { value: "travel_fund", label: "✈️ Travel fund" }
                ],
                field: "financialGoals",
                response: (v) => {
                    if (v.length === 0) return "No specific financial goals right now - that's fine!";
                    return "Those are great financial goals! We'll help you track progress toward them.";
                }
            },
            {
                id: "biggestExpenses",
                type: "multiselect",
                message: () => "What are your biggest monthly expenses?",
                options: [
                    { value: "housing", label: "🏠 Housing (rent/mortgage)" },
                    { value: "food", label: "🍔 Food & Dining" },
                    { value: "transportation", label: "🚗 Transportation" },
                    { value: "healthcare", label: "🏥 Healthcare" },
                    { value: "entertainment", label: "🎬 Entertainment" },
                    { value: "shopping", label: "🛍️ Shopping" },
                    { value: "subscriptions", label: "📱 Subscriptions" },
                    { value: "childcare", label: "👶 Childcare" }
                ],
                field: "biggestExpenses",
                response: (v) => {
                    if (v.length === 0) return "We can help you track expenses once you start using the app!";
                    return "Good awareness of where your money goes! That's the first step to better budgeting.";
                }
            }
        ]
    },
    goals: {
        icon: "🎯",
        title: "Goals & Aspirations",
        description: "Finally, let's dream big! What do you want to achieve?",
        questions: [
            {
                id: "goals_intro",
                type: "intro",
                message: () => "Last section! Let's talk about your dreams and goals. This is the fun part!\n\n**What are your biggest life goals?**"
            },
            {
                id: "lifeGoals",
                type: "multiselect",
                message: () => "What are your biggest life goals? (Select all that resonate)",
                options: [
                    { value: "career_success", label: "💼 Career success" },
                    { value: "financial_freedom", label: "💰 Financial freedom" },
                    { value: "health_fitness", label: "💪 Peak health & fitness" },
                    { value: "travel_world", label: "🌍 Travel the world" },
                    { value: "start_business", label: "🚀 Start a business" },
                    { value: "learn_skills", label: "📚 Learn new skills" },
                    { value: "family", label: "👨‍👩‍👧‍👦 Family & relationships" },
                    { value: "creative", label: "🎨 Creative pursuits" },
                    { value: "give_back", label: "❤️ Give back to community" },
                    { value: "work_life_balance", label: "⚖️ Work-life balance" }
                ],
                field: "lifeGoals",
                response: (v) => {
                    if (v.length === 0) return "Still figuring out what you want? That's part of the journey!";
                    if (v.length >= 4) return "You've got big dreams! Love the ambition. We'll help you make progress on all of them.";
                    return "Great goals! Having clear direction is powerful.";
                }
            },
            {
                id: "oneYearGoals",
                type: "text",
                message: () => "What's one thing you'd love to accomplish in the next year?",
                field: "oneYearGoals",
                parse: (v) => [v],
                validation: (v) => v.length >= 3,
                response: (v) => `That's a great goal: "${v}". We'll help you track progress toward it!`
            },
            {
                id: "priorities",
                type: "multiselect",
                message: () => "What matters most to you right now?",
                options: [
                    { value: "health", label: "💪 My health" },
                    { value: "career", label: "💼 My career" },
                    { value: "relationships", label: "❤️ Relationships" },
                    { value: "money", label: "💰 Financial stability" },
                    { value: "growth", label: "📈 Personal growth" },
                    { value: "happiness", label: "😊 Happiness & joy" },
                    { value: "adventure", label: "🎢 Adventure & experiences" },
                    { value: "peace", label: "🧘 Peace & calm" }
                ],
                field: "priorities",
                response: (v) => {
                    if (v.length === 0) return "Priorities can shift - we'll help you stay focused on what matters.";
                    return "Those priorities will guide how we personalize your experience!";
                }
            },
            {
                id: "challenges",
                type: "multiselect",
                message: () => "What challenges are you currently facing?",
                options: [
                    { value: "time", label: "⏰ Not enough time" },
                    { value: "motivation", label: "💤 Staying motivated" },
                    { value: "focus", label: "🎯 Staying focused" },
                    { value: "habits", label: "🔄 Building good habits" },
                    { value: "stress", label: "😰 Managing stress" },
                    { value: "balance", label: "⚖️ Work-life balance" },
                    { value: "money", label: "💸 Money management" },
                    { value: "health", label: "🏥 Health issues" }
                ],
                field: "challenges",
                response: (v) => {
                    if (v.length === 0) return "Smooth sailing! That's wonderful.";
                    return "Everyone faces challenges. Zeitline is designed to help with exactly these things!";
                }
            },
            {
                id: "final",
                type: "outro",
                message: () => {
                    const name = onboardingData.life.fullName.split(' ')[0] || "friend";
                    return `**${name}, you're amazing!** 🎉\n\nWe've learned so much about you. Your personalized Zeitline experience is ready.\n\nYou can always update these answers in Settings whenever your life changes.`;
                }
            }
        ]
    }
};

// ==================== STATE MANAGEMENT ====================

let currentSection = "life";
let currentQuestionIndex = 0;
let isTyping = false;
let recognition = null;
let isListening = false;

// ==================== BROWSER BACK BUTTON ====================

// Handle browser back button to go to dashboard
function setupBrowserBackButton() {
    // Push initial state so we can detect back button
    history.pushState({ onboarding: true }, '', window.location.href);
    
    window.addEventListener('popstate', (event) => {
        // User pressed browser back button - go to dashboard
        goToDashboard();
    });
}

// Navigate to dashboard (skip/finish later)
function goToDashboard() {
    // Save current progress before leaving
    saveAllData();
    
    // Redirect to dashboard
    window.location.href = '/dashboard.html';
}

// ==================== INITIALIZATION ====================

document.addEventListener("DOMContentLoaded", () => {
    loadSavedData();
    initializeSpeechRecognition();
    initializeEventListeners();
    setupBrowserBackButton();
    
    // Check auth state
    if (typeof firebase !== "undefined" && typeof auth !== "undefined") {
        window.addEventListener("authStateChanged", async (e) => {
            const user = e.detail;
            if (!user) {
                console.log("No user - demo mode");
            } else {
                await loadProfileFromServer();
            }
            startConversation();
        });
        
        // Timeout fallback
        setTimeout(() => {
            if (!document.querySelector(".message")) {
                startConversation();
            }
        }, 2000);
    } else {
        startConversation();
    }
});

function initializeEventListeners() {
    const chatInput = document.getElementById("chatInput");
    
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Section pill clicks
    document.querySelectorAll(".section-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            const section = pill.dataset.section;
            jumpToSection(section);
        });
    });
}

function initializeSpeechRecognition() {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        
        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0].transcript)
                .join("");
            document.getElementById("chatInput").value = transcript;
        };
        
        recognition.onend = () => {
            isListening = false;
            document.getElementById("voiceBtn").classList.remove("listening");
            document.getElementById("inputHint").textContent = "Press Enter to send or click the microphone to use voice";
        };
        
        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            isListening = false;
            document.getElementById("voiceBtn").classList.remove("listening");
        };
    }
}

// ==================== CONVERSATION FLOW ====================

function startConversation() {
    const section = sections[currentSection];
    const question = section.questions[currentQuestionIndex];
    
    setTimeout(() => {
        showQuestion(question);
    }, 500);
    
    updateProgress();
    updateSectionNav();
}

function showQuestion(question) {
    // Pure intro messages with no field - just display and move on
    if (question.type === "intro" && !question.field) {
        addAIMessage(question.message());
        currentQuestionIndex++;
        if (currentQuestionIndex < sections[currentSection].questions.length) {
            const nextQuestion = sections[currentSection].questions[currentQuestionIndex];
            setTimeout(() => showQuestion(nextQuestion), 1800);
        }
        return;
    }
    
    // Outro - show completion
    if (question.type === "outro") {
        addAIMessage(question.message());
        setTimeout(showCompletionModal, 2000);
        return;
    }
    
    // Display the question message
    addAIMessage(question.message());
    
    // Show appropriate input UI based on type
    if (question.type === "choice") {
        showQuickResponses(question.options, false, question);
    } else if (question.type === "multiselect") {
        showQuickResponses(question.options, true, question);
    } else if (question.type === "slider") {
        showSlider(question);
    }
    // For "text" and "intro" types with fields, the user types in the input box
    
    updateProgress();
}

function addAIMessage(text) {
    const messagesContainer = document.getElementById("chatMessages");
    
    // Add typing indicator first
    const typingDiv = document.createElement("div");
    typingDiv.className = "message ai typing-message";
    typingDiv.innerHTML = `
        <div class="message-avatar">Z</div>
        <div class="message-bubble">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    messagesContainer.appendChild(typingDiv);
    scrollToBottom();
    
    // Replace with actual message after delay
    setTimeout(() => {
        typingDiv.remove();
        
        const messageDiv = document.createElement("div");
        messageDiv.className = "message ai";
        messageDiv.innerHTML = `
            <div class="message-avatar">Z</div>
            <div class="message-bubble">
                <p>${formatMessage(text)}</p>
            </div>
        `;
        messagesContainer.appendChild(messageDiv);
        scrollToBottom();
    }, 800 + Math.random() * 400);
}

function addUserMessage(text) {
    const messagesContainer = document.getElementById("chatMessages");
    const messageDiv = document.createElement("div");
    messageDiv.className = "message user";
    messageDiv.innerHTML = `
        <div class="message-avatar">👤</div>
        <div class="message-bubble">
            <p>${escapeHtml(text)}</p>
        </div>
    `;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

function formatMessage(text) {
    // Convert markdown-like syntax to HTML
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '</p><p>');
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const messagesContainer = document.getElementById("chatMessages");
    setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
}

// ==================== INPUT HANDLING ====================

function sendMessage() {
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    
    if (!text) return;
    
    const section = sections[currentSection];
    const question = section.questions[currentQuestionIndex];
    
    // Hide quick responses if shown
    hideQuickResponses();
    
    // Add user message
    addUserMessage(text);
    input.value = "";
    
    // Process the answer
    processAnswer(text, question);
}

function processAnswer(rawValue, question) {
    let value = rawValue;
    
    // Parse if needed
    if (question.parse) {
        value = question.parse(rawValue);
    }
    
    // Validate
    if (question.validation && !question.validation(value)) {
        setTimeout(() => {
            addAIMessage("I didn't quite catch that. Could you try again?");
        }, 500);
        return;
    }
    
    // Store the value
    if (question.field) {
        onboardingData[currentSection][question.field] = value;
        saveData();
    }
    
    // Show response
    if (question.response) {
        setTimeout(() => {
            addAIMessage(question.response(value));
            
            // Move to next question
            setTimeout(() => {
                nextQuestion();
            }, 1200);
        }, 500);
    } else {
        nextQuestion();
    }
}

function showQuickResponses(options, isMultiSelect, question) {
    const container = document.getElementById("quickResponses");
    container.innerHTML = "";
    container.style.display = "flex";
    
    if (isMultiSelect) {
        container.classList.add("multi-select");
        let selectedValues = [];
        
        options.forEach(opt => {
            const btn = document.createElement("button");
            btn.className = "quick-response-btn";
            btn.innerHTML = opt.label;
            btn.dataset.value = opt.value;
            
            btn.addEventListener("click", () => {
                btn.classList.toggle("selected");
                if (btn.classList.contains("selected")) {
                    selectedValues.push(opt.value);
                } else {
                    selectedValues = selectedValues.filter(v => v !== opt.value);
                }
            });
            
            container.appendChild(btn);
        });
        
        // Add confirm button
        const confirmBtn = document.createElement("button");
        confirmBtn.className = "btn btn-primary multi-select-confirm";
        confirmBtn.textContent = "Continue";
        confirmBtn.addEventListener("click", () => {
            hideQuickResponses();
            const selectedLabels = options
                .filter(opt => selectedValues.includes(opt.value))
                .map(opt => opt.label.replace(/^[^\s]+ /, ""))
                .join(", ");
            addUserMessage(selectedLabels || "None selected");
            processAnswer(selectedValues, question);
        });
        container.appendChild(confirmBtn);
        
    } else {
        container.classList.remove("multi-select");
        
        options.forEach(opt => {
            const btn = document.createElement("button");
            btn.className = "quick-response-btn";
            btn.innerHTML = opt.label;
            
            btn.addEventListener("click", () => {
                hideQuickResponses();
                addUserMessage(opt.label.replace(/^[^\s]+ /, ""));
                processAnswer(opt.value, question);
            });
            
            container.appendChild(btn);
        });
    }
    
    scrollToBottom();
}

function showSlider(question) {
    const container = document.getElementById("quickResponses");
    container.innerHTML = "";
    container.style.display = "flex";
    container.classList.remove("multi-select");
    
    const sliderHtml = `
        <div class="slider-container">
            <input type="range" class="slider-input" 
                min="${question.min}" 
                max="${question.max}" 
                value="${question.default}"
                id="sliderInput">
            <div class="slider-value" id="sliderValue">${question.default}</div>
            <div class="slider-labels">
                <span>${question.labels.min}</span>
                <span>${question.labels.max}</span>
            </div>
            <button class="btn btn-primary" style="margin-top: 1rem; width: 100%;" id="sliderConfirm">Continue</button>
        </div>
    `;
    container.innerHTML = sliderHtml;
    
    const slider = document.getElementById("sliderInput");
    const valueDisplay = document.getElementById("sliderValue");
    
    slider.addEventListener("input", () => {
        valueDisplay.textContent = slider.value;
    });
    
    document.getElementById("sliderConfirm").addEventListener("click", () => {
        const value = parseInt(slider.value);
        hideQuickResponses();
        addUserMessage(value.toString());
        processAnswer(value, question);
    });
    
    scrollToBottom();
}

function hideQuickResponses() {
    const container = document.getElementById("quickResponses");
    container.style.display = "none";
    container.innerHTML = "";
}

function toggleVoiceInput() {
    if (!recognition) {
        alert("Voice input is not supported in your browser. Try Chrome!");
        return;
    }
    
    if (isListening) {
        recognition.stop();
        isListening = false;
        document.getElementById("voiceBtn").classList.remove("listening");
    } else {
        recognition.start();
        isListening = true;
        document.getElementById("voiceBtn").classList.add("listening");
        document.getElementById("inputHint").textContent = "Listening... speak now";
    }
}

// ==================== NAVIGATION ====================

function nextQuestion() {
    currentQuestionIndex++;
    const section = sections[currentSection];
    
    if (currentQuestionIndex >= section.questions.length) {
        // Move to next section
        nextSection();
    } else {
        const question = section.questions[currentQuestionIndex];
        showQuestion(question);
    }
}

function nextSection() {
    const sectionOrder = ["life", "health", "diet", "financial", "goals"];
    const currentIndex = sectionOrder.indexOf(currentSection);
    
    // Mark current section as completed
    document.querySelector(`[data-section="${currentSection}"]`)?.classList.add("completed");
    
    if (currentIndex < sectionOrder.length - 1) {
        currentSection = sectionOrder[currentIndex + 1];
        currentQuestionIndex = 0;
        
        updateSectionNav();
        showSectionTransition();
    } else {
        // All sections complete
        showCompletionModal();
    }
}

function showSectionTransition() {
    const section = sections[currentSection];
    
    const transitionDiv = document.createElement("div");
    transitionDiv.className = "section-transition";
    transitionDiv.innerHTML = `
        <div class="section-transition-icon">${section.icon}</div>
        <h2>${section.title}</h2>
        <p>${section.description}</p>
    `;
    
    document.getElementById("chatMessages").appendChild(transitionDiv);
    scrollToBottom();
    
    setTimeout(() => {
        startConversation();
    }, 2000);
}

function jumpToSection(sectionName) {
    if (sections[sectionName]) {
        currentSection = sectionName;
        currentQuestionIndex = 0;
        updateSectionNav();
        
        // Clear chat and restart with new section
        document.getElementById("chatMessages").innerHTML = "";
        hideQuickResponses();
        
        showSectionTransition();
    }
}

function skipToSection() {
    nextSection();
}

function updateSectionNav() {
    document.querySelectorAll(".section-pill").forEach(pill => {
        pill.classList.remove("active");
        if (pill.dataset.section === currentSection) {
            pill.classList.add("active");
        }
    });
}

function updateProgress() {
    const sectionOrder = ["life", "health", "diet", "financial", "goals"];
    const totalQuestions = sectionOrder.reduce((sum, s) => sum + sections[s].questions.length, 0);
    
    let completedQuestions = 0;
    for (let i = 0; i < sectionOrder.indexOf(currentSection); i++) {
        completedQuestions += sections[sectionOrder[i]].questions.length;
    }
    completedQuestions += currentQuestionIndex;
    
    const percent = Math.round((completedQuestions / totalQuestions) * 100);
    
    document.getElementById("progressPercent").textContent = `${percent}%`;
    document.getElementById("progressRing").style.strokeDasharray = `${percent}, 100`;
}

// ==================== COMPLETION ====================

function showCompletionModal() {
    const modal = document.getElementById("completionModal");
    const summary = document.getElementById("completionSummary");
    
    // Generate summary stats
    const statsHtml = `
        <div class="summary-stat">
            <div class="summary-stat-value">${onboardingData.life.fullName.split(' ')[0]}</div>
            <div class="summary-stat-label">Welcome!</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${onboardingData.goals.lifeGoals?.length || 0}</div>
            <div class="summary-stat-label">Life Goals</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${onboardingData.health.fitnessGoals?.length || 0}</div>
            <div class="summary-stat-label">Fitness Goals</div>
        </div>
    `;
    summary.innerHTML = statsHtml;
    
    modal.classList.add("active");
    
    // Save final data
    saveData();
    completeOnboarding();
}

async function completeOnboarding() {
    onboardingData.onboardingComplete = true;
    localStorage.setItem("zeitline_onboarding_complete", "true");
    
    // Convert to the format expected by the rest of the app
    const profileData = {
        personal: {
            fullName: onboardingData.life.fullName,
            age: onboardingData.life.age,
            occupation: onboardingData.life.occupation,
            city: onboardingData.life.city,
            state: onboardingData.life.state,
            timezone: onboardingData.life.timezone,
        },
        lifestyle: {
            interests: onboardingData.goals.lifeGoals,
            lifeGoals: onboardingData.goals.oneYearGoals,
            morningPerson: onboardingData.life.morningPerson === "morning",
            workStyle: onboardingData.life.workStyle,
            sleepHours: 8,
        },
        financial: {
            salary: onboardingData.financial.salary,
            netWorth: 0,
            currency: onboardingData.financial.currency,
            housingType: onboardingData.financial.housingType,
            monthlyBudget: onboardingData.financial.monthlyBudget,
            savingsRate: onboardingData.financial.savingsRate,
            financialGoals: onboardingData.financial.financialGoals,
        },
        health: onboardingData.health,
        diet: onboardingData.diet,
        goals: onboardingData.goals,
        onboardingComplete: true
    };
    
    localStorage.setItem("zeitline_profile", JSON.stringify(profileData));
    localStorage.setItem("zeitline_onboarding_data", JSON.stringify(onboardingData));
    
    // Try to save to server
    try {
        if (typeof apiCall === "function") {
            await apiCall("/users/onboarding/complete", {
                method: "POST",
                body: JSON.stringify(profileData)
            });
        }
    } catch (e) {
        console.log("Could not save to server, saved locally");
    }
}

function goToDashboard() {
    window.location.href = "/dashboard.html";
}

// ==================== DATA PERSISTENCE ====================

function saveData() {
    localStorage.setItem("zeitline_onboarding_progress", JSON.stringify({
        currentSection,
        currentQuestionIndex,
        data: onboardingData
    }));
}

function loadSavedData() {
    const saved = localStorage.getItem("zeitline_onboarding_progress");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.assign(onboardingData, parsed.data);
            // Don't restore position - always start fresh for better UX
        } catch (e) {
            console.log("Could not parse saved progress");
        }
    }
    
    // Also check for existing profile data
    const profile = localStorage.getItem("zeitline_profile");
    if (profile) {
        try {
            const parsed = JSON.parse(profile);
            if (parsed.personal) {
                onboardingData.life.fullName = parsed.personal.fullName || "";
                onboardingData.life.age = parsed.personal.age || 0;
                onboardingData.life.occupation = parsed.personal.occupation || "";
                onboardingData.life.city = parsed.personal.city || "";
            }
            if (parsed.lifestyle) {
                onboardingData.life.workStyle = parsed.lifestyle.workStyle || "";
                onboardingData.life.morningPerson = parsed.lifestyle.morningPerson ? "morning" : "night";
            }
            if (parsed.financial) {
                onboardingData.financial.salary = parsed.financial.salary || 0;
                onboardingData.financial.savingsRate = parsed.financial.savingsRate || 0;
            }
        } catch (e) {
            console.log("Could not parse existing profile");
        }
    }
}

async function loadProfileFromServer() {
    try {
        if (typeof apiCall === "function") {
            const response = await apiCall("/users/profile");
            if (response.data) {
                // Merge with onboarding data
                const profile = response.data;
                if (profile.personal) {
                    Object.assign(onboardingData.life, profile.personal);
                }
                if (profile.lifestyle) {
                    onboardingData.life.workStyle = profile.lifestyle.workStyle;
                }
                if (profile.financial) {
                    Object.assign(onboardingData.financial, profile.financial);
                }
            }
        }
    } catch (e) {
        console.log("Could not load profile from server");
    }
}

// ==================== PARSING HELPERS ====================

function parseDate(text) {
    // Try various date formats
    const date = new Date(text);
    if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
    }
    return null;
}

function calculateAge(birthdate) {
    const today = new Date();
    const birth = new Date(birthdate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

function parseLocation(text) {
    // Extract city and possibly state
    const parts = text.split(",").map(p => p.trim());
    if (parts.length >= 2) {
        onboardingData.life.state = parts[1].replace(/[^a-zA-Z\s]/g, '').trim();
    }
    return parts[0];
}

function getLocationComment(city) {
    const comments = {
        "new york": "The city that never sleeps! Lots of energy there.",
        "los angeles": "Sunshine and possibilities! Great city.",
        "san francisco": "Tech hub vibes! Beautiful city.",
        "chicago": "The Windy City! Great food scene.",
        "austin": "Keep it weird! Awesome city.",
        "seattle": "Coffee and tech! Love the vibe.",
        "miami": "Beaches and good weather! Nice.",
        "denver": "Mountain life! Beautiful area.",
        "boston": "Historic and innovative! Cool spot.",
        default: "Nice place! Looking forward to helping you there."
    };
    
    const key = Object.keys(comments).find(k => city.toLowerCase().includes(k));
    return comments[key] || comments.default;
}

function parseWeight(text) {
    // Extract number and unit
    const match = text.match(/(\d+(?:\.\d+)?)\s*(kg|lbs?|pounds?)?/i);
    if (match) {
        let weight = parseFloat(match[1]);
        const unit = (match[2] || "lbs").toLowerCase();
        
        if (unit.includes("kg")) {
            onboardingData.health.weightUnit = "kg";
        } else {
            onboardingData.health.weightUnit = "lbs";
        }
        
        return weight;
    }
    return 0;
}

function parseNumber(text) {
    // Handle "75k" style inputs
    let cleaned = text.replace(/[,$]/g, "").toLowerCase();
    
    if (cleaned.includes("k")) {
        return parseFloat(cleaned.replace("k", "")) * 1000;
    }
    if (cleaned.includes("m")) {
        return parseFloat(cleaned.replace("m", "")) * 1000000;
    }
    
    return parseFloat(cleaned) || 0;
}

