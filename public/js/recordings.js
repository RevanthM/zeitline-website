// Recordings Manager for Zeitline Web Dashboard
// Handles fetching, playing, and managing audio recordings from Apple Watch

class RecordingsManager {
    constructor() {
        this.recordings = [];
        this.currentRecording = null;
        this.audioPlayer = document.getElementById('audioPlayer');
        this.isPlaying = false;
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.sortOrder = 'newest'; // newest, oldest
        this.timeFilter = 'all'; // all, morning, afternoon, evening, night
        
        this.init();
    }
    
    async init() {
        this.setupEventListeners();
        await this.loadRecordings();
        this.updateStats();
    }
    
    setupEventListeners() {
        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.renderRecordings();
            });
        });
        
        // Search input
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.renderRecordings();
            });
        }
        
        // Sort order dropdown
        const sortSelect = document.getElementById('sortOrder');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sortOrder = e.target.value;
                this.renderRecordings();
            });
        }
        
        // Time filter dropdown
        const timeFilterSelect = document.getElementById('timeFilter');
        if (timeFilterSelect) {
            timeFilterSelect.addEventListener('change', (e) => {
                this.timeFilter = e.target.value;
                this.renderRecordings();
            });
        }
        
        // Audio player controls
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.addEventListener('click', () => this.togglePlay());
        }
        
        const rewindBtn = document.getElementById('rewindBtn');
        if (rewindBtn) {
            rewindBtn.addEventListener('click', () => this.seek(-10));
        }
        
        const forwardBtn = document.getElementById('forwardBtn');
        if (forwardBtn) {
            forwardBtn.addEventListener('click', () => this.seek(10));
        }
        
        // Progress bar click
        const progressContainer = document.getElementById('progressContainer');
        if (progressContainer) {
            progressContainer.addEventListener('click', (e) => {
                const rect = progressContainer.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                if (this.audioPlayer.duration) {
                    this.audioPlayer.currentTime = percent * this.audioPlayer.duration;
                }
            });
        }
        
        // Audio player events
        if (this.audioPlayer) {
            this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
            this.audioPlayer.addEventListener('loadedmetadata', () => this.updateDuration());
            this.audioPlayer.addEventListener('ended', () => this.onPlaybackEnded());
            this.audioPlayer.addEventListener('play', () => this.onPlay());
            this.audioPlayer.addEventListener('pause', () => this.onPause());
        }
        
        // Copy transcript button
        const copyBtn = document.getElementById('copyTranscriptBtn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyTranscript());
        }
        
        // Download transcript button
        const downloadBtn = document.getElementById('downloadTranscriptBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadTranscript());
        }
        
        // Transcribe button
        const transcribeBtn = document.getElementById('transcribeBtn');
        if (transcribeBtn) {
            transcribeBtn.addEventListener('click', () => this.transcribeRecording());
        }
    }
    
    async loadRecordings() {
        const loadingState = document.getElementById('loadingState');
        const emptyState = document.getElementById('emptyState');
        
        try {
            // Check if user is authenticated
            const user = firebase.auth().currentUser;
            if (!user) {
                // Wait for auth state
                await new Promise((resolve) => {
                    const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                        unsubscribe();
                        resolve(user);
                    });
                });
            }
            
            // Fetch recordings from Firestore
            const db = firebase.firestore();
            const userId = firebase.auth().currentUser?.uid;
            
            if (!userId) {
                // No user - show empty state
                this.recordings = [];
            } else {
                // Fetch from Firestore
                const snapshot = await db.collection('users').doc(userId)
                    .collection('recordings')
                    .orderBy('recordedAt', 'desc')
                    .get();
                
                this.recordings = snapshot.docs.map(doc => {
                    const data = doc.data();
                    console.log('Recording loaded:', {
                        id: doc.id,
                        filename: data.filename,
                        hasAudioUrl: !!data.audioUrl,
                        audioUrl: data.audioUrl ? data.audioUrl.substring(0, 50) + '...' : 'null'
                    });
                    return {
                        id: doc.id,
                        ...data,
                        recordedAt: data.recordedAt?.toDate() || new Date()
                    };
                });
                
                console.log(`Loaded ${this.recordings.length} recordings`);
            }
            
            // Hide loading, show content
            if (loadingState) loadingState.style.display = 'none';
            
            if (this.recordings.length === 0) {
                if (emptyState) emptyState.style.display = 'block';
            } else {
                this.renderRecordings();
            }
            
        } catch (error) {
            console.error('Error loading recordings:', error);
            if (loadingState) loadingState.style.display = 'none';
            
            // Show empty state on error
            this.recordings = [];
            if (emptyState) emptyState.style.display = 'block';
        }
    }
    
    
    renderRecordings() {
        const container = document.getElementById('recordingsList');
        const emptyState = document.getElementById('emptyState');
        const loadingState = document.getElementById('loadingState');
        
        if (loadingState) loadingState.style.display = 'none';
        
        // Filter recordings
        let filtered = this.recordings.filter(rec => {
            // Apply transcription filter
            if (this.currentFilter === 'transcribed' && !rec.transcript) return false;
            if (this.currentFilter === 'pending' && rec.transcript) return false;
            
            // Apply time of day filter
            if (this.timeFilter !== 'all') {
                const hour = new Date(rec.recordedAt).getHours();
                switch (this.timeFilter) {
                    case 'morning': // 6 AM - 12 PM
                        if (hour < 6 || hour >= 12) return false;
                        break;
                    case 'afternoon': // 12 PM - 6 PM
                        if (hour < 12 || hour >= 18) return false;
                        break;
                    case 'evening': // 6 PM - 12 AM
                        if (hour < 18) return false;
                        break;
                    case 'night': // 12 AM - 6 AM
                        if (hour >= 6) return false;
                        break;
                }
            }
            
            // Apply search
            if (this.searchQuery) {
                const searchText = `${this.formatDate(rec.recordedAt)} ${rec.transcript || ''}`.toLowerCase();
                if (!searchText.includes(this.searchQuery)) return false;
            }
            
            return true;
        });
        
        // Sort recordings
        filtered.sort((a, b) => {
            const dateA = new Date(a.recordedAt).getTime();
            const dateB = new Date(b.recordedAt).getTime();
            return this.sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
        });
        
        if (filtered.length === 0) {
            container.innerHTML = '';
            if (emptyState) {
                emptyState.style.display = 'block';
                if (this.searchQuery || this.currentFilter !== 'all') {
                    emptyState.querySelector('h2').textContent = 'No matching recordings';
                    emptyState.querySelector('p').textContent = 'Try adjusting your filters or search terms.';
                } else {
                    emptyState.querySelector('h2').textContent = 'No recordings yet';
                    emptyState.querySelector('p').textContent = 'Start recording audio notes on your Apple Watch. They\'ll appear here automatically!';
                }
            }
            return;
        }
        
        if (emptyState) emptyState.style.display = 'none';
        
        // Render recording cards
        container.innerHTML = filtered.map(rec => this.createRecordingCard(rec)).join('');
        
        // Add click listeners
        container.querySelectorAll('.recording-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const recording = this.recordings.find(r => r.id === id);
                if (recording) this.selectRecording(recording);
            });
        });
    }
    
    createRecordingCard(recording) {
        const isActive = this.currentRecording?.id === recording.id;
        const hasTranscript = !!recording.transcript;
        
        return `
            <div class="recording-card ${isActive ? 'active' : ''}" data-id="${recording.id}">
                <div class="recording-header">
                    <div class="recording-icon">🎙️</div>
                    <div class="recording-info">
                        <div class="recording-date">${this.formatDate(recording.recordedAt)}</div>
                        <div class="recording-meta">
                            <span>⏱️ ${this.formatDuration(recording.duration)}</span>
                            <span>📁 ${this.formatFileSize(recording.fileSize)}</span>
                            ${hasTranscript ? '<span class="has-transcript-badge">Transcribed</span>' : ''}
                        </div>
                    </div>
                </div>
                ${hasTranscript ? `<div class="recording-preview">${recording.transcript}</div>` : ''}
            </div>
        `;
    }
    
    selectRecording(recording) {
        this.currentRecording = recording;
        
        // Update UI
        const playerEmpty = document.getElementById('playerEmpty');
        const playerContent = document.getElementById('playerContent');
        
        if (playerEmpty) playerEmpty.style.display = 'none';
        if (playerContent) playerContent.classList.add('active');
        
        // Update player info
        document.getElementById('playerTitle').textContent = this.formatDate(recording.recordedAt);
        document.getElementById('playerDate').textContent = `Duration: ${this.formatDuration(recording.duration)} • ${this.formatFileSize(recording.fileSize)}`;
        
        // Update transcript
        const transcriptText = document.getElementById('transcriptText');
        const noTranscript = document.getElementById('noTranscript');
        
        if (recording.transcript) {
            if (transcriptText) {
                transcriptText.style.display = 'block';
                transcriptText.textContent = recording.transcript;
            }
            if (noTranscript) noTranscript.style.display = 'none';
        } else {
            if (transcriptText) transcriptText.style.display = 'none';
            if (noTranscript) noTranscript.style.display = 'block';
        }
        
        // Load audio from Firebase Storage if URL is available
        if (recording.audioUrl) {
            console.log('Loading audio from:', recording.audioUrl);
            
            // Firebase Storage download URLs should work directly without CORS issues
            // since they include an access token
            this.audioPlayer.src = recording.audioUrl;
            
            // Add comprehensive event handlers for debugging
            this.audioPlayer.oncanplay = () => {
                console.log('Audio can play - ready for playback');
            };
            
            this.audioPlayer.onloadeddata = () => {
                console.log('Audio data loaded successfully');
            };
            
            this.audioPlayer.onerror = (e) => {
                const error = this.audioPlayer.error;
                console.error('Error loading audio:', {
                    code: error?.code,
                    message: error?.message,
                    networkState: this.audioPlayer.networkState,
                    readyState: this.audioPlayer.readyState,
                    src: this.audioPlayer.src
                });
                
                // Provide more specific error messages
                let errorMsg = 'Unable to load audio file';
                if (error) {
                    switch (error.code) {
                        case 1: errorMsg = 'Audio loading aborted'; break;
                        case 2: errorMsg = 'Network error loading audio'; break;
                        case 3: errorMsg = 'Audio decoding failed'; break;
                        case 4: errorMsg = 'Audio format not supported'; break;
                    }
                }
                this.showToast(errorMsg, 'error');
            };
            
            this.audioPlayer.load();
        } else {
            // No audio URL - will use simulated playback
            console.log('No audio URL available for this recording. Recording data:', {
                id: recording.id,
                filename: recording.filename,
                hasAudioUrl: !!recording.audioUrl
            });
            this.audioPlayer.src = '';
        }
        
        // Update duration display
        const totalTimeEl = document.getElementById('totalTime');
        if (totalTimeEl) {
            totalTimeEl.textContent = this.formatDuration(recording.duration);
        }
        
        // Reset progress bar
        const progressBar = document.getElementById('progressBar');
        if (progressBar) progressBar.style.width = '0%';
        
        const currentTimeEl = document.getElementById('currentTime');
        if (currentTimeEl) currentTimeEl.textContent = '0:00';
        
        // Reset play state
        this.isPlaying = false;
        this.updatePlayButton();
        
        // Highlight selected card
        document.querySelectorAll('.recording-card').forEach(card => {
            card.classList.toggle('active', card.dataset.id === recording.id);
        });
    }
    
    async togglePlay() {
        if (!this.currentRecording) return;
        
        if (this.isPlaying) {
            this.audioPlayer.pause();
            if (this.playbackInterval) {
                clearInterval(this.playbackInterval);
            }
        } else {
            // Check if we have an actual audio source
            let hasAudioSource = this.audioPlayer.src && 
                                 this.audioPlayer.src !== window.location.href && 
                                 this.audioPlayer.src !== '';
            
            // If no audio URL stored, try to get it from Firebase Storage directly
            if (!hasAudioSource && this.currentRecording.filename) {
                try {
                    console.log('Attempting to get audio URL from Firebase Storage...');
                    const userId = firebase.auth().currentUser?.uid;
                    if (userId) {
                        const storage = firebase.storage();
                        const audioRef = storage.ref(`recordings/${userId}/${this.currentRecording.filename}`);
                        const url = await audioRef.getDownloadURL();
                        console.log('Got audio URL from Storage:', url);
                        
                        this.audioPlayer.src = url;
                        this.audioPlayer.load();
                        hasAudioSource = true;
                        
                        // Also update the recording object for future use
                        this.currentRecording.audioUrl = url;
                    }
                } catch (storageError) {
                    console.error('Could not get audio from Storage:', storageError);
                    this.showToast('Audio file not found. Please sync from iPhone app.', 'error');
                }
            }
            
            if (hasAudioSource) {
                // Try to play actual audio
                this.audioPlayer.play()
                    .then(() => {
                        console.log('Audio playback started');
                    })
                    .catch((error) => {
                        console.error('Error playing audio:', error);
                        // Fallback to simulated playback if real audio fails
                        this.showToast('Audio playback failed, showing progress simulation', 'warning');
                        this.simulatePlayback();
                    });
            } else {
                // No audio URL - use simulated playback
                console.log('No audio source available, using simulated playback');
                this.simulatePlayback();
            }
        }
    }
    
    simulatePlayback() {
        // Simulate playback for demo
        this.isPlaying = true;
        this.updatePlayButton();
        
        const duration = this.currentRecording.duration;
        let currentTime = 0;
        
        const interval = setInterval(() => {
            if (!this.isPlaying) {
                clearInterval(interval);
                return;
            }
            
            currentTime += 0.1;
            const progress = (currentTime / duration) * 100;
            
            document.getElementById('progressBar').style.width = `${progress}%`;
            document.getElementById('currentTime').textContent = this.formatTime(currentTime);
            
            if (currentTime >= duration) {
                clearInterval(interval);
                this.onPlaybackEnded();
            }
        }, 100);
        
        this.playbackInterval = interval;
    }
    
    onPlay() {
        this.isPlaying = true;
        this.updatePlayButton();
        
        // Animate waveform
        document.querySelectorAll('.waveform-bar').forEach(bar => {
            bar.classList.remove('paused');
        });
    }
    
    onPause() {
        this.isPlaying = false;
        this.updatePlayButton();
        
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
        }
        
        // Pause waveform animation
        document.querySelectorAll('.waveform-bar').forEach(bar => {
            bar.classList.add('paused');
        });
    }
    
    onPlaybackEnded() {
        this.isPlaying = false;
        this.updatePlayButton();
        
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
        }
        
        document.querySelectorAll('.waveform-bar').forEach(bar => {
            bar.classList.add('paused');
        });
    }
    
    updatePlayButton() {
        const playIcon = document.getElementById('playIcon');
        if (playIcon) {
            if (this.isPlaying) {
                // Show pause icon
                playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
            } else {
                // Show play icon
                playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
            }
        }
        
        // Update waveform animation
        document.querySelectorAll('.waveform-bar').forEach(bar => {
            if (this.isPlaying) {
                bar.classList.remove('paused');
            } else {
                bar.classList.add('paused');
            }
        });
    }
    
    seek(seconds) {
        if (this.audioPlayer.src && this.audioPlayer.duration) {
            this.audioPlayer.currentTime = Math.max(0, Math.min(this.audioPlayer.duration, this.audioPlayer.currentTime + seconds));
        }
    }
    
    updateProgress() {
        if (this.audioPlayer.duration) {
            const progress = (this.audioPlayer.currentTime / this.audioPlayer.duration) * 100;
            document.getElementById('progressBar').style.width = `${progress}%`;
            document.getElementById('currentTime').textContent = this.formatTime(this.audioPlayer.currentTime);
        }
    }
    
    updateDuration() {
        document.getElementById('totalTime').textContent = this.formatTime(this.audioPlayer.duration);
    }
    
    updateStats() {
        const totalRecordings = this.recordings.length;
        const totalDuration = this.recordings.reduce((sum, r) => sum + r.duration, 0);
        const transcribedCount = this.recordings.filter(r => r.transcript).length;
        
        document.getElementById('totalRecordings').textContent = totalRecordings;
        document.getElementById('totalDuration').textContent = this.formatDurationMinutes(totalDuration);
        document.getElementById('transcribedCount').textContent = transcribedCount;
    }
    
    copyTranscript() {
        if (!this.currentRecording?.transcript) return;
        
        navigator.clipboard.writeText(this.currentRecording.transcript).then(() => {
            this.showToast('Transcript copied to clipboard!', 'success');
        }).catch(err => {
            console.error('Failed to copy:', err);
            this.showToast('Failed to copy transcript', 'error');
        });
    }
    
    downloadTranscript() {
        if (!this.currentRecording?.transcript) return;
        
        const text = this.currentRecording.transcript;
        const filename = `transcript_${this.currentRecording.id}.txt`;
        
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showToast('Transcript downloaded!', 'success');
    }
    
    async transcribeRecording() {
        if (!this.currentRecording) return;
        
        this.showToast('Transcription started...', 'success');
        
        // In a real implementation, this would call the transcription API
        // For demo, we'll simulate a transcription
        setTimeout(() => {
            const transcripts = [
                'This is a sample transcription of your voice recording. The actual transcription would be generated using speech recognition technology.',
                'Important meeting notes: Discussed project timeline, assigned tasks to team members, and set deadlines for next sprint.',
                'Reminder to review the quarterly report and prepare presentation slides for the board meeting next week.'
            ];
            
            this.currentRecording.transcript = transcripts[Math.floor(Math.random() * transcripts.length)];
            
            // Update UI
            const transcriptText = document.getElementById('transcriptText');
            const noTranscript = document.getElementById('noTranscript');
            
            if (transcriptText) {
                transcriptText.style.display = 'block';
                transcriptText.textContent = this.currentRecording.transcript;
            }
            if (noTranscript) noTranscript.style.display = 'none';
            
            // Update stats and list
            this.updateStats();
            this.renderRecordings();
            
            this.showToast('Transcription complete!', 'success');
        }, 2000);
    }
    
    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `${type}-toast`;
        toast.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()">×</button>
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentElement) toast.remove();
        }, 3000);
    }
    
    // Formatting helpers
    formatDate(date) {
        if (!date) return 'Unknown date';
        const d = new Date(date);
        return d.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    }
    
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    formatDurationMinutes(seconds) {
        const mins = Math.floor(seconds / 60);
        if (mins >= 60) {
            const hours = Math.floor(mins / 60);
            const remainingMins = mins % 60;
            return `${hours}h ${remainingMins}m`;
        }
        return `${mins}m`;
    }
    
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    formatFileSize(bytes) {
        if (!bytes) return '0 KB';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.recordingsManager = new RecordingsManager();
});

