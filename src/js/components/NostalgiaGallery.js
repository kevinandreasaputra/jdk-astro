import { logger } from '../core/logger.js';
/**
 * NostalgiaGallery Component
 * Display photos from Cloudinary with JDK styling
 */

import { fetchPhotosByEvent, fetchPhotosByTag, sharePhoto, updatePhotoCaption, deletePhoto, togglePhotoVisibility } from '../modules/galleryService.js';
import { supabase } from '../core/supabase.js';
import { PhotoDiscussion } from './PhotoDiscussion.js';

export class NostalgiaGallery {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            logger.error(`Container #${containerId} not found`);
            return;
        }

        this.options = {
            eventId: options.eventId || null,
            tag: options.tag || null,
            columns: options.columns || 4,
            showEventBadge: options.showEventBadge !== false,
            ...options,
        };

        this.photos = [];
        this.currentPhotoIndex = 0;
        this.modal = null;
        this.isAdmin = false;
        this.activeDiscussion = null;

        this.init();
    }

    async init() {
        // Check admin status
        this.isAdmin = await this.checkAdminStatus();
        // Create modal structure
        this.createModal();

        // Fetch photos
        await this.loadPhotos();

        // Render grid
        this.renderGrid();

        // Setup keyboard navigation
        this.setupKeyboardNav();
    }

    async loadPhotos() {
        try {
            if (this.options.eventId) {
                this.photos = await fetchPhotosByEvent(this.options.eventId);
            } else if (this.options.tag) {
                this.photos = await fetchPhotosByTag(this.options.tag);
            } else {
                logger.warn('No eventId or tag provided');
                this.photos = [];
            }
        } catch (error) {
            logger.error('Error loading photos:', error);
            this.photos = [];
        }
    }

    renderGrid() {
        if (!this.photos || this.photos.length === 0) {
            this.container.innerHTML = `
                <div class="text-center py-12">
                    <p class="text-gray-500 text-lg font-bold">📸 Belum ada foto untuk event ini</p>
                    <p class="text-gray-400 text-sm">Foto akan ditampilkan setelah event selesai</p>
                </div>
            `;
            return;
        }

        const gridHTML = `
            <div class="nostalgia-gallery-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-${this.options.columns} gap-4">
                ${this.photos.map((photo, index) => this.renderPhotoCard(photo, index)).join('')}
            </div>
        `;

        this.container.innerHTML = gridHTML;

        // Add click listeners
        this.container.querySelectorAll('.gallery-photo').forEach((img, index) => {
            img.addEventListener('click', () => this.openModal(index));
        });
    }

    renderPhotoCard(photo, index) {
        const hasEvent = this.options.showEventBadge && photo.event_name;

        return `
            <div class="gallery-photo-card group cursor-pointer relative overflow-hidden rounded-lg border-2 border-[#FFD700] shadow-[4px_4px_0px_#000] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all bg-black">
                ${hasEvent ? `
                    <div class="absolute top-2 left-2 z-10 bg-black text-primary px-2 py-1 rounded text-xs font-black uppercase border border-primary">
                        ${photo.event_name}
                    </div>
                ` : ''}
                <img 
                    src="${photo.thumbnail_url}" 
                    alt="${photo.caption || 'Gallery photo'}"
                    class="gallery-photo w-full h-48 md:h-64 object-cover group-hover:scale-110 transition-transform duration-500"
                    data-index="${index}"
                    loading="lazy"
                />
                
                <!-- Comment Count Badge -->
                <div class="absolute bottom-2 right-2 z-10 flex items-center gap-1 bg-black/60 text-white px-2 py-1 rounded-full text-xs font-bold backdrop-blur-sm border border-white/20">
                    <span class="material-symbols-outlined text-[14px]">chat_bubble</span>
                    ${photo.comment_count || 0}
                </div>
            </div>
        `;
    }

    createModal() {
        // Check if modal already exists
        let modal = document.getElementById('nostalgiaGalleryModal');

        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'nostalgiaGalleryModal';
            modal.className = 'fixed inset-0 z-[20000] hidden items-center justify-center';
            modal.style.background = 'rgba(0,0,0,0.95)';
            modal.style.backdropFilter = 'blur(10px)';

            modal.innerHTML = `
                <div class="relative w-full h-full flex flex-col md:flex-row overflow-hidden bg-black">
                    
                    <!-- LEFT: Photo Area (70%) -->
                    <div class="w-full md:w-[70%] h-[40vh] md:h-full relative flex flex-col items-center justify-center bg-black p-2 md:p-8 border-b md:border-b-0 md:border-r border-white/10">
                        
                        <!-- Close Button (Mobile Only) -->
                        <button class="md:hidden absolute top-4 right-4 text-white text-3xl z-30 drop-shadow-lg bg-black/50 rounded-full w-10 h-10 flex items-center justify-center" onclick="window.nostalgiaGallery?.closeModal()">
                            &times;
                        </button>
                        
                        <!-- Navigation (Absolute) -->
                        <button onclick="window.nostalgiaGallery?.previousImage()" class="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white p-2 md:p-4 rounded-full hover:bg-white/10 transition-all z-20">
                            <span class="material-symbols-outlined text-3xl md:text-5xl">chevron_left</span>
                        </button>
                        <button onclick="window.nostalgiaGallery?.nextImage()" class="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white p-2 md:p-4 rounded-full hover:bg-white/10 transition-all z-20">
                            <span class="material-symbols-outlined text-3xl md:text-5xl">chevron_right</span>
                        </button>

                         <!-- Share Button (Overlay) -->
                         <button onclick="window.nostalgiaGallery?.share()" class="absolute top-4 left-4 z-20 bg-black/50 hover:bg-white/20 text-white px-3 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1 backdrop-blur-sm border border-white/10">
                            <span class="material-symbols-outlined text-sm">share</span> Share
                        </button>

                        <!-- Main Image -->
                        <img 
                            id="nostalgiaGalleryModalImage" 
                            src="" 
                            alt=""
                            class="max-w-full max-h-full object-contain shadow-2xl transition-opacity duration-300"
                        />
                         <p id="nostalgiaGalleryModalCaptionOverlay" class="absolute bottom-4 left-0 w-full text-center text-white/80 text-sm md:hidden px-4 truncate"></p>
                    </div>

                    <!-- RIGHT: Sidebar (30%) -->
                    <div class="w-full md:w-[30%] h-[60vh] md:h-full bg-[#151515] flex flex-col relative z-30">
                        
                        <!-- Header / Close (Desktop) -->
                        <div class="hidden md:flex items-center justify-between p-4 border-b border-white/10 bg-[#151515]">
                            <div class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-[#FFD700]">forum</span>
                                <h3 class="font-bold text-white uppercase tracking-wider text-sm">Discussion</h3>
                            </div>
                            <button class="text-gray-400 hover:text-white transition-colors" onclick="window.nostalgiaGallery?.closeModal()">
                                <span class="material-symbols-outlined">close</span>
                            </button>
                        </div>

                        <!-- Discussion Container -->
                        <div id="nostalgiaGalleryDiscussion" class="flex-1 overflow-hidden relative">
                            <!-- PhotoDiscussion mounts here -->
                        </div>
                    </div>

                </div>
            `;

            document.body.appendChild(modal);
        }

        this.modal = modal;
    }

    openModal(index) {
        if (!this.photos || this.photos.length === 0) return;

        this.currentPhotoIndex = index;
        this.updateModalContent();

        // Show modal with fade-in
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');

        // Show/hide admin actions
        const adminBar = document.getElementById('adminActionsBar');
        if (adminBar) {
            adminBar.classList.toggle('hidden', !this.isAdmin);
        }

        // Disable body scroll
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        if (!this.modal) return;

        this.modal.classList.add('hidden');
        this.modal.classList.remove('flex');

        // Enable body scroll
        document.body.style.overflow = '';
    }

    async updateModalContent() {
        const photo = this.photos[this.currentPhotoIndex];
        if (!photo) return;

        const image = document.getElementById('nostalgiaGalleryModalImage');
        const captionMobile = document.getElementById('nostalgiaGalleryModalCaptionOverlay');

        // Update Image
        if (image) {
            image.style.opacity = '0.5'; // Fade out slightly
            image.src = photo.optimized_url;
            image.onload = () => image.style.opacity = '1';
        }

        // Update Mobile Caption
        if (captionMobile) {
            captionMobile.textContent = photo.caption || '';
        }

        // Initialize Discussion (Cleanup old one first)
        if (this.activeDiscussion) {
            await this.activeDiscussion.destroy();
            this.activeDiscussion = null;
        }

        // Create new Discussion instance in the sidebar
        const discussionContainer = document.getElementById('nostalgiaGalleryDiscussion');
        if (discussionContainer) {
            this.activeDiscussion = new PhotoDiscussion('nostalgiaGalleryDiscussion', photo.public_id);
        }
    }

    previousImage() {
        if (this.photos.length === 0) return;
        this.currentPhotoIndex = (this.currentPhotoIndex - 1 + this.photos.length) % this.photos.length;
        this.updateModalContent();
    }

    nextImage() {
        if (this.photos.length === 0) return;
        this.currentPhotoIndex = (this.currentPhotoIndex + 1) % this.photos.length;
        this.updateModalContent();
    }

    async share() {
        const photo = this.photos[this.currentPhotoIndex];
        if (!photo) return;

        const success = await sharePhoto(photo.optimized_url, photo.caption || photo.event_name);

        if (success) {
            // Show success feedback
            const shareBtn = this.modal.querySelector('button[onclick*="share"]');
            if (shareBtn) {
                const originalText = shareBtn.innerHTML;
                shareBtn.innerHTML = '<span class="material-symbols-outlined text-xl">check</span> <span class="hidden md:inline">Copied!</span>';
                setTimeout(() => {
                    shareBtn.innerHTML = originalText;
                }, 2000);
            }
        }
    }



    setupKeyboardNav() {
        document.addEventListener('keydown', (e) => {
            if (!this.modal || this.modal.classList.contains('hidden')) return;

            if (e.key === 'ArrowLeft') this.previousImage();
            if (e.key === 'ArrowRight') this.nextImage();
            if (e.key === 'Escape') this.closeModal();
        });
    }

    // Check if current user is admin
    async checkAdminStatus() {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return false;

            const { data: profile } = await supabase
                .from('profiles')
                .select('user_level')
                .eq('id', user.id)
                .single();

            return profile?.user_level === 'Admin';
        } catch (error) {
            logger.error('Error checking admin status:', error);
            return false;
        }
    }

    // Admin: Edit photo caption
    async editCaption() {
        const photo = this.photos[this.currentPhotoIndex];
        if (!photo || !this.isAdmin) return;

        const currentCaption = photo.caption || '';
        const newCaption = prompt('Edit caption:', currentCaption);

        if (newCaption === null) return; // Cancelled

        try {
            await updatePhotoCaption(photo.id, newCaption);

            // Update local photo data
            photo.caption = newCaption;
            this.updateModalContent();

            // Show success
            this.showToast('Caption updated successfully!');
        } catch (error) {
            logger.error('Error updating caption:', error);
            alert('Failed to update caption: ' + error.message);
        }
    }

    // Admin: Delete photo with confirmation
    async deletePhotoConfirm() {
        const photo = this.photos[this.currentPhotoIndex];
        if (!photo || !this.isAdmin) return;

        const confirmed = confirm(
            'Are you sure you want to DELETE this photo?\n\n' +
            'This will also delete all comments and likes.\n' +
            'This action cannot be undone!'
        );

        if (!confirmed) return;

        try {
            await deletePhoto(photo.id);

            // Remove from local array
            this.photos.splice(this.currentPhotoIndex, 1);

            // Close modal and refresh
            this.closeModal();
            this.renderGrid();

            // Show success
            this.showToast('Photo deleted successfully!');
        } catch (error) {
            logger.error('Error deleting photo:', error);
            alert('Failed to delete photo: ' + error.message);
        }
    }

    // Admin: Toggle photo visibility (hide/show)
    async toggleHide() {
        const photo = this.photos[this.currentPhotoIndex];
        if (!photo || !this.isAdmin) return;

        const willHide = !photo.is_hidden;
        const action = willHide ? 'hide' : 'show';

        const confirmed = confirm(
            `Are you sure you want to ${action.toUpperCase()} this photo?\n\n` +
            (willHide ? 'It will be hidden from public gallery.' : 'It will be visible in public gallery.')
        );

        if (!confirmed) return;

        try {
            await togglePhotoVisibility(photo.id, willHide);

            // Update local data
            photo.is_hidden = willHide;

            // Update button text
            const hideIcon = document.getElementById('hideIcon');
            const hideText = document.getElementById('hideText');
            if (hideIcon) hideIcon.textContent = willHide ? 'visibility' : 'visibility_off';
            if (hideText) hideText.textContent = willHide ? 'Show' : 'Hide';

            // Show success
            this.showToast(`Photo ${willHide ? 'hidden' : 'shown'} successfully!`);
        } catch (error) {
            logger.error('Error toggling visibility:', error);
            alert('Failed to update visibility: ' + error.message);
        }
    }

    // Show toast notification
    showToast(message) {
        // Create toast if it doesn't exist
        let toast = document.getElementById('galleryToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'galleryToast';
            toast.className = 'fixed bottom-4 right-4 bg-black text-white px-6 py-4 rounded-lg shadow-lg transform translate-y-20 opacity-0 transition-all duration-300 z-[200] flex items-center gap-3';
            toast.innerHTML = `
                <span class="material-symbols-outlined text-[#FFD700]">check_circle</span>
                <span id="galleryToastMessage" class="font-bold"></span>
            `;
            document.body.appendChild(toast);
        }

        const toastMessage = document.getElementById('galleryToastMessage');
        if (toastMessage) toastMessage.textContent = message;

        // Show toast
        toast.classList.remove('translate-y-20', 'opacity-0');

        // Hide after 3 seconds
        setTimeout(() => {
            toast.classList.add('translate-y-20', 'opacity-0');
        }, 3000);
    }

    // Public method to refresh photos
    async refresh() {
        await this.loadPhotos();
        this.renderGrid();
    }
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.NostalgiaGallery = NostalgiaGallery;
}
