import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - User Session Module
 * Handles user session management and UI state
 */

import { sbClient } from '../core/supabase.js';
import { showNotification, showSuspendedAlert, getCurrentPage } from '../core/utils.js';
import { calculateUserLevel } from './ranks.js';
import { unlockAchievement } from './achievements.js';

// 🔒 SECURITY: Reserved usernames to prevent identity hijacking
const RESERVED_USERNAMES = ['dinda', 'admin', 'system', 'jdk', 'jdkwan', 'mod', 'moderator', 'support'];

// Current user state
export let currentUser = null;

/**
 * Set current user (for internal use)
 * @param {object|null} user - User object or null
 */
export function setCurrentUser(user) {
    currentUser = user;
}

/**
 * Get current user
 * @returns {object|null} Current user object
 */
export function getCurrentUser() {
    return currentUser;
}

/**
 * Initialize user session from Supabase
 * @returns {Promise<boolean>} Success status
 */
export async function initializeUserSession() {
    if (!sbClient) return false;

    try {
        const { data: { session }, error } = await sbClient.auth.getSession();

        if (session) {
            logger.log('Session found, fetching profile for:', session.user.id);
            const metadata = session.user.user_metadata || {};

            // Fetch profile data
            let { data: profile, error: profileError } = await sbClient
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .maybeSingle(); // Use maybeSingle to handle missing profile gracefully

            // If profile is missing (common for brand new confirmed users)
            if (!profile && !profileError) {
                logger.log('Profile missing, creating from metadata...');

                let username = metadata.username || session.user.email.split('@')[0];

                // 🔒 SECURITY: Prevent hijacking reserved names via metadata
                if (RESERVED_USERNAMES.includes(username.toLowerCase())) {
                    logger.warn(`Reserved username spike: ${username}. Appending suffix...`);
                    username = `${username}_${session.user.id.substring(0, 4)}`;
                }

                // NEW: Generate Referral Code (e.g., JDK-ABCD1)
                const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
                const generatedCode = `JDK-${randomPart}`;

                const newProfile = {
                    id: session.user.id,
                    username: username,
                    full_name: metadata.full_name || '',
                    avatar_url: metadata.avatar_url || '',
                    status: 'active',
                    current_points: 0,
                    xp: 0,
                    coin: 0,
                    last_login: new Date().toISOString(),
                    confirmed_at: session.user.email_confirmed_at || null,
                    referral_code: generatedCode,
                    referred_by: sessionStorage.getItem('jdk_referral_code') || metadata.referred_by || null
                };

                // SECURE: Create profile via Edge Function
                const { data, error: createError } = await sbClient.functions.invoke('jdk-secure-handler', {
                    body: {
                        action: 'createProfile',
                        metadata: session.user.user_metadata,
                        email: session.user.email,
                        confirmed_at: session.user.email_confirmed_at,
                        referred_by: sessionStorage.getItem('jdk_referral_code') || metadata.referred_by
                    }
                });

                if (createError || !data.success) {
                    logger.error('Failed to create initial profile:', createError || data.message);
                } else {
                    profile = data.profile;
                    logger.log('Initial profile created successfully!');

                    // NEW: Handle Referral Rewards immediately after creation
                    if (profile.referred_by) {
                        handleReferralReward(profile);
                    }

                    // Cleanup captured referral code now that it's used
                    sessionStorage.removeItem('jdk_referral_code');
                }
            }

            if (profile) {
                // CHECK SUSPENDED STATUS
                if (profile.status === 'suspended') {
                    await sbClient.auth.signOut();
                    currentUser = null;
                    showSuspendedAlert();
                    updateUserInterface();
                    return false;
                }

                // SYNC REFERRAL CODE & EMAIL (SECURE)
                if (!profile.referral_code || !profile.confirmed_at) {
                    logger.log('Syncing profile metadata server-side...');
                    await sbClient.functions.invoke('jdk-secure-handler', {
                        body: { action: 'adminSyncProfile' }
                    });
                }

                currentUser = {
                    ...profile,
                    isLoggedIn: true,
                    role: 'Member',
                    name: profile.username || 'User',
                    email: session.user.email,
                    points: profile.current_points || 0,
                    created_at: session.user.created_at || profile.created_at
                };

                // Update last_login timestamp and Check Daily Login
                await handleDailyLogin(profile, session.user.id);

                // Initialize Notifications
                import('./notifications.js').then(module => {
                    module.initNotifications();
                });
            } else if (profileError) {
                logger.error('Profile fetch error:', profileError);
            }
        } else {
            currentUser = null;
        }
    } catch (err) {
        logger.error('Session init error:', err);
    }

    updateUserInterface();
    return true;
}

