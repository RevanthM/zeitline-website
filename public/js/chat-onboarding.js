/**
 * Zeitline Chat Onboarding
 * Immersive conversational onboarding powered by OpenAI
 */

// ==================== CONFIGURATION ====================

const API_BASE = window.location.hostname === 'localhost' 
    ? 'http://localhost:5001/zeitlineai/us-central1/api'
    : 'https://us-central1-zeitlineai.cloudfunctions.net/api';

// ==================== STATE ====================

const state = {
    section: 'life',
    questionIndex: 0,
    conversationHistory: [],
    collectedData: {},
    isTyping: false,
    isListening: false,
    mode: 'new', // 'new', 'continue', 'edit'
    useAI: false, // Will try API first, fallback to local
};

// ==================== QUESTION FLOWS ====================
// In-depth, detailed questions for each section

const questionFlows = {
    life: {
        icon: '🌱',
        title: 'Life & Personal',
        intro: "Let's start by getting to know you better. This helps me personalize your entire Zeitline experience.",
        questions: [
            {
                id: 'name',
                message: "First things first – what's your name? I'm Zara, by the way! 👋",
                field: 'fullName',
                type: 'text',
                validate: v => v.length >= 2,
                response: (v) => {
                    const firstName = v.split(' ')[0];
                    return `Great to meet you, ${firstName}! I love that name. 😊`;
                }
            },
            {
                id: 'birthday',
                message: "When's your birthday? You can just type something like 'March 15, 1992' or '03/15/92'. I promise I won't forget it! 🎂",
                field: 'birthday',
                type: 'date',
                response: (v, data) => {
                    const age = data._parsedAge;
                    if (age < 25) return `${age} – you've got so much ahead of you! Your 20s are such a formative time.`;
                    if (age < 35) return `${age} – what a great age to be intentional about life design!`;
                    if (age < 50) return `${age} – you've got the experience and still plenty of runway. Perfect combination!`;
                    return `${age} – with all that life experience, you probably have great wisdom to draw from!`;
                }
            },
            {
                id: 'occupation',
                message: "What do you do for work? Or if you're a student, retired, or between things – that counts too! I'm curious about how you spend your days.",
                field: 'occupation',
                type: 'text',
                parse: (v) => extractOccupation(v),
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('engineer') || lower.includes('developer') || lower.includes('programmer')) {
                        return "A builder! I have a lot of respect for people who create things. The attention to detail and problem-solving required is incredible.";
                    }
                    if (lower.includes('teacher') || lower.includes('professor') || lower.includes('educator')) {
                        return "Shaping minds and futures – that's one of the most impactful things a person can do. What subject or level?";
                    }
                    if (lower.includes('doctor') || lower.includes('nurse') || lower.includes('medical')) {
                        return "Healthcare is such demanding but meaningful work. Thank you for what you do. How do you manage the stress?";
                    }
                    if (lower.includes('student')) {
                        return "Learning mode! That's exciting. What are you studying? I'd love to know more about your field.";
                    }
                    if (lower.includes('retire')) {
                        return "Congratulations on reaching that milestone! What are you enjoying most about this chapter?";
                    }
                    if (lower.includes('designer')) {
                        return "A designer! Creative work that shapes how people interact with the world. I love that. What kind of design do you focus on?";
                    }
                    if (lower.includes('manager') || lower.includes('director') || lower.includes('lead')) {
                        return "Leadership role! Guiding teams and making things happen. What's the most rewarding part of leading others?";
                    }
                    if (lower.includes('writer') || lower.includes('content') || lower.includes('journalist')) {
                        return "A wordsmith! Communication is such a powerful skill. What kind of writing do you do?";
                    }
                    if (lower.includes('sales') || lower.includes('business development')) {
                        return "Sales and relationship building – that takes real people skills. What industry are you in?";
                    }
                    if (lower.includes('entrepreneur') || lower.includes('founder') || lower.includes('own business')) {
                        return "An entrepreneur! That takes real courage and vision. What does your business do?";
                    }
                    // v is already the parsed occupation (extracted from the parse function)
                    return `Interesting! ${v} sounds like it has its own unique challenges and rewards. What do you enjoy most about it?`;
                }
            },
            {
                id: 'occupation_depth',
                message: "Tell me a bit more – do you find your work fulfilling? What's the best and worst part of what you do?",
                field: 'workSatisfaction',
                type: 'text',
                optional: true,
                response: (v) => {
                    if (v.toLowerCase().includes('love') || v.toLowerCase().includes('fulfilling') || v.toLowerCase().includes('enjoy')) {
                        return "That's wonderful to hear! Finding meaning in your work makes such a difference in overall life satisfaction.";
                    }
                    if (v.toLowerCase().includes('hate') || v.toLowerCase().includes('stress') || v.toLowerCase().includes('hard')) {
                        return "I hear you. Work challenges can really impact everything else. Maybe Zeitline can help you find more balance.";
                    }
                    return "Thanks for sharing that. Understanding your relationship with work helps me give you better insights.";
                }
            },
            {
                id: 'location',
                message: "Where in the world are you based? Just city is fine, or city and country if you're outside the US.",
                field: 'city',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    const locationResponses = {
                        'new york': "The city that never sleeps! I bet the energy there is incredible. Do you love it or find it overwhelming sometimes?",
                        'san francisco': "Tech hub with amazing views! The hills, the fog, the culture – quite a unique place to call home.",
                        'los angeles': "Sunshine and creativity! LA has such a different vibe from the rest of the country.",
                        'chicago': "The Windy City! Great food scene, architecture, and that lakefront is gorgeous.",
                        'austin': "Keep it weird! Austin's got such a cool creative energy. How do you like it there?",
                        'seattle': "Coffee, tech, and beautiful nature nearby. Sounds like a great place to be!",
                        'london': "Brilliant! One of the world's great cities. How do you handle the weather? 😄",
                        'toronto': "Canada! I hear Toronto is incredibly multicultural. What's your favorite thing about it?",
                    };
                    for (const [city, response] of Object.entries(locationResponses)) {
                        if (lower.includes(city)) return response;
                    }
                    return `${v} – nice! Every place has its own character. What do you love most about living there?`;
                }
            },
            {
                id: 'living_situation',
                message: "Who's in your household? Do you live alone, with a partner, family, roommates?",
                field: 'livingWith',
                type: 'choice',
                options: [
                    { value: 'alone', label: '🏠 I live alone' },
                    { value: 'partner', label: '💑 With my partner/spouse' },
                    { value: 'family', label: '👨‍👩‍👧 With family' },
                    { value: 'roommates', label: '👥 With roommates' },
                    { value: 'kids', label: '👶 With my kids' },
                ],
                response: (v) => {
                    const responses = {
                        alone: "Solo living has its perks – full control over your space and schedule! Do you enjoy the independence?",
                        partner: "It's nice having someone to share life with! How do you two balance individual time vs together time?",
                        family: "Family dynamics can be complex but also grounding. What's the best part of your living situation?",
                        roommates: "The social aspect of roommates can be fun! Do you all get along well?",
                        kids: "Parenting is the ultimate adventure! How old are your kids? I'd love to know more.",
                    };
                    return responses[v] || "Thanks for sharing!";
                }
            },
            {
                id: 'work_style',
                message: "How do you typically work? Remote, in-office, hybrid, or something else?",
                field: 'workStyle',
                type: 'choice',
                options: [
                    { value: 'remote', label: '🏠 Fully remote' },
                    { value: 'office', label: '🏢 In the office' },
                    { value: 'hybrid', label: '🔄 Hybrid mix' },
                    { value: 'freelance', label: '💼 Freelance/Self-employed' },
                    { value: 'varied', label: '🌍 It varies/Travel' },
                ],
                response: (v) => {
                    const responses = {
                        remote: "Remote work life! No commute is amazing, but do you ever struggle with work-life boundaries at home?",
                        office: "There's something nice about separating work and home. How's your commute? That can make or break the office experience.",
                        hybrid: "Best of both worlds! Which days do you prefer going in, and which staying home?",
                        freelance: "Being your own boss takes real discipline. How do you structure your days?",
                        varied: "Variety keeps things interesting! Must require good adaptability. How do you stay organized with all that movement?",
                    };
                    return responses[v] || "Interesting work setup!";
                }
            },
            {
                id: 'chronotype',
                message: "Here's an important one – are you naturally a morning person or a night owl? Be honest! 🌅🦉",
                field: 'chronotype',
                type: 'choice',
                options: [
                    { value: 'morning', label: '☀️ Morning person – early riser' },
                    { value: 'night', label: '🌙 Night owl – come alive at night' },
                    { value: 'neither', label: '😅 Somewhere in between' },
                ],
                response: (v) => {
                    const responses = {
                        morning: "A morning person! You probably get so much done before most people wake up. What time do you usually get up?",
                        night: "Night owl energy! There's something magical about late night productivity when the world is quiet.",
                        neither: "Flexible! That's actually useful – you can adapt to whatever schedule life requires.",
                    };
                    return responses[v] || "Good to know!";
                }
            },
            {
                id: 'daily_routine',
                message: "Walk me through your typical day – when do you wake up, what's your routine like? I'm curious about your rhythms.",
                field: 'dailyRoutine',
                type: 'text',
                optional: true,
                response: (v) => {
                    if (v.toLowerCase().includes('gym') || v.toLowerCase().includes('exercise') || v.toLowerCase().includes('workout')) {
                        return "I love that exercise is part of your routine! That sets you up well for the day.";
                    }
                    if (v.toLowerCase().includes('coffee') || v.toLowerCase().includes('tea')) {
                        return "Ah, the sacred morning ritual! Can't start the day without it, right?";
                    }
                    if (v.toLowerCase().includes('meditation') || v.toLowerCase().includes('mindful')) {
                        return "Mindfulness in the morning – that's a powerful practice. How long have you been doing that?";
                    }
                    return "Thanks for sharing your rhythm! This helps me understand when you might need different kinds of support throughout the day.";
                }
            },
            {
                id: 'hobbies',
                message: "Outside of work, what do you love doing? Hobbies, interests, ways you unwind?",
                field: 'hobbies',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('read')) return "A reader! What genres do you gravitate toward? I'd love to know what's on your nightstand.";
                    if (lower.includes('game') || lower.includes('gaming')) return "Gaming is such a great way to unwind and challenge yourself! What are you playing lately?";
                    if (lower.includes('music') || lower.includes('guitar') || lower.includes('piano')) return "Music is so enriching! Do you play, listen, or both?";
                    if (lower.includes('hike') || lower.includes('nature') || lower.includes('outdoor')) return "Nature lover! There's nothing quite like getting outside. Do you have favorite trails nearby?";
                    if (lower.includes('cook')) return "Cooking is such a creative outlet! Are you experimental or do you stick to favorites?";
                    return `Those sound like great ways to spend your time! It's important to have things that bring you joy outside of work.`;
                }
            },
        ]
    },
    health: {
        icon: '💪',
        title: 'Health & Fitness',
        intro: "Now let's talk about your health – this is key for understanding your energy, habits, and what kind of insights would be most helpful.",
        questions: [
            {
                id: 'health_intro',
                message: "How would you describe your overall health right now? And be real with me – I'm not here to judge, just to help! 😊",
                field: 'overallHealth',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('great') || lower.includes('good') || lower.includes('excellent')) {
                        return "That's wonderful to hear! Let's make sure we maintain that. What do you think contributes most to you feeling good?";
                    }
                    if (lower.includes('okay') || lower.includes('fine') || lower.includes('average')) {
                        return "Room for improvement is normal! Most of us are there. What's one area you'd like to work on?";
                    }
                    if (lower.includes('bad') || lower.includes('struggle') || lower.includes('poor')) {
                        return "I appreciate your honesty. Health challenges are tough, but small consistent changes can make a big difference. We'll figure this out together.";
                    }
                    return "Thanks for sharing. Health is multifaceted – it's not just about fitness, but energy, mental clarity, and how you feel day to day.";
                }
            },
            {
                id: 'exercise_current',
                message: "Tell me about exercise in your life. Do you work out regularly? What kinds of movement do you enjoy or want to do more of?",
                field: 'exerciseHabits',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes("don't") || lower.includes('no exercise') || lower.includes('rarely')) {
                        return "That's totally okay! Exercise can feel intimidating. Is there something specific holding you back, or is it just not been a priority?";
                    }
                    if (lower.includes('run') || lower.includes('jog')) {
                        return "Running is such great cardio! Are you training for anything specific, or just running for fitness?";
                    }
                    if (lower.includes('gym') || lower.includes('weight') || lower.includes('lift')) {
                        return "Strength training is so important! How often do you get to the gym, and do you follow a program?";
                    }
                    if (lower.includes('yoga') || lower.includes('pilates')) {
                        return "Mind-body work is underrated! Do you find it helps with stress as much as physical fitness?";
                    }
                    return "Sounds like you have some movement in your life! The key is finding what you actually enjoy so it's sustainable.";
                }
            },
            {
                id: 'exercise_frequency',
                message: "How many times per week do you typically exercise? Be honest – what's realistic for your current life?",
                field: 'exerciseFrequency',
                type: 'choice',
                options: [
                    { value: 'daily', label: '💪 6-7 times a week' },
                    { value: '4-5', label: '🏃 4-5 times a week' },
                    { value: '2-3', label: '🚶 2-3 times a week' },
                    { value: '1', label: '📅 About once a week' },
                    { value: 'rarely', label: '😅 Rarely or never' },
                ],
                response: (v) => {
                    const responses = {
                        daily: "Wow, nearly daily! That's impressive dedication. Make sure you're building in recovery too!",
                        '4-5': "That's a really solid routine! Consistent is better than intense – you're doing great.",
                        '2-3': "2-3 times a week is actually really good! Research shows that's enough for significant health benefits.",
                        '1': "Once a week is a start! Would you like to do more, or is that what fits your life right now?",
                        rarely: "No judgment here. Life gets busy. What do you think would help you move more?",
                    };
                    return responses[v] || "Thanks for sharing!";
                }
            },
            {
                id: 'sleep',
                message: "Let's talk sleep – arguably the most important health habit. How many hours do you typically get, and how's the quality?",
                field: 'sleepHabits',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    const hourMatch = v.match(/(\d+)/);
                    const hours = hourMatch ? parseInt(hourMatch[1]) : null;
                    
                    if (hours) {
                        state.collectedData.sleepHours = hours;
                        if (hours < 6) return "Under 6 hours is tough on the body and mind. Is this by choice or do you struggle to sleep more?";
                        if (hours >= 7 && hours <= 9) return "That's a healthy amount! Sleep is when so much recovery and mental processing happens.";
                        if (hours > 9) return "Lots of rest! Sometimes that can indicate other factors. Do you feel refreshed when you wake up?";
                    }
                    
                    if (lower.includes('bad') || lower.includes('terrible') || lower.includes('insomnia')) {
                        return "Sleep struggles are so frustrating and affect everything else. Have you identified what might be causing it?";
                    }
                    return "Sleep really is the foundation of everything – energy, mood, focus. Let's make sure we track this well for you.";
                }
            },
            {
                id: 'stress',
                message: "On a scale of 1-10, how would you rate your typical stress level? And what's the main source of stress in your life?",
                field: 'stressLevel',
                type: 'text',
                response: (v) => {
                    const numMatch = v.match(/(\d+)/);
                    const level = numMatch ? parseInt(numMatch[1]) : 5;
                    state.collectedData.stressScore = level;
                    
                    if (level <= 3) return "Low stress is a gift! What do you think helps you stay so calm?";
                    if (level <= 6) return "Moderate stress is pretty normal in modern life. Having good outlets is key.";
                    return "High stress takes a real toll. Managing it should probably be a priority. What do you currently do to decompress?";
                }
            },
            {
                id: 'health_goals',
                message: "If you could wave a magic wand and improve one aspect of your health, what would it be?",
                field: 'healthPriority',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('weight') || lower.includes('lose') || lower.includes('fat')) {
                        return "Weight management is a common goal. It's really about sustainable habits more than quick fixes. We can help track the behaviors that matter.";
                    }
                    if (lower.includes('energy') || lower.includes('tired') || lower.includes('fatigue')) {
                        return "Low energy affects everything! It's often a combination of sleep, nutrition, and stress. We'll help you identify patterns.";
                    }
                    if (lower.includes('strength') || lower.includes('muscle') || lower.includes('stronger')) {
                        return "Building strength is great for longevity! Consistency and progressive overload are key.";
                    }
                    if (lower.includes('sleep')) {
                        return "Better sleep would transform so many other areas. Let's prioritize tracking and improving your rest.";
                    }
                    return "That's a great focus area! Zeitline will help you track progress toward this goal.";
                }
            },
        ]
    },
    diet: {
        icon: '🥗',
        title: 'Diet & Nutrition',
        intro: "Food is fuel, but it's also culture, pleasure, and habit. Let's understand your relationship with eating.",
        questions: [
            {
                id: 'diet_general',
                message: "How would you describe your eating habits? Are you health-conscious, more of a convenience eater, or somewhere in between?",
                field: 'eatingStyle',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('healthy') || lower.includes('conscious') || lower.includes('careful')) {
                        return "That's great! Being mindful about food is such a valuable skill. What does eating healthy look like for you?";
                    }
                    if (lower.includes('busy') || lower.includes('convenience') || lower.includes('fast')) {
                        return "Life gets busy! Convenience eating is understandable. Would you like to improve this, or does it work for you?";
                    }
                    return "Understanding your eating patterns helps me give you relevant insights. No judgment – we all have our own relationship with food.";
                }
            },
            {
                id: 'diet_type',
                message: "Do you follow any particular way of eating? Vegetarian, vegan, keto, Mediterranean, or just... whatever sounds good? 😄",
                field: 'dietType',
                type: 'choice',
                options: [
                    { value: 'none', label: '🍽️ No specific diet' },
                    { value: 'vegetarian', label: '🥬 Vegetarian' },
                    { value: 'vegan', label: '🌱 Vegan' },
                    { value: 'keto', label: '🥑 Keto/Low-carb' },
                    { value: 'paleo', label: '🥩 Paleo' },
                    { value: 'mediterranean', label: '🫒 Mediterranean' },
                ],
                response: (v) => {
                    const responses = {
                        none: "No labels – you eat what works for you! That's actually the most sustainable approach for many people.",
                        vegetarian: "Vegetarian! How long have you been eating this way? And what made you choose it?",
                        vegan: "Vegan takes real commitment! We'll make sure you're tracking the nutrients that matter most for plant-based eating.",
                        keto: "Keto! That's a significant lifestyle change. How's it working for you?",
                        paleo: "Back to basics! The whole foods focus of paleo is really beneficial.",
                        mediterranean: "Mediterranean is consistently rated one of the healthiest diets. Great choice!",
                    };
                    return responses[v] || "Got it!";
                }
            },
            {
                id: 'cooking',
                message: "How's your cooking situation? Do you cook regularly, or are you more takeout/delivery-oriented?",
                field: 'cookingFrequency',
                type: 'choice',
                options: [
                    { value: 'daily', label: '👨‍🍳 I cook most days' },
                    { value: 'sometimes', label: '🍳 Mix of cooking and takeout' },
                    { value: 'rarely', label: '🥡 Mostly eat out/order' },
                    { value: 'meal_prep', label: '📦 I meal prep weekly' },
                ],
                response: (v) => {
                    const responses = {
                        daily: "A home cook! That gives you so much control over what goes into your body. Do you enjoy cooking?",
                        sometimes: "Balance is key! Cooking when you can, convenience when you need it.",
                        rarely: "The modern convenience life! Do you have favorite go-to restaurants or delivery options?",
                        meal_prep: "Meal prepping is such smart time management! What do you usually make?",
                    };
                    return responses[v] || "Thanks!";
                }
            },
            {
                id: 'allergies',
                message: "Any food allergies, intolerances, or things you avoid? Good for me to know so I don't suggest anything problematic!",
                field: 'dietaryRestrictions',
                type: 'text',
                optional: true,
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('none') || lower.includes('no') || lower.includes("don't")) {
                        return "No restrictions – that makes things easy! You can eat freely.";
                    }
                    return "Good to know! I'll keep that in mind when thinking about nutrition insights for you.";
                }
            },
            {
                id: 'hydration',
                message: "Quick one – how's your water intake? Are you a good water drinker, or do you forget like most people? 💧",
                field: 'hydration',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('good') || lower.includes('lot') || lower.includes('plenty')) {
                        return "Great! Proper hydration affects energy, skin, focus – everything really.";
                    }
                    if (lower.includes('bad') || lower.includes('forget') || lower.includes('not enough')) {
                        return "You're not alone! Most people don't drink enough. Maybe we can help you track and improve this.";
                    }
                    return "Hydration is one of those simple things that makes a big difference. Every bit helps!";
                }
            },
            {
                id: 'caffeine',
                message: "Coffee or tea person? And how much are we talking – light sipper or serious caffeine addiction? ☕",
                field: 'caffeineHabits',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('none') || lower.includes("don't drink")) {
                        return "No caffeine! That's rare these days. Natural energy – I'm impressed!";
                    }
                    if (lower.includes('tea')) {
                        return "Tea lover! There's something calming about the ritual of tea. What's your go-to?";
                    }
                    const cupMatch = v.match(/(\d+)/);
                    if (cupMatch && parseInt(cupMatch[1]) > 4) {
                        return "That's a lot of caffeine! Does it affect your sleep at all?";
                    }
                    return "A little caffeine to get going is pretty universal. Nothing wrong with that!";
                }
            },
        ]
    },
    financial: {
        icon: '💰',
        title: 'Financial Profile',
        intro: "Let's talk money – totally optional to share specifics, but understanding your financial life helps with planning insights. Skip anything you're not comfortable with.",
        questions: [
            {
                id: 'financial_intro',
                message: "First – what's your relationship with money like? Are you a natural saver, spender, investor, or somewhere in between?",
                field: 'moneyPersonality',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('saver') || lower.includes('frugal') || lower.includes('careful')) {
                        return "A saver! That's a great foundation. Do you find it easy to save, or does it take discipline?";
                    }
                    if (lower.includes('spender') || lower.includes('spend')) {
                        return "Spending can be fun! The key is being intentional about it. Do you mostly spend on experiences, things, or both?";
                    }
                    if (lower.includes('invest')) {
                        return "An investor mindset! That's thinking long-term. What do you typically invest in?";
                    }
                    return "Money habits are personal and complex. No judgment here – just trying to understand so I can help!";
                }
            },
            {
                id: 'income_range',
                message: "If you're comfortable sharing – what's your approximate income range? This is totally optional and stays private. You can skip if you prefer.",
                field: 'incomeRange',
                type: 'choice',
                optional: true,
                options: [
                    { value: 'under_50k', label: 'Under $50k' },
                    { value: '50k-100k', label: '$50k - $100k' },
                    { value: '100k-200k', label: '$100k - $200k' },
                    { value: '200k-500k', label: '$200k - $500k' },
                    { value: '500k+', label: '$500k+' },
                    { value: 'skip', label: '🙈 Rather not say' },
                ],
                response: (v) => {
                    if (v === 'skip') return "Totally understand! Let's move on.";
                    return "Thanks for sharing. This helps me understand what kind of financial insights might be most relevant for you.";
                }
            },
            {
                id: 'savings',
                message: "What percentage of your income do you typically save each month? Roughly is fine.",
                field: 'savingsRate',
                type: 'text',
                optional: true,
                response: (v) => {
                    const numMatch = v.match(/(\d+)/);
                    const rate = numMatch ? parseInt(numMatch[1]) : 0;
                    
                    if (rate === 0 || v.toLowerCase().includes('none')) {
                        return "That's okay – many people are in that boat. Building savings is a journey.";
                    }
                    if (rate < 10) return "Every bit counts! Even small consistent savings add up over time.";
                    if (rate < 20) return "That's a solid savings rate! You're doing well.";
                    return "Wow, that's impressive! You're really prioritizing your future.";
                }
            },
            {
                id: 'financial_goals',
                message: "What are your main financial goals right now? What are you working toward?",
                field: 'financialGoals',
                type: 'multiselect',
                options: [
                    { value: 'emergency', label: '🆘 Build emergency fund' },
                    { value: 'debt_free', label: '💳 Pay off debt' },
                    { value: 'save_more', label: '💰 Save more money' },
                    { value: 'invest', label: '📈 Start/grow investments' },
                    { value: 'house', label: '🏠 Buy a home' },
                    { value: 'retire', label: '🏖️ Retire early' },
                    { value: 'business', label: '🚀 Start a business' },
                ],
                response: (v) => {
                    if (v.length === 0) return "No specific goals right now is fine! Sometimes we're just maintaining.";
                    if (v.length >= 3) return "Ambitious! Multiple goals are great – we can help you balance working toward all of them.";
                    return "Great goals! Having clear financial targets makes it easier to make progress.";
                }
            },
            {
                id: 'biggest_expense',
                message: "What's your biggest monthly expense category? Housing, food, transportation, something else?",
                field: 'biggestExpense',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('housing') || lower.includes('rent') || lower.includes('mortgage')) {
                        return "Housing is #1 for most people. It's usually the biggest lever for financial change too, though not always easy to adjust.";
                    }
                    if (lower.includes('food')) {
                        return "Food can really add up! Especially if you eat out a lot. That's actually one of the more controllable categories though.";
                    }
                    return "Understanding where money goes is the first step to optimizing it. We can help you track spending patterns.";
                }
            },
        ]
    },
    goals: {
        icon: '🎯',
        title: 'Goals & Dreams',
        intro: "This is my favorite part – let's talk about where you're heading. What do you want from life?",
        questions: [
            {
                id: 'life_vision',
                message: "Big question: If life went perfectly over the next 5-10 years, what would it look like? Dream with me! ✨",
                field: 'lifeVision',
                type: 'text',
                response: (v) => {
                    return "I love that vision! It's important to know what you're working toward. The clearer the picture, the easier it is to make decisions that align with it.";
                }
            },
            {
                id: 'one_year_goal',
                message: "Zooming in – what's one thing you really want to accomplish in the next 12 months?",
                field: 'oneYearGoal',
                type: 'text',
                response: (v) => {
                    return `"${v}" – that's a great focus! Having a clear one-year goal helps with prioritization. What would achieving that mean to you?`;
                }
            },
            {
                id: 'priorities',
                message: "What matters most to you right now? Pick your top 3.",
                field: 'priorities',
                type: 'multiselect',
                maxSelections: 3,
                options: [
                    { value: 'health', label: '💪 My health' },
                    { value: 'career', label: '💼 Career growth' },
                    { value: 'relationships', label: '❤️ Relationships' },
                    { value: 'money', label: '💰 Financial security' },
                    { value: 'growth', label: '📚 Personal growth' },
                    { value: 'happiness', label: '😊 Happiness/Joy' },
                    { value: 'adventure', label: '🎢 Adventure/Experiences' },
                    { value: 'family', label: '👨‍👩‍👧 Family' },
                    { value: 'creativity', label: '🎨 Creativity' },
                    { value: 'impact', label: '🌍 Making an impact' },
                ],
                response: (v) => {
                    if (v.length === 0) return "Still figuring out priorities is okay! Life is complex.";
                    return "Those are beautiful priorities. We'll help you make progress in all these areas!";
                }
            },
            {
                id: 'challenges',
                message: "What's holding you back right now? What challenges or obstacles are you facing?",
                field: 'currentChallenges',
                type: 'text',
                response: (v) => {
                    const lower = v.toLowerCase();
                    if (lower.includes('time')) {
                        return "Time is the universal constraint! We can definitely help you be more intentional with how you spend it.";
                    }
                    if (lower.includes('motivation') || lower.includes('discipline')) {
                        return "Motivation ebbs and flows for everyone. The trick is building systems that don't rely on motivation alone.";
                    }
                    if (lower.includes('money') || lower.includes('financial')) {
                        return "Financial constraints are real. Let's see how we can help you make progress within your means.";
                    }
                    if (lower.includes('health') || lower.includes('energy')) {
                        return "Health challenges ripple out to everything else. That's worth prioritizing.";
                    }
                    return "Knowing your obstacles is half the battle. Zeitline will help you work around and through them.";
                }
            },
            {
                id: 'success_definition',
                message: "Last one – what does 'success' mean to you personally? Not society's definition, yours.",
                field: 'successDefinition',
                type: 'text',
                response: (v) => {
                    return "That's a really thoughtful definition. Knowing what success means to YOU is so important – it's the compass for all your decisions. Thanks for sharing that with me! 💫";
                }
            },
        ]
    },
};

