import { logger } from '../core/logger.js';
/**
 * Admin Dashboard Logic PRO
 * JDK Entertainment
 */
import { sbClient } from '../core/supabase.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let currentMembers = [];
let sortConfig = { key: 'created_at', direction: 'desc' }; // Default sort new to old
let adminRanks = [];
let currentLevelConfigs = [];

// Pagination State
let currentPage = 1;
const itemsPerPage = 20;
let totalMemberCount = 0;


export async function initializeAdminDashboard() {
    const perms = await initializeAdminLayout();
    await applyPermissions(perms);

    await loadSystemSettings();
    await loadStats();
    loadActionRequired(); // Fire and forget — runs in parallel
    await loadAllMembers(1); // Load page 1
    await loadAdminBroadcasts();

    setupPaginationListeners();
}

document.addEventListener('DOMContentLoaded', initializeAdminDashboard);

function setupPaginationListeners() {
    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (currentPage > 1) loadAllMembers(currentPage - 1);
    });

    document.getElementById('nextPageBtn').addEventListener('click', () => {
        const totalPages = Math.ceil(totalMemberCount / itemsPerPage);
        if (currentPage < totalPages) loadAllMembers(currentPage + 1);
    });
}

/**
 * Apply granular permissions to the dashboard UI
 */
async function applyPermissions(perms) {
    if (!perms) return;
    const isSuper = perms.is_super_admin;
    const userPerms = perms.permissions || [];

    // Dashboard sections (Stats & Settings)
    const canSeeDashboard = isSuper || userPerms.includes('dashboard');
    if (!canSeeDashboard) {
        document.getElementById('statsSection')?.classList.add('hidden');
        document.getElementById('settingsSection')?.classList.add('hidden');
    }

    // Member Management
    const canSeeMembers = isSuper || userPerms.includes('members');
    if (!canSeeMembers) {
        document.getElementById('membersSection')?.classList.add('hidden');
    }

    // Rank/Level Management
    const canSeeRanks = isSuper || userPerms.includes('ranks');
    if (!canSeeRanks) {
        document.getElementById('ranksSection')?.classList.add('hidden');
        document.getElementById('levelsSection')?.classList.add('hidden');
    }

    // Host Restrictions (Read-only for sensitive data)
    const isHost = !isSuper && !userPerms.includes('members_full'); // Assume 'members_full' would be for full admin
    // For now, let's just check the level directly from the profile if available, or just check perms.
    // If user is 'Host', we want to hide certain things.
    const { data: { user } } = await sbClient.auth.getUser();
    const { data: profile } = await sbClient.from('profiles').select('user_level').eq('id', user.id).single();

    if (profile?.user_level === 'Host') {
        // Dashboard Settings
        document.getElementById('saveSettingsBtn')?.classList.add('hidden');

        // Member controls in modal
        document.getElementById('saveMemberBtn')?.classList.add('hidden');
        document.getElementById('deleteMemberBtn')?.classList.add('hidden');
        document.getElementById('btnManualConfirm')?.classList.add('hidden');

        // Balance Controls
        document.querySelectorAll('.balance-action-btn').forEach(btn => btn.classList.add('hidden'));
    }
}

// --- UI Helpers ---
window.showNotification = function (msg, type = 'info') {
    const toast = document.createElement('div');
    // Professional Toast
    let bgClass = 'bg-blue-600';
    if (type === 'success') bgClass = 'bg-emerald-600';
    if (type === 'error') bgClass = 'bg-red-600';
    if (type === 'warning') bgClass = 'bg-amber-500';

    toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg text-white text-sm font-medium shadow-lg z-[9999] transition-all transform translate-y-20 opacity-0 ${bgClass}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    // Animate in
    setTimeout(() => {
        toast.classList.remove('translate-y-20', 'opacity-0');
    }, 50);

    // Animate out
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[m]);
}

// --- Dashboard Stats ---
async function loadStats() {
    try {
        const { count: total } = await sbClient.from('profiles').select('*', { count: 'exact', head: true });
        const { count: admins } = await sbClient.from('profiles').select('*', { count: 'exact', head: true }).eq('user_level', 'Admin');
        const { count: vips } = await sbClient.from('profiles').select('*', { count: 'exact', head: true }).eq('user_level', 'VIP');

        const { data: pointsData } = await sbClient.from('profiles').select('current_points');
        const totalPoints = pointsData?.reduce((acc, curr) => acc + (curr.current_points || 0), 0) || 0;

        document.getElementById('totalMembers').textContent = (total || 0).toLocaleString();
        document.getElementById('totalAdmins').textContent = (admins || 0).toLocaleString();
        document.getElementById('totalVIP').textContent = (vips || 0).toLocaleString();
        document.getElementById('totalPoints').textContent = totalPoints.toLocaleString();

        refreshPromoBadges();
    } catch (err) {
        logger.error('Error loading stats:', err);
    }
}

