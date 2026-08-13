/**
 * JDK Entertainment - Security Module
 * Handles sanitization, rate limiting, and secure API calls
 */

import { sbClient } from './supabase.js';

/**
 * Secure client for server-side validated operations
 */
export class SecureClient {
    /**
     * Call a secure Edge Function action with idempotency
     * @param {string} action - Action name (e.g., 'createDuel', 'createLotteryEntry')
     * @param {object} payload - Action payload
     * @returns {Promise<object>} Response data
     */
    static async callSecureAction(action, payload) {
        // Generate idempotency key for duplicate prevention
        const idempotency_key = `${action}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Add timestamp for server-side validation
        const submitted_at = new Date().toISOString();

        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action,
                payload: {
                    ...payload,
                    idempotency_key,
                    submitted_at
                }
            }
        });

        if (error) {
            throw new Error(error.message || 'Request failed');
        }

        if (!data || !data.success) {
            throw new Error(data?.error || data?.message || 'Operation failed');
        }

        return data;
    }
}

/**
 * Client-side rate limiting helper
 */
class RateLimiter {
    constructor() {
        this.cooldowns = new Map();
    }

    /**
     * Check if action is allowed (respects cooldown)
     * @param {string} action - Action identifier
     * @param {number} cooldownMs - Cooldown in milliseconds
     * @returns {boolean} True if allowed
     * @throws {Error} If still in cooldown
     */
    check(action, cooldownMs) {
        const lastAction = this.cooldowns.get(action);

        if (lastAction && Date.now() - lastAction < cooldownMs) {
            const waitTime = Math.ceil((cooldownMs - (Date.now() - lastAction)) / 1000);
            throw new Error(`Tunggu ${waitTime} detik sebelum melakukan aksi ini lagi`);
        }

        this.cooldowns.set(action, Date.now());
        return true;
    }

    /**
     * Reset cooldown for an action
     * @param {string} action - Action identifier
     */
    reset(action) {
        this.cooldowns.delete(action);
    }

    /**
     * Clear all cooldowns
     */
    clearAll() {
        this.cooldowns.clear();
    }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

/**
 * Input validation helpers
 */
export const validators = {
    /**
     * Check if string contains HTML/XSS attempts
     */
    containsHTML: (str) => {
        return /<|>/.test(str) || /&[a-z]+;/i.test(str);
    },

    /**
     * Validate phone number format
     */
    isValidPhone: (str) => {
        return !str || /^[0-9+\-\s()]*$/.test(str);
    },

    /**
     * Validate username format
     */
    isValidUsername: (str) => {
        return /^[a-zA-Z0-9._-]+$/.test(str);
    },

    /**
     * Validate email format
     */
    isValidEmail: (str) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
    }
};

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.SecureClient = SecureClient;
    window.rateLimiter = rateLimiter;
    window.validators = validators;
}
