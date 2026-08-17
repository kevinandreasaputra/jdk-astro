import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Profile Page Module
 * Handles profile page functionality including stats, charts, and editing
 */

import { sbClient } from '../core/supabase.js';
import { showNotification, getCurrentPage, getRelativeTime, escapeHTML } from '../core/utils.js';
import { calculateUserLevel } from '../modules/ranks.js';
import { getCurrentUser, updateUserInterface, setCurrentUser, initializeUserSession } from '../modules/user-session.js';
import { openLoginModal } from '../modules/auth.js';
import { getAchievementsForUser } from '../modules/achievements.js';
import QRCode from 'qrcode';

let profileHostEvents = [];
let currentParticipantEventId = null;
let currentParticipantEventTitle = null;

/**
 * Initialize profile page
 */
export async function initializeProfilePage() {
    const currentUser = getCurrentUser();

    // Check for Public Profile Request
    const urlParams = new URLSearchParams(window.location.search);
    const targetUserId = urlParams.get('id');
    const isValidId = targetUserId && targetUserId !== 'undefined';

    if (isValidId && (!currentUser || targetUserId !== currentUser.id)) {
        logger.log('Public Profile Mode for user:', targetUserId);
        await initializePublicProfile(targetUserId);
        return;
    }
    logger.log('Initializing Profile Page. Current User State:', currentUser);

    // Check for Password Recovery Mode
    // jdk_recovery_mode is set by main.js BEFORE Supabase processes (and clears) the hash
    const isRecovery = sessionStorage.getItem('jdk_recovery_mode') === 'true';
    const isFromHashClick = sessionStorage.getItem('jdk_recovery_from_hash') === 'true';

    // Prepare UI for Recovery Mode or Logged In User
    if (isRecovery) {
        logger.log('Recovery mode detected. From fresh hash click:', isFromHashClick);

        if (!currentUser) {
            // User clicked reset link but session is invalid/expired
            sessionStorage.removeItem('jdk_recovery_mode');
            sessionStorage.removeItem('jdk_recovery_from_hash');

            // Show expired link message
            showNotification(`
                <div class="text-center">
                    <div class="text-3xl mb-2">🔗❌</div>
                    <div class="font-bold text-lg">Link Reset Sudah Kadaluarsa!</div>
                    <div class="text-sm mt-2">Silakan minta link reset baru dari halaman login.</div>
                </div>
            `, 5000);

            // Clear hash and redirect
            history.pushState("", document.title, window.location.pathname);
            setTimeout(() => window.location.href = '/', 3000);
            return;
        }

        // Clear the "from hash" flag since we've processed it
        sessionStorage.removeItem('jdk_recovery_from_hash');

        showNotification('🔑 Mode Reset Password Aktif');
        setTimeout(() => {
            if (window.openChangePasswordModal) {
                window.openChangePasswordModal(true);
            }
        }, 500);
    }

    // Locked UI Check
    if (!currentUser && !isRecovery) {
        // Show login prompt - Hide ALL sections to prevent partial render
        document.querySelectorAll('section').forEach(el => el.style.display = 'none');

        const container = document.querySelector('body');
        const lockedMsg = document.createElement('div');
        lockedMsg.className = 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12';
        lockedMsg.innerHTML = `
            <div class="text-center p-16 bg-white rounded-3xl border-4 border-black shadow-[8px_8px_0px_0px_#2c3e50] animate-pop">
                <div class="text-8xl mb-6">🔒</div>
                <h2 class="text-4xl font-bold mb-4 font-display text-red-500">MEMBER ONLY AREA</h2>
                <p class="text-xl mb-8 font-body">Silakan login untuk melihat profil dan statistik kamu.</p>
                <button onclick="openLoginModal()" class="btn-primary px-8 py-4 text-white text-xl">LOGIN SEKARANG</button>
            </div>
        `;

        const nav = document.querySelector('nav');
        if (nav && nav.nextSibling) {
            nav.parentNode.insertBefore(lockedMsg, nav.nextSibling);
        } else {
            container.appendChild(lockedMsg);
        }
        return;
    }

    // Populate profile form
    populateProfileForm();

    // Show Admin Dashboard button ONLY for full admin users
    const adminBtn = document.getElementById('adminBtn');
    if (adminBtn && currentUser) {
        const userLevel = (currentUser.user_level || '').toLowerCase();
        if (userLevel === 'admin') {
            adminBtn.classList.remove('hidden');
            logger.log('Admin user detected - showing Admin Dashboard button');
        } else {
            adminBtn.classList.add('hidden');
        }
    }

    // Populate Referral Info
    const referralCodeEl = document.getElementById('referralCodeDisplay');
    const referralLinkEl = document.getElementById('referralLinkDisplay');
    if (referralCodeEl && currentUser.referral_code) {
        referralCodeEl.textContent = currentUser.referral_code;
        const link = `${window.location.origin}/index.html?ref=${currentUser.referral_code}`;
        if (referralLinkEl) referralLinkEl.textContent = link;

        // Expose copy functions
        window.copyReferralCode = () => {
            navigator.clipboard.writeText(currentUser.referral_code);
            showNotification('✅ Kode referal berhasil disalin!');
        };
        window.copyReferralLink = () => {
            navigator.clipboard.writeText(link);
            showNotification('✅ Link referal berhasil disalin!');
        };
        window.shareReferralLink = () => {
            if (navigator.share) {
                navigator.share({
                    title: 'Gabung JDK Entertainment!',
                    text: `Halo! Yuk gabung JDK Entertainment pakai kode referal saya: ${currentUser.referral_code}`,
                    url: link,
                }).catch(err => logger.log('Share failed:', err));
            } else {
                window.copyReferralLink();
                showNotification('📱 Fitur Share tidak didukung di browser ini. Link sudah disalin!');
            }
        };
    }


    // Check auth provider and show/hide change password button
    checkAuthProviderAndTogglePasswordButton();

    // Check if user is a host
    checkHostStatus();

    // Load activity
    loadRecentActivity(currentUser.id);

    // Initial Charts (My Profile)
    initializeCharts(currentUser.id).catch(err => logger.warn('Chart init warning:', err));
    switchTab('overview');

    // Entrance Animation
    if (typeof anime !== 'undefined') {
        anime({
            targets: '.dashboard-stat-card',
            translateY: [20, 0],
            opacity: [0, 1],
            delay: anime.stagger(100),
            easing: 'easeOutElastic(1, .8)'
        });
    }
}

/**
 * Check if user logged in with email/password or OAuth
 * Only show Change Password button for email/password users
 */
async function checkAuthProviderAndTogglePasswordButton() {
    const btnChangePassword = document.getElementById('btnChangePassword');
    if (!btnChangePassword) return;

    try {
        if (!sbClient) return;

        const { data: { user }, error } = await sbClient.auth.getUser();

        if (error || !user) {
            btnChangePassword.classList.add('hidden');
            return;
        }

        // Check if the user signed up with email (not OAuth)
        // OAuth users have identities with provider !== 'email'
        const identities = user.identities || [];
        const hasEmailIdentity = identities.some(identity => identity.provider === 'email');

        // Also check app_metadata.provider (fallback)
        const appProvider = user.app_metadata?.provider;
        const isEmailUser = hasEmailIdentity || appProvider === 'email';

        if (isEmailUser) {
            // Show change password button for email/password users
            btnChangePassword.classList.remove('hidden');
        } else {
            // Hide for OAuth users (Google, etc.)
            btnChangePassword.classList.add('hidden');
            logger.log('OAuth user detected - hiding Change Password button');
        }
    } catch (err) {
        logger.error('Error checking auth provider:', err);
        // Default: hide the button if we can't determine
        btnChangePassword.classList.add('hidden');
    }
}

/**
 * Initialize ECharts for profile stats
 */
async function initializeCharts(userId = null) {
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId || !sbClient) return;

    try {
        const echarts = await import('echarts');
        // Fetch Point History (Only if it's me)
        const isMe = targetId === getCurrentUser()?.id;
        let historyData = { labels: [], values: [] };
        if (isMe) {
            historyData = await fetchPointHistory(targetId);
        }

        // Points Chart
        if (document.getElementById('pointsChart')) {
            const pointsChart = echarts.init(document.getElementById('pointsChart'));
            const pointsOption = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    formatter: '{b}: {c} ⭐'
                },
                xAxis: {
                    type: 'category',
                    data: historyData.labels,
                    axisLabel: { color: '#2c3e50', fontWeight: 'bold' },
                    axisLine: { lineStyle: { color: '#000', width: 2 } }
                },
                yAxis: {
                    type: 'value',
                    axisLabel: { color: '#2c3e50' },
                    splitLine: { lineStyle: { color: '#e0e0e0', type: 'dashed' } },
                    axisLine: { show: true, lineStyle: { color: '#000', width: 2 } }
                },
                series: [{
                    data: historyData.values,
                    type: 'line',
                    smooth: true,
                    symbol: 'circle',
                    symbolSize: 8,
                    lineStyle: { color: '#ff6b35', width: 4 },
                    itemStyle: {
                        color: '#ff6b35',
                        borderWidth: 2,
                        borderColor: '#fff'
                    },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(255, 107, 53, 0.4)' },
                            { offset: 1, color: 'rgba(255, 107, 53, 0)' }
                        ])
                    }
                }]
            };
            pointsChart.setOption(pointsOption);
            window.addEventListener('resize', () => pointsChart.resize());
        }

        // Sales/Category Chart
        if (document.getElementById('salesChart')) {
            const salesChart = echarts.init(document.getElementById('salesChart'));

            // Fetch product category distribution
            const { data: products } = await sbClient
                .from('products')
                .select('category')
                .eq('seller_id', targetId);

            const categoryMap = {};
            (products || []).forEach(p => {
                categoryMap[p.category] = (categoryMap[p.category] || 0) + 1;
            });

            const chartData = Object.keys(categoryMap).map(cat => ({
                value: categoryMap[cat],
                name: cat
            }));

            const salesOption = {
                backgroundColor: 'transparent',
                tooltip: { trigger: 'item' },
                series: [{
                    type: 'pie',
                    radius: ['40%', '70%'],
                    data: chartData.length > 0 ? chartData : [
                        { value: 1, name: 'Belum Ada Barang', itemStyle: { color: '#ccc' } }
                    ],
                    label: { color: '#2c3e50', fontWeight: 'bold' }
                }]
            };
            salesChart.setOption(salesOption);
            window.addEventListener('resize', () => salesChart.resize());
        }
    } catch (e) {
        logger.error("Profile charts init error", e);
    }
}

/**
 * Switch between profile tabs
 * @param {string} tabName - Tab identifier
 */
export function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.add('hidden');
        tab.style.display = ''; // Clear inline style that overrides hidden class
    });

    // Remove active class from all tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
        // Match button to tabName using the onclick attribute
        if (btn.getAttribute('onclick')?.includes(`'${tabName}'`)) {
            btn.classList.add('active');
        }
    });

    // Show selected tab content
    // Show selected tab content
    const selectedTab = document.getElementById(`${tabName}Tab`);
    if (selectedTab) {
        selectedTab.classList.remove('hidden');
        // Force display to override any potential conflicts
        selectedTab.style.display = 'block';
        logger.log(`Tab '${tabName}' activated. Content element #${tabName}Tab visible.`);
    } else {
        logger.error(`Tab content element #${tabName}Tab NOT found!`);
        if (tabName === 'host') {
            logger.warn('Attempting fallback for host tab...');
            const fallback = document.querySelector('#hostTab');
            if (fallback) {
                fallback.classList.remove('hidden');
                fallback.style.display = 'block';
            }
        }
    }

    // Load data based on tab
    const currentUser = getCurrentUser();
    const urlParams = new URLSearchParams(window.location.search);
    const targetUserId = urlParams.get('id') || currentUser?.id;

    if (tabName === 'achievements') {
        logger.log('Loading user achievements...');
        loadUserAchievements(targetUserId);
    }
    if (tabName === 'events') {
        logger.log('Loading user events...');
        loadUserEvents(targetUserId);
    }
    if (tabName === 'marketplace') {
        logger.log('Loading user marketplace...');
        loadUserMarketplace(targetUserId);
    }
    if (tabName === 'host') {
        logger.log('Loading host events...');
        loadHostEvents(targetUserId);
    }
    if (tabName === 'wallet') {
        logger.log('Loading wallet history...');
        loadUserCoinHistory(targetUserId);
        loadUserPointHistory(targetUserId);
    }
    if (tabName === 'rekber') {
        logger.log('Loading user rekber transactions...');
        loadUserRekberTransactions(targetUserId);
    }
}