// --- Action Required To-Do Panel ---
window.loadActionRequired = async function loadActionRequired() {
    try {
        const [products, radio, rekberVerify, rekberDispute, eventReg] = await Promise.all([
            sbClient.from('products').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
            sbClient.from('music_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
            sbClient.from('rekber_transactions').select('*', { count: 'exact', head: true }).eq('status', 'VERIFYING'),
            sbClient.from('rekber_transactions').select('*', { count: 'exact', head: true }).eq('status', 'DISPUTE'),
            sbClient.from('event_registrations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        ]);

        const counts = [
            { id: 'countProducts', dot: 'dotProducts', value: products.count || 0 },
            { id: 'countRadio', dot: 'dotRadio', value: radio.count || 0 },
            { id: 'countRekberVerify', dot: 'dotRekberVerify', value: rekberVerify.count || 0 },
            { id: 'countRekberDispute', dot: 'dotRekberDispute', value: rekberDispute.count || 0 },
            { id: 'countEventReg', dot: 'dotEventReg', value: eventReg.count || 0 },
        ];

        counts.forEach(({ id, dot, value }) => {
            const countEl = document.getElementById(id);
            const dotEl = document.getElementById(dot);
            if (countEl) countEl.textContent = value;
            if (dotEl) {
                if (value > 0) {
                    dotEl.classList.remove('hidden');
                } else {
                    dotEl.classList.add('hidden');
                }
            }
        });
    } catch (err) {
        logger.error('Error loading action required:', err);
    }
};

function refreshPromoBadges() {
    const container = document.getElementById('activePromoContainer');
    if (!container) return;
    container.innerHTML = '';

    const now = new Date();

    // Check Double XP
    const dxStart = document.getElementById('settingDoubleXpStart').value;
    const dxEnd = document.getElementById('settingDoubleXpEnd').value;
    if (dxStart && dxEnd && now >= new Date(dxStart) && now <= new Date(dxEnd)) {
        container.innerHTML += `
            <div class="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-sm">
                <span class="material-symbols-outlined text-[14px]">bolt</span> Double XP
            </div>
        `;
    }

    // Check Double Points
    const dpStart = document.getElementById('settingDoublePointsStart').value;
    const dpEnd = document.getElementById('settingDoublePointsEnd').value;
    if (dpStart && dpEnd && now >= new Date(dpStart) && now <= new Date(dpEnd)) {
        container.innerHTML += `
            <div class="bg-orange-500 text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-sm">
                <span class="material-symbols-outlined text-[14px]">star</span> Double Points
            </div>
        `;
    }
}

// --- Member Management (with Pagination) ---
window.loadAllMembers = async (page = 1) => {
    currentPage = page;
    const tbody = document.getElementById('memberTableBody');
    tbody.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400 text-sm">Loading members...</td></tr>';

    // Calculate range
    const from = (page - 1) * itemsPerPage;
    const to = from + itemsPerPage - 1;

    // Build Query
    let query = sbClient
        .from('profiles')
        .select('*', { count: 'exact' });

    // Filter handling (simple client-side filter simulation requires fetching all, 
    // but for true pagination we should trust DB. 
    // If search is active, we might need a different approach or rely on Supabase 'ilike')

    const searchTerm = document.getElementById('searchMember').value.trim();
    if (searchTerm) {
        // basic search on username or email or jdk_id
        // constructing OR filter
        query = query.or(`username.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,jdk_id.ilike.%${searchTerm}%`);
    }

    // Sort
    query = query.order(sortConfig.key, { ascending: sortConfig.direction === 'asc' });

    // Pagination
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
        window.showNotification('Failed to load members: ' + error.message, 'error');
        return;
    }

    totalMemberCount = count || 0;
    currentMembers = data || [];
    renderMemberTable(currentMembers);
    updatePaginationControls();
    updateSortIndicators();
};

function updatePaginationControls() {
    const totalPages = Math.ceil(totalMemberCount / itemsPerPage);
    const from = totalMemberCount === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const to = Math.min(currentPage * itemsPerPage, totalMemberCount);

    document.getElementById('paginationInfo').textContent = `Showing ${from}-${to} of ${totalMemberCount}`;

    document.getElementById('prevPageBtn').disabled = currentPage === 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages || totalPages === 0;
}

function renderMemberTable(members) {
    const tbody = document.getElementById('memberTableBody');
    if (members.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="p-8 text-center text-slate-400">No members found</td></tr>';
        return;
    }

    tbody.innerHTML = members.map(m => `
        <tr class="hover:bg-slate-50 transition-colors cursor-pointer group" onclick="openEditMemberModal('${m.id}')">
            <td class="p-3 text-center">
                <img src="${m.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + m.username}" class="w-8 h-8 rounded-full mx-auto bg-white shadow-sm object-cover">
            </td>
            <td class="p-3 font-medium text-slate-800 group-hover:text-blue-600 transition-colors">${escapeHTML(m.username)}</td>
            <td class="p-3 text-xs font-mono text-slate-500">${escapeHTML(m.jdk_id || '-')}</td>
            <td class="p-3">
                ${getUserLevelBadge(m.user_level)}
            </td>
            <td class="p-3">
                 <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    ${m.status || 'inactive'}
                </span>
            </td>
            <td class="p-3 text-xs font-bold text-slate-600">${m.xp ? calculateRankName(m.xp) : 'NEWBIE'}</td>
            <td class="p-3 text-xs text-slate-400 max-w-[150px] truncate" title="${escapeHTML(m.email)}">${escapeHTML(m.email || 'NO_AUTH')}</td>
            <td class="p-3 text-right text-sm text-slate-700 font-mono">${(m.xp || 0).toLocaleString()}</td>
            <td class="p-3 text-right">
                <div onclick="event.stopPropagation(); openBalanceModal('${m.id}', 'points')" class="inline-flex items-center px-2 py-1 bg-slate-100 hover:bg-orange-100 text-slate-600 hover:text-orange-700 rounded transition-colors cursor-pointer">
                   <span class="text-xs font-bold">${(m.current_points || 0).toLocaleString()}</span>
                </div>
            </td>
            <td class="p-3 text-right">
                <div onclick="event.stopPropagation(); openBalanceModal('${m.id}', 'coin')" class="inline-flex items-center px-2 py-1 bg-slate-100 hover:bg-yellow-100 text-slate-600 hover:text-yellow-700 rounded transition-colors cursor-pointer">
                    <span class="text-xs font-bold">${(m.coin || 0).toLocaleString()}</span>
                </div>
            </td>
            <td class="p-3 text-right text-xs text-slate-400 font-mono">
                ${m.last_login ? new Date(m.last_login).toLocaleDateString() : '-'}
            </td>
        </tr>
    `).join('');
}

function getUserLevelBadge(level) {
    if (level === 'Admin') return `<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Admin</span>`;
    if (level === 'VIP') return `<span class="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">VIP</span>`;
    return `<span class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">Member</span>`;
}

function calculateRankName(xp) {
    // If global function exists (from game scripts maybe?), use it, else fallback
    if (window.calculateUserLevel) return window.calculateUserLevel(xp).rankName;
    if (xp > 100000) return 'LEGEND';
    if (xp > 50000) return 'EPIC';
    return 'NOVICE';
}

// --- Filtering & Sorting ---
window.filterMembers = () => {
    // Debounce or just reload page 1 with new search term which is handled in loadAllMembers
    // For simplicity, just reload logic:
    loadAllMembers(1);
};

window.sortBy = (key) => {
    if (sortConfig.key === key) {
        sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
        sortConfig.key = key;
        sortConfig.direction = 'asc';
    }
    loadAllMembers(1);
};

function updateSortIndicators() {
    const headers = document.querySelectorAll('th[onclick^="sortBy"]');
    headers.forEach(th => {
        // Safe match
        const match = th.getAttribute('onclick')?.match(/'([^']+)'/);
        if (!match) return;
        const key = match[1];

        // Reset style
        th.classList.remove('text-blue-600', 'font-bold', 'bg-slate-50');

        // Remove existing icon
        const existingIcon = th.querySelector('.sort-icon');
        if (existingIcon) existingIcon.remove();

        if (sortConfig.key === key) {
            th.classList.add('text-blue-600', 'font-bold', 'bg-slate-50');
            const icon = document.createElement('span');
            icon.className = 'sort-icon material-symbols-outlined text-[10px] align-middle ml-1';
            icon.textContent = sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward';
            th.appendChild(icon);
        }
    });
}

window.togglePermissionSection = () => {
    const level = document.getElementById('editUserLevel').value;
    const section = document.getElementById('adminPermissionSection');
    if (level === 'Admin') {
        section.classList.remove('hidden');
    } else {
        section.classList.add('hidden');
    }
};


// --- Member Edit Modal ---
window.openEditMemberModal = async (id) => {
    // Fetch fresh single member data to be safe, or find in currentMembers (which is page-limited)
    // Since we only display current page, finding in currentMembers is fine for basic data.
    // But for editing we might want latest.

    let member = currentMembers.find(m => m.id === id);
    if (!member) {
        // Fallback fetch if somehow not in list (unlikely unless external link)
        const { data } = await sbClient.from('profiles').select('*').eq('id', id).single();
        member = data;
    }
    if (!member) return;

    document.getElementById('editMemberId').value = member.id;
    document.getElementById('editUsername').value = member.username || '';
    document.getElementById('editFullName').value = member.full_name || '';
    document.getElementById('editUserLevel').value = member.user_level || 'Member';
    document.getElementById('editPoints').value = member.current_points || 0;
    document.getElementById('editXp').value = member.xp || 0;
    document.getElementById('editCoin').value = member.coin || 0;
    document.getElementById('editStatus').value = member.status || 'active';
    document.getElementById('editWhatsapp').value = member.whatsapp || '';
    document.getElementById('editDomicile').value = member.domicile || '';
    document.getElementById('editReferralCode').value = member.referral_code || '';
    document.getElementById('editReferredBy').value = member.referred_by || '';

    // Handle Admin Permissions
    const permSection = document.getElementById('adminPermissionSection');
    const roleCheckboxes = document.querySelectorAll('.perm-check');
    const superAdminCheck = document.getElementById('isSuperAdmin');

    // Reset checks
    roleCheckboxes.forEach(cb => cb.checked = false);
    superAdminCheck.checked = false;

    // Check level for Host restrictions in modal
    const { data: { user } } = await sbClient.auth.getUser();
    const { data: profile } = await sbClient.from('profiles').select('user_level').eq('id', user.id).single();
    const isHost = profile?.user_level === 'Host';

    if (member.user_level === 'Admin') {
        permSection.classList.remove('hidden');
        try {
            const { data, error } = await sbClient
                .from('admin_permissions')
                .select('*')
                .eq('user_id', id)
                .maybeSingle();

            if (data) {
                const perms = data.permissions || [];
                roleCheckboxes.forEach(cb => {
                    if (perms.includes(cb.value)) cb.checked = true;
                });
                superAdminCheck.checked = data.is_super_admin || false;
            }
        } catch (err) {
            logger.error('Error fetching perms:', err);
        }
    } else {
        permSection.classList.add('hidden');
    }

    // Modal Action restrictions for Host
    if (isHost) {
        document.getElementById('saveMemberBtn')?.classList.add('hidden');
        document.getElementById('deleteMemberBtn')?.classList.add('hidden');
        document.getElementById('btnManualConfirm')?.classList.add('hidden');
    } else {
        document.getElementById('saveMemberBtn')?.classList.remove('hidden');
        document.getElementById('deleteMemberBtn')?.classList.remove('hidden');
        // btnManualConfirm handles its own visibility based on confirmed_at, but we should hide if Host
    }

    const confirmSection = document.getElementById('emailConfirmSection');
    const statusText = document.getElementById('editEmailStatusText');
    const btnManual = document.getElementById('btnManualConfirm');

    if (member.confirmed_at) {
        confirmSection.classList.remove('bg-yellow-50', 'border-yellow-200');
        confirmSection.classList.add('bg-green-50', 'border-green-200');
        statusText.innerHTML = `<span class="text-green-600 font-bold">Confirmed: ${new Date(member.confirmed_at).toLocaleString()}</span>`;
        btnManual.classList.add('hidden');
    } else {
        confirmSection.classList.add('bg-yellow-50', 'border-yellow-200');
        confirmSection.classList.remove('bg-green-50', 'border-green-200');
        statusText.innerText = "Email not confirmed.";
        btnManual.classList.remove('hidden');
    }

    document.getElementById('editMemberModal').classList.remove('hidden');
    document.getElementById('editMemberModal').classList.add('flex');
};

window.closeEditMemberModal = () => {
    document.getElementById('editMemberModal').classList.add('hidden');
    document.getElementById('editMemberModal').classList.remove('flex');
};

window.saveMemberChanges = async () => {
    const id = document.getElementById('editMemberId').value;
    const btnSave = document.querySelector('#editMemberModal button[onclick="saveMemberChanges()"]'); // Assuming there's a button calling this
    // Fallback if selector is fragile: just use global notification

    // We can also disable controls
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span> Saving...';
    }
    window.showNotification('Saving changes... ⏳', 'info');

    const updateData = {
        username: document.getElementById('editUsername').value,
        full_name: document.getElementById('editFullName').value,
        user_level: document.getElementById('editUserLevel').value,
        current_points: parseInt(document.getElementById('editPoints').value),
        xp: parseInt(document.getElementById('editXp').value),
        coin: parseInt(document.getElementById('editCoin').value),
        status: document.getElementById('editStatus').value,
        whatsapp: document.getElementById('editWhatsapp').value,
        domicile: document.getElementById('editDomicile').value,
        referred_by: document.getElementById('editReferredBy').value || null
    };

    if (/[<>]/.test(updateData.full_name)) {
        window.showNotification('Invalid name format', 'error');
        if (btnSave) { btnSave.disabled = false; btnSave.innerHTML = 'Save Changes'; }
        return;
    }

    const whatsappRegex = /^[0-9+\s-]*$/;
    if (!whatsappRegex.test(updateData.whatsapp)) {
        window.showNotification('Invalid WhatsApp number', 'error');
        if (btnSave) { btnSave.disabled = false; btnSave.innerHTML = 'Save Changes'; }
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminUpdateMember',
                target_user_id: id,
                updates: updateData
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        if (updateData.user_level === 'Admin') {
            const roleCheckboxes = document.querySelectorAll('.perm-check');
            const superAdminCheck = document.getElementById('isSuperAdmin');
            const perms = Array.from(roleCheckboxes)
                .filter(cb => cb.checked)
                .map(cb => cb.value);

            const permData = {
                user_id: id,
                permissions: perms,
                is_super_admin: superAdminCheck.checked,
                updated_at: new Date().toISOString()
            };

            const { error: permError } = await sbClient.functions.invoke('jdk-secure-handler', {
                body: {
                    action: 'adminUpsertPermissions',
                    target_user_id: id,
                    permissions: perms,
                    is_super_admin: superAdminCheck.checked
                }
            });

            if (permError) window.showNotification('Member saved but permissions failed: ' + permError.message, 'warning');
        }

        window.showNotification('Member updated successfully!', 'success');
        window.closeEditMemberModal();
        loadAllMembers(currentPage); // Reload current page
    } catch (err) {
        logger.error('Error updating member:', err);
        window.showNotification('Failed to update: ' + err.message, 'error');
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = 'Save Changes';
        }
    }
};


