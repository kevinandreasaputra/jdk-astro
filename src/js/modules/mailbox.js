import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Mailbox & Notification Module
 */
import { sbClient } from '../core/supabase.js';
import { showNotification, formatFriendlyDate } from '../core/utils.js';

export let unreadCount = 0;

/**
 * Initialize Mailbox functionality
 */
export async function initializeMailbox() {
    const user = window.currentUser;
    if (!user || !user.isLoggedIn) return;

    await updateUnreadCount();

    // Check if we are on the mailbox page
    if (window.location.pathname.includes('mailbox.html')) {
        await initializeMailboxPage();
    }
}

/**
 * Initialize the standalone Mailbox Page
 */
export async function initializeMailboxPage() {
    const user = window.currentUser;
    if (!user) {
        // Redirect if not logged in
        window.location.href = 'index.html?login=true&warning=mailbox_auth';
        return;
    }

    // Expose functions to window scope for HTML onclicks
    window.switchMailPageTab = switchMailPageTab;
    window.switchMessageSubTabPage = switchMessageSubTabPage;
    window.viewMailPageDetail = viewMailPageDetail;
    window.backToMailList = backToMailPageList;
    window.openComposePage = openComposePage;
    window.cancelComposePage = cancelComposePage;
    window.handleSendPage = handleSendPage;
    window.sendReplyPage = sendReplyPage;
    window.deleteMessage = deleteMessage;

    // Set User Initial in UI
    const userInitial = document.getElementById('userInitial');
    if (userInitial && user.username) {
        userInitial.innerText = user.username.charAt(0).toUpperCase();
    }

    // Clear search input on load to prevent auto-population issues
    const searchInput = document.getElementById('mailSearchInput');
    if (searchInput) searchInput.value = '';

    // Load initial data (Broadcasts)
    await switchMailPageTab('broadcast');
}

/**
 * Fetch unread messages and notifications count
 */
export async function updateUnreadCount() {
    const user = window.currentUser;
    if (!user) return 0;

    try {
        // 1. Unread Private Messages
        const { count: msgCount } = await sbClient
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('receiver_id', user.id)
            .is('read_at', null);

        // 2. Broadcast Notifications Not Read Yet
        // We get all broadcasts and subtract those in notification_reads for this user
        const { data: broadcasts } = await sbClient
            .from('notifications')
            .select('id')
            .eq('type', 'broadcast');

        const { data: readIds } = await sbClient
            .from('notification_reads')
            .select('notification_id')
            .eq('user_id', user.id);

        const unreadBroadcasts = (broadcasts || []).filter(b =>
            !(readIds || []).some(r => r.notification_id === b.id)
        ).length;

        unreadCount = (msgCount || 0) + unreadBroadcasts;

        updateMailboxBadge();
        return unreadCount;
    } catch (err) {
        logger.error('Failed to update unread count:', err);
        return 0;
    }
}

/**
 * Update the UI badge in the navbar
 */
