import { sbClient } from '../core/supabase.js';
import { showNotification, escapeHTML, getRelativeTime, formatFriendlyDate } from '../core/utils.js';
import { calculateUserLevel } from '../modules/ranks.js';
import { initializeUserSession, getCurrentUser } from '../modules/user-session.js';
import { initDuelLeaderboard } from '../modules/duel-leaderboard.js';
import { initDailyQuests } from '../modules/quests.js';
import { calculateDuelRank } from '../modules/duel-ranks.js';
import { renderInventory } from '../modules/inventory.js';
// 🔒 SECURITY: Import security utilities
import { logger } from '../core/logger.js';
import { SecureClient, rateLimiter } from '../core/security.js';
import { sanitizeChatMessage } from '../core/sanitizer.js';

let currentUser = null;
let allStickers = [];
let selectedPowerUp = null; // Phase 5
let duelBetAmount = 50;
let selectedDuelMode = 'Bo3';
let selectedDuelTargetScore = 2;
let selectedDuelTargetId = null;
let replyToId = null;
let activeTextAreaId = 'chatInput';
let presenceChannel = null;
let activeUsers = {};
let messageCache = new Map(); // Store messages content for reply lookups
let typingTimeout = null;
let isCurrentlyTyping = false;
let globalAllRanks = []; // To store rank styling info
let ownedPackIds = new Set();
let selectedPeekUser = null;
let processedMessageIds = new Set(); // To prevent duplicate rendering from dual-channels
let isDuelSubmitting = false; // Prevent double-clicks / race conditions
let selectedImageFile = null;

// Event listener tracking for cleanup
let eventListeners = [];
let windowListeners = [];

/**
 * Helper to add tracked event listeners that can be cleaned up
 */
function addTrackedListener(element, event, handler, options = {}) {
    if (!element) return;
    element.addEventListener(event, handler, options);
    eventListeners.push({ element, event, handler, options });
}

/**
 * Helper to add window/global listeners that need cleanup
 */
function addWindowListener(target, event, handler, options = {}) {
    if (!target) return;
    target.addEventListener(event, handler, options);
    windowListeners.push({ target, event, handler, options });
}

// Pre-defined sounds using AudioContext
function playChatSound(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'send') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
        } else if (type === 'mention') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
        } else { // receive
            osc.type = 'sine';
            osc.frequency.setValueAtTime(400, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
        }

        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
        // Audio might be blocked by browser policy
    }
}

/**
 * 🔒 SECURITY: Error Boundary for Production (SECURITY_RULES.md Rule 45-46)
 * Prevents sensitive error logs from appearing in production console
 */
function setupErrorBoundary() {
    const isDev = window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.port !== '';

    // Global error handler
    window.addEventListener('error', (event) => {
        if (isDev) {
            logger.error('Uncaught error:', event.error);
        } else {
            // Production: Log generically, prevent default console output
            console.error('An error occurred. Please refresh the page.');
            event.preventDefault();
        }
    });

    // Unhandled promise rejection handler
    window.addEventListener('unhandledrejection', (event) => {
        if (isDev) {
            logger.error('Unhandled promise rejection:', event.reason);
        } else {
            // Production: Log generically
            console.error('A network or async error occurred.');
            event.preventDefault();
        }
    });
}

/**
 * Initialize Lobby Page - Exported for SPA Router
 */
export async function initializeLobbyPage() {
    // 🔒 SECURITY: Setup error boundary first (SECURITY_RULES.md)
    setupErrorBoundary();

    // 1. Cleanup old channel if exists
    if (presenceChannel) {
        logger.log('🧹 Cleaning up old Lobby channel...');
        await presenceChannel.unsubscribe();
        presenceChannel = null;
    }

    // 2. Initialize User Session (Enhanced for Mobile Auth)
    // Mobile browsers can take time to recover session, we retry up to 2 times
    let authRetries = 0;
    const maxAuthRetries = 2;

    while (authRetries <= maxAuthRetries) {
        await initializeUserSession();
        currentUser = getCurrentUser();

        if (currentUser && currentUser.isLoggedIn) {
            logger.log('Lobby: Session initialized successfully');
            break;
        }

        if (authRetries < maxAuthRetries) {
            logger.log(`Lobby: Session not ready, retrying (${authRetries + 1}/${maxAuthRetries})...`);
            await new Promise(r => setTimeout(r, 1000));
        }
        authRetries++;
    }

    if (!currentUser || !currentUser.isLoggedIn) {
        logger.warn('Lobby: No user session found after retries. Redirecting to login.');
        // Small delay before redirect to ensure logs are captured
        setTimeout(() => {
            if (!getCurrentUser()?.isLoggedIn) {
                window.location.href = '/index.html?login=true&warning=lobby_auth';
            }
        }, 500);
        return;
    }

    // 1b. Tag Chat-Specific Styles for Router Cleanup
    // This ensures that when we navigate away, the router knows to remove these styles
    const styles = document.head.querySelectorAll('style');
    styles.forEach(style => {
        if (style.innerHTML.includes('Chat Specific Overrides') ||
            style.innerHTML.includes('height: 100dvh')) {
            style.setAttribute('data-page-style', 'true');
        }
    });

    // 2. Initialize UI
    setupRealtime();
    await loadInitialMessages();
    loadStickers();
    initDuelLeaderboard();
    initDailyQuests(currentUser.id);

    // 3. Bind Events (using tracked listeners for cleanup)
    const btnSendChat = document.getElementById('btnSendChat');
    if (btnSendChat) btnSendChat.onclick = sendMessage;

    const chatInput = document.getElementById('chatInput');
    if (!chatInput) {
        logger.error('Lobby: chatInput not found in DOM');
        return;
    }

    // Add audio context unlock listener (once only, doesn't need tracking)
    document.body.addEventListener('click', () => {
        const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (tempCtx.state === 'suspended') tempCtx.resume();
    }, { once: true });

    addTrackedListener(chatInput, 'keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    addTrackedListener(chatInput, 'input', () => {
        handleMentionInput();
        handleTypingState();
    });

    addTrackedListener(chatInput, 'click', handleMentionInput);

    addTrackedListener(chatInput, 'keydown', (e) => {
        const mentionSuggestions = document.getElementById('mentionSuggestions');
        if (mentionSuggestions && !mentionSuggestions.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                closeMentionSuggestions();
            }
        }
    });

    // Auto-scroll to bottom
    scrollToBottom();

    // 4. Mobile Keyboard Height Fix
    // 4. Mobile Keyboard Height Fix (Enhanced)
    const fixHeight = () => {
        const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const doc = document.documentElement;
        doc.style.setProperty('--doc-height', `${height}px`);

        // Ensure body scrolls to bottom if keyboard opens
        if (window.visualViewport && window.visualViewport.height < window.innerHeight) {
            window.scrollTo(0, 0); // Force top alignment so fixed body stays put
            scrollToBottom();
        }
    };

    addWindowListener(window, 'resize', fixHeight);
    addWindowListener(window, 'orientationchange', fixHeight);
    if (window.visualViewport) {
        addWindowListener(window.visualViewport, 'resize', fixHeight);
        addWindowListener(window.visualViewport, 'scroll', fixHeight);
    }
    fixHeight();

    // 5. Auto-resize Textarea
    addTrackedListener(chatInput, 'input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = (chatInput.scrollHeight) + 'px';
        scrollToBottom();
    });

    // 6. Handle Deep-links (e.g. from notifications)
    const urlParams = new URLSearchParams(window.location.search);
    const duelToAccept = urlParams.get('accept_duel');
    if (duelToAccept) {
        logger.log('Deep-link: Auto-accepting duel', duelToAccept);
        // Small delay to ensure everything is initialized
        setTimeout(() => window.acceptDuel(duelToAccept), 1000);
        // Clear param without refresh
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

/**
 * Cleanup Lobby Page - Called when navigating away from lobby
 * Removes all event listeners and resets state
 */
export async function cleanupLobbyPage() {
    logger.log('🧹 Cleaning up Lobby page...');

    // 1. Unsubscribe from Supabase realtime channel
    if (presenceChannel) {
        try {
            await presenceChannel.unsubscribe();
        } catch (e) {
            logger.warn('Error unsubscribing from presence channel:', e);
        }
        presenceChannel = null;
    }

    // 2. Remove all tracked event listeners
    eventListeners.forEach(({ element, event, handler }) => {
        try {
            element.removeEventListener(event, handler);
        } catch (e) {
            logger.warn('Error removing event listener:', e);
        }
    });
    eventListeners = [];

    // 3. Remove all window/global listeners
    windowListeners.forEach(({ target, event, handler }) => {
        try {
            target.removeEventListener(event, handler);
        } catch (e) {
            logger.warn('Error removing window listener:', e);
        }
    });
    windowListeners = [];

    // 4. Clear all timers
    stopDuelTimer();
    if (typingTimeout) {
        clearTimeout(typingTimeout);
        typingTimeout = null;
    }
    if (mentionDebounceTimer) {
        clearTimeout(mentionDebounceTimer);
        mentionDebounceTimer = null;
    }

    // 5. Reset all state variables
    currentUser = null;
    allStickers = [];
    selectedPowerUp = null;
    duelBetAmount = 50;
    selectedDuelMode = 'Bo3';
    selectedDuelTargetScore = 2;
    selectedDuelTargetId = null;
    replyToId = null;
    activeTextAreaId = 'chatInput';
    activeUsers = {};
    messageCache.clear();
    isCurrentlyTyping = false;
    globalAllRanks = [];
    ownedPackIds.clear();
    selectedPeekUser = null;
    processedMessageIds.clear();
    isDuelSubmitting = false;
    selectedImageFile = null;
    mentionQuery = '';
    mentionStartIndex = -1;

    // 6. Force Reset Global Styles (Fix for scroll lock bug)
    document.documentElement.style.height = '';
    document.documentElement.style.overflow = 'auto'; // Force auto to override stylesheet if persists
    document.documentElement.style.overscrollBehavior = '';

    document.body.style.height = '';
    document.body.style.overflow = 'auto'; // Force auto
    document.body.style.overscrollBehavior = '';
    document.body.style.position = '';

    // Remove the forced inline styles after a short delay to allow stylesheet removal to take effect/or next page to load
    setTimeout(() => {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
    }, 100);

    logger.log('✅ Lobby cleanup complete');
}

let mentionQuery = '';
let mentionStartIndex = -1;
let mentionDebounceTimer = null;

function handleMentionInput() {
    const input = document.getElementById('chatInput');
    const text = input.value;
    const cursor = input.selectionStart;

    // Find the last '@' before the cursor
    const lastAt = text.lastIndexOf('@', cursor - 1);

    if (lastAt !== -1) {
        // Check if it's at the start or preceded by a space
        if (lastAt === 0 || text[lastAt - 1] === ' ' || text[lastAt - 1] === '\n') {
            const query = text.substring(lastAt + 1, cursor);
            // Don't show if there's a space between '@' and cursor
            if (!query.includes(' ')) {
                mentionQuery = query.toLowerCase();
                mentionStartIndex = lastAt;

                // Debounce the database search
                clearTimeout(mentionDebounceTimer);
                mentionDebounceTimer = setTimeout(() => {
                    showMentionSuggestions();
                }, 300);
                return;
            }
        }
    }

    closeMentionSuggestions();
}

async function showMentionSuggestions() {
    const list = document.getElementById('mentionList');
    const container = document.getElementById('mentionSuggestions');

    try {
        // Search all users in the profiles table (Global Mention)
        const { data: users, error } = await sbClient
            .from('profiles')
            .select('username, avatar_url')
            .ilike('username', `%${mentionQuery}%`)
            .limit(5); // Show top 5 matches

        if (error) throw error;

        if (!users || users.length === 0) {
            closeMentionSuggestions();
            return;
        }

        list.innerHTML = users.map(u => `
 <div onclick="insertMention('${u.username}')" class="flex items-center gap-3 p-2 hover:bg-yellow-100 cursor-pointer border-b border-gray-100 transition-colors">
 <img src="${u.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + u.username}" class="w-8 h-8 rounded-full border border-black bg-white object-cover">
 <span class="font-bold text-comic-blue">@${u.username}</span>
 </div>
 `).join('');

        container.classList.remove('hidden');
    } catch (err) {
        logger.error('Mention search error:', err);
    }
}

function closeMentionSuggestions() {
    document.getElementById('mentionSuggestions').classList.add('hidden');
}

window.insertMention = (username) => {
    const input = document.getElementById('chatInput');
    const text = input.value;
    const cursor = input.selectionStart;

    const before = text.substring(0, mentionStartIndex);
    const after = text.substring(cursor);

    input.value = before + '@' + username + ' ' + after;
    input.focus();

    // Set cursor position after the space
    const newCursor = mentionStartIndex + username.length + 2;
    input.setSelectionRange(newCursor, newCursor);

    closeMentionSuggestions();
};

function handleTypingState() {
    if (!isCurrentlyTyping) {
        isCurrentlyTyping = true;
        updatePresence(true).catch(err => logger.warn('Presence update failed', err));
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isCurrentlyTyping = false;
        updatePresence(false).catch(err => logger.warn('Presence update failed', err));
    }, 3000);
}

