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
        this.autoAddToCalendar = false; // User preference for auto-adding to calendar
        
        // Selection state for bulk operations
        this.selectedDiscussionPoints = new Set();
        this.selectedTasks = new Set();
        
        this.init();
    }
    
    async init() {
        await this.waitForAuth();
        await this.loadUserSettings();
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
    
    async loadUserSettings() {
        const userId = firebase.auth().currentUser?.uid;
        if (!userId) return;
        
        const db = firebase.firestore();
        
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                // Load preference from user settings, default to false
                this.autoAddToCalendar = userData.autoAddTasksToCalendar || false;
                
                // Update checkbox UI
                const checkbox = document.getElementById('autoAddToCalendarCheckbox');
                if (checkbox) {
                    checkbox.checked = this.autoAddToCalendar;
                }
            }
        } catch (error) {
            console.error('Error loading user settings:', error);
        }
    }
    
    async saveAutoAddPreference(enabled) {
        const userId = firebase.auth().currentUser?.uid;
        if (!userId) return;
        
        const db = firebase.firestore();
        
        try {
            await db.collection('users').doc(userId).set({
                autoAddTasksToCalendar: enabled
            }, { merge: true });
            
            this.autoAddToCalendar = enabled;
            this.showToast(enabled ? '✅ Auto-add to calendar enabled' : 'Auto-add to calendar disabled');
        } catch (error) {
            console.error('Error saving preference:', error);
            this.showToast('Failed to save preference');
        }
    }
    
    setupEventListeners() {
        // Auto-add to calendar checkbox
        const checkbox = document.getElementById('autoAddToCalendarCheckbox');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                this.saveAutoAddPreference(e.target.checked);
            });
        }
        
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
        
        // Bulk selection handlers - Discussion Points
        const selectAllDiscussions = document.getElementById('selectAllDiscussions');
        if (selectAllDiscussions) {
            selectAllDiscussions.addEventListener('change', (e) => {
                this.toggleSelectAllDiscussions(e.target.checked);
            });
        }
        
        const deleteSelectedDiscussions = document.getElementById('deleteSelectedDiscussions');
        if (deleteSelectedDiscussions) {
            deleteSelectedDiscussions.addEventListener('click', () => {
                this.deleteSelectedDiscussionPoints();
            });
        }
        
        // Bulk selection handlers - Tasks
        const selectAllTasks = document.getElementById('selectAllTasks');
        if (selectAllTasks) {
            selectAllTasks.addEventListener('change', (e) => {
                this.toggleSelectAllTasks(e.target.checked);
            });
        }
        
        const deleteSelectedTasks = document.getElementById('deleteSelectedTasks');
        if (deleteSelectedTasks) {
            deleteSelectedTasks.addEventListener('click', () => {
                this.deleteSelectedTasks();
            });
        }
        
        // Add Discussion Point button
        const addDiscussionBtn = document.getElementById('addDiscussionBtn');
        if (addDiscussionBtn) {
            addDiscussionBtn.addEventListener('click', () => {
                this.showAddDiscussionModal();
            });
        }
        
        // Add Task button
        const addTaskBtn = document.getElementById('addTaskBtn');
        if (addTaskBtn) {
            addTaskBtn.addEventListener('click', () => {
                this.showAddTaskModal();
            });
        }
        
        // Setup modal handlers
        this.setupAddDiscussionModal();
        this.setupAddTaskModal();
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
        
        // Add delete button click handlers
        container.querySelectorAll('.delete-discussion-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pointId = e.target.closest('.discussion-card').dataset.id;
                if (confirm('Are you sure you want to delete this discussion point?')) {
                    this.deleteDiscussionPoint(pointId);
                }
            });
        });
        
        // Add checkbox selection handlers
        container.querySelectorAll('.discussion-select').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const pointId = e.target.dataset.id;
                this.toggleDiscussionSelection(pointId, e.target.checked);
            });
        });
        
        // Show/hide bulk actions bar
        this.updateDiscussionBulkActions(filtered.length);
    }
    
    createDiscussionCard(point) {
        const typeClass = (point.type || 'other').replace(/_/g, '-');
        const isAdded = point.addedToTaskList;
        const isSelected = this.selectedDiscussionPoints.has(point.id);
        
        return `
            <div class="discussion-card ${isAdded ? 'added' : ''} ${isSelected ? 'selected' : ''}" 
                 data-id="${point.id}" 
                 draggable="${!isAdded}">
                <div class="discussion-header">
                    <input type="checkbox" class="card-select-checkbox discussion-select" 
                           data-id="${point.id}" ${isSelected ? 'checked' : ''} 
                           title="Select for bulk delete">
                    <span class="discussion-type ${typeClass}">
                        ${(point.type || 'other').replace(/_/g, ' ')}
                    </span>
                    ${point.speaker ? `<span class="discussion-speaker">${point.speaker}</span>` : ''}
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-left: auto;">
                        ${!isAdded ? `<button class="add-to-tasks-btn">+ Add to Tasks</button>` : '<span style="color: #22c55e; font-size: 0.75rem;">✓ Added</span>'}
                        <button class="delete-discussion-btn" title="Delete discussion point" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 0.25rem; display: flex; align-items: center; opacity: 0.8; transition: opacity 0.2s;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
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
        
        // Add checkbox selection handlers
        container.querySelectorAll('.task-select').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                const taskId = e.target.dataset.id;
                this.toggleTaskSelection(taskId, e.target.checked);
            });
        });
        
        // Show/hide bulk actions bar
        this.updateTaskBulkActions(filtered.length);
    }
    
    createTaskCard(task) {
        const isCompleted = task.status === 'completed';
        const isSelected = this.selectedTasks.has(task.id);
        const categoryIcons = {
            meeting: '👥', call: '📞', deadline: '⏰', reminder: '🔔',
            errand: '🛒', work: '💼', personal: '👤', health: '❤️',
            travel: '✈️', other: '📋'
        };
        const icon = categoryIcons[task.category] || '📋';
        
        return `
            <div class="task-card ${isCompleted ? 'completed' : ''} ${isSelected ? 'selected' : ''}" data-id="${task.id}">
                <div class="task-header">
                    <input type="checkbox" class="card-select-checkbox task-select" 
                           data-id="${task.id}" ${isSelected ? 'checked' : ''} 
                           title="Select for bulk delete">
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
            
            // Auto-add to calendar if preference is enabled and task has a suggested date
            if (this.autoAddToCalendar && newTask.suggestedDate) {
                try {
                    await this.autoAddTaskToCalendar(newTask);
                } catch (calendarError) {
                    console.error('Error auto-adding task to calendar:', calendarError);
                    // Don't show error toast, just log it
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
    
    async autoAddTaskToCalendar(task) {
        const user = firebase.auth().currentUser;
        if (!user) return;
        
        const timezoneOffset = new Date().getTimezoneOffset();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        
        try {
            // Get AI time suggestion using apiCall helper
            const suggestResult = await apiCall('/calendars/suggest-time', {
                method: 'POST',
                body: JSON.stringify({
                    taskTitle: task.title,
                    taskDetails: task.details,
                    taskDuration: 60,
                    preferredDate: task.suggestedDate,
                    timezoneOffset: timezoneOffset,
                    timezone: timezone
                })
            });
            
            const suggestion = suggestResult.data;
            if (!suggestion) return;
            
            const startDateTime = `${suggestion.startDate}T${suggestion.startTime}:00`;
            const endDateTime = `${suggestion.endDate}T${suggestion.endTime}:00`;
            
            const eventData = {
                title: task.title,
                description: task.details || '',
                start: startDateTime,
                end: endDateTime,
                location: task.location || '',
                taskId: task.id
            };
            
            // Create the calendar event using apiCall helper
            const createResult = await apiCall('/calendars/events', {
                method: 'POST',
                body: JSON.stringify(eventData)
            });
            
            if (createResult.success || createResult.data) {
                // Update local task
                task.addedToCalendar = true;
                await this.saveTasks();
            }
        } catch (error) {
            console.error('Error auto-adding task to calendar:', error);
        }
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
    
    /**
     * Delete a discussion point from Firestore
     * @param {string} pointId - The ID of the discussion point to delete
     */
    async deleteDiscussionPoint(pointId) {
        const point = this.discussionPoints.find(p => p.id === pointId);
        if (!point) {
            this.showToast('Discussion point not found');
            return;
        }
        
        if (!point.sessionId) {
            this.showToast('Cannot delete: missing session information');
            return;
        }
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) {
                this.showToast('Please sign in first');
                return;
            }
            
            const db = firebase.firestore();
            const userId = user.uid;
            const sessionRef = db.collection('users').doc(userId)
                .collection('conversationSessions').doc(point.sessionId);
            
            // Fetch current session data
            const sessionDoc = await sessionRef.get();
            if (!sessionDoc.exists) {
                this.showToast('Discussion points not found');
                return;
            }
            
            const sessionData = sessionDoc.data();
            const points = sessionData.points || [];
            
            // Find and remove the point
            const pointIndex = points.findIndex(p => p.id === pointId);
            if (pointIndex === -1) {
                this.showToast('Point not found in session');
                return;
            }
            
            // Remove the point
            points.splice(pointIndex, 1);
            
            // Update Firestore
            await sessionRef.update({
                points: points,
                updatedAt: firebase.firestore.Timestamp.now()
            });
            
            // Also update the recording's extractedPointCount if recordingId exists
            if (point.recordingId) {
                const recordingRef = db.collection('users').doc(userId)
                    .collection('recordings').doc(point.recordingId);
                
                try {
                    await recordingRef.update({
                        extractedPointCount: points.length
                    });
                } catch (recordingError) {
                    console.warn('Could not update recording point count:', recordingError);
                    // Continue even if this fails
                }
            }
            
            // Remove from local state (real-time listener will also update, but this is faster)
            this.discussionPoints = this.discussionPoints.filter(p => p.id !== pointId);
            
            // Re-render
            this.renderDiscussionPoints();
            
            this.showToast('🗑️ Discussion point deleted');
            
        } catch (error) {
            console.error('Error deleting discussion point:', error);
            this.showToast(`Failed to delete: ${error.message}`);
        }
    }
    
    // ==================== BULK SELECTION METHODS ====================
    
    /**
     * Toggle selection of a single discussion point
     */
    toggleDiscussionSelection(pointId, isSelected) {
        if (isSelected) {
            this.selectedDiscussionPoints.add(pointId);
        } else {
            this.selectedDiscussionPoints.delete(pointId);
        }
        
        // Update the card's selected class
        const card = document.querySelector(`.discussion-card[data-id="${pointId}"]`);
        if (card) {
            card.classList.toggle('selected', isSelected);
        }
        
        this.updateDiscussionBulkActions();
    }
    
    /**
     * Toggle selection of a single task
     */
    toggleTaskSelection(taskId, isSelected) {
        if (isSelected) {
            this.selectedTasks.add(taskId);
        } else {
            this.selectedTasks.delete(taskId);
        }
        
        // Update the card's selected class
        const card = document.querySelector(`.task-card[data-id="${taskId}"]`);
        if (card) {
            card.classList.toggle('selected', isSelected);
        }
        
        this.updateTaskBulkActions();
    }
    
    /**
     * Toggle select all discussion points
     */
    toggleSelectAllDiscussions(selectAll) {
        const checkboxes = document.querySelectorAll('.discussion-select');
        
        if (selectAll) {
            checkboxes.forEach(cb => {
                cb.checked = true;
                this.selectedDiscussionPoints.add(cb.dataset.id);
                cb.closest('.discussion-card').classList.add('selected');
            });
        } else {
            checkboxes.forEach(cb => {
                cb.checked = false;
                cb.closest('.discussion-card').classList.remove('selected');
            });
            this.selectedDiscussionPoints.clear();
        }
        
        this.updateDiscussionBulkActions();
    }
    
    /**
     * Toggle select all tasks
     */
    toggleSelectAllTasks(selectAll) {
        const checkboxes = document.querySelectorAll('.task-select');
        
        if (selectAll) {
            checkboxes.forEach(cb => {
                cb.checked = true;
                this.selectedTasks.add(cb.dataset.id);
                cb.closest('.task-card').classList.add('selected');
            });
        } else {
            checkboxes.forEach(cb => {
                cb.checked = false;
                cb.closest('.task-card').classList.remove('selected');
            });
            this.selectedTasks.clear();
        }
        
        this.updateTaskBulkActions();
    }
    
    /**
     * Update the discussion points bulk actions bar visibility and count
     */
    updateDiscussionBulkActions(totalCount = null) {
        const bulkActions = document.getElementById('discussionBulkActions');
        const selectedCount = document.getElementById('discussionSelectedCount');
        const deleteBtn = document.getElementById('deleteSelectedDiscussions');
        const selectAllCheckbox = document.getElementById('selectAllDiscussions');
        
        // Use provided count or count from current filtered list
        const hasItems = totalCount !== null ? totalCount > 0 : this.discussionPoints.length > 0;
        
        if (bulkActions) {
            bulkActions.classList.toggle('visible', hasItems);
        }
        
        if (selectedCount) {
            selectedCount.textContent = `${this.selectedDiscussionPoints.size} selected`;
        }
        
        if (deleteBtn) {
            deleteBtn.classList.toggle('visible', this.selectedDiscussionPoints.size > 0);
        }
        
        // Update select all checkbox state
        if (selectAllCheckbox) {
            const checkboxes = document.querySelectorAll('.discussion-select');
            const allSelected = checkboxes.length > 0 && 
                                Array.from(checkboxes).every(cb => cb.checked);
            selectAllCheckbox.checked = allSelected;
        }
    }
    
    /**
     * Update the tasks bulk actions bar visibility and count
     */
    updateTaskBulkActions(totalCount = null) {
        const bulkActions = document.getElementById('taskBulkActions');
        const selectedCount = document.getElementById('taskSelectedCount');
        const deleteBtn = document.getElementById('deleteSelectedTasks');
        const selectAllCheckbox = document.getElementById('selectAllTasks');
        
        // Use provided count or count from current filtered list
        const hasItems = totalCount !== null ? totalCount > 0 : this.tasks.length > 0;
        
        if (bulkActions) {
            bulkActions.classList.toggle('visible', hasItems);
        }
        
        if (selectedCount) {
            selectedCount.textContent = `${this.selectedTasks.size} selected`;
        }
        
        if (deleteBtn) {
            deleteBtn.classList.toggle('visible', this.selectedTasks.size > 0);
        }
        
        // Update select all checkbox state
        if (selectAllCheckbox) {
            const checkboxes = document.querySelectorAll('.task-select');
            const allSelected = checkboxes.length > 0 && 
                                Array.from(checkboxes).every(cb => cb.checked);
            selectAllCheckbox.checked = allSelected;
        }
    }
    
    /**
     * Delete all selected discussion points
     */
    async deleteSelectedDiscussionPoints() {
        const count = this.selectedDiscussionPoints.size;
        if (count === 0) return;
        
        if (!confirm(`Are you sure you want to delete ${count} discussion point${count > 1 ? 's' : ''}?`)) {
            return;
        }
        
        this.showToast(`Deleting ${count} discussion point${count > 1 ? 's' : ''}...`);
        
        let successCount = 0;
        let failCount = 0;
        
        // Convert Set to array for iteration
        const pointIds = Array.from(this.selectedDiscussionPoints);
        
        for (const pointId of pointIds) {
            try {
                await this.deleteDiscussionPointSilent(pointId);
                successCount++;
            } catch (error) {
                console.error(`Failed to delete point ${pointId}:`, error);
                failCount++;
            }
        }
        
        // Clear selections
        this.selectedDiscussionPoints.clear();
        
        // Re-render
        this.renderDiscussionPoints();
        
        if (failCount === 0) {
            this.showToast(`🗑️ Deleted ${successCount} discussion point${successCount > 1 ? 's' : ''}`);
        } else {
            this.showToast(`Deleted ${successCount}, failed ${failCount}`);
        }
    }
    
    /**
     * Delete a discussion point without showing toast (for bulk operations)
     */
    async deleteDiscussionPointSilent(pointId) {
        const point = this.discussionPoints.find(p => p.id === pointId);
        if (!point || !point.sessionId) return;
        
        const user = firebase.auth().currentUser;
        if (!user) return;
        
        const db = firebase.firestore();
        const userId = user.uid;
        const sessionRef = db.collection('users').doc(userId)
            .collection('conversationSessions').doc(point.sessionId);
        
        const sessionDoc = await sessionRef.get();
        if (!sessionDoc.exists) return;
        
        const sessionData = sessionDoc.data();
        const points = sessionData.points || [];
        
        const pointIndex = points.findIndex(p => p.id === pointId);
        if (pointIndex === -1) return;
        
        points.splice(pointIndex, 1);
        
        await sessionRef.update({
            points: points,
            updatedAt: firebase.firestore.Timestamp.now()
        });
        
        if (point.recordingId) {
            try {
                const recordingRef = db.collection('users').doc(userId)
                    .collection('recordings').doc(point.recordingId);
                await recordingRef.update({
                    extractedPointCount: points.length
                });
            } catch (e) {
                // Ignore
            }
        }
        
        this.discussionPoints = this.discussionPoints.filter(p => p.id !== pointId);
    }
    
    /**
     * Delete all selected tasks
     */
    async deleteSelectedTasks() {
        const count = this.selectedTasks.size;
        if (count === 0) return;
        
        if (!confirm(`Are you sure you want to delete ${count} task${count > 1 ? 's' : ''}?`)) {
            return;
        }
        
        // Convert Set to array and delete
        const taskIds = Array.from(this.selectedTasks);
        this.tasks = this.tasks.filter(t => !taskIds.includes(t.id));
        
        // Clear selections
        this.selectedTasks.clear();
        
        // Save and re-render
        await this.saveTasks();
        this.renderTasks();
        
        this.showToast(`🗑️ Deleted ${count} task${count > 1 ? 's' : ''}`);
    }
    
    // ==================== END BULK SELECTION METHODS ====================
    
    // ==================== MANUAL ENTRY METHODS ====================
    
    /**
     * Show the Add Discussion Point modal
     */
    showAddDiscussionModal() {
        const modal = document.getElementById('addDiscussionModal');
        if (modal) {
            modal.style.display = 'flex';
            // Reset form
            document.getElementById('addDiscussionForm').reset();
        }
    }
    
    /**
     * Hide the Add Discussion Point modal
     */
    hideAddDiscussionModal() {
        const modal = document.getElementById('addDiscussionModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    /**
     * Setup event listeners for the Add Discussion Point modal
     */
    setupAddDiscussionModal() {
        const modal = document.getElementById('addDiscussionModal');
        const closeBtn = document.getElementById('closeDiscussionModalBtn');
        const cancelBtn = document.getElementById('cancelDiscussionBtn');
        const form = document.getElementById('addDiscussionForm');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideAddDiscussionModal());
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideAddDiscussionModal());
        }
        
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hideAddDiscussionModal();
            });
        }
        
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.saveManualDiscussionPoint();
            });
        }
    }
    
    /**
     * Save a manually entered discussion point
     */
    async saveManualDiscussionPoint() {
        const saveBtn = document.getElementById('saveDiscussionBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) {
                this.showToast('Please sign in first');
                return;
            }
            
            const content = document.getElementById('discussionContent').value.trim();
            if (!content) {
                this.showToast('Please enter content');
                return;
            }
            
            const type = document.getElementById('discussionType').value;
            const speaker = document.getElementById('discussionSpeaker').value.trim();
            const dateTimeValue = document.getElementById('discussionDateTime').value;
            const location = document.getElementById('discussionLocation').value.trim();
            
            const db = firebase.firestore();
            const userId = user.uid;
            
            // Create a new conversation session for manual entries
            const sessionId = 'manual_' + Date.now();
            const pointId = 'point_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            const newPoint = {
                id: pointId,
                content: content,
                type: type,
                speaker: speaker || null,
                mentionedDateTime: dateTimeValue ? new Date(dateTimeValue).toISOString() : null,
                location: location || null,
                createdAt: new Date().toISOString(),
                addedToTaskList: false,
                isManual: true
            };
            
            // Check if there's an existing manual session for today
            const today = new Date().toISOString().split('T')[0];
            const manualSessionId = `manual_${today}`;
            
            const sessionRef = db.collection('users').doc(userId)
                .collection('conversationSessions').doc(manualSessionId);
            
            const sessionDoc = await sessionRef.get();
            
            if (sessionDoc.exists) {
                // Add to existing session
                const sessionData = sessionDoc.data();
                const points = sessionData.points || [];
                points.push(newPoint);
                
                await sessionRef.update({
                    points: points,
                    updatedAt: firebase.firestore.Timestamp.now()
                });
            } else {
                // Create new session
                await sessionRef.set({
                    startedAt: firebase.firestore.Timestamp.now(),
                    updatedAt: firebase.firestore.Timestamp.now(),
                    isManual: true,
                    points: [newPoint]
                });
            }
            
            this.hideAddDiscussionModal();
            this.showToast('💬 Discussion point added!');
            
            // The real-time listener will update the UI
            
        } catch (error) {
            console.error('Error saving discussion point:', error);
            this.showToast(`Failed to save: ${error.message}`);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Add Discussion Point';
            }
        }
    }
    
    /**
     * Show the Add Task modal
     */
    showAddTaskModal() {
        const modal = document.getElementById('addTaskModal');
        if (modal) {
            modal.style.display = 'flex';
            // Reset form
            document.getElementById('addTaskForm').reset();
        }
    }
    
    /**
     * Hide the Add Task modal
     */
    hideAddTaskModal() {
        const modal = document.getElementById('addTaskModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    /**
     * Setup event listeners for the Add Task modal
     */
    setupAddTaskModal() {
        const modal = document.getElementById('addTaskModal');
        const closeBtn = document.getElementById('closeTaskModalBtn');
        const cancelBtn = document.getElementById('cancelTaskBtn');
        const form = document.getElementById('addTaskForm');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.hideAddTaskModal());
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideAddTaskModal());
        }
        
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hideAddTaskModal();
            });
        }
        
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.saveManualTask();
            });
        }
    }
    
    /**
     * Save a manually entered task
     */
    async saveManualTask() {
        const saveBtn = document.getElementById('saveTaskBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) {
                this.showToast('Please sign in first');
                return;
            }
            
            const title = document.getElementById('taskTitle').value.trim();
            if (!title) {
                this.showToast('Please enter a task title');
                return;
            }
            
            const details = document.getElementById('taskDetails').value.trim();
            const category = document.getElementById('taskCategory').value;
            const dueDateValue = document.getElementById('taskDueDate').value;
            const location = document.getElementById('taskLocation').value.trim();
            const priority = document.getElementById('taskPriority').value;
            
            const newTask = {
                id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                title: title,
                details: details || null,
                category: category,
                suggestedDate: dueDateValue ? new Date(dueDateValue).toISOString() : null,
                location: location || null,
                priority: priority ? parseInt(priority) : null,
                participants: [],
                subtasks: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                addedToCalendar: false,
                status: 'pending',
                isManual: true
            };
            
            // Add to local tasks
            this.tasks.unshift(newTask);
            
            // Save to Firebase
            await this.saveTasks();
            
            // Auto-add to calendar if preference is enabled and task has a due date
            if (this.autoAddToCalendar && newTask.suggestedDate) {
                try {
                    await this.autoAddTaskToCalendar(newTask);
                } catch (calendarError) {
                    console.error('Error auto-adding task to calendar:', calendarError);
                }
            }
            
            this.hideAddTaskModal();
            this.renderTasks();
            this.showToast('✅ Task added!');
            
        } catch (error) {
            console.error('Error saving task:', error);
            this.showToast(`Failed to save: ${error.message}`);
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Add Task';
            }
        }
    }
    
    // ==================== END MANUAL ENTRY METHODS ====================
    
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
            
            // Get user's timezone offset in minutes
            const timezoneOffset = new Date().getTimezoneOffset();
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            
            // Use apiCall helper for proper API URL
            const result = await apiCall('/calendars/suggest-time', {
                method: 'POST',
                body: JSON.stringify({
                    taskTitle: task.title,
                    taskDetails: task.details,
                    taskDuration: 60, // Default 1 hour
                    preferredDate: task.suggestedDate,
                    timezoneOffset: timezoneOffset,
                    timezone: timezone
                })
            });
            
            const suggestion = result.data;
            if (!suggestion) throw new Error('No suggestion returned');
            
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
            
            // Use apiCall helper for proper API URL
            const result = await apiCall('/calendars/events', {
                method: 'POST',
                body: JSON.stringify(eventData)
            });
            
            if (!result.success && !result.data) throw new Error('Failed to create event');
            
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
    
    // Filter tasks that can be added (not already added to calendar and not completed)
    const tasksToAdd = window.eventsManager.tasks.filter(task => 
        !task.addedToCalendar && task.status !== 'completed'
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
        
        const timezoneOffset = new Date().getTimezoneOffset();
        
        let addedCount = 0;
        let failedCount = 0;
        
        // Track slots we've already used in this session to prevent overlaps
        const usedSlots = [];
        
        for (const task of tasksToAdd) {
            try {
                // First, get AI time suggestion for this task
                // Pass already used slots to avoid overlaps
                // Use apiCall helper for proper API URL
                const suggestResult = await apiCall('/calendars/suggest-time', {
                    method: 'POST',
                    body: JSON.stringify({
                        taskTitle: task.title,
                        taskDetails: task.details,
                        taskDuration: 60,
                        preferredDate: task.suggestedDate,
                        timezoneOffset: timezoneOffset,
                        excludeSlots: usedSlots // Pass already scheduled slots
                    })
                });
                
                const suggestion = suggestResult.data;
                if (!suggestion) throw new Error('Failed to get time suggestion');
                
                // Build event data
                const startDateTime = `${suggestion.startDate}T${suggestion.startTime}:00`;
                const endDateTime = `${suggestion.endDate}T${suggestion.endTime}:00`;
                
                const eventData = {
                    title: task.title,
                    description: task.details || '',
                    start: startDateTime,
                    end: endDateTime,
                    location: task.location || '',
                    taskId: task.id
                };
                
                // Create the calendar event using apiCall helper
                const createResult = await apiCall('/calendars/events', {
                    method: 'POST',
                    body: JSON.stringify(eventData)
                });
                
                if (!createResult.success && !createResult.data) throw new Error('Failed to create event');
                
                // Track this slot as used to prevent overlaps
                usedSlots.push({
                    start: startDateTime,
                    end: endDateTime
                });
                
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
        
        // Save updated tasks to Firebase (to persist addedToCalendar flags)
        await window.eventsManager.saveTasks();
        
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