function updateMailboxBadge() {
    const badge = document.getElementById('mailboxBadge');
    if (!badge) return;

    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

/**
 * Open the Mailbox Modal
 */
export async function openInbox() {
    let modal = document.getElementById('mailboxModal');
    if (!modal) {
        modal = createMailboxModal();
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Load Broadcasts by default
    await loadBroadcasts();
}

/**
 * Create the Mailbox Modal HTML
 */
function createMailboxModal() {
    const modalHtml = `
    <div id="mailboxModal" class="modal hidden comic-modal-overlay">
        <div class="comic-modal w-full max-w-4xl mx-2 sm:mx-4 !max-h-[95vh] sm:!max-h-[90vh] flex flex-col">
            <button onclick="closeAllModals()" class="comic-modal-close !top-1 !right-1 sm:!top-2 sm:!right-4 !text-2xl sm:!text-3xl">&times;</button>
            <div class="comic-modal-badge bg-comic-red font-bangers !text-xs sm:!text-sm !px-2 sm:!px-3 !right-auto !left-4">MAILBOX</div>

            <!-- Mobile: Horizontal Tabs at Top -->
            <div class="flex gap-1 pt-8 pb-2 px-2 sm:hidden border-b-2 border-black bg-gray-50">
                <button id="tabBroadcastMobile" onclick="window.switchMailTab('broadcast')" class="tab-button flex-1 !text-xs !py-2 active">📢 BROADCAST</button>
                <button id="tabMessagesMobile" onclick="window.switchMailTab('messages')" class="tab-button flex-1 !text-xs !py-2">📩 MESSAGES</button>
                <button onclick="window.openCompose()" class="btn-primary !text-xs !py-2 !px-2">✍️</button>
            </div>

            <div class="flex-1 flex flex-col sm:grid sm:grid-cols-4 gap-2 sm:gap-4 overflow-hidden">
                <!-- Desktop Sidebar (hidden on mobile) -->
                <div class="hidden sm:flex sm:col-span-1 border-r-4 border-black pr-4 flex-col gap-2 pt-8">
                    <button id="tabBroadcast" onclick="window.switchMailTab('broadcast')" class="tab-button w-full active">📢 BROADCAST</button>
                    <button id="tabMessages" onclick="window.switchMailTab('messages')" class="tab-button w-full">📩 MESSAGES</button>
                    <button id="btnCompose" onclick="window.openCompose()" class="btn-primary w-full !text-sm mt-4">✍️ TULIS PESAN</button>
                    <div class="mt-auto p-3 bg-yellow-100 border-2 border-black rounded-xl">
                        <p class="text-xs font-bold leading-tight">Keep it friendly, JDKwan! ✌️</p>
                    </div>
                </div>

                <!-- Content Area -->
                <div class="sm:col-span-3 flex flex-col pt-2 sm:pt-8 min-h-0 flex-1 relative px-2 sm:px-0 overflow-hidden">
                    <div id="mailContentHeader" class="mb-2 sm:mb-4">
                        <h3 id="mailTitle" class="font-bangers text-xl sm:text-3xl text-comic-blue">LATEST BROADCASTS</h3>
                    </div>
                    
                    <div id="mailList" class="flex-1 overflow-y-auto pr-1 sm:pr-2 space-y-2 sm:space-y-3">
                        <!-- Message Sub-tabs (only for 'messages' tab) -->
                        <div id="messageSubTabs" class="hidden flex gap-2 mb-4">
                            <button id="subTabInbox" onclick="window.switchMessageSubTab('inbox')" class="flex-1 py-1 rounded-lg border-2 border-black font-bold text-xs bg-yellow-400">📥 INBOX</button>
                            <button id="subTabSent" onclick="window.switchMessageSubTab('sent')" class="flex-1 py-1 rounded-lg border-2 border-black font-bold text-xs bg-white">📤 SENT</button>
                        </div>
                        <div id="mailListItems" class="space-y-2 sm:space-y-3">
                            <!-- Items injected here -->
                        </div>
                    </div>

                    <div id="mailDetail" class="hidden flex-1 flex flex-col border-2 sm:border-4 border-black bg-white rounded-xl overflow-hidden">
                        <div class="bg-comic-blue text-white p-2 sm:p-3 border-b-2 sm:border-b-4 border-black flex items-center gap-2 sm:gap-3">
                            <button onclick="window.backToMailList()" class="bg-white text-black text-[10px] sm:text-xs px-2 py-1 border-2 border-black font-bold hover:scale-105 transition-transform flex items-center gap-1">
                                <span>⬅️</span> <span class="hidden sm:inline">BACK</span>
                            </button>
                            <h4 id="detailTitle" class="font-bangers text-sm sm:text-xl flex-1 truncate">MESSAGE TITLE</h4>
                        </div>
                        <div id="detailBody" class="p-3 sm:p-6 flex-1 overflow-y-auto font-body font-bold text-sm sm:text-lg whitespace-pre-wrap">
                            CONTENT HERE
                        </div>
                        <div id="messageReplyArea" class="hidden p-2 sm:p-4 bg-gray-50 border-t-2 sm:border-t-4 border-black">
                            <div class="flex items-center gap-2 mb-2">
                                <button onclick="window.toggleStickerPicker('replyContent')" class="bg-white border-2 border-black px-2 py-1 rounded text-xs font-bold hover:bg-yellow-50 transition-colors">✨</button>
                            </div>
                            <textarea id="replyContent" class="comic-input mb-2 !text-sm" placeholder="Write a reply..." rows="2"></textarea>
                            <button id="btnSendReply" class="btn-primary w-full !text-sm !py-2">SEND PM</button>
                        </div>
                    </div>

                    <div id="mailCompose" class="hidden flex-1 flex flex-col border-2 sm:border-4 border-black bg-white rounded-xl overflow-hidden">
                        <div class="bg-comic-red text-white p-2 sm:p-3 border-b-2 sm:border-b-4 border-black flex items-center gap-2 sm:gap-3">
                            <button onclick="window.backToMailList()" class="bg-white text-black text-[10px] sm:text-xs px-2 py-1 border-2 border-black font-bold hover:scale-105 transition-transform flex items-center gap-1">
                                <span>⬅️</span> <span class="hidden sm:inline">CANCEL</span>
                            </button>
                            <h4 class="font-bangers text-sm sm:text-xl">NEW MESSAGE</h4>
                        </div>
                        <div class="p-3 sm:p-6 flex-1 space-y-3 sm:space-y-4 overflow-y-auto">
                            <div>
                                <label class="comic-label !text-xs sm:!text-sm">KEPADA (USERNAME)</label>
                                <div class="relative">
                                    <input type="text" id="composeSearch" class="comic-input !text-sm" placeholder="Cari username..." autocomplete="new-password" readonly onfocus="this.removeAttribute('readonly');">
                                    <div id="searchSuggestions" class="absolute left-0 right-0 top-full bg-white border-2 border-black mt-1 z-50 hidden max-h-40 overflow-y-auto"></div>
                                </div>
                            </div>
                            <div>
                                <label class="comic-label !text-xs sm:!text-sm">PESAN</label>
                                <div class="flex items-center gap-2 mb-1">
                                    <button onclick="window.toggleStickerPicker('composeContent')" class="bg-white border-2 border-black px-2 py-1 rounded text-xs font-bold hover:bg-yellow-50 transition-colors">✨ STICKER</button>
                                </div>
                                <textarea id="composeContent" class="comic-input !text-sm" placeholder="Tulis pesan Anda..." rows="4"></textarea>
                            </div>
                            <button id="btnSubmitCompose" class="btn-primary w-full py-3 sm:py-4 text-base sm:text-xl">KIRIM PESAN 🚀</button>
                        </div>
                    </div>

                    <!-- Sticker Picker Popover -->
                    <div id="stickerPicker" class="hidden absolute bg-white border-4 border-black shadow-hard p-2 rounded-xl z-[100] w-64 sm:w-80 flex-col">
                        <div class="flex justify-between items-center mb-2 px-1">
                            <span class="font-bangers text-xs sm:text-sm text-comic-purple">SELECT STICKER</span>
                            <button onclick="window.toggleStickerPicker()" class="text-xl">&times;</button>
                        </div>
                        
                        <div class="flex border-b-2 border-black mb-2">
                            <button onclick="window.switchStickerTab('collection')" id="tabStickerCollection" class="flex-1 py-1 font-black text-[10px] bg-yellow-400 border-r-2 border-black">MY STICKERS</button>
                            <button onclick="window.switchStickerTab('shop')" id="tabStickerShop" class="flex-1 py-1 font-black text-[10px] bg-white">SHOP 🛒</button>
                        </div>

                        <div id="stickerList" class="grid grid-cols-4 gap-1 sm:gap-2 max-h-40 sm:max-h-48 overflow-y-auto p-1">
                            <!-- Owned stickers here -->
                        </div>

                        <div id="stickerShopList" class="hidden flex-col gap-2 max-h-40 sm:max-h-48 overflow-y-auto p-1">
                            <!-- Shop packs here -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    window.switchMailTab = switchMailTab;
    window.backToMailList = backToMailList;
    window.viewMailDetail = viewMailDetail;
    window.markNotifRead = markNotifRead;
    window.openCompose = openCompose;
    window.deleteMessage = deleteMessage;
    window.switchMessageSubTab = switchMessageSubTab;

    // --- Stickers Logic ---
    let activeTextAreaId = null;
    let allStickers = [];
    let ownedPackIds = new Set();

    window.toggleStickerPicker = async (targetId = null) => {
        const picker = document.getElementById('stickerPicker');
        if (!targetId || (picker.classList.contains('flex') && activeTextAreaId === targetId)) {
            picker.classList.add('hidden');
            picker.classList.remove('flex');
            return;
        }

        activeTextAreaId = targetId;

        // Position picker near the button
        const btn = document.querySelector(`button[onclick*="toggleStickerPicker('${targetId}')"]`);
        if (btn) {
            const rect = btn.getBoundingClientRect();
            const container = document.querySelector('#mailboxModal .relative');
            const containerRect = container.getBoundingClientRect();
            picker.style.bottom = (containerRect.bottom - rect.top + 5) + 'px';
            picker.style.left = Math.max(0, rect.left - containerRect.left) + 'px';
        }

        picker.classList.remove('hidden');
        picker.classList.add('flex', 'flex-col');

        // Initial load
        await loadStickers();
        window.switchStickerTab('collection');
    };

    async function loadStickers() {
        const { id: userId } = await sbClient.auth.getUser().then(res => res.data.user);

        // 1. Fetch user's owned packs
        const { data: myPacks } = await sbClient
            .from('user_sticker_packs')
            .select('pack_id')
            .eq('user_id', userId);

        ownedPackIds = new Set((myPacks || []).map(p => p.pack_id));

        // 2. Fetch stickers
        const ownedIdsArray = Array.from(ownedPackIds);
        const { data: stickers } = await sbClient
            .from('stickers')
            .select('*')
            .or(`pack_id.is.null,pack_id.in.(${ownedIdsArray.length > 0 ? ownedIdsArray.join(',') : '00000000-0000-0000-0000-000000000000'})`)
            .order('name');

        allStickers = stickers || [];
        renderStickerList();
    }

    function renderStickerList() {
        const list = document.getElementById('stickerList');
        if (allStickers.length === 0) {
            list.innerHTML = '<p class="col-span-4 text-[10px] text-gray-400 text-center py-4">Belum ada sticker. Cek Shop!</p>';
        } else {
            list.innerHTML = allStickers.map(s => `
                <div onclick="window.insertSticker('${s.url}')" class="cursor-pointer hover:bg-yellow-50 p-1 border-2 border-transparent hover:border-black rounded transition-all">
                    <img src="${s.url}" class="w-full aspect-square object-contain">
                </div>
            `).join('');
        }
    }

    window.switchStickerTab = (tab) => {
        if (tab === 'collection') {
            document.getElementById('tabStickerCollection').classList.add('bg-yellow-400');
            document.getElementById('tabStickerCollection').classList.remove('bg-white');
            document.getElementById('tabStickerShop').classList.add('bg-white');
            document.getElementById('tabStickerShop').classList.remove('bg-yellow-400');
            document.getElementById('stickerList').classList.remove('hidden');
            document.getElementById('stickerShopList').classList.add('hidden');
            renderStickerList();
        } else {
            // REDIRECT TO MARKETPLACE REDEEM CENTER
            showNotification('Membuka Sticker Shop di Marketplace... 🛒');
            setTimeout(() => {
                window.location.href = 'marketplace.html?tab=redeem';
            }, 500);
        }
    };


    window.insertSticker = (url) => {
        const textarea = document.getElementById(activeTextAreaId);
        if (textarea) {
            const shortcode = `[STICKER:${url}]`;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            textarea.value = text.substring(0, start) + shortcode + text.substring(end);
            textarea.focus();
        }
        window.toggleStickerPicker();
    };

    // Search logic for compose
    const searchInput = document.getElementById('composeSearch');
    const suggestions = document.getElementById('searchSuggestions');
    let selectedUserId = null;

    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value;
        if (query.length < 2) {
            suggestions.classList.add('hidden');
            return;
        }

        const { data: users } = await sbClient
            .from('profiles')
            .select('id, username, avatar_url')
            .ilike('username', `%${query}%`)
            .limit(5);

        if (users && users.length > 0) {
            suggestions.innerHTML = users.map(u => `
                <div class="p-2 hover:bg-yellow-50 cursor-pointer flex items-center gap-2 border-b border-gray-100 last:border-0" onclick="window.selectUser('${u.id}', '${u.username}')">
                    <img src="${u.avatar_url || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + u.username}" class="w-6 h-6 rounded-full border border-black">
                    <span class="font-bold text-sm text-black">${u.username}</span>
                </div>
            `).join('');
            suggestions.classList.remove('hidden');
        } else {
            suggestions.classList.add('hidden');
        }
    });

    window.selectUser = (id, username) => {
        selectedUserId = id;
        searchInput.value = username;
        suggestions.classList.add('hidden');
    };

    document.getElementById('btnSubmitCompose').onclick = async () => {
        const content = document.getElementById('composeContent').value;
        if (!selectedUserId || !content) {
            showNotification('Pilih penerima dan isi pesan!', 'error');
            return;
        }

        const res = await sendPM(selectedUserId, content);
        if (res.success) {
            document.getElementById('composeContent').value = '';
            document.getElementById('composeSearch').value = '';
            selectedUserId = null;
            backToMailList();
            switchMailTab('messages');
        }
    };

    return document.getElementById('mailboxModal');
}

let currentTab = 'broadcast';
let currentMessageSubTab = 'inbox';

/**
 * Switch between Broadcasts and Messages
 */
async function switchMailTab(tab) {
    currentTab = tab;

    // Update active state - Desktop tabs
    document.getElementById('tabBroadcast')?.classList.toggle('active', tab === 'broadcast');
    document.getElementById('tabMessages')?.classList.toggle('active', tab === 'messages');

    // Update active state - Mobile tabs
    document.getElementById('tabBroadcastMobile')?.classList.toggle('active', tab === 'broadcast');
    document.getElementById('tabMessagesMobile')?.classList.toggle('active', tab === 'messages');

    document.getElementById('mailTitle').innerText = tab === 'broadcast' ? 'BROADCASTS' : 'MESSAGES';

    backToMailList();

    if (tab === 'broadcast') {
        document.getElementById('messageSubTabs').classList.add('hidden');
        await loadBroadcasts();
    } else {
        document.getElementById('messageSubTabs').classList.remove('hidden');
        await switchMessageSubTab(currentMessageSubTab);
    }
}

/**
 * Switch between Inbox and Sent
 */
async function switchMessageSubTab(subTab) {
    currentMessageSubTab = subTab;

    document.getElementById('subTabInbox')?.classList.toggle('bg-yellow-400', subTab === 'inbox');
    document.getElementById('subTabInbox')?.classList.toggle('bg-white', subTab !== 'inbox');

    document.getElementById('subTabSent')?.classList.toggle('bg-yellow-400', subTab === 'sent');
    document.getElementById('subTabSent')?.classList.toggle('bg-white', subTab !== 'sent');

    if (subTab === 'inbox') {
        await loadMessages(); // Received
    } else {
        await loadSentMessages();
    }
}

function backToMailList() {
    document.getElementById('mailList').classList.remove('hidden');
    document.getElementById('mailDetail').classList.add('hidden');
    document.getElementById('mailCompose').classList.add('hidden');
    document.getElementById('mailContentHeader').classList.remove('hidden');

    if (currentTab === 'messages') {
        document.getElementById('messageSubTabs').classList.remove('hidden');
    }
}

/**
 * Open the Compose View
 */
export function openCompose() {
    document.getElementById('mailList').classList.add('hidden');
    document.getElementById('mailDetail').classList.add('hidden');
    document.getElementById('mailCompose').classList.remove('hidden');
    document.getElementById('mailContentHeader').classList.add('hidden');
    document.getElementById('messageSubTabs').classList.add('hidden');

    // Switch to messages tab UI purely for visual consistency
    document.getElementById('tabBroadcast').classList.remove('active');
    document.getElementById('tabMessages').classList.add('active');
}

/**
 * Load Broadcast Notifications
 */
async function loadBroadcasts() {
    const user = window.currentUser;
    const list = document.getElementById('mailListItems');
    if (!list) return;
    list.innerHTML = '<div class="animate-pulse font-bold text-center py-8">Loading broadcasts...</div>';

    try {
        const { data: broadcasts } = await sbClient
            .from('notifications')
            .select('*')
            .eq('type', 'broadcast')
            .order('created_at', { ascending: false });

        const { data: reads } = await sbClient
            .from('notification_reads')
            .select('notification_id')
            .eq('user_id', user.id);

        const readIds = (reads || []).map(r => r.notification_id);

        if (!broadcasts || broadcasts.length === 0) {
            list.innerHTML = '<div class="text-center py-8 text-gray-500 font-bold">No broadcasts yet.</div>';
            return;
        }

        list.innerHTML = broadcasts.map(b => `
                <div onclick="window.viewMailDetail('${b.id}', 'broadcast')" class="cursor-pointer border-2 border-black p-4 shadow-comic-sm hover:shadow-comic transition-all flex justify-between items-center ${readIds.includes(b.id) ? 'bg-gray-100 opacity-90' : 'bg-white border-l-8 border-l-comic-red'} overflow-hidden">
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="text-2xl flex-shrink-0">${readIds.includes(b.id) ? '📖' : '🔔'}</span>
                        <div class="min-w-0">
                            <h5 class="font-bold text-lg leading-none truncate ${readIds.includes(b.id) ? '' : 'text-comic-red underline'}">${b.title}</h5>
                            <p class="text-[10px] text-gray-500 font-bold uppercase mt-1">${new Date(b.created_at).toLocaleDateString()}</p>
                        </div>
                    </div>
                    <div class="text-comic-blue font-bold flex-shrink-0 ml-2">VIEW</div>
                </div>
        `).join('');

    } catch (err) {
        list.innerHTML = '<div class="text-red-500 text-center py-8">Failed to load content.</div>';
    }
}

/**
 * Load Private Messages
 */
async function loadMessages() {
    const user = window.currentUser;
    const list = document.getElementById('mailListItems');
    if (!list) return;
    list.innerHTML = '<div class="animate-pulse font-bold text-center py-8">Loading messages...</div>';

    try {
        const { data: messages } = await sbClient
            .from('messages')
            .select('*, sender:profiles!messages_sender_id_fkey(username, avatar_url)')
            .eq('receiver_id', user.id)
            .order('created_at', { ascending: false });

        if (!messages || messages.length === 0) {
            list.innerHTML = '<div class="text-center py-8 text-gray-500 font-bold">Your inbox is empty.</div>';
            return;
        }

        list.innerHTML = messages.map(m => `
            <div class="border-2 border-black p-4 shadow-comic-sm hover:shadow-comic transition-all flex justify-between items-center ${m.read_at ? 'bg-gray-100 opacity-90' : 'bg-white border-l-8 border-l-comic-blue'} overflow-hidden">
                <div onclick="window.viewMailDetail('${m.id}', 'pm')" class="flex items-center gap-3 flex-1 cursor-pointer min-w-0">
                    <img src="${m.sender?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.sender?.username || 'U')}&background=random&color=fff`}" class="w-10 h-10 rounded-full border-2 border-black object-cover flex-shrink-0">

                    <div class="min-w-0">
                        <h5 class="font-bold text-lg leading-none truncate ${m.read_at ? '' : 'text-comic-blue'}">FROM: ${m.sender?.username}</h5>
                        <p class="text-xs text-gray-600 truncate mt-1">${parseMessagePreview(m.content)}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span class="text-[10px] font-bold text-gray-400 uppercase hidden sm:inline">${new Date(m.created_at).toLocaleDateString()}</span>
                    <button onclick="event.stopPropagation(); window.deleteMessage('${m.id}', 'receiver')" class="bg-comic-red text-white px-2 py-1 rounded border-2 border-black text-xs font-bold hover:bg-red-600 transition-all" title="Hapus pesan">
                        🗑️
                    </button>
                </div>
            </div>
        `).join('');

    } catch (err) {
        list.innerHTML = '<div class="text-red-500 text-center py-8">Failed to load content.</div>';
    }
}

/**
 * Load Sent Messages
 */
async function loadSentMessages() {
    const user = window.currentUser;
    const list = document.getElementById('mailListItems');
    if (!list) return;
    list.innerHTML = '<div class="animate-pulse font-bold text-center py-8">Loading sent messages...</div>';

    try {
        const { data: messages } = await sbClient
            .from('messages')
            .select('*, receiver:profiles!messages_receiver_id_fkey(username, avatar_url)')
            .eq('sender_id', user.id)
            .order('created_at', { ascending: false });

        if (!messages || messages.length === 0) {
            list.innerHTML = '<div class="text-center py-8 text-gray-500 font-bold">You haven\'t sent any messages.</div>';
            return;
        }

        list.innerHTML = messages.map(m => `
            <div class="border-2 border-black p-4 shadow-comic-sm hover:shadow-comic transition-all flex justify-between items-center bg-white border-l-8 border-l-gray-400 overflow-hidden">
                <div onclick="window.viewMailDetail('${m.id}', 'sent')" class="flex items-center gap-3 flex-1 cursor-pointer min-w-0">
                    <img src="${m.receiver?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(m.receiver?.username || 'U')}&background=random&color=fff`}" class="w-10 h-10 rounded-full border-2 border-black object-cover flex-shrink-0">

                    <div class="min-w-0">
                        <h5 class="font-bold text-lg leading-none truncate">TO: ${m.receiver?.username}</h5>
                        <p class="text-xs text-gray-600 truncate mt-1">${parseMessagePreview(m.content)}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span class="text-[10px] font-bold text-gray-400 uppercase hidden sm:inline">${new Date(m.created_at).toLocaleDateString()}</span>
                    <button onclick="event.stopPropagation(); window.deleteMessage('${m.id}', 'sender')" class="bg-comic-red text-white px-2 py-1 rounded border-2 border-black text-xs font-bold hover:bg-red-600 transition-all" title="Hapus pesan">
                        🗑️
                    </button>
                </div>
            </div>
        `).join('');

    } catch (err) {
        list.innerHTML = '<div class="text-red-500 text-center py-8">Failed to load content.</div>';
    }
}

/**
 * View Detail Content
 */
/**
 * View Detail Content
 */
async function viewMailDetail(id, type) {
    const detail = document.getElementById('mailDetail');
    const list = document.getElementById('mailList');
    const header = document.getElementById('mailContentHeader');
    const title = document.getElementById('detailTitle');
    const body = document.getElementById('detailBody');
    const replyArea = document.getElementById('messageReplyArea');

    detail.classList.remove('hidden');
    list.classList.add('hidden');
    header.classList.add('hidden');
    replyArea.classList.add('hidden');
    document.getElementById('messageSubTabs').classList.add('hidden');

    try {
        let contentHtml = '';
        let timestamp = '';
        let senderName = '';
        let avatarUrl = '';

        if (type === 'broadcast') {
            const { data: b } = await sbClient.from('notifications').select('*').eq('id', id).single();

            title.innerText = '📢 BROADCAST';
            senderName = 'SYSTEM BROADCAST';
            avatarUrl = 'images/logo-icon.png'; // Use default logo for broadcast
            timestamp = new Date(b.created_at).toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            contentHtml = parseMessageContent(b.content);
            await markNotifRead(id);

        } else if (type === 'sent') {
            const { data: m } = await sbClient.from('messages').select('*, receiver:profiles!messages_receiver_id_fkey(id, username, avatar_url)').eq('id', id).single();

            title.innerText = '📤 SENT MESSAGE';
            senderName = `To: ${m.receiver?.username}`;
            avatarUrl = m.receiver?.avatar_url;
            timestamp = new Date(m.created_at).toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            contentHtml = parseMessageContent(m.content);

        } else {
            // INBOX (Received)
            const { data: m } = await sbClient.from('messages').select('*, sender:profiles!messages_sender_id_fkey(id, username, avatar_url)').eq('id', id).single();

            title.innerText = '📩 INBOX MESSAGE';
            senderName = m.sender?.username;
            avatarUrl = m.sender?.avatar_url;
            timestamp = new Date(m.created_at).toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            contentHtml = parseMessageContent(m.content);

            // Show reply logic
            replyArea.classList.remove('hidden');
            const btn = document.getElementById('btnSendReply');
            btn.onclick = async () => {
                const content = document.getElementById('replyContent').value;
                if (!content) return;
                const res = await sendPM(m.sender_id, content);
                if (res.success) {
                    document.getElementById('replyContent').value = '';
                    backToMailList();
                    loadMessages();
                }
            };

            if (!m.read_at) {
                await sbClient.functions.invoke('jdk-secure-handler', {
                    body: { action: 'markMessageRead', message_id: id }
                });
                await updateUnreadCount();
            }
        }

        // Render Ultra-Compact UI (Fixing cut-off & spacing issues)
        body.innerHTML = `
            <div class="flex flex-col h-full">
                <!-- Header -->
                <div class="flex items-start gap-3 border-b border-gray-300 pb-2 mb-2 flex-shrink-0">
                    <img src="${avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName || 'U')}&background=random&color=fff`}" 
                         class="w-10 h-10 rounded-full border border-black object-cover flex-shrink-0">
                    <div class="min-w-0 flex-1">
                        <div class="flex justify-between items-baseline">
                            <h3 class="font-bold text-base leading-tight text-black truncate">${senderName}</h3>
                            <span class="text-[10px] text-gray-500 font-bold ml-2 flex-shrink-0">${timestamp}</span>
                        </div>
                        <p class="text-[10px] text-gray-400 font-bold uppercase truncate">${type === 'broadcast' ? 'Subject: ' : 'Info: '}${title.innerText}</p>
                    </div>
                </div>

                <!-- Content -->
                <div class="flex-1 overflow-y-auto min-h-0">
                    <div class="text-sm font-medium text-gray-900 whitespace-pre-wrap leading-relaxed py-1">
                        ${contentHtml}
                    </div>
                </div>
            </div>
        `;

    } catch (err) {
        logger.error('Failed to load details:', err);
        body.innerHTML = '<div class="text-center py-10 text-red-500 font-bold">Gagal memuat pesan.</div>';
    }
}

/**
 * Mark broadcast as read
 */
async function markNotifRead(id) {
    const user = window.currentUser;
    await sbClient.functions.invoke('jdk-secure-handler', {
        body: { action: 'markNotificationRead', notification_id: id, source: 'broadcast' }
    });
    await updateUnreadCount();
}

/**
 * Send a Private Message
 */
export async function sendPM(receiverId, content) {
    const user = window.currentUser;
    if (!user) return { success: false, error: 'Not logged in' };

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'sendPM', receiver_id: receiverId, content: content }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal mengirim pesan');

        showNotification('✅ Pesan terkirim!', 'success');
        return { success: true };

    } catch (err) {
        showNotification('❌ Gagal mengirim pesan', 'error');
        return { success: false, error: err };
    }
}

/**
 * Delete a Private Message
 */
async function deleteMessage(messageId, role = 'receiver') {
    if (!confirm('Hapus pesan ini?')) return;

    const user = window.currentUser;
    if (!user) return;

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'deletePM', message_id: messageId, role: role }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal menghapus pesan');

        showNotification('✅ Pesan berhasil dihapus', 'success');

        // Correctly reload based on current location and role
        if (window.location.pathname.includes('mailbox.html')) {
            // If on standalone page, check role and subtab
            if (role === 'sender') {
                await loadSentMessagesPage();
            } else {
                await loadMessagesPage();
                await updateUnreadCount();
            }
            // Transition back to list view if we were in detail view
            if (typeof backToMailPageList === 'function') {
                backToMailPageList();
            }
        } else {
            // If in modal
            if (role === 'sender') await loadSentMessages();
            else {
                await loadMessages();
                await updateUnreadCount();
            }
        }
    } catch (err) {
        logger.error('Failed to delete message:', err);
        showNotification('❌ Gagal menghapus pesan', 'error');
    }
}

/**
 * Parse message content for stickers and safe HTML
 */
function parseMessageContent(text) {
    if (!text) return '';

    // 1. Escape HTML
    let safe = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    // 2. Convert newlines to <br>
    safe = safe.replace(/\n/g, '<br>');

    // 3. Replace [STICKER:url] with <img>
    const stickerRegex = /\[STICKER:([^\]]+)\]/g;
    return safe.replace(stickerRegex, (match, url) => {
        return `<div class="my-2"><img src="${url}" class="max-w-[150px] max-h-[150px] object-contain hover:scale-105 transition-transform" alt="sticker"></div>`;
    });
}

/**
 * Strip stickers for message preview
 */
function parseMessagePreview(text) {
    if (!text) return '';
    return text.replace(/\[STICKER:[^\]]+\]/g, '📷 Sticker').substring(0, 100);
}

// ==========================================
// MAILBOX PAGE LOGIC (Standalone Page)
// ==========================================

let currentPageTab = 'broadcast';
let currentPageSubTab = 'inbox';

/**
 * Switch Main Tabs (Broadcast vs Messages)
 */
async function switchMailPageTab(tab) {
    currentPageTab = tab;

    // Update Sidebar UI
    const tabBroadcast = document.getElementById('tabBroadcast');
    const tabInbox = document.getElementById('tabInbox');
    const tabSent = document.getElementById('tabSent');

    // Reset all sidebar icons/items
    [tabBroadcast, tabInbox, tabSent].forEach(el => el?.classList.remove('active'));

    if (tab === 'broadcast') {
        tabBroadcast?.classList.add('active');
        document.getElementById('mailboxHeadingTitle').innerHTML = 'Broadcast';
    } else if (tab === 'messages') {
        // This is a catch-all for inbox/sent
        if (currentPageSubTab === 'inbox') tabInbox?.classList.add('active');
        else tabSent?.classList.add('active');
    }

    // Reset Views
    backToMailPageList();

    // Load Data
    if (tab === 'broadcast') {
        await loadBroadcastsPage();
    } else {
        await switchMessageSubTabPage(currentPageSubTab);
    }
}

/**
 * Switch Message Sub-tabs (Inbox vs Sent)
 */
async function switchMessageSubTabPage(subTab) {
    currentPageSubTab = subTab;

    const tabBroadcast = document.getElementById('tabBroadcast');
    const tabInbox = document.getElementById('tabInbox');
    const tabSent = document.getElementById('tabSent');

    [tabBroadcast, tabInbox, tabSent].forEach(el => el?.classList.remove('active'));

    if (subTab === 'inbox') {
        tabInbox?.classList.add('active');
        document.getElementById('mailboxHeadingTitle').innerHTML = 'Kotak Masuk';
        await loadMessagesPage();
    } else {
        tabSent?.classList.add('active');
        document.getElementById('mailboxHeadingTitle').innerHTML = 'Terkirim';
        await loadSentMessagesPage();
    }

    backToMailPageList();
    currentPageTab = 'messages';
}

/**
 * Back to List View
 */
function backToMailPageList() {
    document.getElementById('mailListContainer').classList.remove('hidden');
    document.getElementById('mailDetailContainer').classList.add('hidden');
    document.getElementById('composeContainer').classList.add('hidden');
    document.getElementById('mailboxToolbar').classList.remove('hidden');
}

/**
 * Load Broadcasts for Page
 */
async function loadBroadcastsPage() {
    const list = document.getElementById('mailListContainer');
    list.innerHTML = '<div class="flex items-center justify-center h-40"><span class="animate-spin material-symbols-outlined text-gray-400">refresh</span></div>';

    const user = window.currentUser;
    if (!user) return;

    try {
        const { data: broadcasts } = await sbClient
            .from('notifications')
            .select('*')
            .eq('type', 'broadcast')
            .order('created_at', { ascending: false });

        const { data: reads } = await sbClient
            .from('notification_reads')
            .select('notification_id')
            .eq('user_id', user.id);

        const readIds = (reads || []).map(r => r.notification_id);

        // Update Pagination Info
        const pagInfo = document.getElementById('paginationInfo');
        if (pagInfo) pagInfo.innerText = `1 – ${broadcasts.length} dari ${broadcasts.length}`;

        if (!broadcasts || broadcasts.length === 0) {
            list.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 text-gray-400">
                    <span class="material-symbols-outlined text-6xl mb-2">campaign</span>
                    <p class="font-bold">Belum ada broadcast.</p>
                </div>`;
            return;
        }

        list.innerHTML = broadcasts.map(b => {
            const isRead = readIds.includes(b.id);
            return `
                <div onclick="viewMailPageDetail('${b.id}', 'broadcast')" 
                    class="message-row ${isRead ? 'read' : 'unread'}">
                    <span class="material-symbols-outlined text-gray-400">campaign</span>
                    <div class="flex-1 flex gap-4 min-w-0">
                        <span class="w-32 truncate flex-shrink-0">JDK System</span>
                        <div class="flex-1 truncate">
                            <span class="text-gray-900">${b.title}</span>
                            <span class="text-gray-500 font-normal"> - ${parseMessagePreview(b.content)}</span>
                        </div>
                    </div>
                    <span class="text-xs text-gray-500 whitespace-nowrap">${formatFriendlyDate(b.created_at)}</span>
                </div>
            `;
        }).join('');

    } catch (err) {
        logger.error(err);
        list.innerHTML = '<p class="text-center py-10 text-red-500">Gagal memuat data.</p>';
    }
}

