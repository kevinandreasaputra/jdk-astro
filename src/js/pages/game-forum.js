import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { showNotification, getRelativeTime } from '../core/utils.js';
import { calculateUserLevel } from '../modules/ranks.js';
import { getCurrentUser } from '../modules/user-session.js';

let currentGameId = null;
let currentGame = null;
let replyingToCommentId = null;
let replyingToUsername = null;

// Mention functionality variables
let mentionQuery = '';
let mentionStartIndex = -1;
let mentionDebounceTimer = null;

export function initializeGameForumPage() {
    logger.log('Initialize Game Forum Page');

    // Get game ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    currentGameId = urlParams.get('id');

    if (!currentGameId) {
        showNotification('Game tidak ditemukan!', 'error');
        window.location.href = '/games.html';
        return;
    }

    setTimeout(() => {
        loadGameInfo();
        loadComments();
        setupUI();
        setupMentionHandler();
    }, 500);
}

async function loadGameInfo() {
    if (!sbClient || !currentGameId) return;

    try {
        const { data: game, error } = await sbClient
            .from('games')
            .select('*')
            .eq('id', currentGameId)
            .single();

        if (error || !game) {
            showNotification('Game tidak ditemukan!', 'error');
            return;
        }

        currentGame = game;

        // Update Header
        document.getElementById('gameName').textContent = game.name;
        document.getElementById('gameDescription').textContent = game.description || 'No description';
        document.getElementById('gameCategory').textContent = game.category || 'ARCADE';
        document.getElementById('gameImage').src = game.image_url || 'images/comic-background.jpg';
        document.getElementById('playGameBtn').href = `game-player.html?id=${game.id}`;
        document.title = `${game.name} Forum - JDK Entertainment`;

    } catch (err) {
        logger.error('Error loading game:', err);
    }
}

