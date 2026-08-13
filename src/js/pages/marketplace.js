import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Marketplace Page Module
 * Handles marketplace/JDK Box functionality
 */
// JDK Box (Marketplace) Page Logic
import { sbClient } from '../core/supabase.js';
import { showNotification, getRelativeTime, getCurrentPage } from '../core/utils.js';
import { getCurrentUser } from '../modules/user-session.js';
import anime from 'animejs';
import { calculateUserLevel } from '../modules/ranks.js'; // Import rank system

let systemSettings = null; // Store system settings (min_upload_xp, etc)

// Module state
let currentProduct = null;
let allProducts = [];
let currentPage = 0;
const PAGE_SIZE = 12;
let activeTab = 'box'; // 'box' or 'redeem'
let currentFilters = {
    sort: 'newest'
};

// Gallery edit state
let retainedGallery = []; // existing photos kept during edit
let removedPhotos = [];   // existing photos marked for removal


/**
 * Initialize marketplace page
 */
export async function initializeMarketplacePage() {
    logger.log('Initializing Marketplace...');

    // Initial Load
    await loadSystemSettings(); // Load XP requirements
    await loadProducts(true);

    // Event Listeners
    initializeFilters();
    ensureUploadButtonExists(); // SPA fix: inject navbar upload button if missing
    ensureMobileFabExists(); // SPA fix: inject mobile FAB if missing
    ensureUploadModalExists(); // SPA fix: inject modal if missing
    initializeUploadModal();
    initializeLoadMore();
    initializeImagePreview();

    // Mobile specific inits
    if (window.innerWidth < 768) {
        initializeMobileFilters();
    }
    // Check for "edit" or "tab" param
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    const tabName = urlParams.get('tab');

    if (editId) {
        // Wait for auth...
        setTimeout(() => checkAndOpenEdit(editId), 1000);
    }
    if (tabName) {
        window.switchMarketTab(tabName);
    }
}

/**
 * Load system settings for XP checks
 */
async function loadSystemSettings() {
    try {
        const { data, error } = await sbClient.from('system_settings').select('min_upload_xp, min_rekber_xp, min_sticker_level').eq('id', 1).single();
        if (data && !error) {
            systemSettings = data;
            logger.log('System settings loaded:', systemSettings);
        }
    } catch (e) {
        logger.error('Failed to load system settings:', e);
    }
}

/**
 * Switch Marketplace Tab
 * @param {string} tab - 'box' or 'redeem'
 */
window.switchMarketTab = (tab) => {
    if (activeTab === tab) return;
    activeTab = tab;

    const tabBox = document.getElementById('tabJDKBox');
    const tabRedeem = document.getElementById('tabRedeem');
    const filtersSection = document.querySelector('.filter-section')?.parentElement?.parentElement;

    if (tab === 'redeem') {
        tabRedeem.classList.add('bg-black', 'text-primary', 'shadow-[8px_8px_0_rgba(0,0,0,0.1)]');
        tabRedeem.classList.remove('bg-white', 'text-black', 'shadow-[8px_8px_0_rgba(255,255,255,1)]');
        tabBox.classList.add('bg-white', 'text-black', 'shadow-[8px_8px_0_rgba(0,0,0,0.1)]');
        tabBox.classList.remove('bg-black', 'text-primary', 'shadow-[8px_8px_0_rgba(255,255,255,1)]');

        // Hide price/location filters for Redeem Center as they are point-based
        if (filtersSection) filtersSection.classList.add('hidden');
    } else {
        tabBox.classList.add('bg-black', 'text-primary', 'shadow-[8px_8px_0_rgba(0,0,0,0.1)]');
        tabBox.classList.remove('bg-white', 'text-black', 'shadow-[8px_8px_0_rgba(255,255,255,1)]');
        tabRedeem.classList.add('bg-white', 'text-black', 'shadow-[8px_8px_0_rgba(0,0,0,0.1)]');
        tabRedeem.classList.remove('bg-black', 'text-primary', 'shadow-[8px_8px_0_rgba(255,255,255,1)]');

        if (filtersSection) filtersSection.classList.remove('hidden');
    }

    loadProducts(true);
};

async function checkAndOpenEdit(id) {
    const user = getCurrentUser(); // from session module
    if (!user) return; // Not logged in

    try {
        const { data, error } = await sbClient
            .from('products')
            .select('*')
            .eq('id', id)
            .eq('seller_id', user.id) // Ensure ownership
            .single();

        if (data && !error) {
            openUploadModal(data);
        } else {
            showNotification("Product not found or access denied.");
        }
    } catch (e) {
        logger.error(e);
    }
}

/**
 * Load products from Supabase
 * @param {boolean} reset - Whether to reset the list (new search/filter)
 */
async function loadProducts(reset = false) {
    const loadMoreBtn = document.getElementById('loadMoreBtn');

    if (reset) {
        currentPage = 0;
        allProducts = [];
        const grid = document.getElementById('productsGrid');
        if (grid) grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-20 opacity-50">
                <span class="material-symbols-outlined text-6xl text-black mb-4 animate-spin">sync</span>
                <p class="text-xl font-bold">Memuat Produk...</p>
            </div>
        `;
        if (loadMoreBtn) {
            loadMoreBtn.classList.remove('hidden');
            loadMoreBtn.disabled = false;
        }
    }

    // Prevent double fetch but allow reset
    if (!reset && loadMoreBtn && loadMoreBtn.disabled) return;

    if (loadMoreBtn) {
        loadMoreBtn.textContent = '⏳ LOADING...';
        loadMoreBtn.disabled = true;
    }

    try {
        if (!sbClient) {
            logger.warn('Supabase client not initialized');
            return;
        }

        let query = sbClient
            .from('products')
            .select('*, profiles(id, username, domicile, whatsapp, avatar_url)')
            .eq('status', 'available')
            .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

        // Apply Tab Filter
        if (activeTab === 'redeem') {
            query = query.eq('is_redeemable', true);
        } else {
            query = query.eq('is_redeemable', false);
        }

        // Apply Filters (Only if in box tab)
        if (activeTab === 'box') {
            if (currentFilters.category) {
                query = query.eq('category', currentFilters.category);
            }
            if (currentFilters.location) {
                query = query.ilike('location', `%${currentFilters.location}%`);
            }
        }

        // Sorting
        if (currentFilters.sort === 'newest') {
            query = query.order('created_at', { ascending: false });
        } else if (currentFilters.sort === 'price-low') {
            query = query.order('price', { ascending: true });
        } else if (currentFilters.sort === 'price-high') {
            query = query.order('price', { ascending: false });
        }

        const { data, error } = await query;

        if (error) throw error;

        // Special client-side filtering (e.g. Price Range) - Box Tab only
        let filteredData = data || [];
        if (activeTab === 'box' && currentFilters.price) {
            const [min, max] = currentFilters.price.split('-').map(v => v.replace('+', ''));
            filteredData = filteredData.filter(p => {
                if (max) return p.price >= parseInt(min) && p.price <= parseInt(max);
                return p.price >= parseInt(min); // For 5000000+
            });
        }

        allProducts = reset ? filteredData : [...allProducts, ...filteredData];
        displayProducts(filteredData, reset);

        // Update count
        const countEl = document.getElementById('productCount');
        if (countEl) countEl.textContent = allProducts.length;

        // Pagination State
        currentPage++;
        if (data.length < PAGE_SIZE) {
            if (loadMoreBtn) {
                loadMoreBtn.classList.add('hidden');
            }
        } else {
            if (loadMoreBtn) {
                loadMoreBtn.textContent = '📦 LOAD MORE ITEMS';
                loadMoreBtn.disabled = false;
            }
        }

    } catch (err) {
        logger.error('Error loading products:', err);
        showNotification('Gagal memuat produk.', 3000);
        if (loadMoreBtn) {
            loadMoreBtn.textContent = '📦 TRY AGAIN';
            loadMoreBtn.disabled = false;
        }
    }
}

/**
 * Display products in the grid
 */
function displayProducts(products, isNew) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    if (isNew) {
        grid.innerHTML = '';
    }

    if (products.length === 0 && isNew) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-12">
                <div class="text-6xl mb-4">🏜️</div>
                <h3 class="text-2xl font-bold font-comic text-gray-400">TIDAK ADA BARANG DITEMUKAN</h3>
                <p class="text-gray-500">Coba ubah filter pencarian kamu.</p>
            </div>
        `;
        return;
    }

    products.forEach((product, index) => {
        try {
            const card = createProductCard(product);
            grid.appendChild(card);

            // Staggered animation
            anime({
                targets: card,
                opacity: [0, 1],
                translateY: [20, 0],
                duration: 600,
                delay: index * 50,
                easing: 'easeOutExpo'
            });
        } catch (cardErr) {
            logger.error('Error creating product card:', cardErr, product);
        }
    });
}

