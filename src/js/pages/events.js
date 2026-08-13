import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Events Page Module
 * Handles events page functionality including calendar and event modals
 */

import { sbClient } from '../core/supabase.js';
import { showNotification, formatFriendlyDate } from '../core/utils.js';
import { getCurrentUser } from '../modules/user-session.js';
import { generateGoogleCalendarLink } from '../modules/google-calendar.js';
import { calculateUserLevel } from '../modules/ranks.js';
import QRCode from 'qrcode';

// Module state
let selectedDate = null;
let currentEvent = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let eventsData = [];
let userRegistrations = []; // Store IDs of events user is registered for

// Month names in Indonesian
const monthNames = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

/**
 * Initialize events page
 */
export async function initializeEventsPage() {
    await fetchEvents();
    await fetchUserRegistrations(); // Fetch registrations
    generateCalendar();
    initializeEventModals();
    setupNavigation();
}

/**
 * Fetch events from Supabase
 */
async function fetchEvents() {
    logger.log('Fetching events from Supabase...');
    if (!sbClient) return;

    try {
        const { data, error } = await sbClient
            .from('events')
            .select('*')
            .order('date', { ascending: true });

        if (error) throw error;
        eventsData = data || [];
        logger.log(`Fetched ${eventsData.length} events successfully.`);
    } catch (err) {
        logger.error('Error fetching events:', err);
        // Fallback or empty
        eventsData = [];
    }
}

/**
 * Fetch user registrations
 */
async function fetchUserRegistrations() {
    const user = getCurrentUser();
    if (!user || !sbClient) {
        userRegistrations = [];
        return;
    }

    try {
        const { data, error } = await sbClient
            .from('event_registrations')
            .select('event_id, qr_code, status')
            .eq('user_id', user.id);

        if (error) throw error;
        // Store full registration data (not just event_id)
        userRegistrations = data || [];
        logger.log('User Registrations:', userRegistrations);
    } catch (err) {
        logger.error('Error fetching registrations:', err);
        userRegistrations = [];
    }
}

/**
 * Check if user is registered for an event
 * @param {string} eventId - Event ID to check
 * @returns {boolean}
 */
function isUserRegistered(eventId) {
    return userRegistrations.some(r => r.event_id === eventId);
}

/**
 * Get user registration for an event
 * @param {string} eventId - Event ID
 * @returns {object|null} - Registration object with qr_code, status, etc.
 */
function getUserRegistration(eventId) {
    return userRegistrations.find(r => r.event_id === eventId) || null;
}

/**
 * Open QR Code modal to show user's ticket
 * @param {string} eventId - Event ID
 */