/**
 * Load Inbox Messages for Page
 */
async function loadMessagesPage() {
    const list = document.getElementById('mailListContainer');
    list.innerHTML = '<div class="flex items-center justify-center h-40"><span class="animate-spin material-symbols-outlined text-gray-400">refresh</span></div>';

    const user = window.currentUser;

    try {
        const { data: messages } = await sbClient
            .from('messages')
            .select('*, sender:profiles!messages_sender_id_fkey(username, avatar_url)')
            .eq('receiver_id', user.id)
            .order('created_at', { ascending: false });

        if (!messages || messages.length === 0) {
            list.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 text-gray-400">
                    <span class="material-symbols-outlined text-6xl mb-2">inbox</span>
                    <p class="font-bold">Inbox kosong.</p>
                </div>`;
            return;
        }

        // Update Pagination Info
        const pagInfo = document.getElementById('paginationInfo');
        if (pagInfo) pagInfo.innerText = `1 – ${messages.length} dari ${messages.length}`;

        list.innerHTML = messages.map(m => `
            <div onclick="viewMailPageDetail('${m.id}', 'inbox')" class="message-row ${m.read_at ? 'read' : 'unread'}">
                <img src="${m.sender?.avatar_url || `https://ui-avatars.com/api/?name=${m.sender?.username}&background=random`}" class="w-5 h-5 rounded-full object-cover">
                <div class="flex-1 flex gap-4 min-w-0">
                    <span class="w-32 truncate flex-shrink-0">${m.sender?.username}</span>
                    <div class="flex-1 truncate">
                        <span class="text-gray-900">Pesan dari ${m.sender?.username}</span>
                        <span class="text-gray-500 font-normal"> - ${parseMessagePreview(m.content)}</span>
                    </div>
                </div>
                <div class="actions">
                    <button onclick="event.stopPropagation(); deleteMessage('${m.id}', 'receiver')" class="p-1 hover:bg-gray-200 rounded text-gray-600" title="Hapus">
                        <span class="material-symbols-outlined text-lg">delete</span>
                    </button>
                    <button onclick="event.stopPropagation(); viewMailPageDetail('${m.id}', 'inbox')" class="p-1 hover:bg-gray-200 rounded text-gray-600" title="Buka">
                        <span class="material-symbols-outlined text-lg">open_in_new</span>
                    </button>
                </div>
                <span class="text-xs text-gray-500 whitespace-nowrap">${formatFriendlyDate(m.created_at)}</span>
            </div>
        `).join('');

    } catch (err) {
        list.innerHTML = '<p class="text-center py-10 text-red-500">Error loading messages.</p>';
    }
}

/**
 * Load Sent Messages for Page
 */
async function loadSentMessagesPage() {
    const list = document.getElementById('mailListContainer');
    list.innerHTML = '<div class="flex items-center justify-center h-40"><span class="animate-spin material-symbols-outlined text-gray-400">refresh</span></div>';

    const user = window.currentUser;

    try {
        const { data: messages } = await sbClient
            .from('messages')
            .select('*, receiver:profiles!messages_receiver_id_fkey(username, avatar_url)')
            .eq('sender_id', user.id)
            .order('created_at', { ascending: false });

        if (!messages || messages.length === 0) {
            list.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 text-gray-400">
                    <span class="material-symbols-outlined text-6xl mb-2">send</span>
                    <p class="font-bold">Sent folder kosong.</p>
                </div>`;
            return;
        }

        // Update Pagination Info
        const pagInfo = document.getElementById('paginationInfo');
        if (pagInfo) pagInfo.innerText = `1 – ${messages.length} dari ${messages.length}`;

        list.innerHTML = messages.map(m => `
            <div onclick="viewMailPageDetail('${m.id}', 'sent')" class="message-row read">
                <img src="${m.receiver?.avatar_url || `https://ui-avatars.com/api/?name=${m.receiver?.username}&background=random`}" class="w-5 h-5 rounded-full object-cover">
                <div class="flex-1 flex gap-4 min-w-0">
                    <span class="w-32 truncate flex-shrink-0">To: ${m.receiver?.username}</span>
                    <div class="flex-1 truncate">
                        <span class="text-gray-900">Kepada ${m.receiver?.username}</span>
                        <span class="text-gray-500 font-normal"> - ${parseMessagePreview(m.content)}</span>
                    </div>
                </div>
                <div class="actions">
                    <button onclick="event.stopPropagation(); deleteMessage('${m.id}', 'sender')" class="p-1 hover:bg-gray-200 rounded text-gray-600" title="Hapus">
                        <span class="material-symbols-outlined text-lg">delete</span>
                    </button>
                </div>
                <span class="text-xs text-gray-500 whitespace-nowrap">${formatFriendlyDate(m.created_at)}</span>
            </div>
        `).join('');

    } catch (err) {
        list.innerHTML = '<p class="text-center py-10 text-red-500">Error loading messages.</p>';
    }
}

/**
 * View Detail Page
 */
async function viewMailPageDetail(id, type) {
    const listContainer = document.getElementById('mailListContainer');
    const detailContainer = document.getElementById('mailDetailContainer');
    const detailBody = document.getElementById('mailDetailBody');
    const headerTitle = document.getElementById('detailHeaderTitle');
    const senderTitle = document.getElementById('detailSenderName');
    const timestampLabel = document.getElementById('detailTimestamp');
    const avatarContainer = document.getElementById('detailAvatar');
    const replyArea = document.getElementById('replyAreaContainer');
    const toolbar = document.getElementById('mailboxToolbar');

    // Hide List, Show Detail within the main area
    listContainer.classList.add('hidden');
    detailContainer.classList.remove('hidden');
    detailContainer.classList.add('flex');
    replyArea.classList.add('hidden');

    // Ensure sidebar remains visible by NOT touching it
    // The main-content-wrapper (parent of detailContainer) is flex-1 relative

    detailBody.innerHTML = '<div class="flex items-center justify-center py-20 animate-pulse text-gray-400"><span class="material-symbols-outlined text-4xl">move_to_inbox</span></div>';

    try {
        let contentHtml = '';
        let timestamp = '';
        let senderName = '';
        let avatarUrl = '';
        let senderId = null;
        let mainTitle = '';

        if (type === 'broadcast') {
            const { data: b } = await sbClient.from('notifications').select('*').eq('id', id).single();
            mainTitle = b.title;
            senderName = 'JDK System Broadcast';
            avatarUrl = 'images/jdk-logo.png';
            timestamp = formatFriendlyDate(b.created_at);
            contentHtml = parseMessageContent(b.content);
            await markNotifRead(id);
            document.getElementById('detailDeleteBtn').classList.add('hidden');
            document.getElementById('detailReplyBtn').classList.add('hidden');
            document.getElementById('detailForwardBtn').classList.add('hidden');
        }
        else if (type === 'sent') {
            const { data: m } = await sbClient.from('messages').select('*, receiver:profiles!messages_receiver_id_fkey(username, avatar_url)').eq('id', id).single();
            mainTitle = `Pesan Terkirim Ke ${m.receiver?.username} `;
            senderName = `Saya(Ke: ${m.receiver?.username})`;
            avatarUrl = m.receiver?.avatar_url;
            timestamp = formatFriendlyDate(m.created_at);
            contentHtml = parseMessageContent(m.content);
            document.getElementById('detailDeleteBtn').classList.remove('hidden');
            document.getElementById('detailDeleteBtn').onclick = () => deleteMessage(id, 'sender');

            document.getElementById('detailReplyBtn').classList.add('hidden'); // Cannot reply to sent messages usually in this simple UI
            document.getElementById('detailForwardBtn').onclick = () => showNotification('Fitur Teruskan (Forward) sedang dikembangkan 🚀');
        }
        else {
            // INBOX
            const { data: m } = await sbClient.from('messages').select('*, sender:profiles!messages_sender_id_fkey(id, username, avatar_url)').eq('id', id).single();
            mainTitle = `Pesan dari ${m.sender?.username} `;
            senderName = m.sender?.username;
            avatarUrl = m.sender?.avatar_url;
            senderId = m.sender_id;
            timestamp = formatFriendlyDate(m.created_at);
            contentHtml = parseMessageContent(m.content);
            document.getElementById('detailDeleteBtn').classList.remove('hidden');
            document.getElementById('detailDeleteBtn').onclick = () => deleteMessage(id, 'receiver');

            document.getElementById('detailReplyBtn').classList.remove('hidden');
            document.getElementById('detailReplyBtn').onclick = () => {
                replyArea.classList.remove('hidden');
                document.getElementById('replyInput').focus();
            };

            document.getElementById('detailForwardBtn').classList.remove('hidden');
            document.getElementById('detailForwardBtn').onclick = () => showNotification('Fitur Teruskan (Forward) sedang dikembangkan 🚀');

            // Mark read
            if (!m.read_at) {
                await sbClient.from('messages').update({ read_at: new Date().toISOString() }).eq('id', id);
                await updateUnreadCount();
            }

            // Setup Reply
            replyArea.classList.remove('hidden');
            window.currentReplyReceiverId = senderId;
        }

        // Set Headers
        headerTitle.innerText = mainTitle;
        senderTitle.innerText = senderName;
        timestampLabel.innerText = timestamp;

        avatarContainer.innerHTML = avatarUrl ?
            `<img src="${avatarUrl}" class="w-full h-full rounded-full object-cover">` :
            senderName.charAt(0).toUpperCase();

        detailBody.innerHTML = contentHtml;
    } catch (e) {
        logger.error(e);
        detailBody.innerHTML = '<p class="text-red-500 py-20 text-center">Gagal memuat konten pesan.</p>';
    }
}

/**
 * Handle Reply Page
 */
async function sendReplyPage() {
    const input = document.getElementById('replyInput');
    const content = input.value;
    const receiverId = window.currentReplyReceiverId;

    if (!content || !receiverId) return;

    const res = await sendPM(receiverId, content);
    if (res.success) {
        input.value = '';
        showNotification('Balasan terkirim!');
        backToMailPageList();
    }
}

/**
 * Compose Page Logic
 */
function openComposePage() {
    // Show Compose as an overlay
    document.getElementById('composeContainer').classList.remove('hidden');
    document.getElementById('composeContainer').classList.add('flex');

    // Initialize suggestions logic
    setupComposeOverlaySuggestions();
}

function cancelComposePage() {
    backToMailPageList();
}

async function handleSendPage(e) {
    e.preventDefault();
    let username = document.getElementById('composeTo').value;
    const content = document.getElementById('composeBody').value;

    // Remove @ if present
    if (username.startsWith('@')) {
        username = username.substring(1);
    }

    // Find user by username
    const { data: users } = await sbClient.from('profiles').select('id').ilike('username', username).single();

    if (!users) {
        showNotification('Username tidak ditemukan!', 'error');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Mengirim...';

    const res = await sendPM(users.id, content);
    if (res.success) {
        document.getElementById('composeTo').value = '';
        document.getElementById('composeBody').value = '';
        showNotification('Pesan terkirim!');
        cancelComposePage();
        await switchMessageSubTabPage('sent');
    }

    submitBtn.disabled = false;
    submitBtn.innerText = 'Kirim';
}

/**
 * Handle refresh of current tab
 */
window.refreshMailPageTab = async function () {
    if (currentPageTab === 'broadcast') await loadBroadcastsPage();
    else if (currentPageSubTab === 'inbox') await loadMessagesPage();
    else await loadSentMessagesPage();
};


/**
 * Setup suggestions for the Compose Overlay (mailbox.html)
 */
export function setupComposeOverlaySuggestions() {
    const input = document.getElementById('composeTo');
    const suggestions = document.getElementById('composeToSuggestions');

    if (!input || !suggestions) return;

    // Check if already initialized to avoid duplicate listeners
    if (input.dataset.hasSuggestions) return;
    input.dataset.hasSuggestions = 'true';

    input.addEventListener('input', async (e) => {
        const value = e.target.value;
        const lastWord = value.split(' ').pop(); // Get last word being typed

        // Logic: Trigger if the WHOLE input starts with @ (simple) 
        // OR trigger if the current word starts with @?
        // Requirement says: "input type @ then list user"
        // Let's support "Kepada" usually single user. So we check if value starts with @ or contains @ 
        // For simplicity in a "To" field, usually it's just the username.

        // Let's assume the user types "@usern..."
        let query = '';
        if (value.includes('@')) {
            query = value.split('@').pop(); // Get text after last @
        } else {
            suggestions.classList.add('hidden');
            return;
        }

        if (query.length < 1) {
            // Show some default or recent? No, wait for typing
            // Actually, if just "@", show some users?
            // Let's wait for 1 char after @ if we want to be efficient, or 0 if we want instant feedback.
            // Let's try 0.
        }

        try {
            const { data: users } = await sbClient
                .from('profiles')
                .select('id, username, avatar_url')
                .ilike('username', `%${query}%`)
                .limit(5);

            if (users && users.length > 0) {
                suggestions.innerHTML = users.map(u => `
                    <div class="p-3 hover:bg-gray-50 cursor-pointer flex items-center gap-3 border-b border-gray-100 last:border-0 transition-colors" 
                         onclick="window.selectComposeUser('${u.username}')">
                        <img src="${u.avatar_url || 'https://ui-avatars.com/api/?name=' + u.username}" class="w-8 h-8 rounded-full border border-gray-200 object-cover">
                        <span class="font-bold text-sm text-gray-800">${u.username}</span>
                    </div>
                `).join('');
                suggestions.classList.remove('hidden');
            } else {
                suggestions.classList.add('hidden');
            }
        } catch (err) {
            logger.error('Error fetching suggestions:', err);
        }
    });

    // Hide when clicking outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestions.contains(e.target)) {
            suggestions.classList.add('hidden');
        }
    });

    // Create global handler for selection
    window.selectComposeUser = (username) => {
        // We replace the input with @username or just username?
        // Requirement says "type @ then list user".
        // Usually we want the final value to be valid for backend.
        // Backend expects username. 
        // Let's set it to "@username" for visual feedback that it's a mention, 
        // AND we strip it in handleSendPage (which I already added).
        input.value = '@' + username;
        suggestions.classList.add('hidden');
        input.focus();
    };
}