async function updatePresence(isTyping = false) {
    if (!presenceChannel) return;
    await presenceChannel.track({
        id: currentUser.id,
        username: currentUser.username,
        avatar_url: currentUser.avatar_url,
        user_level: currentUser.user_level,
        online_at: new Date().toISOString(),
        isTyping: isTyping
    });
}

/**
 * Load initial 50 messages
 */
async function loadInitialMessages() {
    const chatFeed = document.getElementById('chatFeed');

    // Fetch messages with profile info AND reactions
    // Supabase recursive select: *, profile:profiles(...), reactions:lobby_reactions(*)
    const { data: messages, error } = await sbClient
        .from('lobby_messages')
        .select(`
 *,
 profile:profiles(username, avatar_url, user_level, xp),
 parent:lobby_messages!parent_id(id, content, user_id, profile:profiles(username)),
 reactions:lobby_reactions(*)
 `)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        chatFeed.innerHTML = `<div class="text-center py-10 text-red-500 font-bold">FAIL TO LOAD CHAT: ${error.message}</div>`;
        return;
    }

    // Cache messages
    messages.forEach(msg => {
        messageCache.set(msg.id, msg);
    });

    // Reverse to show oldest first in the bottom-up feed
    renderMessages(messages.reverse(), true);
}

/**
 * Setup Supabase Realtime Subscription (Messages & Presence)
 */
function setupRealtime() {
    presenceChannel = sbClient.channel('public:lobby_room')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_messages' }, (payload) => {
            logger.log('[Realtime] lobby_messages DB event:', payload.eventType, payload);
            handleMessageChange(payload);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_reactions' }, handleReactionChange)
        // Listen for Broadcast messages (Instant Delivery Fallback)
        .on('broadcast', { event: 'new_message' }, ({ payload }) => {
            logger.log('[Realtime] Broadcast message received:', payload);
            handleBroadcastMessage(payload);
        })
        // Listen for Duel Updates (Start/End)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lobby_duels' }, handleDuelChange)
        // Listen for Duel Emotes
        .on('broadcast', { event: 'duel_emote' }, ({ payload }) => {
            handleDuelEmote(payload);
        })
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            updateActiveUsers(state);
        })
        .subscribe(async (status, err) => {
            logger.log('[Realtime] Subscription status:', status, err || '');
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({
                    id: currentUser.id,
                    username: currentUser.username,
                    avatar_url: currentUser.avatar_url,
                    online_at: new Date().toISOString()
                });
            } else if (status === 'CHANNEL_ERROR') {
                logger.error('[Realtime] Channel error:', err);
            } else if (status === 'TIMED_OUT') {
                logger.error('[Realtime] Subscription timed out');
            }
        });
}

/**
 * Helper to broadcast a message to all users in the lobby
 */
function broadcastMessage(msg) {
    if (!presenceChannel) return;

    presenceChannel.send({
        type: 'broadcast',
        event: 'new_message',
        payload: msg
    }).then(resp => {
        logger.log('[Realtime] Broadcast sent status:', resp);
    }).catch(err => {
        logger.warn('[Realtime] Broadcast failed:', err);
    });
}

/**
 * Handle incoming Broadcast messages
 */
function handleBroadcastMessage(msg) {
    // Skip if it's our own message (already shown optimistically)
    if (msg.user_id === currentUser.id) return;

    // Skip if already processed or in DOM (duplicate prevention)
    if (processedMessageIds.has(msg.id)) return;
    if (document.getElementById(`msg-${msg.id}`)) {
        processedMessageIds.add(msg.id);
        return;
    }

    // Mark as processed
    processedMessageIds.add(msg.id);

    // Cache and render
    messageCache.set(msg.id, msg);
    renderMessages([msg], false);
    scrollToBottom();

    // Sound feedback
    const isMentioned = msg.content.includes('@' + currentUser.username);
    playChatSound(isMentioned ? 'mention' : 'receive');
}

/**
 * Handle Duel Updates (Auto-Open Arena)
 */
function handleDuelChange(payload) {
    const duel = payload.new;
    // Check if I am involved
    if (duel.challenger_id === currentUser.id || duel.challenged_id === currentUser.id) {

        // 1. Duel Accepted -> Open Arena
        // 1. Duel Accepted or Round Update -> Open Arena / Sync Animation
        if (duel.status === 'active') {
            // Update Score
            if (document.getElementById('challengerScore')) {
                document.getElementById('challengerScore').innerText = duel.challenger_score || 0;
                document.getElementById('challengedScore').innerText = duel.challenged_score || 0;
            }

            // Only open if not already open
            if (currentDuelId !== duel.id) {
                window.openDuelPlay(duel.id);
                playChatSound('mention');
                showNotification('⚔️ DUEL DIMULAI! Masuk ke Arena!', 'success');
            } else {
                // If already open, detect round resolution to trigger animations
                const oldRounds = payload.old ? (payload.old.rounds || []) : [];
                const newRounds = duel.rounds || [];

                if (newRounds.length > oldRounds.length) {
                    // A round just finished! Trigger the SYNCED animation
                    const lastRound = newRounds[newRounds.length - 1];
                    if (lastRound) triggerArenaBattleAnimation(lastRound);
                } else {
                    // One player moved, waiting for other - Update Icons
                    updateArenaFeedbackIcons(duel);
                }
            }
        }

        // 2. Duel Completed -> Show Final Result
        if (duel.status === 'completed' && payload.old.status === 'active') {
            const statusEl = document.getElementById('duelMoveStatus');
            if (statusEl && currentDuelId === duel.id) {
                document.getElementById('challengerScore').innerText = duel.challenger_score;
                document.getElementById('challengedScore').innerText = duel.challenged_score;

                if (duel.winner_id === currentUser.id) {
                    statusEl.innerText = '🏆 KAMU MENANG DUEL!';
                    statusEl.classList.add('text-green-500');
                    showNotification('🏆 KAMU MENANG DUEL!', 'success');
                } else if (duel.winner_id) {
                    statusEl.innerText = '💀 KAMU KALAH DUEL!';
                    statusEl.classList.add('text-red-500');
                    showNotification('💀 KAMU KALAH DUEL!', 'error');
                } else {
                    statusEl.innerText = '⚖️ DUEL SERI!';
                    showNotification('⚖️ DUEL SERI!', 'warning');
                }

                // Refresh Quests & Leaderboard
                initDailyQuests(currentUser.id);
                initDuelLeaderboard();

                setTimeout(() => {
                    if (currentDuelId === duel.id) {
                        document.getElementById('duelPlayModal').classList.add('hidden');
                        document.getElementById('duelPlayModal').classList.remove('flex');
                        currentDuelId = null;
                    }
                }, 5000);
            }
        }
    }
}

/**
 * Handle Realtime Message Changes
 */
async function handleMessageChange(payload) {
    if (payload.eventType === 'INSERT') {
        const msgId = payload.new.id;

        // Skip if already processed (duplicate prevention)
        if (processedMessageIds.has(msgId)) return;

        // Skip if this message was sent by current user (already shown via optimistic UI)
        if (payload.new.user_id === currentUser.id) {
            processedMessageIds.add(msgId);
            const existingEl = document.getElementById(`msg-${msgId}`);
            if (existingEl) return;
            return;
        }

        // Skip if message already exists in DOM
        if (document.getElementById(`msg-${msgId}`)) {
            processedMessageIds.add(msgId);
            return;
        }

        // Mark as being processed to avoid race condition during async fetch
        processedMessageIds.add(msgId);

        // Fetch full message details
        const { data: newMessage } = await sbClient
            .from('lobby_messages')
            .select(`*, profile:profiles(username, avatar_url, user_level, xp), parent:lobby_messages!parent_id(id, content, user_id, profile:profiles(username)), reactions:lobby_reactions(*)`)
            .eq('id', payload.new.id)
            .single();

        if (newMessage) {
            messageCache.set(newMessage.id, newMessage);
            renderMessages([newMessage], false);
            scrollToBottom();

            // Sound feedback for other users' messages
            const isMentioned = newMessage.content.includes('@' + currentUser.username);
            playChatSound(isMentioned ? 'mention' : 'receive');
        }
    } else if (payload.eventType === 'DELETE') {
        const msgEl = document.getElementById(`msg-${payload.old.id}`);
        if (msgEl) {
            msgEl.remove();
            messageCache.delete(payload.old.id);
        }
    }
}

/**
 * Handle Realtime Reaction Changes
 */
function handleReactionChange(payload) {
    // We just re-fetch the message's reactions or update local state
    // Simpler: Just fetch the single message again to refresh its UI
    const msgId = payload.new.message_id || payload.old.message_id;
    if (msgId) refreshMessageReactions(msgId);
}

/**
 * Refresh a single message's reactions
 */
async function refreshMessageReactions(msgId) {
    const { data: reactions } = await sbClient
        .from('lobby_reactions')
        .select('*')
        .eq('message_id', msgId);

    if (reactions) {
        const reactionContainer = document.getElementById(`reactions-${msgId}`);
        if (reactionContainer) {
            reactionContainer.innerHTML = renderReactionsHTML(reactions, msgId);
        }
    }
}

/**
 * Render messages to the feed
 */
// Tracking for message grouping
let lastRenderedUser = null;
let lastRenderedTime = 0;

/**
 * Render messages to the feed
 */
function renderMessages(messages, isInitial = false) {
    const chatFeed = document.getElementById('chatFeed');
    if (isInitial) {
        chatFeed.innerHTML = '';
        lastRenderedUser = null;
        lastRenderedTime = 0;
    }

    messages.forEach(msg => {
        const isMe = msg.user_id === currentUser.id;
        const msgTime = new Date(msg.created_at).getTime();

        // Grouping Logic: Same user, within 5 minutes
        let isGrouped = false;
        if (msg.user_id === lastRenderedUser && (msgTime - lastRenderedTime < 5 * 60 * 1000)) {
            // Group unless it is a System message
            if (msg.type !== 'system' && msg.user_id !== 'system-dinda' && msg.user_id !== '00000000-0000-0000-0000-000000000000') {
                isGrouped = true;
            }
        }

        const msgHtml = createMessageElement(msg, isMe, isGrouped, isInitial);
        if (isInitial) {
            chatFeed.insertAdjacentHTML('beforeend', msgHtml); // Append for initial load (oldest first logic if handled correctly)
            // Wait, loadInitialMessages reverses messages? 
            // Step 446: renderMessages(messages.reverse(), true). So yes, oldest at top.
        } else {
            chatFeed.insertAdjacentHTML('beforeend', msgHtml);
        }

        // Update tracking
        lastRenderedUser = msg.user_id;
        lastRenderedTime = msgTime;
    });
}

