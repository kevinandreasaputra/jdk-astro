// JDK Game Bridge
// Include this script in your game's HTML to integrate with the main website.
// Usage: <script src="/game-bridge.js"></script>

const BRIDGE_CONFIG = {
    SUPABASE_URL: 'https://vadcglyhrcuwnfenyzgk.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhZGNnbHlocmN1d25mZW55emdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MTE4OTksImV4cCI6MjA4MTI4Nzg5OX0.mZqeFl8AA76xbrFExK2vq4ruur3qx5BS4N35PcbJuMA',
    LOGIN_URL: '/index.html?redirect=game'
};

// Check if Supabase SDK is loaded
if (typeof supabase === 'undefined') {
    console.error('GameBridge Error: Supabase JS SDK is missing. Please add <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> BEFORE this script.');
}

const sbGameClient = supabase.createClient(BRIDGE_CONFIG.SUPABASE_URL, BRIDGE_CONFIG.SUPABASE_KEY);

window.GameBridge = {
    user: null,
    gameConfig: null,
    hasSubmittedThisSession: false, // Prevent exploit: one reward per game session
    isLogInProgress: false,         // Prevent duplicate initial logging

    /**
     * Initialize the Game Bridge.
     * @param {string} gameName - Exact name of the game in the 'games' table (e.g., "JDK Jumper").
     * @param {boolean} requireLogin - If true, redirects if not logged in.
     * @returns {Promise<Object|null>} User object or null.
     */
    async init(gameName, requireLogin = true) {
        this.hasSubmittedThisSession = false; // Reset on new game session
        const { data: { session } } = await sbGameClient.auth.getSession();

        if (!session && requireLogin) {
            window.location.href = BRIDGE_CONFIG.LOGIN_URL;
            return null;
        }

        if (session) {
            // 1. Fetch User Profile
            const { data: profile } = await sbGameClient
                .from('profiles')
                .select('id, username, current_points, xp, avatar_url')
                .eq('id', session.user.id)
                .single();

            // 2. Fetch Game Config
            const { data: game } = await sbGameClient
                .from('games')
                .select('*')
                .ilike('name', gameName)
                .maybeSingle();

            if (game) this.gameConfig = game;
            else {
                console.warn(`GameBridge: Game "${gameName}" not found in database. Using defaults.`);
                this.gameConfig = { id: '00000000-0000-0000-0000-000000000000', points_reward: 1, xp_reward: 10 };
            }

            this.user = {
                ...profile,
                points: profile.current_points || 0
            };
            console.log('GameBridge: Connected as', this.user.username);

            // 3. Log play session START after 30 seconds (Genuine Engagement)
            // This ensures "accidental" clicks or quick exits don't count as a play.
            setTimeout(async () => {
                if (this.isLogInProgress) return;
                this.isLogInProgress = true;

                await sbGameClient.from('game_play_logs').insert({
                    game_id: this.gameConfig.id,
                    user_id: this.user.id,
                    score: 0 // Initial score
                });
                console.log('GameBridge: Game play logged (30s engagement reached)');
            }, 30000);

            return this.user;
        }

        return null;
    },

    /**
     * Submit score and claim rewards.
     * Auto-calculates points/XP based on DB config.
     * @param {number} score - The player's score.
     * @returns {Promise<{pointsEarned: number, xpEarned: number}>} Rewards earned.
     */
    async submitScore(score) {
        if (!this.user || !this.gameConfig) return { pointsEarned: 0, xpEarned: 0 };

        // EXPLOIT PREVENTION: Only allow one reward per game session
        if (this.hasSubmittedThisSession) {
            console.warn('GameBridge: Reward already claimed this session. Ignoring duplicate submit.');
            return { pointsEarned: 0, xpEarned: 0 };
        }
        this.hasSubmittedThisSession = true;

        // --- CALCULATION ---
        // Points: (Score / 100) * Rate
        // Example: 500 Score / 100 = 5 * 10 Rate = 50 Points
        const pointsEarned = Math.floor(score / 100) * (this.gameConfig.points_reward || 0);

        // XP: Fixed Rate, ONCE per day
        let xpEarned = 0;
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        // Check Play History
        const { data: history } = await sbGameClient
            .from('game_play_history')
            .select('last_played_at')
            .eq('user_id', this.user.id)
            .eq('game_id', this.gameConfig.id)
            .maybeSingle();

        const lastPlayed = history ? new Date(history.last_played_at).toISOString().slice(0, 10) : null;

        if (lastPlayed !== today) {
            xpEarned = this.gameConfig.xp_reward || 0;
        }

        if (pointsEarned === 0 && xpEarned === 0) return { pointsEarned: 0, xpEarned: 0 };

        // --- UPDATES ---

        // 1. Update Profile (Points + XP)
        const { error: profileError } = await sbGameClient.rpc('increment_rewards', {
            p_user_id: this.user.id,
            p_points: pointsEarned,
            p_xp: xpEarned
        });

        // Fallback if RPC not exists (Manual Update - less safe but works for now)
        if (profileError) {
            console.warn("RPC failed, falling back into manual update", profileError);
            const { data: freshProfile } = await sbGameClient.from('profiles').select('current_points, xp').eq('id', this.user.id).single();
            await sbGameClient.from('profiles').update({
                current_points: (freshProfile.current_points || 0) + pointsEarned,
                xp: (freshProfile.xp || 0) + xpEarned
            }).eq('id', this.user.id);
        }

        // 2. Log Point Transaction
        if (pointsEarned > 0) {
            await sbGameClient.from('point_transactions').insert({
                user_id: this.user.id,
                amount: pointsEarned,
                type: 'GAME_REWARD',
                description: `Reward from game: ${this.gameConfig.name} (Score: ${score})`
            });
        }

        // 2a. Log XP Transaction
        if (xpEarned > 0) {
            await sbGameClient.from('xp_transactions').insert({
                user_id: this.user.id,
                amount: xpEarned,
                type: 'GAME_REWARD',
                description: `Reward from game: ${this.gameConfig.name} (Score: ${score})`
            });
        }

        // 3. Update/Upsert Play History
        await sbGameClient
            .from('game_play_history')
            .upsert({
                user_id: this.user.id,
                game_id: this.gameConfig.id,
                last_played_at: new Date().toISOString()
            }, { onConflict: 'user_id, game_id' });

        // 4. Log play session for Trending Analytics
        await sbGameClient.from('game_play_logs').insert({
            game_id: this.gameConfig.id,
            user_id: this.user.id,
            score: score
        });

        // Update local memory
        this.user.points += pointsEarned;
        this.user.xp += xpEarned;

        return { pointsEarned, xpEarned };
    },

    // Legacy support (Deprecated)
    async addReward(amount, reason) {
        console.warn("GameBridge: addReward() is deprecated. Please use submitScore(score).");
        return this.submitScore(amount * 100); // Rough mapping
    }
};
