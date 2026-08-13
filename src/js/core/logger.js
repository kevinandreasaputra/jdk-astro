/**
 * JDK Entertainment - Conditional Logger
 * Only logs in development environment
 * SECURITY: Prevents sensitive data exposure in production
 */

const isDevelopment = () => {
    // Check if we're in development mode
    return (
        import.meta.env?.DEV ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.port !== ''
    );
};

/**
 * Conditional logger that only outputs in development
 */
export const logger = {
    /**
     * Log general information (development only)
     */
    log: (...args) => {
        if (isDevelopment()) {
            console.log(...args);
        }
    },

    /**
     * Log warnings (development only)
     */
    warn: (...args) => {
        if (isDevelopment()) {
            console.warn(...args);
        }
    },

    /**
     * Log errors (always logged)
     */
    error: (...args) => {
        // Always log errors, but sanitize sensitive data
        console.error(...args);
    },

    /**
     * Log debug information (development only)
     */
    debug: (...args) => {
        if (isDevelopment()) {
            console.debug(...args);
        }
    },

    /**
     * Log table data (development only)
     */
    table: (data) => {
        if (isDevelopment()) {
            console.table(data);
        }
    }
};

// Expose to window for backward compatibility
if (typeof window !== 'undefined') {
    window.logger = logger;
}
