/**
 * JDK Entertainment - Input Sanitizer
 * XSS protection using DOMPurify
 */

import DOMPurify from 'dompurify';

/**
 * Sanitize user-generated HTML content
 * @param {string} dirty - Unsanitized HTML string
 * @param {object} options - DOMPurify configuration options
 * @returns {string} Sanitized HTML
 */
export function sanitizeHTML(dirty, options = {}) {
    if (!dirty || typeof dirty !== 'string') return '';

    const defaultConfig = {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br', 'p', 'a'],
        ALLOWED_ATTR: ['href', 'target'],
        ALLOW_DATA_ATTR: false,
        ...options
    };

    return DOMPurify.sanitize(dirty, defaultConfig);
}

/**
 * Sanitize plain text (strip all HTML tags)
 * @param {string} text - Text that may contain HTML
 * @returns {string} Text with all HTML removed
 */
export function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';

    return DOMPurify.sanitize(text, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: []
    });
}

/**
 * Sanitize for chat messages (allows minimal formatting)
 * @param {string} message - Chat message
 * @returns {string} Sanitized message
 */
export function sanitizeChatMessage(message) {
    if (!message || typeof message !== 'string') return '';

    return DOMPurify.sanitize(message, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong'],
        ALLOWED_ATTR: [],
        KEEP_CONTENT: true
    });
}

/**
 * Sanitize for rich text editor (more permissive)
 * @param {string} content - Rich text content
 * @returns {string} Sanitized content
 */
export function sanitizeRichText(content) {
    if (!content || typeof content !== 'string') return '';

    return DOMPurify.sanitize(content, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br', 'p', 'ul', 'ol', 'li', 'a', 'blockquote'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
        ALLOW_DATA_ATTR: false
    });
}

/**
 * Escape HTML entities for display as text
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHTML(text) {
    if (!text || typeof text !== 'string') return '';

    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.sanitizeHTML = sanitizeHTML;
    window.sanitizeText = sanitizeText;
    window.sanitizeChatMessage = sanitizeChatMessage;
    window.sanitizeRichText = sanitizeRichText;
    window.escapeHTML = escapeHTML;
}