/**
 * Handle daily login rewards (SECURE - uses Supabase Edge Function)
 * @param {object} profile - User profile
 * @param {string} userId - User ID
 */
async function handleDailyLogin(profile, userId) {
    try {
        logger.log('🔄 Attempting daily login Edge Function call...');

        // Add timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Edge Function timeout')), 10000)
        );

        const functionCall = sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'dailyLogin' }
        });

        // Race between function call and timeout
        const { data, error } = await Promise.race([functionCall, timeoutPromise]);

        if (error) {
            logger.error('❌ Daily login Edge Function error:', error);
            logger.error('Error details:', {
                message: error.message,
                context: error.context,
                name: error.name
            });
            // Don't throw - let lobby continue to load
            return;
        }

        if (data && data.success) {
            if (data.already_claimed) {
                // Same day login, just update local timestamp
                logger.log('✅ Already claimed daily login today');
                return;
            }

            // Update local user state with new values from server
            currentUser.xp = data.new_xp;
            currentUser.points = data.new_points;

            // Show appropriate notifications
            showNotification(`🎉 Daily Login! +${data.xp_added} XP & +${data.points_added} Points`);

            // Check for Login Streak Achievement
            if (data.streak >= 7) {
                unlockAchievement(userId, 'Login Streak');
            }

            logger.log('✅ Daily login successful:', data);
        } else if (data) {
            logger.log('⚠️ Daily login response:', data.message || data.error);
        }
    } catch (e) {
        // Graceful degradation - lobby should still work
        logger.warn('⚠️ Daily login check skipped due to error:', e.message);
        logger.warn('This is not critical - the lobby will still function normally');
    }
}



/**
 * Update user interface elements based on login state
 */