// ============================================
// AI Task Extraction Manager
// ============================================

class TaskExtractionManager {
    constructor(recordingsManager) {
        this.recordingsManager = recordingsManager;
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        const extractBtn = document.getElementById('extractTasksBtn');
        if (extractBtn) {
            extractBtn.addEventListener('click', () => this.extractTasks());
        }
    }
    
    async extractTasks() {
        const recording = this.recordingsManager.currentRecording;
        if (!recording) {
            this.recordingsManager.showToast('Please select a recording first', 'warning');
            return;
        }
        
        if (!recording.transcript) {
            this.recordingsManager.showToast('No transcript available. Please transcribe first.', 'warning');
            return;
        }
        
        const extractBtn = document.getElementById('extractTasksBtn');
        extractBtn.disabled = true;
        extractBtn.textContent = 'Extracting...';
        
        try {
            const result = await this.callBackendAPI(recording.transcript, recording.id);
            this.displayResults(result);
            this.recordingsManager.showToast(`Extracted ${result.userTasks.length} tasks and ${result.conversationPoints.length} discussion points!`, 'success');
        } catch (error) {
            console.error('Task extraction failed:', error);
            this.recordingsManager.showToast('Task extraction failed: ' + error.message, 'error');
        } finally {
            extractBtn.disabled = false;
            extractBtn.textContent = 'Extract Tasks';
        }
    }
    