function createMessageElement(msg, isMe, isGrouped, isInitial = false) {
    // Handle System/DINDA Persona
    const isSystemId = !msg.user_id || msg.user_id === '00000000-0000-0000-0000-000000000000' || msg.user_id === 'system-dinda';

    // DINDA Persona Override
    if (isSystemId || msg.type === 'system') {
        msg.user_id = 'system-dinda';
        msg.profile = {
            username: 'DINDA',
            avatar_url: '/images/dinda-avatar.png',
            user_level: 'AI Assistant'
        };
        // Disable "Me" checks for system
        isMe = false;
    }

    const content = parseMessageContent(msg.content, !isInitial);
    const isMentioned = !isMe && msg.content.includes('@' + currentUser.username);

    // Format Time
    const dateObj = new Date(msg.created_at);
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Standard User Messages (Slack Style)
    // Parent Message Snippet
    let replySnippet = '';
    if (msg.parent || msg.parent_id) {
        let parentUser = null;
        let parentContent = '';
        if (msg.parent) {
            if (msg.parent.profile) {
                const p = Array.isArray(msg.parent.profile) ? msg.parent.profile[0] : msg.parent.profile;
                if (p && p.username) parentUser = p.username;
            }
            parentContent = parseMessagePreview(msg.parent.content);
        }
        if (!parentUser && msg.parent_id) {
            const cachedParent = messageCache.get(msg.parent_id);
            if (cachedParent) {
                parentUser = cachedParent.profile?.username;
                if (!parentContent) parentContent = parseMessagePreview(cachedParent.content);
            }
        }
        if (parentUser) {
            if (!parentContent) parentContent = '(pesan tidak tersedia)';
            replySnippet = `
 <div class="mb-1 ml-0.5 flex items-center gap-1 cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
 onclick="document.getElementById('msg-${msg.parent_id}')?.scrollIntoView({behavior: 'smooth', block: 'center'})">
 <div class="w-8 flex justify-end text-gray-300">
 <span class="material-symbols-outlined text-[10px] transform rotate-180">reply</span>
 </div>
 <span class="text-[10px] font-bold text-gray-500 hover:underline">@${parentUser}</span>
 <span class="text-[10px] text-gray-400 truncate max-w-[200px]">${parentContent}</span>
 </div>
 `;
        }
    }

    // Image Attachment
    let imageAttachment = '';
    if (msg.image_url) {
        imageAttachment = `
 <div class="mt-1 mb-1 max-w-sm overflow-hidden rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity" 
 onclick="window.open('${msg.image_url}', '_blank')">
 <img src="${msg.image_url}" class="max-h-64 object-contain block" alt="Attachment">
 </div>
 `;
    }

    // Duel Accept Button (parse from raw content before escaping)
    let duelAcceptButton = '';
    const duelIdMatch = msg.content?.match(/\[DUEL_ID:\s*([^\]]+)\]/);
    if (duelIdMatch && !isMe) {
        const duelId = duelIdMatch[1].trim();
        // Check if current user is the challenged one (mentioned with @)
        const challengedMatch = msg.content?.match(/@(\S+)/);
        const challengedUsername = challengedMatch ? challengedMatch[1] : null;
        if (challengedUsername && challengedUsername === currentUser.username) {
            duelAcceptButton = `
            <div class="mt-2 flex gap-2">
                <button onclick="window.acceptDuel('${duelId}')" class="flex-1 bg-green-500 hover:bg-green-600 text-white font-black text-xs uppercase px-4 py-2 rounded-xl border-2 border-black shadow-comic-xs hover:shadow-none hover:translate-y-0.5 transition-all flex items-center justify-center gap-1">
                    <span class="material-symbols-outlined text-sm">swords</span> TERIMA
                </button>
                <button onclick="window.rejectDuel('${duelId}')" class="flex-1 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs uppercase px-4 py-2 rounded-xl border-2 border-black shadow-comic-xs hover:shadow-none hover:translate-y-0.5 transition-all flex items-center justify-center gap-1">
                    <span class="material-symbols-outlined text-sm">close</span> TOLAK
                </button>
            </div>`;
        }
    }

    // Message Layout (Right align for me, Left for others)
    const alignClass = isMe ? 'flex-row-reverse' : 'flex-row';
    const bubbleColor = isMe ? 'bg-[#e1ffc7] border-green-200' : 'bg-white border-zinc-200'; // WhatsApp-ish green for me
    const textAlign = isMe ? 'text-right' : 'text-left';
    const mentionClass = isMentioned ? 'ring-2 ring-yellow-400 font-bold' : '';

    return `
    <div id="msg-${msg.id}" class="flex ${alignClass} gap-3 items-start group animate-fade-in w-full ${isGrouped ? 'mt-1' : 'mt-4'}">
        <!-- Avatar -->
        <div class="flex-shrink-0 ${isGrouped && !isSystemId ? 'invisible' : ''} flex flex-col items-center">
             <div onclick="window.viewUserProfile('${msg.user_id}')" class="relative cursor-pointer transition-transform hover:scale-105">
                <img src="${msg.profile?.avatar_url || '/images/mr-jdk-mascot.png'}" 
                     onerror="this.onerror=null;this.src='/images/mr-jdk-mascot.png';"
                     class="w-8 h-8 md:w-9 md:h-9 rounded-lg object-cover border border-black bg-white shadow-sm">
             </div>
        </div>

        <!-- Bubble Container -->
        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] md:max-w-[75%]">
            <!-- Username -->
            ${!isMe && !isGrouped ? `
                <div class="flex items-center gap-2 mb-1 pl-1">
                    <span class="text-[10px] md:text-xs font-bold text-zinc-900 cursor-pointer hover:underline" onclick="window.insertMention('${msg.profile?.username}')">
                        ${msg.profile?.username || 'Unknown'}
                    </span>
                    ${msg.profile?.user_level ? `<span class="px-1.5 py-0.5 rounded text-[8px] font-black bg-yellow-300 text-black border border-black tracking-tighter">${msg.profile.user_level}</span>` : ''}
                </div>
            ` : ''}

            <!-- The Bubble -->
            <div class="relative w-fit max-w-full ${bubbleColor} ${mentionClass} border shadow-sm rounded-2xl px-3 py-2 text-sm text-zinc-800 break-words whitespace-pre-wrap leading-tight flex flex-col gap-1">
                ${replySnippet}
                <div class="flex flex-col gap-1">
                    <div class="inline-block align-top">${content}</div>
                    <div class="flex justify-end items-center gap-1 mt-0.5 opacity-50 select-none leading-none">
                        <span class="text-[9px]">${timeStr}</span>
                    </div>
                </div>
                ${imageAttachment}
                ${(msg.reactions && msg.reactions.length > 0) ? `<div id="reactions-${msg.id}" class="flex flex-wrap gap-1 mt-1 justify-end">${renderReactionsHTML(msg.reactions, msg.id)}</div>` : ''}
                ${duelAcceptButton}
                
                <!-- Hover Tools -->
                <div class="absolute -bottom-6 ${isMe ? 'left-0' : 'right-0'} opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10 pointer-events-none group-hover:pointer-events-auto">
                    <button onclick="window.toggleReactionPicker('${msg.id}')" class="p-1.5 bg-white border border-zinc-200 rounded-full shadow-sm text-zinc-500 hover:text-yellow-500 hover:scale-110 transition-transform"><span class="material-symbols-outlined text-[14px]">add_reaction</span></button>
                    <button onclick="window.prepareReply('${msg.id}', '${msg.profile?.username}')" class="p-1.5 bg-white border border-zinc-200 rounded-full shadow-sm text-zinc-500 hover:text-blue-500 hover:scale-110 transition-transform"><span class="material-symbols-outlined text-[14px]">reply</span></button>
                    ${(isMe || currentUser.user_level === 'Admin') ? `<button onclick="window.deleteMessage('${msg.id}')" class="p-1.5 bg-white border border-zinc-200 rounded-full shadow-sm text-zinc-500 hover:text-red-500 hover:scale-110 transition-transform"><span class="material-symbols-outlined text-[14px]">delete</span></button>` : ''}
                </div>
            </div>
        </div>
    </div>`;
}


function renderReactionsHTML(reactions, msgId) {
    if (!reactions || reactions.length === 0) return '';
    const grouped = {};
    reactions.forEach(r => {
        if (!grouped[r.emoji]) grouped[r.emoji] = [];
        grouped[r.emoji].push(r.user_id);
    });
    return Object.entries(grouped).map(([emoji, userIds]) => {
        const count = userIds.length;
        const iReacted = userIds.includes(currentUser.id);
        return `<button onclick="window.toggleReaction('${msgId}', '${emoji}')" class="px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-all hover:scale-105 flex items-center gap-1.5 ${iReacted ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-zinc-50 border-zinc-200 text-zinc-600'}"><span>${emoji}</span><span>${count}</span></button>`;
    }).join('');
}

/**
 * Handle Reactions
 */
window.toggleReaction = async (msgId, emoji) => {
    try {
        // 🔒 SECURITY: Use Edge Function instead of direct insert/delete (Rule 11 & 74)
        await SecureClient.callSecureAction('toggleLobbyReaction', {
            message_id: msgId,
            emoji: emoji
        });
    } catch (err) {
        logger.error('Reaction error:', err);
    }
};

/**
 * Delete Message
 */
window.deleteMessage = async (msgId) => {
    if (!confirm('Hapus pesan ini?')) return;

    try {
        // 🔒 SECURITY: Use Edge Function instead of direct delete (Rule 11 & 74)
        await SecureClient.callSecureAction('deleteLobbyMessage', {
            message_id: msgId
        });
        showNotification('Pesan terhapus', 'success');
    } catch (err) {
        logger.error('Delete error:', err);
        showNotification('Gagal menghapus: ' + err.message, 'error');
    }
};

/**
 * Handle Image Selection
 */
window.handleImageSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showNotification('Foto terlalu besar (Max 5MB)', 'error');
        event.target.value = '';
        return;
    }

    selectedImageFile = file;

    // Show preview
    const previewContainer = document.getElementById('imagePreviewContainer');
    const previewImg = document.getElementById('imagePreview');
    const fileNameEl = document.getElementById('imageFileName');

    const reader = new FileReader();
    reader.onload = (e) => {
        previewImg.src = e.target.result;
        fileNameEl.innerText = file.name;
        previewContainer.classList.remove('hidden');
        scrollToBottom();
    };
    reader.readAsDataURL(file);
};

/**
 * Clear Image Selection
 */
window.clearImageSelection = () => {
    selectedImageFile = null;
    const input = document.getElementById('lobbyImageInput');
    if (input) input.value = '';
    document.getElementById('imagePreviewContainer')?.classList.add('hidden');
};

/**
 * Upload Image to Supabase
 */
async function uploadLobbyImage(file) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `lobby_chats/${fileName}`;

    const { error } = await sbClient.storage
        .from('lobby-uploads')
        .upload(filePath, file);

    if (error) throw error;

    const { data } = sbClient.storage
        .from('lobby-uploads')
        .getPublicUrl(filePath);

    return data.publicUrl;
}

/**
 * Send Message Logic with Optimistic UI
 */
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const content = input.value.trim();

    if (!content && !selectedImageFile) return;

    // Capture state before clearing
    const parentIdToSend = replyToId;
    const parentMsg = parentIdToSend ? messageCache.get(parentIdToSend) : null;
    const imageToUpload = selectedImageFile;

    // Clear UI immediately
    input.value = '';
    input.style.height = 'auto';
    window.cancelReply();
    window.clearImageSelection();

    // Temp ID for optimistic rendering
    const tempId = 'temp-' + Date.now();

    // Create optimistic message object
    const optimisticMsg = {
        id: tempId,
        user_id: currentUser.id,
        content: content,
        image_url: imageToUpload ? URL.createObjectURL(imageToUpload) : null,
        parent_id: parentIdToSend,
        created_at: new Date().toISOString(),
        profile: {
            username: currentUser.username,
            avatar_url: currentUser.avatar_url,
            user_level: currentUser.user_level,
            xp: currentUser.xp || 0
        },
        parent: parentMsg ? {
            id: parentMsg.id,
            content: parentMsg.content,
            user_id: parentMsg.user_id,
            profile: parentMsg.profile
        } : null,
        reactions: []
    };

    // Render immediately
    renderMessages([optimisticMsg], false);
    scrollToBottom();
    playChatSound('send');

    try {
        let uploadedUrl = null;
        if (imageToUpload) {
            uploadedUrl = await uploadLobbyImage(imageToUpload);
        }

        // 🔒 SECURITY: Use Edge Function instead of direct insert (Rule 11 & 74)
        const { message: data } = await SecureClient.callSecureAction('sendLobbyMessage', {
            content: content,
            reply_to: parentIdToSend,
            image_url: uploadedUrl // The Edge Function should handle attachments if supported, or we keep it as is if it just stores the URL
        });

        // Replace optimistic element with real one to sync IDs
        const optimisticEl = document.getElementById(`msg-${tempId}`);
        if (optimisticEl && data) {
            optimisticEl.id = `msg-${data.id}`;
            // Preserve attachment click handlers if needed, though they use data.image_url now
            const img = optimisticEl.querySelector('img[alt="Chat attachment"]');
            if (img && uploadedUrl) {
                img.src = uploadedUrl;
                img.parentElement.onclick = () => window.open(uploadedUrl, '_blank');
            }
            processedMessageIds.add(data.id);
            messageCache.set(data.id, { ...optimisticMsg, ...data });

            // Broadcast for snappier real-time experience
            broadcastMessage({ ...optimisticMsg, ...data });
        }

    } catch (err) {
        logger.error('Send error:', err);
        showNotification('Gagal mengirim: ' + err.message, 'error');
        // Optionally remove the optimistic message
        document.getElementById(`msg-${tempId}`)?.remove();
    }
}

