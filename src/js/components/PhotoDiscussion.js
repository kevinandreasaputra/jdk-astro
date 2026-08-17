import { logger } from '../core/logger.js';
/**
 * PhotoDiscussion Component
 * UI for Photo Thread & Comments
 */

import { fetchDiscussion, addComment, toggleLike, deleteComment, subscribeToDiscussion } from '../modules/photoDiscussionService.js';
import { supabase } from '../core/supabase.js';

export class PhotoDiscussion {
    constructor(containerId, publicId) {
        this.container = document.getElementById(containerId);
        this.publicId = publicId;
        this.discussionId = null;
        this.currentUser = null;
        this.data = null;
        this.subscription = null;

        // Expose instance for inline handlers
        window.photoDiscussion = this;

        this.init();
    }

    async init() {
        this.renderLoading();

        // Get Current User
        const { data: { user } } = await supabase.auth.getUser();
        this.currentUser = user;

        // Load Data
        const result = await fetchDiscussion(this.publicId);

        if (!result || result.error) {
            this.renderError('Discussion not found.', result?.error);
            return;
        }

        this.data = result;

        this.discussionId = this.data.id;

        this.render();
        this.setupRealtime();
    }

    renderLoading() {
        this.container.innerHTML = `
            <div class="flex justify-center items-center h-64">
                <div class="text-center">
                    <span class="material-symbols-outlined animate-spin text-4xl text-primary mb-2">refresh</span>
                    <p class="font-bold">Loading discussion...</p>
                </div>
            </div>
        `;
    }

    renderError(msg, sysError = null) {
        this.container.innerHTML = `
            <div class="bg-red-100 border-2 border-red-500 text-red-700 p-4 rounded-xl text-center font-bold break-words">
                <p>⚠️ ${msg}</p>
                <div class="mt-2 text-xs bg-white/50 p-2 rounded text-left font-mono">
                    <p>ID: ${this.publicId}</p>
                    ${sysError ? `<p>Err: ${sysError.message || JSON.stringify(sysError)}</p>` : ''}
                    ${sysError?.code ? `<p>Code: ${sysError.code}</p>` : ''}
                </div>
            </div>
        `;
    }

    render() {
        if (!this.data) return;

        // Organize comments into tree
        const commentTree = this.buildCommentTree(this.data.comments);

        this.container.innerHTML = `
            <div class="photo-discussion-layout h-full flex flex-col">
                
                <!-- 1. Stats & Actions Bar -->
                <div class="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
                    <div class="flex items-center gap-4">
                        <!-- Like Button -->
                        <button id="likeBtn" class="group flex items-center gap-2 px-4 py-2 rounded-full font-black uppercase transition-all duration-300 ${this.data.has_liked ? 'bg-comic-red text-white shadow-[0_0_15px_rgba(255,0,0,0.5)]' : 'bg-white/10 text-white hover:bg-white/20'}">
                            <span class="material-symbols-outlined text-2xl group-hover:scale-110 transition-transform ${this.data.has_liked ? 'fill-current' : ''}">${this.data.has_liked ? 'favorite' : 'favorite_border'}</span>
                            <span class="text-sm">
                                <span id="likeCount" class="text-lg">${this.data.likes_count || 0}</span>
                            </span>
                        </button>

                        <!-- Comment Count -->
                        <div class="flex items-center gap-2 text-gray-400 font-bold px-3 py-2">
                            <span class="material-symbols-outlined">chat_bubble</span> 
                            <span>${this.data.comments.length}</span>
                        </div>
                    </div>

                    <!-- Badge -->
                    ${this.data.event_id ? `
                        <div class="flex items-center gap-1 bg-yellow-500/20 text-yellow-500 text-[10px] font-black uppercase px-2 py-1 rounded border border-yellow-500/30 tracking-widest">
                            <span class="material-symbols-outlined text-sm">event</span> EVENT
                        </div>
                    ` : ''}
                </div>

                <!-- 2. Scrollable Content Area -->
                <div class="flex-1 overflow-y-auto custom-scrollbar pr-2 -mr-2 space-y-6">
                    
                    <!-- Caption Section -->
                    ${this.data.caption ? `
                        <div class="bg-white/5 rounded-xl p-4 border border-white/5 relative">
                            <span class="absolute -top-3 -left-2 text-4xl text-white/10 font-serif">"</span>
                            <p class="font-bold text-gray-200 leading-relaxed pl-2 relative z-10">${escapeHtml(this.data.caption)}</p>
                            <div class="mt-3 flex items-center gap-2 border-t border-white/5 pt-3">
                                <img src="${this.data.created_by?.avatar_url || '/images/jdk-logo.png'}" class="w-6 h-6 rounded-full border border-white/20 object-cover">
                                <span class="text-[10px] text-gray-500 font-black uppercase tracking-wider">
                                    ${this.data.created_by ? this.data.created_by.username : 'ADMIN'}
                                </span>
                            </div>
                        </div>
                    ` : ''}

                    <!-- Comments List -->
                    <div id="commentsList" class="space-y-4 pb-4">
                        ${commentTree.length > 0 ? commentTree.map(c => this.renderCommentNode(c)).join('') : `
                            <div class="flex flex-col items-center justify-center py-12 text-gray-600 opacity-50">
                                <span class="material-symbols-outlined text-5xl mb-2">forum</span>
                                <p class="font-bold text-sm uppercase tracking-widest">No comments yet</p>
                            </div>
                        `}
                    </div>
                </div>

                <!-- 3. Fixed Input Area (Bottom) -->
                <div class="mt-6 pt-4 border-t border-white/10">
                    ${this.currentUser ? `
                        <div class="flex gap-3 items-end">
                            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-yellow-600 flex-shrink-0 p-[2px]">
                                <img src="${this.currentUser.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${this.currentUser.email}&background=0D8ABC&color=fff`}" 
                                    class="w-full h-full rounded-full object-cover bg-black">
                            </div>
                            <div class="flex-1 relative">
                                <textarea id="mainCommentInput" 
                                    class="w-full bg-black/30 border border-white/10 rounded-2xl py-3 px-4 text-white text-sm focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all resize-none shadow-inner" 
                                    rows="1" 
                                    placeholder="Add a comment..."></textarea>
                                <button id="postCommentBtn" 
                                    class="absolute right-2 bottom-2 text-primary hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors disabled:opacity-50">
                                    <span class="material-symbols-outlined text-xl">send</span>
                                </button>
                            </div>
                        </div>
                    ` : `
                        <button onclick="openLoginModal()" class="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 border-dashed text-gray-400 hover:text-white font-bold text-sm transition-all uppercase tracking-wide flex items-center justify-center gap-2 group">
                            <span class="material-symbols-outlined group-hover:scale-110 transition-transform">login</span>
                            Login to Comment
                        </button>
                    `}
                </div>

            </div>
        `;

        this.addEventListeners();
    }

