import { logger } from '../core/logger.js';
/**
 * Photo Upload Service
 * Handles Cloudinary widget integration and metadata saving
 */

import { supabase, SUPABASE_URL } from '../core/supabase.js';

// Cloudinary Configuration
const PRESET_NAME = 'jdk_gallery_upload'; // Make sure this exists in Cloudinary
const CLOUD_NAME = 'dcurlsei7';

let widget;
let uploadedPhotos = []; // Store uploaded photo data temporarily
let selectedEvent = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Check Admin Auth
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    // Check admin profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('user_level')
        .eq('id', user.id)
        .single();

    if (!profile || profile.user_level !== 'Admin') {
        alert('Unauthorized access');
        window.location.href = 'index.html';
        return;
    }

    await loadEvents();
    setupEventListeners();
});

async function loadEvents() {
    const eventSelect = document.getElementById('eventSelect');
    // Reset dropdown to prevent duplication on re-loads
    eventSelect.innerHTML = '<option value="">-- Choose an Event --</option>';

    const { data: events, error } = await supabase
        .from('events')
        .select('id, title, date, gallery_tag')
        .order('date', { ascending: false });

    if (error) {
        logger.error('Error loading events:', error);
        eventSelect.innerHTML = `<option value="">Error loading events: ${error.message}</option>`;
        alert(`Failed to load events. Check if 'gallery_tag' column exists in 'events' table.\nError: ${error.message}`);
        return;
    }

    if (!events || events.length === 0) {
        eventSelect.innerHTML = `<option value="">No events found in database</option>`;
        return;
    }

    events.forEach(event => {
        const option = document.createElement('option');
        option.value = event.id;
        option.textContent = `${event.date} - ${event.title}` + (event.gallery_tag ? ` [Tag: ${event.gallery_tag}]` : ' [No Tag]');
        option.dataset.tag = event.gallery_tag || '';
        option.dataset.title = event.title;
        eventSelect.appendChild(option);
    });
}

// ... (Previous existing code)

// --- Cloudinary Browsing Features ---
let cloudBrowserState = {
    nextCursor: null,
    isLoading: false,
    selectedPublicIds: new Map(), // Changed to Map to store id -> photo object
    currentQuery: '' // Track search query
};

async function openCloudinaryBrowser() {
    if (!selectedEvent) return;

    const browser = document.getElementById('cloudinaryBrowser');
    const grid = document.getElementById('cloudinaryGrid');
    browser.classList.remove('hidden');

    if (grid.children.length <= 1 && !cloudBrowserState.currentQuery) { // Only loading text & no active search
        await loadCloudinaryResources();
    }
}

async function closeCloudinaryBrowser() {
    document.getElementById('cloudinaryBrowser').classList.add('hidden');
}

async function performSearch() {
    const input = document.getElementById('tagSearchInput');
    const query = input.value.trim();

    // if (!query) return; // Allow empty search to reset? Handled by reset button.

    cloudBrowserState.currentQuery = query;
    await loadCloudinaryResources(true); // Reset grid and load
}

async function resetSearch() {
    document.getElementById('tagSearchInput').value = '';
    cloudBrowserState.currentQuery = '';
    await loadCloudinaryResources(true);
}