/**
 * Create a product card element
 */
function createProductCard(product) {
    const card = document.createElement('div');
    const isRedeem = product.is_redeemable;

    card.className = `bg-white mobile-compact-card border-2 border-black/5 shadow-sm hover:shadow-xl hover:border-primary transition-all duration-300 rounded-[2rem] overflow-hidden group cursor-pointer h-full flex flex-col ${isRedeem ? 'border-primary/20 bg-primary/5' : ''}`;
    // Link to full page
    // Link to full page
    card.onclick = (e) => {
        // Prevent if clicking specific buttons (like wishlist if added to card later)
        if (e.target.closest('button')) return;
        window.location.href = `product.html?id=${product.id}`;
    };

    // Safety check for points/price
    const pointsValue = parseInt(product.redeem_points) || 0;
    const priceValue = parseInt(product.price) || 0;

    const priceText = isRedeem
        ? `<span class="text-2xl font-black text-black">${pointsValue.toLocaleString()} 🪙</span>`
        : `<span class="text-2xl font-black text-comic-red italic tracking-tight">${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(priceValue)}</span>`;

    const imgUrl = product.image_url || 'images/placeholder-product.svg';

    card.innerHTML = `
        <div class="relative overflow-hidden aspect-[4/3] mobile-compact-img border-b border-black/5 bg-gray-50 flex items-center justify-center">
            <img src="${imgUrl}" alt="${product.name}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">
            ${isRedeem ? `
                <div class="absolute top-3 left-3 md:top-4 md:left-4 bg-yellow-400 text-black px-2 py-0.5 md:px-3 md:py-1 rounded-full border-2 border-black text-[8px] md:text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0_rgba(0,0,0,1)] md:shadow-[4px_4px_0_rgba(0,0,0,1)]">
                    POINT SHOP 🪙
                </div>
            ` : `
                <div class="absolute top-3 right-3 md:top-4 md:right-4 bg-primary text-black px-2 py-0.5 md:px-3 md:py-1 rounded-full border-2 border-black text-[8px] md:text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0_rgba(0,0,0,1)] md:shadow-[4px_4px_0_rgba(0,0,0,1)]">
                    ${(product.condition || 'USED').toUpperCase()}
                </div>
            `}
        </div>
        <div class="p-6 flex flex-col flex-grow bg-white">
            <div class="flex flex-wrap justify-between items-center gap-2 mb-2 md:mb-4">
                <div class="flex items-center gap-2">
                    <span class="bg-blue-50 text-blue-600 text-[8px] md:text-[10px] font-black px-2 py-0.5 md:px-3 md:py-1 rounded-full border border-blue-100 uppercase tracking-widest leading-none">
                        ${(product.category || 'Item').toUpperCase()}
                    </span>
                    <span class="text-[8px] md:text-[10px] text-gray-400 font-black uppercase tracking-widest opacity-60 hidden md:inline">
                         @${product.profiles?.username || 'ADMIN'}
                    </span>
                </div>
                <span class="text-gray-400 text-[8px] md:text-[10px] font-bold uppercase tracking-wide">
                    ${getRelativeTime(product.created_at)}
                </span>
            </div>
            
            <h3 class="text-xl font-black text-black leading-tight mb-1 line-clamp-2 group-hover:text-primary transition-colors uppercase tracking-tighter">
                ${product.name}
            </h3>
            
            <p class="text-xs text-gray-500 font-medium mb-3 line-clamp-2 min-h-[2.5em] leading-relaxed">
                ${(product.description || 'Tidak ada deskripsi.').substring(0, 100)}${product.description && product.description.length > 100 ? '...' : ''}
            </p>
            
            <div class="mt-auto pt-3 md:pt-4 border-t border-black/5">
                <p class="mb-1 text-sm md:text-base">${priceText}</p>
                ${isRedeem ? `
                    <div class="flex items-center text-[8px] md:text-[10px] text-primary-dark font-black uppercase tracking-widest">
                        <span class="material-symbols-outlined text-sm mr-1">bolt</span>
                        EXCHANGE ONLY
                    </div>
                ` : `
                    <div class="flex items-center text-[8px] md:text-[10px] text-gray-400 font-black uppercase tracking-widest">
                        <span class="material-symbols-outlined text-xs md:text-sm mr-1">location_on</span>
                        <span class="truncate max-w-[100px]">${product.location || 'Unknown'}</span>
                    </div>
                `}
            </div>
        </div>
    `;

    return card;
}

/**
 * Open product detail modal
 */
