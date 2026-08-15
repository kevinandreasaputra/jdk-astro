import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Event Detail Page Module
 * Handles full-page event display, registration, and discussion
 */

import { sbClient } from '../core/supabase.js';
import { showNotification, formatFriendlyDate } from '../core/utils.js';
import { getCurrentUser } from '../modules/user-session.js';
import { generateGoogleCalendarLink } from '../modules/google-calendar.js';
import { calculateUserLevel } from '../modules/ranks.js';
import QRCode from 'qrcode';
import anime from 'animejs';

// Module state
let currentEvent = null;
let userRegistration = null;

/**
 * Initialize Event Detail Page
 */
export async function initializeEventDetailPage() {
    logger.log('Initializing Event Detail Page...');

    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('id');

    if (!eventId) {
        window.location.href = '/events.html';
        return;
    }

    // Show skeletons if needed (handled by CSS, but we can toggle classes)
    await fetchEventData(eventId);

    if (!currentEvent) {
        showNotification('Event tidak ditemukan.', 'error');
        setTimeout(() => window.location.href = '/events.html', 2000);
        return;
    }

    await fetchUserRegistration(eventId);
    renderEventDetail();
    await loadComments(eventId);
    initializeModals();
}

/**
 * Fetch event from Supabase
 */
async function fetchEventData(id) {
    if (!sbClient) return;
    try {
        const { data, error } = await sbClient
            .from('events')
            .select('id, title, description, date, time, location, image_url, price, xp_reward, point_reward, current_quota, total_quota, min_level, point_fee, gallery_tag')
            .eq('id', id)
            .single();

        if (error) throw error;
        currentEvent = data;
    } catch (err) {
        logger.error('Error fetching event:', err);
    }
}

/**
 * Fetch registration status
 */
