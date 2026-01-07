// Test script to verify calendar population from onboarding data
// Run this in the browser console on the calendar page

async function testCalendarPopulation() {
    console.log('🧪 Testing Calendar Population from Onboarding Data');
    console.log('==================================================');
    
    // Step 1: Check if user is logged in
    if (typeof firebase === 'undefined' || !firebase.auth) {
        console.error('❌ Firebase not loaded');
        return;
    }
    
    const user = firebase.auth().currentUser;
    if (!user) {
        console.error('❌ User not logged in. Please log in first.');
        console.log('💡 To test: Log in, then run this script again.');
        return;
    }
    
    console.log('✅ User logged in:', user.email);
    
    // Step 2: Check for onboarding data
    const onboardingData = localStorage.getItem('zeitline_onboarding_data');
    if (!onboardingData) {
        console.warn('⚠️ No onboarding data found in localStorage');
        console.log('💡 Complete onboarding first, then check calendar');
        return;
    }
    
    const parsed = JSON.parse(onboardingData);
    console.log('✅ Found onboarding data');
    console.log('Collected data keys:', Object.keys(parsed.collectedData || {}));
    
    // Step 3: Check if calendar was already populated
    const calendarPopulated = localStorage.getItem('zeitline_calendar_populated');
    console.log('Calendar populated flag:', calendarPopulated);
    
    // Step 4: Check for routine data
    const collectedData = parsed.collectedData || {};
    const hasRoutines = !!(collectedData.routines || collectedData.wakeTime || collectedData.workStartTime);
    console.log('Has routine data:', hasRoutines);
    
    if (!hasRoutines) {
        console.warn('⚠️ No routine/time data found in onboarding');
        console.log('💡 Complete onboarding with time-based questions like:');
        console.log('   - "What time do you wake up?"');
        console.log('   - "Does this differ on weekends?"');
        console.log('   - "What time do you have breakfast?"');
        return;
    }
    
    // Step 5: Try to populate calendar
    console.log('\n🔄 Attempting to populate calendar...');
    
    try {
        const routines = collectedData.routines || {
            weekday: {
                wakeTime: collectedData.wakeTimeWeekday || collectedData.wakeTime,
                bedtime: collectedData.bedtimeWeekday || collectedData.bedtime,
                workStart: collectedData.workStartTime,
                workEnd: collectedData.workEndTime,
                meals: {
                    breakfast: collectedData.breakfastTime,
                    lunch: collectedData.lunchTime,
                    dinner: collectedData.dinnerTime,
                },
                exercise: collectedData.exerciseTime ? {
                    time: collectedData.exerciseTime,
                    days: collectedData.exerciseDays || [],
                    duration: collectedData.exerciseDuration || "60",
                } : null,
            },
            weekend: {
                wakeTime: collectedData.wakeTimeWeekend,
                bedtime: collectedData.bedtimeWeekend,
                meals: collectedData.mealTimesWeekend || {},
            },
        };
        
        const onboardingDataForAPI = {
            ...collectedData,
            routines,
        };
        
        console.log('Sending data to API:', {
            hasRoutines: !!routines,
            weekdayRoutine: routines.weekday,
            weekendRoutine: routines.weekend
        });
        
        const response = await apiCall('/calendars/populate-from-onboarding', {
            method: 'POST',
            body: JSON.stringify({ onboardingData: onboardingDataForAPI })
        });
        
        if (response.success) {
            console.log(`✅ Successfully populated calendar with ${response.data.eventsCreated} events`);
            console.log('Created events:', response.data.events);
            localStorage.setItem('zeitline_calendar_populated', 'true');
            
            // Reload calendar events
            console.log('\n🔄 Reloading calendar events...');
            await loadCalendarEvents();
            
            // Check if events are now visible
            const zeitlineEvents = Object.values(calendarEvents).flat().filter(e => 
                e.calendarType === 'zeitline' && e.source === 'onboarding'
            );
            
            if (zeitlineEvents.length > 0) {
                console.log(`\n✅ SUCCESS! Found ${zeitlineEvents.length} Zeitline onboarding events in calendar`);
                console.log('Events:', zeitlineEvents.map(e => `${e.title} (${e.start})`));
                
                // Re-render calendar
                if (currentView === 'month') {
                    renderCalendar();
                } else if (currentView === 'week') {
                    renderWeekView();
                } else if (currentView === 'day') {
                    renderDayView();
                }
            } else {
                console.warn('⚠️ Events were created but not found in calendarEvents');
                console.log('Try refreshing the page or switching calendar views');
            }
        } else {
            console.error('❌ Failed to populate calendar:', response.error);
        }
    } catch (error) {
        console.error('❌ Error:', error);
        console.error('Error details:', error.message);
    }
}

// Run the test
testCalendarPopulation();