export function openProductModal(product) {
    const modal = document.getElementById('productModal');
    if (!modal) return;

    currentProduct = product;
    const isRedeem = product.is_redeemable;
    const isSticker = product.sticker_pack_id || product.category === 'stickers';

    // Helper to set text
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    setText('modalProductTitleDisplay', product.name);
    setText('modalProductTitle', product.name); // Keep for header if needed

    const priceEl = document.getElementById('modalProductPrice');
    if (priceEl) {
        if (isRedeem) {
            const pointsValue = parseInt(product.redeem_points) || 0;
            priceEl.innerHTML = `<span class="text-black">${pointsValue.toLocaleString()} 🪙</span>`;
        } else {
            const priceValue = parseInt(product.price) || 0;
            priceEl.textContent = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(priceValue);
        }
    }

    setText('modalProductDescription', product.description || 'Tidak ada deskripsi.');
    setText('modalProductDate', new Date(product.created_at).toLocaleDateString('id-ID'));
    setText('modalProductStatus', (product.status || 'Available').toUpperCase());

    // POPULATE SWIPE GALLERY
    const swipeGallery = document.getElementById('modalSwipeGallery');
    const counter = document.getElementById('imageCounter');
    if (swipeGallery) {
        swipeGallery.innerHTML = '';
        const images = [];
        if (product.image_url) images.push(product.image_url);
        if (product.gallery && Array.isArray(product.gallery)) {
            product.gallery.forEach(url => {
                if (url !== product.image_url) images.push(url);
            });
        }

        images.forEach(url => {
            const item = document.createElement('div');
            item.className = 'swipe-item';
            item.innerHTML = `<img src="${url}" alt="Product image">`;
            swipeGallery.appendChild(item);
        });

        if (counter) {
            if (images.length > 1) {
                counter.classList.remove('hidden');
                counter.textContent = `1/${images.length}`;
            } else {
                counter.classList.add('hidden');
            }
        }

        // Scroll to start
        swipeGallery.scrollLeft = 0;
    }

    // PACK PREVIEW LOGIC
    const previewContainer = document.getElementById('stickerPackPreview');
    if (previewContainer) {
        previewContainer.innerHTML = '';
        if (product.sticker_pack_id) {
            previewContainer.classList.remove('hidden');
            previewContainer.innerHTML = `
                <div class="p-3 bg-white rounded-2xl border-2 border-black/5 shadow-sm">
                    <h4 class="text-[9px] font-black uppercase mb-2 flex items-center gap-1 opacity-40">
                        <span class="material-symbols-outlined text-xs">grid_view</span>
                        Isi Pack (Silakan Swipe Galeri):
                    </h4>
                    <div id="packStickersGrid" class="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
                        <div class="col-span-full py-2 text-center opacity-30">
                             <span class="material-symbols-outlined animate-spin text-sm">sync</span>
                        </div>
                    </div>
                </div>
            `;
            loadPackStickers(product.sticker_pack_id);
        } else {
            previewContainer.classList.add('hidden');
        }
    }

    // Populate Info Strip
    const creatorDisplay = document.getElementById('modalCreatorDisplay');
    if (creatorDisplay) {
        const sellerName = product.profiles?.username || 'Admin';
        creatorDisplay.textContent = `BY @${sellerName}`;
    }

    const locationDisplay = document.getElementById('modalProductLocation');
    if (locationDisplay) {
        locationDisplay.textContent = (product.location || 'BANTEN').toUpperCase();
    }

    // ICONS STRIP
    const iconsStrip = document.getElementById('modalIconsStrip');
    if (iconsStrip) {
        iconsStrip.innerHTML = `
            <button onclick="contactSeller()" title="WhatsApp" class="action-icon-btn">
                <span class="material-symbols-outlined text-lg">call</span>
            </button>
            <button onclick="contactSellerMailbox()" title="JDK Mail" class="action-icon-btn">
                <span class="material-symbols-outlined text-lg">mail</span>
            </button>
            <button onclick="addToWishlist()" id="wishlistBtn" title="Wishlist" class="action-icon-btn">
                <span id="wishlistIcon" class="material-symbols-outlined text-lg">favorite_border</span>
            </button>
        `;
        checkWishlistStatus(product.id);
    }

    // MAIN ACTIONS
    const actionsContainer = document.getElementById('modalActions');
    if (actionsContainer) {
        if (isRedeem) {
            actionsContainer.innerHTML = `
                <button id="btnRedeem" onclick="window.redeemProduct()" class="bg-black text-primary w-full py-3.5 rounded-2xl font-black uppercase tracking-tighter shadow-xl hover:translate-y-0.5 hover:shadow-none transition-all border-2 border-black flex items-center justify-center gap-2 text-sm">
                    <span class="material-symbols-outlined text-lg">shopping_cart_checkout</span>
                    REDEEM SEKARANG
                </button>
            `;
        } else {
            actionsContainer.innerHTML = `
                <div class="flex flex-col gap-2 w-full">
                    <button onclick="window.initiateRekber()" class="bg-black text-primary w-full py-3.5 rounded-2xl font-black uppercase tracking-tighter shadow-xl hover:translate-y-0.5 hover:shadow-none transition-all border-2 border-black flex items-center justify-center gap-2 text-sm">
                        <span class="material-symbols-outlined text-lg">verified_user</span>
                        BELI VIA REKBER (EASY & SAFE)
                    </button>
                    <button onclick="contactSeller()" class="bg-green-500 text-white w-full py-3.5 rounded-2xl font-black uppercase tracking-tighter shadow-xl hover:translate-y-0.5 hover:shadow-none transition-all border-2 border-black flex items-center justify-center gap-2 text-sm">
                        <span class="material-symbols-outlined text-lg">call</span>
                        HUBUNGI PENJUAL
                    </button>
                </div>
            `;
        }
    }

    // Toggle REKBER Warning for IDR items
    const rekberWarning = document.getElementById('modalRekberWarning');
    if (rekberWarning) {
        if (!isRedeem) rekberWarning.classList.remove('hidden');
        else rekberWarning.classList.add('hidden');
    }

    // Reset Zoom
    window.closeStickerZoom?.();

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    anime({
        targets: '.comic-modal',
        scale: [0.95, 1],
        opacity: [0, 1],
        duration: 300,
        easing: 'easeOutQuart'
    });
}

/**
 * Update image counter on scroll
 */
window.updateImageCounter = (el) => {
    const counter = document.getElementById('imageCounter');
    if (!counter) return;
    const width = el.offsetWidth;
    const index = Math.round(el.scrollLeft / width);
    const total = el.children.length;
    counter.textContent = `${index + 1}/${total}`;
};

/**
 * Load stickers for a specific pack preview
 */
async function loadPackStickers(packId) {
    const grid = document.getElementById('packStickersGrid');
    if (!grid) return;

    try {
        const { data, error } = await sbClient
            .from('stickers')
            .select('url, name')
            .eq('pack_id', packId);

        if (error) throw error;

        if (!data || data.length === 0) {
            grid.innerHTML = '<div class="col-span-full py-2 text-center text-[10px] opacity-50">KOSONG...</div>';
            return;
        }

        grid.innerHTML = data.map((s, idx) => `
            <div onclick="window.selectStickerPreview('${s.url}', this)" class="aspect-square bg-white rounded-xl border-2 border-black/5 overflow-hidden p-1 flex items-center justify-center hover:scale-110 hover:border-primary transition-all cursor-pointer group shadow-sm active:scale-95">
                <img src="${s.url}" alt="${s.name}" class="w-full h-full object-contain group-hover:drop-shadow-md" title="${s.name}">
            </div>
        `).join('');

    } catch (err) {
        logger.error('Error loading pack preview:', err);
        grid.innerHTML = '<div class="col-span-full py-2 text-center text-[10px] text-red-500 font-bold">GAGAL MEMUAT</div>';
    }
}

/**
 * Zoom in on a sticker
 */
window.focusSticker = (url) => {
    const overlay = document.getElementById('modalZoomOverlay');
    const img = document.getElementById('modalZoomImg');
    if (overlay && img) {
        img.src = url;
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');

        anime({
            targets: img,
            scale: [0.5, 1],
            opacity: [0, 1],
            duration: 300,
            easing: 'easeOutBack'
        });
    }
};

/**
 * Handle sticker selection in Pack Preview
 */
window.selectStickerPreview = (url, el) => {
    const modalImg = document.getElementById('modalProductImage');
    if (modalImg) {
        modalImg.src = url;
        // Animation
        anime({
            targets: modalImg,
            opacity: [0.5, 1],
            scale: [0.98, 1],
            duration: 300,
            easing: 'easeOutQuad'
        });
    }

    // Highlight the selected sticker thumb
    const packGrid = document.getElementById('packStickersGrid');
    if (packGrid) {
        packGrid.querySelectorAll('div').forEach(div => {
            div.classList.remove('border-primary', 'scale-110');
            div.classList.add('border-black/5');
        });
    }

    if (el) {
        el.classList.add('border-primary', 'scale-110');
        el.classList.remove('border-black/5');
    }
};

window.closeStickerZoom = () => {
    const overlay = document.getElementById('modalZoomOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
    }
};

/**
 * Close product modal
 */
export function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        currentProduct = null;
    }
}

/**
 * Process redemption using Points
 */
