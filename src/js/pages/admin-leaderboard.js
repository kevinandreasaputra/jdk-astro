import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';
import { fetchLeaderboardStandings } from '../modules/leaderboard.js';

let allConfigs = [];
let allGames = [];
let currentPreviewConfigId = null;


export async function initializeAdminLeaderboard() {
    logger.log('🏆 Leaderboard Admin Initializing (SPA Mode)...');
    try {
        await initializeAdminLayout();
        logger.log('✅ Layout Initialized');

        await loadLeaderboardList();
        await loadGames();

        // Search listener
        const searchInput = document.getElementById('searchLeaderboard');
        if (searchInput) {
            searchInput.addEventListener('input', filterLeaderboards);
            logger.log('🔍 Search Listener Attached');
        }
    } catch (err) {
        logger.error('❌ Critical Init Error:', err);
        showNotification('Fatal Error: ' + err.message, 'error');
    }
}

document.addEventListener('DOMContentLoaded', initializeAdminLeaderboard);

// --- CORE FUNCTIONS ---

async function loadLeaderboardList() {
    logger.log('📡 Fetching leaderboards...');
    try {
        const { data, error } = await sbClient
            .from('leaderboard_settings')
            .select('*');

        if (error) throw error;

        allConfigs = data || [];
        logger.log(`📦 Loaded ${allConfigs.length} configs`);
        renderList();
    } catch (err) {
        logger.error('❌ Data Load Error:', err);
        showNotification('Gagal memuat data: ' + err.message, 'error');

        // Clear loading state
        const tbody = document.getElementById('lbTableBody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-comic-red font-bold">Error: ${err.message}</td></tr>`;
    }
}

async function loadGames() {
    try {
        const { data, error } = await sbClient.from('games').select('id, name').order('name');
        if (error) throw error;
        allGames = data || [];

        const gameSelect = document.getElementById('lb_game_id');
        const scoreGameSelect = document.getElementById('rs_game_id');
        const gameOptions = '<option value="">-- PILIH GAME --</option>' +
            allGames.map(g => `<option value="${g.id}">${g.name}</option>`).join('');

        if (gameSelect) gameSelect.innerHTML = gameOptions;
        if (scoreGameSelect) scoreGameSelect.innerHTML = gameOptions;
    } catch (err) {
        logger.error('Error loading games:', err);
    }
}

function renderList() {
    logger.log('🎨 Rendering list...');
    const tbody = document.getElementById('lbTableBody');
    const cardView = document.getElementById('lbCardView');

    if (!tbody || !cardView) return;

    if (allConfigs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-500 font-body">Belum ada leaderboard.</td></tr>';
        cardView.innerHTML = '<div class="text-center py-8 text-slate-500 font-body">Belum ada leaderboard.</div>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Desktop Table View
    tbody.innerHTML = allConfigs.map(config => {
        const isActive = config.is_active;
        const endDate = config.end_date ? new Date(config.end_date) : null;
        if (endDate) endDate.setHours(23, 59, 59, 999);
        const isExpired = endDate && endDate < today;

        const rowClass = isExpired
            ? 'bg-slate-50 opacity-60'
            : 'hover:bg-slate-50 transition-colors';

        const statusLabel = isActive ? 'ACTIVE' : 'INACTIVE';
        const badgeClass = isActive
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-slate-200 text-slate-600';

        const expiryBadge = isExpired ? '<span class="ml-2 px-1.5 py-0.5 rounded text-[8px] font-bold bg-rose-100 text-rose-600 uppercase tracking-tighter">EXPIRED</span>' : '';

        const metricDisplay = config.metric_type === 'GAME_SCORE'
            ? `SCORE: ${allGames.find(g => g.id === config.game_id)?.name || 'Game'}`
            : config.metric_type;

        const dateRange = `${config.start_date || '∞'} s/d ${config.end_date || '∞'}`;

        return `
            <tr class="${rowClass} border-b border-slate-100">
                <td class="px-6 py-4">
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}">
                        ${statusLabel}
                    </span>
                </td>
                <td class="px-6 py-4">
                    <div class="flex flex-col">
                        <span class="font-bold text-slate-800 text-sm line-clamp-1 truncate">${config.title}</span>
                        <div class="flex items-center gap-1">${expiryBadge}</div>
                    </div>
                </td>
                <td class="px-6 py-4 font-body">
                    <span class="bg-slate-100 px-2 py-1 rounded text-[11px] font-bold text-slate-600 uppercase tracking-tight">${metricDisplay}</span>
                </td>
                <td class="px-6 py-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                    ${dateRange}
                </td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-1 justify-center" onclick="event.stopPropagation()">
                        <button onclick="openPreviewModal('${config.id}')" 
                            class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Preview">
                            <span class="material-symbols-outlined text-[20px]">manage_search</span>
                        </button>
                        <button onclick="openModal('${config.id}')" 
                            class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                            <span class="material-symbols-outlined text-[20px]">edit</span>
                        </button>
                        <button onclick="deleteLeaderboard('${config.id}')" 
                            class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Delete">
                            <span class="material-symbols-outlined text-[20px]">delete</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Mobile Card View
    cardView.innerHTML = allConfigs.map(config => {
        const isActive = config.is_active;
        const endDate = config.end_date ? new Date(config.end_date) : null;
        if (endDate) endDate.setHours(23, 59, 59, 999);
        const isExpired = endDate && endDate < today;

        const statusLabel = isActive ? 'ACTIVE' : 'INACTIVE';
        const badgeClass = isActive
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-slate-200 text-slate-600';

        return `
            <div class="bg-white rounded-2xl overflow-hidden shadow-sm mb-4 ${isExpired ? 'opacity-70 grayscale' : ''}">
                <div class="p-5">
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex flex-col gap-1.5">
                            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit ${badgeClass}">
                                ${statusLabel}
                            </span>
                            <div class="text-[12px] font-bold text-slate-400 flex items-center gap-1">
                                <span class="material-symbols-outlined text-sm">calendar_month</span>
                                ${config.start_date || '∞'} - ${config.end_date || '∞'}
                            </div>
                        </div>
                        ${isExpired ? '<span class="px-1.5 py-0.5 rounded text-[8px] font-bold bg-rose-100 text-rose-600 uppercase tracking-tighter">EXPIRED</span>' : ''}
                    </div>

                    <h4 class="text-base font-bold text-slate-800 leading-tight mb-4">${config.title}</h4>
                    
                    <div class="flex items-center gap-2 text-xs text-slate-500 mb-5">
                        <span class="material-symbols-outlined text-sm text-slate-400">monitoring</span>
                        <span class="font-bold text-slate-600 uppercase tracking-tight">${config.metric_type}</span>
                    </div>

                    <div class="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-50">
                        <button onclick="openPreviewModal('${config.id}')" 
                            class="flex items-center justify-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-700 py-3 rounded-xl text-xs font-bold transition-colors">
                            <span class="material-symbols-outlined text-[18px]">manage_search</span> PREVIEW
                        </button>
                        <button onclick="openModal('${config.id}')" 
                            class="flex items-center justify-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 py-3 rounded-xl text-xs font-bold transition-colors">
                            <span class="material-symbols-outlined text-[18px]">edit</span> EDIT
                        </button>
                        <button onclick="deleteLeaderboard('${config.id}')" 
                            class="flex items-center justify-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-700 py-3 rounded-xl text-xs font-bold transition-colors">
                            <span class="material-symbols-outlined text-[18px]">delete</span> DEL
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    logger.log('✅ Render Complete');
}

window.toggleGameSelector = function () {
    const metric = document.getElementById('lb_metric').value;
    const container = document.getElementById('gameSelectorContainer');
    if (metric === 'GAME_SCORE') {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
};

function filterLeaderboards() {
    const query = document.getElementById('searchLeaderboard').value.toLowerCase();

    // Filter Table Rows
    const rows = document.querySelectorAll('#lbTableBody tr');
    rows.forEach(row => {
        if (row.cells.length < 2) return; // Skip "Empty" message
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });

    // Filter Mobile Cards
    const cards = document.querySelectorAll('#lbCardView > div');
    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(query) ? '' : 'none';
    });
}

// --- MODAL & ACTION FUNCTIONS (WINDOW EXPOSED) ---

window.openModal = async function (id = null) {
    const modal = document.getElementById('lbModal');
    const title = document.getElementById('modalTitle');

    if (!modal) return;

    if (id) {
        title.innerText = 'EDIT LEADERBOARD';
        const config = allConfigs.find(c => c.id === id);
        if (config) {
            document.getElementById('editLbId').value = config.id;
            document.getElementById('lb_title').value = config.title;
            document.getElementById('lb_metric').value = config.metric_type;
            document.getElementById('lb_start').value = config.start_date || '';
            document.getElementById('lb_end').value = config.end_date || '';

            const gameSelector = document.getElementById('lb_game_id');
            if (gameSelector) gameSelector.value = config.game_id || '';
            toggleGameSelector();
        }
    } else {
        title.innerText = 'CREATE LEADERBOARD';
        document.getElementById('editLbId').value = '';
        document.getElementById('lb_title').value = '';
        document.getElementById('lb_metric').value = 'XP';
        document.getElementById('lb_start').value = new Date().toISOString().split('T')[0];
        document.getElementById('lb_end').value = '';

        const gameSelector = document.getElementById('lb_game_id');
        if (gameSelector) gameSelector.value = '';
        toggleGameSelector();
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeModal = function () {
    const modal = document.getElementById('lbModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.saveLeaderboardSettings = async function () {
    const id = document.getElementById('editLbId').value;
    const title = document.getElementById('lb_title').value.trim();
    const metric = document.getElementById('lb_metric').value;
    const start = document.getElementById('lb_start').value;
    const end = document.getElementById('lb_end').value;
    const gameId = document.getElementById('lb_game_id').value;

    if (!title) {
        showNotification('Judul wajib diisi!', 'warning');
        return;
    }

    if (metric === 'GAME_SCORE' && !gameId) {
        showNotification('Silakan pilih game!', 'warning');
        return;
    }

    const data = {
        title,
        metric_type: metric,
        game_id: metric === 'GAME_SCORE' ? gameId : null,
        start_date: start || null,
        end_date: end || null,
        is_active: true,
        updated_at: new Date().toISOString()
    };

    try {
        let actionParams = { action: 'adminManageLeaderboards', data: data };
        if (id) {
            actionParams.sub_action = 'update';
            actionParams.id = id;
        } else {
            actionParams.sub_action = 'create';
        }

        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: actionParams
        });

        if (fnError) throw fnError;
        if (!res.success) throw new Error(res.error || 'Save failed');

        // Bypass old error check logic since we threw above
        let error = null;
        /* 
        Legacy code removed:
        if (id) { ... update ... } else { ... insert ... }
        */

        if (error) throw error;

        showNotification('✅ Berhasil disimpan!', 'success');
        closeModal();
        await loadLeaderboardList();
    } catch (err) {
        logger.error('Save error:', err);
        showNotification('Gagal menyimpan: ' + err.message, 'error');
    }
};

window.openPreviewModal = async function (id) {
    const config = allConfigs.find(c => c.id === id);
    if (!config) return;

    currentPreviewConfigId = id;

    document.getElementById('previewModalTitle').innerText = config.title;
    document.getElementById('previewModalSubtitle').innerText = `${config.metric_type} | ${config.start_date || '∞'} s/d ${config.end_date || '∞'}`;

    const contentContainer = document.getElementById('previewContent');
    contentContainer.innerHTML = '<div class="text-center py-20 text-gray-400 font-body animate-pulse">Menghitung klasemen...</div>';

    // Show/Hide Clear All button (disable for Lifetime XP)
    const clearBtn = document.getElementById('clearAllStandingsBtn');
    if (clearBtn) {
        if (config.metric_type === 'XP') {
            clearBtn.classList.add('hidden');
        } else {
            clearBtn.classList.remove('hidden');
        }
    }

    const modal = document.getElementById('previewModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    try {
        const standings = await fetchLeaderboardStandings(config);

        if (standings.length === 0) {
            contentContainer.innerHTML = '<div class="text-center py-20 text-gray-400 font-body">Tidak ada data untuk kompetisi ini.</div>';
            return;
        }

        contentContainer.innerHTML = standings.map((user, index) => `
            <div class="flex items-center gap-4 p-4 border-2 border-black rounded-xl bg-white shadow-hard-sm relative group">
                <div class="w-10 h-10 flex items-center justify-center font-comic text-xl ${index < 3 ? 'text-comic-orange' : 'text-gray-400'}">
                    ${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '#' + (index + 1)}
                </div>
                <img src="${user.avatar_url || '/images/avatar-default.png'}" class="w-10 h-10 rounded-full border-2 border-black object-cover bg-gray-100">
                <div class="flex-1 min-w-0">
                    <h4 class="font-bold font-body text-sm truncate uppercase text-left">${user.username}</h4>
                    <p class="text-[8px] text-gray-400 font-bold uppercase tracking-widest font-ui text-left">${user.user_level || 'Member'}</p>
                </div>
                <div class="text-right flex items-center gap-4">
                    <div>
                        <div class="text-xl font-comic text-comic-blue">${user.score.toLocaleString()}</div>
                        <div class="text-[8px] text-gray-400 font-bold uppercase font-ui">${user.unit}</div>
                    </div>
                    
                    ${config.metric_type !== 'XP' ? `
                        <button onclick="deleteStandingsUser('${user.id}')" 
                            class="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-sm border border-rose-100"
                            title="Hapus skor user ini">
                            <span class="material-symbols-outlined text-[18px]">person_remove</span>
                        </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
    } catch (err) {
        logger.error('Preview error:', err);
        contentContainer.innerHTML = `<div class="text-center py-20 text-comic-red font-bold font-body">Gagal memuat: ${err.message}</div>`;
    }
};

window.deleteStandingsUser = async function (userId) {
    const config = allConfigs.find(c => c.id === currentPreviewConfigId);
    if (!config) return;

    if (!confirm(`Hapus data klasemen user "${userId}" untuk leaderboard ini?\n\nTindakan ini akan menghapus log transaksi (XP/Points/Game) user tersebut dalam periode leaderboard ini.`)) return;

    showNotification('Sedang menghapus...', 'info');

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminDeleteLeaderboardData',
                deletion_type: 'SINGLE_USER',
                target_user_id: userId,
                start_date: config.start_date || '2000-01-01',
                end_date: config.end_date || '2099-12-31',
                metric_type: config.metric_type,
                game_id: config.game_id
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Server error');

        showNotification(`✅ User berhasil dihapus! (${data.count} riwayat dibersihkan)`, 'success');
        await openPreviewModal(currentPreviewConfigId);
    } catch (err) {
        logger.error('Delete User Error:', err);
        showNotification('Gagal: ' + err.message, 'error');
    }
};

window.clearStandingsAll = async function () {
    const config = allConfigs.find(c => c.id === currentPreviewConfigId);
    if (!config) return;

    const check = prompt(`PERINGATAN! Anda akan menghapus SELURUH data klasemen untuk "${config.title}".\n\nSemua skor dalam periode ini akan hilang.\n\nKetik "HAPUS SEMUA" untuk konfirmasi:`);
    if (check !== 'HAPUS SEMUA') return;

    showNotification('Sedang membersihkan...', 'info');

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminDeleteLeaderboardData',
                deletion_type: 'ALL_USERS',
                start_date: config.start_date || '2000-01-01',
                end_date: config.end_date || '2099-12-31',
                metric_type: config.metric_type,
                game_id: config.game_id
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Server error');

        showNotification(`✅ Berhasil! ${data.count} data dibersihkan.`, 'success');
        await openPreviewModal(currentPreviewConfigId);
    } catch (err) {
        logger.error('Clear All Error:', err);
        showNotification('Gagal: ' + err.message, 'error');
    }
};

function getTableMappings(type) {
    const tableMappings = [];
    if (type === 'PERIODIC_XP') tableMappings.push({ name: 'xp_transactions', col: 'created_at' });
    if (type === 'POINTS') tableMappings.push({ name: 'point_transactions', col: 'created_at' });
    if (type === 'GAME_SCORE') {
        tableMappings.push({ name: 'game_play_history', col: 'last_played_at' });
        tableMappings.push({ name: 'game_play_logs', col: 'played_at' });
    }
    if (type === 'EVENTS') tableMappings.push({ name: 'event_registrations', col: 'created_at' });
    if (type === 'LIKES') tableMappings.push({ name: 'user_likes', col: 'created_at' });
    return tableMappings;
}

window.closePreviewModal = function () {
    const modal = document.getElementById('previewModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.deleteLeaderboard = async function (id) {
    if (!confirm('Hapus leaderboard ini secara permanen?')) return;

    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'adminManageLeaderboards', sub_action: 'delete', id }
        });
        const error = fnError || (res && !res.success ? { message: res.error } : null);
        if (error) throw error;
        showNotification('🗑️ Terhapus!', 'success');
        await loadLeaderboardList();
    } catch (err) {
        showNotification('Gagal menghapus: ' + err.message, 'error');
    }
};

