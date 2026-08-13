import { logger } from '../core/logger.js';
/**
 * Admin Marketplace Management Logic
 * JDK Entertainment
 */
import { sbClient } from '../core/supabase.js';
import { showNotification, formatCurrency } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let allProducts = [];
let lightboxGallery = [];
let lightboxIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
    await initializeAdminLayout();

    // Initial load
    window.loadProducts();
});

// State
let currentStatus = 'pending';
let currentCategory = 'all';
let currentType = 'all';

// --- GLOBAL FUNCTIONS (attached to window for onclick) ---

window.loadProducts = async function () {
    try {
        const { data, error } = await sbClient
            .from('products')
            .select(`
                *,
                profiles:seller_id (username, whatsapp)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        allProducts = data;
        renderProducts();
    } catch (err) {
        logger.error('Error loading products:', err);
        showNotification('Gagal mengambil data product: ' + err.message, 'error');
    }
};

function renderProducts() {
    const tableBody = document.getElementById('marketplaceTableBody');
    const cardView = document.getElementById('marketplaceCardView');

    if (!tableBody || !cardView) return;

    let filtered = allProducts;

    // 1. Filter by Status
    if (currentStatus !== 'all') {
        filtered = filtered.filter(p => p.status === currentStatus);
    }

    // 2. Filter by Category
    if (currentCategory !== 'all') {
        filtered = filtered.filter(p => p.category === currentCategory);
    }

    // 3. Filter by Type
    if (currentType !== 'all') {
        if (currentType === 'idr') {
            filtered = filtered.filter(p => !p.is_redeemable);
        } else if (currentType === 'points') {
            filtered = filtered.filter(p => p.is_redeemable);
        }
    }

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-500 font-body">No products found.</td></tr>`;
        cardView.innerHTML = '<div class="text-center py-8 text-slate-500 font-body">No products found.</div>';
        return;
    }

    // Render Table
    tableBody.innerHTML = filtered.map(p => {
        const { label, style } = getStatusBadge(p.status);
        const sellerName = p.profiles?.username || 'Unknown';

        const typeBadge = p.is_redeemable
            ? '<span class="text-indigo-600 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[14px]">stars</span> REDEEM</span>'
            : '<span class="text-emerald-600 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[14px]">toll</span> IDR</span>';

        const priceDisplay = p.is_redeemable
            ? `<span class="text-indigo-600 font-bold">${(p.redeem_points || 0).toLocaleString()} PTS</span>`
            : `<span class="text-emerald-600 font-bold">${formatCurrency(p.price)}</span>`;

        const hasGallery = p.gallery && p.gallery.length > 1;

        return `
            <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 cursor-pointer group" onclick="openModal('${p.id}')">
                <td class="px-4 py-3">
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${style}">
                        ${label}
                    </span>
                </td>
                <td class="px-4 py-3">${typeBadge}</td>
                <td class="px-4 py-3 text-center">
                    <div class="relative w-12 h-12 mx-auto">
                        <img src="${p.image_url || 'images/placeholder-product.svg'}" 
                             class="w-12 h-12 object-cover rounded-lg border border-slate-200 shadow-sm">
                        ${hasGallery ? `<span class="absolute -top-1 -right-1 bg-slate-800 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center border border-white font-bold">${p.gallery.length}</span>` : ''}
                    </div>
                </td>
                <td class="px-4 py-3">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-800 group-hover:text-blue-600 transition-colors line-clamp-1 truncate">${p.name}</span>
                        <span class="text-[10px] font-medium text-slate-400 uppercase tracking-tight">${p.category || '-'}</span>
                    </div>
                </td>
                <td class="px-4 py-3 text-[11px] text-slate-500 font-medium">${sellerName.toUpperCase()}</td>
                <td class="px-4 py-3 text-sm">${priceDisplay}</td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-1 justify-center" onclick="event.stopPropagation()">
                        ${p.status === 'pending' ? `
                            <button onclick="approveProduct('${p.id}')" 
                                class="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Approve">
                                <span class="material-symbols-outlined text-[20px]">check_circle</span>
                            </button>
                        ` : ''}
                        <button onclick="openModal('${p.id}')" 
                            class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Review">
                            <span class="material-symbols-outlined text-[20px]">visibility</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Render Cards (Mobile)
    cardView.innerHTML = filtered.map(p => {
        const sellerName = p.profiles?.username || 'Unknown';
        const { label, style } = getStatusBadge(p.status);

        const priceDisplay = p.is_redeemable
            ? `<span class="text-indigo-600 font-black">${(p.redeem_points || 0).toLocaleString()} PTS</span>`
            : `<span class="text-emerald-600 font-black">${formatCurrency(p.price)}</span>`;

        return `
            <div class="bg-white rounded-2xl overflow-hidden shadow-sm mb-4" onclick="openModal('${p.id}')">
                <div class="p-4 flex gap-4 items-center">
                    <div class="relative flex-shrink-0">
                        <img src="${p.image_url || 'images/placeholder-product.svg'}" 
                             class="w-20 h-20 object-cover rounded-xl border border-slate-100">
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex justify-between items-start mb-2">
                            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${style}">
                                ${label}
                            </span>
                            <span class="text-[10px] text-slate-400 font-bold uppercase tracking-tight">${p.category || '-'}</span>
                        </div>
                        <h4 class="font-bold truncate text-sm text-slate-800 mb-1">${p.name}</h4>
                        <p class="text-[11px] text-slate-500 font-medium uppercase mb-2">${sellerName}</p>
                        <div class="flex items-center justify-between">
                            ${priceDisplay}
                            <span class="material-symbols-outlined text-slate-300">chevron_right</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getStatusBadge(status) {
    switch (status) {
        case 'pending': return { label: 'PENDING', style: 'bg-amber-100 text-amber-700' };
        case 'available': return { label: 'ACTIVE', style: 'bg-emerald-100 text-emerald-700' };
        case 'sold': return { label: 'SOLD', style: 'bg-blue-100 text-blue-700' };
        case 'rejected': return { label: 'REJECTED', style: 'bg-rose-100 text-rose-700' };
        default: return { label: status.toUpperCase(), style: 'bg-slate-200 text-slate-600' };
    }
}

window.filterStatus = function (status) {
    currentStatus = status;

    // Update button styles
    ['Pending', 'Available', 'Sold', 'All'].forEach(s => {
        const btn = document.getElementById(`btnFilter${s}`);
        if (btn) {
            if (s.toLowerCase() === status) {
                btn.classList.replace('btn-secondary', 'btn-primary');
                btn.classList.add('shadow-[2px_2px_0_#000]');
            } else {
                btn.classList.replace('btn-primary', 'btn-secondary');
                btn.classList.remove('shadow-[2px_2px_0_#000]');
            }
        }
    });

    renderProducts();
};

window.applyFilters = function () {
    const catEl = document.getElementById('filterCategory');
    const typeEl = document.getElementById('filterType');

    if (catEl) currentCategory = catEl.value;
    if (typeEl) currentType = typeEl.value;

    renderProducts();
};

window.toggleAdminPriceFields = function () {
    const isRedeem = document.getElementById('productIsRedeemable').value === 'true';
    const priceCont = document.getElementById('adminPriceContainer');
    const pointsCont = document.getElementById('adminPointsContainer');

    if (isRedeem) {
        priceCont.classList.add('hidden');
        pointsCont.classList.remove('hidden');
    } else {
        priceCont.classList.remove('hidden');
        pointsCont.classList.add('hidden');
    }
}

window.toggleStickerGuide = function () {
    const category = document.getElementById('productCategory').value;
    const guide = document.getElementById('stickerAdminGuide');
    if (category === 'stickers') {
        guide.classList.remove('hidden');
    } else {
        guide.classList.add('hidden');
    }
}

window.toggleStockInput = function () {
    const isUnlimited = document.getElementById('productIsUnlimited').checked;
    const stockInput = document.getElementById('productStock');
    if (isUnlimited) {
        stockInput.disabled = true;
        stockInput.classList.add('opacity-50', 'bg-gray-100');
        stockInput.value = '999';
    } else {
        stockInput.disabled = false;
        stockInput.classList.remove('opacity-50', 'bg-gray-100');
    }
}

window.openModal = function (id) {
    const p = allProducts.find(item => item.id === id);
    if (!p) return;

    document.getElementById('productId').value = p.id;
    document.getElementById('productName').value = p.name;
    document.getElementById('productPrice').value = (p.price || 0).toLocaleString('id-ID');
    document.getElementById('productRedeemPoints').value = p.redeem_points || 0;
    document.getElementById('productIsRedeemable').value = String(p.is_redeemable);
    document.getElementById('productCondition').value = p.condition;
    document.getElementById('productDescription').value = p.description || '';
    document.getElementById('productCategory').value = p.category;
    document.getElementById('productStatus').value = p.status || 'pending';
    document.getElementById('modalPreview').src = p.image_url || 'images/placeholder-product.svg';

    // Set up lightbox gallery
    lightboxGallery = p.gallery && p.gallery.length > 0 ? [...p.gallery] : [p.image_url];
    const previewEl = document.getElementById('modalPreview');
    previewEl.style.cursor = 'zoom-in';
    previewEl.onclick = () => {
        const currentSrc = previewEl.src;
        const idx = lightboxGallery.findIndex(u => currentSrc.includes(u));
        openLightbox(idx >= 0 ? idx : 0);
    };

    // Stock management
    document.getElementById('productStock').value = p.stock || 0;
    document.getElementById('productIsUnlimited').checked = p.is_unlimited || false;

    // Trigger UI updates
    window.toggleAdminPriceFields();
    window.toggleStickerGuide();
    window.toggleStockInput();

    // Render Gallery Thumbnails
    const thumbCont = document.getElementById('adminGalleryThumbnails');
    if (thumbCont) {
        thumbCont.innerHTML = '';
        const gallery = p.gallery || [p.image_url];
        gallery.forEach(url => {
            const img = document.createElement('img');
            img.src = url;
            img.className = 'w-10 h-10 object-cover rounded-lg border-2 border-black/5 cursor-pointer hover:border-black transition-all';
            img.onclick = () => document.getElementById('modalPreview').src = url;
            thumbCont.appendChild(img);
        });
    }

    // Display seller info
    const sellerUsername = p.profiles?.username || 'Unknown';
    const sellerPhone = p.profiles?.whatsapp || '-';
    document.getElementById('sellerUsername').innerHTML = `
        <span class="text-black">${sellerUsername.toUpperCase()}</span>
        ${sellerPhone !== '-' ? `<a href="https://wa.me/${sellerPhone.replace(/[^0-9]/g, '')}" target="_blank" class="text-green-600 flex items-center gap-1 group">
            <span class="material-symbols-outlined text-xs">call</span> ${sellerPhone}
            <span class="material-symbols-outlined text-[10px] opacity-0 group-hover:opacity-100 transition-all">open_in_new</span>
        </a>` : '<span class="text-black/30 italic">No WhatsApp provided</span>'}
    `;

    // Show/hide approve & reject button
    const btnApprove = document.getElementById('btnApprove');
    const btnReject = document.getElementById('btnReject');

    if (p.status === 'pending') {
        btnApprove.classList.remove('hidden');
        if (btnReject) btnReject.classList.remove('hidden');
    } else {
        btnApprove.classList.add('hidden');
        if (btnReject) btnReject.classList.add('hidden');
    }

    const modal = document.getElementById('productModal');
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100');
};

window.closeModal = function () {
    const modal = document.getElementById('productModal');
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.classList.remove('opacity-100');
    // Reverse scale animation
    const inner = modal.querySelector('div');
    if (inner) inner.classList.add('scale-95');
    if (inner) inner.classList.remove('scale-100');
};

// --- Image Lightbox ---
function openLightbox(index) {
    lightboxIndex = index;
    const lb = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImage');
    img.src = lightboxGallery[lightboxIndex];
    lb.classList.remove('opacity-0', 'pointer-events-none');
    lb.classList.add('opacity-100');
    setTimeout(() => img.classList.replace('scale-95', 'scale-100'), 20);
    updateLightboxUI();
}

window.closeLightbox = function () {
    const lb = document.getElementById('imageLightbox');
    const img = document.getElementById('lightboxImage');
    img.classList.replace('scale-100', 'scale-95');
    lb.classList.add('opacity-0', 'pointer-events-none');
    lb.classList.remove('opacity-100');
};

window.navigateLightbox = function (dir) {
    lightboxIndex = (lightboxIndex + dir + lightboxGallery.length) % lightboxGallery.length;
    const img = document.getElementById('lightboxImage');
    img.src = lightboxGallery[lightboxIndex];
    updateLightboxUI();
};

function updateLightboxUI() {
    const counter = document.getElementById('lightboxCounter');
    const prevBtn = document.getElementById('lightboxPrev');
    const nextBtn = document.getElementById('lightboxNext');
    if (lightboxGallery.length <= 1) {
        counter.classList.add('hidden');
        prevBtn.classList.add('hidden');
        nextBtn.classList.add('hidden');
    } else {
        counter.classList.remove('hidden');
        prevBtn.classList.remove('hidden');
        nextBtn.classList.remove('hidden');
        counter.textContent = `${lightboxIndex + 1} / ${lightboxGallery.length}`;
    }
}

// Keyboard support for lightbox
document.addEventListener('keydown', (e) => {
    const lb = document.getElementById('imageLightbox');
    if (!lb || lb.classList.contains('pointer-events-none')) return;
    if (e.key === 'Escape') window.closeLightbox();
    if (e.key === 'ArrowLeft') window.navigateLightbox(-1);
    if (e.key === 'ArrowRight') window.navigateLightbox(1);
});

const REJECT_REASONS = [
    "Foto tidak jelas / buram 📷",
    "Deskripsi kurang lengkap 📝",
    "Harga tidak wajar 💸",
    "Barang dilarang / ilegal 🚫",
    "Kategori salah 🏷️",
    "Lainnya (Tulis sendiri) ✍️"
];

window.rejectProduct = async function (id) {
    const productId = id || document.getElementById('productId').value;
    if (!productId) return;

    let reason = prompt("Alasan penolakan:\n" + REJECT_REASONS.map((r, i) => `${i + 1}. ${r}`).join('\n') + "\n\nKetik nomor atau alasan manual:");
    if (!reason) return;

    const reasonIndex = parseInt(reason) - 1;
    if (!isNaN(reasonIndex) && REJECT_REASONS[reasonIndex]) {
        reason = REJECT_REASONS[reasonIndex];
    }

    try {
        const { error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageMarketplace',
                sub_action: 'reject',
                product_id: productId,
                data: { reason }
            }
        });

        if (error) throw error;

        showNotification('Product rejected & seller notified. 🚫', 'success');
        window.closeModal();
        window.loadProducts();
    } catch (err) {
        showNotification('Gagal menolak: ' + err.message, 'error');
    }
};

window.approveProduct = async function (id) {
    const productId = id || document.getElementById('productId').value;
    if (!productId) return;

    try {
        const { error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageMarketplace',
                sub_action: 'approve',
                product_id: productId
            }
        });

        if (error) throw error;

        showNotification('Product approved! 🚀', 'success');
        window.closeModal();
        window.loadProducts();
    } catch (err) {
        showNotification('Gagal approve: ' + err.message, 'error');
    }
};