window.redeemProduct = async () => {
    if (!currentProduct || !currentProduct.is_redeemable) return;
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu untuk tukar poin! 🔒', 'error');
        return;
    }

    if (!confirm(`Konfirmasi: Tukar ${currentProduct.redeem_points} Poin untuk "${currentProduct.name}"?`)) return;

    const btn = document.getElementById('btnRedeem');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span> PROSES...';
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'redeemProduct', product_id: currentProduct.id }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.message);

        showNotification(`🎉 ${data.message}`, 'success');
        closeProductModal();

        // Update local points if possible
        window.dispatchEvent(new CustomEvent('userPointsUpdated', { detail: { points: data.new_balance } }));

    } catch (err) {
        showNotification(err.message, 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined">shopping_cart_checkout</span> REDEEM SEKARANG';
        }
    }
};

/**
 * Contact seller via WhatsApp
 */
export function contactSeller() {
    if (!currentProduct || !currentProduct.profiles) {
        showNotification('Info penjual tidak lengkap.');
        return;
    }

    const phone = currentProduct.profiles.whatsapp;
    if (!phone) {
        showNotification('Penjual tidak mencantumkan nomor HP. 😢 Coba hubungi via Mailbox JDK.');
        return;
    }

    // Format phone number (remove leading 0 or +62, ensure 62 prefix)
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.substring(1);
    if (!cleanPhone.startsWith('62')) cleanPhone = '62' + cleanPhone;

    const message = `Halo ${currentProduct.profiles.username}, saya tertarik dengan "${currentProduct.name}" yang ada di JDK Box. Masih ada?`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

    window.open(url, '_blank');
}

/**
 * Contact seller via JDK Mailbox
 */
export function contactSellerMailbox() {
    if (!currentProduct || !currentProduct.profiles) {
        showNotification('Info penjual tidak lengkap.');
        return;
    }

    // Check if user is logged in
    const currentUser = sbClient.auth.getUser();
    if (!currentUser) {
        showNotification('Login dulu untuk mengirim pesan ke penjual.');
        return;
    }

    // Redirect to profile page with mailbox open or open mailbox modal
    const sellerId = currentProduct.seller_id;
    const sellerUsername = currentProduct.profiles.username;
    const productName = currentProduct.name;

    // Use global mailbox if available
    if (typeof window.openMailbox === 'function') {
        window.openMailbox(sellerId, `Tanya tentang: ${productName}`);
    } else {
        // Fallback: go to profile page
        window.location.href = `profile.html?id=${sellerId}&action=message&subject=${encodeURIComponent(productName)}`;
    }
}

/**
 * View seller profile/vCard
 */
export function viewSellerProfile() {
    if (!currentProduct || !currentProduct.seller_id) {
        showNotification('Info penjual tidak tersedia.');
        return;
    }

    window.location.href = `profile.html?id=${currentProduct.seller_id}`;
}

/**
 * Add product to wishlist
 */
export async function addToWishlist() {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Silakan login untuk menyimpan ke wishlist! ❤️');
        return;
    }

    if (!currentProduct) return;

    const btn = document.querySelector('[onclick*="addToWishlist"]');
    const icon = btn?.querySelector('.material-symbols-outlined');
    const originalIcon = icon ? icon.textContent : 'favorite';
    if (icon) icon.textContent = 'hourglass_empty';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'toggleWishlist', product_id: currentProduct.id }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal mengubah wishlist');

        showNotification(data.message || (data.wishlisted ? 'Disimpan ke wishlist! ❤️' : 'Dihapus dari wishlist! 💔'));
        if (icon) icon.textContent = data.wishlisted ? 'favorite' : 'favorite_border';

    } catch (err) {
        logger.error('Wishlist error:', err);
        showNotification('Gagal mengupdate wishlist.');
        if (icon) icon.textContent = originalIcon;
    }
}

/**
 * Check wishlist status when opening modal
 */
async function checkWishlistStatus(productId) {
    const user = getCurrentUser();
    if (!user) return;

    const btn = document.querySelector('[onclick*="addToWishlist"]');
    const icon = btn?.querySelector('.material-symbols-outlined');
    if (!icon) return;

    const { data } = await sbClient
        .from('wishlist')
        .select('id')
        .eq('user_id', user.id)
        .eq('product_id', productId)
        .single();

    if (data) {
        icon.textContent = 'favorite';
    } else {
        icon.textContent = 'favorite_border';
    }
}

/**
 * Initiate Rekber Transaction
 */
window.initiateRekber = async () => {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu untuk rekber! 🔒', 'error');
        return;
    }

    if (!currentProduct) return;

    // Check if seller is the buyer
    if (currentProduct.seller_id === user.id) {
        showNotification('Tidak bisa beli barang sendiri! 😅', 'error');
        return;
    }

    // Level 1 check
    const { level } = calculateUserLevel(user.xp || 0);
    if (level === 1 && !user.whatsapp) {
        // Need to fetch latest profile to be sure
        const { data: profile } = await sbClient.from('profiles').select('whatsapp').eq('id', user.id).single();
        if (!profile?.whatsapp) {
            showNotification('Buyer Level 1 wajib isi nomor WhatsApp di profil! 📱', 'error');
            setTimeout(() => window.location.href = '/profile.html', 1500);
            return;
        }
    }

    if (!confirm(`Konfirmasi: Ingin membeli "${currentProduct.name}" seharga Rp ${currentProduct.price.toLocaleString()} via REKBER JDK?`)) return;

    const btn = document.querySelector('[onclick="window.initiateRekber()"]');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-lg">sync</span> MEMULAI...';
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'initiateRekber', product_id: currentProduct.id }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.message || 'Gagal memulai rekber');

        showNotification('✅ Rekber diajukan! Mengalihkan ke ruang transaksi...', 'success');
        setTimeout(() => window.location.href = `rekber.html?id=${data.transaction_id}`, 1000);

    } catch (err) {
        logger.error('Rekber initiation error:', err);
        showNotification('Gagal membuat rekber: ' + err.message, 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined text-lg">verified_user</span> BELI VIA REKBER (EASY & SAFE)';
        }
    }
};

/**
 * Initialize Upload Modal Logic
 */
export async function initializeUploadModal() {
    const uploadBtn = document.getElementById('uploadBtn');
    if (uploadBtn) {
        uploadBtn.onclick = () => {
            const user = getCurrentUser();
            if (!user) {
                showNotification('Silakan login untuk upload barang! 🔒');
                return;
            }
            openUploadModal();
        }
    }

    // CHECK USER LEVEL FOR STICKERS
    const user = getCurrentUser();
    if (user && systemSettings) {
        const { level } = calculateUserLevel(user.xp || 0);
        const minStickerLevel = systemSettings.min_sticker_level || 2;
        const categorySelect = document.getElementById('uploadCategory');
        if (categorySelect) {
            if (level >= minStickerLevel) {
                // Check if already has stickers option
                if (!categorySelect.querySelector('option[value="stickers"]')) {
                    const opt = document.createElement('option');
                    opt.value = 'stickers';
                    opt.textContent = `🎁 STICKER PACK (LV ${minStickerLevel}+)`;
                    categorySelect.appendChild(opt);
                    logger.log('Sticker category unlocked for level:', level);
                }
            } else {
                logger.log('Sticker category locked. Current level:', level);
            }
        }
    }

}