    renderCommentNode(comment, level = 0) {
        const isOwner = this.currentUser && this.currentUser.id === comment.user.id;
        const isAdmin = false; // Placeholder for admin check

        return `
            <div class="comment-node group" id="comment-${comment.id}" style="margin-left: ${level * 2}rem">
                <div class="flex gap-4">
                    <img src="${comment.user.avatar_url || 'https://placehold.co/40x40?text=' + comment.user.username.charAt(0)}" 
                        class="w-10 h-10 rounded-full object-cover border border-white/10 flex-shrink-0">
                    
                    <div class="flex-1">
                        <div class="bg-white/5 p-3 rounded-xl rounded-tl-none border border-white/5 relative group-hover:border-white/10 transition-colors">
                            <div class="flex justify-between items-start mb-1">
                                <span class="font-bold text-primary text-sm">${escapeHtml(comment.user.username)}</span>
                                <span class="text-[10px] text-gray-500 font-mono uppercase">${timeAgo(comment.created_at)}</span>
                            </div>
                            
                            <p class="text-gray-200 text-sm leading-relaxed ${comment.is_deleted ? 'italic text-gray-500' : ''}">
                                ${escapeHtml(comment.content)}
                            </p>
                        </div>

                        <!-- Actions -->
                        <div class="flex items-center gap-4 mt-1 ml-1">
                            ${!comment.is_deleted && this.currentUser && level < 2 ? `
                                <button onclick="window.photoDiscussion.showReplyForm('${comment.id}')" class="text-xs font-bold text-gray-500 hover:text-white transition-colors uppercase tracking-wider">Reply</button>
                            ` : ''}
                            
                            ${!comment.is_deleted && (isOwner || isAdmin) ? `
                                <button onclick="window.photoDiscussion.confirmDelete('${comment.id}')" class="text-xs font-bold text-red-500/50 hover:text-red-500 transition-colors uppercase tracking-wider">Delete</button>
                            ` : ''}
                        </div>

                        <!-- Reply Form Container -->
                        <div id="reply-form-${comment.id}" class="hidden mt-3 pl-4 border-l-2 border-primary/30">
                            <!-- Injected JS -->
                        </div>
                    </div>
                </div>

                <!-- Nested Replies -->
                ${comment.replies && comment.replies.length > 0 ? `
                    <div class="mt-4 space-y-4 relative">
                        <!-- Connecting Line -->
                        <div class="absolute top-0 bottom-0 left-[20px] w-px bg-white/10 -z-10"></div>
                        ${comment.replies.map(r => this.renderCommentNode(r, level + 1)).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    buildCommentTree(comments) {
        const map = {};
        const roots = [];

        // Init map
        comments.forEach(c => {
            map[c.id] = { ...c, replies: [] };
        });

        // Build tree
        comments.forEach(c => {
            if (c.parent_id && map[c.parent_id]) {
                map[c.parent_id].replies.push(map[c.id]);
            } else {
                roots.push(map[c.id]);
            }
        });

        return roots;
    }

    addEventListeners() {
        const likeBtn = document.getElementById('likeBtn');
        if (likeBtn) likeBtn.addEventListener('click', () => this.handleLike());

        const mainInput = document.getElementById('mainCommentInput');
        if (mainInput) {
            mainInput.addEventListener('input', function () {
                this.style.height = 'auto';
                this.style.height = (this.scrollHeight) + 'px';
            });
        }

        const postBtn = document.getElementById('postCommentBtn');
        if (postBtn) postBtn.addEventListener('click', () => this.handlePostComment());
    }

    async handleLike() {
        if (!this.currentUser) return alert('Please login to like');

        const btn = document.getElementById('likeBtn');
        const countSpan = document.getElementById('likeCount');
        const isLiked = btn.classList.contains('bg-comic-red');

        if (isLiked) {
            btn.classList.remove('bg-comic-red', 'text-white');
            btn.classList.add('bg-white/10', 'text-white');
            btn.querySelector('.material-symbols-outlined').textContent = 'favorite_border';
            btn.querySelector('.material-symbols-outlined').classList.remove('fill-current');
            countSpan.textContent = parseInt(countSpan.textContent) - 1;
        } else {
            btn.classList.add('bg-comic-red', 'text-white');
            btn.classList.remove('bg-white/10', 'text-white');
            btn.querySelector('.material-symbols-outlined').textContent = 'favorite';
            btn.querySelector('.material-symbols-outlined').classList.add('fill-current');
            countSpan.textContent = parseInt(countSpan.textContent) + 1;
        }

        await toggleLike(this.discussionId);
    }

    async handlePostComment(parentId = null) {
        let content;
        if (parentId) {
            const input = document.getElementById(`reply-input-${parentId}`);
            content = input.value.trim();
        } else {
            const input = document.getElementById('mainCommentInput');
            content = input.value.trim();
        }

        if (!content) return;

        try {
            const newComment = await addComment(this.discussionId, content, parentId);

            // Immediate UI Update (Optimistic-ish)
            this.data.comments.push(newComment);
            this.render();

            if (parentId) {
                this.hideReplyForm(parentId);
            } else {
                document.getElementById('mainCommentInput').value = '';
                document.getElementById('mainCommentInput').style.height = 'auto';
            }

            // Scroll to new comment (optional, but nice)
            // setTimeout(() => {
            //     const el = document.getElementById(`comment-${newComment.id}`);
            //     if(el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // }, 100);

        } catch (error) {
            logger.error('Comment failed:', error);
            alert('Failed to post comment');
        }
    }

    showReplyForm(commentId) {
        const container = document.getElementById(`reply-form-${commentId}`);
        container.innerHTML = `
        <div class="flex gap-2">
            <textarea id="reply-input-${commentId}" class="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-white text-sm focus:border-primary transition-colors" rows="1" placeholder="Write a reply..."></textarea>
            <button onclick="window.photoDiscussion.handlePostComment('${commentId}')" class="bg-primary hover:bg-yellow-400 text-black px-3 py-1 rounded font-bold text-xs uppercase h-fit mt-1 transition-colors">Reply</button>
        </div>
    `;
        container.classList.remove('hidden');
    }

    hideReplyForm(commentId) {
        const container = document.getElementById(`reply-form-${commentId}`);
        container.classList.add('hidden');
        container.innerHTML = '';
    }

    async confirmDelete(commentId) {
        if (confirm('Are you sure you want to delete this comment?')) {
            await deleteComment(commentId);
        }
    }

    setupRealtime() {
        this.subscription = subscribeToDiscussion(this.discussionId, async (payload) => {
            this.data = await fetchDiscussion(this.publicId);
            this.render();
        });
    }
    async destroy() {
        if (this.subscription) {
            await supabase.removeChannel(this.subscription);
            this.subscription = null;
        }
        this.container.innerHTML = '';
        window.photoDiscussion = null;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function timeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
}

// Global exposure
window.PhotoDiscussion = PhotoDiscussion;