// ==================== DOM ELEMENTS ====================

const elements = {
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    voiceBtn: document.getElementById('voiceBtn'),
    suggestedResponses: document.getElementById('suggestedResponses'),
    sectionPills: document.getElementById('sectionPills'),
    progressRing: document.getElementById('progressRing'),
    progressText: document.getElementById('progressText'),
    completionModal: document.getElementById('completionModal'),
    completionSummary: document.getElementById('completionSummary'),
    optionsMenu: document.getElementById('optionsMenu'),
    moreBtn: document.getElementById('moreBtn'),
};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    // Check URL params for mode
    const urlParams = new URLSearchParams(window.location.search);
    state.mode = urlParams.get('mode') || 'new';
    const editSection = urlParams.get('section');
    
    if (editSection && state.mode === 'edit') {
        state.section = editSection;
    }
    
    // Load saved data
    loadSavedData();
    
    // Set up browser back button handling
    setupBrowserBackButton();
    
    // Set up event listeners
    setupEventListeners();
    
    // Try to use OpenAI API, fallback to local
    await checkAPIAvailability();
    
    // Start conversation
    setTimeout(() => {
        startConversation();
    }, 500);
}

function loadSavedData() {
    const savedData = localStorage.getItem('zeitline_onboarding_data');
    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            state.collectedData = parsed.collectedData || {};
            if (state.mode === 'continue') {
                state.section = parsed.section || 'life';
                state.questionIndex = parsed.questionIndex || 0;
            }
        } catch (e) {
            console.log('Could not load saved data');
        }
    }
}