export function openUploadModal(data = null) {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    if (data) {
        window.editingProductId = data.id;
        document.getElementById('uploadTitle').value = data.name;
        document.getElementById('uploadCategory').value = data.category;
        document.getElementById('uploadCondition').value = data.condition;
        document.getElementById('uploadPrice').value = data.price;
        document.getElementById('uploadIsRedeemable').value = String(data.is_redeemable);
        document.getElementById('uploadRedeemPoints').value = data.redeem_points || 0;
        document.getElementById('uploadLocation').value = data.location;
        document.getElementById('uploadDescription').value = data.description || '';
        document.getElementById('uploadStock').value = data.stock || 1;
        document.getElementById('uploadIsUnlimited').checked = !!data.is_unlimited;

        // Show status field during EDIT
        const statusCont = document.getElementById('statusFieldContainer');
        if (statusCont) {
            statusCont.classList.remove('hidden');
            document.getElementById('uploadStatus').value = data.status || 'available';
        }

        // Trigger UI updates
        togglePriceFields();
        window.toggleStockInput?.();
        window.handleCategoryChange?.();

        const previewDiv = document.getElementById('uploadPreview');
        if (previewDiv && data.image_url) {
            previewDiv.style.backgroundImage = `url(${data.image_url})`;
            previewDiv.classList.remove('hidden');
            document.getElementById('uploadPlaceholder')?.classList.add('opacity-0');
        }

        // Render existing gallery for management
        const gallery = data.gallery && data.gallery.length > 0 ? [...data.gallery] : (data.image_url ? [data.image_url] : []);
        retainedGallery = [...gallery];
        removedPhotos = [];
        renderExistingGallery();
    }
}

export function closeUploadModal() {
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    // Clear edit state
    window.editingProductId = null;
    document.getElementById('uploadForm')?.reset();
    const previewDiv = document.getElementById('uploadPreview');
    const placeholder = document.getElementById('uploadPlaceholder');
    if (previewDiv) {
        previewDiv.style.backgroundImage = 'none';
        previewDiv.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('opacity-0');

    // Hide status field
    document.getElementById('statusFieldContainer')?.classList.add('hidden');

    // Reset Upload Button Text
    const btn = document.querySelector('#uploadModal .btn-primary');
    if (btn) btn.textContent = 'UPLOAD';

    // Clear Multi-photo Preview
    const multiPreview = document.getElementById('multiPhotoPreview');
    if (multiPreview) {
        multiPreview.innerHTML = '';
        multiPreview.classList.add('hidden');
    }
    const uploadPlaceholder = document.getElementById('uploadPlaceholder');
    if (uploadPlaceholder) uploadPlaceholder.classList.remove('hidden');

    // Reset gallery edit state
    retainedGallery = [];
    removedPhotos = [];
    const existingGallery = document.getElementById('existingGallery');
    if (existingGallery) existingGallery.classList.add('hidden');
}

/**
 * Submit Product Upload (or Update)
 */
export async function submitUpload() {
    const user = getCurrentUser();
    if (!user) return;

    // Use explicit IDs for reliable form data capture
    const title = document.getElementById('uploadTitle')?.value?.trim();
    const category = document.getElementById('uploadCategory')?.value;
    const condition = document.getElementById('uploadCondition')?.value;
    const price = document.getElementById('uploadPrice')?.value || 0;
    const isRedeemable = document.getElementById('uploadIsRedeemable')?.value === 'true';
    const redeemPoints = document.getElementById('uploadRedeemPoints')?.value || 0;
    const location = document.getElementById('uploadLocation')?.value;
    const description = document.getElementById('uploadDescription')?.value?.trim();
    const stock = document.getElementById('uploadStock')?.value;
    const isUnlimited = document.getElementById('uploadIsUnlimited')?.checked;
    const photoInput = document.getElementById('photoInput');

    if (!title || !category || !condition || (!isRedeemable && !price) || (isRedeemable && !redeemPoints) || !location || (!isUnlimited && !stock)) {
        showNotification('Mohon lengkapi semua data! ⚠️');
        return;
    }

    // UPLOAD XP CHECK (Client-side early warning)
    const isEdit = !!window.editingProductId;
    const minUploadXp = systemSettings?.min_upload_xp || 200;
    if (!isEdit && (user.xp || 0) < minUploadXp) {
        showNotification(`Maaf, minimal harus memiliki ${minUploadXp} XP untuk jualan di JDK Box! 🔒`, 'error');
        return;
    }

    // LEVEL CHECK FOR STICKERS
    if (category === 'stickers') {
        const minStickerLevel = systemSettings?.min_sticker_level || 2;
        const { level } = calculateUserLevel(user.xp || 0);
        if (level < minStickerLevel) {
            showNotification(`Maaf, minimal Level ${minStickerLevel} untuk menjual Sticker Pack! 🎁`, 'error');
            return;
        }
    }

    // For new uploads, photo is mandatory. For edits, it's optional (keep existing).
    if (!isEdit && (!photoInput.files || !photoInput.files[0])) {
        showNotification('Mohon upload foto barang! 📷');
        return;
    }

    const btn = document.querySelector('#uploadModal .btn-primary');
    const originalText = btn ? btn.textContent : 'UPLOAD';
    if (btn) {
        btn.textContent = isEdit ? 'MENYIMPAN... 💾' : 'MENGUPLOAD... 📤';
        btn.disabled = true;
    }

    showNotification(isEdit ? 'Menyimpan perubahan... ⏳' : 'Mengupload barang... ⏳', 'info');

    try {
        let publicUrl = null;
        let galleryUrls = [];

        // 1. Upload Images (Multiple)
        if (photoInput.files && photoInput.files.length > 0) {
            const files = Array.from(photoInput.files).slice(0, 5); // Limit 5

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const fileExt = file.name.split('.').pop();
                const fileName = `product_${user.id}_${Date.now()}_${i}.${fileExt}`;

                const { error: uploadError } = await sbClient.storage
                    .from('product-images')
                    .upload(fileName, file);

                if (uploadError) throw new Error('Gagal upload gambar ke-' + (i + 1) + ': ' + uploadError.message);

                const { data } = sbClient.storage.from('product-images').getPublicUrl(fileName);
                galleryUrls.push(data.publicUrl);
            }

            // First image is the main cover
            publicUrl = galleryUrls[0];
        }

        // 2. Insert or Update Database Record
        const payload = {
            name: title,
            category: category,
            price: parseInt(price),
            is_redeemable: isRedeemable,
            redeem_points: parseInt(redeemPoints),
            location: location,
            description: description,
            condition: condition,
            stock: isUnlimited ? 1 : parseInt(stock),
            is_unlimited: isUnlimited,
            status: isEdit ? (document.getElementById('uploadStatus')?.value || 'pending') : 'pending'
        };

        if (isEdit) {
            // Validate at least one photo exists (retained + new)
            if (retainedGallery.length === 0 && galleryUrls.length === 0) {
                throw new Error("Minimal harus ada 1 foto barang! 📷");
            }

            // Merge: retained existing photos + newly uploaded photos
            const mergedGallery = [...retainedGallery, ...galleryUrls];
            if (mergedGallery.length > 0) {
                payload.image_url = mergedGallery[0];
                payload.gallery = mergedGallery;
            }
        } else if (publicUrl) {
            payload.image_url = publicUrl;
            payload.gallery = galleryUrls;
        }

        let dbError;
        let responseData;

        if (isEdit) {
            // Update via Edge Function
            const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
                body: {
                    action: 'updateProduct',
                    payload: {
                        product_id: window.editingProductId,
                        ...payload
                    }
                }
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error || 'Gagal mengupdate barang');

            responseData = data;
            dbError = null;
        } else {
            // Insert via Edge Function for security & XP check
            payload.seller_id = user.id;
            if (!payload.image_url) throw new Error("Image URL missing");

            const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
                body: { action: 'createProduct', payload: payload }
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error || 'Gagal menyimpan barang');

            // Successfully created
            responseData = data;
            dbError = null;
        }

        if (dbError) throw new Error('Gagal menyimpan data: ' + dbError.message);

        const successMsg = isEdit
            ? 'Barang berhasil diupdate! Menunggu review admin kembali. ✨'
            : (responseData?.message || 'Barang berhasil diupload! ✨');
        showNotification(successMsg, 'success');
        closeUploadModal();

        // Cleanup
        window.editingProductId = null;
        if (isEdit) {
            // Clear URL param if present
            const url = new URL(window.location);
            url.searchParams.delete('edit');
            window.history.replaceState({}, '', url);
        }

        // Reset form
        document.getElementById('uploadForm').reset();
        const previewDiv = document.getElementById('uploadPreview');
        const placeholder = document.getElementById('uploadPlaceholder');
        if (previewDiv) {
            previewDiv.style.backgroundImage = 'none';
            previewDiv.classList.add('hidden');
        }
        if (placeholder) placeholder.classList.remove('opacity-0');

        // Refresh grid
        loadProducts(true);

    } catch (err) {
        logger.error('Upload/Update error:', err);
        showNotification('Error: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

/**
 * Filters Initialization
 */
function initializeFilters() {
    // Dropdowns
    ['categoryFilter', 'locationFilter', 'sortFilter', 'priceFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const key = id.replace('Filter', '');
                currentFilters[key] = e.target.value;
                loadProducts(true);
            });
        }
    });

    // Quick Buttons
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Visual toggle
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            // Logic mapping
            const text = e.target.textContent;
            if (text === 'SEMUA') {
                currentFilters = { category: '', price: '', location: '', sort: 'newest' };
                // Reset dropdowns
                document.querySelectorAll('.comic-select').forEach(s => s.value = ''); // Reset all selects
                const sortFilter = document.getElementById('sortFilter');
                if (sortFilter) sortFilter.value = 'newest';

                loadProducts(true);
            }
        });
    });
}