/**
 * Populate profile form with user data
 * @param {object} userData - User data (defaults to current user if null)
 */
export function populateProfileForm(userData = null) {
    const currentUser = userData || getCurrentUser();
    if (!currentUser) return;

    // Helper formatter
    const fmt = (n) => (n || 0).toLocaleString('id-ID');

    const fields = {
        'profileFullName': currentUser.full_name || '',
        'profileUsername': currentUser.username || '',
        'profileBirthdate': currentUser.birthdate || '',
        'profileDomicile': currentUser.domicile || '',
        'profileBio': currentUser.bio || '',
        'profileWhatsapp': currentUser.whatsapp || '',
        'editWhatsapp': currentUser.whatsapp || '',
        'profileUserLevel': currentUser.user_level || 'Member',
        'profileDisplayLevel': currentUser.user_level || 'Member',
        'profilePoints': (currentUser.id === getCurrentUser()?.id) ? (currentUser.current_points || currentUser.points || 0) : '🔒 PRIVATE'
    };

    for (const [id, value] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) {
            if (el.tagName === 'SELECT') {
                el.value = value;
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.value = value;
            } else {
                el.textContent = value;
            }
        }
    }

    // Set avatar
    const avatarPreview = document.getElementById('avatarPreview');
    if (avatarPreview && currentUser.avatar_url) {
        avatarPreview.src = currentUser.avatar_url;
    }

    // Update Stats
    const profileStatPoints = document.getElementById('profileStatPoints');
    if (profileStatPoints) {
        const isMe = currentUser.id === getCurrentUser()?.id;
        profileStatPoints.textContent = isMe ? fmt(currentUser.current_points || 0) : '🔒 PRIVATE';
    }

    const profileStatCoin = document.getElementById('profileStatCoin');
    if (profileStatCoin) profileStatCoin.textContent = fmt(currentUser.coin || 0);

    // Join Date
    const joinDateEl = document.getElementById('profileJoinDate');
    const displayJoinDateEl = document.getElementById('profileDisplayJoinDate');
    if ((joinDateEl || displayJoinDateEl) && currentUser.created_at) {
        const date = new Date(currentUser.created_at);
        const dateStr = date.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });
        if (joinDateEl) joinDateEl.textContent = dateStr;
        if (displayJoinDateEl) displayJoinDateEl.textContent = 'Bergabung sejak ' + dateStr;
    }

    // Display Name
    const displayNameEl = document.getElementById('profileDisplayName');
    if (displayNameEl) {
        displayNameEl.textContent = (currentUser.username || currentUser.full_name || 'JDKWAN').toUpperCase();
    }

    // XP & Level Calculation
    const xp = currentUser.xp || 0;
    const { level, nextLevelXp, currentLevelProgress, progressPercent, rankName, rankColor, rankIcon } = calculateUserLevel(xp);

    // Role Display
    const displayRoleEl = document.getElementById('profileDisplayRole');
    if (displayRoleEl) {
        displayRoleEl.textContent = rankName || 'JDKWAN';
        displayRoleEl.style.borderColor = rankColor || '#4ADE80';
        displayRoleEl.style.color = rankColor || '#000';
    }

    // Rank Badge
    const rankBadgeEl = document.getElementById('profileRankBadge');
    if (rankBadgeEl) {
        const badgeImg = rankBadgeEl.querySelector('img');
        if (badgeImg && rankIcon) {
            badgeImg.src = rankIcon;
            rankBadgeEl.classList.remove('hidden');
            rankBadgeEl.style.borderColor = rankColor || '#000';
        } else {
            rankBadgeEl.classList.add('hidden');
        }
    }

    // XP Display
    const displayXpEl = document.getElementById('profileDisplayXp');
    if (displayXpEl) displayXpEl.textContent = `${fmt(xp)} XP`;

    // User Level Badge (Admin/VIP/Member)
    const displayLevelEl = document.getElementById('profileDisplayLevel');
    if (displayLevelEl) {
        const userLevel = (currentUser.user_level || 'Member').toLowerCase();
        const levelText = userLevel === 'member' ? 'JDKWAN' : (userLevel === 'vip' ? 'VIP JDKWAN' : userLevel.toUpperCase());
        displayLevelEl.textContent = levelText;

        // Use classList for better compatibility with new styles
        displayLevelEl.classList.remove('bg-comic-red', 'bg-comic-yellow', 'bg-black', 'text-white', 'text-black');

        if (userLevel === 'admin') {
            displayLevelEl.classList.add('bg-comic-red', 'text-white');
        } else if (userLevel === 'vip') {
            displayLevelEl.classList.add('bg-comic-yellow', 'text-black');
        } else {
            displayLevelEl.classList.add('bg-black', 'text-white');
        }
    }

    // Level Card
    const cardLevel = document.getElementById('cardLevel');
    if (cardLevel) cardLevel.textContent = `Level ${level}`;

    const cardRole = document.getElementById('cardRole');
    if (cardRole) cardRole.textContent = rankName;

    const cardProgress = document.getElementById('cardProgress');
    if (cardProgress) cardProgress.style.width = `${progressPercent}%`;

    const cardXpText = document.getElementById('cardXpText');
    if (cardXpText) cardXpText.textContent = `${fmt(currentLevelProgress)}/${fmt(nextLevelXp)} XP ke Level ${level + 1}`;

    // Additional stats

    // Items Sold
    const statSalesEl = document.getElementById('profileStatSales');
    const cardSalesCount = document.getElementById('cardSalesCount');
    const cardSalesBar = document.getElementById('cardSalesBar');
    const cardSalesText = document.getElementById('cardSalesText');

    if (statSalesEl || cardSalesCount) {
        sbClient.from('products')
            .select('price', { count: 'exact' })
            .eq('seller_id', currentUser.id)
            .eq('status', 'sold')
            .then(({ count, data, error }) => {
                if (!error) {
                    const soldCount = count || 0;
                    const totalSales = (data || []).reduce((sum, item) => sum + (item.price || 0), 0);

                    if (statSalesEl) statSalesEl.textContent = fmt(soldCount);
                    if (cardSalesCount) cardSalesCount.textContent = fmt(soldCount);

                    if (cardSalesBar) {
                        const target = 25;
                        const percent = Math.min(100, (soldCount / target) * 100);
                        cardSalesBar.style.width = `${percent}%`;
                    }
                    if (cardSalesText) cardSalesText.textContent = `${soldCount}/25 Target Bulanan`;

                    // Update Marketplace Stat Card
                    const statTotalSalesValue = document.getElementById('statTotalSalesValue');
                    const statTotalItemsSold = document.getElementById('statTotalItemsSold');
                    if (statTotalSalesValue) statTotalSalesValue.textContent = `Rp ${fmt(totalSales)}`;
                    if (statTotalItemsSold) statTotalItemsSold.textContent = `${fmt(soldCount)} item`;
                }
            });
    }

    const statAchieveEl = document.getElementById('profileStatAchievements');
    if (statAchieveEl) {
        // Fetch counts
        Promise.all([
            sbClient.from('user_achievements').select('id', { count: 'exact', head: true }).eq('user_id', currentUser.id),
            sbClient.from('achievements').select('id', { count: 'exact', head: true })
        ]).then(([userAch, totalAch]) => {
            const unlockedCount = userAch.count || 0;
            const totalCount = totalAch.count || 10;

            if (statAchieveEl) statAchieveEl.textContent = fmt(unlockedCount);

            const cardAchieveCount = document.getElementById('cardAchieveCount');
            const cardAchieveBar = document.getElementById('cardAchieveBar');
            const cardAchieveText = document.getElementById('cardAchieveText');

            if (cardAchieveCount) cardAchieveCount.textContent = fmt(unlockedCount);
            if (cardAchieveBar) {
                const percent = Math.min(100, (unlockedCount / totalCount) * 100);
                cardAchieveBar.style.width = `${percent}%`;
            }
            if (cardAchieveText) cardAchieveText.textContent = `${unlockedCount}/${totalCount} Achievement`;
        });
    }

    // Event Count Stat
    const statEventsEl = document.getElementById('profileStatEvents');
    const cardEventCount = document.getElementById('cardEventCount');
    const cardEventBar = document.getElementById('cardEventBar');
    const cardEventText = document.getElementById('cardEventText');

    if (statEventsEl || cardEventCount) {
        sbClient.from('event_registrations')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', currentUser.id)
            .eq('status', 'attended')
            .then(({ count, error }) => {
                if (!error) {
                    const attendedCount = count || 0;
                    if (statEventsEl) statEventsEl.textContent = fmt(attendedCount);
                    if (cardEventCount) cardEventCount.textContent = fmt(attendedCount);

                    if (cardEventBar) {
                        const target = 10;
                        const percent = Math.min(100, (attendedCount / target) * 100);
                        cardEventBar.style.width = `${percent}%`;
                    }
                    if (cardEventText) cardEventText.textContent = `${attendedCount}/10 Event Diikuti`;
                }
            });
    }
}

/**
 * Load and render user achievements
 */
export async function loadUserAchievements(userId = null) {
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId || !sbClient) return;
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const grid = document.getElementById('achievementGrid');
    if (!grid) {
        logger.warn('Achievement grid element not found!');
        return;
    }

    logger.log('Fetching achievements for user:', currentUser.id);
    try {
        const achievements = await getAchievementsForUser(currentUser.id);
        logger.log('Achievements fetched:', achievements.length);

        if (achievements.length === 0) {
            grid.innerHTML = '<div class="col-span-full py-12 text-center text-slate-500 font-medium">Belum ada achievement yang tersedia.</div>';
            return;
        }

        // Store for modal
        window.userAchievements = achievements;

        grid.innerHTML = achievements.map(ach => `
            <div onclick="showAchievementDetail('${ach.id}')" class="achievement-badge bg-white border border-slate-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group flex flex-col items-center text-center h-full">
                <div class="text-5xl mb-4 transform group-hover:scale-110 transition-transform ${ach.unlocked ? '' : 'filter grayscale opacity-40'}">
                    ${ach.icon_emoji || '🏆'}
                </div>
                <h4 class="text-slate-900 font-bold mb-2 text-lg">${ach.title}</h4>
                <p class="text-slate-500 text-sm mb-4 leading-relaxed flex-grow">
                    ${ach.is_hidden && !ach.unlocked ? 'Achievement rahasia!' : ach.description}
                </p>
                <div class="mt-2">
                    ${ach.unlocked ?
                '<span class="bg-emerald-100 text-emerald-700 text-xs px-3 py-1 rounded-full font-bold">UNLOCKED</span>' :
                '<span class="bg-slate-100 text-slate-400 text-xs px-3 py-1 rounded-full font-bold">LOCKED</span>'}
                </div>
            </div>
        `).join('');

    } catch (err) {
        logger.error('Error rendering achievements:', err);
        grid.innerHTML = '<div class="col-span-full py-12 text-center text-red-500">Gagal memuat achievement.</div>';
    }
}

