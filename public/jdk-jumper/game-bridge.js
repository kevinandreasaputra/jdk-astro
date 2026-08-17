// JDK Game Bridge (v2.0 - Secure)
// Refactored to communicate with game-player.html via postMessage
// This prevents direct database access from game iframes.

window.GameBridge = {
    user: null,
    gameConfig: null,
    hasSubmittedThisSession: false,
    _resolveInit: null,
    _resolveSubmit: null,

    /**
     * Initialize the Game Bridge.
     * Communicates with parent to get user/game configuration.
     */
    async init(gameName) {
        this.hasSubmittedThisSession = false;

        return new Promise((resolve) => {
            this._resolveInit = resolve;

            // Request initialization from parent
            window.parent.postMessage({
                type: 'BRIDGE_INIT',
                gameName: gameName
            }, '*');
        });
    },

    /**
     * Submit score and claim rewards.
     * Forwards the request to parent window.
     */
    async submitScore(score, duration = 0) {
        if (this.hasSubmittedThisSession) {
            console.warn('GameBridge: Score already submitted this session.');
            return { pointsEarned: 0, xpEarned: 0 };
        }

        return new Promise((resolve) => {
            this._resolveSubmit = resolve;

            window.parent.postMessage({
                type: 'BRIDGE_SUBMIT_SCORE',
                score: score,
                duration: duration
            }, '*');
        });
    },

    // Handle responses from parent
    _handleMessage(data) {
        if (data.type === 'BRIDGE_INIT_RESPONSE') {
            this.user = data.user;
            this.gameConfig = data.gameConfig;
            if (this._resolveInit) {
                this._resolveInit(this.user);
                this._resolveInit = null;
            }
        }
        else if (data.type === 'BRIDGE_SUBMIT_RESPONSE') {
            this.hasSubmittedThisSession = true;
            if (this._resolveSubmit) {
                this._resolveSubmit({
                    pointsEarned: data.pointsEarned,
                    xpEarned: data.xpEarned
                });
                this._resolveSubmit = null;
            }
        }
    }
};

// Listen for response messages from parent
window.addEventListener('message', (event) => {
    if (event.data && typeof event.data === 'object') {
        window.GameBridge._handleMessage(event.data);
    }
});
