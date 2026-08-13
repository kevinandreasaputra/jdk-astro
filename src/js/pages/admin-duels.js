import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

document.addEventListener('DOMContentLoaded', async () => {
    await initializeAdminLayout();
    loadActiveDuels();
    loadRecentDuels();
    setupRealtime();
});

async function loadActiveDuels() {
    const { data: duels, error } = await sbClient
        .from('lobby_duels')
        .select(`
            *,
            challenger:challenger_id(username),
            challenged:challenged_id(username)
        `)
        .eq('status', 'active')
        .order('updated_at', { ascending: false });

    if (error) return logger.error(error);

    const tbody = document.getElementById('activeDuelsBody');
    const countEl = document.getElementById('activeDuelCount');
    if (countEl) {
        countEl.innerText = `${duels.length} ACTIVE`;
    }

    if (duels.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="px-6 py-8 text-center text-slate-500 font-medium">No active duels at the moment</td></tr>`;
        return;
    }

    tbody.innerHTML = duels.map(d => {
        // Calculate "Freshness"
        const lastUpdate = new Date(d.updated_at);
        const now = new Date();
        const diffMs = now - lastUpdate;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const isStale = diffHours >= 24;

        const staleBadge = isStale
            ? `<span class="bg-red-100 text-red-600 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border border-red-200">⚠️ STALE</span>`
            : `<span class="bg-emerald-100 text-emerald-600 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border border-emerald-200">ACTIVE</span>`;

        return `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
            <td class="p-3 px-4">
                <div class="flex flex-col gap-1">
                    <div class="flex flex-col">
                        <span class="text-xs font-bold text-slate-700">${d.challenger?.username || 'Unknown'}</span>
                        <span class="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">VS</span>
                        <span class="text-xs font-bold text-slate-700">${d.challenged?.username || 'Unknown'}</span>
                    </div>
                    ${staleBadge}
                </div>
            </td>
            <td class="p-3">
                <div class="flex flex-col gap-1">
                    <span class="bg-slate-800 text-white text-[9px] px-1.5 py-0.5 rounded font-bold uppercase w-fit tracking-wider">${d.game_mode || 'Bo1'}</span>
                    <span class="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                        <span class="material-symbols-outlined text-[14px]">toll</span> ${d.bet_amount}
                    </span>
                    <span class="text-[9px] text-slate-400 mt-1">
                        Updated: ${lastUpdate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                        <br>(${diffHours}h ago)
                    </span>
                </div>
            </td>
            <td class="p-3 text-center">
                <span class="text-sm font-black text-slate-800 tracking-widest">${d.challenger_score} - ${d.challenged_score}</span>
            </td>
        </tr>
    `}).join('');
}

async function loadRecentDuels() {
    const { data: duels, error } = await sbClient
        .from('lobby_duels')
        .select(`
            *,
            winner:winner_id(username)
        `)
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(20);

    if (error) return logger.error(error);

    const tbody = document.getElementById('recentDuelsBody');
    if (duels.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="px-6 py-8 text-center text-slate-500 font-medium">No history found</td></tr>`;
        return;
    }

    tbody.innerHTML = duels.map(d => `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
            <td class="p-3 px-4">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-emerald-500 text-lg">workspace_premium</span>
                    <span class="text-xs font-bold text-slate-800">${d.winner?.username || 'TIE'}</span>
                </div>
            </td>
            <td class="p-3">
                <span class="text-[11px] font-bold text-emerald-600 flex items-center gap-0.5">
                    <span class="material-symbols-outlined text-[14px]">toll</span> ${d.bet_amount}
                </span>
            </td>
            <td class="p-3 text-right pr-4">
                <span class="text-[10px] font-medium text-slate-400">
                    ${new Date(d.updated_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </span>
            </td>
        </tr>
    `).join('');
}

window.handleGrantItem = async () => {
    const userSearch = document.getElementById('targetUser').value.trim();
    const itemKey = document.getElementById('itemKey').value;
    const qty = parseInt(document.getElementById('itemQty').value);

    if (!userSearch) return alert('Masukkan username atau User ID target!');

    try {
        // 1. Find user if search is username
        let targetId = userSearch;
        if (!userSearch.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            const { data: profile, error: pErr } = await sbClient
                .from('profiles')
                .select('id')
                .ilike('username', userSearch)
                .single();
            if (pErr) throw new Error('User tidak ditemukan!');
            targetId = profile.id;
        }

        // 2. Grant Item via Edge Function (Secure)
        // REFACTORED: Now uses Edge Function instead of direct DB write (Rule #3 Compliance)
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageDuels',
                sub_action: 'grant_item',
                data: {
                    user_id: targetId,
                    item_key: itemKey,
                    quantity: qty
                }
            }
        });

        if (fnError) throw fnError;
        if (!res.success) throw new Error(res.error || 'Grant failed');

        alert(`Sukses memberikan ${qty}x ${itemKey} kepada user!`);
        document.getElementById('targetUser').value = '';
    } catch (err) {
        alert(err.message);
    }
};

function setupRealtime() {
    sbClient
        .channel('admin-duels')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_duels' }, () => {
            loadActiveDuels();
            loadRecentDuels();
        })
        .subscribe();
}