window.clearLeaderboardLogs = async function () {
    const start = document.getElementById('m_start_date').value;
    const end = document.getElementById('m_end_date').value;
    const type = document.getElementById('m_data_type').value;

    if (!start || !end) {
        showNotification('Silakan pilih rentang tanggal!', 'warning');
        return;
    }

    const confirmMsg = `PERINGATAN KRITIS!\n\nAnda akan menghapus data ${type} dari ${start} sampai ${end}.\n\nTindakan ini PERMANEN dan tidak bisa dibatalkan.\n\nKetik "HAPUS" untuk konfirmasi:`;
    const check = prompt(confirmMsg);

    if (check !== 'HAPUS') {
        showNotification('Penghapusan dibatalkan.', 'info');
        return;
    }

    showNotification('Sedang menghapus data... ⏳', 'info');

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminDeleteLeaderboardData',
                deletion_type: 'ALL_USERS',
                start_date: start,
                end_date: end,
                metric_type: type
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Server error');

        showNotification(`✅ Berhasil! ${data.count} baris data dihapus.`, 'success');

        // Refresh whatever is currently visible
        if (allConfigs && allConfigs.length > 0) {
            await loadLeaderboardList();
        }
    } catch (err) {
        logger.error('Final delete error:', err);
        showNotification('Kesalahan sistem: ' + err.message, 'error');
    }
};

