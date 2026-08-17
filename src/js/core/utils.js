/**
 * JDK Entertainment - Utility Functions
 * Shared helper functions used across all modules
 */

import { sbClient } from './supabase.js';

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {number} duration - Duration in milliseconds (default 3000)
 */
export function showNotification(message, typeOrDuration = 4000) {
    let duration = 4000;
    let type = 'info';

    // Handle polymorphism: (msg, 5000) or (msg, 'error')
    if (typeof typeOrDuration === 'number') {
        duration = typeOrDuration;
    } else if (typeof typeOrDuration === 'string') {
        type = typeOrDuration;
        if (type === 'error') duration = 4000; // Standardized to 4s as requested
    }

    // Remove existing notification if any
    const existing = document.getElementById('jdkNotification');
    if (existing) existing.remove();

    // Determine styles based on type
    let bgColor = '#FFE900'; // Default Yellow
    let textColor = '#000000';

    if (type === 'error') {
        bgColor = '#ef4444'; // Red
        textColor = '#ffffff';
    } else if (type === 'success') {
        bgColor = '#4ade80'; // Green
        textColor = '#000000';
    }

    const notification = document.createElement('div');
    notification.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-[10000] px-6 py-3 rounded-lg border-3 border-black shadow-hard font-bold font-body text-lg text-center';
    notification.style.cssText = `background: ${bgColor}; color: #000000 !important; animation: popIn 0.3s ease-out; min-width: 320px;`;
    notification.innerHTML = message;

    document.body.appendChild(notification);

    // Auto-remove after duration
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'popIn 0.3s ease-out reverse';
            setTimeout(() => notification.remove(), 300);
        }
    }, duration);
}

/**
 * Show suspended account alert
 */