function saveData() {
    const dataToSave = {
        section: state.section,
        questionIndex: state.questionIndex,
        collectedData: state.collectedData,
        timestamp: Date.now(),
    };
    localStorage.setItem('zeitline_onboarding_data', JSON.stringify(dataToSave));
}

async function checkAPIAvailability() {
    try {
        // Check if we have auth token
        if (typeof auth !== 'undefined' && auth.currentUser) {
            const token = await auth.currentUser.getIdToken();
            if (token) {
                state.useAI = true;
                console.log('OpenAI integration available');
            }
        }
    } catch (e) {
        console.log('Using local conversation flow');
        state.useAI = false;
    }
}

function setupEventListeners() {
    // Text input
    elements.chatInput.addEventListener('input', handleInputChange);
    elements.chatInput.addEventListener('keydown', handleKeyDown);
    
    // Send button
    elements.sendBtn.addEventListener('click', sendMessage);
    
    // Voice button
    elements.voiceBtn.addEventListener('click', toggleVoiceInput);
    
    // Section pills
    elements.sectionPills.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => jumpToSection(pill.dataset.section));
    });
    
    // More button
    elements.moreBtn.addEventListener('click', toggleOptionsMenu);
    
    // Options menu items
    document.getElementById('skipSectionBtn')?.addEventListener('click', skipToNextSection);
    document.getElementById('restartBtn')?.addEventListener('click', restartOnboarding);
    document.getElementById('saveExitBtn')?.addEventListener('click', saveAndExit);
    
    // Completion modal
    document.getElementById('goToDashboard')?.addEventListener('click', goToDashboard);
    document.getElementById('editAnswers')?.addEventListener('click', editAnswers);
    
    // Close menu on outside click
    document.addEventListener('click', (e) => {
        if (!elements.optionsMenu.contains(e.target) && !elements.moreBtn.contains(e.target)) {
            elements.optionsMenu.classList.remove('active');
        }
    });
}