export function updateUserInterface() {
    // FIX: Match the actual ID in HTML (userMenuBtn) instead of userMenu
    const userMenu = document.getElementById('userMenuBtn');
    const loginBtn = document.getElementById('loginBtn');
    const userName = document.getElementById('userName');
    const userAvatar = document.getElementById('userAvatar');
    const profileAvatar = document.getElementById('profileAvatar');
    const localUsernameEl = document.getElementById('localUsername');
    const localAvatarEl = document.getElementById('localAvatar');
    const localSettingsBtn = document.getElementById('localSettingsBtn');

    if (currentUser && currentUser.isLoggedIn) {
        if (userMenu) {
            userMenu.classList.remove('hidden');
            userMenu.classList.add('cursor-pointer');
            userMenu.onclick = () => window.location.href = '/profile';

            // NEW: Display Username in Navbar
            // Assuming userMenu structure: <button id="userMenuBtn"> <span class="material-symbols-outlined">account_circle</span> </button>
            // We'll append the username text next to the icon
            const menuBtn = document.getElementById('userMenuBtn');
            if (menuBtn) {
                // Clear existing content to avoid duplication on re-renders, but keep the icon structure if possible or rebuild it
                // Better approach: Set innerHTML to include both icon and text
                menuBtn.innerHTML = `
                    <span class="material-symbols-outlined font-bold">account_circle</span>
                    <span class="font-bold text-sm uppercase hidden sm:inline-block ml-1">${currentUser.username || currentUser.name}</span>
                `;
                menuBtn.classList.add('flex', 'items-center', 'gap-1');
            }
        }
        if (loginBtn) loginBtn.classList.add('hidden');
        if (userName) userName.textContent = currentUser.username || currentUser.name;

        if (userAvatar) {
            if (currentUser.avatar_url) {
                userAvatar.src = currentUser.avatar_url;
                userAvatar.classList.remove('bg-red-500', 'text-white');
            } else {
                userAvatar.src = '';
                userAvatar.className = 'w-8 h-8 rounded-full bg-red-500 flex items-center justify-center text-white font-bold border-2 border-black';
                userAvatar.textContent = (currentUser.username || 'U').charAt(0).toUpperCase();
            }
        }

        // Rank Badge in Nav
        const { rankIcon, rankName } = calculateUserLevel(currentUser.xp || 0);
        if (userName && rankIcon) {
            let navRankBadge = document.getElementById('navRankBadge');
            if (!navRankBadge) {
                navRankBadge = document.createElement('img');
                navRankBadge.id = 'navRankBadge';
                navRankBadge.className = 'w-6 h-6 object-contain';
                navRankBadge.title = rankName;
                userName.parentNode.insertBefore(navRankBadge, userName);
            }
            navRankBadge.src = rankIcon;
            navRankBadge.title = rankName;
        }

        // --- SIDEBAR PROFILE SYNC (Lobby) ---
        if (localUsernameEl) localUsernameEl.textContent = currentUser.username || currentUser.name;
        if (localAvatarEl) {
            if (rankIcon) {
                localAvatarEl.src = rankIcon;
                localAvatarEl.title = rankName;
            } else if (currentUser.avatar_url) {
                localAvatarEl.src = currentUser.avatar_url;
            }
        }

        if (localSettingsBtn) {
            localSettingsBtn.onclick = () => window.location.href = '/profile';
            localSettingsBtn.title = "User Settings";
        }

        // --- MAILBOX / NOTIFICATION ICON INJECTION ---
        if (userMenu) {
            // 1. Notification Bell
            if (!document.getElementById('navNotificationBtn')) {
                const notifBtn = document.createElement('div');
                notifBtn.id = 'navNotificationBtn';
                notifBtn.className = 'relative cursor-pointer hover:scale-110 transition-transform mr-3 bg-transparent text-black'; // Added margin right & text-black
                notifBtn.innerHTML = `
                    <div class="p-1 flex items-center justify-center p-btn-reset">
                        <span class="material-symbols-outlined text-2xl font-bold">notifications</span>
                        <div id="navNotificationBadge" class="hidden absolute -top-1 -right-1 bg-comic-red text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-black animate-bounce">0</div>
                    </div>
                `;
                notifBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (window.openNotifications) window.openNotifications();
                };
                userMenu.parentNode.insertBefore(notifBtn, userMenu); // Insert before user menu
            }

            // 2. Mailbox Icon
            if (!document.getElementById('navMailboxBtn')) {
                const mailBtn = document.createElement('div');
                mailBtn.id = 'navMailboxBtn';
                mailBtn.className = 'relative cursor-pointer hover:scale-110 transition-transform mr-3 bg-transparent text-black';
                mailBtn.innerHTML = `
                    <div class="p-1 flex items-center justify-center p-btn-reset">
                        <span class="material-symbols-outlined text-2xl font-bold">mail</span>
                        <div id="mailboxBadge" class="hidden absolute -top-1 -right-1 bg-blue-600 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-black">0</div>
                    </div>
                `;
                mailBtn.onclick = (e) => {
                    e.stopPropagation();
                    window.location.href = '/mailbox';
                };
                // Insert before user menu (after notification if existing, or before user menu)
                // Simplest: UserMenu is last. Insert Mailbox before UserMenu. Insert Notification before Mailbox.
                userMenu.parentNode.insertBefore(mailBtn, userMenu);
            }

            // Fix order: Notification -> Mailbox -> UserMenu
            const parent = userMenu.parentNode;
            const notif = document.getElementById('navNotificationBtn');
            const mail = document.getElementById('navMailboxBtn');

            if (notif && mail && userMenu) {
                parent.insertBefore(notif, mail);
                parent.insertBefore(mail, userMenu);
            }

            // Trigger updates
            if (window.updateUnreadCount) window.updateUnreadCount();
            // Notifications init is called in main.js or here
            import('./notifications.js').then(module => {
                if (window.fetchNotifications) window.fetchNotifications();
            });
        }

        // Update big profile avatar if present
        if (profileAvatar && currentUser.avatar_url) {
            profileAvatar.src = currentUser.avatar_url;
        }

        // Update Profile Header Name (only on profile page)
        if (getCurrentPage() === 'profile') {
            const nameHeader = document.querySelector('h1.section-title');
            if (nameHeader) {
                const displayName = `${currentUser.username || 'User'} - ${currentUser.full_name || currentUser.name || ''}`;
                nameHeader.textContent = displayName.toUpperCase();
            }

            // Show Admin Button if it exists in HTML
            const adminBtn = document.getElementById('adminBtn');
            if (adminBtn) {
                if ((currentUser.user_level || '').toLowerCase() === 'admin') {
                    adminBtn.classList.remove('hidden');
                } else {
                    adminBtn.classList.add('hidden');
                }
            }
        }

        // Hide "Gabung Komunitas" buttons if logged in
        const joinBtn = document.getElementById('navJoinBtn');
        const joinBtnMobile = document.getElementById('navJoinBtnMobile');
        if (joinBtn) joinBtn.classList.add('hidden');
        if (joinBtnMobile) joinBtnMobile.classList.add('hidden');

        // --- GLOBAL ADMIN NAV INJECTION ---
        if ((currentUser.user_level || '').toLowerCase() === 'admin') {
            // Desktop Nav
            const desktopNav = document.querySelector('.nav-links-desktop');
            if (desktopNav && !document.getElementById('navAdminLink')) {
                const adminLink = document.createElement('a');
                adminLink.id = 'navAdminLink';
                adminLink.href = '/admin';
                adminLink.className = 'nav-link text-comic-red font-bold animate-pulse';
                adminLink.textContent = 'ADMIN';
                desktopNav.appendChild(adminLink);
            }

            // Mobile Nav
            const mobileMenu = document.getElementById('mobileMenu');
            if (mobileMenu && !document.getElementById('mobileNavAdminLink')) {
                const mobileAdminLink = document.createElement('a');
                mobileAdminLink.id = 'mobileNavAdminLink';
                mobileAdminLink.href = '/admin';
                mobileAdminLink.className = 'mobile-nav-link text-comic-red font-bold';
                mobileAdminLink.textContent = 'ADMIN DASHBOARD';
                mobileMenu.appendChild(mobileAdminLink);
            }
        }
    } else {
        if (userMenu) userMenu.classList.add('hidden');
        if (loginBtn) loginBtn.classList.remove('hidden');

        // Show "Gabung Komunitas" buttons if not logged in
        const joinBtn = document.getElementById('navJoinBtn');
        const joinBtnMobile = document.getElementById('navJoinBtnMobile');
        if (joinBtn) joinBtn.classList.remove('hidden');
        if (joinBtnMobile) joinBtnMobile.classList.remove('hidden');

        // Reset Sidebar Profile
        if (localUsernameEl) localUsernameEl.textContent = 'Guest';
        if (localAvatarEl) localAvatarEl.src = '/images/mr-jdk-mascot.png';
        if (localSettingsBtn) {
            localSettingsBtn.onclick = () => { if (window.openLoginModal) window.openLoginModal(); };
            localSettingsBtn.title = "Sign In";
        }
    }
}