/**
 * Swap main image in detail modal
 */
window.selectStickerPreview = (url, el) => {
    // In e-commerce layout, we focus the sticker using the zoom overlay
    if (window.focusSticker) {
        window.focusSticker(url);
    } else {
        // Fallback or legacy support if needed
        const modalImg = document.getElementById('modalProductImage');
        if (modalImg) modalImg.src = url;
    }
};

function initializeLoadMore() {
    const btn = document.getElementById('loadMoreBtn');
    if (btn) {
        btn.onclick = () => loadProducts(false);
    }
}

/**
 * Toggle between IDR and Points inputs
 */
export function togglePriceFields() {
    const isRedeem = document.getElementById('uploadIsRedeemable')?.value === 'true';
    const rpField = document.getElementById('priceFieldContainer');
    const pointField = document.getElementById('redeemPointsField');
    const rpInput = document.getElementById('uploadPrice');
    const rpLabel = document.getElementById('priceLabelRp');

    if (isRedeem) {
        if (pointField) pointField.classList.remove('hidden');
        if (rpInput) {
            rpInput.disabled = true;
            rpInput.value = '0';
        }
        if (rpLabel) rpLabel.opacity = '0.3';
    } else {
        if (pointField) pointField.classList.add('hidden');
        if (rpInput) rpInput.disabled = false;
        if (rpLabel) rpLabel.opacity = '1';
    }
}

/**
 * Handle image preview for upload (Supports Multiple)
 */
function initializeImagePreview() {
    const photoInput = document.getElementById('photoInput');
    const preview = document.getElementById('uploadPreview');
    const placeholder = document.getElementById('uploadPlaceholder');
    const multiPreview = document.getElementById('multiPhotoPreview');

    if (photoInput && preview && placeholder && multiPreview) {
        photoInput.onchange = (e) => {
            const files = Array.from(e.target.files).slice(0, 5); // Max 5
            multiPreview.innerHTML = '';

            if (files.length > 0) {
                multiPreview.classList.remove('hidden');
                placeholder.classList.add('hidden');
                preview.classList.add('hidden'); // Hide main preview if using multi-grid

                files.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const thumb = document.createElement('div');
                        thumb.className = 'w-full aspect-square bg-cover bg-center rounded-lg border-2 border-black/10 shadow-sm';
                        thumb.style.backgroundImage = `url(${event.target.result})`;
                        multiPreview.appendChild(thumb);
                    };
                    reader.readAsDataURL(file);
                });

                // Show first as main preview background just in case
                const readerMain = new FileReader();
                readerMain.onload = (event) => {
                    preview.style.backgroundImage = `url(${event.target.result})`;
                };
                readerMain.readAsDataURL(files[0]);
            } else {
                multiPreview.classList.add('hidden');
                placeholder.classList.remove('hidden');
            }
        };
    }
}

/**
 * Handle Category Change (Show Guide)
 */
window.handleCategoryChange = () => {
    const category = document.getElementById('uploadCategory')?.value;
    const guide = document.getElementById('stickerUploadGuide');
    if (guide) {
        if (category === 'stickers') {
            guide.classList.remove('hidden');
        } else {
            guide.classList.add('hidden');
        }
    }
};

/**
 * Render existing gallery thumbnails with delete buttons for edit mode
 */