// ==================== CONVERSATION FLOW ====================

async function startConversation() {
    const flow = questionFlows[state.section];
    
    // Try to use AI API for initial message if available
    if (state.useAI && typeof apiCall === 'function') {
        try {
            const response = await apiCall('/onboarding/start', {
                method: 'POST',
                body: JSON.stringify({
                    mode: state.mode,
                    section: state.section
                })
            });
            
            if (response.success && response.data) {
                const { message, state: apiState, suggestedResponses } = response.data;
                
                // Update local state
                state.conversationHistory = apiState.conversationHistory || [];
                state.collectedData = { ...state.collectedData, ...(apiState.collectedData || {}) };
                state.section = apiState.section || state.section;
                
                // Show welcome message
                addMessage(message, 'assistant');
                
                // Show suggested responses if available
                if (suggestedResponses && suggestedResponses.length > 0) {
                    setTimeout(() => {
                        showAISuggestedResponses(suggestedResponses);
                    }, 500);
                }
                
                // Save state
                saveData();
                updateSectionNav();
                updateProgress();
                return;
            }
        } catch (error) {
            console.error('AI start error, using local flow:', error);
            // Fall through to local flow
        }
    }
    
    // Fallback to local flow
    if (state.mode === 'new') {
        // New user welcome
        const greeting = getTimeGreeting();
        const welcomeMsg = state.collectedData.fullName 
            ? `${greeting}, ${state.collectedData.fullName.split(' ')[0]}! Ready to continue setting up your Zeitline?`
            : `${greeting}! 👋 I'm Zara, your Zeitline companion. I'm here to learn about you so we can personalize your experience.\n\nThis should take about 5-10 minutes, and you can always update things later. Let's begin!`;
        
        addMessage(welcomeMsg, 'assistant');
        
        // Add intro for section after a delay
        setTimeout(() => {
            addMessage(flow.intro, 'assistant');
            setTimeout(() => {
                showNextQuestion();
            }, 1500);
        }, 2000);
    } else if (state.mode === 'edit') {
        addMessage(`Let's update your ${flow.title} information. You can change anything or add new details.`, 'assistant');
        setTimeout(() => {
            showNextQuestion();
        }, 1500);
    } else {
        // Continue mode
        addMessage("Welcome back! Let's continue where we left off.", 'assistant');
        setTimeout(() => {
            showNextQuestion();
        }, 1500);
    }
    
    updateSectionNav();
    updateProgress();
}