/**
 * Open edit profile modal
 */
export async function editProfile() {
    const modal = document.getElementById('editProfileModal');
    if (!modal) return;

    const currentUser = getCurrentUser();

    // Instant load from cache
    if (currentUser) {
        populateEditForm(currentUser);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Background fetch for latest data
    if (sbClient && currentUser) {
        try {
            const { data, error } = await sbClient
                .from('profiles')
                .select('*')
                .eq('id', currentUser.id)
                .single();

            if (data && !error) {
                Object.assign(currentUser, data);
                populateEditForm(currentUser);
            }
        } catch (err) {
            logger.warn('Background profile refresh failed:', err);
        }
    }
}

/**
 * Populate edit form with user data
 * @param {object} user - User data
 */
function populateEditForm(user) {
    setVal('editUsername', user.username || 'user');
    setVal('editFullName', user.full_name || user.name || '');
    setVal('editBio', user.bio || '');
    setVal('editDomicile', user.domicile || '');
    setVal('editBirthdate', user.birthdate || '');
    setVal('editWhatsapp', user.whatsapp || '');

    const avatarPreview = document.getElementById('editAvatarPreview');
    if (avatarPreview) {
        avatarPreview.src = user.avatar_url || '/images/mr-jdk-mascot.png';
    }
}

/**
 * Helper to set input value
 * @param {string} id - Input element ID
 * @param {*} val - Value to set
 */
function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

/**
 * Preview avatar before upload
 * @param {HTMLInputElement} input - File input element
 */
export function previewEditAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const preview = document.getElementById('editAvatarPreview');
            if (preview) preview.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

/**
 * Preview avatar (alternative input)
 * @param {HTMLInputElement} input - File input element
 */
export function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const preview = document.getElementById('avatarPreview');
            if (preview) preview.src = e.target.result;
        };
        reader.readAsDataURL(input.files[0]);
    }
}

/**
 * Close edit profile modal
 */
export function closeEditProfileModal() {
    const modal = document.getElementById('editProfileModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * Save profile changes
 */
export async function saveProfile() {
    const currentUser = getCurrentUser();
    const saveBtn = document.getElementById('btnSaveProfile');
    const originalText = saveBtn ? saveBtn.textContent : 'SIMPAN';
    if (saveBtn) { saveBtn.textContent = 'Menyimpan...'; saveBtn.disabled = true; }

    const newName = document.getElementById('editFullName')?.value;
    const newBio = document.getElementById('editBio')?.value;
    const newDomicile = document.getElementById('editDomicile')?.value;
    const newBirthdate = document.getElementById('editBirthdate')?.value;
    const newWhatsapp = document.getElementById('editWhatsapp')?.value || '';
    const avatarInput = document.getElementById('editAvatarInput');

    if (!newName) {
        if (saveBtn) { saveBtn.textContent = originalText; saveBtn.disabled = false; }
        return showNotification('Nama tidak boleh kosong!');
    }

    // Input validation & XSS protection
    const containsHtml = (str) => /[<>]/.test(str) || /&[a-z]+;/i.test(str);
    const isValidPhone = (str) => !str || /^[0-9+\-\s()]*$/.test(str);

    if (containsHtml(newName) || containsHtml(newBio) || containsHtml(newWhatsapp)) {
        if (saveBtn) { saveBtn.textContent = originalText; saveBtn.disabled = false; }
        return showNotification('❌ Karakter HTML atau simbol injeksi tidak diizinkan!', 'error');
    }

    if (!isValidPhone(newWhatsapp)) {
        if (saveBtn) { saveBtn.textContent = originalText; saveBtn.disabled = false; }
        return showNotification('❌ Format nomor WhatsApp tidak valid! Gunakan angka, +, -, ( )', 'error');
    }

    showNotification('Menyimpan perubahan... ⏳', 'info');

    try {
        let avatarUrl = currentUser?.avatar_url;

        // Handle Avatar Upload
        if (avatarInput && avatarInput.files && avatarInput.files[0]) {
            if (!sbClient) throw new Error('Database tidak terhubung.');

            const file = avatarInput.files[0];
            if (file.size > 2 * 1024 * 1024) throw new Error('Ukuran file terlalu besar! Maksimal 2MB.');

            const fileExt = file.name.split('.').pop();
            const fileName = `avatar_${currentUser.id}_${Date.now()}.${fileExt}`;

            const { error: uploadError } = await sbClient.storage
                .from('avatars')
                .upload(fileName, file, { upsert: true });

            if (uploadError) {
                logger.error('Upload detail:', uploadError);
                if (uploadError.statusCode === '404' || uploadError.message?.includes('not found')) {
                    throw new Error('Bucket "avatars" tidak ditemukan. Buat bucket storage Public bernama "avatars" di dashboard Supabase.');
                }
                throw new Error('Upload Foto Gagal: ' + uploadError.message);
            }

            const { data } = sbClient.storage.from('avatars').getPublicUrl(fileName);
            if (data) avatarUrl = data.publicUrl;
        }

        // Update Database
        const updates = {
            full_name: newName,
            bio: newBio,
            domicile: newDomicile,
            birthdate: newBirthdate || null,
            whatsapp: newWhatsapp,
            avatar_url: avatarUrl,
        };

        if (sbClient && currentUser && currentUser.id) {
            // Secure update via Edge Function
            const { data: secureData, error: secureError } = await sbClient.functions.invoke('jdk-secure-handler', {
                body: {
                    action: 'updateProfile',
                    payload: updates
                }
            });

            if (secureError) throw new Error('Gagal update database: ' + secureError.message);
            if (!secureData.success) throw new Error(secureData.error || 'Gagal update database');

            // Update session cache
            Object.assign(currentUser, updates);
            setCurrentUser(currentUser);
            updateUserInterface(currentUser);
            populateProfileForm(currentUser); // Refresh fields
        }

        showNotification('✅ Profil berhasil disimpan!', 'success');
        closeEditProfileModal();

    } catch (err) {
        logger.error('Save profile error:', err);
        showNotification('❌ ' + err.message, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }
    }
}

/**
 * Submit profile update from form
 * @param {Event} event - Form submit event
 */
export async function submitProfileUpdate(event) {
    event.preventDefault();

    const currentUser = getCurrentUser();
    if (!sbClient || !currentUser) {
        showNotification('Silakan login terlebih dahulu!');
        return false;
    }

    const updateData = {
        full_name: document.getElementById('profileFullName')?.value,
        username: document.getElementById('profileUsername')?.value,
        birthdate: document.getElementById('profileBirthdate')?.value || null,
        domicile: document.getElementById('profileDomicile')?.value,
        bio: document.getElementById('profileBio')?.value
    };

    // Validation
    if (!updateData.full_name || !updateData.username) {
        showNotification('Nama dan Username tidak boleh kosong!');
        return false;
    }

    const usernameRegex = /^[a-zA-Z0-9._-]+$/;
    if (!usernameRegex.test(updateData.username)) {
        showNotification('❌ Username hanya boleh huruf, angka, titik, underscore, atau tanda hubung!');
        return false;
    }

    if (/[<>]/.test(updateData.full_name) || /[<>]/.test(updateData.bio)) {
        showNotification('❌ Karakter < atau > tidak diizinkan di nama atau bio!');
        return false;
    }

    const whatsappRegex = /^[0-9+\s-]*$/;
    const waValue = document.getElementById('profileWhatsapp')?.value || '';
    if (!whatsappRegex.test(waValue)) {
        showNotification('❌ Nomor WhatsApp hanya boleh berisi angka, +, spasi, atau tanda hubung!');
        return false;
    }
    updateData.whatsapp = waValue;

    // Handle avatar upload
    const avatarInput = document.getElementById('avatarInput');
    if (avatarInput && avatarInput.files && avatarInput.files[0]) {
        const file = avatarInput.files[0];
        const fileExt = file.name.split('.').pop();
        const fileName = `${currentUser.id}.${fileExt} `;

        const { data: uploadData, error: uploadError } = await sbClient.storage
            .from('avatars')
            .upload(fileName, file, { upsert: true });

        if (uploadError) {
            logger.error('Avatar upload error:', uploadError);
            showNotification('Gagal upload avatar: ' + uploadError.message);
        } else {
            const { data: urlData } = sbClient.storage.from('avatars').getPublicUrl(fileName);
            updateData.avatar_url = urlData.publicUrl;
        }
    }

    // Secure Update profile via Edge Function
    const { data: secureData, error: secureError } = await sbClient.functions.invoke('jdk-secure-handler', {
        body: {
            action: 'updateProfile',
            payload: updateData
        }
    });

    if (secureError || !secureData?.success) {
        const errMsg = secureError?.message || secureData?.error || 'Gagal update profil';
        showNotification(errMsg);
        return false;
    }

    if (error) {
        showNotification('Gagal update profil: ' + error.message);
        return false;
    }

    // Update local state
    Object.assign(currentUser, updateData);
    updateUserInterface();
    showNotification('✅ Profil berhasil diperbarui!');
    return false;
}

/**
 * Share profile
 */
export function shareProfile() {
    showNotification('Profil berhasil dibagikan!');
}

/**
 * View time capsule
 * @param {string} date - Date string
 */
export function viewTimeCapsule(date) {
    showNotification(`Time capsule untuk ${date} akan segera tersedia!`);
}

/**
 * Initialize public profile view
 * @param {string} userId - ID of the user to view
 */
async function initializePublicProfile(userId) {
    // UI Toggles
    document.getElementById('selfButtons')?.classList.add('hidden');
    document.getElementById('publicButtons')?.classList.remove('hidden');
    document.getElementById('tabSettings')?.classList.add('hidden');
    document.getElementById('tabWallet')?.classList.add('hidden');

    try {
        if (!sbClient) throw new Error('Database not connected');

        const { data: user, error } = await sbClient
            .from('profiles')
            .select('id, username, full_name, avatar_url, website, bio, level, current_points, joined_at, birthdate, domicile, user_level, whatsapp, xp, coin, achievements_unlocked, referral_code, created_at')
            .eq('id', userId)
            .single();

        if (error || !user) throw new Error('Profil tidak ditemukan!');

        // Populate UI
        populateProfileForm(user);

        // Fetch specific data for public view
        checkLikeStatus(userId);
        fetchLikeCount(userId);
        await loadRecentActivity(userId);
        await initializeCharts(userId);

    } catch (err) {
        logger.error('Public Profile Init Error:', err);
        showNotification(err.message);
    }
}

/**
 * Check if current user has liked the target user
 * @param {string} targetUserId 
 */
async function checkLikeStatus(targetUserId) {
    const currentUser = getCurrentUser();
    if (!currentUser || !sbClient) return;

    try {
        const { data, error } = await sbClient
            .from('user_likes')
            .select('*')
            .eq('from_user_id', currentUser.id)
            .eq('to_user_id', targetUserId)
            .maybeSingle();

        const btnLike = document.getElementById('btnLike');
        const heart = document.getElementById('likeHeart');

        if (data) {
            if (heart) heart.textContent = '❤️';
            if (btnLike) btnLike.classList.add('liked');
        } else {
            if (heart) heart.textContent = '🤍';
            if (btnLike) btnLike.classList.remove('liked');
        }
    } catch (err) {
        logger.warn('Check like status failed:', err);
    }
}

/**
 * Fetch total likes for target user
 * @param {string} targetUserId 
 */
async function fetchLikeCount(targetUserId) {
    if (!sbClient) return;

    try {
        const { count, error } = await sbClient
            .from('user_likes')
            .select('*', { count: 'exact', head: true })
            .eq('to_user_id', targetUserId);

        const countEl = document.getElementById('likeCount');
        if (countEl) countEl.textContent = count || 0;
    } catch (err) {
        logger.warn('Fetch like count failed:', err);
    }
}

/**
 * Handle Like Toggle
 */
export async function handleLikeToggle() {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        showNotification('Silakan login untuk memberikan LIKE! ❤️');
        openLoginModal();
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const targetUserId = urlParams.get('id');
    if (!targetUserId) return;

    if (targetUserId === currentUser.id) {
        showNotification('Narsis ya? Tidak bisa LIKE profil sendiri! 😂');
        return;
    }

    const btnLike = document.getElementById('btnLike');
    if (btnLike) btnLike.disabled = true;

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'toggleUserLike', target_user_id: targetUserId }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal mengubah like');

        showNotification(data.liked ? '❤️ Like diberikan!' : '💔 Like dihapus');
        await loadProfile(); // Reload profile to update like count/button state

    } catch (err) {
        logger.error('Error toggling like:', err);
        showNotification(err.message || 'Gagal mengubah like', 'error');
    } finally {
        if (btnLike) btnLike.disabled = false;
    }
}