window.manualConfirmEmail = async () => {
    const id = document.getElementById('editMemberId').value;
    if (!confirm('Manually confirm email?')) return;

    window.showNotification('Confirming email... ⏳', 'info');
    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminConfirmEmail',
                target_user_id: id
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        window.showNotification('Email confirmed!', 'success');
        window.closeEditMemberModal();
        loadAllMembers(currentPage);
    } catch (err) {
        window.showNotification('Failed: ' + err.message, 'error');
    }
};

window.handleDeleteFromModal = async () => {
    const id = document.getElementById('editMemberId').value;
    const name = document.getElementById('editUsername').value;
    if (!confirm(`Permanently delete user "${name}"? This cannot be undone.`)) return;

    window.showNotification('Deleting user... ⏳', 'info');
    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminDeleteUser',
                target_user_id: id
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        window.showNotification('User deleted.', 'success');
        window.closeEditMemberModal();
        loadAllMembers(currentPage);
    } catch (err) {
        window.showNotification('Failed delete: ' + err.message, 'error');
    }
};

// --- Balance Management ---
window.openBalanceModal = (id, type) => {
    const member = currentMembers.find(m => m.id === id); // Works if in current page
    if (!member) return;

    document.getElementById('cm_userId').value = id;
    document.getElementById('cm_type').value = type;
    document.getElementById('cm_avatar').src = member.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${member.username}`;
    document.getElementById('cm_username').textContent = member.username;

    const isPoints = type === 'points';
    document.getElementById('bm_badge').textContent = isPoints ? 'Current Points' : 'Current Coins';
    document.getElementById('bm_title').textContent = isPoints ? 'Manage Points' : 'Manage Coins';
    document.getElementById('cm_currentCoin').textContent = (isPoints ? member.current_points : member.coin || 0).toLocaleString();

    document.getElementById('cm_date').textContent = new Date().toLocaleString();

    document.getElementById('coinModal').classList.remove('hidden');
    document.getElementById('coinModal').classList.add('flex');
};

window.closeCoinModal = () => {
    document.getElementById('coinModal').classList.add('hidden');
    document.getElementById('coinModal').classList.remove('flex');
};

window.updateBalance = async (action) => {
    const id = document.getElementById('cm_userId').value;
    const type = document.getElementById('cm_type').value;
    let amount = parseInt(document.getElementById('cm_amount').value) || 0;
    const desc = document.getElementById('cm_description').value || 'Admin Adjustment';

    if (amount <= 0) return window.showNotification('Invalid amount', 'error');
    if (action === 'subtract') amount = -amount;

    window.showNotification('Updating balance... ⏳', 'info');
    document.getElementById('coinModal').style.pointerEvents = 'none'; // Lock modal

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminAdjustBalance',
                target_user_id: id,
                balance_type: type,
                amount: amount,
                description: desc
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        window.showNotification(`Balance updated! ${data.previous_balance} → ${data.new_balance}`, 'success');
        window.closeCoinModal();
        loadAllMembers(currentPage);
    } catch (err) {
        window.showNotification('Update failed: ' + err.message, 'error');
    } finally {
        document.getElementById('coinModal').style.pointerEvents = 'auto'; // Unlock modal
    }
};

// View Transaction History from Balance Modal
window.viewHistoryFromModal = async () => {
    const userId = document.getElementById('cm_userId').value;
    const type = document.getElementById('cm_type').value;
    const member = currentMembers.find(m => m.id === userId);

    await viewTransactionHistory(userId, member?.username || 'User', type);
};

// View Point History directly (for use from table, etc.)
window.viewPointHistory = async (userId, username) => {
    await viewTransactionHistory(userId, username, 'points');
};

// Generic function to view any transaction history
async function viewTransactionHistory(userId, username, type = 'points') {
    const table = type === 'points' ? 'point_transactions' : (type === 'xp' ? 'xp_transactions' : 'coin_transactions');
    const label = type === 'points' ? 'Points' : (type === 'xp' ? 'XP' : 'Coin');

    document.getElementById('historyUsername').textContent = `${username} - ${label} History`;

    const { data, error } = await sbClient
        .from(table)
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

    const tbody = document.getElementById('historyTableBody');

    if (error || !data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">No transactions found</td></tr>';
    } else {
        tbody.innerHTML = data.map(t => `
            <tr class="border-b border-gray-100 bg-white">
                <td class="p-2 text-xs font-mono text-slate-500">${new Date(t.created_at).toLocaleString()}</td>
                <td class="p-2 font-bold ${t.amount >= 0 ? 'text-green-600' : 'text-red-600'}">
                    ${t.amount >= 0 ? '+' : ''}${t.amount.toLocaleString()}
                </td>
                <td class="p-2 text-sm text-slate-700">${escapeHTML(t.description || '-')}</td>
                <td class="p-2 text-xs text-slate-400 uppercase">${t.type || '-'}</td>
            </tr>
        `).join('');
    }

    document.getElementById('historyModal').classList.remove('hidden');
    document.getElementById('historyModal').classList.add('flex');
}

window.closeHistoryModal = () => {
    document.getElementById('historyModal').classList.add('hidden');
    document.getElementById('historyModal').classList.remove('flex');
};

async function loadSystemSettings() {
    try {
        const { data, error } = await sbClient
            .from('system_settings')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

        if (error) throw error;

        if (data) {
            const setVal = (id, val, def) => {
                const el = document.getElementById(id);
                if (el) el.value = (val !== undefined && val !== null) ? val : def;
            };

            setVal('settingXpPerLogin', data.xp_per_login, 0);
            setVal('settingPointsPerLogin', data.points_per_login, 0);
            setVal('settingReferrerReward', data.referrer_reward, 0);
            setVal('settingRefereeReward', data.referee_reward, 0);
            setVal('settingMinUploadXp', data.min_upload_xp, 200);
            setVal('settingMinRekberXp', data.min_rekber_xp, 200);
            setVal('settingMinStickerLevel', data.min_sticker_level, 2);
            setVal('settingRadioPointCost', data.radio_point_cost, 500);
            setVal('settingRadioRateLimit', data.radio_rate_limit_minutes, 30);

            // Boolean toggle
            const autoApproveEl = document.getElementById('settingAutoApprove');
            if (autoApproveEl) autoApproveEl.checked = !!data.auto_approve_products;

            if (data.double_xp_start) document.getElementById('settingDoubleXpStart').value = data.double_xp_start.slice(0, 16);
            if (data.double_xp_end) document.getElementById('settingDoubleXpEnd').value = data.double_xp_end.slice(0, 16);
            if (data.double_points_start) document.getElementById('settingDoublePointsStart').value = data.double_points_start.slice(0, 16);
            if (data.double_points_end) document.getElementById('settingDoublePointsEnd').value = data.double_points_end.slice(0, 16);
        }
    } catch (err) {
        logger.error('Error loading settings:', err);
    }
}

window.saveSystemSettings = async () => {
    try {
        const getVal = (id, def) => {
            const el = document.getElementById(id);
            if (!el) return def;
            return parseInt(el.value) || def;
        };

        const settings = {
            xp_per_login: getVal('settingXpPerLogin', 0),
            points_per_login: getVal('settingPointsPerLogin', 0),
            referrer_reward: getVal('settingReferrerReward', 0),
            referee_reward: getVal('settingRefereeReward', 0),
            min_upload_xp: getVal('settingMinUploadXp', 200),
            min_rekber_xp: getVal('settingMinRekberXp', 200),
            min_sticker_level: getVal('settingMinStickerLevel', 2),
            radio_point_cost: getVal('settingRadioPointCost', 500),
            radio_rate_limit_minutes: getVal('settingRadioRateLimit', 30),
            double_xp_start: document.getElementById('settingDoubleXpStart').value || null,
            double_xp_end: document.getElementById('settingDoubleXpEnd').value || null,
            double_points_start: document.getElementById('settingDoublePointsStart').value || null,
            double_points_end: document.getElementById('settingDoublePointsEnd').value || null,
            auto_approve_products: document.getElementById('settingAutoApprove')?.checked || false
        };

        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageSystemSettings',
                settings: settings
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        window.showNotification('✅ System settings saved!', 'success');
        refreshPromoBadges();
    } catch (err) {
        window.showNotification('Failed to save settings: ' + err.message, 'error');
    }
};

// --- Ranks & Levels Helpers (Simplified for cleanliness) ---
window.showRanksSection = () => {
    document.getElementById('ranksSection').classList.remove('hidden');
    loadRanks();
};

window.hideRanksSection = () => {
    document.getElementById('ranksSection').classList.add('hidden');
};

window.showLevelsSection = () => {
    document.getElementById('levelsSection').classList.remove('hidden');
    loadLevels();
};

window.hideLevelsSection = () => {
    document.getElementById('levelsSection').classList.add('hidden');
};

async function loadLevels() {
    // Basic load implementation, similar to previous but cleaner rows
    try {
        const { data, error } = await sbClient.from('level_configs').select('*').order('level', { ascending: true });
        if (error) throw error;

        currentLevelConfigs = data || [];
        const tbody = document.getElementById('levelsTableBody');
        if (!tbody) return;

        if (currentLevelConfigs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">No levels configured.</td></tr>';
            return;
        }

        tbody.innerHTML = currentLevelConfigs.map(lv => `
            <tr class="border-b border-slate-100 hover:bg-slate-50">
                <td class="p-2 text-center font-mono">${lv.level}</td>
                <td class="p-2 text-sm">Target XP: ${lv.min_xp}</td>
                <td class="p-2">
                    <input type="number" data-level="${lv.level}" value="${lv.min_xp}" class="level-input w-full border border-slate-300 rounded p-1 text-sm">
                </td>
                <td class="p-2 text-center text-red-500 cursor-pointer" onclick="deleteLevelConfig(${lv.level})">Delete</td>
            </tr>
        `).join('');
    } catch (err) {
        logger.error(err);
    }
}
// Placeholder for other level functions (save, auto-scale) - kept simple for this update
window.saveAllLevels = async () => {
    // ... implementation similar to before but targeting .level-input
    const inputs = document.querySelectorAll('.level-input');
    const updates = Array.from(inputs).map(inp => ({
        level: parseInt(inp.dataset.level),
        min_xp: parseInt(inp.value)
    }));

    // Upsert logic converted to Edge Function
    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'adminManageLevels', sub_action: 'update_all', data: updates }
        });
        if (fnError) throw fnError;

        if (res && res.success) {
            window.showNotification('Levels saved', 'success');
        } else {
            throw new Error(res?.error || 'Save failed');
        }
    } catch (e) {
        window.showNotification(e.message, 'error');
    }

};

window.deleteLevelConfig = async (lvl) => {
    if (confirm('Delete level ' + lvl)) {
        try {
            const { data: res, error } = await sbClient.functions.invoke('jdk-secure-handler', {
                body: { action: 'adminManageLevels', sub_action: 'delete', data: { level: lvl } }
            });
            if (error) throw error;
            if (!res.success) throw new Error(res.error || 'Delete failed');
            loadLevels();
        } catch (e) {
            window.showNotification('Delete failed: ' + e.message, 'error');
        }
    }
};

async function loadRanks() {
    const { data } = await sbClient.from('ranks').select('*').order('min_level');
    adminRanks = data || [];
    const tbody = document.getElementById('ranksTableBody');
    if (!tbody) return;

    tbody.innerHTML = adminRanks.map(r => `
        <tr class="border-b border-slate-100">
            <td class="p-3 text-xs uppercase font-bold text-slate-500">${r.rank_type || '-'}</td>
            <td class="p-3 font-bold text-slate-700" style="color:${r.color}">${r.name}</td>
            <td class="p-3 text-sm">${r.min_level}</td>
            <td class="p-3 text-sm font-mono">${r.min_xp}</td>
            <td class="p-3"><img src="${r.badge_url}" class="w-6 h-6"></td>
            <td class="p-3">
                <button class="text-xs text-blue-600 hover:underline" onclick="window.showNotification('Edit feature pending in simplified view', 'info')">Edit</button>
            </td>
        </tr>
    `).join('');
}

// --- Broadcast Management ---
window.sendBroadcast = async () => {
    const title = document.getElementById('bc_title').value;
    const content = document.getElementById('bc_content').value;

    if (!title || !content) return window.showNotification('Please fill all fields', 'error');

    const { data: { user } } = await sbClient.auth.getUser();
    if (!confirm('Send broadcast to ALL users?')) return;


    try {
        // Send broadcast via Edge Function (SECURITY FIX)
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminBroadcast',
                title: title,
                content: content
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Failed to send broadcast');

        window.showNotification('Broadcast sent!', 'success');
        document.getElementById('bc_title').value = '';
        document.getElementById('bc_content').value = '';
        loadAdminBroadcasts();
    } catch (err) {
        window.showNotification('Error: ' + err.message, 'error');
    }
};

window.loadAdminBroadcasts = async () => {
    const tbody = document.getElementById('broadcastTableBody');
    const { data } = await sbClient.from('notifications').select('*').eq('type', 'broadcast').order('created_at', { ascending: false }).limit(20);

    if (!data || !data.length) {
        tbody.innerHTML = '<div class="text-center py-4 text-slate-400 text-sm">No recent broadcasts</div>';
        return;
    }

    tbody.innerHTML = data.map(b => `
        <div class="p-3 bg-white border border-slate-100 rounded-lg flex justify-between items-center group">
            <div>
                <div class="text-sm font-bold text-slate-700">${escapeHTML(b.title)}</div>
                <div class="text-xs text-slate-400">${new Date(b.created_at).toLocaleDateString()}</div>
            </div>
            <button onclick="deleteBroadcast('${b.id}')" class="text-slate-300 hover:text-red-500 transition-colors">
                <span class="material-symbols-outlined text-sm">delete</span>
            </button>
        </div>
    `).join('');
};

window.deleteBroadcast = async (id) => {
    if (!confirm('Delete this broadcast?')) return;
    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'adminDeleteBroadcast', notification_id: id }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Failed to delete');

        window.showNotification('Broadcast deleted', 'success');
        loadAdminBroadcasts();
    } catch (err) {
        window.showNotification('Error: ' + err.message, 'error');
    }
};