function showNextQuestion() {
    const flow = questionFlows[state.section];
    
    if (state.questionIndex >= flow.questions.length) {
        // Section complete
        markSectionComplete();
        moveToNextSection();
        return;
    }
    
    const question = flow.questions[state.questionIndex];
    
    // Show typing indicator then question
    showTypingIndicator();
    
    setTimeout(() => {
        hideTypingIndicator();
        addMessage(question.message, 'assistant');
        
        // Show quick responses if applicable
        if (question.type === 'choice' || question.type === 'multiselect') {
            setTimeout(() => {
                showQuickResponses(question);
            }, 500);
        }
    }, 800 + Math.random() * 400);
}

function showQuickResponses(question) {
    elements.suggestedResponses.innerHTML = '';
    elements.suggestedResponses.classList.remove('multi-select');
    
    if (question.type === 'multiselect') {
        elements.suggestedResponses.classList.add('multi-select');
        let selectedValues = [];
        
        question.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'suggestion-btn';
            btn.textContent = opt.label;
            btn.dataset.value = opt.value;
            
            btn.addEventListener('click', () => {
                btn.classList.toggle('selected');
                if (btn.classList.contains('selected')) {
                    selectedValues.push(opt.value);
                } else {
                    selectedValues = selectedValues.filter(v => v !== opt.value);
                }
            });
            
            elements.suggestedResponses.appendChild(btn);
        });
        
        // Add confirm button
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'confirm-selection-btn';
        confirmBtn.textContent = 'Continue';
        confirmBtn.addEventListener('click', () => {
            const selectedLabels = question.options
                .filter(opt => selectedValues.includes(opt.value))
                .map(opt => opt.label)
                .join(', ');
            
            elements.suggestedResponses.classList.remove('active');
            addMessage(selectedLabels || 'None selected', 'user');
            processResponse(selectedValues, question);
        });
        elements.suggestedResponses.appendChild(confirmBtn);
        
    } else {
        question.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'suggestion-btn';
            btn.textContent = opt.label;
            
            btn.addEventListener('click', () => {
                elements.suggestedResponses.classList.remove('active');
                addMessage(opt.label, 'user');
                processResponse(opt.value, question);
            });
            
            elements.suggestedResponses.appendChild(btn);
        });
    }
    
    // Add skip option for optional questions
    if (question.optional) {
        const skipBtn = document.createElement('button');
        skipBtn.className = 'suggestion-btn';
        skipBtn.textContent = '⏭️ Skip this one';
        skipBtn.addEventListener('click', () => {
            elements.suggestedResponses.classList.remove('active');
            addMessage('I\'ll skip this one', 'user');
            advanceToNextQuestion();
        });
        elements.suggestedResponses.appendChild(skipBtn);
    }
    
    elements.suggestedResponses.classList.add('active');
}

