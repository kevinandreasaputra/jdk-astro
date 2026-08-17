console.log('🚀 Module: product.js loaded');
import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Product Detail Page
 * Handles fetching and displaying single product data
 */

import { sbClient } from '../core/supabase.js';
import { showNotification, getRelativeTime } from '../core/utils.js';
import { getCurrentUser } from '../modules/user-session.js';
import { calculateUserLevel } from '../modules/ranks.js';
import anime from 'animejs';

let currentProduct = null;

// Initialize on load (Now handled via main.js)
// document.addEventListener('DOMContentLoaded', () => {
//     initializeProductPage();
// });

export async function initializeProductPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        window.location.href = '/marketplace';
        return;
    }

    await loadProductDetails(productId);
}

/**
 * Fetch and display product details
 */
/**
 * Fetch and display product details
 */
async function loadProductDetails(id) {
    console.log('📦 Loading product details for:', id);
    try {
        // Create a timeout promise (15 seconds)
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out (Network/Database)')), 15000)
        );

        // Race the query against the timeout
        const queryPromise = sbClient
            .from('products')
            .select('*, profiles(id, username, domicile, whatsapp, avatar_url)')
            .eq('id', id)
            .single();

        const { data: product, error } = await Promise.race([queryPromise, timeoutPromise]);

        if (error) throw error;
        if (!product) throw new Error('Produk tidak ditemukan');

        logger.log('✅ Product loaded:', product.name);
        currentProduct = product;
        renderProduct(product);
        checkWishlistStatus(product.id);

    } catch (err) {
        logger.error('Error loading product:', err);
        showNotification(`Gagal memuat produk: ${err.message || 'Unknown error'}`, 'error');
        // setTimeout(() => window.location.href = '/marketplace', 3000); // Stay on page so user can see error
    }
}

/**
 * Render product data to DOM
 */
