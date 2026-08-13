/**
 * JDK Entertainment - Modals Component
 * Handles generic modal management
 */

/**
 * Initialize modal functionality
 */
export function initializeModals() {
    // Close modals when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal') ||
            e.target.id?.includes('Modal')) {
            // Check if click is on the overlay itself, not the content
            if (e.target === e.currentTarget) {
                closeAllModals();
            }
        }
    });

    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });
}

/**
 * Close all open modals
 */
export function closeAllModals() {
    const modals = document.querySelectorAll('[id$="Modal"], [id$="ModalAuth"], .modal');
    modals.forEach(modal => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    });
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.initializeModals = initializeModals;
    window.closeAllModals = closeAllModals;
}