function hideQuickResponses() {
    elements.suggestedResponses.classList.remove('active');
    elements.suggestedResponses.innerHTML = '';
}

// ==================== MESSAGE HANDLING ====================

function handleInputChange() {
    const hasText = elements.chatInput.value.trim().length > 0;
    elements.sendBtn.disabled = !hasText;
    
    // Auto-resize textarea
    elements.chatInput.style.height = 'auto';
    elements.chatInput.style.height = Math.min(elements.chatInput.scrollHeight, 120) + 'px';
}

function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

async function sendMessage() {
    const text = elements.chatInput.value.trim();
    if (!text) return;
    
    // Clear input
    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';
    elements.sendBtn.disabled = true;
    
    // Hide quick responses
    hideQuickResponses();
    
    // Add user message
    addMessage(text, 'user');
    
    // Show typing indicator
    showTypingIndicator();
    
    // Use AI API if available, otherwise fall back to fixed flow
    if (state.useAI && typeof apiCall === 'function') {
        try {
            await processWithAI(text);
        } catch (error) {
            console.error('AI error, falling back to local flow:', error);
            // Fall back to local flow
            const flow = questionFlows[state.section];
            const question = flow.questions[state.questionIndex];
            processResponse(text, question);
        }
    } else {
        // Use fixed question flow
        const flow = questionFlows[state.section];
        const question = flow.questions[state.questionIndex];
        processResponse(text, question);
    }
}

