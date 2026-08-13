import { logger } from '../core/logger.js';
/**
 * JDK Radio - Admin DJ Booth Logic
 * Handles approval, rejection, and queue management
 */

import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { getCurrentUser } from '../modules/user-session.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let currentUser = null;
let currentTab = 'pending';
let rejectingRequestId = null;

/**
 * Initialize Admin Radio Page
 */
export async function initializeAdminRadioPage() {
    logger.log('🎧 Initializing DJ Booth...');

    // 1. Initialize Admin Layout (Sidebar & RBAC check)
    await initializeAdminLayout();

    currentUser = getCurrentUser();

    // Check admin access
    if (!currentUser) {
        showNotification('Login diperlukan!');
        setTimeout(() => window.location.href = '/index.html', 2000);
        return;
    }

    const { data: profile } = await sbClient
        .from('profiles')
        .select('user_level')
        .eq('id', currentUser.id)
        .single();

    const userLevel = (profile?.user_level || '').toLowerCase();
    if (!profile || !['admin', 'superadmin'].includes(userLevel)) {
        showNotification('Akses ditolak! Admin only.');
        setTimeout(() => window.location.href = '/index.html', 2000);
        return;
    }

    // Load initial data & set active tab styling
    await switchTab(currentTab);

    // Setup realtime
    setupRealtimeSubscription();

    logger.log('✅ DJ Booth ready!');
}

/**
 * Refresh all data
 */
window.refreshData = async function () {
    await updateStats();
    await loadRequests(currentTab);
}

/**
 * Switch between tabs
 */
window.switchTab = async function (tab) {
    currentTab = tab;

    // Update tab styles
    const tabs = ['pending', 'approved', 'history'];
    const activeClasses = ['bg-blue-600', 'text-white', 'shadow-sm'];
    const inactiveClasses = ['text-slate-600', 'hover:bg-slate-50'];

    tabs.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        if (!btn) return;

        if (t === tab) {
            btn.classList.add(...activeClasses);
            btn.classList.remove(...inactiveClasses);
        } else {
            btn.classList.remove(...activeClasses);
            btn.classList.add(...inactiveClasses);
        }
    });

    // Update table title
    const titles = {
        pending: 'Pending Requests',
        approved: 'Approved Queue',
        history: 'Request History'
    };
    document.getElementById('tableTitle').textContent = titles[tab] || 'Requests';

    await updateStats();
    await loadRequests(tab);
}

/**
 * Load requests based on tab
 */