// Expose handlers to window for HTML onclick access
window.handleLikeToggle = handleLikeToggle;
window.switchTab = switchTab;
window.previewAvatar = previewAvatar;
window.submitProfileUpdate = submitProfileUpdate;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.closeEditProfileModal = closeEditProfileModal;
window.closeAchievementModal = closeAchievementModal;
window.submitChangePassword = submitChangePassword;
window.handleLogout = handleLogout;
window.showAchievementDetail = showAchievementDetail;
window.viewTimeCapsule = viewTimeCapsule;
window.confirmDeleteAccount = confirmDeleteAccount;


/**
 * Delete account (placeholder)
 */
async function confirmDeleteAccount() {
    showNotification('Fitur hapus akun akan segera tersedia. Hubungi admin untuk bantuan.');
}

/**
 * Load user coin history
 */
export async function loadUserCoinHistory(userId = null) {
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId) return;

    const balanceEl = document.getElementById('walletBalance');
    const tbody = document.getElementById('walletHistoryBody');

    // Update Balance
    if (balanceEl) {
        const { data: user } = await sbClient.from('profiles').select('coin').eq('id', targetId).single();
        if (user) balanceEl.textContent = (user.coin || 0).toLocaleString();
    }

    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center">Memuat riwayat...</td></tr>';

    const { data, error } = await sbClient
        .from('coin_transactions')
        .select('*')
        .eq('user_id', targetId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500">Error: ${error.message}</td></tr>`;
        return;
    }

    if (!data || data.length === 0) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center">Belum ada transaksi</td></tr>';
        return;
    }

    if (tbody) {
        tbody.innerHTML = data.map(t => {
            const date = new Date(t.created_at).toLocaleString('id-ID');
            const isPositive = t.amount > 0;
            return `
            <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td class="p-4 text-xs font-medium text-slate-500">${date}</td>
                    <td class="p-4"><span class="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-[10px] font-bold uppercase">${t.type}</span></td>
                    <td class="p-4 font-bold ${isPositive ? 'text-emerald-600' : 'text-rose-500'}">
                        ${isPositive ? '+' : ''}${t.amount.toLocaleString()}
                    </td>
                    <td class="p-4 text-xs font-medium text-slate-700">${t.description || '-'}</td>
                </tr>
            `;
        }).join('');
    }
}


/**
 * Load user event participations from Supabase
 */
export async function loadUserEvents(userId = null) {
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId || !sbClient) return;

    const eventListContainer = document.getElementById('userEventsList');
    if (!eventListContainer) return;

    eventListContainer.innerHTML = '<div class="text-center py-8"><div class="animate-pulse text-gray-400">Memuat event...</div></div>';

    try {
        const { data, error } = await sbClient
            .from('event_registrations')
            .select(`
            *,
            events(*)
                `)
            .eq('user_id', targetId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            eventListContainer.innerHTML = '<p class="text-gray-500 font-body text-center py-8">Kamu belum mendaftar di event manapun.</p>';
            return;
        }

        if (eventListContainer) {
            eventListContainer.innerHTML = data.map(reg => {
                const event = reg.events;
                if (!event) return '';
                const date = new Date(event.date);
                const dateStr = `${date.getDate()} ${date.toLocaleString('id-ID', { month: 'long' })} ${date.getFullYear()} `;

                let statusColor = 'bg-slate-100 text-slate-600';
                let statusLabel = (reg.status || 'Pending').toUpperCase();

                if (reg.status === 'confirmed') {
                    statusColor = 'bg-indigo-50 text-indigo-600';
                } else if (reg.status === 'attended') {
                    statusColor = 'bg-emerald-50 text-emerald-600';
                    statusLabel = 'HADIR';
                }

                return `
                <div class="bg-white rounded-xl p-6 border border-slate-200 shadow-sm hover:shadow-md transition-all mb-4 group">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h4 class="text-slate-900 font-bold text-lg tracking-tight group-hover:text-indigo-600 transition-colors">${event.title}</h4>
                            <p class="text-slate-500 font-medium text-xs mt-1 flex items-center gap-1">
                                <span class="material-symbols-outlined text-[14px]">calendar_today</span> ${dateStr} 
                                <span class="mx-1">•</span>
                                <span class="material-symbols-outlined text-[14px]">location_on</span> ${event.location}
                            </p>
                        </div>
                        <span class="${statusColor} px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide">
                            ${statusLabel}
                        </span>
                    </div>
                    <div class="flex justify-between items-end pt-4 border-t border-slate-100">
                        <div class="flex flex-col gap-1">
                            <span class="text-indigo-600 font-bold text-xs uppercase flex items-center gap-1">
                                ${reg.status === 'confirmed' || reg.status === 'attended' ? `<span class="material-symbols-outlined text-[14px]">stars</span> +${event.xp_reward || 0} XP EARNED` : '<span class="material-symbols-outlined text-[14px]">schedule</span> AWAITING VERIFICATION'}
                            </span>
                            ${event.point_reward > 0 ? `
                            <span class="text-slate-400 font-bold text-[10px] uppercase tracking-wide flex items-center gap-1">
                                <span class="material-symbols-outlined text-[12px]">monetization_on</span> +${event.point_reward} JDK Points
                            </span>` : ''}
                        </div>
                        <div class="flex items-center gap-2">
                            <button class="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-bold text-xs hover:bg-slate-50 transition-all hover:text-indigo-600"
                                onclick="window.location.href='/events'">
                                Details
                            </button>
                            ${event.host_id === getCurrentUser()?.id ? `
                            <button class="bg-slate-900 text-white px-4 py-2 rounded-lg font-bold text-xs border border-slate-900 hover:bg-slate-800 transition-all shadow-sm"
                                onclick="window.location.href='/host_scanner?event=${event.id}'">
                                Scan
                            </button>` : ''}
                            ${reg.qr_code ? `
                            <button class="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-xs border border-indigo-600 hover:bg-indigo-700 transition-all shadow-sm flex items-center gap-1"
                                onclick="showQrCodeForEvent('${reg.qr_code}', '${event.title.replace(/'/g, "\\'")}')">
                                <span class="material-symbols-outlined text-[14px]">qr_code</span> Ticket
                            </button>` : ''}
                        </div>
                    </div>
                </div>
                `;
            }).join('');
        }

        // Update counts in header/overview while we're at it
        const statEventsEl = document.getElementById('profileStatEvents');
        if (statEventsEl) statEventsEl.textContent = data.length.toLocaleString('id-ID');

        const cardEvents = document.querySelector('.stats-card h4.text-purple-400');
        if (cardEvents) cardEvents.textContent = data.length.toLocaleString('id-ID');

    } catch (err) {
        logger.error('Error loading user events:', err);
        if (eventListContainer) {
            eventListContainer.innerHTML = `<p class="text-red-400 font-body text-center py-8">Gagal memuat event: ${err.message}</p>`;
        }
    }
}

/**
 * Show Achievement Details Modal
 * @param {string} id - Achievement ID
 */