function renderProduct(product) {
    const isRedeem = product.is_redeemable;

    // 1. Text Data
    document.title = `${product.name} - JDK Box`;
    setText('productTitle', product.name);

    // Price / Points
    const priceEl = document.getElementById('productPrice');
    if (priceEl) {
        if (isRedeem) {
            const pointsValue = parseInt(product.redeem_points) || 0;
            priceEl.innerHTML = `<span class="text-black">${pointsValue.toLocaleString()} 🪙</span>`;
        } else {
            const priceValue = parseInt(product.price) || 0;
            priceEl.innerHTML = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(priceValue);
        }
    }

    // Status & Stock
    const statusEl = document.getElementById('productStatus');
    if (statusEl) {
        if (!product.status || product.status === 'available') {
            statusEl.classList.add('hidden');
        } else {
            statusEl.classList.remove('hidden');
            statusEl.textContent = (product.status || 'SOLD').toUpperCase();
            statusEl.className = 'px-3 py-1 text-white rounded-lg text-xs font-black uppercase shadow-sm bg-red-500';
        }
    }

    // Display Stock
    const stockEl = document.getElementById('productStockDisplay'); // We might need to create this element in html if not exists, or append it
    // For now, let's append it to productPrice container or similar if specific element doesn't exist
    // Actually, let's use the layout effectively.

    // Let's modify the Price Element to include Stock info below it or beside it
    const priceElForStock = document.getElementById('productPrice');
    if (priceElForStock && !document.getElementById('stockBadge')) {
        const stockDiv = document.createElement('div');
        stockDiv.id = 'stockBadge';
        stockDiv.className = 'mt-1 text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1';

        if (product.is_unlimited) {
            stockDiv.innerHTML = '<span class="material-symbols-outlined text-sm">all_inclusive</span> STOK UNLIMITED';
            stockDiv.className += ' text-blue-600';
        } else {
            stockDiv.innerHTML = `<span class="material-symbols-outlined text-sm">inventory_2</span> STOK: ${product.stock || 0}`;
            if ((product.stock || 0) <= 5) stockDiv.classList.add('text-red-500');
        }
        priceElForStock.parentNode.insertBefore(stockDiv, priceElForStock.nextSibling);
    }

    // Disable Action Buttons if Stock 0 & Not Unlimited
    if (!product.is_unlimited && (product.stock || 0) <= 0) {
        const btns = document.querySelectorAll('button[onclick*="handleRedeem"], button[onclick*="handleContact"]');
        btns.forEach(btn => {
            btn.disabled = true;
            btn.classList.add('opacity-50', 'cursor-not-allowed');
            btn.innerHTML = '<span class="material-symbols-outlined">block</span> STOK HABIS';
        });
    }

    // Meta
    const sellerName = product.profiles?.username || 'Admin';
    setText('productSeller', `@${sellerName}`);
    setText('productLocation', (product.location || 'Indonesia').toUpperCase());
    setText('productDate', new Date(product.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }));
    setText('productDescription', product.description || 'Tidak ada deskripsi.');

    // Update Social Share Meta Tags
    const ogTitle = `${product.name} - JDK Box`;
    const ogDesc = `Beli ${product.name} dari @${sellerName} di JDK Box. Harga: ${isRedeem ? product.redeem_points + ' Poin' : 'Rp ' + parseInt(product.price).toLocaleString('id-ID')}.`;
    const ogImage = product.image_url && product.image_url.startsWith('http') ? product.image_url : `https://jdkbox.vercel.app/images/jdk-logo.png`; // Fallback if local path

    // Set Meta Tags
    document.querySelector('meta[property="og:title"]').setAttribute('content', ogTitle);
    document.querySelector('meta[property="og:description"]').setAttribute('content', ogDesc);
    document.querySelector('meta[property="og:image"]').setAttribute('content', ogImage);
    document.querySelector('meta[property="og:url"]').setAttribute('content', window.location.href);

    // Set Twitter Tags
    document.querySelector('meta[name="twitter:title"]').setAttribute('content', ogTitle);
    document.querySelector('meta[name="twitter:description"]').setAttribute('content', ogDesc);
    document.querySelector('meta[name="twitter:image"]').setAttribute('content', ogImage);

    // Update Share Text Logic (for copy/share buttons)
    window.currentShareText = `Check out ${product.name} on JDK Box!`;

    // 2. Images (Gallery)
    const galleryEl = document.getElementById('productSwipeGallery');
    const thumbEl = document.getElementById('productThumbnails');

    if (galleryEl) {
        galleryEl.innerHTML = '';
        if (thumbEl) thumbEl.innerHTML = '';
        const images = [];

        // Collect all images
        if (product.image_url) images.push(product.image_url);
        if (product.gallery && Array.isArray(product.gallery)) {
            product.gallery.forEach(url => {
                if (url && url !== product.image_url) images.push(url);
            });
        }

        // Render items
        if (images.length === 0) {
            galleryEl.innerHTML = `
                <div class="swipe-item bg-gray-100 flex flex-col items-center justify-center text-gray-400">
                    <span class="material-symbols-outlined text-4xl mb-2">image_not_supported</span>
                    <span class="text-xs font-bold">NO IMAGE</span>
                </div>`;
            if (thumbEl) thumbEl.classList.add('hidden');
        } else {
            images.forEach((url, index) => {
                // Main Gallery Item
                const item = document.createElement('div');
                item.className = 'swipe-item relative';
                item.innerHTML = `<img src="${url}" alt="${product.name} - ${index + 1}" class="w-full h-full object-contain">`;
                galleryEl.appendChild(item);

                // Thumbnail Item (if more than 1 image)
                if (images.length > 1 && thumbEl) {
                    const thumb = document.createElement('div');
                    thumb.className = `thumb-item ${index === 0 ? 'active' : ''}`;
                    thumb.innerHTML = `<img src="${url}" alt="Thumbnail ${index + 1}">`;
                    thumb.onclick = () => {
                        const width = galleryEl.offsetWidth;
                        galleryEl.scrollTo({ left: width * index, behavior: 'smooth' });
                    };
                    thumbEl.appendChild(thumb);
                }
            });

            if (images.length > 1 && thumbEl) {
                thumbEl.classList.remove('hidden');
            } else if (thumbEl) {
                thumbEl.classList.add('hidden');
            }
        }

        // Override/Extend window.updateImageCounter to also sync thumbnails
        window.updateImageCounter = function (el) {
            const width = el.offsetWidth;
            const scroll = el.scrollLeft;
            const index = Math.round(scroll / width);
            const total = el.children.length;

            // Update Counter Text
            const counter = document.getElementById('imageCounter');
            if (counter && total > 0) {
                counter.innerText = `${index + 1}/${total}`;
                if (total > 1) counter.classList.remove('hidden');
            }

            // Sync Thumbnails active state
            const thumbs = document.querySelectorAll('.thumb-item');
            thumbs.forEach((t, i) => {
                if (i === index) t.classList.add('active');
                else t.classList.remove('active');
            });
        };

        // Init counter and state
        window.updateImageCounter(galleryEl);
    }

    // 3. Update REKBER Warning for IDR items
    const rekberWarning = document.getElementById('rekberWarning');
    if (rekberWarning) {
        if (!isRedeem) rekberWarning.classList.remove('hidden');
        else rekberWarning.classList.add('hidden');
    }

    // 4. Update Action Buttons (Desktop & Mobile)
    const user = getCurrentUser();
    const isSeller = user && product.seller_id === user.id;
    updateActionButtons(isRedeem, product, isSeller);
}

