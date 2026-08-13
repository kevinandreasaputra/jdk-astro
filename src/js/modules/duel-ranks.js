/**
 * Duel Rankings Configuration
 */
export const DUEL_TIERS = [
    { name: 'UNRANKED', minWins: 0, color: '#94a3b8', icon: '❓' },
    { name: 'NOVICE', minWins: 1, color: '#d97706', icon: '🥉' },
    { name: 'GLADIATOR', minWins: 10, color: '#4b5563', icon: '🥈' },
    { name: 'VETERAN', minWins: 25, color: '#ca8a04', icon: '🥇' },
    { name: 'CHAMPION', minWins: 50, color: '#2563eb', icon: '💎' },
    { name: 'LEGEND', minWins: 100, color: '#7c3aed', icon: '👑' }
];

/**
 * Calculates the duel rank based on total wins
 * @param {number} totalWins 
 * @returns {object} The rank object
 */
export function calculateDuelRank(totalWins = 0) {
    let currentRank = DUEL_TIERS[0];

    for (const rank of DUEL_TIERS) {
        if (totalWins >= rank.minWins) {
            currentRank = rank;
        } else {
            break;
        }
    }

    return currentRank;
}
