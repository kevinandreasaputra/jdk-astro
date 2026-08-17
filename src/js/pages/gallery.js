/**
 * JDK Entertainment - Gallery Page Module
 * Handles gallery with NostalgiaGallery component and event integration
 */

import { NostalgiaGallery } from '../components/NostalgiaGallery.js';
import { fetchEventsWithGallery, fetchPhotosByEvent } from '../modules/galleryService.js';

// Module state
let currentGallery = null;
let eventsWithGallery = [];
let historyEvent = null;
let recentEvents = [];

/**
 * Initialize gallery page
 */
export async function initializeGalleryPage() {
    // Fetch events with gallery tags
    eventsWithGallery = await fetchEventsWithGallery();

    // Process History & Archive
    processHistoryAndArchive();

    // Render sections
    renderHistorySection();
    renderArchiveSection();
    renderAlbumCards();
}

/**
 * Process events to find History (On This Day) and Archive
 */
function processHistoryAndArchive() {
    const today = new Date();
    const tMonth = today.getMonth(); // 0-11
    const tDate = today.getDate();

    // 1. Find history match (Same Month & Day, Any Year)
    historyEvent = eventsWithGallery.find(e => {
        const d = new Date(e.date);
        return d.getMonth() === tMonth && d.getDate() === tDate;
    });

    // Fallback: If no history, pick random featured
    if (!historyEvent && eventsWithGallery.length > 0) {
        // Simple random for featured - or pick the latest big event
        historyEvent = eventsWithGallery[Math.floor(Math.random() * eventsWithGallery.length)];
        if (historyEvent) historyEvent.isFeatured = true;
    }

    // 2. Archive (Recent 3 events)
    recentEvents = eventsWithGallery
        .filter(e => new Date(e.date) < today)
        // Sort explicitly by date desc just in case
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 3);
}

/**
 * Render "Hari Ini Dalam Sejarah" / Featured Card
 */
async function renderHistorySection() {
    const container = document.getElementById('history-card-container');
    if (!container || !historyEvent) return;

    // Fetch a few photos for the grid preview if needed (limit 3)
    let previewPhotos = [];
    if (historyEvent.id) {
        const photos = await fetchPhotosByEvent(historyEvent.id);
        previewPhotos = photos.slice(0, 3);
    }

    const dateObj = new Date(historyEvent.date);
    const dayStr = dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
    const label = historyEvent.isFeatured ? 'Featured Memory' : 'Hari Ini Dalam Sejarah';
    const subLabel = historyEvent.isFeatured ? 'Kilas Balik Spesial' : 'Momentum Bersejarah';
    const desc = historyEvent.description ? `"${historyEvent.description}"` : 'Momen tak terlupakan dari perjalanan komunitas JDK.';

    // Construct Photos Grid HTML
    let photosHtml = '';
    // Prefer fetched photos, fallback to event image repeated/placeholder
    const imagesToUse = previewPhotos.length > 0 ? previewPhotos.map(p => p.optimized_url || p.photo_url) : [historyEvent.image_url];

    // Ensure 3 slots for layout balance (fill with pattern/placeholder if needed)
    while (imagesToUse.length < 3) imagesToUse.push('/images/jdk-logo.png'); // Fallback

    photosHtml = imagesToUse.slice(0, 3).map(url => `
        <img src="${window.optimizeImageUrl ? window.optimizeImageUrl(url, 400) : url}" 
             loading="lazy"
             class="w-full h-32 object-cover rounded-lg border-2 border-black hover:scale-105 transition-transform bg-gray-200 cursor-pointer"
             onclick="window.openEventAlbum('${historyEvent.id}', '${escapeAttribute(historyEvent.title)}')"
        >
    `).join('');

    container.innerHTML = `
        <div class="absolute top-0 right-0 bg-primary text-xs font-black px-3 py-1 border-b-2 border-l-2 border-black rounded-bl-xl uppercase">
            ${label}
        </div>

        <div class="flex items-center gap-4 mb-6">
            <span class="text-5xl">📅</span>
            <div>
                <h3 class="text-3xl font-black uppercase tracking-tight leading-none">${dayStr}</h3>
                <p class="font-bold text-gray-500">${subLabel}</p>
            </div>
        </div>

        <h4 class="text-2xl font-black uppercase text-comic-red mb-4 cursor-pointer hover:underline" 
            onclick="window.openEventAlbum('${historyEvent.id}', '${escapeAttribute(historyEvent.title)}')">
            ${escapeHtml(historyEvent.title)}
        </h4>
        <p class="text-lg text-gray-800 font-medium leading-relaxed mb-6 font-body border-l-4 border-primary pl-4 italic">
            ${escapeHtml(desc)}
        </p>

        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            ${photosHtml}
        </div>
    `;
}

/**
 * Render Archive Sidebar
 */
