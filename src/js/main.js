console.log('🚀 Module: main.js loaded');
import { logger } from './core/logger.js';
// Core imports
import { sbClient } from './core/supabase.js';
import { showNotification, getCurrentPage, injectAnimationStyles } from './core/utils.js';
import { Router } from './core/router.js';

// Module imports
import { fetchRanks, calculateUserLevel } from './modules/ranks.js';
import { initializeUserSession, updateUserInterface, getCurrentUser } from './modules/user-session.js';
import { createAuthModals, handleLogout, openLoginModal } from './modules/auth.js';

// Component imports
import { initializeNavigation, toggleMobileMenu } from './components/navigation.js';
import { initializeModals } from './components/modals.js';
import { initializeAnimations } from './components/animations.js';
import { initializeRadioWidget } from './components/RadioWidget.js';

let isFirstLoad = true;
let router = null;
let currentPageCleanup = null;
let currentPageName = null;

/**
 * Initialize global components that should survive page transitions
 */
async function initializeGlobal() {
    logger.log('🌍 JDK Entertainment - Global Init...');

    // Inject animation styles
    injectAnimationStyles();

    // ⚡ PERF: Parallelize independent async operations
    await Promise.all([
        fetchRanks(),
        initializeUserSession()
    ]);

    // Inject Auth Modals
    createAuthModals();

    // Initialize common functionality
    initializeModals();

    // ⚡ PERF: Defer non-critical modules to idle time
    const deferToIdle = (fn) => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(fn, { timeout: 3000 });
        } else {
            setTimeout(fn, 1000);
        }
    };

    deferToIdle(() => {
        initializeRadioWidget().catch(e => logger.error('Radio widget failed:', e));
    });

    // Register page cleanup listener for Astro Client Router
    document.addEventListener('astro:before-swap', async () => {
        if (currentPageCleanup) {
            logger.log(`🧹 Cleaning up page: ${currentPageName}`);
            try {
                await currentPageCleanup();
            } catch (e) {
                logger.error(`Cleanup error for ${currentPageName}:`, e);
            }
            currentPageCleanup = null;
            currentPageName = null;
        }
    });

    isFirstLoad = false;
}

/**
 * Initialize page-specific functionality
 */