    async callBackendAPI(transcript, recordingId) {
        // Get the current user's auth token
        const user = firebase.auth().currentUser;
        if (!user) {
            throw new Error('Please sign in to extract tasks');
        }
        
        const token = await user.getIdToken();
        
        // Call our secure backend API
        const response = await fetch('/api/task-extraction/extract', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                transcript,
                recordingId
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Extraction failed');
        }
        
        const data = await response.json();
        
        return {
            conversationPoints: data.conversationPoints || [],
            userTasks: data.userTasks || [],
            recordingId: recordingId,
            extractedAt: data.extractedAt
        };
    }
    
    displayResults(result) {
        // Display extracted tasks
        const tasksList = document.getElementById('extractedTasksList');
        const noTasks = document.getElementById('noTasks');
        
        if (result.userTasks.length > 0) {
            noTasks.style.display = 'none';
            tasksList.style.display = 'block';
            tasksList.innerHTML = result.userTasks.map(task => this.createTaskHTML(task)).join('');
        } else {
            noTasks.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No actionable tasks found in this recording</p>';
        }
        
        // Display conversation points
        const pointsList = document.getElementById('conversationPointsList');
        const noPoints = document.getElementById('noPoints');
        
        if (result.conversationPoints.length > 0) {
            noPoints.style.display = 'none';
            pointsList.style.display = 'block';
            pointsList.innerHTML = result.conversationPoints.map(point => this.createPointHTML(point)).join('');
        }
    }
    