async function loadComments() {
    if (!sbClient || !currentGameId) return;

    const loadingEl = document.getElementById('commentsLoading');
    const emptyEl = document.getElementById('commentsEmpty');
    const listEl = document.getElementById('commentsList');

    try {
        // Load top-level comments with user profiles
        const { data: comments, error } = await sbClient
            .from('game_comments')
            .select(`
                *,
                profiles:user_id (id, username, avatar_url, xp, current_points)
            `)
            .eq('game_id', currentGameId)
            .is('parent_id', null)
            .order('created_at', { ascending: false });

        if (loadingEl) loadingEl.classList.add('hidden');

        if (error) {
            logger.error('Error loading comments:', error);
            listEl.innerHTML = `<p class="text-red-500 text-center py-8">Error loading comments</p>`;
            return;
        }

        // Update comment count
        document.getElementById('commentCount').textContent = comments?.length || 0;

        if (!comments || comments.length === 0) {
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');

        // Load replies and likes for all comments
        const commentIds = comments.map(c => c.id);

        const { data: replies } = await sbClient
            .from('game_comments')
            .select(`
                *,
                profiles:user_id (id, username, avatar_url, xp)
            `)
            .in('parent_id', commentIds)
            .order('created_at', { ascending: true });

        const { data: likes } = await sbClient
            .from('game_comment_likes')
            .select('comment_id, user_id')
            .in('comment_id', commentIds);

        // Group replies by parent
        const repliesByParent = {};
        (replies || []).forEach(reply => {
            if (!repliesByParent[reply.parent_id]) {
                repliesByParent[reply.parent_id] = [];
            }
            repliesByParent[reply.parent_id].push(reply);
        });

        // Group likes by comment
        const likesByComment = {};
        const currentUser = getCurrentUser();
        (likes || []).forEach(like => {
            if (!likesByComment[like.comment_id]) {
                likesByComment[like.comment_id] = { count: 0, userLiked: false };
            }
            likesByComment[like.comment_id].count++;
            if (currentUser && like.user_id === currentUser.id) {
                likesByComment[like.comment_id].userLiked = true;
            }
        });

        // Render comments
        listEl.innerHTML = comments.map(comment => {
            const commentReplies = repliesByParent[comment.id] || [];
            const commentLikes = likesByComment[comment.id] || { count: 0, userLiked: false };
            return renderComment(comment, commentReplies, commentLikes);
        }).join('');

    } catch (err) {
        logger.error('Error:', err);
    }
}

function renderComment(comment, replies = [], likesData = { count: 0, userLiked: false }) {
    const profile = comment.profiles || {};
    const levelData = calculateUserLevel(profile.xp || 0);
    const currentUser = getCurrentUser();
    const isOwner = currentUser && currentUser.id === comment.user_id;

    const repliesHtml = replies.map(reply => {
        const replyProfile = reply.profiles || {};
        const replyLevelData = calculateUserLevel(replyProfile.xp || 0);
        return `
            <div class="flex gap-3 pl-6 border-l-2 border-black/10">
                <a href="profile.html?id=${reply.user_id}" class="flex-shrink-0">
                    <img src="${replyProfile.avatar_url || '/images/mr-jdk-mascot.png'}" 
                         alt="${replyProfile.username}" 
                         class="w-8 h-8 rounded-full border-2 border-black object-cover hover:scale-110 transition-transform">
                </a>
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <a href="profile.html?id=${reply.user_id}" class="font-black text-sm text-black hover:text-primary">${replyProfile.username || 'JDKwan'}</a>
                        <span class="text-[9px] font-bold text-white px-2 py-0.5 rounded-full" style="background: ${replyLevelData.rankColor || '#6b7280'}">${replyLevelData.rankName || 'Member'}</span>
                        <span class="text-[10px] text-gray-400">${getRelativeTime(reply.created_at)}</span>
                    </div>
                    <p class="text-sm text-gray-700 leading-relaxed">${escapeHtml(reply.content)}</p>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="bg-white border-2 border-black rounded-2xl p-4 shadow-comic-sm" data-comment-id="${comment.id}">
            <div class="flex gap-3">
                <a href="profile.html?id=${comment.user_id}" class="flex-shrink-0">
                    <img src="${profile.avatar_url || '/images/mr-jdk-mascot.png'}" 
                         alt="${profile.username}" 
                         class="w-10 h-10 rounded-full border-2 border-black object-cover hover:scale-110 transition-transform">
                </a>
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <a href="profile.html?id=${comment.user_id}" class="font-black text-sm text-black hover:text-primary">${profile.username || 'JDKwan'}</a>
                        <span class="text-[9px] font-bold text-white px-2 py-0.5 rounded-full" style="background: ${levelData.rankColor || '#6b7280'}">${levelData.rankName || 'Member'}</span>
                        <span class="text-[10px] text-gray-400">${getRelativeTime(comment.created_at)}</span>
                    </div>
                    <p class="text-sm text-gray-700 leading-relaxed mb-3">${escapeHtml(comment.content)}</p>
                    
                    <!-- Actions -->
                    <div class="flex items-center gap-4">
                        <button onclick="window.toggleLike('${comment.id}')" 
                            class="flex items-center gap-1 text-xs font-bold ${likesData.userLiked ? 'text-comic-red' : 'text-gray-400 hover:text-comic-red'} transition-colors">
                            <span class="material-symbols-outlined text-base" style="${likesData.userLiked ? 'font-variation-settings: \"FILL\" 1' : ''}">favorite</span>
                            <span id="likeCount-${comment.id}">${likesData.count || ''}</span>
                        </button>
                        <button onclick="window.startReply('${comment.id}', '${profile.username || 'JDKwan'}')" 
                            class="flex items-center gap-1 text-xs font-bold text-gray-400 hover:text-primary transition-colors">
                            <span class="material-symbols-outlined text-base">reply</span>
                            Balas
                        </button>
                        ${isOwner ? `
                        <button onclick="window.deleteComment('${comment.id}')" 
                            class="flex items-center gap-1 text-xs font-bold text-gray-400 hover:text-red-500 transition-colors ml-auto">
                            <span class="material-symbols-outlined text-base">delete</span>
                        </button>
                        ` : ''}
                    </div>
                </div>
            </div>
            
            <!-- Replies -->
            ${replies.length > 0 ? `
            <div class="mt-4 pt-4 border-t border-black/10 space-y-3">
                ${repliesHtml}
            </div>
            ` : ''}
        </div>
    `;
}

function setupUI() {
    const currentUser = getCurrentUser();
    const commentSection = document.getElementById('commentInputSection');
    const loginPrompt = document.getElementById('loginPrompt');

    if (currentUser) {
        if (commentSection) commentSection.classList.remove('hidden');
        if (loginPrompt) loginPrompt.classList.add('hidden');

        // Set current user avatar
        const avatarEl = document.getElementById('currentUserAvatar');
        if (avatarEl && currentUser.avatar_url) {
            avatarEl.src = currentUser.avatar_url;
        }
    } else {
        if (commentSection) commentSection.classList.add('hidden');
        if (loginPrompt) loginPrompt.classList.remove('hidden');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== MENTION FUNCTIONALITY =====

function setupMentionHandler() {
    const input = document.getElementById('commentInput');
    if (!input) return;

    input.addEventListener('input', handleMentionInput);
    input.addEventListener('keydown', (e) => {
        // Close suggestions on ESC
        if (e.key === 'Escape') {
            closeMentionSuggestions();
        }
    });

    // Close suggestions when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#commentInputSection')) {
            closeMentionSuggestions();
        }
    });
}

function handleMentionInput() {
    const input = document.getElementById('commentInput');
    const text = input.value;
    const cursor = input.selectionStart;

    // Find the last '@' before the cursor
    const lastAt = text.lastIndexOf('@', cursor - 1);

    if (lastAt !== -1) {
        // Check if it's at the start or preceded by a space/newline
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

    if (!list || !container) return;

    try {
        // Search users matching the query
        const { data: users, error } = await sbClient
            .from('profiles')
            .select('id, username, avatar_url')
            .ilike('username', `%${mentionQuery}%`)
            .limit(5);

        if (error) throw error;

        if (!users || users.length === 0) {
            closeMentionSuggestions();
            return;
        }

        list.innerHTML = users.map(u => `
            <div onclick="window.insertMention('${u.username}')" 
                 class="flex items-center gap-3 p-2 hover:bg-yellow-100 cursor-pointer border-b border-gray-100 transition-colors">
                <img src="${u.avatar_url || '/images/mr-jdk-mascot.png'}" 
                     class="w-8 h-8 rounded-full border border-black bg-white object-cover">
                <span class="font-bold text-comic-blue">@${u.username}</span>
            </div>
        `).join('');

        container.classList.remove('hidden');
    } catch (err) {
        logger.error('Mention search error:', err);
    }
}

function closeMentionSuggestions() {
    const container = document.getElementById('mentionSuggestions');
    if (container) container.classList.add('hidden');
}

window.insertMention = (username) => {
    const input = document.getElementById('commentInput');
    const text = input.value;
    const cursor = input.selectionStart;

    const before = text.substring(0, mentionStartIndex);
    const after = text.substring(cursor);

    input.value = before + '@' + username + ' ' + after;
    input.focus();

    // Set cursor position after the mention
    const newCursor = mentionStartIndex + username.length + 2;
    input.setSelectionRange(newCursor, newCursor);

    closeMentionSuggestions();
};

// Extract mentioned usernames from content
function extractMentions(content) {
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push(match[1]);
    }
    return [...new Set(mentions)]; // Remove duplicates
}

// Send notification to mentioned users
async function sendMentionNotifications(content, gameName) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const mentionedUsernames = extractMentions(content);
    if (mentionedUsernames.length === 0) return;

    try {
        // Get user IDs for mentioned usernames
        const { data: users } = await sbClient
            .from('profiles')
            .select('id, username')
            .in('username', mentionedUsernames);

        if (!users || users.length === 0) return;

        // Send private message to each mentioned user via Edge Function
        for (const user of users) {
            if (user.id === currentUser.id) continue;

            const mentionContent = `💬 @${currentUser.username} menyebut kamu di forum game "${gameName}":\n\n"${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"\n\n🎮 Lihat komentar: ${window.location.href}`;

            await sbClient.functions.invoke('jdk-secure-handler', {
                body: { action: 'sendMentionNotification', receiver_id: user.id, content: mentionContent }
            });
        }

        logger.log(`Sent mention notifications to ${users.length} users`);
    } catch (err) {
        logger.error('Error sending mention notifications:', err);
    }
}

// Global functions
window.submitComment = async function () {
    const input = document.getElementById('commentInput');
    const content = input?.value?.trim();

    if (!content) {
        showNotification('Tulis komentar terlebih dahulu!', 'warning');
        return;
    }

    const currentUser = getCurrentUser();
    if (!currentUser) {
        showNotification('Login untuk berkomentar!', 'warning');
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'gameComment', game_id: currentGameId, content: content }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal mengirim komentar');

        // Send notifications to mentioned users
        if (currentGame?.name) {
            await sendMentionNotifications(content, currentGame.name);
        }

        input.value = '';
        showNotification('Komentar berhasil dikirim! 💬');
        loadComments();

    } catch (err) {
        logger.error('Error posting comment:', err);
        showNotification(err.message || 'Gagal mengirim komentar', 'error');
    }
};