/**
 * Handle Replies
 */
window.prepareReply = (id, username) => {
    replyToId = id;
    document.getElementById('activeReplyBar').classList.remove('hidden');
    document.getElementById('replyRecipient').innerText = `@${username}`;
    document.getElementById('chatInput').focus();
};

window.cancelReply = () => {
    replyToId = null;
    document.getElementById('activeReplyBar').classList.add('hidden');
};

/**
 * Presence / Active Users
 */
function updateActiveUsers(state) {
    const list = document.getElementById('activeUsers');
    // Update global activeUsers dictionary
    activeUsers = {};
    const typingUsers = [];

    // Flatten state
    Object.values(state).forEach(presences => {
        presences.forEach(p => {
            activeUsers[p.username] = p; // Keep latest
            if (p.isTyping && p.id !== currentUser.id) {
                typingUsers.push(p.username);
            }
        });
    });

    // Update Typing Indicator
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        if (typingUsers.length > 0) {
            const names = typingUsers.length > 3
                ? `${typingUsers.slice(0, 3).join(', ')} and ${typingUsers.length - 3} others`
                : typingUsers.join(', ');
            typingIndicator.innerText = `${names} ${typingUsers.length === 1 ? 'is' : 'are'} typing...`;
            typingIndicator.classList.remove('hidden');
        } else {
            typingIndicator.classList.add('hidden');
        }
    }

    const count = Object.keys(activeUsers).length;
    list.innerHTML = `
 <div class="text-xs text-gray-500 mb-2 font-bold">${count} ONLINE</div>
 ${Object.values(activeUsers).map(u => `
 <div onclick="window.openProfilePeek('${u.username}')" class="flex items-center gap-2 p-1 hover:bg-yellow-50 rounded cursor-pointer transition-colors">
 <img src="${u.avatar_url || '/images/mr-jdk-mascot.png'}" 
 onerror="this.onerror=null;this.src='/images/mr-jdk-mascot.png';"
 class="w-6 h-6 rounded-full border border-black bg-white object-cover">
 <span class="text-sm font-bold truncate text-comic-blue">${u.username}</span>
 </div>
 `).join('')}
 `;

    // Update Mobile Count
    const mobileCount = document.getElementById('mobileUserCount');
    if (mobileCount) {
        mobileCount.innerText = `${count} USERS`;
    }
}

// Mobile Sidebar Toggle
window.toggleLobbySidebar = () => {
    const sidebar = document.getElementById('lobbySidebar');
    const overlay = document.getElementById('sidebarOverlay');

    if (sidebar.classList.contains('-translate-x-full')) {
        // Open
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
    } else {
        // Close
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
    }
};


/**
 * View User Profile (called by clicking avatar)
 */
window.viewUserProfile = async (userId) => {
    // 1. Handle DINDA Persona
    if (userId === '00000000-0000-0000-0000-000000000000' || userId === 'system-dinda') {
        selectedPeekUser = {
            id: '00000000-0000-0000-0000-000000000000',
            username: 'DINDA',
            avatar_url: './images/dinda-avatar.png',
            user_level: 'AI Assistant',
            xp: 999999,
            current_points: 1000000
        };
        showDindaPeek();
        return;
    }

    // 2. Standard User: Fetch by ID
    try {
        const { data: user, error } = await sbClient
            .from('profiles')
            .select('username')
            .eq('id', userId)
            .maybeSingle();

        if (error) throw error;
        if (!user) {
            window.showNotification('Profil tidak ditemukan.', 'info');
            return;
        }

        await window.openProfilePeek(user.username);
    } catch (err) {
        logger.error('View profile error:', err);
    }
};

/**
 * Special Peek UI for DINDA
 */
function showDindaPeek() {
    const modal = document.getElementById('userProfilePeek');
    const tipUI = document.getElementById('tipUI');
    if (!modal) return;

    // Reset UI
    if (tipUI) tipUI?.classList.add('hidden');
    modal?.classList.remove('hidden');

    const nameEl = document.getElementById('peekUsername');
    const rankEl = document.getElementById('peekRankName');
    const avatarEl = document.getElementById('peekAvatar');
    const levelEl = document.getElementById('peekLevelBadge');
    const pointsEl = document.getElementById('peekPoints');
    const xpEl = document.getElementById('peekXP');
    const winsEl = document.getElementById('peekDuelWins');
    const lossesEl = document.getElementById('peekDuelLosses');
    const streakEl = document.getElementById('peekDuelStreak');

    if (nameEl) nameEl.innerText = 'DINDA';
    if (rankEl) {
        rankEl.innerText = 'AI Assistant';
        rankEl.style.color = '#fbbf24'; // Yellow
    }
    if (avatarEl) avatarEl.src = selectedPeekUser.avatar_url;
    if (levelEl) levelEl.innerText = 'LVL 99';
    if (pointsEl) pointsEl.innerText = '∞';
    if (xpEl) xpEl.innerText = 'MAX XP';

    // Dummy Stats
    if (winsEl) winsEl.innerText = '777';
    if (lossesEl) lossesEl.innerText = '0';
    if (streakEl) streakEl.innerText = '777';

    // Achievement
    const achList = document.getElementById('peekAchievements');
    if (achList) {
        achList.innerHTML = `
 <div class="group relative flex flex-col items-center">
 <div class="w-10 h-10 bg-yellow-100 border-2 border-yellow-400 rounded-xl flex items-center justify-center text-xl shadow-comic-sm">
 🤖
 </div>
 <span class="absolute bottom-full mb-2 hidden group-hover:block bg-black text-white text-[9px] px-2 py-1 rounded whitespace-nowrap">
 AI Guardian: Melindungi Lobby
 </span>
 </div>
 `;
    }

    // Show Peek
    document.getElementById('profilePeekModal')?.classList.remove('hidden');
    document.getElementById('profilePeekModal')?.classList.add('flex');

    // Buttons
    const btnTip = document.getElementById('btnTipPoints');
    const btnDuel = document.getElementById('btnChallengeDuel');
    btnTip?.classList.add('hidden');
    btnDuel?.classList.remove('hidden');

    window.switchPeekTab('stats');
}

/**

 * Lobby Interaction: Profile Peek
 */
window.openProfilePeek = async (username) => {
    if (!username || username === 'Pesan Terhapus') return;

    const modal = document.getElementById('userProfilePeek');
    const tipUI = document.getElementById('tipUI');

    if (!modal) return;

    // Reset UI
    if (tipUI) tipUI.classList.add('hidden');
    modal.classList.remove('hidden');

    const nameEl = document.getElementById('peekUsername');
    const rankEl = document.getElementById('peekRankName');

    if (nameEl) nameEl.innerText = 'LOADING...';
    if (rankEl) rankEl.innerText = 'Fetching data...';

    try {
        const { data: user, error } = await sbClient
            .from('profiles')
            .select('id, username, avatar_url, user_level, xp, current_points')
            .eq('username', username)
            .maybeSingle();

        if (error) throw error;
        if (!user) {
            window.showNotification('User tidak ditemukan.', 'error');
            modal.classList.add('hidden');
            return;
        }

        selectedPeekUser = user;

        // Update UI using ranks module logic
        const levelInfo = calculateUserLevel(user.xp || 0);

        if (nameEl) nameEl.innerText = user.username;
        if (document.getElementById('peekAvatar')) document.getElementById('peekAvatar').src = user.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.username;
        if (rankEl) {
            rankEl.innerText = levelInfo.rankName;
            rankEl.style.color = levelInfo.rankColor;
        }
        if (document.getElementById('peekLevelBadge')) document.getElementById('peekLevelBadge').innerText = `LVL ${levelInfo.level}`;
        const isMe = user.id === currentUser.id;
        if (document.getElementById('peekPoints')) document.getElementById('peekPoints').innerText = isMe ? (user.current_points || 0) : '🔒 PRIVATE';
        if (document.getElementById('peekXP')) document.getElementById('peekXP').innerText = `${user.xp || 0} XP`;

        // 2. Fetch Duel Stats (NEW for Phase 2)
        const { data: duelStats } = await sbClient
            .from('duel_stats')
            .select('total_wins, total_losses, win_streak')
            .eq('user_id', user.id)
            .maybeSingle();

        if (document.getElementById('peekDuelWins')) document.getElementById('peekDuelWins').innerText = duelStats?.total_wins || 0;
        if (document.getElementById('peekDuelLosses')) document.getElementById('peekDuelLosses').innerText = duelStats?.total_losses || 0;
        if (document.getElementById('peekDuelStreak')) document.getElementById('peekDuelStreak').innerText = duelStats?.win_streak || 0;

        // 3. Duel Rank Badge (Phase 5)
        const duelRankInfo = calculateDuelRank(duelStats?.total_wins || 0);
        const rankBadgeEl = document.getElementById('peekDuelRankBadge');
        if (rankBadgeEl) {
            rankBadgeEl.innerText = `${duelRankInfo.icon} ${duelRankInfo.name}`;
            rankBadgeEl.style.backgroundColor = duelRankInfo.color;
            rankBadgeEl.classList.remove('hidden');
        }

        // 4. Fetch Achievements (NEW for Phase 2)
        const { data: achievements } = await sbClient
            .from('duel_achievements')
            .select('achievement_key')
            .eq('user_id', user.id);

        const achContainer = document.getElementById('peekAchievementsContainer');
        const achList = document.getElementById('peekAchievements');

        if (achievements && achievements.length > 0) {
            const badgeMap = {
                'first_blood': { icon: '🩸', title: 'First Blood', desc: 'Menang duel pertama' },
                'streak_3': { icon: '🔥', title: 'Hot Hand', desc: '3 Win streak' },
                'streak_5': { icon: '🌋', title: 'On Fire', desc: '5 Win streak' },
                'streak_10': { icon: '👑', title: 'Unstoppable', desc: '10 Win streak' },
                'earnings_1k': { icon: '💰', title: 'High Roller', desc: 'Dapatkan 1000+ poin dari duel' },
                'duel_master': { icon: '🎖️', title: 'Master Duelist', desc: '100 total kemenangan duel' }
            };
            if (achList) {
                achList.innerHTML = achievements.map(a => {
                    const info = badgeMap[a.achievement_key] || { icon: '⭐', title: a.achievement_key, desc: '' };
                    return `
    <div class="group relative flex flex-col items-center">
    <div class="w-10 h-10 bg-gray-50 border-2 border-black rounded-xl flex items-center justify-center text-xl shadow-comic-sm hover:scale-110 transition-transform cursor-help">
    ${info.icon}
    </div>
    <span class="absolute bottom-full mb-2 hidden group-hover:block bg-black text-white text-[9px] px-2 py-1 rounded whitespace-nowrap z-20">
    ${info.title}: ${info.desc}
    </span>
    </div>
    `;
                }).join('');
            }
            achContainer?.classList.remove('hidden');
        } else {
            achContainer?.classList.add('hidden');
        }

        // Show Peek
        document.getElementById('profilePeekModal')?.classList.remove('hidden');
        document.getElementById('profilePeekModal')?.classList.add('flex');

        // Hide Buttons if it's me
        const btnTip = document.getElementById('btnTipPoints');
        const btnDuel = document.getElementById('btnChallengeDuel');
        if (user.id === currentUser.id) {
            btnTip?.classList.add('hidden');
            btnDuel?.classList.add('hidden');
        } else {
            btnTip?.classList.remove('hidden');
            btnDuel?.classList.remove('hidden');
        }

        // Reset to Stats Tab (Phase 6)
        window.switchPeekTab('stats');
    } catch (err) {
        logger.error('Profile peek error:', err);
        window.showNotification('Gagal memuat profil.', 'error');
        modal?.classList.add('hidden');
    }
};

