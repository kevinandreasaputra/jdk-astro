import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Achievement Module
 * Handles achievement unlocking, fetching, and checking
 */

import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';

/**
 * Fetch all available achievements and user's unlocked status
 * @param {string} userId - UUID of the user
 * @returns {Promise<Array>} - Array of achievements with 'unlocked' property
 */
export async function getAchievementsForUser(userId) {
    if (!sbClient) return [];

    try {
        // 1. Get all achievements
        const { data: allAchievements, error: achError } = await sbClient
            .from('achievements')
            .select('*')
            .order('category', { ascending: true });

        if (achError) throw achError;

        // 2. Get user's unlocked achievements
        const { data: unlocked, error: unlockError } = await sbClient
            .from('user_achievements')
            .select('achievement_id, unlocked_at, unlocked_reason')
            .eq('user_id', userId);

        if (unlockError) throw unlockError;

        // 3. Map status with history details
        const unlockedMap = new Map(
            unlocked.map(u => [u.achievement_id, { at: u.unlocked_at, reason: u.unlocked_reason }])
        );

        return allAchievements.map(ach => ({
            ...ach,
            unlocked: unlockedMap.has(ach.id),
            unlocked_at: unlockedMap.has(ach.id) ? unlockedMap.get(ach.id).at : null,
            unlocked_reason: unlockedMap.has(ach.id) ? unlockedMap.get(ach.id).reason : null
        }));
    } catch (err) {
        logger.error('Error fetching achievements:', err);
        return [];
    }
}

/**
 * Unlock an achievement for a user
 * @param {string} userId - User UUID
 * @param {string} achievementTitle - Exact title of the achievement
 */
export async function unlockAchievement(userId, achievementTitle, reason = null) {
    if (!sbClient) return;

    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'unlockAchievement',
                title: achievementTitle,
                reason: reason
            }
        });

        if (fnError) throw fnError;

        // Only show notification if actually unlocked (new: true)
        if (res && res.success && res.new) {
            const ach = res.achievement;
            showNotification(`🏆 ACHIEVEMENT UNLOCKED: ${ach.title} ${ach.icon_emoji}`, 'success');
        }

    } catch (err) {
        logger.error('Error unlocking achievement:', err);
    }
}

/**
 * Admin: Grant achievement to user manually
 * @param {string} userId 
 * @param {string} achievementId 
 */
export async function adminGrantAchievement(userId, achievementId) {
    if (!sbClient) return { success: false, error: 'DB not connected' };

    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminGrantAchievement',
                target_user_id: userId,
                achievement_id: achievementId,
                reason: 'Granted by Admin'
            }
        });

        if (fnError) throw fnError;
        if (!res.success) return { success: false, error: res.error || res.message };

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}