export function showSuspendedAlert() {
    // Remove existing
    const existing = document.getElementById('suspendedOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'suspendedOverlay';
    overlay.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[500]';
    overlay.innerHTML = `
        <div class="bg-white p-8 rounded-2xl border-4 border-red-500 shadow-hard-lg max-w-md text-center">
            <div class="text-6xl mb-4">🚫</div>
            <h2 class="font-display text-3xl text-red-500 mb-4">AKUN DISUSPEND</h2>
            <p class="font-body text-lg mb-6">
                Akun kamu telah disuspend oleh admin. 
                <br>Hubungi admin untuk informasi lebih lanjut.
            </p>
            <button onclick="document.getElementById('suspendedOverlay').remove(); window.location.href='contact';" 
                class="btn-primary">
                HUBUNGI ADMIN
            </button>
        </div>
    `;
    document.body.appendChild(overlay);
}

/**
 * Get current page name from URL
 * @returns {string} Page name (e.g., 'index', 'profile', 'events')
 */
export function getCurrentPage() {
    const path = window.location.pathname;

    // Normalize path: handle trailing slashes and common clean URL patterns
    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;

    // Check specific admin pages first
    if (path.includes('admin_events') || normalizedPath === '/admin_events') return 'admin_events';
    if (path.includes('admin_games') || normalizedPath === '/admin_games') return 'admin_games';
    if (path.includes('admin_coin') || normalizedPath === '/admin_coin') return 'admin_coin';
    if (path.includes('admin-rekber') || normalizedPath === '/admin-rekber') return 'admin-rekber';
    if (path.includes('admin_radio') || normalizedPath === '/admin_radio') return 'admin-radio';
    if (path.includes('admin_leaderboard') || normalizedPath === '/admin_leaderboard') return 'admin-leaderboard';
    if (path.includes('admin_referrals') || normalizedPath === '/admin_referrals') return 'admin_referrals';
    if (path.includes('admin_stickers') || normalizedPath === '/admin_stickers') return 'admin_stickers';
    if (path.includes('admin_achievements') || normalizedPath === '/admin_achievements') return 'admin_achievements';
    if (path.includes('admin_slider') || normalizedPath === '/admin_slider') return 'admin_slider';
    if (path.includes('admin_duels') || normalizedPath === '/admin_duels') return 'admin_duels';

    // Check general pages (with .html AND clean URL support)
    if (path.includes('event-detail') || normalizedPath === '/event-detail') return 'event-detail';
    if (path.includes('events') || normalizedPath === '/events') return 'events';
    if (path.includes('marketplace') || normalizedPath === '/marketplace') return 'marketplace';
    if (path.includes('product') || normalizedPath === '/product') return 'product';
    if (path.includes('rekber') || normalizedPath === '/rekber') return 'rekber';
    if (path.includes('gallery') || normalizedPath === '/gallery') return 'gallery';
    if (path.includes('profile') || normalizedPath === '/profile') return 'profile';
    if (path.includes('game-forum') || normalizedPath === '/game-forum') return 'game-forum';
    if (path.includes('games') || normalizedPath === '/games') return 'games';
    if (path.includes('lobby') || normalizedPath === '/lobby') return 'lobby';
    if (path.includes('admin') || normalizedPath === '/admin') return 'admin';
    if (path.includes('contact') || normalizedPath === '/contact') return 'contact';
    if (path.includes('mailbox') || normalizedPath === '/mailbox') return 'mailbox';

    return 'index';
}

/**
 * Inject animation keyframes if not already present
 */
export function injectAnimationStyles() {
    if (document.getElementById('jdk-anim-styles')) return;

    const style = document.createElement('style');
    style.id = 'jdk-anim-styles';
    style.innerHTML = `
        @keyframes popIn {
            0% { transform: translate(-50%, -20px) scale(0.8); opacity: 0; }
            100% { transform: translate(-50%, 0) scale(1); opacity: 1; }
        }
        @keyframes slideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - Raw string
 * @returns {string} Escaped string
 */
export function escapeHTML(str) {
    if (!str) return '';
    if (typeof str !== 'string') return String(str);

    return str.replace(/[&<>"']/g, function (m) {
        switch (m) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#039;';
        }
    });
}

/**
 * Check password strength and return score with metadata
 * @param {string} password - Password to check
 * @returns {object} Strength result with score, color, label, width
 */
export function checkPasswordStrength(password) {
    if (!password) return { score: 0, color: 'bg-gray-300', label: '', width: 0 };

    let score = 0;
    if (password.length >= 8) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    // Normalize to 0-4 range
    const normalizedScore = Math.min(score, 4);

    const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-400', 'bg-green-600'];
    const labels = ['Sangat Lemah', 'Lemah', 'Cukup', 'Kuat', 'Sangat Kuat'];

    return {
        score: normalizedScore,
        color: colors[normalizedScore],
        label: labels[normalizedScore],
        width: (normalizedScore + 1) * 20
    };
}

/**
 * Get relative time string (e.g., "2 jam yang lalu")
 * @param {Date} date - Date object
 * @returns {string} Relative time string
 */
export function getRelativeTime(date) {
    if (!date) return '-';

    // Ensure we have a Date object
    const dateObj = (date instanceof Date) ? date : new Date(date);

    // Check for invalid date
    if (isNaN(dateObj.getTime())) return '-';

    const now = new Date();
    const diffInSeconds = Math.floor((now - dateObj) / 1000);

    if (diffInSeconds < 0) return 'Baru saja';
    if (diffInSeconds < 60) return 'Baru saja';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} menit yang lalu`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} jam yang lalu`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} hari yang lalu`;

    return dateObj.toLocaleDateString('id-ID');
}

/**
 * Format number to IDR currency
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
export function formatCurrency(amount) {
    if (amount === undefined || amount === null) return 'Rp 0';
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(amount);
}

/**
 * Format date to be human readable (Indonesia)
 * @param {string|Date} dateString - Date to format
 * @returns {string} Formatted date string
 */
export function formatFriendlyDate(dateString) {
    if (!dateString) return '-';

    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
        return `Hari ini, ${timeStr}`;
    } else if (isYesterday) {
        return `Kemarin, ${timeStr}`;
    } else {
        return date.toLocaleDateString('id-ID', {
            weekday: 'long',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.showNotification = showNotification;
    window.showSuspendedAlert = showSuspendedAlert;
    window.getCurrentPage = getCurrentPage;
    window.escapeHTML = escapeHTML;
    window.checkPasswordStrength = checkPasswordStrength;
    window.getRelativeTime = getRelativeTime;
    window.formatCurrency = formatCurrency;
    window.formatFriendlyDate = formatFriendlyDate;
}