window.startReply = function (commentId, username) {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        showNotification('Login untuk membalas!', 'warning');
        return;
    }

    replyingToCommentId = commentId;
    replyingToUsername = username;

    const replyBox = document.getElementById('replyBox');
    const replyToEl = document.getElementById('replyToUsername');
    const replyInput = document.getElementById('replyInput');

    if (replyBox) replyBox.classList.remove('hidden');
    if (replyToEl) replyToEl.textContent = `@${username}`;
    if (replyInput) replyInput.focus();
};

window.cancelReply = function () {
    replyingToCommentId = null;
    replyingToUsername = null;

    const replyBox = document.getElementById('replyBox');
    const replyInput = document.getElementById('replyInput');

    if (replyBox) replyBox.classList.add('hidden');
    if (replyInput) replyInput.value = '';
};

window.submitReply = async function () {
    if (!replyingToCommentId) return;

    const input = document.getElementById('replyInput');
    const content = input?.value?.trim();

    if (!content) {
        showNotification('Tulis balasan terlebih dahulu!', 'warning');
        return;
    }

    const currentUser = getCurrentUser();
    if (!currentUser) {
        showNotification('Login untuk membalas!', 'warning');
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'gameComment', game_id: currentGameId, content: content, parent_id: replyingToCommentId }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal mengirim balasan');

        showNotification('Balasan berhasil dikirim! 💬');
        window.cancelReply();
        loadComments();

    } catch (err) {
        logger.error('Error posting reply:', err);
        showNotification(err.message || 'Gagal mengirim balasan', 'error');
    }
};

window.toggleLike = async function (commentId) {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        showNotification('Login untuk like komentar!', 'warning');
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'toggleGameCommentLike', comment_id: commentId }
        });

        if (error) throw error;

        // Refresh comments to update UI
        loadComments();

    } catch (err) {
        logger.error('Error toggling like:', err);
    }
};

window.deleteComment = async function (commentId) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    if (!confirm('Hapus komentar ini?')) return;

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'deleteGameComment', comment_id: commentId }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal menghapus komentar');

        showNotification('Komentar dihapus');
        loadComments();

    } catch (err) {
        logger.error('Error deleting comment:', err);
        showNotification(err.message || 'Gagal menghapus komentar', 'error');
    }
};
