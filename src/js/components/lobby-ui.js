/**
 * JDK Entertainment - Lobby UI Helpers
 * Extracted from inline scripts for CSP compliance (SECURITY_RULES.md)
 */

/**
 * Toggle left sidebar for mobile
 */
function toggleLobbySidebar() {
    const sb = document.getElementById('leftSidebar');
    const overlay = document.getElementById('mobileOverlay');

    if (sb && overlay) {
        if (sb.classList.contains('-translate-x-full')) {
            sb.classList.remove('-translate-x-full');
            overlay.classList.remove('hidden');
        } else {
            sb.classList.add('-translate-x-full');
            overlay.classList.add('hidden');
        }
    }
}

/**
 * Alias for backward compatibility
 */
function toggleMobileMenu() {
    toggleLobbySidebar();
}

/**
 * Toggle right sidebar
 */
function toggleRightSidebar() {
    const sb = document.getElementById('rightSidebar');
    if (sb) {
        sb.classList.toggle('hidden');
    }
}

// Expose functions globally for onclick handlers
if (typeof window !== 'undefined') {
    window.toggleLobbySidebar = toggleLobbySidebar;
    window.toggleMobileMenu = toggleMobileMenu;
    window.toggleRightSidebar = toggleRightSidebar;
}