async function processWithAI(userMessage) {
    try {
        // Prepare state for API
        const apiState = {
            section: state.section,
            conversationHistory: state.conversationHistory,
            collectedData: state.collectedData,
            questionsAsked: []
        };
        
        // Call AI API
        const response = await apiCall('/onboarding/chat', {
            method: 'POST',
            body: JSON.stringify({
                message: userMessage,
                state: apiState
            })
        });
        
        if (response.success && response.data) {
            const { message, dataCollected, nextQuestion, sectionComplete, suggestedResponses, updatedState } = response.data;
            
            // Update state with AI response
            state.conversationHistory = updatedState.conversationHistory;
            state.collectedData = { ...state.collectedData, ...dataCollected };
            saveData();
            
            // Hide typing indicator
            hideTypingIndicator();
            
            // Show AI response
            addMessage(message, 'assistant');
            
            // Show suggested responses if available
            if (suggestedResponses && suggestedResponses.length > 0) {
                setTimeout(() => {
                    showAISuggestedResponses(suggestedResponses);
                }, 500);
            }
            
            // Handle section completion
            if (sectionComplete) {
                setTimeout(() => {
                    markSectionComplete();
                    moveToNextSection();
                }, 2000);
            } else if (nextQuestion) {
                // AI will ask next question in the response message
                // No need to manually advance
            }
        } else {
            throw new Error(response.error || 'AI response failed');
        }
    } catch (error) {
        console.error('AI processing error:', error);
        hideTypingIndicator();
        addMessage("I'm having trouble processing that. Could you try rephrasing?", 'assistant');
        // Fall back to local flow
        const flow = questionFlows[state.section];
        const question = flow.questions[state.questionIndex];
        processResponse(userMessage, question);
    }
}

function processResponse(value, question) {
    let processedValue = value;
    
    // Parse dates
    if (question && question.type === 'date') {
        const parsed = parseDate(value);
        if (parsed) {
            processedValue = parsed.toISOString().split('T')[0];
            const age = calculateAge(parsed);
            state.collectedData._parsedAge = age;
            state.collectedData.age = age;
        }
    }
    
    // Apply custom parse function if defined
    if (question && question.parse && typeof question.parse === 'function') {
        processedValue = question.parse(value);
    }
    
    // Validate if needed
    if (question && question.validate && !question.validate(processedValue)) {
        showTypingIndicator();
        setTimeout(() => {
            hideTypingIndicator();
            addMessage("I didn't quite catch that. Could you try again?", 'assistant');
        }, 800);
        return;
    }
    
    // Store the data
    if (question && question.field) {
        state.collectedData[question.field] = processedValue;
        saveData();
    }
    
    // Show response
    if (question && question.response) {
        showTypingIndicator();
        setTimeout(() => {
            hideTypingIndicator();
            const responseText = question.response(processedValue, state.collectedData);
            addMessage(responseText, 'assistant');
            
            // Advance to next question after response
            setTimeout(() => {
                advanceToNextQuestion();
            }, 1500);
        }, 1000 + Math.random() * 500);
    } else {
        advanceToNextQuestion();
    }
}

function showAISuggestedResponses(suggestions) {
    elements.suggestedResponses.innerHTML = '';
    elements.suggestedResponses.classList.remove('multi-select');
    
    suggestions.forEach(suggestion => {
        const btn = document.createElement('button');
        btn.className = 'suggestion-btn';
        btn.textContent = suggestion;
        
        btn.addEventListener('click', () => {
            elements.suggestedResponses.classList.remove('active');
            addMessage(suggestion, 'user');
            sendMessage();
        });
        
        elements.suggestedResponses.appendChild(btn);
    });
    
    elements.suggestedResponses.classList.add('active');
}

function advanceToNextQuestion() {
    state.questionIndex++;
    saveData();
    updateProgress();
    showNextQuestion();
}

// ==================== UI HELPERS ====================

function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    // Update conversation history for AI
    if (!state.conversationHistory) {
        state.conversationHistory = [];
    }
    state.conversationHistory.push({
        role: sender === 'assistant' ? 'assistant' : 'user',
        content: text
    });
    
    const avatarContent = sender === 'assistant' ? 'Z' : '👤';
    
    messageDiv.innerHTML = `
        <div class="message-avatar">${avatarContent}</div>
        <div class="message-content">
            <div class="message-bubble">
                <p>${formatMessage(text)}</p>
            </div>
            <span class="message-time">${getTimeString()}</span>
        </div>
    `;
    
    elements.chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

function showTypingIndicator() {
    state.isTyping = true;
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant typing-msg';
    typingDiv.id = 'typingIndicator';
    typingDiv.innerHTML = `
        <div class="message-avatar">Z</div>
        <div class="message-content">
            <div class="message-bubble">
                <div class="typing-indicator">
                    <span></span><span></span><span></span>
                </div>
            </div>
        </div>
    `;
    
    elements.chatMessages.appendChild(typingDiv);
    scrollToBottom();
}

function hideTypingIndicator() {
    state.isTyping = false;
    const typingEl = document.getElementById('typingIndicator');
    if (typingEl) typingEl.remove();
}

function scrollToBottom() {
    setTimeout(() => {
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }, 100);
}

function formatMessage(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '</p><p>');
}

// ==================== SECTION NAVIGATION ====================

function updateSectionNav() {
    const pills = elements.sectionPills.querySelectorAll('.pill');
    pills.forEach(pill => {
        pill.classList.remove('active');
        if (pill.dataset.section === state.section) {
            pill.classList.add('active');
        }
    });
}

function markSectionComplete() {
    const pill = elements.sectionPills.querySelector(`[data-section="${state.section}"]`);
    if (pill) {
        pill.classList.add('completed');
    }
}

function moveToNextSection() {
    const sections = ['life', 'health', 'diet', 'financial', 'goals'];
    const currentIndex = sections.indexOf(state.section);
    
    if (currentIndex < sections.length - 1) {
        state.section = sections[currentIndex + 1];
        state.questionIndex = 0;
        
        // Show section transition
        const nextFlow = questionFlows[state.section];
        
        const transitionDiv = document.createElement('div');
        transitionDiv.className = 'section-transition';
        transitionDiv.innerHTML = `
            <div class="section-transition-icon">${nextFlow.icon}</div>
            <h2>${nextFlow.title}</h2>
            <p>${nextFlow.intro}</p>
        `;
        elements.chatMessages.appendChild(transitionDiv);
        scrollToBottom();
        
        updateSectionNav();
        saveData();
        
        setTimeout(() => {
            showNextQuestion();
        }, 2500);
    } else {
        // All sections complete!
        showCompletionModal();
    }
}

function jumpToSection(sectionName) {
    if (questionFlows[sectionName]) {
        state.section = sectionName;
        state.questionIndex = 0;
        
        updateSectionNav();
        saveData();
        
        // Clear chat and show new section
        elements.chatMessages.innerHTML = '';
        hideQuickResponses();
        
        const flow = questionFlows[sectionName];
        addMessage(`Let's talk about your ${flow.title.toLowerCase()}!`, 'assistant');
        
        setTimeout(() => {
            addMessage(flow.intro, 'assistant');
            setTimeout(() => {
                showNextQuestion();
            }, 1500);
        }, 1500);
    }
}

function skipToNextSection() {
    elements.optionsMenu.classList.remove('active');
    markSectionComplete();
    moveToNextSection();
}