window.switchPeekTab = (tab) => {
    const statsView = document.getElementById('peekStatsView');
    const invView = document.getElementById('peekInventoryView');
    const btnStats = document.getElementById('btnPeekStats');
    const btnInv = document.getElementById('btnPeekInv');

    if (!statsView || !invView || !btnStats || !btnInv) return;

    if (tab === 'inventory') {
        statsView?.classList.add('hidden');
        invView?.classList.remove('hidden');
        btnInv?.classList.add('bg-yellow-400', 'shadow-comic-xs');
        btnInv?.classList.remove('bg-white');
        btnStats?.classList.add('bg-white');
        btnStats?.classList.remove('bg-yellow-400', 'shadow-comic-xs');

        // Render Inventory if user is loaded
        if (selectedPeekUser) renderInventory(selectedPeekUser.id);
    } else {
        statsView.classList.remove('hidden');
        invView.classList.add('hidden');
        btnStats.classList.add('bg-yellow-400', 'shadow-comic-xs');
        btnStats.classList.remove('bg-white');
        btnInv.classList.add('bg-white');
        btnInv.classList.remove('bg-yellow-400', 'shadow-comic-xs');
    }
};

window.closeProfilePeek = () => {
    document.getElementById('userProfilePeek').classList.add('hidden');
    selectedPeekUser = null;
};

window.showTipUI = () => {
    document.getElementById('tipUI').classList.remove('hidden');
};

window.hideTipUI = () => {
    document.getElementById('tipUI').classList.add('hidden');
};

window.sendLobbyTip = async (amount) => {
    if (!selectedPeekUser || !currentUser) return;
    if ((currentUser.current_points || 0) < amount) {
        window.showNotification('❌ Poin kamu tidak cukup!', 'error');
        return;
    }

    if (!confirm(`Kirim tip ${amount} Poin ke ${selectedPeekUser.username}?`)) return;

    try {
        window.showNotification('Mengirim tip... 💎');

        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'processLobbyTip',
                receiver_id: selectedPeekUser.id,
                amount: amount
            }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.message || 'Gagal mengirim tip.');

        // Sync local current user state
        if (currentUser) {
            currentUser.current_points = data.new_balance;
            if (currentUser.points !== undefined) currentUser.points = data.new_balance;
            window.dispatchEvent(new CustomEvent('userPointsUpdated', { detail: { points: data.new_balance } }));
        }

        // 4. Send a system-like message to lobby
        // Send tip message via Edge Function (SECURITY FIX)
        const { data: tipData, error: tipMsgErr } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'sendLobbyMessage',
                content: `💎 Memberikan tip ${amount} Poin ke @${selectedPeekUser.username} !`
            }
        });
        const tipMsg = tipData?.success ? tipData.message : null;

        if (!tipMsgErr && tipMsg) {
            broadcastMessage(tipMsg);
            if (!document.getElementById(`msg-${tipMsg.id}`)) {
                renderMessages([tipMsg], false);
                scrollToBottom();
            }
        }

        window.showNotification(`✅ Berhasil mengirim ${amount} Poin!`, 'success');
        window.closeProfilePeek();

    } catch (err) {
        logger.error('Tipping error:', err);
        window.showNotification('Gagal mengirim tip: ' + err.message, 'error');
    }
};

/**
 * Duel Logic
 */
// (Variables moved to top)

window.openDuelSetup = () => {
    if (!selectedPeekUser) return;
    document.getElementById('duelTargetName').innerText = selectedPeekUser.username;
    document.getElementById('duelSetupModal').classList.remove('hidden');
    window.selectDuelBet(50); // Default
};

window.closeDuelSetup = () => {
    document.getElementById('duelSetupModal').classList.add('hidden');
};

window.selectDuelBet = (amount) => {
    duelBetAmount = amount;
    document.querySelectorAll('.duel-bet-btn').forEach(btn => {
        if (parseInt(btn.dataset.amount) === amount) {
            btn.classList.add('bg-yellow-400', 'scale-105');
        } else {
            btn.classList.remove('bg-yellow-400', 'scale-105');
        }
    });
};

window.selectDuelMode = (mode, targetScore) => {
    selectedDuelMode = mode;
    selectedDuelTargetScore = targetScore;
    document.getElementById('btnModeBo3')?.classList.toggle('bg-yellow-400', mode === 'Bo3');
    document.getElementById('btnModeBo3')?.classList.toggle('shadow-comic-xs', mode === 'Bo3');
    document.getElementById('btnModeBo5')?.classList.toggle('bg-yellow-400', mode === 'Bo5');
    document.getElementById('btnModeBo5')?.classList.toggle('shadow-comic-xs', mode === 'Bo5');
};

window.sendDuelChallenge = async () => {
    if (!selectedPeekUser || !currentUser) return;

    if ((currentUser.current_points || 0) < duelBetAmount) {
        showNotification('❌ Poin kamu tidak cukup!', 'error');
        return;
    }

    try {
        showNotification('Mengirim tantangan... ⚔️');

        // 🔒 SECURITY: Use secure Edge Function instead of direct insert
        const { duel } = await SecureClient.callSecureAction('createDuel', {
            challenged_username: selectedPeekUser.username,
            bet_amount: duelBetAmount,
            game_mode: selectedDuelMode,
            target_score: selectedDuelTargetScore
        });

        // 2. Send Invite Message to Chat
        // 🔒 SECURITY: Use Edge Function for invite message (Rule 11 & 74)
        const { message: inviteMsg } = await SecureClient.callSecureAction('sendLobbyMessage', {
            content: `⚔️ ** MENANTANG DUEL ** @${selectedPeekUser.username} dengan taruhan ** ${duelBetAmount} Poin ** ! 👊[DUEL_ID: ${duel.id}]`
        });

        if (inviteMsg) {
            broadcastMessage(inviteMsg);
            // Render for self
            if (!document.getElementById(`msg-${inviteMsg.id}`)) {
                renderMessages([inviteMsg], false);
                scrollToBottom();
            }
        }

        showNotification('Tantangan terkirim! 👊', 'success');
        window.closeDuelSetup();
        window.closeProfilePeek();
    } catch (err) {
        showNotification('Gagal duel: ' + err.message, 'error');
    }
};

window.acceptDuel = async (duelId) => {
    try {
        // Fetch duel details
        const { data: duel } = await sbClient.from('lobby_duels').select('*, challenger:profiles!challenger_id(username)').eq('id', duelId).single();
        if (!duel || duel.status !== 'pending') {
            showNotification('Tantangan sudah kadaluarsa atau dibatalkan.', 'error');
            return;
        }

        if (duel.challenged_id !== currentUser.id) {
            showNotification('Ini bukan tantangan untukmu.', 'error');
            return;
        }

        if ((currentUser.current_points || 0) < duel.bet_amount) {
            showNotification('Poin kamu tidak cukup untuk menerima duel.', 'error');
            return;
        }

        // 🛡️ SECURITY PRE-CHECK: Check if challenger is online (STRICT BLOCKING)
        const challengerName = duel.challenger?.username;
        if (challengerName && (!activeUsers || !activeUsers[challengerName])) {
            showNotification(`⛔ GAGAL: User @${challengerName} sedang OFFLINE.\nDuel tidak dapat dimulai karena lawan tidak ada di Lobby.`, 'error');
            return;
        }

        showNotification('Mempersiapkan arena... 🏟️');

        // 🔒 SECURITY: Use secure Edge Function instead of direct RPC
        const result = await SecureClient.callSecureAction('acceptDuel', {
            duel_id: duelId
        });

        if (!result.success) throw new Error(result.message);

        // Update local session balance (Optimistic)
        if (currentUser && result.new_balance !== undefined) {
            currentUser.current_points = result.new_balance;
            if (currentUser.points !== undefined) currentUser.points = result.new_balance;
            window.dispatchEvent(new CustomEvent('userPointsUpdated', { detail: { points: result.new_balance } }));
        }

        window.openDuelPlay(duelId);

        // Final message broadcast
        if (result.message) {
            broadcastMessage(result.message);
        }

    } catch (err) {
        console.error('Accept Duel Error:', err);
        showNotification('Gagal menerima: ' + err.message, 'error');
    }
};

window.rejectDuel = async (duelId) => {
    if (!duelId) return;
    if (!confirm('Yakin ingin menolak duel ini?')) return;

    try {
        showNotification('Menolak tantangan...', 'info');

        // Update status to cancelled
        // Assuming RLS allows us to update status if we are the challenged user
        const { error } = await sbClient
            .from('lobby_duels')
            .update({ status: 'cancelled' })
            .eq('id', duelId)
            .eq('status', 'pending');

        if (error) throw error;

        showNotification('Tantangan ditolak ❌', 'success');
    } catch (err) {
        console.error('Reject error:', err);
        showNotification('Gagal menolak: ' + err.message, 'error');
    }
};


