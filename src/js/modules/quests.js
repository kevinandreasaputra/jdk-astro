import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';

/**
 * Initializes and renders Daily Quests in the sidebar
 */
export async function initDailyQuests(userId) {
    const list = document.getElementById('dailyQuestsList');
    const widget = document.getElementById('questWidget');
    if (!list || !widget) return;

    try {
        const { data: quests, error } = await sbClient
            .from('daily_quests')
            .select('*')
            .eq('user_id', userId)
            .eq('quest_date', new Date().toISOString().split('T')[0]);

        if (error) throw error;

        if (!quests || quests.length === 0) {
            // If no quest exists, wait for one to be created by the DB trigger on first duel
            // Or we could proactively create one here. For now, let's keep it clean.
            widget.classList.add('hidden');
            return;
        }

        widget.classList.remove('hidden');
        list.innerHTML = quests.map(q => {
            const progress = Math.min(100, (q.current_count / q.target_count) * 100);
            const isDone = q.current_count >= q.target_count;

            return `
                <div class="space-y-2">
                    <div class="flex justify-between items-center text-[10px] font-black uppercase text-black">
                        <span>${q.quest_type === 'duel_wins' ? 'Menangkan 3 Duel ⚔️' : q.quest_type}</span>
                        <span>${q.current_count}/${q.target_count}</span>
                    </div>
                    <div class="w-full h-3 bg-black/5 border border-black rounded-full overflow-hidden">
                        <div class="h-full bg-green-400 transition-all duration-500" style="width: ${progress}%"></div>
                    </div>
                    <div class="flex justify-between items-center">
                        <span class="text-[9px] font-bold text-blue-600">+${q.reward_points} POINTS</span>
                        ${isDone
                    ? (q.is_claimed
                        ? '<span class="text-[9px] font-black text-gray-400 italic">DIKLAIM ✅</span>'
                        : `<button onclick="window.claimQuest('${q.id}')" class="bg-yellow-400 border border-black px-2 py-0.5 rounded text-[9px] font-black hover:scale-105 active:scale-95 shadow-sm transition-all animate-bounce-slow">KLAIM 🎁</button>`)
                    : '<span class="text-[9px] font-black text-gray-400">IN PROGRESS...</span>'
                }
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        logger.error('Quest Error:', err);
        list.innerHTML = `<div class="text-[10px] text-red-500 font-bold text-center py-2">Gagal memuat quest.</div>`;
    }
}

/**
 * Handles quest reward claiming
 */
window.claimQuest = async (questId) => {
    try {
        showNotification('Mengklaim hadiah... 🎁');

        const { data, error } = await sbClient.rpc('claim_daily_quest_reward', { quest_id_val: questId });

        if (error) throw error;
        if (!data.success) throw new Error(data.message);

        showNotification(`🎉 Berhasil! Poin kamu sekarang: ${data.new_points}`, 'success');

        // Refresh UI
        const userId = (await sbClient.auth.getUser()).data.user?.id;
        if (userId) initDailyQuests(userId);

    } catch (err) {
        showNotification('Gagal klaim: ' + err.message, 'error');
    }
};

/**
 * Fetch and return inventory summary for profile peek
 */
export async function getUserInventory(userId) {
    try {
        const { data, error } = await sbClient
            .from('user_inventory')
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;
        return data || [];
    } catch (err) {
        logger.error('Inventory Error:', err);
        return [];
    }
}