window.saveProduct = async function () {
    const id = document.getElementById('productId').value;
    const name = document.getElementById('productName').value;
    const isRedeemable = document.getElementById('productIsRedeemable').value === 'true';
    const price = parseInt(document.getElementById('productPrice').value.replace(/\./g, '')) || 0;
    const redeemPoints = parseInt(document.getElementById('productRedeemPoints').value) || 0;
    const condition = document.getElementById('productCondition').value;
    const description = document.getElementById('productDescription').value;
    const category = document.getElementById('productCategory').value;
    const status = document.getElementById('productStatus').value;
    const stock = parseInt(document.getElementById('productStock').value) || 0;
    const isUnlimited = document.getElementById('productIsUnlimited').checked;

    try {
        const { error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageMarketplace',
                sub_action: 'update',
                product_id: id,
                data: {
                    name,
                    price: isRedeemable ? 0 : price,
                    is_redeemable: isRedeemable,
                    redeem_points: isRedeemable ? redeemPoints : 0,
                    condition,
                    description,
                    category,
                    status,
                    stock,
                    is_unlimited: isUnlimited
                }
            }
        });

        if (error) throw error;

        showNotification('Product saved! ✅', 'success');
        window.closeModal();
        window.loadProducts();
    } catch (err) {
        showNotification('Gagal menyimpan: ' + err.message, 'error');
    }
};

window.handleDelete = async function () {
    const id = document.getElementById('productId').value;
    if (!confirm('Yakin ingin menghapus barang ini selamanya?')) return;

    try {
        const { error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageMarketplace',
                sub_action: 'delete',
                product_id: id
            }
        });

        if (error) throw error;

        showNotification('Product deleted. 🗑️', 'success');
        window.closeModal();
        window.loadProducts();
    } catch (err) {
        showNotification('Gagal menghapus: ' + err.message, 'error');
    }
};