async function loadRequests(tab) {
    const tbody = document.getElementById('requestsTableBody');
    tbody.innerHTML = `
        <tr>
            <td colspan="5" class="p-12 text-center text-slate-500 italic">
                <div class="flex flex-col items-center gap-3">
                    <span class="material-symbols-outlined text-4xl animate-spin text-blue-200">progress_activity</span>
                    <p>Loading requests...</p>
                </div>
            </td>
        </tr>
    `;

    try {
        let query = sbClient
            .from('music_queue')
            .select(`
                id,
                title,
                youtube_url,
                status,
                created_at,
                processed_at,
                admin_note,
                requested_by,
                profiles!requested_by(full_name)
            `)
            .order('created_at', { ascending: tab === 'pending' });

        if (tab === 'pending') {
            query = query.eq('status', 'pending');
        } else if (tab === 'approved') {
            query = query.eq('status', 'approved').eq('is_played', false);
        } else {
            // History: show played and rejected
            query = query.or('status.eq.played,status.eq.rejected,is_played.eq.true').limit(50);
        }

        const { data, error } = await query;

        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="p-12 text-center text-slate-400 italic">
                        <div class="flex flex-col items-center gap-2">
                            <span class="material-symbols-outlined text-3xl opacity-20">library_music</span>
                            <p>Tidak ada request lagu di kategori ini.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.map(req => renderRow(req, tab)).join('');

    } catch (err) {
        logger.error('Load requests error:', err);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="p-12 text-center text-rose-500 italic">
                    <div class="flex flex-col items-center gap-2">
                        <span class="material-symbols-outlined text-3xl">error</span>
                        <p>Error loading data: ${err.message}</p>
                    </div>
                </td>
            </tr>
        `;
    }
}

/**
 * Render table row
 */
function renderRow(req, tab) {
    const requesterName = req.profiles?.full_name || 'Unknown';
    const date = new Date(req.created_at).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });

    let actions = '';

    if (tab === 'pending') {
        actions = `
            <div class="flex items-center justify-center gap-2">
                <button onclick="approveRequest('${req.id}')"
                    class="p-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-lg transition-colors title='Setujui'">
                    <span class="material-symbols-outlined text-xl">check_circle</span>
                </button>
                <button onclick="openRejectModal('${req.id}')"
                    class="p-2 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-lg transition-colors title='Tolak'">
                    <span class="material-symbols-outlined text-xl">cancel</span>
                </button>
            </div>
        `;
    } else if (tab === 'approved') {
        actions = `
            <div class="flex items-center justify-center gap-3">
                <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                    <button onclick="moveSong('${req.id}', 'UP')"
                        class="p-1.5 hover:bg-white hover:text-blue-600 rounded transition-colors text-slate-400" title="Geser ke Atas">
                        <span class="material-symbols-outlined text-sm font-bold">arrow_upward</span>
                    </button>
                    <button onclick="moveSong('${req.id}', 'DOWN')"
                        class="p-1.5 hover:bg-white hover:text-blue-600 rounded transition-colors text-slate-400" title="Geser ke Bawah">
                        <span class="material-symbols-outlined text-sm font-bold">arrow_downward</span>
                    </button>
                </div>
                <button onclick="markAsPlayed('${req.id}')"
                    class="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm font-bold flex items-center gap-2 transition-all active:scale-95">
                    <span class="material-symbols-outlined text-sm">play_circle</span> Diputar
                </button>
                <button onclick="cancelApprovedRequest('${req.id}')"
                    class="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Batalkan & Refund">
                    <span class="material-symbols-outlined text-xl">delete</span>
                </button>
            </div>
        `;
    } else {
        const statusColors = {
            played: 'bg-blue-50 text-blue-600 border-blue-100',
            rejected: 'bg-rose-50 text-rose-600 border-rose-100'
        };
        const colorClass = statusColors[req.status] || 'bg-slate-50 text-slate-600 border-slate-100';
        actions = `
            <div class="flex items-center justify-center">
                <span class="px-2 py-1 ${colorClass} border rounded text-[10px] font-bold uppercase tracking-wider">
                    ${req.status}
                </span>
            </div>
        `;
    }

    return `
        <tr class="hover:bg-slate-50/80 transition-colors group">
            <td class="p-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-red-600 shrink-0">
                        <span class="material-symbols-outlined">play_circle</span>
                    </div>
                    <div class="overflow-hidden">
                        <div class="font-bold text-slate-800 truncate">${escapeHTML(req.title)}</div>
                        <div class="text-xs text-slate-500 truncate">${req.message ? '💬 ' + escapeHTML(req.message) : 'YouTube Song'}</div>
                    </div>
                </div>
            </td>
            <td class="p-4">
                <div class="flex items-center gap-2">
                    <span class="text-slate-700 font-medium">${escapeHTML(requesterName)}</span>
                </div>
            </td>
            <td class="p-4 text-xs font-mono text-slate-400">${date}</td>
            <td class="p-4">
                <a href="${req.youtube_url}" target="_blank" 
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-full text-[10px] font-bold transition-all">
                    <span class="material-symbols-outlined text-sm">open_in_new</span> PREVIEW
                </a>
            </td>
            <td class="p-4">
                ${actions}
            </td>
        </tr>
    `;
}

/**
 * Update stats in header
 */
async function updateStats() {
    try {
        const { count: pendingCount } = await sbClient
            .from('music_queue')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        const { count: approvedCount } = await sbClient
            .from('music_queue')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'approved');

        document.getElementById('pendingCount').textContent = `Pending: ${pendingCount || 0}`;
        document.getElementById('approvedCount').textContent = `Queue: ${approvedCount || 0}`;

    } catch (err) {
        logger.error('Update stats error:', err);
    }
}

/**
 * Approve a request
 */
window.approveRequest = async function (requestId) {
    if (!confirm('Approve lagu ini?')) return;

    try {
        const { data: session } = await sbClient.auth.getSession();

        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jdk-secure-handler`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.session.access_token}`
            },
            body: JSON.stringify({
                action: 'adminRadioAction',
                sub_action: 'approve',
                request_id: requestId
            })
        });

        const result = await response.json();

        if (result.success) {
            showNotification('✅ Lagu disetujui!');
            await refreshData();
        } else {
            showNotification('❌ ' + (result.error || 'Gagal approve'));
        }

    } catch (err) {
        logger.error('Approve error:', err);
        showNotification('❌ Error: ' + err.message);
    }
}

/**
 * Open reject modal
 */
window.openRejectModal = function (requestId) {
    rejectingRequestId = requestId;
    document.getElementById('rejectReason').value = '';
    document.getElementById('rejectModal').classList.remove('hidden');
}

/**
 * Close reject modal
 */
window.closeRejectModal = function () {
    rejectingRequestId = null;
    document.getElementById('rejectModal').classList.add('hidden');
}

/**
 * Confirm rejection
 */
window.confirmReject = async function () {
    if (!rejectingRequestId) return;

    const reason = document.getElementById('rejectReason').value.trim() || 'Tidak sesuai kriteria';

    try {
        const { data: session } = await sbClient.auth.getSession();

        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jdk-secure-handler`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.session.access_token}`
            },
            body: JSON.stringify({
                action: 'adminRadioAction',
                sub_action: 'reject',
                request_id: rejectingRequestId,
                reason: reason
            })
        });

        const result = await response.json();

        if (result.success) {
            showNotification('❌ Lagu ditolak, poin dikembalikan');
            closeRejectModal();
            await refreshData();
        } else {
            showNotification('❌ ' + (result.error || 'Gagal reject'));
        }

    } catch (err) {
        logger.error('Reject error:', err);
        showNotification('❌ Error: ' + err.message);
    }
}

/**
 * Mark song as played
 */
window.markAsPlayed = async function (requestId) {
    try {
        const { data: session } = await sbClient.auth.getSession();

        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jdk-secure-handler`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.session.access_token}`
            },
            body: JSON.stringify({
                action: 'adminRadioAction',
                sub_action: 'markPlayed',
                request_id: requestId
            })
        });

        const result = await response.json();

        if (result.success) {
            showNotification('▶️ Lagu ditandai sudah diputar');
            await refreshData();
        } else {
            showNotification('❌ ' + (result.error || 'Gagal'));
        }

    } catch (err) {
        logger.error('Mark played error:', err);
        showNotification('❌ Error: ' + err.message);
    }
}

/**
 * Setup realtime updates
 */
function setupRealtimeSubscription() {
    sbClient
        .channel('admin-radio-updates')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'music_queue'
        }, () => {
            refreshData();
        })
        .subscribe();
}

/**
 * Reorder Song in Queue
 */
window.moveSong = async function (requestId, direction) {
    try {
        const { data: session } = await sbClient.auth.getSession();
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jdk-secure-handler`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.session.access_token}`
            },
            body: JSON.stringify({
                action: 'adminRadioAction',
                sub_action: 'reorder',
                request_id: requestId,
                direction: direction
            })
        });

        const result = await response.json();
        if (result.success) {
            await refreshData();
        } else {
            showNotification('❌ ' + (result.error || 'Gagal ganti urutan'), 'info');
        }
    } catch (err) {
        logger.error('Reorder error:', err);
    }
}

/**
 * Cancel Approved Song (Refund)
 */
window.cancelApprovedRequest = async function (requestId) {
    if (!confirm('Batalkan lagu ini? Poin user akan langsung dikembalikan.')) return;

    try {
        const { data: session } = await sbClient.auth.getSession();
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jdk-secure-handler`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.session.access_token}`
            },
            body: JSON.stringify({
                action: 'adminRadioAction',
                sub_action: 'cancelApproved',
                request_id: requestId
            })
        });

        const result = await response.json();
        if (result.success) {
            showNotification('🗑️ Lagu dibatalkan & Poin direfund');
            await refreshData();
        } else {
            showNotification('❌ ' + (result.error || 'Gagal membatalkan'), 'error');
        }
    } catch (err) {
        logger.error('Cancel approved error:', err);
        showNotification('❌ Gagal membatalkan lagu');
    }
}

/**
 * Escape HTML
 */
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

// Auto-initialize (removed to prevent race condition with main.js)
// initializeAdminRadioPage is now called by main.js after session is ready