    createTaskHTML(task) {
        const categoryIcons = {
            meeting: '👥', call: '📞', deadline: '⏰', reminder: '🔔',
            errand: '🛒', work: '💼', personal: '👤', health: '❤️',
            travel: '✈️', other: '📋'
        };
        const icon = categoryIcons[task.category] || '📋';
        
        return `
            <div class="task-item">
                <div class="task-icon">${icon}</div>
                <div class="task-content">
                    <div class="task-title">${task.title}</div>
                    <div class="task-meta">
                        ${task.suggestedDateTime ? `<span>📅 ${new Date(task.suggestedDateTime).toLocaleDateString()}</span>` : ''}
                        ${task.location ? `<span>📍 ${task.location}</span>` : ''}
                        ${task.participants?.length ? `<span>👥 ${task.participants.length}</span>` : ''}
                    </div>
                </div>
                <div class="task-actions">
                    <button class="task-action-btn add-to-list" onclick="window.taskExtractor.addToCalendar('${task.title}')">
                        + Calendar
                    </button>
                </div>
            </div>
        `;
    }
    
    createPointHTML(point) {
        const typeClass = point.type.replace('_', '-');
        return `
            <div class="point-item">
                <span class="point-type-badge ${typeClass}">${point.type.replace('_', ' ')}</span>
                <div class="point-content">
                    ${point.content}
                    ${point.speaker ? `<span style="opacity: 0.6;"> — ${point.speaker}</span>` : ''}
                </div>
            </div>
        `;
    }
    
    addToCalendar(taskTitle) {
        // Open Google Calendar with prefilled event
        const calUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(taskTitle)}`;
        window.open(calUrl, '_blank');
    }
}

// Initialize task extractor after recordings manager
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.taskExtractor = new TaskExtractionManager(window.recordingsManager);
    }, 100);
});

