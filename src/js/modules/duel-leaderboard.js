import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';

/**
 * Initializes and renders the Duel Leaderboard in the lobby sidebar
 */
export async function initDuelLeaderboard() {
    const container = document.getElementById('duelLeaderboard');
    if (!container) return;

    try {
        // Fetch top 10 by wins
        const { data: topPlayers, error } = await sbClient
            .from('duel_stats')
            .select(`
                total_wins,
                total_earnings,
                win_streak,
                profiles (username, avatar_url)
            `)
            .order('total_wins', { ascending: false })
            .limit(10);

        if (error) throw error;

        if (!topPlayers || topPlayers.length === 0) {
            container.innerHTML = `<div class="text-[10px] text-gray-400 font-bold text-center py-4 italic">Belum ada petarung di arena. Mari jadi yang pertama! 👊</div>`;
            return;
        }

        container.innerHTML = topPlayers.map((stat, idx) => {
            const crown = idx === 0 ? '👑' : '';
            const rankColor = idx === 0 ? 'bg-yellow-400' : idx === 1 ? 'bg-gray-200' : idx === 2 ? 'bg-orange-200' : 'bg-gray-50';

            return `
                <div class="flex items-center gap-3 p-2 hover:bg-black/5 rounded-xl transition-all cursor-pointer group border border-transparent hover:border-black/5"
                     onclick="window.openProfilePeek('${stat.profiles.username}')">
                    <div class="w-6 h-6 flex-shrink-0 flex items-center justify-center ${rankColor} border-2 border-black rounded-lg text-[10px] font-black shadow-sm group-hover:scale-110 transition-transform">
                        ${idx + 1}
                    </div>
                    <div class="relative flex-shrink-0">
                        <img src="${stat.profiles.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + stat.profiles.username}" 
                             class="w-8 h-8 rounded-full border-2 border-black object-cover bg-white">
                        ${idx === 0 ? '<span class="absolute -top-2 -right-1 text-[10px] rotate-12">👑</span>' : ''}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-black text-black truncate uppercase leading-tight">${stat.profiles.username}</p>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-[8px] font-black text-blue-600 uppercase bg-blue-50 px-1 rounded-sm border border-blue-100">${stat.total_wins} WINS</span>
                            ${stat.win_streak >= 3 ? `<span class="text-[8px] font-black text-orange-600 uppercase">🔥 ${stat.win_streak}</span>` : ''}
                        </div>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <p class="text-[9px] font-black text-green-600 leading-none">+${stat.total_earnings}</p>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        logger.error('Duel Leaderboard Error:', err);
        container.innerHTML = `<div class="text-[10px] text-red-500 font-bold text-center py-4 uppercase">Gagal memuat data arena ❌</div>`;
    }
}
