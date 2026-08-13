import { logger } from '../core/logger.js';
/**
 * JDK Notification System
 * Handles both Personal Notifications (jdk_notifications) and Global Broadcasts (notifications)
 */

import { sbClient } from '../core/supabase.js';
import { getCurrentUser } from './user-session.js';
import { formatFriendlyDate } from '../core/utils.js';

let unreadCount = 0;
let notifications = [];

/**
 * Initialize Notification System
 */
export function initNotifications() {
    // Inject Modal HTML
    injectNotificationModal();

    // Initial Fetch
    fetchNotifications();

    // Set up Realtime Subscription for Personal Notifications
    const user = getCurrentUser();
    if (user) {
        sbClient
            .channel('public:jdk_notifications')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'jdk_notifications',
                filter: `user_id=eq.${user.id}`
            }, (payload) => {
                logger.log('New notification received:', payload);
                fetchNotifications(); // Refresh list and count
                showToast('New Notification: ' + payload.new.title);
            })
            .subscribe();
    }
}

/**
 * Fetch and Merge Notifications
 */
export async function fetchNotifications() {
    const user = getCurrentUser();
    if (!user) return;

    try {
        // 1. Fetch Personal Notifications
        const { data: personalNotes, error: personalError } = await sbClient
            .from('jdk_notifications')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(20);

        if (personalError) throw personalError;

        // 2. Fetch Global Broadcasts
        const { data: broadcasts, error: broadcastError } = await sbClient
            .from('notifications') // Old table name
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (broadcastError) {
            // Silently fail for broadcasts if table issue, focus on personal
            logger.warn('Broadcast fetch error:', broadcastError);
        }

        // 3. Fetch Read Status for Broadcasts
        const { data: reads } = await sbClient
            .from('notification_reads')
            .select('notification_id')
            .eq('user_id', user.id);

        const readIds = new Set(reads?.map(r => r.notification_id) || []);

        // 4. Merge and Process
        const processedPersonal = (personalNotes || []).map(n => ({
            ...n,
            source: 'personal',
            is_read: n.is_read,
            message: n.message // Personal already uses 'message'
        }));

        const processedBroadcasts = (broadcasts || []).map(n => ({
            ...n,
            source: 'broadcast',
            is_read: readIds.has(n.id),
            message: n.content // Broadcast uses 'content', map to 'message' for UI
        }));

        // Combine and Sort
        notifications = [...processedPersonal, ...processedBroadcasts].sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );

        // Update Unread Count
        unreadCount = notifications.filter(n => !n.is_read).length;
        updateNotificationBadge();

        // [PROACTIVE GUIDANCE] Alert seller if they have unread rekber requests
        const pendingRekber = notifications.find(n => !n.is_read && ['REKBER_REQUEST', 'REKBER_REMINDER'].includes(n.type));
        if (pendingRekber) {
            // Wait slightly for UI to settle before showing proactive toast
            setTimeout(() => {
                showToast(`📢 KAMU PUNYA REKBER PENDING!<br><span class="text-[10px] opacity-80">${pendingRekber.title}</span>`);
            }, 1500);
        }

    } catch (err) {
        logger.error('Error fetching notifications:', err);
    }
}

/**
 * Update UI Badge
 */