let currentDuelId = null;
window.openDuelPlay = async (duelId) => {
    currentDuelId = duelId;

    // Fetch current state for scores and names
    const { data: duel } = await sbClient
        .from('lobby_duels')
        .select('*, challenger:profiles!challenger_id(username), challenged:profiles!challenged_id(username)')
        .eq('id', duelId)
        .single();
    if (duel) {
        // Show Game Mode in Title
        const arenaTitle = document.querySelector('#duelPlayModal h2');
        if (arenaTitle) {
            arenaTitle.innerText = `⚔️ DUEL ${duel.game_mode || 'Bo3'} (Main ${duel.target_score || 2})`;
        }

        if (document.getElementById('challengerScore')) {
            document.getElementById('challengerScore').innerText = duel.challenger_score || 0;
            document.getElementById('challengedScore').innerText = duel.challenged_score || 0;

            // Update Labels with Usernames (Safe Check)
            const cLabel = document.getElementById('challengerLabel');
            const dLabel = document.getElementById('challengedLabel');
            if (cLabel) cLabel.innerText = duel.challenger?.username || 'CHALLENGER';
            if (dLabel) dLabel.innerText = duel.challenged?.username || 'LAWAN';

            // Phase 4: Show Streak Badge
            try {
                const { data: stats } = await sbClient.from('duel_stats').select('win_streak').eq('user_id', currentUser.id).maybeSingle();
                const streakBadge = document.getElementById('duelStreakBadge');
                if (stats && stats.win_streak >= 2 && streakBadge) {
                    document.getElementById('duelStreakCount').innerText = stats.win_streak;
                    streakBadge.classList.remove('hidden');
                } else if (streakBadge) {
                    streakBadge.classList.add('hidden');
                }
            } catch (e) { logger.warn('Streak fetch error', e); }

            // Phase 5: Fetch Inventory for Power-Ups
            try {
                const { data: inv } = await sbClient.from('user_inventory').select('item_key, quantity').eq('user_id', currentUser.id);
                const invMap = {};
                (inv || []).forEach(item => invMap[item.item_key] = item.quantity);

                ['shield', 'double', 'vision'].forEach(p => {
                    const count = invMap['powerup_' + p] || 0;
                    const btn = document.getElementById('btnPower' + p.charAt(0).toUpperCase() + p.slice(1));
                    const countEl = document.getElementById('countPower' + p.charAt(0).toUpperCase() + p.slice(1));
                    if (countEl) countEl.innerText = count;
                    if (btn) {
                        btn.dataset.count = count;
                        if (count > 0) btn.classList.remove('grayscale', 'opacity-50', 'pointer-events-none');
                        else btn.classList.add('grayscale', 'opacity-50', 'pointer-events-none');
                    }
                });
            } catch (e) { logger.warn('Inv fetch error', e); }

            selectedPowerUp = null;
            updatePowerUpUI();
        }

        // Initialize Arena Hands
        const challengerHand = document.getElementById('challengerHand');
        const challengedHand = document.getElementById('challengedHand');
        if (challengerHand && challengedHand) {
            const moveIcons = { 'rock': '✊', 'paper': '✋', 'scissors': '✌️' };

            // Determine moves with VISION (X-Ray) logic
            const isChallenger = duel.challenger_id === currentUser.id;
            const myMoveSlot = isChallenger ? 'challenger_move' : 'challenged_move';
            const oppMoveSlot = isChallenger ? 'challenged_move' : 'challenger_move';

            const myMove = duel[myMoveSlot];
            const oppMove = duel[oppMoveSlot];

            if (isChallenger) {
                challengerHand.innerText = myMove ? (moveIcons[myMove] || '✊') : '❓';
                // Vision Logic
                if (oppMove && selectedPowerUp === 'vision') challengedHand.innerText = moveIcons[oppMove] || '✊';
                else challengedHand.innerText = oppMove ? '📫' : '❓';
            } else {
                challengedHand.innerText = myMove ? (moveIcons[myMove] || '✊') : '❓';
                // Vision Logic
                if (oppMove && selectedPowerUp === 'vision') challengerHand.innerText = moveIcons[oppMove] || '✊';
                else challengerHand.innerText = oppMove ? '📫' : '❓';
            }

            challengerHand.className = 'w-16 h-16 flex items-center justify-center text-5xl transition-all';
            challengedHand.className = 'w-16 h-16 flex items-center justify-center text-5xl transition-all scale-x-[-1]';
        }

        // If I already moved, show waiting state
        const myMove = (duel.challenger_id === currentUser.id) ? duel.challenger_move : duel.challenged_move;
        const statusEl = document.getElementById('duelMoveStatus');
        if (statusEl) {
            if (myMove) {
                statusEl.innerText = 'MENUNGGU LAWAN...';
                document.querySelectorAll('.duel-move-btn').forEach(b => b.disabled = true);
                stopDuelTimer(); // Stop timer if already moved
            } else {
                statusEl.innerText = 'PILIH GERAKANMU';
                if (statusEl.classList.contains('animate-pulse')) {
                    // Round just started, keep it clean
                    statusEl.classList.remove('animate-pulse', 'text-green-500');
                }
                document.querySelectorAll('.duel-move-btn').forEach(b => b.disabled = false);
                startDuelTimer(); // Start countdown timer
            }
        }
    }

    // Hide result overlay if showing
    hideDuelResult();

    const playModal = document.getElementById('duelPlayModal');
    if (playModal) {
        playModal.classList.remove('hidden');
        playModal.classList.add('flex');
    }

    // Reset icons to question marks for a fresh round
    resetArenaUI();
};

function resetArenaUI() {
    const cHand = document.getElementById('challengerHand');
    const dHand = document.getElementById('challengedHand');
    const statusEl = document.getElementById('duelMoveStatus');
    const flash = document.getElementById('vsFlash');

    if (cHand) {
        cHand.innerText = '❓';
        cHand.classList.remove('animate-hand-shake', 'animate-reveal-left');
    }
    if (dHand) {
        dHand.innerText = '❓';
        dHand.classList.remove('animate-hand-shake', 'animate-reveal-right');
    }
    if (statusEl) {
        statusEl.classList.remove('animate-pulse', 'text-green-500', 'text-comic-yellow', 'animate-bounce');
        statusEl.innerText = 'PILIH GERAKANMU';
    }
    if (flash) flash.classList.remove('animate-battle-flash');

    // Ensure move buttons are active (not emote buttons)
    document.querySelectorAll('.duel-move-btn').forEach(b => b.disabled = false);
}

window.submitDuelMove = async (move) => {
    if (!currentDuelId || isDuelSubmitting) return;

    isDuelSubmitting = true;
    stopDuelTimer(); // Stop timer when move is submitted

    try {
        const statusEl = document.getElementById('duelMoveStatus');
        if (statusEl) statusEl.innerText = "MENGIRIM...";
        document.querySelectorAll('.duel-move-btn').forEach(b => b.disabled = true);

        const { data: duel } = await sbClient.from('lobby_duels').select('*').eq('id', currentDuelId).single();
        // Submit move via Edge Function (SECURITY FIX)
        const { data: moveData, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'updateDuelMove',
                duel_id: currentDuelId,
                move: move,
                power_up: selectedPowerUp || null
            }
        });

        if (error) throw error;
        if (!moveData.success) throw new Error(moveData.error || 'Failed to submit move');


        // 🔒 SECURITY: Use secure Edge Function instead of direct RPC (Rule #18)
        const result = await SecureClient.callSecureAction('solveDuel', { duel_id: currentDuelId });

        if (result && result.success) {
            // If success, it means the round is solved. 
            // The handleDuelChange subscription will catch this and trigger the SYNCED animation for BOTH players.
            // We don't trigger the animation here anymore to avoid double-animation or sync issues.
            logger.log('[Duel] Round solved, waiting for realtime animation trigger.');
        } else if (result && !result.success && result.is_waiting) {
            // Still waiting for opponent - Keep buttons ENABLED so user can change their move
            if (statusEl) statusEl.innerText = 'MENUNGGU LAWAN...';
            document.querySelectorAll('#duelPlayModal button').forEach(b => b.disabled = false);

            // Update local feedback instantly
            const moveIcons = { 'rock': '✊', 'paper': '✋', 'scissors': '✌️' };
            const mySlot = (duel.challenger_id === currentUser.id) ? 'challengerHand' : 'challengedHand';
            const slotEl = document.getElementById(mySlot);
            if (slotEl) slotEl.innerText = moveIcons[move] || '📫';
        }

    } catch (err) {
        logger.error('[Duel] Submission error:', err);
        showNotification('Gagal submit: ' + err.message, 'error');
        document.querySelectorAll('#duelPlayModal button').forEach(b => b.disabled = false);
    } finally {
        isDuelSubmitting = false;
    }
};

/**
 * Sync Helper: Triggered via Realtime when a round is resolved
 */
function triggerArenaBattleAnimation(roundData) {
    const chalHand = document.getElementById('challengerHand');
    const oppHand = document.getElementById('challengedHand');
    const statusEl = document.getElementById('duelMoveStatus');
    const flash = document.getElementById('vsFlash');
    const moveIcons = { 'rock': '✊', 'paper': '✋', 'scissors': '✌️' };

    if (!chalHand || !oppHand || !statusEl) return;

    // Stop any running timer
    stopDuelTimer();

    // 1. Shake / Anticipation
    chalHand.classList.add('animate-hand-shake');
    oppHand.classList.add('animate-hand-shake');
    statusEl.innerText = "ADU NASIB DIMULAI...";

    setTimeout(() => {
        // 2. Stop shake, add flash
        chalHand.classList.remove('animate-hand-shake');
        oppHand.classList.remove('animate-hand-shake');
        if (flash) flash.classList.add('animate-battle-flash');

        // Play reveal sound
        playDuelSound('reveal');

        // 3. Reveal Actual Hands
        chalHand.innerText = moveIcons[roundData.challenger_move] || '❓';
        oppHand.innerText = moveIcons[roundData.challenged_move] || '❓';

        chalHand.classList.add('animate-reveal-left');
        oppHand.classList.add('animate-reveal-right');

        // Determine result text for this specific round
        let roundResultText = "ROUND SELESAI!";
        if (!roundData.winner_id) {
            roundResultText = "SERI!";
            playDuelSound('tie');
        } else if (roundData.winner_id === currentUser.id) {
            roundResultText = "KAMU MENANG ROUND INI! 🎉";
            playDuelSound('win');
        } else {
            roundResultText = "KAMU KALAH ROUND INI! 💀";
            playDuelSound('lose');
        }

        statusEl.innerText = roundResultText;

        // Visual Polish: Camera Shake for heavy hits or round ends
        const arena = document.getElementById('duelPlayModal')?.querySelector('.relative.bg-white');
        if (arena && roundResultText !== "SERI!") {
            arena.classList.add('animate-shake');
            setTimeout(() => arena.classList.remove('animate-shake'), 500);
        }

        // 4. Cleanup or Next Steps
        setTimeout(() => {
            if (flash) flash.classList.remove('animate-battle-flash');

            // Check if game is finished globally
            sbClient.from('lobby_duels')
                .select('*, challenger:profiles!challenger_id(username), challenged:profiles!challenged_id(username)')
                .eq('id', currentDuelId)
                .single()
                .then(({ data: finalDuel }) => {
                    if (!finalDuel) return;

                    if (finalDuel.status === 'completed') {
                        // Game is over - show result overlay
                        const isWin = finalDuel.winner_id === currentUser.id;
                        const isTie = !finalDuel.winner_id;

                        showDuelResult(
                            isTie ? null : isWin,
                            finalDuel.challenger_score || 0,
                            finalDuel.challenged_score || 0,
                            finalDuel.bet_amount || 0,
                            finalDuel
                        );
                    } else if (finalDuel.status === 'active') {
                        // Continue to next round
                        statusEl.innerText = 'ROUND SELESAI! LANJUT?';
                        statusEl.classList.add('animate-pulse', 'text-green-500');
                        document.querySelectorAll('.duel-move-btn').forEach(b => b.disabled = false);

                        // Reset arena and restart timer after brief pause
                        setTimeout(() => {
                            resetArenaUI();
                            startDuelTimer(); // Start timer for next round
                        }, 2000);
                    }
                });
        }, 2500);
    }, 1500);
}

/**
 * UI Helper: Updates icons as players make choices (synced via realtime)
 */
function updateArenaFeedbackIcons(duel) {
    const challengerHand = document.getElementById('challengerHand');
    const challengedHand = document.getElementById('challengedHand');
    const moveIcons = { 'rock': '✊', 'paper': '✋', 'scissors': '✌️' };

    if (!challengerHand || !challengedHand) return;

    // Show MY actual move icon. If opponent has moved, show envelope (📫).
    if (duel.challenger_id === currentUser.id) {
        challengerHand.innerText = duel.challenger_move ? (moveIcons[duel.challenger_move] || '✊') : '❓';
        challengedHand.innerText = duel.challenged_move ? '📫' : '❓';
    } else {
        challengerHand.innerText = duel.challenger_move ? '📫' : '❓';
        challengedHand.innerText = duel.challenged_move ? (moveIcons[duel.challenged_move] || '✊') : '❓';
    }
}

// ============================================
// PHASE 1 ENHANCEMENTS: Timer, Sounds, Rematch
// ============================================

let duelTimerInterval = null;
let duelTimeRemaining = 10;
let lastDuelData = null; // Store for rematch

/**
 * Duel Sound Effects
 */
function playDuelSound(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        switch (type) {
            case 'tick':
                osc.type = 'square';
                osc.frequency.setValueAtTime(800, ctx.currentTime);
                gain.gain.setValueAtTime(0.05, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
                osc.start();
                osc.stop(ctx.currentTime + 0.05);
                break;

            case 'warning':
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(600, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.2);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
                osc.start();
                osc.stop(ctx.currentTime + 0.2);
                break;

            case 'reveal':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(300, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
                osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.2);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
                osc.start();
                osc.stop(ctx.currentTime + 0.3);
                break;

            case 'win':
                // Victory fanfare - ascending notes
                const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
                notes.forEach((freq, i) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.connect(g);
                    g.connect(ctx.destination);
                    o.type = 'triangle';
                    o.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
                    g.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.1);
                    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.1 + 0.15);
                    o.start(ctx.currentTime + i * 0.1);
                    o.stop(ctx.currentTime + i * 0.1 + 0.15);
                });
                return; // Don't use default osc

            case 'lose':
                // Sad descending notes
                osc.type = 'sine';
                osc.frequency.setValueAtTime(400, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.3);
                osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.5);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                osc.start();
                osc.stop(ctx.currentTime + 0.5);
                break;

            case 'tie':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                osc.frequency.setValueAtTime(440, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
                osc.start();
                osc.stop(ctx.currentTime + 0.2);
                break;
        }
    } catch (e) {
        logger.warn('Audio playback error:', e);
    }
}