function renderArchiveSection() {
    const container = document.getElementById('archive-list-container');
    if (!container) return;

    if (recentEvents.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm">Belum ada arsip.</div>';
        return;
    }

    container.innerHTML = recentEvents.map(event => {
        const date = new Date(event.date);
        const day = date.getDate();
        const fullDate = date.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

        // Dynamic colors just for fun/variety based on day
        const colors = ['bg-comic-orange', 'bg-comic-green', 'bg-comic-blue', 'bg-comic-yellow'];
        const colorClass = colors[day % colors.length];

        return `
        <div class="bg-white/5 border border-transparent p-4 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group"
             onclick="window.openEventAlbum('${event.id}', '${escapeAttribute(event.title)}')">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 ${colorClass} rounded-full flex items-center justify-center text-black font-black border-2 border-black group-hover:scale-110 transition-transform">
                    ${day}
                </div>
                <div>
                    <h4 class="font-bold text-white uppercase text-sm group-hover:text-primary transition-colors">
                        ${fullDate}
                    </h4>
                    <p class="text-xs text-gray-400 font-body truncate max-w-[150px]">
                        ${escapeHtml(event.title)}
                    </p>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

/**
 * Render album cards from events with gallery tags
 */
function renderAlbumCards() {
    const container = document.getElementById('gallery-albums-grid');
    if (!container) return;

    if (!eventsWithGallery || eventsWithGallery.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-12">
                <p class="text-gray-500 text-lg font-bold">📸 Belum ada album gallery</p>
                <p class="text-gray-400 text-sm">Album akan muncul setelah event memiliki foto</p>
            </div>
        `;
        return;
    }

    container.innerHTML = eventsWithGallery.map(event => `
        <div class="group cursor-pointer" onclick="window.openEventAlbum('${event.id}', '${escapeAttribute(event.title)}')">
            <div class="relative overflow-hidden rounded-2xl border-4 border-black shadow-[6px_6px_0px_#000] group-hover:shadow-none group-hover:translate-x-[2px] group-hover:translate-y-[2px] transition-all bg-background-light">
                <div class="h-56 overflow-hidden border-b-4 border-black">
                    <img 
                        src="${window.optimizeImageUrl ? window.optimizeImageUrl(event.image_url, 400) : (event.image_url || 'https://placehold.co/400x300?text=' + encodeURIComponent(event.title))}" 
                        alt="${escapeHtml(event.title)}"
                        loading="lazy"
                        class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    />
                </div>
                <div class="p-6">
                    <h3 class="text-2xl font-black uppercase text-black mb-1 group-hover:text-primary transition-colors">
                        ${escapeHtml(event.title)}
                    </h3>
                    <p class="text-sm font-bold text-gray-500 font-body mb-4">
                        ${formatDate(event.date)}
                    </p>
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-black bg-black text-white px-2 py-1 rounded inline-block">
                            EVENT
                        </span>
                        <span class="text-xs font-bold text-gray-500 flex items-center gap-1">
                            <span class="material-symbols-outlined text-sm">photo_library</span>
                            ${event.photo_count || 0} Photos
                        </span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Open event album and show photos
 */
export async function openEventAlbum(eventId, eventTitle) {
    // Hide albums grid
    const albumsSection = document.getElementById('gallery-albums-grid');
    const photosSection = document.getElementById('selected-album-photos');
    const albumTitle = document.getElementById('selected-album-title');

    if (albumsSection) albumsSection.classList.add('hidden');
    if (photosSection) photosSection.classList.remove('hidden');
    if (albumTitle) albumTitle.textContent = eventTitle;

    // Destroy existing gallery if any
    if (currentGallery) {
        currentGallery = null;
    }

    // Create new NostalgiaGallery instance
    currentGallery = new NostalgiaGallery('nostalgia-gallery-container', {
        eventId: eventId,
        columns: 4,
        showEventBadge: false, // We already know which event this is
    });

    // Store in window for modal access
    window.nostalgiaGallery = currentGallery;

    // Scroll to photos
    photosSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Close album photos view and return to albums grid
 */
export function closeAlbumPhotos() {
    const albumsSection = document.getElementById('gallery-albums-grid');
    const photosSection = document.getElementById('selected-album-photos');

    if (albumsSection) albumsSection.classList.remove('hidden');
    if (photosSection) photosSection.classList.add('hidden');

    // Clear container
    const container = document.getElementById('nostalgia-gallery-container');
    if (container) container.innerHTML = '';

    // Destroy gallery instance
    if (currentGallery) {
        currentGallery = null;
        window.nostalgiaGallery = null;
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Utility: Escape string for use in HTML attributes (onclick)
 */
function escapeAttribute(text) {
    if (!text) return '';
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

/**
 * Utility: Escape HTML content
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Utility: Format date
 */
function formatDate(dateString) {
    const date = new Date(dateString);
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('id-ID', options);
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.initializeGalleryPage = initializeGalleryPage;
    window.openEventAlbum = openEventAlbum;
    window.closeAlbumPhotos = closeAlbumPhotos;
}