async function loadCloudinaryResources(reset = false) {
    if (cloudBrowserState.isLoading) return;

    if (reset) {
        cloudBrowserState.nextCursor = null;
        document.getElementById('cloudinaryGrid').innerHTML = '';
    }

    cloudBrowserState.isLoading = true;
    const grid = document.getElementById('cloudinaryGrid');
    const loadMoreBtn = document.getElementById('loadMoreBtn');

    if (reset || grid.children.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-8 text-gray-500 font-bold">Loading resources...</div>';
    }

    try {
        const url = new URL(`${SUPABASE_URL}/functions/v1/cloudinary-fetch`);

        // Use 'search' action if query exists, otherwise 'list'
        if (cloudBrowserState.currentQuery) {
            url.searchParams.set('action', 'search');
            url.searchParams.set('query', cloudBrowserState.currentQuery);
        } else {
            url.searchParams.set('action', 'list');
        }

        if (cloudBrowserState.nextCursor) {
            url.searchParams.set('next_cursor', cloudBrowserState.nextCursor);
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        // Clear loading if first load
        if (reset || !cloudBrowserState.nextCursor) {
            grid.innerHTML = '';
        }

        cloudBrowserState.nextCursor = data.next_cursor;

        if (data.photos.length === 0) {
            grid.innerHTML = `<div class="col-span-full text-center py-8 text-gray-400">No photos found ${cloudBrowserState.currentQuery ? 'for "' + cloudBrowserState.currentQuery + '"' : ''}</div>`;
        }

        data.photos.forEach(photo => {
            const div = document.createElement('div');
            // Check if selected
            const isSelected = cloudBrowserState.selectedPublicIds.has(photo.public_id);

            div.className = `relative group aspect-square bg-gray-200 rounded-lg overflow-hidden cursor-pointer border-4 ${isSelected ? 'border-green-500' : 'border-transparent'} hover:border-blue-500 transition-colors`;
            div.onclick = (e) => toggleCloudinarySelection(div, photo);

            div.innerHTML = `
                <img src="${photo.thumbnail_url}" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/50 flex items-center justify-center ${isSelected ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 transition-opacity">
                    <span class="material-symbols-outlined text-white text-3xl">check_circle</span>
                </div>
                <div class="selection-indicator absolute top-2 right-2 ${isSelected ? '' : 'hidden'}">
                     <span class="material-symbols-outlined text-primary bg-black rounded-full">check_circle</span>
                </div>
                <div class="absolute bottom-0 left-0 w-full bg-black/60 text-white text-[10px] p-1 truncate px-2">
                    ${photo.tags && photo.tags.length > 0 ? photo.tags.slice(0, 3).join(', ') : 'No tags'}
                </div>
            `;

            grid.appendChild(div);
        });

        // Handle Load More visibility
        if (cloudBrowserState.nextCursor) {
            loadMoreBtn.classList.remove('hidden');
        } else {
            loadMoreBtn.classList.add('hidden');
        }

    } catch (err) {
        logger.error('Error loading cloudinary resources:', err);
        grid.innerHTML = `<div class="col-span-full text-red-500 text-center font-bold">Failed to load: ${err.message}</div>`;
    } finally {
        cloudBrowserState.isLoading = false;
    }
}

function toggleCloudinarySelection(element, photo) {
    const indicator = element.querySelector('.selection-indicator');
    const overlay = element.querySelector('.absolute.inset-0');

    if (cloudBrowserState.selectedPublicIds.has(photo.public_id)) {
        // Deselect
        cloudBrowserState.selectedPublicIds.delete(photo.public_id);

        element.classList.remove('border-green-500');
        element.classList.add('border-transparent');
        indicator.classList.add('hidden');
        overlay.classList.remove('opacity-100');
        overlay.classList.add('opacity-0'); // Back to hover only

    } else {
        // Select
        cloudBrowserState.selectedPublicIds.set(photo.public_id, photo);

        element.classList.remove('border-transparent');
        element.classList.add('border-green-500');
        indicator.classList.remove('hidden');
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100'); // Always visible
    }

    document.getElementById('importCount').textContent = cloudBrowserState.selectedPublicIds.size;
}

function importSelectedCloudinaryPhotos() {
    if (cloudBrowserState.selectedPublicIds.size === 0) return;

    const selected = Array.from(cloudBrowserState.selectedPublicIds.values());
    logger.log('Importing:', selected);

    selected.forEach(photo => {
        // Prevent duplicates
        if (uploadedPhotos.some(p => p.public_id === photo.public_id)) return;

        const photoData = {
            public_id: photo.public_id,
            url: photo.url,
            thumbnail_url: photo.thumbnail_url,
            caption: '',
            event_id: selectedEvent.id
        };

        uploadedPhotos.push(photoData);
        renderPreview(photoData, uploadedPhotos.length - 1);
    });

    // Clear selection state
    cloudBrowserState.selectedPublicIds.clear();
    document.getElementById('importCount').textContent = '0';
    closeCloudinaryBrowser();

    // Show review section
    document.getElementById('uploadedSection').classList.remove('hidden');
    showToast(`Added ${selected.length} photos to review list!`);

    // Reset grid styling if re-opened (though we typically reload)
    document.querySelectorAll('#cloudinaryGrid > div').forEach(div => {
        // Reset styles manually just in case
        div.classList.remove('border-primary');
        div.classList.add('border-transparent');
    });
}

function setupEventListeners() {
    const eventSelect = document.getElementById('eventSelect');
    const uploadBtn = document.getElementById('uploadBtn');
    const browseBtn = document.getElementById('browseCloudinaryBtn');
    const saveBtn = document.getElementById('saveMetadataBtn');
    const statusText = document.getElementById('uploadStatus');

    // Cloudinary Browser Buttons
    const closeBrowserBtn = document.getElementById('closeBrowserBtn');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const importSelectedBtn = document.getElementById('importSelectedBtn');

    // Search Buttons
    const searchBtn = document.getElementById('searchTagBtn');
    const resetBtn = document.getElementById('resetSearchBtn');
    const searchInput = document.getElementById('tagSearchInput');

    if (browseBtn) browseBtn.addEventListener('click', () => {
        if (!selectedEvent) return;
        openCloudinaryBrowser();
    });

    if (closeBrowserBtn) closeBrowserBtn.addEventListener('click', closeCloudinaryBrowser);
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => loadCloudinaryResources(false));
    if (importSelectedBtn) importSelectedBtn.addEventListener('click', importSelectedCloudinaryPhotos);

    if (searchBtn) searchBtn.addEventListener('click', performSearch);
    if (resetBtn) resetBtn.addEventListener('click', resetSearch);
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') performSearch();
        });
    }

    // Event Selection Change
    eventSelect.addEventListener('change', (e) => {
        const option = e.target.selectedOptions[0];
        if (!e.target.value) {
            selectedEvent = null;
            if (uploadBtn) uploadBtn.disabled = true;
            if (browseBtn) browseBtn.disabled = true;
            statusText.textContent = 'Please select an event first';
            return;
        }

        selectedEvent = {
            id: e.target.value,
            tag: option.dataset.tag,
            title: option.dataset.title
        };

        if (!selectedEvent.tag) {
            // Warn if no tag
            const newTag = generateTag(selectedEvent.title);
            statusText.textContent = `Warning: This event has no gallery tag. Creating tag: ${newTag}`;
            selectedEvent.tag = newTag;
            selectedEvent.isNewTag = true; // Flag for saving later
        } else {
            statusText.textContent = `Ready to manage: ${selectedEvent.title}`;
        }

        if (uploadBtn) uploadBtn.disabled = false;
        if (browseBtn) browseBtn.disabled = false;

        // Re-init widget with new tags
        initWidget();

        // Load existing photos
        loadEventPhotos(selectedEvent.id);
    });

    // Open Widget
    uploadBtn.addEventListener('click', () => {
        if (!widget) initWidget();
        widget.open();
    });

    // Save Metadata
    saveBtn.addEventListener('click', savePhotoMetadata);

    // Warn on exit if unsaved photos
    window.addEventListener('beforeunload', (e) => {
        if (uploadedPhotos.length > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

// ... (Rest of existing code: loadEventPhotos, etc.)
// Re-export or just let it sit if text/javascript module


// --- Management Features ---

async function loadEventPhotos(eventId) {
    const container = document.getElementById('managePhotosSection');
    const grid = document.getElementById('existingPhotosGrid');
    const countBadge = document.getElementById('existingCount');

    container.classList.remove('hidden');
    grid.innerHTML = '<div class="text-center py-8 text-gray-400 w-full col-span-2">Loading photos...</div>';

    const { data: photos, error } = await supabase
        .from('photo_discussions')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

    if (error) {
        logger.error('Error loading photos:', error);
        grid.innerHTML = `<div class="text-red-500 text-sm font-bold">Error loading photos: ${error.message}</div>`;
        return;
    }

    countBadge.textContent = `${photos.length} Photos`;

    if (photos.length === 0) {
        grid.innerHTML = `<div class="text-center py-8 text-gray-400 w-full col-span-2 text-sm">No photos found for this event. Upload some above!</div>`;
        return;
    }

    // Render Grid
    grid.innerHTML = '';
    photos.forEach(photo => {
        const div = document.createElement('div');
        const isHidden = photo.is_hidden || false;
        div.className = `flex gap-3 p-3 border border-gray-200 rounded-lg ${isHidden ? 'bg-gray-100 opacity-60' : 'bg-white'} shadow-sm relative`;
        div.innerHTML = `
            <input type="checkbox" 
                class="photo-select-cb absolute top-2 left-2 w-5 h-5 z-10 cursor-pointer" 
                data-photo-id="${photo.id}"
                onchange="updateSelectedCount()">
            ${isHidden ? '<div class="absolute top-2 right-2 bg-orange-500 text-white text-[10px] font-black px-2 py-0.5 rounded z-10">HIDDEN</div>' : ''}
            <a href="${photo.photo_url}" target="_blank" class="shrink-0 group relative overflow-hidden rounded w-20 h-20 border border-gray-100">
                <img src="${photo.thumbnail_url || photo.photo_url}" class="w-full h-full object-cover transition-transform group-hover:scale-110">
            </a>
            <div class="flex-1 flex flex-col justify-between">
                <div>
                    <textarea 
                        id="caption-${photo.id}"
                        class="w-full border border-gray-200 bg-gray-50 rounded p-1.5 text-xs focus:bg-white focus:border-blue-500 outline-none transition-colors" 
                        rows="2" 
                        placeholder="Add a caption..."
                    >${photo.caption || ''}</textarea>
                </div>
                <div class="flex items-center justify-end gap-2 mt-2">
                    <button onclick="updateExistingCaption('${photo.id}')" 
                        class="text-[10px] font-bold uppercase text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded transition-colors"
                        title="Save Caption">
                        Save
                    </button>
                    <button onclick="deleteExistingPhoto('${photo.id}')" 
                        class="text-[10px] font-bold uppercase text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition-colors"
                        title="Delete Photo">
                        Delete
                    </button>
                </div>
            </div>
        `;
        grid.appendChild(div);
    });
}

window.updateExistingCaption = async (photoId) => {
    const captionInput = document.getElementById(`caption-${photoId}`);
    const newCaption = captionInput.value;
    const btn = event.target; // The button clicked

    const originalText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;

    try {
        const { error } = await supabase
            .from('photo_discussions')
            .update({ caption: newCaption })
            .eq('id', photoId);

        if (error) throw error;

        showToast('Caption updated!');
        btn.classList.add('text-green-600', 'bg-green-50');
        setTimeout(() => btn.classList.remove('text-green-600', 'bg-green-50'), 2000);

    } catch (err) {
        logger.error(err);
        alert('Failed to update caption: ' + err.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
};

window.deleteExistingPhoto = async (photoId) => {
    if (!confirm('Are you sure you want to DELETE this photo? This cannot be undone.')) return;

    try {
        const { error } = await supabase
            .from('photo_discussions')
            .delete()
            .eq('id', photoId);

        if (error) throw error;

        showToast('Photo deleted');
        // Reload list
        if (selectedEvent) loadEventPhotos(selectedEvent.id);

    } catch (err) {
        logger.error(err);
        alert('Failed to delete photo: ' + err.message);
    }
};

function generateTag(title) {
    // Simple slug generator for fallback tag
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

function initWidget() {
    if (!selectedEvent) return;

    const tags = ['jdk-gallery'];
    if (selectedEvent.tag) tags.push(selectedEvent.tag);

    widget = cloudinary.createUploadWidget({
        cloudName: CLOUD_NAME,
        uploadPreset: PRESET_NAME,
        sources: ['local', 'camera', 'url'],
        multiple: true,
        tags: tags,
        context: {
            event_id: selectedEvent.id,
            event_name: selectedEvent.title
        },
        styles: {
            palette: {
                window: "#000000",
                sourceBg: "#FFFFFF",
                windowBorder: "#FFD700",
                tabIcon: "#FFD700",
                inactiveTabIcon: "#555555",
                menuIcons: "#FFD700",
                link: "#FFD700",
                action: "#FFD700",
                inProgress: "#00BFFF",
                complete: "#33ff00",
                error: "#cc0000",
                textDark: "#000000",
                textLight: "#FFFFFF"
            },
            fonts: {
                default: null,
                "'Plus Jakarta Sans', sans-serif": {
                    url: "https://fonts.googleapis.com/css?family=Plus+Jakarta+Sans",
                    active: true
                }
            }
        }
    }, (error, result) => {
        if (!error && result && result.event === "success") {
            handleUploadSuccess(result.info);
        }
    });
}

function handleUploadSuccess(info) {
    logger.log('Upload success:', info);

    const photoData = {
        public_id: info.public_id,
        url: info.secure_url,
        thumbnail_url: info.thumbnail_url || info.secure_url.replace('/upload/', '/upload/w_200/'),
        caption: '', // User will input this
        event_id: selectedEvent.id
    };

    uploadedPhotos.push(photoData);
    renderPreview(photoData, uploadedPhotos.length - 1);

    // Show review section
    document.getElementById('uploadedSection').classList.remove('hidden');
}

function renderPreview(photo, index) {
    const grid = document.getElementById('uploadPreviewGrid');
    const div = document.createElement('div');
    div.className = 'flex gap-4 p-4 border-2 border-gray-200 rounded-lg bg-gray-50';
    div.innerHTML = `
        <img src="${photo.thumbnail_url}" class="w-24 h-24 object-cover rounded border border-black">
        <div class="flex-1">
            <label class="block text-xs font-bold uppercase mb-1">Caption</label>
            <textarea 
                class="w-full border border-gray-300 rounded p-2 text-sm" 
                rows="2" 
                placeholder="Write a caption..."
                onchange="updateCaption(${index}, this.value)"
            ></textarea>
            <div class="text-xs text-gray-500 mt-1">ID: ${photo.public_id}</div>
        </div>
        <button onclick="removeUpload(${index})" class="text-red-500 hover:text-red-700">
            <span class="material-symbols-outlined">delete</span>
        </button>
    `;
    grid.appendChild(div);
}

// Global exposure for inline events
window.updateCaption = (index, value) => {
    if (uploadedPhotos[index]) {
        uploadedPhotos[index].caption = value;
    }
};

window.removeUpload = (index) => {
    // In a real app we might want to delete from Cloudinary too via Admin API
    // For now just remove from the list to be saved
    uploadedPhotos.splice(index, 1);
    // Re-render
    document.getElementById('uploadPreviewGrid').innerHTML = '';
    uploadedPhotos.forEach((p, i) => renderPreview(p, i));

    if (uploadedPhotos.length === 0) {
        document.getElementById('uploadedSection').classList.add('hidden');
    }
};

async function savePhotoMetadata() {
    if (uploadedPhotos.length === 0) return;

    const saveBtn = document.getElementById('saveMetadataBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-symbols-outlined animate-spin">refresh</span> Saving...';

    try {
        // Fetch user once
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;

        logger.log('[v1.4] Preparing upsert for photos:', uploadedPhotos.length);

        // Prepare data for Supabase
        const rows = uploadedPhotos.map(p => ({
            public_id: p.public_id,
            event_id: p.event_id,
            photo_url: p.url,
            thumbnail_url: p.thumbnail_url,
            caption: p.caption,
            created_by: userId
        }));

        logger.log('[v1.4] Rows to upsert:', rows);

        const { error } = await supabase
            .from('photo_discussions')
            .upsert(rows, { onConflict: 'public_id' });

        if (error) throw error;

        showToast(`Successfully saved ${rows.length} photos!`);

        if (selectedEvent.isNewTag) {
            // Update event with the new tag
            const { error: updateError } = await supabase
                .from('events')
                .update({ gallery_tag: selectedEvent.tag })
                .eq('id', selectedEvent.id);

            if (updateError) {
                logger.warn('Failed to update event tag:', updateError);
                // Non-fatal, continue saving photos but warn
            } else {
                logger.log('Event updated with new tag:', selectedEvent.tag);
            }
        }

        // Reset
        uploadedPhotos = [];
        document.getElementById('uploadPreviewGrid').innerHTML = '';
        document.getElementById('uploadedSection').classList.add('hidden');

        // Refresh events list to show new tag
        await loadEvents();

    } catch (error) {
        logger.error('Error saving metadata:', error);
        alert('Failed to save metadata: ' + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Save to Gallery Database';
    }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    msg.textContent = message;
    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
    }, 3000);
}

// Bulk Operations Functions

function getSelectedPhotoIds() {
    return Array.from(document.querySelectorAll('.photo-select-cb:checked'))
        .map(cb => cb.dataset.photoId);
}

function updateSelectedCount() {
    const selected = getSelectedPhotoIds();
    const countBadge = document.getElementById('selectedCount');
    const bulkBar = document.getElementById('bulkActionsBar');
    const selectAllCb = document.getElementById('selectAllPhotos');

    if (countBadge) {
        countBadge.textContent = `${selected.length} selected`;
    }

    // Show/hide bulk actions bar
    if (bulkBar) {
        bulkBar.classList.toggle('hidden', selected.length === 0);
    }

    // Update select all checkbox state
    const allCheckboxes = document.querySelectorAll('.photo-select-cb');
    if (selectAllCb && allCheckboxes.length > 0) {
        selectAllCb.checked = selected.length === allCheckboxes.length;
        selectAllCb.indeterminate = selected.length > 0 && selected.length < allCheckboxes.length;
    }
}

window.toggleSelectAll = (checked) => {
    document.querySelectorAll('.photo-select-cb').forEach(cb => {
        cb.checked = checked;
    });
    updateSelectedCount();
};

window.bulkDeletePhotos = async () => {
    const selected = getSelectedPhotoIds();
    if (selected.length === 0) return;

    const confirmed = confirm(
        `Are you sure you want to DELETE ${selected.length} photo(s)?\n\n` +
        'This will also delete all their comments and likes.\n' +
        'This action cannot be undone!'
    );

    if (!confirmed) return;

    let successCount = 0;
    let failCount = 0;

    for (const photoId of selected) {
        try {
            const { error } = await supabase
                .from('photo_discussions')
                .delete()
                .eq('id', photoId);

            if (error) throw error;
            successCount++;
        } catch (err) {
            logger.error(`Failed to delete photo ${photoId}:`, err);
            failCount++;
        }
    }

    // Show result
    if (failCount === 0) {
        showToast(`Successfully deleted ${successCount} photo(s)!`);
    } else {
        alert(`Deleted ${successCount} photo(s). Failed to delete ${failCount} photo(s).`);
    }

    // Reload photos
    if (selectedEvent) {
        loadEventPhotos(selectedEvent.id);
    }
};

window.bulkHidePhotos = async () => {
    const selected = getSelectedPhotoIds();
    if (selected.length === 0) return;

    const confirmed = confirm(
        `Are you sure you want to HIDE ${selected.length} photo(s)?\n\n` +
        'They will no longer be visible in the public gallery.'
    );

    if (!confirmed) return;

    let successCount = 0;
    let failCount = 0;

    for (const photoId of selected) {
        try {
            const { error } = await supabase
                .from('photo_discussions')
                .update({ is_hidden: true })
                .eq('id', photoId);

            if (error) throw error;
            successCount++;
        } catch (err) {
            logger.error(`Failed to hide photo ${photoId}:`, err);
            failCount++;
        }
    }

    // Show result
    if (failCount === 0) {
        showToast(`Successfully hid ${successCount} photo(s)!`);
    } else {
        alert(`Hid ${successCount} photo(s). Failed to hide ${failCount} photo(s).`);
    }

    // Reload photos
    if (selectedEvent) {
        loadEventPhotos(selectedEvent.id);
    }
};
