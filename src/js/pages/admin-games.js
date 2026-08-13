import { logger } from '../core/logger.js';
/**
 * Admin Games Management Logic
 * JDK Entertainment
 */
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let allGames = [];


export async function initializeAdminGames() {
    await initializeAdminLayout();
    await loadGames();
}

document.addEventListener('DOMContentLoaded', initializeAdminGames);

async function loadGames() {
    const { data, error } = await sbClient
        .from('games')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        logger.error(error);
        showNotification('❌ Gagal memuat games', 'error');
        return;
    }

    allGames = data || [];

    // Fetch play statistics for each game
    await loadGameStats();

    renderGames();
}

// Fetch play stats from game_play_logs (single batch query instead of N+1)
async function loadGameStats() {
    const gameIds = allGames.map(g => g.id);
    if (gameIds.length === 0) return;

    const { data: logs, error } = await sbClient
        .from('game_play_logs')
        .select('game_id, user_id')
        .in('game_id', gameIds);

    if (error) {
        logger.error('Failed to load game stats:', error);
        allGames.forEach(g => { g.total_plays = 0; g.unique_players = 0; });
        return;
    }

    // Aggregate stats in JS
    const statsMap = {};
    for (const log of (logs || [])) {
        if (!statsMap[log.game_id]) {
            statsMap[log.game_id] = { plays: 0, users: new Set() };
        }
        statsMap[log.game_id].plays++;
        statsMap[log.game_id].users.add(log.user_id);
    }

    for (const game of allGames) {
        const stats = statsMap[game.id];
        game.total_plays = stats ? stats.plays : 0;
        game.unique_players = stats ? stats.users.size : 0;
    }
}

function renderGames() {
    const tbody = document.getElementById('gamesTableBody');
    if (!tbody) return;

    if (allGames.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="p-8 text-center text-slate-500 font-body">Belum ada game.</td></tr>';
        return;
    }

    tbody.innerHTML = allGames.map(game => {
        const isActive = game.is_active;
        const statusLabel = isActive ? 'ACTIVE' : 'INACTIVE';
        const badgeClass = isActive
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-slate-200 text-slate-600';

        const accessBadge = game.min_level == 0
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">FREE</span>'
            : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100">LVL ${game.min_level}</span>`;

        return `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
            <td class="p-4">
                <img src="${game.image_url || '/images/placeholder-game.png'}" class="w-12 h-12 object-cover rounded-lg border border-slate-200">
            </td>
            <td class="p-4">
                <div class="flex flex-col">
                    <span class="font-bold text-slate-800 text-sm line-clamp-1 truncate">${game.name}</span>
                    <span class="text-[10px] text-slate-400 font-medium">${game.category || '-'}</span>
                </div>
            </td>
            <td class="p-4 font-medium text-slate-600 text-xs">${game.creator_name || '-'}</td>
            <td class="p-4">
                <div class="flex flex-col gap-1">
                    <span class="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[14px]">stars</span> ${game.points_reward}
                    </span>
                    <span class="text-[11px] font-bold text-indigo-600 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[14px]">bolt</span> ${game.xp_reward}
                    </span>
                </div>
            </td>
            <td class="p-4">
                <div class="flex flex-col gap-1">
                    <span class="text-[11px] font-bold text-amber-600 flex items-center gap-1">
                        <span class="material-symbols-outlined text-[14px]">toll</span> ${game.coin_cost}
                    </span>
                    ${accessBadge}
                </div>
            </td>
            <td class="p-4 text-center">
                <div class="flex flex-col items-center">
                    <span class="text-sm font-black text-slate-800">${(game.total_plays || 0).toLocaleString()}</span>
                    <span class="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Plays</span>
                </div>
            </td>
            <td class="p-4 text-center">
                <div class="flex flex-col items-center">
                    <span class="text-sm font-black text-slate-800">${(game.unique_players || 0).toLocaleString()}</span>
                    <span class="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Players</span>
                </div>
            </td>
            <td class="p-4">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}">
                    ${statusLabel}
                </span>
            </td>
            <td class="p-4">
                <div class="flex items-center gap-1 justify-center" onclick="event.stopPropagation()">
                    <button onclick="editGame('${game.id}')" 
                        class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                        <span class="material-symbols-outlined text-[20px]">edit</span>
                    </button>
                    <button onclick="deleteGame('${game.id}')" 
                        class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Delete">
                        <span class="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                </div>
            </td>
        </tr>
    `}).join('');
}

window.openGameModal = function () {
    const form = document.querySelector('#gameModal form');
    if (form) form.reset();

    document.getElementById('gameId').value = '';
    document.getElementById('modalTitle').textContent = 'ADD NEW GAME';
    document.getElementById('gameName').value = '';
    document.getElementById('gameCreator').value = '';
    document.getElementById('gameCategory').value = '';
    document.getElementById('gameDescription').value = '';
    document.getElementById('gamePoints').value = 10;
    document.getElementById('gameXp').value = 10;
    document.getElementById('gameCoinCost').value = 0;
    document.getElementById('gameMinLevel').value = 0;
    document.getElementById('gameUrl').value = '';
    document.getElementById('gameImageUrl').value = '';
    document.getElementById('imagePreview').classList.add('hidden');
    document.getElementById('btnDeleteGame').classList.add('hidden');

    // Modal Visibility
    const modal = document.getElementById('gameModal');
    const content = modal.querySelector('div');
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
    if (content) {
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    }
};