/**
 * Timer Countdown System
 */
function startDuelTimer() {
    stopDuelTimer(); // Clear any existing timer
    duelTimeRemaining = 10;

    const timerContainer = document.getElementById('duelTimerContainer');
    const timerText = document.getElementById('duelTimerText');
    const timerCircle = document.getElementById('duelTimerCircle');

    if (!timerContainer || !timerText || !timerCircle) return;

    timerContainer.classList.remove('hidden');
    timerText.innerText = duelTimeRemaining;
    timerCircle.style.strokeDashoffset = '0';

    const circumference = 150.8; // 2 * PI * 24 (radius)

    duelTimerInterval = setInterval(() => {
        duelTimeRemaining--;
        timerText.innerText = duelTimeRemaining;

        // Update circular progress
        const offset = circumference - (duelTimeRemaining / 10) * circumference;
        timerCircle.style.strokeDashoffset = offset;

        // Color changes
        if (duelTimeRemaining <= 3) {
            timerCircle.style.stroke = '#EF4444'; // Red
            timerText.classList.add('text-red-500', 'animate-pulse');
            playDuelSound('warning');
        } else if (duelTimeRemaining <= 5) {
            timerCircle.style.stroke = '#F59E0B'; // Orange
            playDuelSound('tick');
        } else {
            playDuelSound('tick');
        }

        // Time's up - auto submit random move
        if (duelTimeRemaining <= 0) {
            stopDuelTimer();
            autoSubmitRandomMove();
        }
    }, 1000);
}

function stopDuelTimer() {
    if (duelTimerInterval) {
        clearInterval(duelTimerInterval);
        duelTimerInterval = null;
    }

    const timerContainer = document.getElementById('duelTimerContainer');
    const timerText = document.getElementById('duelTimerText');
    const timerCircle = document.getElementById('duelTimerCircle');

    if (timerContainer) timerContainer.classList.add('hidden');
    if (timerText) timerText.classList.remove('text-red-500', 'animate-pulse');
    if (timerCircle) timerCircle.style.stroke = '#FFD400';
}

function autoSubmitRandomMove() {
    const moves = ['rock', 'paper', 'scissors'];
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    showNotification(`⏰ Waktu habis! Auto: ${randomMove.toUpperCase()} `, 'warning');
    window.submitDuelMove(randomMove);
}

/**
 * Quick Emotes
 */
window.sendDuelEmote = (emoji) => {
    if (!currentDuelId) return;

    // Show locally
    showEmoteOnArena(emoji, true);

    // Broadcast to opponent
    if (presenceChannel) {
        presenceChannel.send({
            type: 'broadcast',
            event: 'duel_emote',
            payload: { emoji, duel_id: currentDuelId, user_id: currentUser.id }
        });
    }
};

function handleDuelEmote(payload) {
    if (!currentDuelId || payload.duel_id !== currentDuelId) return;
    if (payload.user_id === currentUser.id) return;
    showEmoteOnArena(payload.emoji, false);
}

function showEmoteOnArena(emoji, isSelf) {
    const arena = document.getElementById('battleArena');
    if (!arena) return;

    const emoteEl = document.createElement('div');
    emoteEl.className = 'absolute text-4xl pointer-events-none z-20';

    // Position based on sender (Roughly under their hand)
    const side = isSelf ? 'left: 20%;' : 'right: 20%;';

    emoteEl.style.cssText = `
 ${side}
 bottom: 25 %;
 animation: float - up 2s ease - out forwards;
 `;
    emoteEl.innerText = emoji;
    arena.appendChild(emoteEl);

    setTimeout(() => emoteEl.remove(), 2000);
}

/**
 * Result Overlay Controller
 */
function showDuelResult(isWin, challengerScore, challengedScore, pointsChange, duelData) {
    lastDuelData = duelData;

    const overlay = document.getElementById('duelResultOverlay');
    const icon = document.getElementById('duelResultIcon');
    const title = document.getElementById('duelResultTitle');
    const score = document.getElementById('duelResultScore');
    const points = document.getElementById('duelResultPoints');

    if (!overlay) return;

    // Determine if I'm challenger or challenged
    const iAmChallenger = duelData.challenger_id === currentUser.id;
    const myScore = iAmChallenger ? challengerScore : challengedScore;
    const oppScore = iAmChallenger ? challengedScore : challengerScore;

    if (isWin === null) {
        // Tie
        icon.innerText = '🤝';
        title.innerText = 'SERI!';
        title.className = 'font-display text-3xl font-black text-yellow-400 mb-2';
        points.innerText = 'Poin dikembalikan';
        points.className = 'text-sm font-bold text-yellow-400 mb-6';
        playDuelSound('tie');
    } else if (isWin) {
        icon.innerText = '🏆';
        title.innerText = 'KAMU MENANG!';
        title.className = 'font-display text-3xl font-black text-green-400 mb-2';
        points.innerText = `+ ${pointsChange} Poin`;
        points.className = 'text-sm font-bold text-green-400 mb-6';
        playDuelSound('win');
    } else {
        icon.innerText = '💀';
        title.innerText = 'KAMU KALAH!';
        title.className = 'font-display text-3xl font-black text-red-400 mb-2';
        points.innerText = `- ${pointsChange} Poin`;
        points.className = 'text-sm font-bold text-red-400 mb-6';
        playDuelSound('lose');
    }

    score.innerText = `${myScore} - ${oppScore} `;

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');

    if (isWin) {
        triggerConfetti(); // Celebration!
    }
}

function hideDuelResult() {
    const overlay = document.getElementById('duelResultOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }
}

/**
 * Rematch System
 */
window.requestRematch = async () => {
    if (!lastDuelData) {
        showNotification('Tidak ada data duel untuk rematch.', 'error');
        return;
    }

    // Determine opponent
    const opponentId = lastDuelData.challenger_id === currentUser.id
        ? lastDuelData.challenged_id
        : lastDuelData.challenger_id;

    const betAmount = lastDuelData.bet_amount;

    // Check points
    if ((currentUser.current_points || 0) < betAmount) {
        showNotification('❌ Poin tidak cukup untuk rematch!', 'error');
        return;
    }

    try {
        showNotification('Mengirim tantangan rematch... 🔄');

        // Close current modal
        hideDuelResult();
        window.closeDuelPlay();

        // Get opponent username for message
        const { data: opponent } = await sbClient
            .from('profiles')
            .select('username')
            .eq('id', opponentId)
            .single();

        // Create new duel via Edge Function (SECURITY FIX)
        const { duel } = await SecureClient.callSecureAction('createDuel', {
            challenged_username: opponent?.username,
            bet_amount: betAmount,
            game_mode: 'Bo3',
            target_score: 2
        });

        // 🔒 SECURITY: Use Edge Function for rematch message
        await SecureClient.callSecureAction('sendLobbyMessage', {
            content: `🔄 ** REMATCH! ** @${opponent?.username || 'lawan'} dengan taruhan ** ${betAmount} Poin ** ! 👊[DUEL_ID: ${duel.id}]`
        });

        showNotification('Tantangan rematch terkirim! 🔄', 'success');

    } catch (err) {
        showNotification('Gagal rematch: ' + err.message, 'error');
    }
};

window.closeDuelPlay = () => {
    stopDuelTimer();
    hideDuelResult();

    const playModal = document.getElementById('duelPlayModal');
    if (playModal) {
        playModal.classList.add('hidden');
        playModal.classList.remove('flex');
    }

    currentDuelId = null;
    lastDuelData = null;
};

// Add CSS animation for floating emotes
const emoteStyles = document.createElement('style');
emoteStyles.textContent = `
 @keyframes float - up {
 0 % { opacity: 0; transform: translateY(20px) scale(0.5); }
 20 % { opacity: 1; transform: translateY(0) scale(1.2); }
 100 % { opacity: 0; transform: translateY(-120px) scale(1.5); }
 }
 @keyframes shake {
 0 %, 100 % { transform: translate(0, 0); }
 10 %, 30 %, 50 %, 70 %, 90 % { transform: translate(-5px, 0); }
 20 %, 40 %, 60 %, 80 % { transform: translate(5px, 0); }
 }
 .animate - shake {
 animation: shake 0.5s cubic - bezier(.36, .07, .19, .97) both;
 }
 .powerup - active {
 grayscale: 0!important;
 opacity: 1!important;
 transform: scale(1.1);
 border - color: #FFD400!important;
 box - shadow: 0 0 15px rgba(255, 212, 0, 0.5);
 }
 `;
document.head.appendChild(emoteStyles);

window.selectPowerUp = (type) => {
    if (selectedPowerUp === type) selectedPowerUp = null;
    else selectedPowerUp = type;
    updatePowerUpUI();
};

function updatePowerUpUI() {
    ['shield', 'double', 'vision'].forEach(p => {
        const btn = document.getElementById('btnPower' + p.charAt(0).toUpperCase() + p.slice(1));
        if (btn) {
            const div = btn.querySelector('div') || btn; // Fallback to btn if no inner div
            const count = parseInt(btn.dataset.count || '0');
            if (selectedPowerUp === p) {
                div.classList.add('border-primary', 'bg-yellow-100', 'scale-110');
                btn.classList.remove('grayscale', 'opacity-50');
            } else {
                div.classList.remove('border-primary', 'bg-yellow-100', 'scale-110');
                if (count <= 0) btn.classList.add('grayscale', 'opacity-50');
            }
        }
    });

    // Re-run arena display to apply Vision if selected mid-game
    if (currentDuelId) {
        sbClient.from('lobby_duels').select('*').eq('id', currentDuelId).single().then(({ data }) => {
            if (data) {
                const cHand = document.getElementById('challengerHand');
                const dHand = document.getElementById('challengedHand');
                const moveIcons = { 'rock': '✊', 'paper': '✋', 'scissors': '✌️' };
                const isChallenger = data.challenger_id === currentUser.id;
                const oppMove = isChallenger ? data.challenged_move : data.challenger_move;
                const oppHandEl = isChallenger ? dHand : cHand;

                if (oppMove && oppHandEl) {
                    if (selectedPowerUp === 'vision') oppHandEl.innerText = moveIcons[oppMove] || '✊';
                    else oppHandEl.innerText = '📫';
                }
            }
        });
    }
}

/**
 * Sticker Picker Logic
 */
async function loadStickers() {
    try {
        // 1. Fetch user's owned packs
        const { data: myPacks } = await sbClient
            .from('user_sticker_packs')
            .select('pack_id')
            .eq('user_id', currentUser.id);

        ownedPackIds = new Set((myPacks || []).map(p => p.pack_id));

        // 2. Fetch stickers (either global or owned)
        const ownedIdsArray = Array.from(ownedPackIds);
        const { data: stickers, error: stickerError } = await sbClient
            .from('stickers')
            .select('*')
            .or(`pack_id.is.null, pack_id.in.(${ownedIdsArray.length > 0 ? ownedIdsArray.map(id => `"${id}"`).join(',') : '"00000000-0000-0000-0000-000000000000"'})`)
            .order('name');

        if (stickerError) throw stickerError;
        allStickers = stickers || [];
        logger.log(`🎨 Loaded ${allStickers.length} stickers.`);
    } catch (e) {
        logger.warn('Sticker load failed:', e);
    }
}

window.switchStickerTab = (tab) => {
    const collTab = document.getElementById('tabStickerCollection');
    const shopTab = document.getElementById('tabStickerShop');
    const emojiTab = document.getElementById('tabStickerEmoji');
    const collList = document.getElementById('stickerList');
    const shopList = document.getElementById('stickerShopList');
    const emojiListContainer = document.getElementById('emojiList');

    // Reset all tabs
    [collTab, shopTab, emojiTab].forEach(t => {
        t?.classList.remove('bg-yellow-400');
        t?.classList.add('bg-white');
    });
    [collList, shopList, emojiListContainer].forEach(l => l?.classList.add('hidden'));

    if (tab === 'collection') {
        collTab?.classList.add('bg-yellow-400');
        collTab?.classList.remove('bg-white');
        collList?.classList.remove('hidden');
        renderStickerList();
    } else if (tab === 'shop') {
        shopTab?.classList.add('bg-yellow-400');
        shopTab?.classList.remove('bg-white');
        shopList?.classList.remove('hidden');
        loadShopPacks();
    } else if (tab === 'emojis') {
        emojiTab?.classList.add('bg-yellow-400');
        emojiTab?.classList.remove('bg-white');
        emojiListContainer?.classList.remove('hidden');
        renderEmojiList();
    }
};

const LOBBY_EMOJIS = [
    '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '👋', '🤚', '🖐', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁', '👅', '👄', '💋', '🩸', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', ' Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗️', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '▶️', '⏸', '⏯', '⏹', '⏺', '⏏️', '⏭', '⏮', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾', '💲', '💱', '™️', '©️', '®️', '👁‍🗨', '🔚', '🔙', '🔛', '🔝', '🔜', '〰️', '➰', '➿', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️'
];

function renderEmojiList() {
    const list = document.getElementById('emojiList');
    if (!list) return;

    list.innerHTML = LOBBY_EMOJIS.map(emoji => `
 <div onclick = "window.insertEmoji('${emoji}')" class="flex items-center justify-center p-2 cursor-pointer hover:bg-yellow-100 rounded text-xl md:text-2xl transition-all hover:scale-125" >
 ${emoji}
 </div >
 `).join('');
}

window.insertEmoji = (emoji) => {
    const textarea = document.getElementById(activeTextAreaId);
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + emoji + text.substring(end);
    textarea.focus();

    // Move cursor after the inserted emoji
    const newCursor = start + emoji.length;
    textarea.setSelectionRange(newCursor, newCursor);

    // Optionally close picker if desired, or keep open for more emojis
    // document.getElementById('stickerPicker').classList.add('hidden');
};

async function loadShopPacks() {
    const list = document.getElementById('stickerShopList');
    list.innerHTML = '<div class="text-center py-4 animate-pulse">Browsing Shop...</div>';

    const { data: packs, error } = await sbClient
        .from('sticker_packs')
        .select('*')
        .order('name');

    if (error) {
        list.innerHTML = '<div class="text-red-500 p-2 text-xs">Error loading shop.</div>';
        return;
    }

    list.innerHTML = packs.map(p => {
        const isOwned = ownedPackIds.has(p.id);
        const price = p.price || 0;
        const priceLabel = price === 0 ? 'FREE' : `${price} PTS`;

        return `
 <div class="flex items-center gap-2 p-2 bg-gray-50 border-2 border-black rounded-lg" >
 <img src="${p.thumbnail_url || '/images/mr-jdk-mascot.png'}" class="w-10 h-10 object-contain bg-white border border-black rounded shadow-sm">
 <div class="flex-1 min-w-0">
 <p class="font-black text-[10px] md:text-xs truncate uppercase">${p.name}</p>
 <p class="text-[8px] text-gray-500 italic truncate">${p.description || 'No description'}</p>
 <p class="text-[8px] font-bold text-comic-blue">${priceLabel}</p>
 </div>
 ${isOwned ?
                `<button disabled class="bg-gray-200 border border-gray-400 px-2 py-1 rounded text-[8px] font-bold text-gray-500 italic">OWNED</button>` :
                `<button onclick="window.unlockStickerPack('${p.id}', ${price})" class="bg-green-400 border-2 border-black px-2 py-1 rounded text-[8px] font-black shadow-sm hover:scale-110 active:scale-95 transition-all">GET</button>`
            }
 </div>
 `;
    }).join('');
}

window.unlockStickerPack = async (packId, price = 0) => {
    // 1. Check if user already owns it (extra safety)
    if (ownedPackIds.has(packId)) return;

    // 2. Confirm purchase if price > 0
    if (price > 0) {
        if ((currentUser.current_points || 0) < price) {
            showNotification(`❌ Poin tidak cukup! Butuh ${price} Poin.`, 'error');
            return;
        }

        if (!confirm(`Beli pack ini seharga ${price} Poin ? `)) return;
    }

    showNotification('Processing... ⏳');

    try {
        // Call secure Supabase Edge Function that handles unlock + point deduction atomically
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'purchaseSticker',
                pack_id: packId
            }
        });

        if (error) throw error;

        if (!data.success) {
            showNotification(`❌ ${data.message || data.error} `, 'error');
            return;
        }

        // Update local state with new balance from server
        if (data.new_balance !== undefined) {
            currentUser.current_points = data.new_balance;
        }


        showNotification('🚀 STICKER PACK BERHASIL DIMILIKI!', 'success');
        await loadStickers(); // Reload owned IDs and stickers
        loadShopPacks(); // Refresh shop UI
    } catch (err) {
        showNotification('Gagal unlock: ' + err.message, 'error');
    }
};