export function showAchievementDetail(id) {
    const achievements = window.userAchievements || [];
    const ach = achievements.find(a => a.id === id);
    if (!ach) return;

    const modal = document.getElementById('achievementDetailModal');
    if (!modal) return;

    // Populate Data
    document.getElementById('modalAchIcon').textContent = ach.icon_emoji || '🏆';
    document.getElementById('modalAchTitle').textContent = ach.title;

    // Description logic
    const isHidden = ach.is_hidden && !ach.unlocked;
    document.getElementById('modalAchDesc').textContent = isHidden ? 'Achievement ini bersifat rahasia. Temukan caranya untuk membuka!' : ach.description;

    // Status UI
    const badgeEl = document.getElementById('modalAchBadge');
    const historyEl = document.getElementById('modalAchHistory');
    const lockedMsgEl = document.getElementById('modalAchLockedMsg');

    if (ach.unlocked) {
        // Unlocked UI
        badgeEl.innerHTML = '<span class="bg-comic-yellow text-comic-dark text-xs px-3 py-1 rounded-full font-black border-2 border-black shadow-hard-sm">UNLOCKED</span>';
        historyEl.classList.remove('hidden');
        lockedMsgEl.classList.add('hidden');

        // Populate Date
        const date = new Date(ach.unlocked_at);
        document.getElementById('modalAchDate').textContent = !isNaN(date) ?
            date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) :
            '-';

        // Populate Reason
        document.getElementById('modalAchReason').textContent = ach.unlocked_reason ? `"${ach.unlocked_reason}"` : '"Diberikan oleh sistem/admin"';

    } else {
        // Locked UI
        badgeEl.innerHTML = '<span class="bg-gray-200 text-gray-400 text-xs px-3 py-1 rounded-full font-bold border-2 border-gray-300">LOCKED</span>';
        historyEl.classList.add('hidden');
        lockedMsgEl.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

/**
 * Close Achievement Modal
 */
export function closeAchievementModal() {
    const modal = document.getElementById('achievementDetailModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * Show QR Code for event ticket
 * @param {string} qrText - QR Code content
 * @param {string} eventTitle - Title of the event
 */
export function showQrCodeForEvent(qrText, eventTitle) {
    const modal = document.getElementById('qrCodeModal');
    if (!modal) return;

    // Set title
    const titleEl = document.getElementById('qrEventTitle');
    if (titleEl) titleEl.textContent = eventTitle;

    // Set QR code text
    const textEl = document.getElementById('qrCodeText');
    if (textEl) textEl.textContent = qrText;

    // Generate QR code
    const container = document.getElementById('qrCodeContainer');
    if (container) {
        container.innerHTML = '';

        QRCode.toDataURL(qrText, {
            width: 240,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        }, (err, url) => {
            if (err) {
                logger.error('QR error:', err);
                container.innerHTML = '<p class="text-xs text-red-500">Gagal generate QR Code</p>';
            } else {
                const img = document.createElement('img');
                img.src = url;
                img.alt = 'Event Ticket QR';
                img.className = 'mx-auto';
                container.appendChild(img);
            }
        });
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

/**
 * Close QR Code modal
 */
export function closeQrCodeModal() {
    const modal = document.getElementById('qrCodeModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.initializeProfilePage = initializeProfilePage;
    window.switchTab = switchTab;
    window.populateProfileForm = populateProfileForm;
    window.editProfile = editProfile;
    window.previewEditAvatar = previewEditAvatar;
    window.previewAvatar = previewAvatar;
    window.closeEditProfileModal = closeEditProfileModal;
    window.saveProfile = saveProfile;
    window.submitProfileUpdate = submitProfileUpdate;
    window.shareProfile = shareProfile;
    window.viewTimeCapsule = viewTimeCapsule;
    window.confirmDeleteAccount = confirmDeleteAccount;
    window.loadUserCoinHistory = loadUserCoinHistory;
    window.loadUserPointHistory = loadUserPointHistory;
    window.loadUserEvents = loadUserEvents;
    window.showAchievementDetail = showAchievementDetail;
    window.closeAchievementModal = closeAchievementModal;
    window.showQrCodeForEvent = showQrCodeForEvent;
    window.closeQrCodeModal = closeQrCodeModal;
    window.openChangePasswordModal = openChangePasswordModal;
    window.closeChangePasswordModal = closeChangePasswordModal;
    window.submitChangePassword = submitChangePassword;
    window.togglePassword = togglePassword;
    window.checkPasswordStrength = checkPasswordStrength;
    window.updatePasswordStrengthUI = updatePasswordStrengthUI;
    window.deleteProduct = deleteProduct;
    window.checkHostStatus = checkHostStatus;
    window.loadHostEvents = loadHostEvents;
    window.openProfileBroadcastModal = openProfileBroadcastModal;
    window.closeProfileBroadcastModal = closeProfileBroadcastModal;
    window.sendProfileEventBroadcast = sendProfileEventBroadcast;
}

/**
 * Check if the user is a host for any event and show the scanner button
 */
export async function checkHostStatus() {
    const currentUser = getCurrentUser();
    if (!currentUser || !sbClient) return;

    try {
        const userLevel = (currentUser.user_level || '').toLowerCase();
        const isAdmin = userLevel === 'admin';
        const isOfficialHost = userLevel === 'host';

        // Dynamic Host Check (Upcoming events only)
        const todayStr = new Date().toISOString().split('T')[0];
        const { data: hostEvents, error } = await sbClient
            .from('events')
            .select('id')
            .eq('host_id', currentUser.id)
            .gte('date', todayStr)
            .limit(1);

        if (error) throw error;

        const isDynamicHost = hostEvents && hostEvents.length > 0;
        const canAccessHostTools = isAdmin || isOfficialHost || isDynamicHost;

        const hostScannerBtn = document.getElementById('hostScannerBtn');
        const manageEventsBtn = document.getElementById('manageEventsBtn');
        const tabHost = document.getElementById('tabHost');

        if (hostScannerBtn) {
            if (canAccessHostTools) {
                hostScannerBtn.classList.remove('hidden');
                logger.log('Host tools authorized - showing Scanner');
            } else {
                hostScannerBtn.classList.add('hidden');
            }
        }

        if (manageEventsBtn) {
            if (canAccessHostTools) {
                manageEventsBtn.classList.remove('hidden');
                logger.log('Host tools authorized - showing Manage Events');
            } else {
                manageEventsBtn.classList.add('hidden');
            }
        }

        if (tabHost) {
            if (canAccessHostTools) {
                tabHost.classList.remove('hidden');
                logger.log('Host tab authorized - showing Tab');
            } else {
                tabHost.classList.add('hidden');
            }
        }
    } catch (err) {
        logger.error('Error checking host status:', err);
    }
}

/**
 * Load events where the user is a host
 */
export async function loadHostEvents(userId = null) {
    logger.log('loadHostEvents called for userId:', userId);
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId || !sbClient) {
        logger.error('loadHostEvents: Missing targetId or sbClient');
        return;
    }

    const container = document.getElementById('hostEventsList');
    if (!container) {
        logger.error('loadHostEvents: container #hostEventsList not found!');
        return;
    }

    container.innerHTML = '<div class="text-center py-12 text-gray-400 font-bold text-sm animate-pulse">Memuat data event host...</div>';

    try {
        const { data, error } = await sbClient
            .from('events')
            .select('*')
            .eq('host_id', targetId)
            .order('date', { ascending: false });

        if (error) throw error;

        profileHostEvents = data || [];

        // Fetch registration counts for these events
        const eventIds = profileHostEvents.map(e => e.id);
        const { data: regCounts, error: regError } = await sbClient
            .from('event_registrations')
            .select('event_id')
            .in('event_id', eventIds);

        const countMap = {};
        if (regCounts) {
            regCounts.forEach(reg => {
                countMap[reg.event_id] = (countMap[reg.event_id] || 0) + 1;
            });
        }

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="text-center py-12 text-gray-400 font-bold text-sm">Kamu belum memiliki event untuk di-host.</div>';
            return;
        }

        container.innerHTML = data.map(event => {
            const date = new Date(event.date);
            const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
            const isPast = new Date() > date;

            const regCount = countMap[event.id] || 0;

            return `
            <div class="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <h4 class="text-lg font-bold text-slate-900 tracking-tight">${event.title}</h4>
                            ${isPast ? '<span class="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full font-bold text-slate-500">PAST</span>' : '<span class="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">ACTIVE</span>'}
                        </div>
                        <div class="flex flex-wrap gap-3 text-xs font-medium text-slate-500 mt-1">
                            <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">today</span> ${dateStr}</span>
                            <span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">location_on</span> ${event.location || '-'}</span>
                            <span class="text-indigo-600 font-bold flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">group</span> ${regCount} Terdaftar</span>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2 w-full md:w-auto">
                        <button onclick="viewParticipants('${event.id}', '${event.title.replace(/'/g, "\\'")}')"
                            class="flex-1 md:flex-none border border-slate-200 px-3 py-2 rounded-lg font-bold text-xs hover:bg-slate-50 text-slate-700 flex items-center justify-center gap-1 transition-colors">
                            <span class="material-symbols-outlined text-[16px]">list</span> LIST
                        </button>
                        <button onclick="window.location.href='/host_scanner?event=${event.id}'"
                            class="flex-1 md:flex-none bg-emerald-600 text-white border border-emerald-600 px-3 py-2 rounded-lg font-bold text-xs hover:bg-emerald-700 flex items-center justify-center gap-1 transition-colors shadow-sm">
                            <span class="material-symbols-outlined text-[16px]">qr_code_scanner</span> SCAN
                        </button>
                        <button onclick="openProfileBroadcastModal('${event.id}', '${event.title.replace(/'/g, "\\'")}')"
                            class="flex-1 md:flex-none bg-indigo-600 text-white border border-indigo-600 px-3 py-2 rounded-lg font-bold text-xs hover:bg-indigo-700 flex items-center justify-center gap-1 transition-colors shadow-sm">
                            <span class="material-symbols-outlined text-[16px]">campaign</span> MSG
                        </button>
                        <button onclick="openCertEditModal('${event.id}')"
                            class="flex-1 md:flex-none bg-amber-500 text-white border border-amber-500 px-3 py-2 rounded-lg font-bold text-xs hover:bg-amber-600 flex items-center justify-center gap-1 transition-colors shadow-sm">
                            <span class="material-symbols-outlined text-[16px]">workspace_premium</span> CERT
                        </button>
                    </div>
                </div>
            </div>
            `;
        }).join('');

    } catch (err) {
        logger.error('Error loading host events:', err);
        container.innerHTML = `<div class="text-center py-12 text-red-500 font-bold text-sm">Gagal memuat event: ${err.message}</div>`;
    }
}

let profileBroadcastEventId = null;

export function openProfileBroadcastModal(eventId, eventTitle) {
    profileBroadcastEventId = eventId;
    const modal = document.getElementById('pb_broadcastModal');
    if (!modal) return;

    document.getElementById('pb_broadcastEventTitle').textContent = eventTitle;
    document.getElementById('pb_title').value = '';
    document.getElementById('pb_message').value = '';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

export function closeProfileBroadcastModal() {
    const modal = document.getElementById('pb_broadcastModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

export async function sendProfileEventBroadcast() {
    if (!profileBroadcastEventId) return;

    const title = document.getElementById('pb_title').value;
    const message = document.getElementById('pb_message').value;
    const btn = document.getElementById('pb_sendBtn');

    if (!title || !message) return showNotification('Harap isi judul dan pesan!');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Mengirim...';
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminEventBroadcast',
                event_id: profileBroadcastEventId,
                title: title,
                message: message
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Gagal mengirim broadcast');

        showNotification(`✅ Berhasil! ${data.message}`, 'success');
        closeProfileBroadcastModal();
    } catch (err) {
        logger.error('Profile Broadcast error:', err);
        showNotification('Gagal: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🚀 Kirim Pesan';
        }
    }
}

// Global Exports for HTML
window.openProfileBroadcastModal = openProfileBroadcastModal;
window.closeProfileBroadcastModal = closeProfileBroadcastModal;
window.sendProfileEventBroadcast = sendProfileEventBroadcast;

/**
 * Open Change Password Modal
 * @param {boolean} isRecovery - If true, hide old password field (reset flow)
 */
export function openChangePasswordModal(isRecovery = false) {
    const modal = document.getElementById('changePasswordModal');
    if (!modal) return;

    // Reset form
    document.querySelectorAll('#changePasswordModal input').forEach(i => i.value = '');

    // Target the outer container (parent of .relative div) to hide Label + Input
    const oldPassInput = document.getElementById('oldPassword');
    const oldPassContainer = oldPassInput ? oldPassInput.closest('.relative')?.parentElement : null;
    const modalTitle = modal.querySelector('.comic-modal-title');
    const modalBadge = modal.querySelector('.comic-modal-badge');

    if (isRecovery) {
        // Recovery Mode: Hide Old Password
        if (oldPassContainer) oldPassContainer.style.display = 'none';
        if (modalTitle) modalTitle.textContent = 'RESET PASSWORD';
        if (modalBadge) modalBadge.textContent = 'RECOVERY';
        modal.dataset.mode = 'recovery';
    } else {
        // Normal Mode: Show Old Password
        if (oldPassContainer) oldPassContainer.style.display = 'block';
        if (modalTitle) modalTitle.textContent = 'GANTI PASSWORD!';
        if (modalBadge) modalBadge.textContent = 'SECURE!';
        modal.dataset.mode = 'normal';
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

/**
 * Close Change Password Modal
 * If user is in recovery mode (from reset link) and closes without completing,
 * they will be logged out for security
 */
export async function closeChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (!modal) return;

    const isRecovery = modal.dataset.mode === 'recovery';

    modal.classList.add('hidden');
    modal.classList.remove('flex');

    // SECURITY: If in recovery mode and modal closed without completing reset,
    // force logout to prevent unauthorized access
    if (isRecovery && sessionStorage.getItem('jdk_recovery_mode') === 'true') {
        showNotification('⚠️ Kamu harus menyelesaikan reset password. Silakan login kembali.');
        sessionStorage.removeItem('jdk_recovery_mode');

        // Clear URL hash
        history.pushState("", document.title, window.location.pathname + window.location.search);

        // Logout user
        if (sbClient) {
            await sbClient.auth.signOut();
        }

        // Redirect to home after short delay
        setTimeout(() => window.location.href = '/', 2000);
    }
}

/**
 * Toggle password visibility
 * @param {string} inputId - ID of input element
 * @param {HTMLElement} btn - Button element that triggered toggling
 */
export function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈'; // Monkey covering eyes (hidden icon logic reversed for UI) or just Slash Eye
    } else {
        input.type = 'password';
        btn.textContent = '👁';
    }
}

/**
 * Check password strength and return score with metadata
 * @param {string} password - Password to check
 * @returns {object} Strength result with score, color, label, width
 */
export function checkPasswordStrength(password) {
    let score = 0;

    if (!password) {
        return { score: 0, color: 'bg-gray-300', label: '', width: 0 };
    }

    // Length checks
    if (password.length >= 6) score++;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;

    // Complexity checks
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    // Normalize to 0-4 range
    const normalizedScore = Math.min(Math.floor(score / 1.5), 4);

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
 * Update password strength indicator UI
 * @param {string} password - Password to check
 */
export function updatePasswordStrengthUI(password) {
    const strength = checkPasswordStrength(password);

    const strengthBar = document.getElementById('passwordStrengthBar');
    const strengthText = document.getElementById('passwordStrengthText');

    if (strengthBar) {
        strengthBar.style.width = `${strength.width}%`,
            strengthBar.className = `h-full rounded-full transition-all duration-300 ${strength.color}`;
    }

    if (strengthText) {
        strengthText.textContent = strength.label;
        strengthText.className = `text-xs mt-1 font-bold ${strength.score >= 3 ? 'text-green-600' : strength.score >= 2 ? 'text-yellow-600' : 'text-red-500'}`;
    }
}

/**
 * Submit Change Password with improved error handling
 */
export async function submitChangePassword() {
    const modal = document.getElementById('changePasswordModal');
    const isRecovery = modal.dataset.mode === 'recovery';

    const oldPass = document.getElementById('oldPassword')?.value;
    const newPass = document.getElementById('newPassword')?.value;
    const confirmPass = document.getElementById('confirmPassword')?.value;

    if (!newPass || !confirmPass) {
        return showNotification('Mohon isi password baru!');
    }

    if (newPass !== confirmPass) {
        return showNotification('❌ Password konfirmasi tidak sama!');
    }

    if (newPass.length < 6) {
        return showNotification('❌ Password minimal 6 karakter!');
    }

    // Check password strength
    const strength = checkPasswordStrength(newPass);
    if (strength.score < 2) {
        return showNotification('❌ Password terlalu lemah! Gunakan kombinasi huruf besar, angka, dan simbol.');
    }

    if (!isRecovery && !oldPass) {
        return showNotification('Mohon isi password lama untuk verifikasi!');
    }

    const btn = modal.querySelector('button.btn-blue');
    const originalText = btn ? btn.innerHTML : 'SIMPAN';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Memproses...';
    }

    try {
        let currentUser = getCurrentUser();

        // If currentUser is missing during recovery, try to fetch it directly from Supabase
        if (!currentUser && isRecovery) {
            logger.log('Recovery mode: currentUser missing, fetching directly from auth...');
            const { data: { user } } = await sbClient.auth.getUser();
            if (user) {
                currentUser = {
                    id: user.id,
                    email: user.email,
                    ...user.user_metadata
                };
            }
        }

        if (!currentUser || !currentUser.email) throw new Error('User tidak teridentifikasi. Silakan login kembali.');

        // 1. Verify Old Password (if not recovery)
        if (!isRecovery) {
            const { error: signInError } = await sbClient.auth.signInWithPassword({
                email: currentUser.email,
                password: oldPass
            });

            if (signInError) {
                throw new Error('Password lama salah!');
            }
        }

        // 2. Update Password
        const { error: updateError } = await sbClient.auth.updateUser({
            password: newPass
        });

        if (updateError) {
            // Handle specific error cases
            const errMsg = updateError.message.toLowerCase();
            if (errMsg.includes('same') || errMsg.includes('different')) {
                throw new Error('Password baru tidak boleh sama dengan yang lama!');
            } else if (errMsg.includes('weak')) {
                throw new Error('Password terlalu lemah! Gunakan kombinasi yang lebih kuat.');
            } else if (errMsg.includes('session') || errMsg.includes('expired')) {
                throw new Error('Sesi kadaluarsa. Silakan minta link reset baru.');
            }
            throw updateError;
        }

        showNotification('✅ Password berhasil diubah!');
        closeChangePasswordModal();

        // Refresh user session state
        await initializeUserSession();

        // Clear URL hash & Session Storage if in recovery mode
        if (isRecovery) {
            sessionStorage.removeItem('jdk_recovery_mode');
            history.pushState("", document.title, window.location.pathname + window.location.search);

            showNotification('✅ Reset password berhasil! Selamat datang kembali, JDKwan.', 5000);
            setTimeout(() => {
                window.location.href = '/profile';
            }, 1500);
        }

    } catch (err) {
        logger.error('Change password error:', err);
        showNotification('❌ ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}


// --- CERTIFICATE DESIGNER (MIGRATED FROM ADMIN) ---

async function convertPdfToImage(url) {
    try {
        if (typeof pdfjsLib === 'undefined') {
            logger.error('pdfjsLib is not loaded.');
            return null;
        }
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        return canvas.toDataURL('image/png');
    } catch (error) {
        logger.error('Error converting PDF to image:', error);
        return null;
    }
}

async function renderCertTemplates() {
    const container = document.getElementById('certTemplateGrid');
    if (!container) return;

    container.innerHTML = '<p class="col-span-3 text-xs text-center py-2 animate-pulse font-black uppercase tracking-tighter text-black/20">Loading Templates...</p>';

    let templatePaths = [];
    try {
        const response = await fetch('scan_templates.php');
        if (response.ok) {
            templatePaths = await response.json();
        } else {
            throw new Error('Scanner not found');
        }
    } catch (e) {
        templatePaths = [
            '/images/cert_templates/cert_bg_classic.png',
            '/images/cert_templates/cert_bg_modern.png',
            '/images/cert_templates/cert_bg_minimal.png',
            '/images/cert_templates/cert_bg_nano_fun.png',
            '/images/cert_templates/cert_bg_nano_tech.png',
            '/images/cert_templates/cert_bg_nano_gold.png'
        ];
    }

    container.innerHTML = '';
    templatePaths.sort();

    for (const path of templatePaths) {
        let name = path.split('/').pop().replace(/\.[^/.]+$/, '');
        name = name.replace(/^cert_bg_/, '').replace(/_/g, ' ').toUpperCase();
        const isPdf = path.toLowerCase().endsWith('.pdf');

        const div = document.createElement('div');
        div.className = 'cursor-pointer border-4 border-black/10 hover:border-comic-blue rounded-xl overflow-hidden relative group transition-all';
        div.innerHTML = `
            <div class="w-full h-16 bg-gray-50 flex items-center justify-center">
                <span class="material-symbols-outlined animate-spin text-black/10">progress_activity</span>
            </div>
        `;
        container.appendChild(div);

        try {
            let imgSrc = path;
            if (isPdf) {
                const converted = await convertPdfToImage(path);
                if (converted) imgSrc = converted;
            }

            div.onclick = () => window.selectCertTemplate(path);
            div.innerHTML = `
                <img src="${imgSrc}" class="w-full h-16 object-cover ${name.includes('NANO') ? 'object-top' : ''}">
                <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[8px] font-black text-white text-center p-1 leading-tight transition-opacity uppercase">
                    ${name}
                </div>
            `;
        } catch (e) {
            div.innerHTML = '<div class="h-16 flex items-center justify-center text-[8px] text-red-500">ERR</div>';
        }
    }
}

window.openCertEditModal = function (eventId) {
    logger.log('[DEBUG] Opening Cert Designer for Event:', eventId);
    renderCertTemplates();

    const event = profileHostEvents.find(e => e.id == eventId);
    if (!event) {
        showNotification('❌ Event tidak ditemukan.');
        return;
    }

    document.getElementById('certEventId').value = eventId;
    document.getElementById('certTitle').value = event.cert_title || 'CERTIFICATE OF APPRECIATION';
    document.getElementById('certBody').value = event.cert_body || 'Dengan ini menyatakan bahwa [NAME] telah berhasil mengikuti dan menyelesaikan rangkaian kegiatan [EVENT] yang diselenggarakan oleh JDK Entertainment pada tanggal [DATE].';
    document.getElementById('certSignerName').value = event.cert_signer_name || 'JADUL KEKINIAN';
    document.getElementById('certSignerRole').value = event.cert_signer_role || 'Event Coordinator';
    document.getElementById('certBgUrl').value = event.cert_bg_url || '';

    const previewImg = document.getElementById('certPreviewImg');
    const uploadPlaceholder = document.getElementById('certUploadPlaceholder');
    const uploadPreview = document.getElementById('certUploadPreview');

    if (event.cert_bg_url) {
        previewImg.src = event.cert_bg_url;
        uploadPreview.classList.remove('hidden');
        uploadPreview.classList.add('flex');
        uploadPlaceholder.classList.add('hidden');
    } else {
        uploadPreview.classList.add('hidden');
        uploadPlaceholder.classList.remove('hidden');
    }

    const modal = document.getElementById('certEditModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.classList.add('animate-pop');
};

window.closeCertEditModal = function () {
    const modal = document.getElementById('certEditModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.handleCertBgUpload = async function (input) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        showNotification('❌ File terlalu besar! Maks 2MB.', 'error');
        input.value = '';
        return;
    }

    const preview = document.getElementById('certUploadPreview');
    const placeholder = document.getElementById('certUploadPlaceholder');
    const loading = document.getElementById('certUploadLoading');
    const previewImg = document.getElementById('certPreviewImg');
    const urlInput = document.getElementById('certBgUrl');

    preview.classList.add('hidden');
    placeholder.classList.add('hidden');
    loading.classList.remove('hidden');

    try {
        let fileToUpload = file;
        let fileExt = file.name.split('.').pop();

        if (file.type === 'application/pdf') {
            const fileUrl = URL.createObjectURL(file);
            const pngDataUrl = await convertPdfToImage(fileUrl);
            if (!pngDataUrl) throw new Error("PDF Conversion failed");

            const response = await fetch(pngDataUrl);
            const blob = await response.blob();
            fileToUpload = new File([blob], file.name.replace('.pdf', '.png'), { type: 'image/png' });
            fileExt = 'png';
            URL.revokeObjectURL(fileUrl);
        }

        const fileName = `cert_bg_${Date.now()}.${fileExt}`;
        const { error } = await sbClient.storage
            .from('events')
            .upload(fileName, fileToUpload);

        if (error) throw error;

        const { data: { publicUrl } } = sbClient.storage
            .from('events')
            .getPublicUrl(fileName);

        urlInput.value = publicUrl;
        previewImg.src = publicUrl;
        loading.classList.add('hidden');
        preview.classList.remove('hidden');
        preview.classList.add('flex');
        showNotification('✅ Background berhasil diupload!', 'success');

    } catch (err) {
        logger.error('Upload error:', err);
        showNotification('❌ Upload gagal: ' + err.message, 'error');
        loading.classList.add('hidden');
        placeholder.classList.remove('hidden');
    } finally {
        input.value = '';
    }
};

window.openCertPreview = async function () {
    const eventId = document.getElementById('certEventId').value;
    const event = profileHostEvents.find(e => e.id == eventId);

    const title = document.getElementById('certTitle').value;
    const body = document.getElementById('certBody').value;
    const signer = document.getElementById('certSignerName').value;
    const role = document.getElementById('certSignerRole').value;
    let bgUrl = document.getElementById('certBgUrl').value;

    const modal = document.getElementById('certPreviewModal');
    const container = document.getElementById('certPreviewContainer');
    const prevTitle = document.getElementById('prevCertTitle');
    const prevBody = document.getElementById('prevCertBody');
    const prevSigner = document.getElementById('prevCertSigner');
    const prevRole = document.getElementById('prevCertRole');

    if (bgUrl && bgUrl.toLowerCase().endsWith('.pdf')) {
        const imgData = await convertPdfToImage(bgUrl);
        container.style.backgroundImage = imgData ? `url(${imgData})` : 'none';
    } else {
        container.style.backgroundImage = bgUrl ? `url(${bgUrl})` : 'none';
        if (!bgUrl) container.style.backgroundColor = '#ffffff';
    }

    prevTitle.textContent = title;

    let formattedBody = body;
    const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    const dateStr = event && event.date
        ? new Date(event.date).toLocaleDateString('id-ID', dateOptions)
        : new Date().toLocaleDateString('id-ID', dateOptions);

    formattedBody = formattedBody.replace(/\[NAME\]/g, '<strong>JOHN DOE</strong>');
    formattedBody = formattedBody.replace(/\[EVENT\]/g, `<strong>${event?.title || 'EVENT TITLE'}</strong>`);
    formattedBody = formattedBody.replace(/\[DATE\]/g, `<strong>${dateStr}</strong>`);

    prevBody.innerHTML = formattedBody;
    prevSigner.textContent = signer;
    prevRole.textContent = role;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.classList.add('animate-pop');
};

window.closeCertPreview = function () {
    const modal = document.getElementById('certPreviewModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.selectCertTemplate = async function (url) {
    document.getElementById('certBgUrl').value = url;
    const previewImg = document.getElementById('certPreviewImg');

    if (url.toLowerCase().endsWith('.pdf')) {
        const imgData = await convertPdfToImage(url);
        if (imgData) previewImg.src = imgData;
        else previewImg.alt = 'PDF Template Selected';
    } else {
        previewImg.src = url;
    }

    document.getElementById('certUploadPreview').classList.remove('hidden');
    document.getElementById('certUploadPreview').classList.add('flex');
    document.getElementById('certUploadPlaceholder').classList.add('hidden');
};

window.removeCertBackground = function () {
    document.getElementById('certBgUrl').value = '';
    document.getElementById('certPreviewImg').src = '';
    document.getElementById('certUploadPreview').classList.add('hidden');
    document.getElementById('certUploadPlaceholder').classList.remove('hidden');
};

window.saveCertTemplate = async function () {
    const eventId = document.getElementById('certEventId').value;
    const certData = {
        cert_title: document.getElementById('certTitle').value,
        cert_body: document.getElementById('certBody').value,
        cert_signer_name: document.getElementById('certSignerName').value,
        cert_signer_role: document.getElementById('certSignerRole').value,
        cert_bg_url: document.getElementById('certBgUrl').value
    };

    const btn = document.querySelector('#certEditModal button[type="submit"]');
    const originalText = btn.innerHTML;

    try {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> Saving...';

        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminUpdateCertTemplate',
                event_id: eventId,
                cert_data: certData
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Server error');

        showNotification('✅ Desain sertifikat disimpan!', 'success');
        window.closeCertEditModal();
        // Assuming loadHostEvents exists elsewhere and populates profileHostEvents
        // For this change, we only add the call, not define loadHostEvents itself.
        await loadHostEvents(); // Refresh data to get updated cert info

    } catch (err) {
        logger.error('Error saving cert template:', err);
        showNotification('❌ Gagal menyimpan: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

// --- PARTICIPANT MANAGEMENT (MIGRATED FROM ADMIN) ---

window.viewParticipants = async function (eventId, title) {
    currentParticipantEventId = eventId;
    currentParticipantEventTitle = title;

    document.getElementById('participantModalTitle').textContent = `PESERTA: ${title}`;
    document.getElementById('participantTableBody').innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500 font-bold animate-pulse">Loading...</td></tr>';
    document.getElementById('participantMobileList').innerHTML = '<div class="p-8 text-center text-gray-500 font-bold animate-pulse">Loading...</div>';

    // Update Broadcast Button
    const broadcastBtn = document.getElementById('btnParticipantBroadcast');
    if (broadcastBtn) {
        broadcastBtn.onclick = () => openProfileBroadcastModal(eventId, title);
    }

    const modal = document.getElementById('participantModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.classList.add('animate-pop');

    try {
        const { data, error } = await sbClient
            .from('event_registrations')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        renderParticipants(data || []);

    } catch (err) {
        logger.error('Error fetching participants:', err);
        const errorMsg = '<tr><td colspan="5" class="p-8 text-center text-red-500 font-bold">Gagal memuat peserta</td></tr>';
        document.getElementById('participantTableBody').innerHTML = errorMsg;
        document.getElementById('participantMobileList').innerHTML = `<div class="p-8 text-center text-red-500 font-bold">Gagal memuat: ${err.message}</div>`;
    }
};

function renderParticipants(participants) {
    const tbody = document.getElementById('participantTableBody');
    const mobileList = document.getElementById('participantMobileList');
    if (!tbody || !mobileList) return;

    if (participants.length === 0) {
        const emptyMsg = '<div class="p-8 text-center text-gray-400 font-bold">Belum ada pendaftar.</div>';
        tbody.innerHTML = `<tr><td colspan="5">${emptyMsg}</td></tr>`;
        mobileList.innerHTML = emptyMsg;
        return;
    }

    // Desktop View
    tbody.innerHTML = participants.map(p => `
        <tr class="border-b border-slate-100 text-slate-800 hover:bg-slate-50 transition-colors">
            <td class="p-4">
                <div class="font-bold text-slate-900 capitalize">${escapeHTML(p.full_name)}</div>
            </td>
            <td class="p-4 text-xs font-medium text-slate-500">${escapeHTML(p.phone)}</td>
            <td class="p-4">
                ${p.payment_proof_url ? `<a href="${p.payment_proof_url}" target="_blank" class="text-indigo-600 underline font-bold text-xs flex items-center gap-1 hover:text-indigo-800 transition-colors"><span class="material-symbols-outlined text-sm">image</span> PROOF</a>` : `<span class="text-slate-300">-</span>`}
            </td>
            <td class="p-4">
                <span class="px-3 py-1 rounded-full text-[10px] font-bold 
                    ${p.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : p.status === 'cancelled' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}">
                    ${p.status.toUpperCase()}
                </span>
            </td>
            <td class="p-4 text-center">
                <div class="flex items-center justify-center gap-2">
                    <select onchange="updateParticipantStatus('${p.id}', this.value)" 
                        class="text-xs border border-slate-300 rounded-lg p-2 font-medium bg-white text-slate-700 focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 transition-all outline-none">
                        <option value="pending" ${p.status === 'pending' ? 'selected' : ''}>PENDING</option>
                        <option value="confirmed" ${p.status === 'confirmed' ? 'selected' : ''}>CONFIRM</option>
                        <option value="attended" ${p.status === 'attended' ? 'selected' : ''}>ATTENDED</option>
                        <option value="cancelled" ${p.status === 'cancelled' ? 'selected' : ''}>CANCEL</option>
                    </select>
                    <button onclick="deleteRegistration('${p.id}')" 
                        class="bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg p-2 text-sm transition-colors" title="Hapus">
                        <span class="material-symbols-outlined text-base">delete</span>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    // Mobile Card View
    mobileList.innerHTML = participants.map(p => `
        <div class="p-5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
            <div class="flex justify-between items-start mb-4">
                <div class="flex-1">
                    <div class="font-bold text-slate-900 capitalize text-lg leading-tight mb-1">${escapeHTML(p.full_name)}</div>
                    <div class="text-xs font-medium text-slate-400 font-body">${escapeHTML(p.phone)}</div>
                </div>
                <div class="text-right">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide
                        ${p.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : p.status === 'attended' ? 'bg-indigo-100 text-indigo-700' : p.status === 'cancelled' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}">
                        ${p.status.toUpperCase()}
                    </span>
                    <div class="mt-2 text-right">
                        ${p.payment_proof_url ? `<a href="${p.payment_proof_url}" target="_blank" class="text-[10px] font-bold text-indigo-600 underline uppercase tracking-widest hover:text-indigo-800 transition-colors">Lihat Bukti 📸</a>` : `<span class="text-[9px] opacity-20">NO PROOF</span>`}
                    </div>
                </div>
            </div>
            
            <div class="flex gap-2">
                <div class="flex-[3]">
                    <select onchange="updateParticipantStatus('${p.id}', this.value)" 
                        class="w-full text-xs border border-slate-300 rounded-lg p-3 font-medium bg-white text-slate-900 focus:border-indigo-600 outline-none">
                        <option value="pending" ${p.status === 'pending' ? 'selected' : ''}>PENDING</option>
                        <option value="confirmed" ${p.status === 'confirmed' ? 'selected' : ''}>CONFIRM</option>
                        <option value="attended" ${p.status === 'attended' ? 'selected' : ''}>ATTENDED</option>
                        <option value="cancelled" ${p.status === 'cancelled' ? 'selected' : ''}>CANCEL</option>
                    </select>
                </div>
                <div class="flex-1">
                    <button onclick="deleteRegistration('${p.id}')" 
                        class="w-full h-full bg-rose-50 text-rose-600 border border-rose-200 rounded-lg font-bold text-xs hover:bg-rose-100 transition-colors flex items-center justify-center">
                        <span class="material-symbols-outlined text-base">delete</span>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

window.updateParticipantStatus = async function (regId, newStatus) {
    if (newStatus === 'attended') {
        if (!confirm('Ubah status ke HADIR? User akan otomatis menerima XP & Points reward via sistem.')) {
            window.viewParticipants(currentParticipantEventId, currentParticipantEventTitle);
            return;
        }
    }

    showNotification('🕒 Updating status... ⏳', 'info');

    const action = newStatus === 'attended' ? 'confirmAttendance' : 'adminUpdateRegistrationStatus';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: action,
                registration_id: regId,
                status: newStatus
            }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Server error');

        showNotification('✅ Status berhasil diperbarui!', 'success');
        window.viewParticipants(currentParticipantEventId, currentParticipantEventTitle);
        await loadHostEvents(); // Refresh counts

    } catch (err) {
        logger.error('Update status error:', err);
        showNotification('❌ Gagal update status: ' + err.message, 'error');
        window.viewParticipants(currentParticipantEventId, currentParticipantEventTitle);
    }
};

window.deleteRegistration = async function (regId) {
    if (!confirm('⚠️ HAPUS PENDAFTARAN?\n\nPoints yang terpotong (jika ada) akan dikembalikan otomatis ke user. History transaksi pendaftaran juga akan dihapus.')) return;

    showNotification('🗑️ Menghapus pendaftaran... ⏳', 'info');

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminDeleteRegistration',
                registration_id: regId
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        showNotification('✅ Pendaftaran dihapus & Points dikembalikan', 'success');
        window.viewParticipants(currentParticipantEventId, currentParticipantEventTitle);
        await loadHostEvents();

    } catch (err) {
        logger.error('Delete registration error:', err);
        showNotification('❌ Gagal menghapus: ' + err.message, 'error');
    }
};

window.closeParticipantModal = function () {
    const modal = document.getElementById('participantModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

/**
 * Load and render recent user activity
 * @param {string} userId - Optional user ID (defaults to current user)
 */
async function loadRecentActivity(userId = null) {
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId || !sbClient) return;

    const list = document.getElementById('recentActivityList');
    if (!list) return;

    try {
        // Fetch Point Transactions (Last 5)
        const { data: pts, error: ptsError } = await sbClient
            .from('point_transactions')
            .select('*')
            .eq('user_id', targetId)
            .order('created_at', { ascending: false })
            .limit(5);

        // Fetch Achievements (Last 5)
        const { data: achs, error: achsError } = await sbClient
            .from('user_achievements')
            .select('*, achievements(title, icon_emoji)')
            .eq('user_id', targetId)
            .order('unlocked_at', { ascending: false })
            .limit(5);

        // Combine and Sort
        const activities = [
            ...(pts || []).map(p => ({
                id: p.id,
                title: p.description || 'Poin diterima',
                date: p.created_at,
                value: p.amount > 0 ? `+ ${p.amount} ` : p.amount,
                icon: '💰',
                color: p.amount > 0 ? 'orange' : 'red'
            })),
            ...(achs || []).map(a => ({
                id: a.achievement_id,
                title: `Unlock: ${a.achievements?.title || 'Achievement'} `,
                date: a.unlocked_at,
                value: a.achievements?.icon_emoji || '🏆',
                icon: '🏆',
                color: 'purple'
            }))
        ];

        activities.sort((a, b) => new Date(b.date) - new Date(a.date));
        const limited = activities.slice(0, 5);

        if (limited.length === 0) {
            list.innerHTML = `
            <div class="text-center py-8 text-slate-400 font-body text-sm">
                Belum ada aktivitas baru.
            </div>
            `;
            return;
        }

        list.innerHTML = limited.map(act => {
            const date = new Date(act.date);
            const relativeDate = getRelativeTime(date);
            const iconColor = act.color === 'orange' ? 'text-orange-500' :
                act.color === 'purple' ? 'text-purple-500' :
                    act.color === 'red' ? 'text-red-500' : 'text-emerald-500';

            return `
            <div class="activity-item flex items-center gap-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 rounded-lg px-2 transition-colors">
                <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-xl border border-slate-100">
                    ${act.icon}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start gap-2">
                        <p class="text-sm font-bold text-slate-800 leading-tight truncate">${act.title}</p>
                        <span class="text-xs font-bold ${iconColor}">${act.value}</span>
                    </div>
                    <p class="text-[10px] font-medium text-slate-400 mt-0.5">${relativeDate}</p>
                </div>
            </div>
            `;
        }).join('');

    } catch (err) {
        logger.error('Error loading recent activity:', err);
        list.innerHTML = '<p class="text-center text-red-500 py-4 font-body">Gagal memuat aktivitas.</p>';
    }
}

/**
 * Fetch point history for charts
 * @param {string} userId - User UUID
 * @returns {Promise<object>} - { labels, values }
 */
async function fetchPointHistory(userId) {
    if (!sbClient) return { labels: [], values: [] };

    try {
        // Fetch all transactions to calculate cumulative totals
        const { data: trans, error } = await sbClient
            .from('point_transactions')
            .select('amount, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        // Last 6 months labels
        const labels = [];
        const now = new Date();

        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            labels.push(d.toLocaleDateString('id-ID', { month: 'short' }));
        }

        // Calculate cumulative points at the end of each of the last 6 months
        const values = new Array(6).fill(0);
        let currentTotal = 0;

        trans.forEach(t => {
            const tDate = new Date(t.created_at);
            currentTotal += (t.amount || 0);

            // Record totals for each of our 6 bins
            for (let i = 0; i < 6; i++) {
                const binDate = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 0); // End of month i
                if (tDate <= binDate) {
                    values[i] = currentTotal;
                }
            }
        });

        // Fill forward if no transactions in a month
        for (let i = 1; i < 6; i++) {
            if (values[i] === 0 && values[i - 1] !== 0) {
                values[i] = values[i - 1];
            }
        }

        return { labels, values };
    } catch (err) {
        logger.error('Error fetching point history:', err);
        return {
            labels: ['-', '-', '-', '-', '-', '-'],
            values: [0, 0, 0, 0, 0, 0]
        };
    }
}

/**
 * Load and render user marketplace items
 * @param {string} userId - Optional user ID
 */
export async function loadUserMarketplace(userId = null) {
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId || !sbClient) return;

    const list = document.getElementById('profileMarketplaceList');
    if (!list) return;

    list.innerHTML = '<div class="text-center py-8"><div class="animate-pulse text-gray-400">Memuat JDK Box...</div></div>';

    try {
        const { data, error } = await sbClient
            .from('products')
            .select('*')
            .eq('seller_id', targetId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            list.innerHTML = '<p class="text-gray-500 font-body text-center py-8">Belum ada barang di JDK Box kamu.</p>';
            return;
        }

        list.innerHTML = data.map(product => {
            const statusColor = product.status === 'sold' ? 'bg-orange-100 text-orange-600' :
                product.status === 'pending' ? 'bg-amber-100 text-amber-600' :
                    product.status === 'rejected' ? 'bg-rose-100 text-rose-600' :
                        'bg-emerald-100 text-emerald-600';

            return `
            <div class="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-lg transition-all relative group mb-4">
                <div class="flex items-center gap-6">
                    <img src="${product.image_url || 'https://placehold.co/150?text=Product'}"
                        alt="${product.name}"
                        class="w-20 h-20 object-cover rounded-xl border border-slate-100 shadow-sm">
                    <div class="flex-1">
                        <h4 class="text-slate-900 font-bold text-lg tracking-tight">${product.name}</h4>
                        <p class="text-slate-500 font-bold text-sm mt-1">Rp ${(product.price || 0).toLocaleString('id-ID')}</p>
                        ${product.status === 'rejected' ? `<p class="text-[10px] text-rose-500 font-medium mt-1 uppercase tracking-wide">Action Required: Check Admin Rejection Reason</p>` : ''}
                    </div>
                    <div class="flex flex-col items-end gap-3">
                        <span class="${statusColor} px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide w-28 text-center">
                            ${(product.status || 'Available').toUpperCase()}
                        </span>
                        ${targetId === getCurrentUser()?.id ? `
                        <div class="flex gap-2">
                            <a href="/marketplace?edit=${product.id}" 
                                class="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg font-bold text-xs hover:bg-slate-50 transition-all hover:text-indigo-600 shadow-sm">
                                Edit
                            </a>
                            <button onclick="event.stopPropagation(); deleteProduct('${product.id}')" 
                                class="bg-rose-50 text-rose-600 border border-rose-200 px-3 py-2 rounded-lg font-bold text-xs hover:bg-rose-100 transition-colors shadow-sm">
                                🗑️
                            </button>
                        </div>` : ''}
                    </div>
                </div>
            </div>
            `;
        }).join('');

    } catch (err) {
        logger.error('Error loading user marketplace:', err);
        list.innerHTML = '<p class="text-center text-red-500 py-4 font-body">Gagal memuat barang.</p>';
    }
}

/**
 * Load wallet transaction history for JDK Points
 * @param {string} userId - Optional user ID
 */
export async function loadUserPointHistory(userId = null) {
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId || !sbClient) return;

    const body = document.getElementById('pointHistoryBody');
    const balanceEl = document.getElementById('pointTabBalance');
    if (!body) return;

    try {
        const { data, error } = await sbClient
            .from('point_transactions')
            .select('*')
            .eq('user_id', targetId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        let total = 0;
        if (!data || data.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">Belum ada riwayat poin.</td></tr>';
        } else {
            body.innerHTML = data.map(t => {
                total += (t.amount || 0);
                const dateObj = new Date(t.created_at);
                const date = dateObj.toLocaleDateString('id-ID', {
                    day: 'numeric', month: 'short', year: 'numeric'
                });
                const time = dateObj.toLocaleTimeString('id-ID', {
                    hour: '2-digit', minute: '2-digit'
                }).replace('.', ':');
                const fullDate = `${date}, ${time}`;

                const amountClass = t.amount > 0 ? 'text-green-600' : 'text-red-600';
                return `
                <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td class="p-4 text-sm font-medium text-slate-500">${fullDate}</td>
                    <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 text-slate-600">${t.type || 'SYSTEM'}</span></td>
                    <td class="p-4 font-bold ${amountClass}">${t.amount > 0 ? '+' : ''}${t.amount}</td>
                    <td class="p-4 text-sm font-medium text-slate-700">${t.description || '-'}</td>
                </tr>
                `;
            }).join('');
        }

        if (balanceEl) balanceEl.textContent = total.toLocaleString('id-ID');
    } catch (err) {
        logger.error('Error loading point history:', err);
        body.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">Gagal memuat riwayat.</td></tr>';
    }
}

/**
 * Delete product
 */
export async function deleteProduct(productId) {
    if (!confirm('Apakah kamu yakin ingin menghapus barang ini? Tindakan ini tidak dapat dibatalkan.')) return;

    try {
        const currentUser = getCurrentUser();
        if (!currentUser) return;

        // Use secure handler
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'deleteProduct',
                product_id: productId
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Gagal menghapus barang');

        showNotification(data.message || 'Barang berhasil dihapus! 🗑️');
        loadUserMarketplace(currentUser.id); // Refresh list

    } catch (err) {
        logger.error('Delete product error:', err);
        showNotification('Gagal menghapus barang: ' + err.message);
    }
}

/**
 * Load and render user Rekber transactions
 */
export async function loadUserRekberTransactions(userId = null) {
    const targetId = userId || getCurrentUser()?.id;
    if (!targetId || !sbClient) return;

    const list = document.getElementById('userRekberList');
    if (!list) return;

    list.innerHTML = `
            <div class="text-center py-12 text-gray-400 font-bold text-sm animate-pulse">
                Memuat transaksi rekber...
            </div>
            `;

    try {
        const { data, error } = await sbClient
            .from('rekber_transactions')
            .select('*, products(name, image_url), buyer:profiles!rekber_transactions_buyer_id_fkey(username), seller:profiles!rekber_transactions_seller_id_fkey(username)')
            .or(`buyer_id.eq.${targetId}, seller_id.eq.${targetId}`)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            list.innerHTML = `
            <div class="text-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                <p class="font-medium text-sm">Belum ada transaksi rekber.</p>
            </div>
            `;
            return;
        }

        list.innerHTML = data.map(tx => {
            const isBuyer = tx.buyer_id === targetId;
            const roleLabel = isBuyer ? 'PEMBELI' : 'PENJUAL';
            const partnerName = isBuyer ? tx.seller?.username : tx.buyer?.username;
            const roleColor = isBuyer ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800';

            return `
            <div class="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row items-center gap-5 hover:shadow-md transition-all shadow-sm pointer-events-auto mb-4">
                <img src="${tx.products?.image_url || '/images/jdk-logo.png'}" class="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover border border-slate-100 shadow-sm">
                    <div class="flex-1 text-center md:text-left">
                        <div class="flex items-center justify-center md:justify-start gap-2 mb-1 flex-wrap">
                            <span class="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${roleColor}">${roleLabel}</span>
                            <h4 class="font-bold uppercase text-sm tracking-tight text-slate-900">${escapeHTML(tx.products?.name || 'Produk Tidak Diketahui')}</h4>
                        </div>
                        <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mt-1">Partner: <span class="text-indigo-600 font-bold">@${escapeHTML(partnerName || 'Unknown')}</span> <span class="mx-1">|</span> Rp ${(tx.amount || 0).toLocaleString('id-ID')}</p>
                        <div class="mt-3">
                            <span class="status-pill status-${tx.status}">${tx.status}</span>
                        </div>
                    </div>
                    <div class="w-full md:w-auto">
                        <a href="/rekber?id=${tx.id}" class="bg-indigo-600 text-white hover:bg-indigo-700 py-2.5 px-6 text-xs w-full block text-center rounded-lg shadow-sm hover:shadow-md transition-all font-bold">
                            MASUK ROOM
                        </a>
                    </div>
                </div>
        `;
        }).join('');

    } catch (err) {
        logger.error('Error loading user rekber:', err);
        list.innerHTML = `
            <div class="text-center py-12 text-red-500 font-bold border-2 border-dashed border-red-200 rounded-2xl">
                Gagal memuat transaksi: ${err.message}
            </div>
            `;
    }
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.initializeProfilePage = initializeProfilePage;
    window.switchTab = switchTab;
    window.editProfile = editProfile;
    window.closeEditProfileModal = closeEditProfileModal;
    window.previewEditAvatar = previewEditAvatar;
    window.previewAvatar = previewAvatar;
    window.saveProfile = saveProfile;
    window.loadUserRekberTransactions = loadUserRekberTransactions;
}