// --- MANUAL SCORE RECORDING FUNCTIONS ---

window.openRecordScoreModal = function () {
    const modal = document.getElementById('recordScoreModal');
    if (!modal) return;

    // Reset fields
    document.getElementById('rs_user_search').value = '';
    document.getElementById('rs_score').value = '';
    document.getElementById('rs_game_id').value = '';
    clearSelectedUserForScore();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeRecordScoreModal = function () {
    const modal = document.getElementById('recordScoreModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

let userSearchTimeout = null;
window.searchUsersForScore = function () {
    const query = document.getElementById('rs_user_search').value.trim();
    const resultsArea = document.getElementById('rs_user_results');

    if (query.length < 2) {
        resultsArea.classList.add('hidden');
        return;
    }

    if (userSearchTimeout) clearTimeout(userSearchTimeout);

    userSearchTimeout = setTimeout(async () => {
        try {
            const { data, error } = await sbClient
                .from('profiles')
                .select('id, username, avatar_url, jdk_id')
                .or(`username.ilike.%${query}%,jdk_id.ilike.%${query}%`)
                .limit(5);

            if (error) throw error;

            if (data && data.length > 0) {
                resultsArea.innerHTML = data.map(user => `
                    <div onclick="selectUserForScore('${user.id}', '${user.username.replace(/'/g, "\\'")}', '${user.jdk_id}', '${user.avatar_url || ''}')" 
                        class="p-3 hover:bg-slate-50 cursor-pointer flex items-center gap-3 transition-colors">
                        <img src="${user.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.username}" class="w-8 h-8 rounded-full border border-slate-100 object-cover">
                        <div class="flex-1">
                            <div class="font-bold text-slate-800 text-xs">${user.username}</div>
                            <div class="text-[9px] text-slate-400 font-mono tracking-tighter">${user.jdk_id || '-'}</div>
                        </div>
                        <span class="material-symbols-outlined text-slate-300 text-sm">chevron_right</span>
                    </div>
                `).join('');
                resultsArea.classList.remove('hidden');
            } else {
                resultsArea.innerHTML = '<div class="p-4 text-center text-xs text-slate-400">User tidak ditemukan.</div>';
                resultsArea.classList.remove('hidden');
            }
        } catch (err) {
            logger.error('User search error:', err);
        }
    }, 400);
};

window.selectUserForScore = function (id, username, jdkId, avatar) {
    document.getElementById('rs_user_id').value = id;
    document.getElementById('rs_username').innerText = username;
    document.getElementById('rs_jdkid').innerText = jdkId || '-';
    document.getElementById('rs_avatar').src = avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + username;

    document.getElementById('rs_user_search').parentElement.classList.add('hidden');
    document.getElementById('rs_user_results').classList.add('hidden');
    document.getElementById('rs_selected_user').classList.remove('hidden');
};

window.clearSelectedUserForScore = function () {
    document.getElementById('rs_user_id').value = '';
    document.getElementById('rs_user_search').value = '';
    document.getElementById('rs_user_search').parentElement.classList.remove('hidden');
    document.getElementById('rs_selected_user').classList.add('hidden');
    document.getElementById('rs_user_results').classList.add('hidden');
};

window.saveManualScore = async function () {
    const userId = document.getElementById('rs_user_id').value;
    const gameId = document.getElementById('rs_game_id').value;
    const score = parseInt(document.getElementById('rs_score').value);
    const btn = document.getElementById('btnSaveManualScore');

    if (!userId) return showNotification('Pilih member terlebih dahulu!', 'warning');
    if (!gameId) return showNotification('Pilih game!', 'warning');
    if (isNaN(score)) return showNotification('Input skor yang valid!', 'warning');

    if (!confirm(`Konfirmasi simpan skor ${score.toLocaleString()} untuk user ini?`)) return;

    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> Menyimpan...';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminRecordScore',
                target_user_id: userId,
                game_id: gameId,
                score: score
            }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Server error');

        showNotification('✅ Skor berhasil dicatat!', 'success');
        closeRecordScoreModal();
    } catch (err) {
        logger.error('Manual score error:', err);
        showNotification('Gagal mencatat skor: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};