function updateActionButtons(isRedeem, product = {}, isSeller = false) {
    // Actions are handled by global handlers, but we might want to change text/icon based on redeem status
    const desktopActions = document.getElementById('desktopActions');
    const mobileContainer = document.getElementById('mobileActionContainer');

    const actionHtml = isRedeem
        ? `<button onclick="handleRedeem()" class="w-full bg-black text-primary hover:text-white py-4 rounded-xl font-black uppercase tracking-wide shadow-xl hover:-translate-y-1 transition-all border-2 border-black flex items-center justify-center gap-2">
             <span class="material-symbols-outlined">shopping_cart_checkout</span> REDEEM SEKARANG
           </button>`
        : `<button onclick="handleContact()" class="w-full bg-green-500 text-white py-4 rounded-xl font-black uppercase tracking-wide shadow-xl hover:-translate-y-1 transition-all border-2 border-black flex items-center justify-center gap-2">
             <span class="material-symbols-outlined">call</span> HUBUNGI PENJUAL
           </button>`;

    // Update Desktop Button (first child of flex gap-3)
    if (desktopActions) {
        const btnContainer = desktopActions.querySelector('.flex');
        if (btnContainer && btnContainer.children[0]) {
            btnContainer.children[0].outerHTML = isRedeem
                ? `<button onclick="handleRedeem()" class="flex-1 bg-black text-primary hover:text-white py-4 rounded-xl font-black uppercase tracking-wide hover:shadow-lg hover:-translate-y-1 transition-all border-2 border-black flex items-center justify-center gap-2">
                    <span class="material-symbols-outlined">shopping_cart_checkout</span> REDEEM SEKARANG
                   </button>`
                : `<div class="flex flex-col gap-2 flex-1">
                    <button onclick="window.handleRekber()" class="w-full bg-black text-primary hover:text-white py-4 rounded-xl font-black uppercase tracking-wide hover:shadow-lg hover:-translate-y-1 transition-all border-2 border-black flex items-center justify-center gap-2">
                        <span class="material-symbols-outlined">verified_user</span> BELI VIA REKBER
                    </button>
                    <button onclick="handleContact()" class="w-full bg-green-500 text-white py-4 rounded-xl font-black uppercase tracking-wide hover:shadow-lg hover:-translate-y-1 transition-all border-2 border-black flex items-center justify-center gap-2">
                        <span class="material-symbols-outlined">call</span> HUBUNGI PENJUAL
                    </button>
                   </div>`;
        }
    }

    // Update Mobile Button
    if (mobileContainer) {
        if (isSeller && !product.is_redeemable && product.status !== 'sold') {
            mobileContainer.innerHTML = `
                <button onclick="handleMarkAsSold()" class="w-full bg-red-600 text-white h-12 rounded-xl font-bold uppercase tracking-wide shadow-md active:translate-y-0.5 active:shadow-none flex items-center justify-center gap-2 border border-red-800">
                    <span class="material-symbols-outlined">archive</span> TANDAI TERJUAL
                </button>`;
        } else {
            mobileContainer.innerHTML = isRedeem
                ? `<button onclick="handleRedeem()" class="w-full bg-black text-primary h-12 rounded-xl font-bold uppercase tracking-wide shadow-md active:translate-y-0.5 active:shadow-none flex items-center justify-center gap-2 border border-black/10">
                     <span class="material-symbols-outlined">shopping_cart_checkout</span> REDEEM
                   </button>`
                : `<div class="flex gap-2 w-full">
                    <button onclick="window.handleRekber()" class="flex-1 bg-black text-primary h-12 rounded-xl font-bold uppercase tracking-wide shadow-md active:translate-y-0.5 active:shadow-none flex items-center justify-center gap-2 border border-black/10">
                     <span class="material-symbols-outlined">verified_user</span> REKBER
                    </button>
                    <button onclick="handleContact()" class="flex-1 bg-green-500 text-white h-12 rounded-xl font-bold uppercase tracking-wide shadow-md active:translate-y-0.5 active:shadow-none flex items-center justify-center gap-2 border border-black/10">
                     <span class="material-symbols-outlined">call</span> HUBUNGI
                    </button>
                   </div>`;
        }
    }
}

