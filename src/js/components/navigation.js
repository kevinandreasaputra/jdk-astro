import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Navigation Component
 * Handles navigation and mobile menu functionality
 */

import { openLoginModal } from '../modules/auth.js';
import { getCurrentPage } from '../core/utils.js';

/**
 * Initialize navigation functionality
 */
export function initializeNavigation() {
    // Login button functionality
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.onclick = openLoginModal;
    }

    // Wire up user menu
    const userMenu = document.getElementById('userMenu');
    if (userMenu) {
        userMenu.style.cursor = 'pointer';
        userMenu.onclick = () => {
            window.location.href = '/profile';
        };
    }

    // Initialize iOS-style Tab Bar for mobile
    initializeIosTabBar();

    // Update active state for all links
    updateNavActiveState();
}

/**
 * Dynamically update the active state (underline/color) for navigation links
 */
export function updateNavActiveState() {
    const currentPage = getCurrentPage();
    logger.log(`📍 Updating Nav Active State for: ${currentPage}`);

    // Desktop Links
    const desktopLinks = document.querySelectorAll('.nav-links-desktop a');
    desktopLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const linkPage = href.split('.').shift().replace(/^\//, ''); // Handle '/games' -> 'games'

        // standard active classes: text-black border-b-2 border-black
        // standard inactive classes: text-black/80
        if (linkPage === currentPage || (currentPage === 'index' && (linkPage === 'index' || linkPage === ''))) {
            link.classList.add('text-black', 'border-b-2', 'border-black');
            link.classList.remove('text-black/80');
        } else {
            link.classList.remove('text-black', 'border-b-2', 'border-black');
            link.classList.add('text-black/80');
        }
    });

    // Mobile Menu Links
    const mobileLinks = document.querySelectorAll('#mobileMenu a');
    mobileLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        const linkPage = href.split('.').shift().replace(/^\//, '');

        if (linkPage === currentPage || (currentPage === 'index' && (linkPage === 'index' || linkPage === ''))) {
            link.classList.add('bg-black/5', 'text-black');
            // Some mobile menus use 'border-l-4 border-black' or similar, let's keep it consistent
        } else {
            link.classList.remove('bg-black/5', 'text-black');
        }
    });

    // iOS Tab Bar (Mobile)
    const tabBarItems = document.querySelectorAll('.ios-tab-item');
    tabBarItems.forEach(item => {
        const href = item.getAttribute('href') || '';
        const linkPage = href.split('.').shift().replace(/^\//, '');

        if (linkPage === currentPage || (currentPage === 'index' && (linkPage === 'index' || linkPage === ''))) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

/**
 * Initialize iOS-style Bottom Tab Bar for mobile devices
 */
function initializeIosTabBar() {
    // Only run if on mobile screen and tab bar doesn't exist
    // EXCLUDE LOBBY: The lobby has its own full-screen sidebar navigation
    if (window.innerWidth > 768 || document.querySelector('.ios-tab-bar') || getCurrentPage() === 'lobby') return;

    const currentPage = getCurrentPage();
    const tabBar = document.createElement('div');
    tabBar.className = 'ios-tab-bar';

    const menuItems = [
        { id: 'index', label: 'Home', icon: 'home', url: '/' }, // Root
        { id: 'lobby', label: 'Lobby', icon: 'chat', url: '/lobby' },
        { id: 'events', label: 'Events', icon: 'event', url: '/events' },
        { id: 'games', label: 'Games', icon: 'videogame_asset', url: '/games' },
        { id: 'more', label: 'More', icon: 'more_horiz', url: '#', isMore: true }
     ];

    tabBar.innerHTML = menuItems.map(item => `
        <a href="${item.url}" class="ios-tab-item ${currentPage === item.id ? 'active' : ''}" 
           ${item.isMore ? 'onclick="showIosActionSheet(event)"' : ''}>
            <span class="material-symbols-outlined">${item.icon}</span>
            <span>${item.label}</span>
        </a>
    `).join('');

    document.body.appendChild(tabBar);
}

/**
 * Show iOS-style Action Sheet for "More" menu
 */
window.showIosActionSheet = function (event) {
    if (event) event.preventDefault();

    // Check if already open
    if (document.querySelector('.ios-action-sheet')) return;

    const moreItems = [
        { id: 'marketplace', label: 'JDK Box', icon: 'shopping_bag', url: '/marketplace' },
        { id: 'gallery', label: 'Gallery', icon: 'gallery_thumbnail', url: '/gallery' },
        { id: 'contact', label: 'Contact', icon: 'contact_support', url: '/contact' },
        { id: 'profile', label: 'My Profile', icon: 'person', url: '/profile' }
    ];

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'ios-action-sheet-overlay';

    // Create sheet
    const sheet = document.createElement('div');
    sheet.className = 'ios-action-sheet';

    sheet.innerHTML = `
        <div class="ios-action-group">
            ${moreItems.map(item => `
                <a href="${item.url}" class="ios-action-item">
                    <span class="material-symbols-outlined">${item.icon}</span>
                    <span>${item.label}</span>
                </a>
            `).join('')}
        </div>
        <button class="ios-action-cancel">Cancel</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    // Trigger animation
    setTimeout(() => {
        overlay.classList.add('active');
        sheet.classList.add('active');
    }, 10);

    // Close logic
    const close = () => {
        overlay.classList.remove('active');
        sheet.classList.remove('active');
        setTimeout(() => {
            overlay.remove();
            sheet.remove();
        }, 300);
    };

    overlay.onclick = close;
    sheet.querySelector('.ios-action-cancel').onclick = close;
};



/**
 * Toggle mobile menu visibility
 */
export function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

// Expose to window for global access (needed for onclick handlers in HTML)
if (typeof window !== 'undefined') {
    window.toggleMobileMenu = toggleMobileMenu;
    window.initializeNavigation = initializeNavigation;
}