async function initializePage() {
    const currentPage = getCurrentPage();
    logger.log(`📄 Initializing page: ${currentPage} (URL: ${window.location.pathname})`);

    // Re-run common initializations that might be scoped to DOM elements
    initializeNavigation();
    initializeAnimations();

    // Global exports for HTML event handlers
    window.toggleMobileMenu = toggleMobileMenu;
    window.openLoginModal = openLoginModal;
    window.handleLogout = handleLogout;

    // ⚡ PERF: Defer mailbox to idle time (non-critical for initial render)
    const deferMailbox = () => {
        const loadMailbox = async () => {
            try {
                const { initializeMailbox, updateUnreadCount, openInbox } = await import('./modules/mailbox.js');
                window.updateUnreadCount = updateUnreadCount;
                window.openInbox = openInbox;
                await initializeMailbox();
            } catch (e) {
                logger.warn('Mailbox module failed to load:', e);
            }
        };
        if ('requestIdleCallback' in window) {
            requestIdleCallback(loadMailbox, { timeout: 5000 });
        } else {
            setTimeout(loadMailbox, 2000);
        }
    };
    deferMailbox();

    // Capture recovery mode only on first real load or specific checks
    const hash = window.location.hash;
    const urlParams = new URLSearchParams(window.location.search);

    if (hash && hash.includes('type=recovery')) {
        sessionStorage.setItem('jdk_recovery_mode', 'true');
    }

    // Handle Referral Code
    const refCode = urlParams.get('ref') || urlParams.get('referral');
    if (refCode) {
        sessionStorage.setItem('jdk_referral_code', refCode);
    }

    // Handle Login Redirects
    if (urlParams.get('login') === 'true') {
        setTimeout(() => {
            if (window.openLoginModal) window.openLoginModal();
            if (urlParams.get('warning') === 'lobby_auth') {
                showNotification('⛔ AKSES DITOLAK!<br>Harap login untuk masuk ke Lobby.', 10000);
            }
        }, 500);
    }

    switch (currentPage) {
        case 'index':
            const { initializeHomePage, cleanupHomePage } = await import('./pages/home.js');
            initializeHomePage();
            currentPageCleanup = cleanupHomePage;
            currentPageName = 'index';
            break;
        case 'events':
            try {
                const { initializeEventsPage } = await import('./pages/events.js');
                initializeEventsPage();
            } catch (e) {
                logger.error('Failed to load events module:', e);
            }
            break;
        case 'event-detail':
            try {
                const { initializeEventDetailPage } = await import('./pages/event-detail.js');
                await initializeEventDetailPage();
            } catch (e) {
                logger.error('Failed to load event detail module:', e);
            }
            break;
        case 'marketplace':
            const { initializeMarketplacePage, cleanupMarketplacePage } = await import('./pages/marketplace.js');
            await initializeMarketplacePage();
            currentPageCleanup = cleanupMarketplacePage;
            break;
        case 'product':
            const { initializeProductPage } = await import('./pages/product.js');
            await initializeProductPage();
            break;
        case 'rekber':
            const { initializeRekberPage } = await import('./pages/rekber.js');
            await initializeRekberPage();
            break;
        case 'gallery':
            const { initializeGalleryPage } = await import('./pages/gallery.js');
            initializeGalleryPage();
            break;
        case 'profile':
            const { initializeProfilePage } = await import('./pages/profile.js');
            initializeProfilePage();
            break;
        case 'games':
            const { initializeGamesPage } = await import('./pages/games.js');
            initializeGamesPage();
            break;
        case 'game-forum':
            const { initializeGameForumPage } = await import('./pages/game-forum.js');
            initializeGameForumPage();
            break;
        case 'lobby':
            try {
                const { initializeLobbyPage, cleanupLobbyPage } = await import('./pages/lobby.js');
                await initializeLobbyPage();
                currentPageCleanup = cleanupLobbyPage;
                currentPageName = 'lobby';
            } catch (e) {
                logger.error('Failed to load lobby module:', e);
            }
            break;
        case 'admin':
            const { initializeAdminDashboard } = await import('./pages/admin-dashboard.js');
            await initializeAdminDashboard();
            break;
        case 'admin-leaderboard':
            const { initializeAdminLeaderboard } = await import('./pages/admin-leaderboard.js');
            await initializeAdminLeaderboard();
            break;
        case 'admin_events':
            const { initializeAdminEvents } = await import('./pages/admin-events.js');
            await initializeAdminEvents();
            break;
        case 'admin_games':
            const { initializeAdminGames } = await import('./pages/admin-games.js');
            await initializeAdminGames();
            break;
        case 'admin_coin':
        case 'admin_achievements':
        case 'admin_slider':
        case 'admin_referrals':
        case 'admin_rekber':
        case 'admin-rekber':
        case 'admin_marketplace':
        case 'admin_scanner':
        case 'admin_duels':
        case 'admin_stickers':
            // Fallback for pages not yet fully refactored for SPA
            const { initializeAdminLayout } = await import('./core/admin-layout.js');
            await initializeAdminLayout();
            break;
        case 'admin_radio':
        case 'admin-radio':
            const { initializeAdminRadioPage } = await import('./pages/admin-radio.js');
            initializeAdminRadioPage();
            break;
        default:
            logger.log('Default page initialization');
    }
}

/**
 * Main entry point
 */
async function initializeApp() {
    if (isFirstLoad) {
        await initializeGlobal();
    }
    await initializePage();
    logger.log('✅ JDK Entertainment - Ready!');
}

// Initialize when DOM is ready or after page transitions in Astro
document.addEventListener('astro:page-load', initializeApp);

// Global exports
if (typeof window !== 'undefined') {
    window.sbClient = sbClient;
    window.showNotification = showNotification;
    window.getCurrentPage = getCurrentPage;
    window.calculateUserLevel = calculateUserLevel;
    window.fetchRanks = fetchRanks;
    window.getCurrentUser = getCurrentUser;
    window.updateUserInterface = updateUserInterface;
    window.handleLogout = handleLogout;
    window.openLoginModal = openLoginModal;
    window.toggleMobileMenu = toggleMobileMenu;
}