async function fetchUserRegistration(eventId) {
    const user = getCurrentUser();
    if (!user || !sbClient) return;

    try {
        const { data, error } = await sbClient
            .from('event_registrations')
            .select('event_id, qr_code, status')
            .eq('event_id', eventId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (error) throw error;
        userRegistration = data;
    } catch (err) {
        logger.error('Error fetching registration:', err);
    }
}

/**
 * Render Event Detail to DOM
 */
function renderEventDetail() {
    if (!currentEvent) return;

    // Head Info
    document.title = `${currentEvent.title} - JDK Events`;

    // Images
    const heroImg = document.getElementById('eventHeroImage');
    const mainImg = document.getElementById('eventMainImage');
    if (heroImg) heroImg.src = currentEvent.image_url || 'images/comic-background.jpg';
    if (mainImg) mainImg.src = currentEvent.image_url || 'images/comic-background.jpg';

    // Text Content
    setTextContent('eventTitle', currentEvent.title);
    setTextContent('eventTime', currentEvent.time || '10:00 - SELESAI');

    // Location with Map Link
    const locEl = document.getElementById('eventLocation');
    if (locEl) {
        const isOnline = (currentEvent.location || '').toLowerCase().includes('online');
        const mapLink = isOnline ? '' : `
            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(currentEvent.location)}" 
               target="_blank" 
               class="flex items-center gap-1 text-[10px] text-comic-blue hover:underline bg-blue-50 px-2 py-1 rounded-lg border border-comic-blue ml-2">
                <span class="material-symbols-outlined text-xs">map</span>
                LIHAT PETA
            </a>
        `;

        locEl.innerHTML = `
            <div class="flex items-center justify-between w-full">
                <span>${currentEvent.location}</span>
                ${mapLink}
            </div>
        `;
    }

    const date = new Date(currentEvent.date);
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    setTextContent('eventDateTop', date.toLocaleDateString('id-ID', options).toUpperCase());

    // Description (Sanitized)
    const descEl = document.getElementById('eventDescription');
    if (descEl) descEl.innerHTML = sanitizeHTML(currentEvent.description || 'Tidak ada deskripsi.');

    // Registration Sidebar
    const priceText = document.getElementById('eventPriceText');
    if (priceText) {
        priceText.textContent = currentEvent.price === 'Gratis' ? 'GRATIS' : currentEvent.price;
        if (currentEvent.price !== 'Gratis') priceText.classList.add('text-comic-red');
    }

    setTextContent('xpReward', `+${currentEvent.xp_reward || 0} XP`);
    setTextContent('pointReward', `+${currentEvent.point_reward || 0} PTS`);

    // Status Badge & Button
    updateRegistrationUI();

    // Google Calendar
    const syncBtn = document.getElementById('syncCalendarBtn');
    if (syncBtn) {
        syncBtn.onclick = () => {
            const link = generateGoogleCalendarLink(currentEvent);
            window.open(link, '_blank');
        };
    }

    // Discussion Avatar
    const user = getCurrentUser();
    const avatarImg = document.getElementById('currentUserAvatar');
    if (avatarImg && user) {
        avatarImg.src = user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`;
    }

    // Load Related Events
    fetchRelatedEvents();
}

/**
 * Update Registration UI based on status
 */
function updateRegistrationUI() {
    const statusBadge = document.getElementById('eventStatusBadge');
    const registerBtn = document.getElementById('registerBtn');
    const qrSection = document.getElementById('qrSection');

    const eventDate = new Date(currentEvent.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isPast = eventDate < today;
    const isFull = (currentEvent.current_quota || 0) >= (currentEvent.total_quota || 50);

    // Default state: Open
    if (statusBadge) {
        statusBadge.textContent = 'PENDAFTARAN DIBUKA';
        statusBadge.className = 'inline-block px-4 py-1.5 bg-comic-green text-black font-black text-xs rounded-full border-2 border-black uppercase tracking-widest';
    }

    if (isPast) {
        if (statusBadge) {
            statusBadge.textContent = 'EVENT SELESAI';
            statusBadge.className = 'inline-block px-4 py-1.5 bg-gray-400 text-white font-black text-xs rounded-full border-2 border-black uppercase tracking-widest';
        }
        if (registerBtn) {
            registerBtn.textContent = 'EVENT SUDAH BERAKHIR';
            registerBtn.disabled = true;
            registerBtn.classList.add('opacity-50', 'grayscale');
        }
    } else if (userRegistration) {
        if (statusBadge) {
            statusBadge.textContent = 'TERDAFTAR';
            statusBadge.className = 'inline-block px-4 py-1.5 bg-comic-blue text-white font-black text-xs rounded-full border-2 border-black uppercase tracking-widest';
        }
        if (registerBtn) registerBtn.classList.add('hidden');
        if (qrSection) {
            qrSection.classList.remove('hidden');
            generateTicketQR(userRegistration.qr_code);
        }
    } else if (isFull) {
        if (statusBadge) {
            statusBadge.textContent = 'KUOTA PENUH';
            statusBadge.className = 'inline-block px-4 py-1.5 bg-comic-red text-white font-black text-xs rounded-full border-2 border-black uppercase tracking-widest';
        }
        if (registerBtn) {
            registerBtn.textContent = 'MAAF, KUOTA PENUH';
            registerBtn.disabled = true;
            registerBtn.classList.add('opacity-50');
        }
    }
}

/**
 * Generate QR Code for Ticket
 */
function generateTicketQR(code) {
    const container = document.getElementById('qrCodeContainer');
    const textEl = document.getElementById('qrCodeText');
    if (!container || !code) return;

    if (textEl) textEl.textContent = code;

    QRCode.toDataURL(code, {
        width: 160,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
    }, (err, url) => {
        if (!err) {
            container.innerHTML = `<img src="${url}" class="w-full h-auto" alt="Ticket QR">`;
        }
    });
}

/**
 * Discussion System
 */
async function loadComments(eventId) {
    const container = document.getElementById('commentsContainer');
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
        if (comments.length === 0) {
            container.innerHTML = `
                <div class="text-center py-16 bg-gray-50 border-3 border-dashed border-black/10 rounded-[2rem]">
                    <p class="text-gray-400 font-bold italic">Belum ada diskusi nih. Yuk mulai tanya-tanya! 💬</p>
                </div>
            `;
            return;
        }

        const threads = comments.filter(c => !c.parent_id);
        const replies = comments.filter(c => c.parent_id);

        container.innerHTML = threads.map(comment => renderCommentItem(comment, replies)).join('');

        // Animate comments
        anime({
            targets: '#commentsContainer > div',
            opacity: [0, 1],
            translateY: [20, 0],
            delay: anime.stagger(100),
            easing: 'easeOutExpo'
        });

    } catch (err) {
        logger.error('Error loading comments:', err);
        container.innerHTML = '<p class="text-red-500 text-center py-8">Gagal memuat diskusi 😭</p>';
    }
}

function renderCommentItem(comment, allReplies = []) {
    const user = getCurrentUser();
    const profile = comment.profiles || { username: 'JDKwan', avatar_url: '' };
    const avatar = profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.username}`;

    const likes = comment.comment_likes || [];
    const isLiked = user && likes.some(l => l.user_id === user.id);
    const replies = allReplies.filter(r => r.parent_id === comment.id);

    return `
        <div class="flex gap-4 group">
            <img src="${avatar}" class="w-10 h-10 rounded-full border-3 border-black shadow-hard-sm flex-shrink-0">
            <div class="flex-1">
                <div class="bg-white border-3 border-black p-4 rounded-2xl shadow-hard relative hover:shadow-hard-lg transition-all">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-sm font-black text-comic-blue">@${profile.username}</span>
                        <span class="text-[10px] text-gray-400 font-bold uppercase">${formatFriendlyDate(comment.created_at)}</span>
                    </div>
                    <p class="text-gray-800 font-body leading-tight mb-3">${sanitizeHTML(comment.content)}</p>
                    <div class="flex gap-6 mt-2 pt-2 border-t-2 border-black/5">
                        <button onclick="window.toggleEventLike('${comment.id}')" class="flex items-center gap-1.5 text-[10px] font-black ${isLiked ? 'text-comic-red' : 'text-gray-400 hover:text-comic-red'}">
                            ${isLiked ? '❤️' : '🤍'} ${likes.length || 'LIKE'}
                        </button>
                        <button onclick="window.prepareReply('${comment.id}', '${profile.username}')" class="flex items-center gap-1.5 text-[10px] font-black text-gray-400 hover:text-comic-blue">
                             💬 REPLY
                        </button>
                    </div>
                </div>
                ${replies.length > 0 ? `
                    <div class="mt-4 pl-6 space-y-4 border-l-4 border-black/5">
                        ${replies.map(r => renderCommentItem(r)).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Registration Logic
 */
window.registerEvent = () => {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu yuk biar tiketmu aman! 🔑', 'warning');
        if (window.openLoginModal) window.openLoginModal();
        return;
    }

    // Eligibility Check
    const minLevel = currentEvent.min_level || 0;
    const pointFee = currentEvent.point_fee || 0;
    const userLevel = calculateUserLevel(user.xp || 0).level;
    const userPoints = user.current_points || 0;

    if (userLevel < minLevel) {
        showNotification(`LEVEL KAMU BELUM CUKUP! Butuh Level ${minLevel} 🔒`, 'error');
        return;
    }

    if (userPoints < pointFee) {
        showNotification(`POIN TIDAK CUKUP! Butuh ${pointFee} PTS 🪙`, 'error');
        return;
    }

    const modal = document.getElementById('registerModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const nameInput = document.getElementById('evtRegName');
        const emailInput = document.getElementById('evtRegEmail');
        const phoneInput = document.getElementById('evtRegPhone');

        if (nameInput) nameInput.value = user.full_name || '';
        if (emailInput) {
            emailInput.value = user.email || '';
            emailInput.readOnly = false;
        }
        if (phoneInput) phoneInput.value = user.whatsapp || '';
    }
};

window.closeRegisterModal = () => {
    const modal = document.getElementById('registerModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.submitRegistration = async () => {
    const user = getCurrentUser();
    const name = document.getElementById('evtRegName')?.value.trim();
    const email = document.getElementById('evtRegEmail')?.value.trim();
    const phone = document.getElementById('evtRegPhone')?.value.trim();

    if (!name || !phone || !email) {
        showNotification('Data tidak boleh kosong ya! ✍️', 'warning');
        return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showNotification('Format email tidak valid! 📧', 'error');
        return;
    }

    // XSS check
    if (/[<>]/.test(name) || /[<>]/.test(phone) || /[<>]/.test(email)) {
        showNotification('Karakter tidak diizinkan! ❌', 'error');
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'eventRegister',
                event_id: currentEvent.id,
                full_name: name,
                email: email,
                phone: phone
            }
        });

        if (error) throw error;
        if (!data.success) {
            showNotification(`❌ ${data.message || data.error}`, 'error');
            return;
        }

        if (data.warning) {
            showNotification(`⚠️ ${data.warning}`, 'warning');
        } else {
            showNotification('PENDAFTARAN BERHASIL! Samapai Jumpa di Event! 🗺️✨', 'success');
        }

        window.closeRegisterModal();

        // Refresh
        await fetchUserRegistration(currentEvent.id);
        updateRegistrationUI();

    } catch (err) {
        logger.error('Reg error:', err);
        showNotification('Pendaftaran gagal. Coba lagi nanti ya! 😭', 'error');
    }
};

/**
 * Comment Actions
 */
window.postComment = async () => {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu yuk kalau mau komentar! ❤️', 'warning');
        if (window.openLoginModal) window.openLoginModal();
        return;
    }

    const input = document.getElementById('commentContent');
    const content = input?.value.trim();
    const parentId = input?.dataset.parentId || null;

    if (!content) return;

    if (/[<>]/.test(content)) {
        showNotification('Tag HTML tidak diizinkan! 🛡️', 'error');
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'eventComment', event_id: currentEvent.id, content: content, parent_id: parentId }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal kirim komentar');

        if (input) {
            input.value = '';
            delete input.dataset.parentId;
            input.placeholder = "Tulis komentar atau tanya-tanya...";
        }

        await loadComments(currentEvent.id);

    } catch (err) {
        logger.error('Comment error:', err);
        showNotification(err.message || 'Gagal kirim komentar. Coba lagi! 😭', 'error');
    }
};

