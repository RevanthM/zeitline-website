/**
 * HLO Engine API Client
 * Connects to the local Human Life Orchestration Engine backend
 */

const HLO_API = 'http://localhost:8000';

class HLOClient {
    constructor(baseUrl = HLO_API) {
        this.baseUrl = baseUrl;
    }

    /**
     * Get the current user ID (Firebase UID or generated)
     */
    getUserId() {
        // Try Firebase auth first
        if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
            return firebase.auth().currentUser.uid;
        }
        
        // Fall back to localStorage
        let userId = localStorage.getItem('zeitline_user_id');
        if (!userId) {
            userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('zeitline_user_id', userId);
        }
        return userId;
    }

    /**
     * Make an API request
     */
    async request(path, options = {}) {
        const url = `${this.baseUrl}${path}`;
        
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options,
        };

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.detail || `HTTP ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            if (error.message === 'Failed to fetch') {
                throw new Error('Cannot connect to HLO Engine. Make sure the server is running on localhost:8000');
            }
            throw error;
        }
    }

    // ==================== User Management ====================

    /**
     * Create a new user in HLO Engine
     */
    async createUser(name = null, email = null) {
        const userId = this.getUserId();
        return this.request('/api/users', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId,
                name: name,
                email: email,
            }),
        });
    }

    /**
     * Check if user exists, create if not
     */
    async ensureUser(name = null, email = null) {
        const userId = this.getUserId();
        try {
            // Try to get existing summary
            await this.getCanvasSummary();
            return { exists: true, userId };
        } catch (error) {
            // User doesn't exist, create them
            try {
                await this.createUser(name, email);
                return { exists: false, created: true, userId };
            } catch (createError) {
                throw createError;
            }
        }
    }

    // ==================== Canvas & Summary ====================

    /**
     * Get Life Canvas summary
     */
    async getCanvasSummary() {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/canvas/summary`);
    }

    /**
     * Get full Life Canvas
     */
    async getCanvas() {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/canvas`);
    }

    // ==================== Predictions ====================

    /**
     * Get predictions for a specific date
     */
    async getDayPrediction(dateStr) {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/canvas/days/${dateStr}`);
    }

    /**
     * Get predictions for a date range
     */
    async getDateRange(startDate, endDate) {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/canvas/range?start=${startDate}&end=${endDate}`);
    }

    /**
     * Trigger prediction generation
     */
    async generatePredictions(continuous = false, maxIterations = 4) {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/predict`, {
            method: 'POST',
            body: JSON.stringify({
                window_type: 'week',
                continuous: continuous,
                max_iterations: maxIterations,
            }),
        });
    }

    /**
     * Get prediction status
     */
    async getPredictionStatus() {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/predict/status`);
    }

    /**
     * Stop continuous prediction
     */
    async stopPredictions() {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/predict/stop`, {
            method: 'POST',
        });
    }

    // ==================== Intake ====================

    /**
     * Submit intake data (demographics, health, finances, goals)
     */
    async submitIntake(section, data) {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/intake`, {
            method: 'POST',
            body: JSON.stringify({
                section: section,
                data: data,
            }),
        });
    }

    /**
     * Complete intake and start predictions
     */
    async completeIntake() {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/intake/complete`, {
            method: 'POST',
        });
    }

    /**
     * Get user profile
     */
    async getProfile() {
        const userId = this.getUserId();
        return this.request(`/api/users/${userId}/profile`);
    }

    // ==================== Helpers ====================

    /**
     * Check if HLO Engine is running
     */
    async healthCheck() {
        try {
            const response = await this.request('/health');
            return { connected: true, ...response };
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }

    /**
     * Format date to ISO string (YYYY-MM-DD)
     */
    formatDate(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Get month date range
     */
    getMonthRange(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = d.getMonth();
        
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0);
        
        return {
            start: this.formatDate(start),
            end: this.formatDate(end),
        };
    }
}

// Global instance
const hloClient = new HLOClient();

// Export for use in other scripts
window.HLOClient = HLOClient;
window.hloClient = hloClient;





