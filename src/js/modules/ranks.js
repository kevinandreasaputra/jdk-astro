import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Ranks Module
 * Handles level calculation and rank system
 */

import { sbClient } from '../core/supabase.js';

// Global Ranks Cache - Default values
let allRanks = [
    { rank_type: 'F', name: 'NOVICE', min_level: 1, min_xp: 0, badge_url: 'assets/badges/rank_f.png', color: '#94A3B8' },
    { rank_type: 'E', name: 'APPRENTICE', min_level: 5, min_xp: 4000, badge_url: 'assets/badges/rank_e.png', color: '#4ADE80' },
    { rank_type: 'D', name: 'SOLDIER', min_level: 10, min_xp: 9000, badge_url: 'assets/badges/rank_d.png', color: '#60A5FA' },
    { rank_type: 'C', name: 'VETERAN', min_level: 20, min_xp: 19000, badge_url: 'assets/badges/rank_c.png', color: '#F59E0B' },
    { rank_type: 'B', name: 'ELITE', min_level: 35, min_xp: 34000, badge_url: 'assets/badges/rank_b.png', color: '#8B5CF6' },
    { rank_type: 'A', name: 'JDKwan', min_level: 55, min_xp: 54000, badge_url: 'assets/badges/rank_a.png', color: '#EC4899' },
    { rank_type: 'S', name: 'LEGEND', min_level: 80, min_xp: 79000, badge_url: 'assets/badges/rank_s.png', color: '#EF4444' }
];

// Global Level Configs Cache
let levelConfigs = [];

/**
 * Fetch ranks from database (if available)
 */
export async function fetchRanks() {
    if (!sbClient) return;
    try {
        const { data, error } = await sbClient
            .from('ranks')
            .select('*')
            .order('min_level', { ascending: true });

        if (data && data.length > 0) {
            allRanks = data;
        }
    } catch (e) {
        logger.warn('Fetch ranks failed, using defaults');
    }
}

/**
 * Fetch level configurations from database
 */
export async function fetchLevelConfigs() {
    if (!sbClient) return;
    try {
        const { data, error } = await sbClient
            .from('level_configs')
            .select('*')
            .order('level', { ascending: true });

        if (data && data.length > 0) {
            levelConfigs = data;
        }
    } catch (e) {
        logger.warn('Fetch level configs failed');
    }
}

/**
 * Get all ranks
 * @returns {Array} Array of rank objects
 */
export function getAllRanks() {
    return allRanks;
}

/**
 * Standardized level calculation based on XP
 * @param {number} xp - User's current XP
 * @returns {object} Level info including rank details
 */
export function calculateUserLevel(xp = 0) {
    let level = 1;
    let nextLevelXp = 1000;
    let currentLevelMinXp = 0;

    if (levelConfigs.length > 0) {
        // Find current level from database configs
        for (let i = 0; i < levelConfigs.length; i++) {
            if (xp >= levelConfigs[i].min_xp) {
                level = levelConfigs[i].level;
                currentLevelMinXp = levelConfigs[i].min_xp;
                // Next level is the next entry in the array
                if (i + 1 < levelConfigs.length) {
                    nextLevelXp = levelConfigs[i + 1].min_xp;
                } else {
                    // Maximum level reached, set nextLevelXp to current to prevent division issues
                    nextLevelXp = currentLevelMinXp + 5000;
                }
            } else {
                break;
            }
        }
    } else {
        // Fallback to hardcoded linear formula if no configs loaded
        level = Math.floor(xp / 1000) + 1;
        currentLevelMinXp = (level - 1) * 1000;
        nextLevelXp = level * 1000;
    }

    const currentLevelProgress = xp - currentLevelMinXp;
    const xpNeededForNext = nextLevelXp - currentLevelMinXp;
    const progressPercent = xpNeededForNext > 0 ? (currentLevelProgress / xpNeededForNext) * 100 : 100;

    // Find the highest rank where user satisfies BOTH Level AND XP requirement
    let currentRank = allRanks[0] || { name: 'MEMBER', color: '#94A3B8', badge_url: '' };
    for (const rank of allRanks) {
        if (level >= rank.min_level && xp >= (rank.min_xp || 0)) {
            currentRank = rank;
        } else {
            break;
        }
    }

    return {
        level,
        nextLevelXp,
        currentLevelMinXp,
        xpNeededForNext,
        currentLevelProgress,
        progressPercent: Math.min(100, progressPercent),
        rankName: currentRank.name,
        rankColor: currentRank.color,
        rankIcon: currentRank.badge_url
    };
}

// Expose to window for global access (needed by game-bridge.js and other pages)
if (typeof window !== 'undefined') {
    window.calculateUserLevel = calculateUserLevel;
    window.fetchRanks = fetchRanks;
    window.fetchLevelConfigs = fetchLevelConfigs;
    window.getAllRanks = getAllRanks;

    // Auto-fetch on load if in browser
    fetchRanks();
    fetchLevelConfigs();
}