window.prepareReply = (id, username) => {
    const input = document.getElementById('commentContent');
    if (input) {
        input.dataset.parentId = id;
        input.placeholder = `Membalas @${username}...`;
        input.focus();
    }
};

window.toggleEventLike = async (id) => {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login buat pencet like! ❤️', 'warning');
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'toggleEventCommentLike', comment_id: id }
        });

        if (error) throw error;

        await loadComments(currentEvent.id);
    } catch (err) {
        logger.error('Like error:', err);
    }
};

/**
 * Helpers
 */
function setTextContent(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function sanitizeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]).replace(/\n/g, '<br>');
}



function initializeModals() {
    // Globally register for window-level access
    window.initializeEventDetailPage = initializeEventDetailPage;
    window.shareEvent = shareEvent;
}

/**
 * Share Event Logic
 */
export function shareEvent(platform) {
    const url = window.location.href;
    const text = `Cek event seru ini: ${currentEvent.title} di JDK Entertainment! 🎤✨`;

    switch (platform) {
        case 'whatsapp':
            window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank');
            break;
        case 'twitter':
            window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
            break;
        case 'facebook':
            window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
            break;
        case 'telegram':
            window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank');
            break;
        case 'copy':
            navigator.clipboard.writeText(url).then(() => {
                showNotification('Link disalin ke clipboard! 📋', 'success');
            });
            break;
    }
}