window.handleMarkAsSold = async () => {
    if (!currentProduct) return;

    // Double confirmation to prevent accidents
    if (!confirm('Apakah Anda yakin ingin menandai barang ini sebagai TERJUAL?\n\nAksi ini akan:\n1. Mengubah status menjadi SOLD\n2. Stok menjadi 0\n3. Barang tidak bisa dibeli lagi')) {
        return;
    }

    showNotification('Memproses status terjual...', 'info');

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'markProductSold',
                product_id: currentProduct.id
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.message || 'Gagal mengubah status');

        showNotification('✅ ' + data.message, 'success');

        // Reload page to reflect changes
        setTimeout(() => window.location.reload(), 1500);

    } catch (err) {
        logger.error('Error marking as sold:', err);
        showNotification(err.message, 'error');
    }
};

// --- Interaction Handlers ---

window.handleContact = () => {
    if (!currentProduct || !currentProduct.profiles) return;
    const phone = currentProduct.profiles.whatsapp;

    if (!phone) {
        // Mailbox fallback
        handleContactMailbox();
        return;
    }

    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.substring(1);
    if (!cleanPhone.startsWith('62')) cleanPhone = '62' + cleanPhone;

    const message = `Halo ${currentProduct.profiles.username}, saya tertarik dengan "${currentProduct.name}" di JDK Box. Masih ada?`;
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
};

function handleContactMailbox() {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu untuk kirim pesan!', 'error');
        return;
    }
    window.location.href = `/profile?id=${currentProduct.seller_id}&action=message`;
}

window.handleShare = async () => {
    if (navigator.share) {
        try {
            await navigator.share({
                title: currentProduct.name,
                text: `Cek barang ini di JDK Box: ${currentProduct.name}`,
                url: window.location.href
            });
        } catch (err) {
            logger.log('Share canceled');
        }
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(window.location.href);
        showNotification('Link disalin ke clipboard! 📋');
    }
};

window.handleRedeem = async () => {
    // Re-use logic from marketplace.js (simplified)
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu untuk tukar poin! 🔒', 'error');
        return;
    }

    if (!confirm(`Tukar ${currentProduct.redeem_points} Poin untuk "${currentProduct.name}"?`)) return;

    showNotification('Memproses penukaran...', 'info');

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'redeemProduct', product_id: currentProduct.id }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.message);

        showNotification(`🎉 ${data.message}`, 'success');
        setTimeout(() => window.location.reload(), 2000); // Reload to update status

    } catch (err) {
        showNotification(err.message, 'error');
    }
};

window.handleWishlist = async () => {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu untuk wishlist! ❤️', 'error');
        return;
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'toggleWishlist', product_id: currentProduct.id }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Gagal mengubah wishlist');

        showNotification(data.message || (data.wishlisted ? 'Disimpan ke wishlist ❤️' : 'Dihapus dari wishlist 💔'));
        updateWishlistIcon(data.wishlisted);
    } catch (err) {
        showNotification(err.message || 'Gagal mengubah wishlist', 'error');
    }
};

window.handleRekber = async () => {
    const user = getCurrentUser();
    if (!user) {
        showNotification('Login dulu untuk rekber! 🔒', 'error');
        return;
    }

    if (!currentProduct) return;

    if (currentProduct.seller_id === user.id) {
        showNotification('Tidak bisa beli barang sendiri! 😅', 'error');
        return;
    }

    const { level } = calculateUserLevel(user.xp || 0);
    if (level === 1 && !user.whatsapp) {
        const { data: profile } = await sbClient.from('profiles').select('whatsapp').eq('id', user.id).single();
        if (!profile?.whatsapp) {
            showNotification('Buyer Level 1 wajib isi nomor WhatsApp di profil! 📱', 'error');
            setTimeout(() => window.location.href = '/profile', 1500);
            return;
        }
    }

    if (!confirm(`Konfirmasi: Ingin membeli "${currentProduct.name}" via REKBER JDK?`)) return;

    const btn = document.querySelector('[onclick="window.handleRekber()"]');
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
        setTimeout(() => window.location.href = `/rekber?id=${data.transaction_id}`, 1000);

    } catch (err) {
        logger.error('Rekber initiation error:', err);
        showNotification('Gagal membuat rekber: ' + err.message, 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined text-lg">verified_user</span> REKBER';
        }
    }
};

async function checkWishlistStatus(productId) {
    const user = getCurrentUser();
    if (!user) return;

    const { data } = await sbClient.from('wishlist').select('id').eq('user_id', user.id).eq('product_id', productId).single();
    updateWishlistIcon(!!data);
}

function updateWishlistIcon(active) {
    const icons = document.querySelectorAll('#wishlistIconDesktop, #wishlistIconMobile');
    icons.forEach(icon => {
        icon.textContent = active ? 'favorite' : 'favorite_border';
        icon.classList.toggle('text-red-500', active);
    });
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}