export function showQrCode(eventId) {
    const event = eventsData.find(e => e.id === eventId);
    const registration = getUserRegistration(eventId);

    if (!event || !registration || !registration.qr_code) {
        showNotification('QR Code tidak ditemukan. Coba refresh halaman.');
        return;
    }

    const modal = document.getElementById('qrCodeModal');
    if (!modal) return;

    // Set title
    const titleEl = document.getElementById('qrEventTitle');
    if (titleEl) titleEl.textContent = event.title;

    // Set QR code text
    const textEl = document.getElementById('qrCodeText');
    if (textEl) textEl.textContent = registration.qr_code;

    // Generate QR code
    const container = document.getElementById('qrCodeContainer');
    if (container) {
        container.innerHTML = '';

        QRCode.toDataURL(registration.qr_code, {
            width: 240,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        }, (err, url) => {
            if (err) {
                logger.error('QR error:', err);
                container.innerHTML = '<p class="text-xs text-red-500">Gagal generate QR Code</p>';
            } else {
                const img = document.createElement('img');
                img.src = url;
                img.alt = 'Event Ticket QR';
                img.className = 'mx-auto';
                container.appendChild(img);
            }
        });
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

/**
 * Close QR Code modal
 */
export function closeQrCodeModal() {
    const modal = document.getElementById('qrCodeModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * Generate calendar grid
 */
export function generateCalendar() {
    const calendarGrid = document.getElementById('calendar-grid');
    const monthDisplay = document.getElementById('calendarMonth');

    if (!calendarGrid) return;
    if (monthDisplay) {
        monthDisplay.textContent = `${monthNames[currentMonth]} ${currentYear}`;
    }

    const today = new Date();

    // Clear existing calendar
    calendarGrid.innerHTML = '';

    // Get first day of month and number of days
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Add empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day p-4 text-center text-gray-400 opacity-20';
        calendarGrid.appendChild(emptyDay);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day cursor-pointer';
        dayElement.textContent = day;

        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Highlight today
        if (day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear()) {
            dayElement.classList.add('today');
        }

        // Mark days with events
        const eventOnDay = eventsData.find(e => e.date.startsWith(dateStr));
        const hasEvent = !!eventOnDay;

        if (hasEvent) {
            dayElement.classList.add('has-event');

            // Check if registered for this event
            if (eventOnDay && isUserRegistered(eventOnDay.id)) {
                const badge = document.createElement('div');
                badge.className = 'absolute top-0 right-0 w-3 h-3 bg-green-500 rounded-full border border-black transform translate-x-1 -translate-y-1';
                badge.title = 'Terdaftar';
                dayElement.style.position = 'relative'; // Ensure positioning context
                dayElement.style.overflow = 'visible';  // Allow badge to pop out slightly
                dayElement.appendChild(badge);
            }
        }

        if (selectedDate === day) {
            dayElement.classList.add('selected');
        }

        dayElement.onclick = () => selectCalendarDay(day);
        calendarGrid.appendChild(dayElement);
    }

    updateEventList();
}

/**
 * Update event list sidebar
 */
function updateEventList() {
    const eventListContainer = document.getElementById('eventsListContainer');
    const pastEventListContainer = document.getElementById('pastEventsListContainer');

    logger.log('Update Event List. Containers:', { eventListContainer, pastEventListContainer });

    if (!eventListContainer) {
        logger.warn('eventsListContainer not found in DOM.');
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filter upcoming events
    const upcoming = eventsData
        .filter(e => new Date(e.date) >= today)
        .slice(0, 5);

    // Filter past events of the current month
    const past = eventsData
        .filter(e => {
            const date = new Date(e.date);
            return date < today && date.getMonth() === currentMonth && date.getFullYear() === currentYear;
        })
        .reverse(); // Newest first for past events

    logger.log('Filtered Events:', { upcoming: upcoming.length, past: past.length });

    // Render Upcoming
    if (upcoming.length === 0) {
        eventListContainer.innerHTML = '<p class="text-gray-500 font-body text-center py-4">Tidak ada event mendatang</p>';
    } else {
        eventListContainer.innerHTML = upcoming.map(event => renderEventCard(event)).join('');
    }

    // Render Past
    if (pastEventListContainer) {
        if (past.length === 0) {
            pastEventListContainer.innerHTML = '<p class="text-gray-400 font-body text-xs text-center py-4 italic">Belum ada riwayat di bulan ini</p>';
        } else {
            pastEventListContainer.innerHTML = past.map(event => renderEventCard(event, true)).join('');
        }
    }
}

/**
 * Render a single event card for the sidebar
 */
function renderEventCard(event, isPast = false) {
    const date = new Date(event.date);
    const dateFormatted = `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
    const colorClass = isPast ? 'bg-gray-400' : (event.price === 'Gratis' ? 'bg-comic-green' : 'bg-comic-orange');
    const priceColor = isPast ? 'text-gray-500' : (event.price === 'Gratis' ? 'text-comic-green' : 'text-comic-red');
    const isRegistered = isUserRegistered(event.id);

    return `
        <div class="bg-white border text-black shadow-sm rounded-2xl p-5 cursor-pointer relative group hover:border-primary transition-all duration-300 ${isPast ? 'opacity-70 grayscale' : ''}" onclick="openEventModal('${event.id}')">
            ${isRegistered ? '<div class="absolute top-4 right-4 bg-green-500 text-white text-[10px] font-black px-2 py-1 rounded-lg border-2 border-black shadow-[2px_2px_0px_#000] z-10">TERDAFTAR</div>' : ''}
            <div class="flex items-center gap-3 mb-3">
                <div class="w-3 h-3 ${colorClass} rounded-full"></div>
                <span class="text-xs font-black uppercase tracking-tight text-gray-500">${dateFormatted}</span>
            </div>
            <h4 class="text-black font-black mb-1 text-lg leading-tight group-hover:text-primary transition-colors">${event.title}</h4>
            <div class="flex justify-between items-center mt-3 pt-3 border-t border-black/5">
                <span class="text-xs font-bold text-gray-400 flex items-center gap-1">
                    <span class="material-symbols-outlined text-sm">location_on</span>
                    ${event.location}
                </span>
                <span class="text-xs font-black ${priceColor} uppercase italic">${event.price}</span>
            </div>
        </div>
    `;
}

/**
 * DISCUSSION SYSTEM LOGIC
 */

/**
 * Load comments for an event
 */
async function loadComments(eventId) {
    const container = document.getElementById('commentsContainer');
    const countBadge = document.getElementById('commentCount');
    if (!container) return;

    try {
        const { data, error } = await sbClient
            .from('event_comments')
            .select(`
                *,
                profiles:user_id (username, avatar_url),
                comment_likes (user_id)
            `)
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        const comments = data || [];
        if (countBadge) countBadge.textContent = comments.length;

        if (comments.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl">
                    <p class="text-sm text-gray-400 font-bold italic">Belum ada diskusi nih. Yuk mulai tanya-tanya! 💬</p>
                </div>
            `;
            return;
        }

        // Group into threads
        const threads = comments.filter(c => !c.parent_id);
        const replies = comments.filter(c => c.parent_id);

        container.innerHTML = threads.map(comment => renderCommentItem(comment, replies)).join('');

    } catch (err) {
        logger.error('Error loading comments:', err);
        container.innerHTML = '<p class="text-red-500 text-xs text-center py-4">Gagal memuat diskusi 😭</p>';
    }
}

/**
 * Render single comment item
 */
function renderCommentItem(comment, allReplies = []) {
    const user = getCurrentUser();
    const profile = comment.profiles || { username: 'JDKwan', avatar_url: '' };
    const avatar = profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.username}`;

    // Check if liked by current user
    const likes = comment.comment_likes || [];
    const isLiked = user && likes.some(l => l.user_id === user.id);
    const likeCount = likes.length;

    const replies = allReplies.filter(r => r.parent_id === comment.id);
    const timeAgo = formatFriendlyDate(comment.created_at);

    return `
        <div class="flex gap-3 group">
            <img src="${avatar}" class="w-8 h-8 rounded-full border-2 border-black shadow-hard-sm flex-shrink-0">
            <div class="flex-1">
                <div class="bg-gray-50 border-2 border-black p-3 rounded-2xl shadow-hard-sm relative">
                    <div class="flex justify-between items-start mb-1">
                        <span class="text-xs font-black text-comic-blue leading-none">${profile.username}</span>
                        <span class="text-[10px] text-gray-400 font-mono">${timeAgo}</span>
                    </div>
                    <p class="text-sm text-gray-800 font-body leading-tight">${escapeHTML(comment.content)}</p>
                    
                    <!-- Like/Reply Actions -->
                    <div class="flex gap-4 mt-2 pt-2 border-t border-black/5">
                        <button onclick="toggleCommentLike('${comment.id}')" class="text-[10px] font-bold flex items-center gap-1 ${isLiked ? 'text-comic-red' : 'text-gray-400 hover:text-comic-red'} transition-colors">
                            ${isLiked ? '❤️' : '🤍'} ${likeCount > 0 ? likeCount : 'LIKE'}
                        </button>
                        <button onclick="prepareReply('${comment.id}', '${profile.username}')" class="text-[10px] font-bold text-gray-400 hover:text-comic-blue transition-colors">
                            💬 REPLY
                        </button>
                    </div>
                </div>

                <!-- Replies Container -->
                <div class="mt-3 pl-4 space-y-3 border-l-2 border-black/10">
                    ${replies.map(r => renderCommentItem(r)).join('')}
                </div>
            </div>
        </div>
    `;
}

/**
 * Post a new comment
 */
export async function postComment() {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu yuk kalau mau ikutan diskusi! 🔑', 'warning');
        if (typeof window.openLoginModal === 'function') window.openLoginModal();
        return;
    }

    const input = document.getElementById('commentContent');
    const content = input.value.trim();
    const parentId = input.dataset.parentId || null;

    if (!content) return;

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'eventComment', event_id: currentEvent.id, content: content, parent_id: parentId }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal kirim komentar');

        input.value = '';
        delete input.dataset.parentId;
        input.placeholder = "Tulis komentar atau tanya-tanya...";

        await loadComments(currentEvent.id);

    } catch (err) {
        logger.error('Error posting comment:', err);
        showNotification(err.message || 'Gagal kirim komentar nih, coba lagi ya! 😭', 'error');
    }
}

/**
 * Prepare reply
 */
window.prepareReply = (commentId, username) => {
    const input = document.getElementById('commentContent');
    if (!input) return;

    input.dataset.parentId = commentId;
    input.placeholder = `Membalas @${username}...`;
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

/**
 * Toggle Like
 */
window.toggleCommentLike = async (commentId) => {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login buat pencet like dong! ❤️', 'warning');
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'toggleEventCommentLike', comment_id: commentId }
        });

        if (error) throw error;

        await loadComments(currentEvent.id);

    } catch (err) {
        logger.error('Error toggling like:', err);
    }
};

/**
 * Format Time Ago
 */
function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " tahun";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " bulan";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " hari";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " jam";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " menit";
    return "baru saja";
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[m]);
}


/**
 * Setup navigation buttons
 */
function setupNavigation() {
    const prevBtn = document.getElementById('prevMonth');
    const nextBtn = document.getElementById('nextMonth');

    if (prevBtn) {
        prevBtn.onclick = () => {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            generateCalendar();
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            generateCalendar();
        };
    }
}

/**
 * Handle calendar day selection
 * @param {number} day - Day number
 */
export function selectCalendarDay(day) {
    selectedDate = day;
    generateCalendar();

    // Find and scroll to event or show detail if clicked
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const event = eventsData.find(e => e.date.startsWith(dateStr));
    if (event) {
        openEventModal(event.id);
    }
}

/**
 * Initialize event modals
 */
function initializeEventModals() {
    // Already handled globally but ensuring listeners
    window.openEventModal = openEventModal;
    window.registerEvent = registerEvent;
    window.closeRegisterModal = closeRegisterModal;
    window.submitRegistration = submitRegistration;
    window.postComment = postComment;
}

/**
 * Open event detail full page
 * @param {string} eventId - Event identifier (UUID from Supabase)
 */
export async function openEventModal(eventId) {
    if (!eventId) return;
    window.location.href = `event-detail.html?id=${eventId}`;
}

// Event detail modal functionality has been moved to event-detail.html / event-detail.js

/**
 * Open event registration
 */
export function registerEvent() {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Waduh bestie, login dulu yuk! Biar datanya masuk dan tiketmu aman. 🙏');
        if (typeof window.openLoginModal === 'function') window.openLoginModal();
        return;
    }

    // closeEventModal(); // Removed as function no longer exists

    const registerModal = document.getElementById('registerModal');
    if (registerModal) {
        registerModal.classList.remove('hidden');
        registerModal.classList.add('flex');

        const nameInput = document.getElementById('regName');
        const emailInput = document.getElementById('regEmail');
        const phoneInput = document.getElementById('regPhone');

        if (nameInput) nameInput.value = user.full_name || '';
        if (emailInput) emailInput.value = user.email || '';
        if (phoneInput) phoneInput.value = user.whatsapp || '';

        const paymentSection = document.getElementById('paymentSection');
        if (currentEvent && currentEvent.price !== 'Gratis') {
            if (paymentSection) paymentSection.classList.remove('hidden');
        } else {
            if (paymentSection) paymentSection.classList.add('hidden');
        }
    }
}

/**
 * Close registration modal
 */
export function closeRegisterModal() {
    const modal = document.getElementById('registerModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

/**
 * Submit event registration (SECURE - uses server-side RPC)
 */
export async function submitRegistration() {
    const user = getCurrentUser();
    if (!user || !currentEvent || !sbClient) return;

    const name = document.getElementById('regName')?.value;
    const phone = document.getElementById('regPhone')?.value;

    if (!name || !phone) {
        showNotification('Eits, jangan ada yang kosong ya! Diisi dulu dong datanya biar afdol. ✍️');
        return;
    }

    try {
        // Call secure Supabase Edge Function that handles registration + point deduction atomically
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'eventRegister',
                event_id: currentEvent.id,
                full_name: name,
                phone: phone
            }
        });

        if (error) throw error;

        if (!data.success) {
            showNotification(`❌ ${data.message || data.error}`);
            return;
        }

        // Success!
        if (data.points_deducted > 0) {
            showNotification(`✅ Pendaftaran berhasil! 💰 ${data.points_deducted} Points dipotong. Tunjukkan QR Code di lokasi ya! 📱`);
        } else {
            showNotification('✅ Mantap! Pendaftaran berhasil! ' + (currentEvent.price === 'Gratis' ? 'Tunjukkan QR Code di lokasi ya! 📱' : 'Admin bakal cek dulu ya, tungguin kabarnya! 📩'));
        }

        closeRegisterModal();
        await fetchEvents();
        await fetchUserRegistrations();
        generateCalendar();

    } catch (err) {

        logger.error('Registration error detail:', err);
        const rawMsg = err.message || String(err);
        if (err.code === '23505' || rawMsg.toLowerCase().includes('duplicate') || rawMsg.toLowerCase().includes('already registered')) {
            showNotification('🤚 Eits, santai bestie! Kamu udah terdaftar keles. Tiketmu aman kok, nggak usah daftar dua kali ya! 😎');
            closeRegisterModal();
        } else {
            showNotification('❌ Waduh, pendaftaran gagal nih: ' + rawMsg);
        }
    }
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.initializeEventsPage = initializeEventsPage;
    window.generateCalendar = generateCalendar;
    window.selectCalendarDay = selectCalendarDay;
    window.openEventModal = openEventModal;
    window.registerEvent = registerEvent;
    window.closeRegisterModal = closeRegisterModal;
    window.submitRegistration = submitRegistration;
    window.showQrCode = showQrCode;
    window.closeQrCodeModal = closeQrCodeModal;
    window.postComment = postComment;
}
