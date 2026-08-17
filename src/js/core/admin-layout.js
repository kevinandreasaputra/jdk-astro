import { logger } from './logger.js';
/**
 * Admin Layout Manager (Sidebar & RBAC)
 * JDK Entertainment - Professional Edition
 */
import { sbClient } from './supabase.js';

export async function initializeAdminLayout() {
    logger.log('👷 Initializing Admin Layout...');

    // 1. Check Auth & Get Permissions
    const { data: { user } } = await sbClient.auth.getUser();
    if (!user) {
        window.location.href = '/';
        return;
    }

    const { data: profile } = await sbClient
        .from('profiles')
        .select('user_level')
        .eq('id', user.id)
        .single();

    // 1.5 Dynamic Host Check: User is a host for an upcoming event
    let isDynamicHost = false;
    const todayStr = new Date().toISOString().split('T')[0];
    const { count: hostCount } = await sbClient
        .from('events')
        .select('*', { count: 'exact', head: true })
        .eq('host_id', user.id)
        .gte('date', todayStr);

    if (hostCount > 0) isDynamicHost = true;

    const userLevel = (profile?.user_level || '').toLowerCase();
    const allowedLevels = ['admin', 'host'];
    if (!profile || (!allowedLevels.includes(userLevel) && !isDynamicHost)) {
        window.location.href = '/';
        return;
    }

    // 2. Fetch Detailed Permissions
    let { data: perms } = await sbClient
        .from('admin_permissions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

    // Fallback: If no permissions row found but user is Admin, treat as Super Admin
    if (!perms) {
        if (profile.user_level === 'Admin') {
            perms = { is_super_admin: true, permissions: [] };
        } else if (profile.user_level === 'Host' || isDynamicHost) {
            // Default Host permissions - Strictly only events related
            perms = { is_super_admin: false, permissions: ['events'] };
        }
    }

    renderSidebar(perms);
    checkCurrentPageAccess(perms);

    // FIX: Force clear inputs that might be autofilled by browser
    const clearAutofill = () => {
        const sensitiveInputs = document.querySelectorAll('input[type="text"][id*="search"], input[id*="Search"], input[placeholder*="Cari"]');
        sensitiveInputs.forEach(input => {
            if (input.value && (input.value.includes('@') || input.value.length > 0)) {
                input.value = '';
            }
            input.setAttribute('autocomplete', 'new-password');
        });
    };

    setTimeout(clearAutofill, 100);
    setTimeout(clearAutofill, 500);

    return perms;
}

function renderSidebar(perms) {
    const isSuper = perms?.is_super_admin || false;
    const userPerms = perms?.permissions || [];
    const path = window.location.pathname;
    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;

    const menuItems = [
        { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', url: '/admin', perm: 'dashboard' },
        { id: 'slider', label: 'Slider', icon: 'perm_media', url: '/admin_slider', perm: 'slider' },
        { id: 'badges', label: 'Badges', icon: 'military_tech', url: '/admin_achievements', perm: 'badges' },
        { id: 'games', label: 'Games', icon: 'sports_esports', url: '/admin_games', perm: 'games', noSpa: true },
        { id: 'coins', label: 'Coins & Economy', icon: 'monetization_on', url: '/admin_coin', perm: 'coins' },
        { id: 'events', label: 'Events', icon: 'calendar_month', url: '/admin_events', perm: 'events' },
        { id: 'market', label: 'JDK Box', icon: 'shopping_cart', url: '/admin_marketplace', perm: 'marketplace' },
        { id: 'referrals', label: 'Referrals', icon: 'diversity_3', url: '/admin_referrals', perm: 'referrals' },
        { id: 'leaderboard', label: 'Leaderboard', icon: 'leaderboard', url: '/admin_leaderboard', perm: 'leaderboard' },
        { id: 'radio', label: 'Radio DJ Booth', icon: 'radio', url: '/admin_radio', perm: 'radio' },
        { id: 'duels', label: 'Duels', icon: 'swords', url: '/admin_duels', perm: 'duels' },
        { id: 'stickers', label: 'Stickers', icon: 'sticker', url: '/admin_stickers', perm: 'dashboard' },
        { id: 'scanner', label: 'Scanner', icon: 'qr_code_scanner', url: '/admin_scanner', perm: 'events' },
    ];

    if (document.querySelector('.admin-sidebar-container')) return;

    // Professional Sidebar HTML
    const sidebarHtml = `
        <div class="admin-sidebar-container fixed inset-y-0 left-0 w-64 bg-slate-900 text-white transform -translate-x-full md:translate-x-0 transition-transform duration-300 z-50 flex flex-col shadow-xl">
            <!-- Brand -->
            <div class="h-16 flex items-center px-6 border-b border-slate-800">
                 <a href="/" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
                    <img src="/images/jdk-logo.png" alt="JDK" class="w-8 h-8 object-contain">
                    <span class="font-bold text-lg tracking-wide">JDK Admin</span>
                </a>
            </div>

            <!-- Nav -->
            <nav class="flex-1 overflow-y-auto py-4 space-y-1">
                ${menuItems.map(item => {
        if (!isSuper && item.perm !== 'dashboard' && !userPerms.includes(item.perm)) {
            return '';
        }
        const isActive = normalizedPath === item.url || normalizedPath + '.html' === item.url || normalizedPath === item.url + '.html';
        const activeClass = isActive
            ? 'bg-blue-600 text-white'
            : 'text-slate-400 hover:bg-slate-800 hover:text-white';

        const noSpaAttr = item.noSpa ? 'data-no-spa="true"' : '';

        // Material Icon instead of emoji
        return `
                        <a href="${item.url}" ${noSpaAttr} class="group flex items-center px-6 py-2.5 text-sm font-medium transition-colors ${activeClass}">
                            <span class="material-symbols-outlined mr-3 text-[20px] ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-white'}">${item.icon}</span>
                            ${item.label}
                        </a>
                    `;
    }).join('')}
            </nav>

            <!-- Footer -->
            <div class="p-4 border-t border-slate-800">
                <button onclick="handleLogout()" class="flex items-center w-full px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors">
                    <span class="material-symbols-outlined mr-3">logout</span>
                    Logout
                </button>
            </div>
        </div>

        <!-- Mobile Overlay & Toggle -->
        <div id="mobileSidebarOverlay" class="fixed inset-0 bg-black/50 z-40 hidden md:hidden" onclick="toggleSidebar()"></div>
        <button class="fixed bottom-4 right-4 md:hidden z-50 bg-blue-600 text-white p-3 rounded-full shadow-lg" onclick="toggleSidebar()">
            <span class="material-symbols-outlined">menu</span>
        </button>
    `;

    const mainEl = document.querySelector('main');
    if (mainEl) {
        mainEl.insertAdjacentHTML('afterbegin', sidebarHtml);
    } else {
        logger.warn('Admin Layout: No <main> tag found, sidebar injection might fail cleanup.');
        document.body.insertAdjacentHTML('afterbegin', sidebarHtml);
    }
}

function checkCurrentPageAccess(perms) {
    const currentPage = (window.location.pathname.split('/').pop() || '').replace('.html', '');
    if (currentPage === 'admin' || !currentPage) return;

    // Mapping pages to permission keys
    const pagePermMap = {
        'admin_slider': 'slider',
        'admin_achievements': 'badges',
        'admin_games': 'games',
        'admin_coin': 'coins',
        'admin_events': 'events',
        'admin_marketplace': 'marketplace',
        'admin_radio': 'radio',
        'admin_referrals': 'referrals',
        'admin_leaderboard': 'leaderboard',
        'admin_duels': 'duels',
        'admin_scanner': 'events'
    };

    const requiredPerm = pagePermMap[currentPage];
    if (requiredPerm && !perms?.is_super_admin && !perms?.permissions?.includes(requiredPerm)) {
        alert('Maaf, Anda tidak memiliki akses ke halaman ini.');
        window.location.href = '/admin';
    }
}

window.toggleSidebar = function () {
    const sidebar = document.querySelector('.admin-sidebar-container');
    const overlay = document.getElementById('mobileSidebarOverlay');

    if (sidebar.classList.contains('-translate-x-full')) {
        // Open
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    } else {
        // Close
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    }
};

// Expose handleLogout globally just in case
window.handleLogout = async () => {
    await sbClient.auth.signOut();
    window.location.href = '/';
};