function updateNotificationBadge() {
    const badge = document.getElementById('navNotificationBadge');
    if (badge) {
        if (unreadCount > 0) {
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

/**
 * Open Notification Modal
 */
export function openNotificationModal() {
    const modal = document.getElementById('notificationModal');
    const container = document.getElementById('notificationList');

    if (!modal || !container) return;

    // Render List
    container.innerHTML = '';
    if (notifications.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <span class="material-symbols-outlined text-4xl mb-2">notifications_off</span>
                <p>Belum ada notifikasi.</p>
            </div>
        `;
    } else {
        notifications.forEach(note => {
            const item = document.createElement('div');
            item.className = `p-4 border-b border-black/10 hover:bg-black/5 transition-colors cursor-pointer flex items-center gap-3 relative group ${note.is_read ? 'opacity-60' : 'bg-yellow-50'}`;

            // Icon based on type
            let icon = 'notifications';
            if (note.type === 'DUEL_CHALLENGE') icon = 'swords';
            if (note.type === 'SYSTEM') icon = 'info';
            if (note.type === 'REKBER_REQUEST') icon = 'shopping_cart_checkout';
            if (note.type === 'REKBER_REMINDER') icon = 'alarm';
            if (note.type === 'REKBER_CANCELLED') icon = 'cancel';
            if (note.type === 'REKBER_ADMIN_ALERT') icon = 'admin_panel_settings';

            item.innerHTML = `
                <div class="mt-1">
                    <span class="material-symbols-outlined text-black">${icon}</span>
                </div>
                <div class="flex-1 min-w-0" onclick="handleNotificationClick(${JSON.stringify(note).replace(/"/g, '&quot;')})">
                    <h4 class="font-bold text-sm ${note.is_read ? 'text-gray-700' : 'text-black'} truncate">${note.title}</h4>
                    <p class="text-xs text-gray-600 mt-1 line-clamp-2">${note.message}</p>
                    <p class="text-[10px] text-gray-400 mt-2">${formatFriendlyDate(note.created_at)}</p>
                </div>
                <div class="flex flex-col items-center gap-2">
                    ${!note.is_read ? '<div class="w-2 h-2 rounded-full bg-red-500"></div>' : ''}
                    <button onclick="deleteNotification('${note.id}', '${note.source}', event)" class="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-all">
                        <span class="material-symbols-outlined text-red-500 text-sm">delete</span>
                    </button>
                </div>
            `;

            container.appendChild(item);
        });
    }

    modal.classList.remove('hidden');
}

/**
 * Handle Click
 */
async function handleNotificationClick(note) {
    // 1. Mark as Read
    if (!note.is_read) {
        await markAsRead(note);
    }

    // 2. Action based on notification type
    // Duel notifications
    if (note.type === 'DUEL_CHALLENGE') {
        const duelId = note.meta_data?.duel_id;
        if (duelId) {
            window.location.href = `lobby.html?accept_duel=${duelId}`;
        } else {
            window.location.href = 'lobby.html';
        }
    }
    // Rekber notifications (seller, buyer, admin)
    else if (['REKBER_REQUEST', 'REKBER_REMINDER', 'REKBER_CANCELLED', 'REKBER_ADMIN_ALERT'].includes(note.type)) {
        const txId = note.meta_data?.transaction_id;
        if (txId) {
            window.location.href = `rekber.html?id=${txId}`;
        } else {
            // For admin general view
            window.location.href = 'admin-rekber.html';
        }
    }

    // Close modal
    document.getElementById('notificationModal').classList.add('hidden');
}

/**
 * Mark as Read Logic
 */
async function markAsRead(note) {
    const user = getCurrentUser();
    if (!user) return;

    try {
        if (note.source === 'personal') {
            await sbClient
                .from('jdk_notifications')
                .update({ is_read: true })
                .eq('id', note.id);
        } else {
            await sbClient
                .from('notification_reads')
                .insert({ user_id: user.id, notification_id: note.id });
        }

        // Update local state
        note.is_read = true;
        unreadCount = Math.max(0, unreadCount - 1);
        updateNotificationBadge();

    } catch (err) {
        logger.error('Failed to mark read:', err);
    }
}

/**
 * Delete Notification
 */
export async function deleteNotification(id, source, event) {
    if (event) event.stopPropagation();

    if (source === 'broadcast') {
        showToast('Pengumuman global tidak dapat dihapus permanen oleh member.');
        return;
    }

    if (!confirm('Hapus notifikasi ini secara permanen?')) return;

    try {
        // Use .select() to verify if a row was actually deleted (Supabase delete returns [] if RLS fails)
        const { data, error } = await sbClient
            .from('jdk_notifications')
            .delete()
            .eq('id', id)
            .select();

        if (error) {
            logger.error('Database deletion failed for ID:', id, error);
            showToast('Gagal menghapus dari server: ' + error.message);
            return;
        }

        // If data is empty, it means no row was deleted (usually due to RLS)
        if (!data || data.length === 0) {
            logger.warn('Deletion returned 0 rows. Check RLS policies.', id);
            showToast('Gagal menghapus: Notifikasi tidak ditemukan atau izin ditolak.');
            return;
        }

        logger.log('Successfully deleted notification:', id);

        // Update UI only after server success
        notifications = notifications.filter(n => n.id !== id);
        unreadCount = notifications.filter(n => !n.is_read).length;
        updateNotificationBadge();

        // Re-render modal if open
        const modal = document.getElementById('notificationModal');
        if (modal && !modal.classList.contains('hidden')) {
            openNotificationModal();
        }

        showToast('Notifikasi berhasil dihapus!');

    } catch (err) {
        logger.error('Failed to delete notification:', err);
        showToast('Terjadi kesalahan saat menghapus notifikasi.');
    }
}

/**
 * Inject Modal HTML
 */
function injectNotificationModal() {
    if (document.getElementById('notificationModal')) return;

    const modalHTML = `
        <div id="notificationModal" class="hidden fixed inset-0 z-[200] flex justify-end pointer-events-none">
            <!-- Backdrop -->
            <div class="absolute inset-0 pointer-events-auto bg-black/40 backdrop-blur-sm" onclick="document.getElementById('notificationModal').classList.add('hidden')"></div>
            
            <!-- Modal Content (Right Sidebar) -->
            <div class="pointer-events-auto w-full sm:w-80 bg-white border-l-4 border-black shadow-2xl h-full flex flex-col animate-slide-in-right relative">
                <div class="bg-comic-yellow p-4 border-b-4 border-black flex justify-between items-center">
                    <h3 class="font-black text-lg uppercase flex items-center gap-2">
                        <span class="material-symbols-outlined">notifications</span>
                        Notifikasi
                    </h3>
                    <button onclick="document.getElementById('notificationModal').classList.add('hidden')" class="hover:scale-110 transition-transform">
                        <span class="material-symbols-outlined font-bold">close</span>
                    </button>
                </div>
                
                <div id="notificationList" class="flex-1 overflow-y-auto bg-white min-h-[300px]">
                    <!-- Items go here -->
                </div>
                
                <div class="p-3 bg-gray-100 border-t-2 border-black text-center">
                    <button onclick="fetchNotifications()" class="text-xs font-bold text-gray-500 hover:text-black uppercase">Refresh</button>
                </div>
            </div>
        </div>
        
        <style>
            @keyframes slide-in-right {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            .animate-slide-in-right {
                animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
        </style>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * Helper: Toast
 */
function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'fixed top-4 right-4 bg-black text-white px-6 py-3 rounded shadow-lg z-[200] flex items-center gap-3 animate-bounce border-2 border-comic-yellow';
    toast.innerHTML = `
        <span class="material-symbols-outlined text-comic-yellow">notifications_active</span>
        <span class="font-bold text-sm">${msg}</span>
    `;
    document.body.appendChild(toast);
    // Increased duration to 8s as requested by user
    setTimeout(() => {
        toast.classList.remove('animate-bounce');
        toast.classList.add('opacity-0', 'transition-opacity', 'duration-500');
        setTimeout(() => toast.remove(), 500);
    }, 8000);
}

// Global exposure
window.openNotifications = openNotificationModal;
window.fetchNotifications = fetchNotifications;
window.handleNotificationClick = handleNotificationClick;
window.deleteNotification = deleteNotification;
