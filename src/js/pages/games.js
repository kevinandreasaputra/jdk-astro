import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { showNotification, getRelativeTime } from '../core/utils.js';
import { calculateUserLevel } from '../modules/ranks.js';
import { getCurrentUser } from '../modules/user-session.js';
import { openLoginModal } from '../modules/auth.js';
import feather from 'feather-icons';

export function initializeGamesPage() {
    logger.log('Initialize Games Page');
    // Wait for Supabase client
    setTimeout(loadGames, 500);
}

async function loadGames() {
    if (!sbClient) {
        logger.error("Supabase not initialized");
        return;
    }

    const { data: games, error } = await sbClient
        .from('games')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    const grid = document.getElementById('gamesGrid');
    if (!grid) return;

    if (error) {
        grid.innerHTML = `<p class="text-red-500">Error loading games</p>`;
        return;
    }

    // Fetch Trending Data (Last 30 days for better stats)
    const { data: trending, error: trendError } = await sbClient
        .rpc('get_trending_games', { p_days_ago: 30 });

    if (!games || games.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full text-center bg-white p-6 border-4 border-black border-dashed rounded-xl">
                <p class="font-bold text-xl text-gray-500">No games found in the arcade yet!</p>
            </div>
         `;
    } else {
        renderGamesList(games, trending || []);
    }

    // Update Header with User Rank if logged in
    updateHeaderRank();
}

function updateHeaderRank() {
    const rankStatus = document.getElementById('userRankStatus');
    const currentUser = getCurrentUser();

    // Check if currentUser exists. If not yet loaded, wait a bit and try again (up to 5 times)
    if (!currentUser) {
        if (!window.rankUpdateRetries) window.rankUpdateRetries = 0;
        if (window.rankUpdateRetries < 10) {
            window.rankUpdateRetries++;
            setTimeout(updateHeaderRank, 500);
        }
        return;
    }

    const levelData = calculateUserLevel(currentUser.xp || 0);

    const badgeUrl = levelData.rankIcon || '/assets/badges/rank_f.png';
    const rankName = levelData.rankName || 'MEMBER';

    const badges = document.getElementById('headerRankBadge');
    if (badges) badges.src = badgeUrl;

    const rankNameParams = document.getElementById('headerRankName');
    if (rankNameParams) rankNameParams.innerText = rankName.toUpperCase();

    const userLevel = document.getElementById('headerUserLevel');
    if (userLevel) userLevel.innerText = `LVL ${levelData.level}`;

    const userPoints = document.getElementById('headerUserPoints');
    if (userPoints) userPoints.innerText = `${(currentUser.current_points || 0).toLocaleString()} PTS`;

    if (rankStatus) {
        rankStatus.classList.remove('hidden');
        rankStatus.classList.add('flex');
    }
}

function renderGamesList(games, trendingData = []) {
    const grid = document.getElementById('gamesGrid');
    const currentUser = getCurrentUser();

    grid.innerHTML = games.map(game => {
        const minLevel = game.min_level || 0;
        const isFree = minLevel === 0;
        const trendingInfo = trendingData.find(t => t.game_id === game.id);
        const playCount = trendingInfo ? trendingInfo.play_count : 0;
        const uniquePlayers = trendingInfo ? trendingInfo.unique_players : 0;
        const isTrending = playCount > 10; // Threshold for trending badge

        // Get user level if logged in using main.js logic
        let userLevel = 0;
        if (currentUser) {
            const levelData = calculateUserLevel(currentUser.xp || 0);
            userLevel = levelData.level;
        }

        const isLocked = !isFree && (!currentUser || userLevel < minLevel);

        let buttonHtml = '';
        if (!currentUser && !isFree) {
            buttonHtml = `
                <button onclick="window.openLoginModal()" class="block w-full text-center bg-gray-400 hover:bg-gray-500 text-white font-bangers text-2xl py-3 border-2 border-black shadow-comic active:translate-y-1 active:shadow-none transition-all">
                    LOGIN TO PLAY
                </button>`;
        } else if (isLocked) {
            buttonHtml = `
                <button disabled class="block w-full text-center bg-gray-300 text-gray-500 font-bangers text-2xl py-3 border-2 border-black shadow-none cursor-not-allowed">
                    LOCKED (LVL ${minLevel})
                </button>`;
        } else {
            buttonHtml = `
                <div class="flex gap-2">
                    <a href="/game-player.html?id=${game.id}" class="flex-[2] text-center bg-comic-yellow hover:bg-comic-orange text-black font-bangers text-2xl py-3 border-2 border-black shadow-comic active:translate-y-1 active:shadow-none transition-all">
                        PLAY NOW!
                    </a>
                    <a href="/game-forum.html?id=${game.id}" class="flex-1 bg-white hover:bg-gray-100 text-black border-2 border-black shadow-comic active:translate-y-1 active:shadow-none transition-all flex items-center justify-center text-2xl" title="Forum Diskusi">
                        💬
                    </a>
                    <button onclick="window.openLeaderboard('${game.id}', '${game.name}')" class="flex-1 bg-white hover:bg-gray-100 text-black border-2 border-black shadow-comic active:translate-y-1 active:shadow-none transition-all flex items-center justify-center text-2xl" title="Leaderboard">
                        🏆
                    </button>
                </div>`;
        }

        return `
        <div class="bg-white border-2 border-black/5 shadow-md rounded-[2rem] overflow-hidden transition-all duration-300 relative group 
            ${isLocked ? 'grayscale opacity-75' : 'hover:-translate-y-2 hover:border-primary hover:shadow-xl'}">
            
            <!-- Badge -->
            <div class="absolute top-6 right-6 z-10 flex flex-col items-end gap-2 text-right">
                ${isFree ?
                `<span class="bg-primary text-black font-black px-4 py-1.5 rounded-full border-2 border-black shadow-[4px_4px_0_rgba(0,0,0,1)] text-[10px] uppercase tracking-wider">FREE PLAY</span>` :
                `<span class="bg-comic-purple text-white font-black px-4 py-1.5 rounded-full border-2 border-black shadow-[4px_4px_0_rgba(0,0,0,1)] text-[10px] uppercase tracking-wider">LVL ${minLevel}+</span>`
            }
                ${isTrending ?
                `<span class="bg-comic-red text-white font-black px-4 py-1.5 rounded-full border-2 border-black shadow-[4px_4px_0_rgba(0,0,0,1)] text-[10px] uppercase tracking-wider mt-2 animate-pulse">🔥 TRENDING</span>` : ''
            }
            </div>
            
            <!-- Image Content -->
            <div class="h-56 bg-gray-900 relative overflow-hidden flex items-center justify-center border-b border-black/5">
                 <img src="${game.image_url || '/images/comic-background.jpg'}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
                 ${isLocked ? `
                 <div class="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white p-4 text-center backdrop-blur-[2px]">
                     <div class="bg-comic-red p-4 rounded-full border-2 border-white mb-2 shadow-xl">
                          <span class="material-symbols-outlined text-3xl">lock</span>
                     </div>
                     ${!currentUser ? '<p class="font-black text-xl tracking-tighter">LOGIN TO UNLOCK</p>' : `<p class="font-black text-xl tracking-tighter uppercase whitespace-nowrap">REACH LVL ${minLevel}</p>`}
                 </div>` : ''}
            </div>
 
            <div class="p-8 relative">
                <div class="mb-4">
                    <div class="flex items-center justify-between mb-3">
                        <span class="bg-blue-50 text-blue-600 text-[10px] font-black px-3 py-1 rounded-full border border-blue-100 uppercase tracking-widest">${game.category || 'ARCADE'}</span>
                        <div class="flex items-center gap-1.5 text-[10px] font-black ${isFree ? 'text-comic-green' : 'text-comic-purple'}">
                            <span class="material-symbols-outlined text-sm pt-0.5">${isFree ? 'public' : 'verified_user'}</span>
                            <span class="tracking-widest">${isFree ? 'PUBLIC' : 'JDKwan'}</span>
                        </div>
                    </div>
                    
                    <h3 class="text-black text-3xl font-black mb-1 leading-none uppercase tracking-tighter group-hover:text-primary transition-colors">${game.name}</h3>
                    
                    <div class="flex items-center justify-between mb-5">
                         <div class="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            <span class="material-symbols-outlined text-sm">person</span>
                            <span>BY ${game.creator_name || 'JDK STUDIO'}</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <div class="flex items-center gap-1 text-[10px] font-black text-comic-orange bg-orange-50 px-2 py-0.5 rounded-lg border border-orange-100">
                                <span class="material-symbols-outlined text-xs">play_arrow</span>
                                <span>${playCount}</span>
                            </div>
                            <div class="flex items-center gap-1 text-[10px] font-black text-comic-blue bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">
                                <span class="material-symbols-outlined text-xs">groups</span>
                                <span>${uniquePlayers}</span>
                            </div>
                        </div>
                    </div>
 
                    <p class="text-gray-500 font-bold text-sm mb-6 line-clamp-2 leading-relaxed">
                        ${game.description}
                    </p>
 
                    <!-- Requirements & Rewards -->
                    <div class="grid grid-cols-2 gap-3 mb-6">
                        <div class="flex flex-col p-3 rounded-2xl border-2 ${isLocked ? 'border-comic-red/20 bg-red-50/50' : 'border-comic-green/20 bg-green-50/50'}">
                            <span class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Requirement</span>
                            <span class="text-sm font-black ${isLocked ? 'text-comic-red' : 'text-comic-green'}">
                                ${isFree ? 'LVL 0' : `LEVEL ${minLevel}+`}
                            </span>
                        </div>
                        <div class="flex flex-col p-3 rounded-2xl border-2 border-blue-50 bg-blue-50/50">
                            <span class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">XP Reward</span>
                            <span class="text-sm font-black text-comic-blue">${game.xp_reward} XP</span>
                        </div>
                    </div>
                </div>
 
                ${buttonHtml}
            </div>
        </div>
    `;
    }).join('');
    feather.replace();
}

// --- Leaderboard Logic ---
// Store current leaderboard data globally for sharing
let currentLeaderboardData = [];
let currentGameNameForShare = '';

window.openLeaderboard = async function (gameId, gameName) {
    const modal = document.getElementById('leaderboardModal');
    const nameEl = document.getElementById('leaderboardGameName');
    const body = document.getElementById('leaderboardListBody');
    const loading = document.getElementById('leaderboardLoading');
    const empty = document.getElementById('leaderboardEmpty');

    if (!modal || !body) return;

    // Reset state
    currentGameNameForShare = gameName;
    nameEl.innerText = gameName.toUpperCase(); // Removed "LEADERBOARD" text as it's implied
    body.innerHTML = '';
    loading.classList.remove('hidden');
    empty.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Animate pop in
    const modalContent = modal.querySelector('.comic-modal');
    if (modalContent) {
        modalContent.classList.remove('scale-100');
        modalContent.classList.add('scale-50', 'opacity-0');
        setTimeout(() => {
            modalContent.classList.remove('scale-50', 'opacity-0');
            modalContent.classList.add('scale-100');
        }, 50);
    }

    try {
        const { data, error } = await sbClient.rpc('get_game_leaderboard', {
            p_game_id: gameId,
            p_limit: 10
        });

        loading.classList.add('hidden');

        if (error) {
            logger.error('Leaderboard error:', error);
            body.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-500">Error loading scores!</td></tr>';
            return;
        }

        if (!data || data.length === 0) {
            currentLeaderboardData = [];
            empty.classList.remove('hidden');
            return;
        }

        currentLeaderboardData = data;

        body.innerHTML = data.map((entry, index) => {
            const rank = index + 1;
            let rankDisplay = `<span class="text-xs font-black text-black/20 w-8">#${rank}</span>`;

            if (rank === 1) rankDisplay = `<span class="text-lg w-8">🥇</span>`;
            if (rank === 2) rankDisplay = `<span class="text-lg w-8">🥈</span>`;
            if (rank === 3) rankDisplay = `<span class="text-lg w-8">🥉</span>`;

            return `
                <tr class="group border-b border-black/[0.03] last:border-0 hover:bg-gray-50/50 transition-colors">
                    <td class="py-3">
                        <div class="flex items-center gap-4">
                            ${rankDisplay}
                            <a href="/profile?id=${entry.user_id}" class="flex items-center gap-3 group/link">
                                <img src="${entry.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(entry.username)}&background=random&color=fff`}" 
                                     class="w-10 h-10 rounded-full border border-black/5 object-cover bg-gray-50 transition-transform group-hover/link:scale-110">

                                <div class="flex flex-col">
                                    <span class="text-sm font-black text-black group-hover/link:text-primary transition-colors">${entry.username}</span>
                                    <span class="text-[9px] font-bold text-black/30 uppercase tracking-widest">${getRelativeTime(entry.played_at)}</span>
                                </div>
                            </a>
                        </div>
                    </td>
                    <td class="text-right py-3 pr-2">
                        <div class="flex flex-col items-end">
                            <span class="text-lg font-black text-black tracking-tight">${(entry.high_score || 0).toLocaleString()}</span>
                            <span class="text-[8px] font-bold text-black/20 uppercase tracking-[0.2em]">POINTS</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        logger.error('Fetch error:', err);
        loading.classList.add('hidden');
        body.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-500">Network Error!</td></tr>';
    }
};