// ==================== COMPLETION ====================

function showCompletionModal() {
    // Build summary
    const summaryHtml = `
        <div class="summary-stat">
            <div class="summary-stat-value">${state.collectedData.fullName?.split(' ')[0] || 'You'}</div>
            <div class="summary-stat-label">Welcome!</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${state.collectedData.priorities?.length || 0}</div>
            <div class="summary-stat-label">Priorities Set</div>
        </div>
        <div class="summary-stat">
            <div class="summary-stat-value">${Object.keys(state.collectedData).length}</div>
            <div class="summary-stat-label">Details Shared</div>
        </div>
    `;
    elements.completionSummary.innerHTML = summaryHtml;
    
    // Show modal
    elements.completionModal.classList.add('active');
    
    // Mark onboarding complete
    completeOnboarding();
}

async function completeOnboarding() {
    localStorage.setItem('zeitline_onboarding_complete', 'true');
    
    // Transform data to profile format
    const profileData = {
        personal: {
            fullName: state.collectedData.fullName || '',
            age: state.collectedData.age || 0,
            birthday: state.collectedData.birthday || '',
            occupation: state.collectedData.occupation || '',
            city: state.collectedData.city || '',
        },
        lifestyle: {
            workStyle: state.collectedData.workStyle || '',
            chronotype: state.collectedData.chronotype || '',
            livingWith: state.collectedData.livingWith || '',
            hobbies: state.collectedData.hobbies || '',
        },
        health: {
            exerciseFrequency: state.collectedData.exerciseFrequency || '',
            sleepHours: state.collectedData.sleepHours || 0,
            stressScore: state.collectedData.stressScore || 5,
        },
        diet: {
            dietType: state.collectedData.dietType || '',
            cookingFrequency: state.collectedData.cookingFrequency || '',
        },
        financial: {
            incomeRange: state.collectedData.incomeRange || '',
            savingsRate: state.collectedData.savingsRate || '',
            financialGoals: state.collectedData.financialGoals || [],
        },
        goals: {
            lifeVision: state.collectedData.lifeVision || '',
            oneYearGoal: state.collectedData.oneYearGoal || '',
            priorities: state.collectedData.priorities || [],
            challenges: state.collectedData.currentChallenges || '',
        },
        onboardingComplete: true,
    };
    
    localStorage.setItem('zeitline_profile', JSON.stringify(profileData));
    
    // Try to save to server
    try {
        if (typeof auth !== 'undefined' && auth.currentUser) {
            const token = await auth.currentUser.getIdToken();
            await fetch(`${API_BASE}/onboarding/complete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ collectedData: state.collectedData }),
            });
        }
    } catch (e) {
        console.log('Saved locally');
    }
}

function goToDashboard() {
    window.location.href = '/dashboard.html';
}

// Handle browser back button to go to dashboard
function setupBrowserBackButton() {
    // Push initial state so we can detect back button
    history.pushState({ onboarding: true }, '', window.location.href);
    
    window.addEventListener('popstate', (event) => {
        // User pressed browser back button - save and go to dashboard
        saveData();
        window.location.href = '/dashboard.html';
    });
}

function editAnswers() {
    elements.completionModal.classList.remove('active');
    state.section = 'life';
    state.questionIndex = 0;
    state.mode = 'edit';
    
    elements.chatMessages.innerHTML = '';
    startConversation();
}

// ==================== UTILITY FUNCTIONS ====================

function getTimeGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

function getTimeString() {
    return new Date().toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    });
}

function parseDate(text) {
    const date = new Date(text);
    if (!isNaN(date.getTime())) {
        return date;
    }
    return null;
}

function extractOccupation(text) {
    // Remove common prefixes like "I'm a", "I am a", "I work as a", etc.
    let occupation = text
        .replace(/^(i'm a|i am a|i'm an|i am an|i work as a|i work as an|i'm|i am)\s+/i, '')
        .replace(/^(a|an)\s+/i, '')
        .trim();
    
    // Capitalize first letter
    if (occupation.length > 0) {
        occupation = occupation.charAt(0).toUpperCase() + occupation.slice(1);
    }
    
    return occupation;
}

function calculateAge(birthDate) {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

function updateProgress() {
    const sections = ['life', 'health', 'diet', 'financial', 'goals'];
    const currentSectionIndex = sections.indexOf(state.section);
    
    let totalQuestions = 0;
    let completedQuestions = 0;
    
    sections.forEach((section, i) => {
        const sectionQuestions = questionFlows[section].questions.length;
        totalQuestions += sectionQuestions;
        
        if (i < currentSectionIndex) {
            completedQuestions += sectionQuestions;
        } else if (i === currentSectionIndex) {
            completedQuestions += state.questionIndex;
        }
    });
    
    const percent = Math.round((completedQuestions / totalQuestions) * 100);
    
    elements.progressRing.style.strokeDasharray = `${percent}, 100`;
    elements.progressText.textContent = `${percent}%`;
}

function toggleOptionsMenu() {
    elements.optionsMenu.classList.toggle('active');
}

function toggleVoiceInput() {
    // Voice input implementation would go here
    // For now, just show a message
    if (!state.isListening) {
        elements.voiceBtn.classList.add('listening');
        state.isListening = true;
        
        // Start speech recognition if available
        if ('webkitSpeechRecognition' in window) {
            const recognition = new webkitSpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            
            recognition.onresult = (event) => {
                const transcript = Array.from(event.results)
                    .map(result => result[0].transcript)
                    .join('');
                elements.chatInput.value = transcript;
                handleInputChange();
            };
            
            recognition.onend = () => {
                elements.voiceBtn.classList.remove('listening');
                state.isListening = false;
            };
            
            recognition.start();
        } else {
            setTimeout(() => {
                elements.voiceBtn.classList.remove('listening');
                state.isListening = false;
                alert('Voice input is not supported in your browser. Try Chrome!');
            }, 1000);
        }
    }
}

function restartOnboarding() {
    elements.optionsMenu.classList.remove('active');
    
    if (confirm('Are you sure? This will clear all your answers and start fresh.')) {
        localStorage.removeItem('zeitline_onboarding_data');
        localStorage.removeItem('zeitline_onboarding_complete');
        state.section = 'life';
        state.questionIndex = 0;
        state.collectedData = {};
        state.mode = 'new';
        
        elements.chatMessages.innerHTML = '';
        elements.sectionPills.querySelectorAll('.pill').forEach(p => p.classList.remove('completed'));
        hideQuickResponses();
        
        startConversation();
    }
}

function saveAndExit() {
    elements.optionsMenu.classList.remove('active');
    saveData();
    window.location.href = '/dashboard.html';
}

