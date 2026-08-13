import { logger } from '../core/logger.js';
/**
 * Admin Referrals Management Logic
 * JDK Entertainment
 */
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

document.addEventListener('DOMContentLoaded', async () => {
    await initializeAdminLayout();

    // Initial load
    window.loadReferrals();
    window.loadRewardSettings();
});

// --- GLOBAL FUNCTIONS (attached to window for onclick) ---

window.loadRewardSettings = async function () {
    try {
        const { data, error } = await sbClient
            .from('system_settings')
            .select('referrer_reward, referee_reward')
            .eq('id', 1)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
            const refInput = document.getElementById('displayRefReward');
            const newInput = document.getElementById('displayNewReward');
            if (refInput) refInput.value = data.referrer_reward || 100;
            if (newInput) newInput.value = data.referee_reward || 50;
        }
    } catch (e) {
        logger.warn('Failed to load reward settings display:', e);
    }
};

window.saveRewardSettings = async function () {
    try {
        const refReward = parseInt(document.getElementById('displayRefReward').value) || 0;
        const newReward = parseInt(document.getElementById('displayNewReward').value) || 0;

        const { error } = await sbClient
            .from('system_settings')
            .upsert({
                id: 1,
                referrer_reward: refReward,
                referee_reward: newReward
            });

        if (error) throw error;

        showNotification('✅ Reward referral diperbarui!', 'success');
    } catch (e) {
        logger.error('Save reward settings error:', e);
        showNotification('❌ Gagal Update: ' + e.message, 'error');
    }
};

window.loadReferrals = async function () {
    const tbody = document.getElementById('referralTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-slate-500">Loading referrals...</td></tr>';

    try {
        // Fetch all profiles that were referred by someone
        const { data, error } = await sbClient
            .from('profiles')
            .select('id, username, full_name, referred_by, created_at')
            .not('referred_by', 'is', null)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="p-12 text-center text-slate-500 font-medium">Belum ada member yang join via referal.</td></tr>';
            updateStats(0, 0);
            return;
        }

        // Get unique referred_by codes to find referrer info
        const referrerCodes = [...new Set(data.map(m => m.referred_by))];

        // Fetch referrer profiles
        const { data: referrers, error: refError } = await sbClient
            .from('profiles')
            .select('username, referral_code')
            .in('referral_code', referrerCodes);

        const referrerMap = {};
        if (referrers) {
            referrers.forEach(r => {
                referrerMap[r.referral_code] = r.username;
            });
        }

        tbody.innerHTML = data.map(m => `
            <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
                <td class="px-6 py-4">
                    <div class="flex flex-col">
                        <span class="font-bold text-slate-800 text-sm italic">@${m.username}</span>
                        <span class="text-[11px] text-slate-400 font-medium">${m.full_name || '-'}</span>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-2">
                        <div class="flex flex-col">
                            <span class="font-bold text-slate-700 text-xs italic">@${referrerMap[m.referred_by] || 'Mantan Member'}</span>
                            <span class="text-[10px] text-slate-300 font-mono tracking-tighter uppercase">${m.referred_by}</span>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-center">
                    <span class="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded">
                        ${m.created_at ? new Date(m.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown'}
                    </span>
                </td>
            </tr>
        `).join('');

        updateStats(data.length, referrerCodes.length);

    } catch (err) {
        logger.error('Error loading referrals:', err);
        tbody.innerHTML = `<tr><td colspan="3" class="p-12 text-center text-rose-500 font-bold">Gagal memuat data: ${err.message}</td></tr>`;
    }
};

function updateStats(total, active) {
    const totalEl = document.getElementById('statTotalReferred');
    const activeEl = document.getElementById('statActiveReferrers');
    if (totalEl) totalEl.textContent = total;
    if (activeEl) activeEl.textContent = active;
}
