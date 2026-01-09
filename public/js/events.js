// Events & Tasks Manager for Zeitline Web Dashboard
// Handles display and management of AI-extracted discussion points and tasks

class EventsManager {
    constructor() {
        this.discussionPoints = [];
        this.tasks = [];
        this.discussionFilter = 'all';
        this.taskFilter = 'pending';
        this.draggedItem = null;
        
        this.init();
    }
    
    async init() {
        await this.waitForAuth();
        this.setupEventListeners();
        await this.loadData();
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
    
    async loadData() {
        const userId = firebase.auth().currentUser?.uid;
        if (!userId) return;
        
        const db = firebase.firestore();
        
        // Load discussion points from conversation sessions
        try {
            const sessionsSnapshot = await db.collection('users').doc(userId)
                .collection('conversationSessions')
                .orderBy('startedAt', 'desc')
                .limit(20)
                .get();
            
            this.discussionPoints = [];
            
            for (const sessionDoc of sessionsSnapshot.docs) {
                const sessionData = sessionDoc.data();
                if (sessionData.points && Array.isArray(sessionData.points)) {
                    this.discussionPoints.push(...sessionData.points.map(p => ({
                        ...p,
                        sessionId: sessionDoc.id
                    })));
                }
                
                // Also check subcollection
                const pointsSnapshot = await sessionDoc.ref.collection('points').get();
                pointsSnapshot.docs.forEach(pointDoc => {
                    this.discussionPoints.push({
                        id: pointDoc.id,
                        ...pointDoc.data(),
                        sessionId: sessionDoc.id
                    });
                });
            }
            
            // Sort by creation time
            this.discussionPoints.sort((a, b) => {
                const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt) || new Date();
                const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt) || new Date();
                return dateB - dateA;
            });
            
        } catch (error) {
            console.error('Error loading discussion points:', error);
        }
        
        // Load tasks from master task list
        try {
            const taskListDoc = await db.collection('users').doc(userId)
                .collection('taskLists').doc('master').get();
            
            if (taskListDoc.exists) {
                this.tasks = taskListDoc.data().tasks || [];
            }
        } catch (error) {
            console.error('Error loading tasks:', error);
        }
        
        // Render both panels
        this.renderDiscussionPoints();
        this.renderTasks();
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
    
    addToCalendar(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;
        
        // Open Google Calendar with prefilled event
        let calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(task.title)}`;
        
        if (task.suggestedDate) {
            const date = new Date(task.suggestedDate);
            const dateStr = date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            calUrl += `&dates=${dateStr}/${dateStr}`;
        }
        
        if (task.details) {
            calUrl += `&details=${encodeURIComponent(task.details)}`;
        }
        
        if (task.location) {
            calUrl += `&location=${encodeURIComponent(task.location)}`;
        }
        
        window.open(calUrl, '_blank');
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.eventsManager = new EventsManager();
});
