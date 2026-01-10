// Events & Tasks Manager for Zeitline Web Dashboard
// Handles display and management of AI-extracted discussion points and tasks

class EventsManager {
    constructor() {
        this.discussionPoints = [];
        this.tasks = [];
        this.discussionFilter = 'all';
        this.taskFilter = 'pending';
        this.draggedItem = null;
        this.unsubscribeSessions = null;
        this.unsubscribeTasks = null;
        
        this.init();
    }
    
    async init() {
        await this.waitForAuth();
        this.setupEventListeners();
        this.setupRealtimeListeners();
    }
    
    async waitForAuth() {
        return new Promise((resolve) => {
            const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                if (user) {
                    unsubscribe();
                    resolve(user);
                }
            });
        });
    }
    
    setupEventListeners() {
        // Discussion filter chips
        document.querySelectorAll('.discussion-panel .filter-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                document.querySelectorAll('.discussion-panel .filter-chip').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                this.discussionFilter = e.target.dataset.filter;
                this.renderDiscussionPoints();
            });
        });
        
        // Task filter chips
        document.querySelectorAll('.tasks-panel .filter-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                document.querySelectorAll('.tasks-panel .filter-chip').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                this.taskFilter = e.target.dataset.filter;
                this.renderTasks();
            });
        });
        
        // Drop zone
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('active');
            });
            
            dropZone.addEventListener('dragleave', () => {
                dropZone.classList.remove('active');
            });
            
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('active');
                
                const pointId = e.dataTransfer.getData('text/plain');
                this.addPointToTasks(pointId);
            });
        }
    }
    
    /**
     * Set up real-time Firebase listeners for automatic updates
     */
    setupRealtimeListeners() {
        const userId = firebase.auth().currentUser?.uid;
        if (!userId) {
            console.error('No user ID for real-time listeners');
            return;
        }
        
        const db = firebase.firestore();
        
        console.log('🔄 Setting up real-time listeners for user:', userId);
        
        // Listen for conversation sessions (contains discussion points)
        this.unsubscribeSessions = db.collection('users').doc(userId)
            .collection('conversationSessions')
            .orderBy('startedAt', 'desc')
            .limit(50)
            .onSnapshot((snapshot) => {
                console.log(`📥 Received ${snapshot.docs.length} conversation sessions`);
                
                this.discussionPoints = [];
                
                snapshot.docs.forEach(sessionDoc => {
                    const sessionData = sessionDoc.data();
                    
                    // Get points from the session document
                    if (sessionData.points && Array.isArray(sessionData.points)) {
                        const points = sessionData.points.map(p => ({
                            ...p,
                            id: p.id || `${sessionDoc.id}_${Math.random().toString(36).substr(2, 9)}`,
                            sessionId: sessionDoc.id,
                            recordingId: sessionData.recordingId
                        }));
                        this.discussionPoints.push(...points);
                        console.log(`  - Session ${sessionDoc.id}: ${points.length} points`);
                    }
                });
                
                // Sort by creation time (newest first)
                this.discussionPoints.sort((a, b) => {
                    const dateA = this.parseDate(a.createdAt);
                    const dateB = this.parseDate(b.createdAt);
                    return dateB - dateA;
                });
                
                console.log(`📊 Total discussion points: ${this.discussionPoints.length}`);
                this.renderDiscussionPoints();
                
            }, (error) => {
                console.error('Error listening to conversation sessions:', error);
            });
        
        // Listen for task list updates
        this.unsubscribeTasks = db.collection('users').doc(userId)
            .collection('taskLists').doc('master')
            .onSnapshot((doc) => {
                if (doc.exists) {
                    this.tasks = doc.data().tasks || [];
                    console.log(`📥 Received ${this.tasks.length} tasks`);
                } else {
                    this.tasks = [];
                    console.log('📥 No task list found');
                }
                
                this.renderTasks();
                
            }, (error) => {
                console.error('Error listening to tasks:', error);
            });
    }
    
    parseDate(dateValue) {
        if (!dateValue) return new Date(0);
        if (dateValue.toDate) return dateValue.toDate();
        if (typeof dateValue === 'string') return new Date(dateValue);
        return new Date(dateValue);
    }
    
    // Cleanup listeners when needed
    cleanup() {
        if (this.unsubscribeSessions) this.unsubscribeSessions();
        if (this.unsubscribeTasks) this.unsubscribeTasks();
    }
    
    renderDiscussionPoints() {
        const container = document.getElementById('discussionList');
        const emptyState = document.getElementById('discussionEmpty');
        const countEl = document.getElementById('discussionCount');
        
        // Filter points
        let filtered = this.discussionPoints;
        if (this.discussionFilter !== 'all') {
            filtered = this.discussionPoints.filter(p => 
                p.type === this.discussionFilter || 
                p.type?.includes(this.discussionFilter)
            );
        }
        
        countEl.textContent = filtered.length;
        
        if (filtered.length === 0) {
            emptyState.style.display = 'block';
            container.style.display = 'none';
            
            // Update empty state message based on filter
            if (this.discussionFilter !== 'all') {
                emptyState.innerHTML = `
                    <div class="empty-state-icon">🔍</div>
                    <h3>No ${this.discussionFilter} points found</h3>
                    <p>Try selecting "All" to see all discussion points.</p>
                `;
            } else {
                emptyState.innerHTML = `
                    <div class="empty-state-icon">💬</div>
                    <h3>No Discussion Points Yet</h3>
                    <p>Discussion points are automatically extracted when you record voice memos on your Apple Watch. They'll appear here in real-time!</p>
                `;
            }
            return;
        }
        
        emptyState.style.display = 'none';
        container.style.display = 'block';
        
        container.innerHTML = filtered.map(point => this.createDiscussionCard(point)).join('');
        
        // Setup drag events
        container.querySelectorAll('.discussion-card').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', card.dataset.id);
                card.classList.add('dragging');
            });
            
            card.addEventListener('dragend', () => {
                card.classList.remove('dragging');
            });
        });
        
        // Add button click handlers
        container.querySelectorAll('.add-to-tasks-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pointId = e.target.closest('.discussion-card').dataset.id;
                this.addPointToTasks(pointId);
            });
        });
    }
    
    createDiscussionCard(point) {
        const typeClass = (point.type || 'other').replace(/_/g, '-');
        const isAdded = point.addedToTaskList;
        
        return `
            <div class="discussion-card ${isAdded ? 'added' : ''}" 
                 data-id="${point.id}" 
                 draggable="${!isAdded}">
                <div class="discussion-header">
                    <span class="discussion-type ${typeClass}">
                        ${(point.type || 'other').replace(/_/g, ' ')}
                    </span>
                    ${point.speaker ? `<span class="discussion-speaker">${point.speaker}</span>` : ''}
                    ${!isAdded ? `<button class="add-to-tasks-btn">+ Add to Tasks</button>` : '<span style="color: #22c55e; font-size: 0.75rem;">✓ Added</span>'}
                </div>
                <div class="discussion-content">${point.content}</div>
                <div class="discussion-meta">
                    ${point.mentionedDateTime ? `<span>📅 ${this.formatDate(point.mentionedDateTime)}</span>` : ''}
                    ${point.location ? `<span>📍 ${point.location}</span>` : ''}
                    ${point.mentionedPeople?.length ? `<span>👥 ${point.mentionedPeople.join(', ')}</span>` : ''}
                </div>
            </div>
        `;
    }
    
    renderTasks() {
        const container = document.getElementById('tasksList');
        const countEl = document.getElementById('taskCount');
        
        // Filter tasks
        let filtered = this.tasks;
        if (this.taskFilter === 'pending') {
            filtered = this.tasks.filter(t => t.status !== 'completed');
        } else if (this.taskFilter === 'completed') {
            filtered = this.tasks.filter(t => t.status === 'completed');
        }
        
        countEl.textContent = this.tasks.filter(t => t.status !== 'completed').length;
        
        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">✅</div>
                    <h3>${this.taskFilter === 'completed' ? 'No completed tasks' : 'No pending tasks'}</h3>
                    <p>Drag items from discussion points or extract tasks from recordings.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = filtered.map(task => this.createTaskCard(task)).join('');
        
        // Setup event handlers
        container.querySelectorAll('.task-checkbox').forEach(checkbox => {
            checkbox.addEventListener('click', (e) => {
                const taskId = e.target.closest('.task-card').dataset.id;
                this.toggleTaskComplete(taskId);
            });
        });
        
        container.querySelectorAll('.calendar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const taskId = e.target.closest('.task-card').dataset.id;
                this.addToCalendar(taskId);
            });
        });
        
        container.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const taskId = e.target.closest('.task-card').dataset.id;
                this.deleteTask(taskId);
            });
        });
    }
    
    createTaskCard(task) {
        const isCompleted = task.status === 'completed';
        const categoryIcons = {
            meeting: '👥', call: '📞', deadline: '⏰', reminder: '🔔',
            errand: '🛒', work: '💼', personal: '👤', health: '❤️',
            travel: '✈️', other: '📋'
        };
        const icon = categoryIcons[task.category] || '📋';
        
        return `
            <div class="task-card ${isCompleted ? 'completed' : ''}" data-id="${task.id}">
                <div class="task-header">
                    <button class="task-checkbox ${isCompleted ? 'checked' : ''}">
                        ${isCompleted ? '✓' : ''}
                    </button>
                    <div class="task-info">
                        <div class="task-title ${isCompleted ? 'completed' : ''}">
                            ${icon} ${task.title}
                        </div>
                        ${task.details ? `<div class="task-details">${task.details}</div>` : ''}
                        <div class="task-meta">
                            ${task.suggestedDate ? `<span>📅 ${this.formatDate(task.suggestedDate)}</span>` : ''}
                            ${task.location ? `<span>📍 ${task.location}</span>` : ''}
                            ${task.participants?.length ? `<span>👥 ${task.participants.length}</span>` : ''}
                            ${task.priority ? `<span>⚡ P${task.priority}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div class="task-actions">
                    ${task.suggestedDate && !task.addedToCalendar ? 
                        `<button class="task-action-btn calendar calendar-btn">📅 Add to Calendar</button>` : ''}
                    <button class="task-action-btn delete delete-btn">🗑️ Delete</button>
                </div>
            </div>
        `;
    }
    
    async addPointToTasks(pointId) {
        const point = this.discussionPoints.find(p => p.id === pointId);
        if (!point || point.addedToTaskList) return;
        
        const userId = firebase.auth().currentUser?.uid;
        if (!userId) return;
        
        const db = firebase.firestore();
        
        // Create task from point
        const newTask = {
            id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            title: point.content,
            details: point.details || null,
            location: point.location || null,
            participants: point.mentionedPeople || [],
            subtasks: [],
            suggestedDate: point.mentionedDateTime || null,
            priority: null,
            category: this.mapTypeToCategory(point.type),
            sessionId: point.sessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            addedToCalendar: false,
            status: 'pending'
        };
        
        // Add to local tasks
        this.tasks.unshift(newTask);
        
        // Mark point as added
        point.addedToTaskList = true;
        
        // Save to Firebase
        try {
            const taskListRef = db.collection('users').doc(userId)
                .collection('taskLists').doc('master');
            
            await taskListRef.set({
                userId,
                tasks: this.tasks,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
            
            // Update the conversation point
            if (point.sessionId) {
                const sessionRef = db.collection('users').doc(userId)
                    .collection('conversationSessions').doc(point.sessionId);
                
                const sessionDoc = await sessionRef.get();
                if (sessionDoc.exists && sessionDoc.data().points) {
                    const updatedPoints = sessionDoc.data().points.map(p => 
                        p.id === pointId ? { ...p, addedToTaskList: true, linkedTaskId: newTask.id } : p
                    );
                    await sessionRef.update({ points: updatedPoints });
                }
            }
            
            this.showToast('Task added successfully!');
        } catch (error) {
            console.error('Error adding task:', error);
        }
        
        // Re-render
        this.renderDiscussionPoints();
        this.renderTasks();
    }
    
    async toggleTaskComplete(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        task.status = task.status === 'completed' ? 'pending' : 'completed';
        task.updatedAt = new Date().toISOString();
        
        await this.saveTasks();
        this.renderTasks();
    }
    
    async deleteTask(taskId) {
        this.tasks = this.tasks.filter(t => t.id !== taskId);
        await this.saveTasks();
        this.renderTasks();
    }
    
    async saveTasks() {
        const userId = firebase.auth().currentUser?.uid;
        if (!userId) return;
        
        const db = firebase.firestore();
        
        try {
            await db.collection('users').doc(userId)
                .collection('taskLists').doc('master')
                .set({
                    userId,
                    tasks: this.tasks,
                    lastUpdated: new Date().toISOString()
                }, { merge: true });
        } catch (error) {
            console.error('Error saving tasks:', error);
        }
    }
    
    async addToCalendar(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        // Store the current task for later
        this.currentTaskForCalendar = task;
        
        // Show the modal
        const modal = document.getElementById('addEventModal');
        const form = document.getElementById('addEventForm');
        const aiLoading = document.getElementById('aiSuggestingTime');
        const aiSuggestion = document.getElementById('aiTimeSuggestion');
        
        if (!modal) {
            console.error('Modal not found');
            return;
        }
        
        // Show modal with loading state
        modal.style.display = 'flex';
        if (form) form.style.display = 'none';
        if (aiLoading) aiLoading.style.display = 'block';
        if (aiSuggestion) aiSuggestion.style.display = 'none';
        
        // Pre-fill basic fields
        document.getElementById('eventTitle').value = task.title || '';
        document.getElementById('eventDescription').value = task.details || '';
        document.getElementById('eventLocation').value = task.location || '';
        
        try {
            // Get AI time suggestion
            const user = firebase.auth().currentUser;
            if (!user) throw new Error('Not logged in');
            
            const token = await user.getIdToken();
            
            // Get user's timezone offset in minutes
            const timezoneOffset = new Date().getTimezoneOffset();
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            
            const response = await fetch('/api/calendars/suggest-time', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    taskTitle: task.title,
                    taskDetails: task.details,
                    taskDuration: 60, // Default 1 hour
                    preferredDate: task.suggestedDate,
                    timezoneOffset: timezoneOffset,
                    timezone: timezone
                })
            });
            
            if (!response.ok) throw new Error('Failed to get AI suggestion');
            
            const result = await response.json();
            const suggestion = result.data;
            
            // Use the date/time strings directly from the server (already in user's timezone)
            document.getElementById('eventStartDate').value = suggestion.startDate;
            document.getElementById('eventStartTime').value = suggestion.startTime;
            document.getElementById('eventEndDate').value = suggestion.endDate;
            document.getElementById('eventEndTime').value = suggestion.endTime;
            
            // Show AI suggestion explanation
            if (aiSuggestion && suggestion.reason) {
                document.getElementById('aiSuggestionText').textContent = suggestion.reason;
                aiSuggestion.style.display = 'block';
            }
            
        } catch (error) {
            console.error('Error getting AI suggestion:', error);
            
            // Fall back to default time (tomorrow at 10 AM)
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(10, 0, 0, 0);
            
            const endTime = new Date(tomorrow);
            endTime.setHours(11, 0, 0, 0);
            
            document.getElementById('eventStartDate').value = tomorrow.toISOString().split('T')[0];
            document.getElementById('eventStartTime').value = '10:00';
            document.getElementById('eventEndDate').value = tomorrow.toISOString().split('T')[0];
            document.getElementById('eventEndTime').value = '11:00';
        }
        
        // Hide loading, show form
        if (aiLoading) aiLoading.style.display = 'none';
        if (form) form.style.display = 'flex';
        
        // Setup event listeners if not already done
        this.setupModalListeners();
    }
    
    setupModalListeners() {
        if (this.modalListenersSetup) return;
        this.modalListenersSetup = true;
        
        const modal = document.getElementById('addEventModal');
        const closeBtn = document.getElementById('closeModalBtn');
        const cancelBtn = document.getElementById('cancelEventBtn');
        const form = document.getElementById('addEventForm');
        
        const closeModal = () => {
            modal.style.display = 'none';
            this.currentTaskForCalendar = null;
        };
        
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        
        // Handle form submission
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.saveEventToCalendar();
            });
        }
    }
    
    async saveEventToCalendar() {
        const task = this.currentTaskForCalendar;
        if (!task) return;
        
        const saveBtn = document.getElementById('saveEventBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) throw new Error('Not logged in');
            
            const token = await user.getIdToken();
            
            // Build event data
            const startDate = document.getElementById('eventStartDate').value;
            const startTime = document.getElementById('eventStartTime').value;
            const endDate = document.getElementById('eventEndDate').value;
            const endTime = document.getElementById('eventEndTime').value;
            
            const eventData = {
                title: document.getElementById('eventTitle').value,
                description: document.getElementById('eventDescription').value,
                start: `${startDate}T${startTime}:00`,
                end: `${endDate}T${endTime}:00`,
                location: document.getElementById('eventLocation').value,
                taskId: task.id
            };
            
            const response = await fetch('/api/calendars/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(eventData)
            });
            
            if (!response.ok) throw new Error('Failed to create event');
            
            const result = await response.json();
            
            // Update local task
            task.addedToCalendar = true;
            
            // Close modal
            document.getElementById('addEventModal').style.display = 'none';
            this.currentTaskForCalendar = null;
            
            // Refresh task list
            this.renderTasks();
            
            this.showToast('✅ Event added to calendar!');
            
        } catch (error) {
            console.error('Error saving event:', error);
            this.showToast('Failed to add event to calendar');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Add to Calendar';
            }
        }
    }
    
    mapTypeToCategory(type) {
        const mapping = {
            'user_task': 'work',
            'meeting': 'meeting',
            'deadline': 'deadline',
            'reminder': 'reminder',
            'follow_up': 'work'
        };
        return mapping[type] || 'other';
    }
    
    formatDate(date) {
        if (!date) return '';
        const d = typeof date === 'string' ? new Date(date) : (date.toDate ? date.toDate() : date);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast success';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.remove(), 3000);
    }
}

// Sign out function
function signOut() {
    firebase.auth().signOut().then(() => {
        window.location.href = '/';
    });
}

// Auto add all tasks to calendar
async function autoAddAllToCalendar() {
    const btn = document.getElementById('autoAddAllBtn');
    const btnText = document.getElementById('autoAddBtnText');
    
    if (!window.eventsManager || !window.eventsManager.tasks) {
        alert('No tasks loaded yet. Please wait for the page to load.');
        return;
    }
    
    // Filter tasks that can be added (have suggested date and not already added)
    const tasksToAdd = window.eventsManager.tasks.filter(task => 
        !task.addedToCalendar && !task.completed
    );
    
    if (tasksToAdd.length === 0) {
        window.eventsManager.showToast('✅ All tasks are already added to calendar or completed!');
        return;
    }
    
    // Disable button and show progress
    btn.disabled = true;
    btn.style.opacity = '0.7';
    btnText.textContent = `Adding 0/${tasksToAdd.length}...`;
    
    try {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('Not logged in');
        
        const token = await user.getIdToken();
        const timezoneOffset = new Date().getTimezoneOffset();
        
        let addedCount = 0;
        let failedCount = 0;
        
        for (const task of tasksToAdd) {
            try {
                // First, get AI time suggestion for this task
                const suggestResponse = await fetch('/api/calendars/suggest-time', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        taskTitle: task.title,
                        taskDetails: task.details,
                        taskDuration: 60,
                        preferredDate: task.suggestedDate,
                        timezoneOffset: timezoneOffset
                    })
                });
                
                if (!suggestResponse.ok) throw new Error('Failed to get time suggestion');
                
                const suggestResult = await suggestResponse.json();
                const suggestion = suggestResult.data;
                
                // Build event data
                const eventData = {
                    title: task.title,
                    description: task.details || '',
                    start: `${suggestion.startDate}T${suggestion.startTime}:00`,
                    end: `${suggestion.endDate}T${suggestion.endTime}:00`,
                    location: task.location || '',
                    taskId: task.id
                };
                
                // Create the calendar event
                const createResponse = await fetch('/api/calendars/events', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(eventData)
                });
                
                if (!createResponse.ok) throw new Error('Failed to create event');
                
                // Update local task
                task.addedToCalendar = true;
                addedCount++;
                
            } catch (taskError) {
                console.error(`Failed to add task "${task.title}":`, taskError);
                failedCount++;
            }
            
            // Update progress
            btnText.textContent = `Adding ${addedCount + failedCount}/${tasksToAdd.length}...`;
        }
        
        // Refresh task list
        window.eventsManager.renderTasks();
        
        // Show result
        if (failedCount === 0) {
            window.eventsManager.showToast(`✅ Successfully added ${addedCount} tasks to calendar!`);
        } else {
            window.eventsManager.showToast(`Added ${addedCount} tasks, ${failedCount} failed`);
        }
        
    } catch (error) {
        console.error('Error in auto add:', error);
        window.eventsManager.showToast('❌ Failed to add tasks to calendar');
    } finally {
        // Re-enable button
        btn.disabled = false;
        btn.style.opacity = '1';
        btnText.textContent = 'Auto Add All to Calendar';
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.eventsManager = new EventsManager();
});