window.toggleStickerPicker = async (targetId = null) => {
    const picker = document.getElementById('stickerPicker');
    // If no targetId is passed, assume current active or close if open
    if (!targetId && !picker.classList.contains('hidden')) {
        picker.classList.add('hidden');
        return;
    }

    if (targetId) activeTextAreaId = targetId;

    // Toggle visibility
    if (picker.classList.contains('hidden')) {
        picker.classList.remove('hidden');
        picker.classList.add('flex', 'flex-col');

        // Position it explicitly if needed, but handled by absolute/fixed usually
        // For lobby, it's absolute near the button
    } else {
        picker.classList.add('hidden');
    }

    renderStickerList();
};

function renderStickerList() {
    const list = document.getElementById('stickerList');
    if (allStickers.length === 0) {
        list.innerHTML = '<div class="col-span-4 text-center text-xs text-gray-400">Loading...</div>';
        return;
    }

    list.innerHTML = allStickers.map(s => `
 <div onclick = "window.insertSticker('${s.url}')" class="cursor-pointer hover:bg-yellow-50 p-1 border-2 border-transparent hover:border-black rounded transition-all" >
 <img src="${s.url}" class="w-full aspect-square object-contain" loading="lazy">
 </div>
 `).join('');
}

window.insertSticker = (url) => {
    const textarea = document.getElementById(activeTextAreaId);
    if (!textarea) return;

    const shortcode = `[STICKER:${url}]`;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    textarea.value = text.substring(0, start) + shortcode + text.substring(end);
    textarea.focus();

    // Close picker
    document.getElementById('stickerPicker').classList.add('hidden');
};

/**
 * Utilities
 */
function parseMessageContent(text, triggerEffects = true) {
    if (!text) return '';

    // 🔒 SECURITY: Sannitize input early (Rule #51)
    const cleanText = sanitizeChatMessage(text);
    let safe = escapeHTML(cleanText).replace(/\n/g, '<br>');

    // 0. Hide DUEL_ID tags (visual only, logic uses raw content)
    safe = safe.replace(/\[DUEL_ID:[^\]]+\]/g, '');

    // 1. Process Stickers first using placeholders to avoid interference with URL/Mention regex
    const stickers = [];
    safe = safe.replace(/\[STICKER:([^\]]+)\]/g, (match, url) => {
        const id = stickers.length;
        stickers.push(`<div class="my-1"><img src="${url}" class="max-w-[100px] max-h-[100px] object-contain hover:scale-105 transition-transform cursor-pointer" onclick="window.open('${url}', '_blank')" alt="sticker"></div>`);
        return `__STICKER_PLACEHOLDER_${id}__`;
    });

    safe = safe.replace(/(^|\s)@([a-zA-Z0-9_-]+)/g, (match, prefix, username) => {
        return `${prefix}<span class="bg-yellow-200 text-comic-blue px-1 rounded border-b-2 border-comic-blue cursor-pointer hover:bg-yellow-300 font-black">@${username}</span>`;
    });

    safe = safe.replace(/(https?:\/\/[^\s]+)/g, (url) => {
        return `<a href="${url}" target="_blank" class="inline-flex items-center gap-1 bg-gray-100 border-2 border-black px-2 py-0.5 rounded text-[10px] md:text-xs font-black hover:bg-yellow-100 transition-colors my-1">
            <span class="truncate max-w-[150px]">${url}</span>
            <span>🔗</span>
        </a>`;
    });

    if (triggerEffects) {
        const keywords = ['JDK', 'GZ', 'WOW', 'LFG', 'HUGE', 'CONGRATS'];
        keywords.forEach(kw => {
            if (new RegExp(`\\b${kw}\\b`, 'gi').test(text)) setTimeout(triggerConfetti, 100);
        });
    }

    return safe.replace(/__STICKER_PLACEHOLDER_(\d+)__/g, (match, id) => stickers[parseInt(id)]);
}

function triggerConfetti() {
    const emojis = ['🎉', '🎊', '✨', '🏆', '⭐'];
    const count = 15;

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'fixed pointer-events-none z-[9999] animate-bounce-up text-2xl';
            el.style.left = Math.random() * 100 + 'vw';
            el.style.top = (Math.random() * 50 + 50) + 'vh';
            el.style.animation = `float-up ${1 + Math.random()}s ease-out forwards`;
            el.innerText = emojis[Math.floor(Math.random() * emojis.length)];
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 2000);
        }, i * 100);
    }

    // Sound also
    playChatSound('mention');
}

function parseMessagePreview(text) {
    if (!text) return '';
    // Strip stickers for preview
    return text.replace(/\[STICKER:[^\]]+\]/g, '📷 Sticker');
}

function scrollToBottom() {
    const feed = document.getElementById('chatFeed');
    if (feed) feed.scrollTop = feed.scrollHeight;
}


// Reaction Picker Logic
let currentReactionMessageId = null;

window.toggleReactionPicker = (messageId) => {
    const picker = document.getElementById('reactionPicker');
    if (!picker) return;

    // Toggle visibility
    if (currentReactionMessageId === messageId && !picker.classList.contains('hidden')) {
        picker.classList.add('hidden');
        picker.classList.remove('flex');
        currentReactionMessageId = null;
        return;
    }

    currentReactionMessageId = messageId;
    picker.classList.remove('hidden');
    picker.classList.add('flex');

    // Positioning Logic
    const msgEl = document.getElementById(`msg-${messageId}`);
    if (!msgEl) return;

    // Find the bubble element (it's the div with background color inside the message container)
    // Structure: #msg-{id} -> div -> div.relative.w-fit (the bubble)
    const bubble = msgEl.querySelector('.relative.w-fit') || msgEl;
    const rect = bubble.getBoundingClientRect();

    // Default position: Slightly above the message, aligned left or right depending on space
    // Using Fixed positioning to be safe relative to viewport
    picker.style.position = 'fixed';

    // Reset classes that might interfere
    picker.classList.remove('bottom-20', 'left-4');

    // Calculate Top
    // Attempt to place above the bubble
    let top = rect.top - picker.offsetHeight - 10;
    // If clips top, place below
    if (top < 10) {
        top = rect.bottom + 10;
    }

    // Calculate Left
    let left = rect.left;

    // Temporarily show to get dimensions (already removed hidden)
    const pickerWidth = 320; // Approx max width
    const windowWidth = window.innerWidth;

    // Check Right Boundary
    if (left + pickerWidth > windowWidth - 10) {
        // Align to right edge of bubble or screen
        left = windowWidth - pickerWidth - 10;
    }

    // Apply
    picker.style.top = `${top}px`;
    picker.style.left = `${left}px`;
    picker.style.bottom = 'auto';
    picker.style.right = 'auto';
};

window.selectReaction = async (emoji) => {
    if (!currentReactionMessageId) return;

    try {
        await window.toggleReaction(currentReactionMessageId, emoji);
        document.getElementById('reactionPicker')?.classList.add('hidden');
        currentReactionMessageId = null;
    } catch (err) {
        logger.error('Failed to add reaction:', err);
        showNotification('Gagal menambahkan reaksi', 'error');
    }
};

// Global Exports
window.sendMessage = sendMessage;