function renderExistingGallery() {
    const container = document.getElementById('existingGallery');
    const grid = document.getElementById('existingGalleryGrid');
    if (!container || !grid) return;

    if (retainedGallery.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    grid.innerHTML = '';

    retainedGallery.forEach((url, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'relative group';
        wrapper.innerHTML = `
            <div class="w-full aspect-square bg-cover bg-center rounded-lg border-2 border-black/10 shadow-sm"
                 style="background-image:url(${url})"></div>
            <button type="button" onclick="removeExistingPhoto(${idx})"
                class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] font-black flex items-center justify-center shadow-md hover:bg-red-600 transition-colors opacity-80 group-hover:opacity-100"
                title="Hapus foto ini">✕</button>
        `;
        grid.appendChild(wrapper);
    });
}

/**
 * Remove an existing photo from retained gallery
 */
function removeExistingPhoto(index) {
    if (index < 0 || index >= retainedGallery.length) return;
    const removed = retainedGallery.splice(index, 1);
    removedPhotos.push(...removed);
    renderExistingGallery();

    // Update main preview if gallery still has items
    const previewDiv = document.getElementById('uploadPreview');
    if (retainedGallery.length > 0 && previewDiv) {
        previewDiv.style.backgroundImage = `url(${retainedGallery[0]})`;
    } else if (previewDiv) {
        previewDiv.style.backgroundImage = 'none';
        previewDiv.classList.add('hidden');
        document.getElementById('uploadPlaceholder')?.classList.remove('opacity-0', 'hidden');
    }
}

// Expose to window
if (typeof window !== 'undefined') {
    window.initializeMarketplacePage = initializeMarketplacePage;
    window.openProductModal = openProductModal;
    window.closeProductModal = closeProductModal;
    window.contactSeller = contactSeller;
    window.contactSellerMailbox = contactSellerMailbox;
    window.viewSellerProfile = viewSellerProfile;
    window.addToWishlist = addToWishlist;
    window.closeUploadModal = closeUploadModal;
    window.submitUpload = submitUpload;
    window.openUploadModal = openUploadModal;
    window.switchMarketTab = switchMarketTab;
    window.redeemProduct = redeemProduct;
    window.togglePriceFields = togglePriceFields;
    window.removeExistingPhoto = removeExistingPhoto;
    window.toggleStockInput = () => {
        const isUnlimited = document.getElementById('uploadIsUnlimited')?.checked;
        const stockInput = document.getElementById('uploadStock');
        if (stockInput) {
            stockInput.disabled = isUnlimited;
            if (isUnlimited) stockInput.value = '';
            else if (!stockInput.value) stockInput.value = '1';
        }
    };
    window.updateImageCounter = window.updateImageCounter || function () { }; // Already defined above but ensuring exposure
    window.selectStickerPreview = window.selectStickerPreview;
}

/**
 * Ensure "Upload Barang" button exists in Navbar
 * (Fix for SPA navigation where Navbar might be preserved from Home)
 */
/**
 * Handle Upload Button Click (Desktop & Mobile FAB)
 */
window.handleUploadClick = () => {
    const user = getCurrentUser();

    // 1. Check Login
    if (!user) {
        showNotification('Silakan login untuk upload barang! 🔒');
        // Optional: Open login modal if available
        if (window.openLoginModal) window.openLoginModal();
        return;
    }

    // 2. Check Verification (Optional - based on existing logic)
    // if (!user.is_verified) ... 

    // 3. Open Upload Modal
    // Ensure modal exists first
    ensureUploadModalExists();
    const modal = document.getElementById('uploadModal');
    if (modal) {
        modal.classList.remove('hidden');
        // Animate in
        anime({
            targets: modal.querySelector('.comic-modal'),
            scale: [0.9, 1],
            opacity: [0, 1],
            duration: 300,
            easing: 'easeOutElastic(1, .8)'
        });
    } else {
        logger.error('Upload modal not found even after ensureUploadModalExists()');
        showNotification('Gagal memuat modal upload. Silakan refresh halaman.');
    }
};

/**
 * Ensure Desktop Upload Button exists in Navbar
 * (SPA fix: navbar is outside <main>, so this button is lost during SPA navigation)
 */
function ensureUploadButtonExists() {
    if (document.getElementById('uploadBtn')) return;

    logger.log('🛠️ Injecting Upload Button into Navbar...');

    // Find the navbar CTA area (where the join button / icons are)
    const navCta = document.querySelector('.comic-nav .flex.items-center.gap-2');
    if (!navCta) {
        logger.warn('Navbar CTA area not found, cannot inject upload button');
        return;
    }

    const uploadBtnHtml = `
        <button id="uploadBtn" onclick="window.handleUploadClick()"
            class="hidden md:flex bg-black text-primary px-4 py-2 rounded-lg font-bold text-sm hover:bg-gray-800 transition-colors uppercase items-center gap-2"
            data-spa-injected="true">
            <span class="material-symbols-outlined text-lg">add_box</span> Upload
        </button>`;

    // Insert before the first child of the CTA area
    navCta.insertAdjacentHTML('afterbegin', uploadBtnHtml);
    logger.log('✅ Upload Button injected into Navbar');
}

/**
 * Ensure Mobile Upload FAB exists
 * (SPA fix: FAB is outside <main>, so it is lost during SPA navigation)
 */
function ensureMobileFabExists() {
    if (document.getElementById('mobileUploadFab')) return;

    logger.log('🛠️ Injecting Mobile Upload FAB...');

    const fabHtml = `
        <button id="mobileUploadFab" onclick="window.handleUploadClick()"
            class="mobile-upload-fab md:hidden" data-spa-injected="true">
            <span class="material-symbols-outlined">add</span>
        </button>`;

    document.body.insertAdjacentHTML('beforeend', fabHtml);
    logger.log('✅ Mobile Upload FAB injected');
}

/**
 * Ensure Upload Modal exists in DOM
 * (Fix for SPA navigation: modal is outside <main> in marketplace.html,
 *  so it's NOT included when SPA router swaps <main> content)
 */
function ensureUploadModalExists() {
    if (document.getElementById('uploadModal')) return;

    logger.log('🛠️ Injecting Upload Modal into DOM...');

    const modalHtml = `
    <div id="uploadModal" class="comic-modal-overlay hidden" data-spa-injected="true">
        <div class="comic-modal w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
            <div class="comic-modal-header text-center flex-shrink-0 !py-2 relative">
                <div class="comic-modal-badge bg-comic-purple !top-2">BOX!</div>
                <button onclick="closeUploadModal()" class="comic-modal-close">&times;</button>
                <div class="comic-modal-icon !text-2xl mb-0">📤</div>
                <h3 class="comic-modal-title text-lg md:text-xl uppercase tracking-tighter">UPLOAD BARANG</h3>
            </div>
            <div class="comic-modal-body flex-1 overflow-y-auto !p-4">
                <form id="uploadForm" class="grid md:grid-cols-2 gap-4">
                    <div class="space-y-3">
                        <div>
                            <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Judul Barang</label>
                            <input type="text" id="uploadTitle" class="comic-input !text-xs !p-2" placeholder="Nama barang kamu..." required>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Kategori</label>
                                <select id="uploadCategory" class="comic-select !text-xs !p-2" onchange="window.handleCategoryChange()" required>
                                    <option value="">PILIH</option>
                                    <option value="action-figures">ACTION FIGURES</option>
                                    <option value="posters">POSTER & ART</option>
                                    <option value="games">GAMES & CONSOLE</option>
                                    <option value="toys">MAINAN VINTAGE</option>
                                    <option value="comics">KOMIK & BUKU</option>
                                    <option value="collectibles">KOLEKSI LANGKA</option>
                                    <option value="other">LAIN-LAIN</option>
                                </select>
                            </div>
                            <div>
                                <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Kondisi</label>
                                <select id="uploadCondition" class="comic-select !text-xs !p-2" required>
                                    <option value="">PILIH</option>
                                    <option value="New">NEW</option>
                                    <option value="Like New">LIKE NEW</option>
                                    <option value="Good">GOOD</option>
                                    <option value="Fair">FAIR</option>
                                    <option value="Junk">ANGGAP JUNK</option>
                                </select>
                            </div>
                        </div>
                        <div id="stickerUploadGuide" class="hidden p-3 bg-blue-50 border-2 border-blue-200 border-dashed rounded-xl flex items-start gap-2">
                            <span class="material-symbols-outlined text-blue-600 text-[14px]">info</span>
                            <p class="text-[9px] text-blue-800 font-bold leading-tight">
                                <b>MEKANISME JUAL STICKER:</b> Upload Cover & Deskripsi dulu. Setelah disetujui, Admin JDK akan menghubungi Anda (WA/Mailbox) untuk proses upload file sticker asli ke database.
                            </p>
                        </div>
                        <div class="grid grid-cols-2 gap-3">
                            <div id="priceFieldContainer">
                                <label id="priceLabelRp" class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Harga (Rp)</label>
                                <input type="number" id="uploadPrice" class="comic-input !text-xs !p-2" placeholder="0">
                            </div>
                            <div>
                                <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Metode Jual</label>
                                <select id="uploadIsRedeemable" class="comic-select !text-xs !p-2" onchange="window.togglePriceFields()">
                                    <option value="false">JUAL (Rp)</option>
                                    <option value="true">POINT CENTER</option>
                                </select>
                            </div>
                        </div>
                        <div id="redeemPointsField" class="hidden">
                            <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Harga (Points 🪙)</label>
                            <input type="number" id="uploadRedeemPoints" class="comic-input !text-xs !p-2" placeholder="100">
                        </div>
                        <div class="bg-gray-50 p-2 rounded-lg border border-black/5">
                            <div class="flex items-center justify-between mb-1">
                                <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest">Jumlah Stok</label>
                                <div class="flex items-center gap-1">
                                    <input type="checkbox" id="uploadIsUnlimited" class="w-3 h-3 accent-black" onchange="window.toggleStockInput()">
                                    <label for="uploadIsUnlimited" class="text-[10px] font-bold uppercase cursor-pointer">Unlimited? ♾️</label>
                                </div>
                            </div>
                            <input type="number" id="uploadStock" class="comic-input !text-xs !p-2" value="1" min="1">
                        </div>
                        <div id="statusFieldContainer" class="hidden">
                            <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Status Barang</label>
                            <select id="uploadStatus" class="comic-select !text-xs !p-2">
                                <option value="available">AVAILABLE (Aktif) ✅</option>
                                <option value="sold">SOLD (Sudah Terjual) 💰</option>
                                <option value="pending" disabled>PENDING (Review Admin) ⏳</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Lokasi</label>
                            <select id="uploadLocation" class="comic-select !text-xs !p-2" required>
                                <option value="JDK BOX" selected>📦 JDK BOX</option>
                                <option disabled>───────────────</option>
                                <option value="DKI Jakarta">DKI Jakarta</option>
                                <option value="Jawa Barat">Jawa Barat</option>
                                <option value="Jawa Tengah">Jawa Tengah</option>
                                <option value="Jawa Timur">Jawa Timur</option>
                                <option value="Banten">Banten</option>
                                <option value="Bali">Bali</option>
                                <option value="DI Yogyakarta">DI Yogyakarta</option>
                                <option value="Aceh">Aceh</option>
                                <option value="Sumatera Utara">Sumatera Utara</option>
                                <option value="Sumatera Barat">Sumatera Barat</option>
                                <option value="Riau">Riau</option>
                                <option value="Jambi">Jambi</option>
                                <option value="Sumatera Selatan">Sumatera Selatan</option>
                                <option value="Bengkulu">Bengkulu</option>
                                <option value="Lampung">Lampung</option>
                                <option value="Kep. Bangka Belitung">Bangka Belitung</option>
                                <option value="Kep. Riau">Kepara Riau</option>
                                <option value="Nusa Tenggara Barat">NTB</option>
                                <option value="Nusa Tenggara Timur">NTT</option>
                                <option value="Kalimantan Barat">Kal. Barat</option>
                                <option value="Kalimantan Tengah">Kal. Tengah</option>
                                <option value="Kalimantan Selatan">Kal. Selatan</option>
                                <option value="Kalimantan Timur">Kal. Timur</option>
                                <option value="Kalimantan Utara">Kal. Utara</option>
                                <option value="Sulawesi Utara">Sul. Utara</option>
                                <option value="Sulawesi Tengah">Sul. Tengah</option>
                                <option value="Sulawesi Selatan">Sul. Selatan</option>
                                <option value="Sulawesi Tenggara">Sul. Tenggara</option>
                                <option value="Gorontalo">Gorontalo</option>
                                <option value="Sulawesi Barat">Sul. Barat</option>
                                <option value="Maluku">Maluku</option>
                                <option value="Maluku Utara">Maluku Utara</option>
                                <option value="Papua">Papua</option>
                                <option value="Papua Barat">Papua Barat</option>
                            </select>
                        </div>
                    </div>
                    <div class="space-y-3">
                        <div>
                            <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Deskripsi</label>
                            <textarea rows="3" id="uploadDescription" class="comic-input !text-xs !p-2 h-20" placeholder="Ceritakan detail barang kamu..." required></textarea>
                        </div>
                        <div>
                            <label class="block font-black text-[10px] opacity-50 uppercase tracking-widest mb-1">Foto Barang (Maks 5) <span class="text-red-500">*</span></label>
                            <div class="upload-area relative cursor-pointer overflow-hidden bg-black/5 border-2 border-dashed border-black/20 rounded-xl h-24 hover:bg-yellow-50 hover:border-black/40 transition-all flex items-center justify-center">
                                <div id="uploadPlaceholder" class="flex flex-col items-center justify-center text-gray-400">
                                    <span class="material-symbols-outlined text-2xl">add_a_photo</span>
                                    <span class="text-[8px] font-bold mt-1 uppercase">Klik/Drop Foto</span>
                                </div>
                                <input type="file" accept="image/*" multiple class="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" id="photoInput">
                                <div id="uploadPreview" class="absolute inset-0 hidden bg-cover bg-center bg-white/80"></div>
                            </div>
                            <div id="multiPhotoPreview" class="grid grid-cols-5 gap-2 mt-2 hidden"></div>
                        </div>
                    </div>
                </form>
            </div>
            <div class="comic-modal-footer !p-4 !bg-transparent !border-0 flex-shrink-0">
                <button onclick="submitUpload()" class="btn-primary w-full shadow-[4px_4px_0_#000] active:translate-y-1 active:shadow-none hover:bg-black hover:text-white transition-all">
                    🚀 KIRIM REQUEST
                </button>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
    logger.log('✅ Upload Modal injected into DOM');
}

/**
 * Cleanup function when leaving Marketplace page
 */
export function cleanupMarketplacePage() {
    logger.log('🧹 Cleaning up Marketplace Page...');

    // Remove injected Upload Button
    const btn = document.getElementById('uploadBtn');
    if (btn && btn.dataset.spaInjected) {
        btn.remove();
        logger.log('🗑️ Upload Button removed');
    }

    // Remove injected Mobile Upload FAB
    const fab = document.getElementById('mobileUploadFab');
    if (fab && fab.dataset.spaInjected) {
        fab.remove();
        logger.log('🗑️ Mobile Upload FAB removed');
    }

    // Remove injected Upload Modal (only if SPA-injected)
    const modal = document.getElementById('uploadModal');
    if (modal && modal.dataset.spaInjected) {
        modal.remove();
        logger.log('🗑️ Upload Modal removed');
    }
}

/**
 * Mobile Filter Logic
 */

window.openMobileFilters = () => {
    const overlay = document.getElementById('mobileFilterOverlay');
    const sheet = document.getElementById('mobileFilterSheet');
    if (overlay && sheet) {
        overlay.classList.add('active');
        sheet.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
};

window.closeMobileFilters = () => {
    const overlay = document.getElementById('mobileFilterOverlay');
    const sheet = document.getElementById('mobileFilterSheet');
    if (overlay && sheet) {
        overlay.classList.remove('active');
        sheet.classList.remove('active');
        document.body.style.overflow = '';
    }
};

window.setMobileSort = (sortVal, btn) => {
    // Visual toggle
    document.querySelectorAll('.mobile-sort-btn').forEach(b => {
        b.classList.remove('bg-black', 'text-white', 'border-black');
        b.classList.add('bg-white', 'text-black', 'border-gray-200');
    });
    btn.classList.remove('bg-white', 'text-black', 'border-gray-200');
    btn.classList.add('bg-black', 'text-white', 'border-black');

    currentFilters.sort = sortVal;
};

window.applyMobileFilters = () => {
    const cat = document.getElementById('mobileCategoryFilter').value;
    const loc = document.getElementById('mobileLocationFilter').value;

    currentFilters.category = cat || null;
    currentFilters.location = loc || null;

    loadProducts(true);
};

window.setQuickFilter = (type, val) => {
    if (type === 'category') currentFilters.category = val;
    if (type === 'sort') currentFilters.sort = val;

    // Update visuals if needed, or just reload
    loadProducts(true);

    // Highlight active chip
    const chips = document.querySelectorAll('.chip-filter');
    chips.forEach(c => c.classList.remove('active'));
    event.currentTarget.classList.add('active');
};

function initializeMobileFilters() {
    // Sync initial state
    const catSelect = document.getElementById('mobileCategoryFilter');
    if (catSelect && currentFilters.category) catSelect.value = currentFilters.category;
}