window.editGame = function (id) {
    const game = allGames.find(g => g.id === id);
    if (!game) return;

    document.getElementById('gameId').value = game.id;
    document.getElementById('modalTitle').textContent = 'EDIT GAME';
    document.getElementById('gameName').value = game.name;
    document.getElementById('gameCreator').value = game.creator_name || '';
    document.getElementById('gameCategory').value = game.category || '';
    document.getElementById('gameDescription').value = game.description || '';
    document.getElementById('gamePoints').value = game.points_reward || 0;
    document.getElementById('gameXp').value = game.xp_reward || 0;
    document.getElementById('gameCoinCost').value = game.coin_cost || 0;
    document.getElementById('gameMinLevel').value = game.min_level || 0;
    document.getElementById('gameUrl').value = game.game_url || '';
    document.getElementById('gameImageUrl').value = game.image_url || '';
    document.getElementById('gameActive').checked = game.is_active;

    if (game.image_url) {
        const img = document.getElementById('imagePreview').querySelector('img');
        if (img) img.src = game.image_url;
        document.getElementById('imagePreview').classList.remove('hidden');
    }

    document.getElementById('btnDeleteGame').classList.remove('hidden');

    // Modal Visibility
    const modal = document.getElementById('gameModal');
    const content = modal.querySelector('div');
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
    if (content) {
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    }
};

window.closeGameModal = function () {
    const modal = document.getElementById('gameModal');
    const content = modal.querySelector('div');
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.classList.remove('opacity-100', 'pointer-events-auto');
    if (content) {
        content.classList.add('scale-95');
        content.classList.remove('scale-100');
    }
};

window.saveGame = async function () {
    const id = document.getElementById('gameId').value;
    const file = document.getElementById('gameImage').files[0];
    let imageUrl = document.getElementById('gameImageUrl').value;
    const btnSave = document.querySelector('#gameModal button[type="submit"]');

    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span> Saving...';
    }
    showNotification('Saving game... ⏳', 'info');

    try {
        if (file) {
            const fileName = `game_${Date.now()}_${file.name.replace(/\s+/g, '-')}`;
            const { data, error } = await sbClient.storage.from('game-assets').upload(fileName, file);
            if (error) throw new Error('Upload Failed: ' + error.message);

            const { data: publicData } = sbClient.storage.from('game-assets').getPublicUrl(fileName);
            imageUrl = publicData.publicUrl;
        }

        const gameData = {
            name: document.getElementById('gameName').value,
            creator_name: document.getElementById('gameCreator').value,
            category: document.getElementById('gameCategory').value,
            description: document.getElementById('gameDescription').value,
            points_reward: parseInt(document.getElementById('gamePoints').value) || 0,
            xp_reward: parseInt(document.getElementById('gameXp').value) || 0,
            coin_cost: parseInt(document.getElementById('gameCoinCost').value) || 0,
            min_level: parseInt(document.getElementById('gameMinLevel').value) || 0,
            game_url: document.getElementById('gameUrl').value,
            image_url: imageUrl,
            is_active: document.getElementById('gameActive').checked
        };

        let result;
        if (id) {
            result = await sbClient.functions.invoke('jdk-secure-handler', {
                body: { action: 'adminManageGames', sub_action: 'update', id, data: gameData }
            });
        } else {
            result = await sbClient.functions.invoke('jdk-secure-handler', {
                body: { action: 'adminManageGames', sub_action: 'create', data: gameData }
            });
        }

        // Normalize result for existing check (Edge Function returns { data: { success, ... }, error } structure from invoke, but our handler returns { success: true } inside data)
        // Wait, invoke returns { data, error }. 'data' contains the response JSON.
        // So result.data is the JSON.
        if (result.data && result.data.success) {
            result.error = null;
        } else {
            result.error = result.error || { message: result.data?.error || 'Unknown error' };
        }

        if (result.error) throw result.error;

        showNotification('✅ Game saved successfully!', 'success');
        window.closeGameModal();
        loadGames();

    } catch (err) {
        logger.error('Save game error:', err);
        showNotification('❌ Failed: ' + err.message, 'error');
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.textContent = 'Save Game';
        }
    }
};

window.handleDeleteFromModal = function () {
    const id = document.getElementById('gameId').value;
    if (!id) return;
    deleteGame(id);
};

window.deleteGame = async function (id) {
    if (!confirm('Delete this game? This action cannot be undone.')) return;

    showNotification('Deleting game... ⏳', 'info');
    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'adminManageGames', sub_action: 'delete', id }
        });
        const error = fnError || (res && !res.success ? { message: res.error } : null);
        if (error) throw error;

        showNotification('✅ Game deleted!', 'success');
        window.closeGameModal();
        loadGames();
    } catch (err) {
        showNotification('❌ Error: ' + err.message, 'error');
    }
};

window.handleLogout = async function () {
    await sbClient.auth.signOut();
    window.location.href = '/index.html';
};
