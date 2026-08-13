import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';

const getSB = () => sbClient;

/**
 * Fetches ALL currently active leaderboard configurations (within their period)
 * Returns an array of configs
 */
export async function getAllActiveLeaderboardConfigs() {
    const sb = getSB();
    if (!sb) return [];

    const now = new Date().toISOString();

    const { data, error } = await sb
        .from('leaderboard_settings')
        .select('*')
        .eq('is_active', true)
        .lte('start_date', now)
        .gte('end_date', now);

    if (error) {
        logger.warn('No active leaderboard configs found:', error.message);
        return [];
    }
    return data || [];
}

/**
 * Fetches the first active leaderboard configuration (for backward compatibility)
 */
export async function getActiveLeaderboardConfig() {
    const configs = await getAllActiveLeaderboardConfigs();
    return configs.length > 0 ? configs[0] : null;
}

/**
 * Fetches standings based on the provided configuration
 */
export async function fetchLeaderboardStandings(config) {
    const sb = getSB();
    if (!sb || !config) return [];

    const { metric_type, start_date, end_date } = config;
    let standings = [];

    try {
        switch (metric_type) {
            case 'XP':
                standings = await fetchXPStandings(sb);
                break;
            case 'PERIODIC_XP':
                standings = await fetchPeriodicXPStandings(sb, start_date, end_date);
                break;
            case 'POINTS':
                standings = await fetchPointsStandings(sb, start_date, end_date);
                break;
            case 'EVENTS':
                standings = await fetchEventsStandings(sb, start_date, end_date);
                break;
            case 'LIKES':
                standings = await fetchLikesStandings(sb, start_date, end_date);
                break;
            case 'GAME_SCORE':
                standings = await fetchGameScoreStandings(sb, config.game_id, start_date, end_date);
                break;
            default:
                logger.warn('Unknown metric type:', metric_type);
        }
    } catch (err) {
        logger.error('Error fetching standings:', err);
    }

    return standings;
}

async function fetchXPStandings(sb) {
    const { data, error } = await sb
        .from('profiles')
        .select('id, username, avatar_url, user_level, xp')
        .order('xp', { ascending: false })
        .limit(10);

    if (error) throw error;
    return data.map(u => ({ ...u, score: u.xp, unit: 'XP' }));
}

async function fetchPeriodicXPStandings(sb, start, end) {
    // Query xp_transactions for XP earned during period
    let query = sb
        .from('xp_transactions')
        .select('user_id, amount, profiles(username, avatar_url, user_level, xp)')
        .gt('amount', 0);

    if (start) query = query.gte('created_at', start);
    if (end) query = query.lte('created_at', end);

    const { data, error } = await query;
    if (error) {
        logger.warn('xp_transactions table may not exist, falling back to profiles:', error.message);
        // Fallback to lifetime XP if table doesn't exist
        return fetchXPStandings(sb);
    }

    // Aggregate by user
    const map = new Map();
    data.forEach(t => {
        const uid = t.user_id;
        if (!map.has(uid)) {
            map.set(uid, {
                id: uid,
                username: t.profiles?.username || 'Unknown',
                avatar_url: t.profiles?.avatar_url,
                user_level: t.profiles?.user_level,
                xp: t.profiles?.xp || 0,
                score: 0
            });
        }
        map.get(uid).score += t.amount;
    });

    return Array.from(map.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(u => ({ ...u, unit: 'XP' }));
}

async function fetchPointsStandings(sb, start, end) {
    // We aggregate points earned from point_transactions
    let query = sb
        .from('point_transactions')
        .select('user_id, amount, profiles(username, avatar_url, user_level, xp)')
        .gt('amount', 0); // Only earnings

    if (start) query = query.gte('created_at', start);
    if (end) query = query.lte('created_at', end);

    const { data, error } = await query;
    if (error) throw error;

    // Aggregate by user
    const map = new Map();
    data.forEach(t => {
        const uid = t.user_id;
        if (!map.has(uid)) {
            map.set(uid, {
                id: uid,
                username: t.profiles?.username || 'Unknown',
                avatar_url: t.profiles?.avatar_url,
                user_level: t.profiles?.user_level,
                xp: t.profiles?.xp || 0,
                score: 0
            });
        }
        map.get(uid).score += t.amount;
    });

    return Array.from(map.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(u => ({ ...u, unit: '🪙' }));
}

async function fetchEventsStandings(sb, start, end) {
    let query = sb
        .from('event_registrations')
        .select('user_id, profiles(username, avatar_url, user_level, xp)')
        .eq('status', 'attended');

    if (start) query = query.gte('created_at', start);
    if (end) query = query.lte('created_at', end);

    const { data, error } = await query;
    if (error) throw error;

    const map = new Map();
    data.forEach(r => {
        const uid = r.user_id;
        if (!map.has(uid)) {
            map.set(uid, {
                id: uid,
                username: r.profiles?.username || 'Unknown',
                avatar_url: r.profiles?.avatar_url,
                user_level: r.profiles?.user_level,
                xp: r.profiles?.xp || 0,
                score: 0
            });
        }
        map.get(uid).score += 1;
    });

    return Array.from(map.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(u => ({ ...u, unit: 'Event' }));
}

async function fetchLikesStandings(sb, start, end) {
    let query = sb
        .from('user_likes')
        .select('to_user_id, profiles!user_likes_to_user_id_fkey(username, avatar_url, user_level, xp)');

    if (start) query = query.gte('created_at', start);
    if (end) query = query.lte('created_at', end);

    const { data, error } = await query;
    if (error) throw error;

    const map = new Map();
    data.forEach(l => {
        const uid = l.to_user_id;
        if (!map.has(uid)) {
            map.set(uid, {
                id: uid,
                username: l.profiles?.username || 'Unknown',
                avatar_url: l.profiles?.avatar_url,
                user_level: l.profiles?.user_level,
                xp: l.profiles?.xp || 0,
                score: 0
            });
        }
        map.get(uid).score += 1;
    });

    return Array.from(map.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(u => ({ ...u, unit: 'Likes' }));
}

async function fetchGameScoreStandings(sb, gameId, start, end) {
    if (!gameId) {
        logger.warn('⚠️ fetchGameScoreStandings: No gameId provided');
        return [];
    }

    const params = {
        p_game_id: gameId,
        p_limit: 10
    };

    if (start) {
        params.p_start_date = start.includes('T') ? start : start + 'T00:00:00';
    }
    if (end) {
        params.p_end_date = end.includes('T') ? end : end + 'T23:59:59';
    }

    const { data, error } = await sb.rpc('get_game_leaderboard', params);

    if (error) {
        throw error;
    }

    return (data || []).map(u => ({
        id: u.user_id,
        username: u.username,
        avatar_url: u.avatar_url,
        score: u.high_score,
        unit: 'Pts',
        played_at: u.played_at
    }));
}