window.shareLeaderboard = async function () {
    if (!currentLeaderboardData.length) {
        showNotification('Belum ada data skor untuk dishare! 😅');
        return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    let shareText = `🏆 *LEADERBOARD ${currentGameNameForShare.toUpperCase()}* 🏆\n`;
    shareText += `📅 ${dateStr} va ${timeStr}\n\n`;

    // Add Top 3
    const top3 = currentLeaderboardData.slice(0, 5); // Share Top 5
    top3.forEach((entry, index) => {
        let medal = '';
        if (index === 0) medal = '🥇';
        else if (index === 1) medal = '🥈';
        else if (index === 2) medal = '🥉';
        else medal = `${index + 1}.`;

        shareText += `${medal} ${entry.username}: ${entry.high_score.toLocaleString()}\n`;
    });

    shareText += `\nMainkan sekarang di JDK Entertainment! 🎮`;

    // Try Native Share API
    if (navigator.share) {
        try {
            await navigator.share({
                title: `${currentGameNameForShare} Leaderboard`,
                text: shareText
            });
            logger.log('Shared successfully');
        } catch (err) {
            logger.log('Error sharing:', err);
            copyToClipboard(shareText);
        }
    } else {
        copyToClipboard(shareText);
    }
};

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('📋 Leaderboard disalin ke clipboard! Siap dipaste!');
    }, (err) => {
        logger.error('Could not copy text: ', err);
        showNotification('❌ Gagal menyalin text'); // Fallback manual?
    });
}

window.closeLeaderboardModal = function () {
    const modal = document.getElementById('leaderboardModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};