/**
 * Award points for referral (SECURE - uses Supabase Edge Function)
 * @param {object} refereeProfile - The profile of the new user who was referred
 */
async function handleReferralReward(refereeProfile) {
    if (!refereeProfile || !refereeProfile.referred_by) return;

    try {
        logger.log(`🎁 Processing referral reward for ${refereeProfile.username}`);

        // Call secure Supabase Edge Function that handles all referral logic atomically
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'referralReward',
                referrer_code: refereeProfile.referred_by
            }
        });

        if (error) {
            logger.error('Referral Edge Function error:', error);
            return;
        }

        if (data.success) {
            logger.log(`✅ Referral rewards awarded! Referee got ${data.referee_reward} points`);
        } else {
            logger.log('Referral reward:', data.message || data.error);
        }
    } catch (err) {
        logger.error('Error in referral reward processing:', err);
    }
}


// Expose to window for global access
if (typeof window !== 'undefined') {
    // Use defineProperty for currentUser so it always returns the latest value
    Object.defineProperty(window, 'currentUser', {
        get: function () { return currentUser; },
        set: function (val) { currentUser = val; },
        configurable: true
    });
    window.getCurrentUser = getCurrentUser;
    window.setCurrentUser = setCurrentUser;
    window.initializeUserSession = initializeUserSession;
    window.updateUserInterface = updateUserInterface;
}

