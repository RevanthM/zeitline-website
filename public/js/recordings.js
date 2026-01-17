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
        
        // Recording state
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingStartTime = null;
        this.recordingTimer = null;
        
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
        
        // Transcribe button - uses Whisper API
        const transcribeBtn = document.getElementById('transcribeBtn');
        if (transcribeBtn) {
            transcribeBtn.addEventListener('click', () => this.transcribeWithWhisper());
        }
        
        // Re-transcribe button for already transcribed recordings
        const retranscribeBtn = document.getElementById('retranscribeBtn');
        if (retranscribeBtn) {
            retranscribeBtn.addEventListener('click', () => this.transcribeWithWhisper(true));
        }
        
        // Recording buttons
        const recordBtn = document.getElementById('recordBtn');
        if (recordBtn) {
            recordBtn.addEventListener('click', () => this.startRecording());
        }
        
        const stopRecordingBtn = document.getElementById('stopRecordingBtn');
        if (stopRecordingBtn) {
            stopRecordingBtn.addEventListener('click', () => this.stopRecording());
        }
        
        const recordFromEmptyBtn = document.getElementById('recordFromEmptyBtn');
        if (recordFromEmptyBtn) {
            recordFromEmptyBtn.addEventListener('click', () => this.startRecording());
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
        const transcriptionStatus = document.getElementById('transcriptionStatus');
        const transcriptionModel = document.getElementById('transcriptionModel');
        
        if (recording.transcript) {
            if (transcriptText) {
                transcriptText.style.display = 'block';
                transcriptText.textContent = recording.transcript;
            }
            if (noTranscript) noTranscript.style.display = 'none';
            
            // Show transcription model info if available
            if (transcriptionStatus && transcriptionModel) {
                const model = recording.transcriptionModel || 'Apple Speech';
                transcriptionStatus.style.display = 'block';
                transcriptionModel.textContent = `Transcribed with: ${model === 'whisper-1' ? 'OpenAI Whisper' : model}`;
            }
        } else {
            if (transcriptText) transcriptText.style.display = 'none';
            if (noTranscript) noTranscript.style.display = 'block';
            if (transcriptionStatus) transcriptionStatus.style.display = 'none';
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
                    src: this.audioPlayer.src,
                    filename: recording.filename
                });
                
                // Check if this is a CAF file (not supported by browsers)
                const isCAF = recording.filename?.toLowerCase().endsWith('.caf') || 
                              recording.audioUrl?.toLowerCase().includes('.caf') ||
                              recording.audioUrl?.toLowerCase().includes('%2fcaf');
                
                // Update waveform to show unavailable state
                const waveform = document.getElementById('waveform');
                
                if (isCAF || error?.code === 4) {
                    // Show message about unsupported format
                    this.showToast('⚠️ Audio format not supported. Please re-sync from iPhone app to convert.', 'warning');
                    
                    if (waveform) {
                        waveform.innerHTML = `
                            <div style="text-align: center; padding: 0.5rem;">
                                <p style="color: var(--text-muted); font-size: 0.8rem; margin: 0;">Audio format requires conversion</p>
                                <p style="color: var(--text-muted); font-size: 0.7rem; margin-top: 0.25rem; opacity: 0.7;">Re-sync from iPhone to fix</p>
                            </div>
                        `;
                    }
                } else {
                    // Provide more specific error messages
                    let errorMsg = 'Unable to load audio file';
                    let helpText = '';
                    if (error) {
                        switch (error.code) {
                            case 1: 
                                errorMsg = 'Audio loading aborted'; 
                                helpText = 'Try refreshing the page';
                                break;
                            case 2: 
                                errorMsg = 'Network error loading audio'; 
                                helpText = 'Check your connection';
                                break;
                            case 3: 
                                errorMsg = 'Audio decoding failed'; 
                                helpText = 'File may be corrupted';
                                break;
                            case 4: 
                                errorMsg = 'Audio format not supported'; 
                                helpText = 'Re-sync from iPhone app';
                                break;
                        }
                    }
                    this.showToast(`${errorMsg}. ${helpText}`, 'error');
                    
                    if (waveform) {
                        waveform.innerHTML = `
                            <div style="text-align: center; padding: 0.5rem;">
                                <p style="color: var(--text-muted); font-size: 0.8rem; margin: 0;">${errorMsg}</p>
                                ${helpText ? `<p style="color: var(--text-muted); font-size: 0.7rem; margin-top: 0.25rem; opacity: 0.7;">${helpText}</p>` : ''}
                            </div>
                        `;
                    }
                }
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
        
        // Load extracted tasks and conversation points automatically
        this.loadExtractedData(recording);
    }
    
    /**
     * Load extracted tasks and conversation points for a recording
     * These are automatically extracted by the cloud function after transcription
     */
    async loadExtractedData(recording) {
        const tasksList = document.getElementById('extractedTasksList');
        const noTasks = document.getElementById('noTasks');
        const pointsList = document.getElementById('conversationPointsList');
        const noPoints = document.getElementById('noPoints');
        const extractionStatus = document.getElementById('extractionStatus');
        
        // Check if we have a valid transcript
        const hasValidTranscript = recording.transcript && 
            !recording.transcript.startsWith('[') && 
            recording.transcript.trim().length > 10;
        
        // Check actual extracted counts
        const taskCount = recording.extractedTaskCount || 0;
        const pointCount = recording.extractedPointCount || 0;
        const hasExtractedItems = taskCount > 0 || pointCount > 0;
        
        // Show extract button if:
        // 1. Has valid transcript AND
        // 2. Either not extracted yet OR extracted but found 0 items
        const shouldShowExtractButton = hasValidTranscript && 
            (!recording.tasksExtracted || !hasExtractedItems);
        
        if (shouldShowExtractButton) {
            // Has transcript but not properly extracted - show extract button
            if (extractionStatus) {
                const buttonText = recording.tasksExtracted ? '🔄 Re-extract Tasks' : '🤖 Extract Tasks Now';
                extractionStatus.innerHTML = `<button id="extractNowBtn" style="background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); color: var(--bg-deep); border: none; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.75rem;">${buttonText}</button>`;
                
                // Add click handler
                setTimeout(() => {
                    const extractBtn = document.getElementById('extractNowBtn');
                    if (extractBtn) {
                        extractBtn.addEventListener('click', () => this.extractTasksFromRecording(recording));
                    }
                }, 0);
            }
            
            // Show "no tasks" message with extract prompt
            if (tasksList) tasksList.style.display = 'none';
            if (noTasks) {
                noTasks.style.display = 'block';
                noTasks.innerHTML = `
                    <div class="no-transcript-icon">📋</div>
                    <p>No tasks found</p>
                    <p style="font-size: 0.75rem; opacity: 0.7;">Click "Extract Tasks Now" above to analyze this transcript with AI</p>
                `;
            }
            if (pointsList) pointsList.style.display = 'none';
            if (noPoints) noPoints.style.display = 'block';
            return;
        } else if (!hasValidTranscript) {
            // No valid transcript - show waiting message
            if (extractionStatus) {
                extractionStatus.textContent = 'Waiting for transcript';
            }
            if (tasksList) tasksList.style.display = 'none';
            if (noTasks) noTasks.style.display = 'block';
            if (pointsList) pointsList.style.display = 'none';
            if (noPoints) noPoints.style.display = 'block';
            return;
        }
        
        // Has extracted items - show status and hide "no tasks/points" messages
        if (extractionStatus) {
            extractionStatus.innerHTML = `✅ Extracted (${taskCount} tasks, ${pointCount} points) <button id="reExtractBtn" style="background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted); padding: 0.2rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.65rem; margin-left: 0.5rem;">🔄</button>`;
            
            // Add re-extract handler
            setTimeout(() => {
                const reExtractBtn = document.getElementById('reExtractBtn');
                if (reExtractBtn) {
                    reExtractBtn.addEventListener('click', () => this.extractTasksFromRecording(recording));
                }
            }, 0);
        }
        
        // Hide "no tasks/points" by default since we have extracted items
        if (noTasks) noTasks.style.display = 'none';
        if (noPoints) noPoints.style.display = 'none';
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) {
                console.log('No user logged in, cannot load extracted data');
                return;
            }
            
            const db = firebase.firestore();
            const userId = user.uid;
            
            console.log(`📥 Loading extracted data for recording: ${recording.id}`);
            
            let tasksLoaded = false;
            let pointsLoaded = false;
            
            // Fetch conversation session (contains points)
            try {
                const sessionDoc = await db.collection('users').doc(userId)
                    .collection('conversationSessions').doc(recording.id).get();
                
                console.log(`Session doc exists: ${sessionDoc.exists}`);
                
                if (sessionDoc.exists) {
                    const sessionData = sessionDoc.data();
                    const points = sessionData.points || [];
                    
                    console.log(`Found ${points.length} discussion points`);
                    
                    if (points.length > 0) {
                        pointsLoaded = true;
                        if (noPoints) noPoints.style.display = 'none';
                        if (pointsList) {
                            pointsList.style.display = 'block';
                            pointsList.innerHTML = points.map(point => this.createPointHTML(point)).join('');
                        }
                    }
                }
            } catch (sessionError) {
                console.log('Error fetching conversation session:', sessionError);
            }
            
            // Fetch tasks from master task list that belong to this recording
            try {
                const taskListDoc = await db.collection('users').doc(userId)
                    .collection('taskLists').doc('master').get();
                
                console.log(`Task list doc exists: ${taskListDoc.exists}`);
                
                if (taskListDoc.exists) {
                    const taskListData = taskListDoc.data();
                    const allTasks = taskListData.tasks || [];
                    
                    console.log(`Total tasks in master list: ${allTasks.length}`);
                    
                    // Filter tasks for this recording
                    const recordingTasks = allTasks.filter(task => task.sessionId === recording.id);
                    
                    console.log(`Tasks for this recording: ${recordingTasks.length}`);
                    
                    if (recordingTasks.length > 0) {
                        tasksLoaded = true;
                        if (noTasks) noTasks.style.display = 'none';
                        if (tasksList) {
                            tasksList.style.display = 'block';
                            tasksList.innerHTML = recordingTasks.map(task => this.createTaskHTML(task)).join('');
                        }
                    }
                }
            } catch (taskError) {
                console.log('Error fetching task list:', taskError);
            }
            
            // If we expected data but didn't find it, show a message
            if (!tasksLoaded && taskCount > 0) {
                console.log('Expected tasks but none found in Firestore');
                if (noTasks) {
                    noTasks.style.display = 'block';
                    noTasks.innerHTML = `
                        <div class="no-transcript-icon">⏳</div>
                        <p>Tasks being synced...</p>
                        <p style="font-size: 0.75rem; opacity: 0.7;">Try refreshing the page in a moment</p>
                    `;
                }
            }
            
            if (!pointsLoaded && pointCount > 0) {
                console.log('Expected points but none found in Firestore');
                if (noPoints) {
                    noPoints.style.display = 'block';
                    noPoints.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 1rem;">Points being synced...</p>`;
                }
            }
            
        } catch (error) {
            console.error('Error loading extracted data:', error);
        }
    }
    
    /**
     * Manually extract tasks from a recording's transcript using AI
     */
    async extractTasksFromRecording(recording) {
        if (!recording || !recording.transcript) {
            this.showToast('No transcript available to extract from', 'warning');
            return;
        }
        
        const extractionStatus = document.getElementById('extractionStatus');
        const tasksList = document.getElementById('extractedTasksList');
        const noTasks = document.getElementById('noTasks');
        const pointsList = document.getElementById('conversationPointsList');
        const noPoints = document.getElementById('noPoints');
        
        if (extractionStatus) {
            extractionStatus.innerHTML = '⏳ Extracting tasks with AI...';
        }
        
        this.showToast('🤖 Analyzing transcript with AI...', 'info');
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) {
                throw new Error('Please sign in first');
            }
            
            const token = await user.getIdToken();
            
            // Call the task extraction API
            const response = await fetch('/api/task-extraction/extract', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    transcript: recording.transcript,
                    recordingId: recording.id
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Extraction failed');
            }
            
            const result = await response.json();
            
            console.log('Extraction result:', result);
            
            const extractedTasks = result.userTasks || [];
            const extractedPoints = result.conversationPoints || [];
            
            // Update local recording object
            recording.tasksExtracted = true;
            recording.extractedTaskCount = extractedTasks.length;
            recording.extractedPointCount = extractedPoints.length;
            
            // Also update in the recordings array
            const recordingIndex = this.recordings.findIndex(r => r.id === recording.id);
            if (recordingIndex !== -1) {
                this.recordings[recordingIndex].tasksExtracted = true;
                this.recordings[recordingIndex].extractedTaskCount = recording.extractedTaskCount;
                this.recordings[recordingIndex].extractedPointCount = recording.extractedPointCount;
            }
            
            // Update extraction status
            if (extractionStatus) {
                extractionStatus.innerHTML = `✅ Extracted (${extractedTasks.length} tasks, ${extractedPoints.length} points) <button id="reExtractBtn" style="background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted); padding: 0.2rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.65rem; margin-left: 0.5rem;">🔄</button>`;
                
                setTimeout(() => {
                    const reExtractBtn = document.getElementById('reExtractBtn');
                    if (reExtractBtn) {
                        reExtractBtn.addEventListener('click', () => this.extractTasksFromRecording(recording));
                    }
                }, 0);
            }
            
            console.log('📋 Displaying extracted data...');
            console.log('Tasks:', extractedTasks);
            console.log('Points:', extractedPoints);
            console.log('tasksList element:', tasksList);
            console.log('pointsList element:', pointsList);
            
            // Display tasks immediately from API response
            if (extractedTasks.length > 0) {
                console.log('✅ Showing tasks...');
                if (noTasks) {
                    noTasks.style.display = 'none';
                    console.log('Hidden noTasks');
                }
                if (tasksList) {
                    const tasksHTML = extractedTasks.map(task => `
                        <div class="task-item" style="display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.75rem; background: var(--bg-card); border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid var(--border-subtle);">
                            <div class="task-icon" style="font-size: 1.25rem;">💼</div>
                            <div class="task-content" style="flex: 1;">
                                <div class="task-title" style="font-weight: 500; margin-bottom: 0.25rem;">${task.title}</div>
                                ${task.details ? `<div style="margin-top: 0.25rem; font-size: 0.8rem; color: var(--text-muted);">${task.details}</div>` : ''}
                                <div class="task-meta" style="font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.5rem;">
                                    ${task.suggestedDateTime ? `<span>📅 ${task.suggestedDateTime}</span>` : ''}
                                    ${task.location ? `<span>📍 ${task.location}</span>` : ''}
                                    ${task.priority ? `<span>⚡ P${task.priority}</span>` : ''}
                                    ${task.category ? `<span>🏷️ ${task.category}</span>` : ''}
                                </div>
                            </div>
                        </div>
                    `).join('');
                    
                    tasksList.innerHTML = tasksHTML;
                    tasksList.style.display = 'block';
                    tasksList.style.visibility = 'visible';
                    console.log('Set tasksList HTML and display:block');
                }
            } else {
                console.log('No tasks to display');
                if (tasksList) tasksList.style.display = 'none';
                if (noTasks) {
                    noTasks.style.display = 'block';
                    noTasks.innerHTML = `
                        <div style="text-align: center; padding: 1rem; color: var(--text-muted);">
                            <div style="font-size: 2rem; margin-bottom: 0.5rem;">📋</div>
                            <p>No actionable tasks found</p>
                            <p style="font-size: 0.75rem; opacity: 0.7;">The AI didn't find any specific tasks in this transcript</p>
                        </div>
                    `;
                }
            }
            
            // Display discussion points immediately from API response
            if (extractedPoints.length > 0) {
                console.log('✅ Showing discussion points...');
                if (noPoints) {
                    noPoints.style.display = 'none';
                    console.log('Hidden noPoints');
                }
                if (pointsList) {
                    const pointsHTML = extractedPoints.map(point => `
                        <div class="point-item" style="display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.6rem; border-bottom: 1px solid var(--border-subtle);">
                            <span class="point-type-badge" style="font-size: 0.65rem; padding: 0.15rem 0.4rem; border-radius: 4px; background: rgba(139, 92, 246, 0.2); color: #8b5cf6; white-space: nowrap;">${(point.type || 'other').replace('_', ' ')}</span>
                            <div class="point-content" style="flex: 1; font-size: 0.85rem;">
                                ${point.content}
                                ${point.speaker ? `<span style="opacity: 0.6;"> — ${point.speaker}</span>` : ''}
                            </div>
                        </div>
                    `).join('');
                    
                    pointsList.innerHTML = pointsHTML;
                    pointsList.style.display = 'block';
                    pointsList.style.visibility = 'visible';
                    console.log('Set pointsList HTML and display:block');
                }
            } else {
                console.log('No points to display');
                if (pointsList) pointsList.style.display = 'none';
                if (noPoints) noPoints.style.display = 'block';
            }
            
            this.showToast(`✅ Extracted ${extractedTasks.length} tasks and ${extractedPoints.length} discussion points!`, 'success');
            
        } catch (error) {
            console.error('Task extraction error:', error);
            this.showToast(`❌ Extraction failed: ${error.message}`, 'error');
            
            if (extractionStatus) {
                extractionStatus.innerHTML = `<button id="extractNowBtn" style="background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary)); color: var(--bg-deep); border: none; padding: 0.4rem 0.8rem; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.75rem;">🤖 Retry Extraction</button>`;
                setTimeout(() => {
                    const extractBtn = document.getElementById('extractNowBtn');
                    if (extractBtn) {
                        extractBtn.addEventListener('click', () => this.extractTasksFromRecording(recording));
                    }
                }, 0);
            }
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
                        ${task.suggestedDate ? `<span>📅 ${new Date(task.suggestedDate).toLocaleDateString()}</span>` : ''}
                        ${task.location ? `<span>📍 ${task.location}</span>` : ''}
                        ${task.participants?.length ? `<span>👥 ${task.participants.length}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }
    
    createPointHTML(point) {
        const typeClass = (point.type || 'other').replace('_', '-');
        return `
            <div class="point-item">
                <span class="point-type-badge ${typeClass}">${(point.type || 'other').replace('_', ' ')}</span>
                <div class="point-content">
                    ${point.content}
                    ${point.speaker ? `<span style="opacity: 0.6;"> — ${point.speaker}</span>` : ''}
                </div>
            </div>
        `;
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
    
    /**
     * Transcribe the current recording using OpenAI Whisper API
     * This provides much better accuracy than Apple's built-in speech recognition
     * 
     * @param {boolean} forceRetranscribe - If true, re-transcribe even if already transcribed
     */
    async transcribeWithWhisper(forceRetranscribe = false) {
        if (!this.currentRecording) {
            this.showToast('Please select a recording first', 'warning');
            return;
        }
        
        if (!this.currentRecording.audioUrl) {
            this.showToast('No audio file available. Please sync from iPhone app first.', 'warning');
            return;
        }
        
        // Check if already transcribed and not forcing
        if (this.currentRecording.transcript && !forceRetranscribe) {
            this.showToast('Recording already transcribed. Use "Re-transcribe" to update.', 'info');
            return;
        }
        
        const transcribeBtn = document.getElementById('transcribeBtn');
        const retranscribeBtn = document.getElementById('retranscribeBtn');
        const originalBtnText = transcribeBtn ? transcribeBtn.textContent : 'Transcribe';
        
        // Update UI to show processing
        if (transcribeBtn) {
            transcribeBtn.disabled = true;
            transcribeBtn.textContent = 'Transcribing...';
        }
        if (retranscribeBtn) {
            retranscribeBtn.disabled = true;
        }
        
        this.showToast('🎤 Starting AI transcription with Whisper...', 'info');
        
        try {
            // Get auth token
            const user = firebase.auth().currentUser;
            if (!user) {
                throw new Error('Please sign in to transcribe recordings');
            }
            
            const token = await user.getIdToken();
            
            // Call Whisper transcription API
            const response = await fetch(`/api/recordings/${this.currentRecording.id}/transcribe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    forceRetranscribe: forceRetranscribe
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Transcription failed');
            }
            
            const result = await response.json();
            const transcript = result.data?.transcript;
            
            if (!transcript) {
                throw new Error('No transcript received');
            }
            
            // Update local recording object
            this.currentRecording.transcript = transcript;
            this.currentRecording.transcriptionModel = result.data?.model || 'whisper-1';
            
            // Also update in the recordings array
            const recordingIndex = this.recordings.findIndex(r => r.id === this.currentRecording.id);
            if (recordingIndex !== -1) {
                this.recordings[recordingIndex].transcript = transcript;
            }
            
            // Update UI
            const transcriptText = document.getElementById('transcriptText');
            const noTranscript = document.getElementById('noTranscript');
            
            if (transcriptText) {
                transcriptText.style.display = 'block';
                transcriptText.textContent = transcript;
            }
            if (noTranscript) noTranscript.style.display = 'none';
            
            // Update stats and list
            this.updateStats();
            this.renderRecordings();
            
            const cached = result.data?.cached ? ' (cached)' : '';
            this.showToast(`✅ Transcription complete${cached}!`, 'success');
            
            console.log('Whisper transcription result:', {
                model: result.data?.model,
                cached: result.data?.cached,
                transcriptLength: transcript.length
            });
            
        } catch (error) {
            console.error('Transcription error:', error);
            this.showToast(`❌ Transcription failed: ${error.message}`, 'error');
        } finally {
            // Reset buttons
            if (transcribeBtn) {
                transcribeBtn.disabled = false;
                transcribeBtn.textContent = originalBtnText;
            }
            if (retranscribeBtn) {
                retranscribeBtn.disabled = false;
            }
        }
    }
    
    /**
     * Batch transcribe all recordings that don't have transcripts
     */
    async batchTranscribe() {
        const pendingRecordings = this.recordings.filter(r => !r.transcript && r.audioUrl);
        
        if (pendingRecordings.length === 0) {
            this.showToast('All recordings are already transcribed!', 'info');
            return;
        }
        
        this.showToast(`🎤 Starting batch transcription of ${pendingRecordings.length} recordings...`, 'info');
        
        try {
            const user = firebase.auth().currentUser;
            if (!user) {
                throw new Error('Please sign in first');
            }
            
            const token = await user.getIdToken();
            
            const response = await fetch('/api/recordings/transcribe-batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    limit: 5 // Process 5 at a time
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Batch transcription failed');
            }
            
            const result = await response.json();
            
            // Reload recordings to get updated transcripts
            await this.loadRecordings();
            this.updateStats();
            
            const successCount = result.data?.results?.filter(r => r.status === 'success').length || 0;
            this.showToast(`✅ Transcribed ${successCount} recordings!`, 'success');
            
        } catch (error) {
            console.error('Batch transcription error:', error);
            this.showToast(`❌ Batch transcription failed: ${error.message}`, 'error');
        }
    }
    
    // Legacy method for backwards compatibility
    async transcribeRecording() {
        return this.transcribeWithWhisper(false);
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
    
    /**
     * Start recording audio from the user's microphone
     */
    async startRecording() {
        try {
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            // Check if MediaRecorder is supported
            if (!window.MediaRecorder) {
                throw new Error('MediaRecorder API is not supported in this browser');
            }
            
            // Determine the best audio format
            let mimeType = 'audio/webm';
            const types = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/ogg;codecs=opus'
            ];
            
            for (const type of types) {
                if (MediaRecorder.isTypeSupported(type)) {
                    mimeType = type;
                    break;
                }
            }
            
            console.log('Using audio format:', mimeType);
            
            // Create MediaRecorder
            this.mediaRecorder = new MediaRecorder(stream, { mimeType });
            this.audioChunks = [];
            
            // Handle data available
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };
            
            // Handle recording stop
            this.mediaRecorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());
                this.processRecording();
            };
            
            // Handle errors
            this.mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event);
                this.showToast('Recording error occurred', 'error');
                this.stopRecording();
            };
            
            // Start recording
            this.mediaRecorder.start(1000); // Collect data every second
            this.isRecording = true;
            this.recordingStartTime = Date.now();
            
            // Update UI
            const recordingUI = document.getElementById('recordingUI');
            const recordBtn = document.getElementById('recordBtn');
            
            if (recordingUI) recordingUI.style.display = 'flex';
            if (recordBtn) {
                recordBtn.disabled = true;
                recordBtn.style.opacity = '0.5';
            }
            
            // Start timer
            this.startRecordingTimer();
            
            this.showToast('🎤 Recording started', 'success');
            
        } catch (error) {
            console.error('Error starting recording:', error);
            
            let errorMessage = 'Failed to start recording';
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage = 'Microphone permission denied. Please allow microphone access and try again.';
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                errorMessage = 'No microphone found. Please connect a microphone and try again.';
            } else if (error.name === 'NotSupportedError') {
                errorMessage = 'Recording is not supported in this browser. Please use Chrome, Firefox, or Edge.';
            }
            
            this.showToast(errorMessage, 'error');
        }
    }
    
    /**
     * Stop the current recording
     */
    stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) {
            return;
        }
        
        // Stop recording
        if (this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        this.isRecording = false;
        
        // Stop timer
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        
        // Update UI
        const recordingUI = document.getElementById('recordingUI');
        const recordBtn = document.getElementById('recordBtn');
        
        if (recordingUI) recordingUI.style.display = 'none';
        if (recordBtn) {
            recordBtn.disabled = false;
            recordBtn.style.opacity = '1';
        }
        
        this.showToast('⏹️ Recording stopped. Processing...', 'info');
    }
    
    /**
     * Start the recording timer
     */
    startRecordingTimer() {
        const timerEl = document.getElementById('recordingTimer');
        if (!timerEl) return;
        
        this.recordingTimer = setInterval(() => {
            if (!this.recordingStartTime) return;
            
            const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60);
            const seconds = elapsed % 60;
            
            timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 100);
    }
    
    /**
     * Process the recorded audio and upload to Firebase
     */
    async processRecording() {
        if (this.audioChunks.length === 0) {
            this.showToast('No audio data recorded', 'error');
            return;
        }
        
        try {
            // Determine the actual MIME type used during recording
            // Different browsers support different formats:
            // - Chrome/Edge: audio/webm;codecs=opus
            // - Firefox: audio/ogg;codecs=opus
            // - Safari: audio/mp4 (may require polyfill)
            const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
            
            // Map MIME types to file extensions
            const mimeToExt = {
                'audio/webm': '.webm',
                'audio/webm;codecs=opus': '.webm',
                'audio/ogg': '.ogg',
                'audio/ogg;codecs=opus': '.ogg',
                'audio/mp4': '.m4a',
                'audio/mpeg': '.mp3'
            };
            
            const fileExt = mimeToExt[mimeType] || '.webm';
            const contentType = mimeType.split(';')[0]; // Remove codec info for storage
            
            // Create blob from audio chunks using the actual MIME type
            const audioBlob = new Blob(this.audioChunks, { type: mimeType });
            const duration = (Date.now() - this.recordingStartTime) / 1000;
            
            console.log('Recording processed:', {
                size: audioBlob.size,
                duration: duration,
                chunks: this.audioChunks.length,
                mimeType: mimeType,
                fileExtension: fileExt,
                contentType: contentType
            });
            
            // Check authentication
            const user = firebase.auth().currentUser;
            if (!user) {
                throw new Error('Please sign in to save recordings');
            }
            
            const userId = user.uid;
            
            // Generate filename with correct extension based on MIME type
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `web-recording-${timestamp}${fileExt}`;
            
            // Upload to Firebase Storage
            this.showToast('📤 Uploading recording...', 'info');
            
            const storage = firebase.storage();
            const storageRef = storage.ref(`recordings/${userId}/${filename}`);
            
            // Upload blob with the correct content type
            const uploadTask = storageRef.put(audioBlob, {
                contentType: contentType,
                customMetadata: {
                    source: 'web',
                    recordedAt: new Date().toISOString(),
                    originalMimeType: mimeType
                }
            });
            
            // Wait for upload to complete
            const snapshot = await uploadTask;
            const downloadURL = await snapshot.ref.getDownloadURL();
            
            console.log('Audio uploaded:', downloadURL);
            
            // Create Firestore document
            const db = firebase.firestore();
            const recordingData = {
                filename: filename,
                recordedAt: firebase.firestore.Timestamp.now(),
                duration: duration,
                fileSize: audioBlob.size,
                transcript: null,
                audioUrl: downloadURL,
                watchFilename: filename,
                createdAt: firebase.firestore.Timestamp.now(),
                updatedAt: firebase.firestore.Timestamp.now(),
                isTranscribing: false,
                source: 'web'
            };
            
            const docRef = await db.collection('users').doc(userId)
                .collection('recordings')
                .add(recordingData);
            
            console.log('Recording saved to Firestore:', docRef.id);
            
            // Reload recordings
            await this.loadRecordings();
            this.updateStats();
            
            // Select the new recording
            const newRecording = {
                id: docRef.id,
                ...recordingData,
                recordedAt: recordingData.recordedAt.toDate()
            };
            this.selectRecording(newRecording);
            
            this.showToast('✅ Recording saved! Transcription starting...', 'success');
            
            // The Firestore trigger (onRecordingCreate) handles automatic transcription
            // Set up a listener to watch for transcription updates
            const recordingId = docRef.id;
            const unsubscribe = db.collection('users').doc(userId)
                .collection('recordings').doc(recordingId)
                .onSnapshot((doc) => {
                    if (!doc.exists) return;
                    
                    const data = doc.data();
                    console.log('Recording updated:', { transcript: !!data.transcript, isTranscribing: data.isTranscribing });
                    
                    if (data.transcript && data.transcript.length > 0) {
                        // Transcription complete - update the UI
                        unsubscribe(); // Stop listening
                        
                        // Update current recording
                        if (this.currentRecording && this.currentRecording.id === recordingId) {
                            this.currentRecording.transcript = data.transcript;
                            this.currentRecording.transcriptionModel = data.transcriptionModel || 'whisper-1';
                            
                            // Update transcript display
                            const transcriptText = document.getElementById('transcriptText');
                            const noTranscript = document.getElementById('noTranscript');
                            
                            if (transcriptText) {
                                transcriptText.style.display = 'block';
                                transcriptText.textContent = data.transcript;
                            }
                            if (noTranscript) noTranscript.style.display = 'none';
                        }
                        
                        // Update recordings list
                        const recIndex = this.recordings.findIndex(r => r.id === recordingId);
                        if (recIndex !== -1) {
                            this.recordings[recIndex].transcript = data.transcript;
                        }
                        
                        this.renderRecordings();
                        this.updateStats();
                        this.showToast('✅ Transcription complete!', 'success');
                    } else if (data.isTranscribing) {
                        this.showToast('🎤 Transcription in progress...', 'info');
                    }
                }, (error) => {
                    console.error('Error listening to recording updates:', error);
                    unsubscribe();
                });
            
            // Stop listening after 60 seconds as a safety measure
            setTimeout(() => {
                unsubscribe();
            }, 60000);
            
        } catch (error) {
            console.error('Error processing recording:', error);
            this.showToast(`❌ Failed to save recording: ${error.message}`, 'error');
        } finally {
            // Reset state
            this.audioChunks = [];
            this.recordingStartTime = null;
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.recordingsManager = new RecordingsManager();
});

// Task extraction is now automatic via cloud functions
// Tasks and conversation points are loaded in RecordingsManager.loadExtractedData()