/**
 * Fetch Related Events
 */
async function fetchRelatedEvents() {
    const container = document.getElementById('relatedEventsContainer');
    if (!container || !currentEvent) return;

    try {
        const { data, error } = await sbClient
            .from('events')
            .select('id, title, image_url, price, date, location')
            .neq('id', currentEvent.id)
            .gte('date', new Date().toISOString())
            .limit(3)
            .order('date', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            document.getElementById('relatedEventsSection')?.classList.add('hidden');
            return;
        }

        container.innerHTML = data.map(event => `
            <a href="event-detail.html?id=${event.id}" class="group block bg-white border-3 border-black rounded-2xl overflow-hidden hover:shadow-hard transition-all">
                <div class="aspect-video relative overflow-hidden">
                    <img src="${event.image_url || '/images/comic-background.jpg'}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" alt="${event.title}">
                    <div class="absolute top-2 right-2 bg-primary px-2 py-0.5 border-2 border-black rounded-lg text-[10px] font-black uppercase tracking-widest">
                        ${event.price === 'Gratis' ? 'FREE' : 'PAID'}
                    </div>
                </div>
                <div class="p-4">
                    <p class="text-[8px] font-black text-comic-red uppercase tracking-wider mb-1">${formatFriendlyDate(event.date)}</p>
                    <h4 class="font-black text-sm uppercase leading-tight truncate mb-2">${event.title}</h4>
                    <p class="text-[10px] text-gray-400 font-bold truncate">📍 ${event.location}</p>
                </div>
            </a>
        `).join('');

    } catch (err) {
        logger.error('Error fetching related events:', err);
    }
}

// Auto-run if not being imported as a module (optional fallback)
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        if (window.location.pathname.includes('event-detail.html')) {
            initializeEventDetailPage();
        }
    });
}

/**
 * Open Image Lightbox
 */
window.openLightbox = () => {
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImage');
    const mainImg = document.getElementById('eventMainImage');

    if (lightbox && lightboxImg && mainImg) {
        lightboxImg.src = mainImg.src;
        lightbox.classList.remove('hidden');
        lightbox.classList.add('flex');

        // Small delay to trigger animation
        setTimeout(() => {
            lightbox.classList.remove('opacity-0');
            lightboxImg.classList.remove('scale-95');
            lightboxImg.classList.add('scale-100');
        }, 10);
    }
};

/**
 * Close Image Lightbox
 */
window.closeLightbox = () => {
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImage');

    if (lightbox && lightboxImg) {
        lightbox.classList.add('opacity-0');
        lightboxImg.classList.remove('scale-100');
        lightboxImg.classList.add('scale-95');

        // Wait for animation to finish
        setTimeout(() => {
            lightbox.classList.remove('flex');
            lightbox.classList.add('hidden');
        }, 300);
    }
};
