import { supabase } from '../core/supabase.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let cart = [];
let products = [];
let selectedCustomer = null;
let activeCategory = 'ALL';
let searchQuery = '';
let currentUserId = null;
let html5QrCode = null;
let isCameraActive = false;
let isAdminUser = false;

// DOM Elements
const barcodeInput = document.getElementById('barcodeInput');
const searchProductInput = document.getElementById('searchProductInput');
const productGrid = document.getElementById('productGrid');
const memberSearch = document.getElementById('memberSearch');
const memberSearchResults = document.getElementById('memberSearchResults');
const activeCustomerBadge = document.getElementById('activeCustomerBadge');
const custName = document.getElementById('custName');
const custPoints = document.getElementById('custPoints');
const clearCustomerBtn = document.getElementById('clearCustomerBtn');
const cartList = document.getElementById('cartList');
const cartSubtotal = document.getElementById('cartSubtotal');
const cartTotal = document.getElementById('cartTotal');
const checkoutBtn = document.getElementById('checkoutBtn');
const receiptModal = document.getElementById('receiptModal');
const toggleCameraBtn = document.getElementById('toggleCameraBtn');
const closeCameraBtn = document.getElementById('closeCameraBtn');
const cameraScannerArea = document.getElementById('cameraScannerArea');
const receiptTime = document.getElementById('receiptTime');
const receiptContent = document.getElementById('receiptContent');
const printReceiptBtn = document.getElementById('printReceiptBtn');
const closeReceiptBtn = document.getElementById('closeReceiptBtn');

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Run core JDK layout & authorization check
    const perms = await initializeAdminLayout();
    if (!perms) return;

    // 2. Fetch logged in cashier ID & Profile
    const { data: { user } } = await supabase.auth.getUser();
    currentUserId = user?.id;

    if (currentUserId) {
        try {
            const { data: profile } = await supabase
                .from('profiles')
                .select('user_level')
                .eq('id', currentUserId)
                .single();
            isAdminUser = perms?.is_super_admin || (profile?.user_level === 'Admin');
        } catch (err) {
            console.error('Error fetching cashier profile:', err);
            isAdminUser = perms?.is_super_admin || false;
        }
    }

    // 3. Load Products catalog
    await fetchProducts();

    // 4. Setup listeners
    setupEventListeners();
});

// Fetch catalog items & active stock
async function fetchProducts() {
    try {
        const { data, error } = await supabase
            .from('pm_products')
            .select(`
                id, name, category, game, card_number, rarity, barcode,
                pm_inventory_lots (id, quantity_remaining, selling_price)
            `);

        if (error) throw error;

        // Process products structure
        products = data.map(p => {
            const activeLots = p.pm_inventory_lots || [];
            // Total remaining stock across all lots
            const totalStock = activeLots.reduce((acc, lot) => acc + lot.quantity_remaining, 0);
            // Get selling price from the oldest active lot or fallback
            const activeLot = activeLots.find(l => l.quantity_remaining > 0);
            const price = activeLot ? activeLot.selling_price : 0;

            return {
                id: p.id,
                name: p.name,
                category: p.category,
                game: p.game,
                card_number: p.card_number,
                rarity: p.rarity,
                barcode: p.barcode,
                stock: totalStock,
                price: price
            };
        });

        renderProducts();
    } catch (err) {
        console.error('Error loading products:', err);
        productGrid.innerHTML = `<div class="col-span-full text-center p-8 text-red-500 font-medium">Gagal memuat produk. Hubungi Admin.</div>`;
    }
}

// Render product list on grid
function renderProducts() {
    const filtered = products.filter(p => {
        const matchesCategory = activeCategory === 'ALL' || p.category === activeCategory;
        const matchesSearch = searchQuery === '' || 
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.card_number && p.card_number.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesCategory && matchesSearch;
    });

    if (filtered.length === 0) {
        productGrid.innerHTML = `<div class="col-span-full text-center p-12 text-slate-400 font-medium">Tidak ada produk ditemukan</div>`;
        return;
    }

    productGrid.innerHTML = filtered.map(p => {
        const formattedPrice = formatRupiah(p.price);
        const hasStock = p.stock > 0;
        const cardClass = hasStock 
            ? 'bg-white hover:border-blue-400 hover:shadow-md cursor-pointer' 
            : 'bg-slate-50 opacity-60 cursor-not-allowed';

        return `
            <div class="product-card border border-slate-200 rounded-xl p-4 transition-all flex flex-col justify-between ${cardClass}" 
                 onclick="${hasStock ? `addToCart('${p.id}')` : ''}">
                <div class="space-y-1">
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 uppercase tracking-wider">${p.category}</span>
                    <h3 class="text-sm font-semibold text-slate-800 line-clamp-2 mt-1.5">${p.name}</h3>
                    ${p.card_number ? `<p class="text-xs text-slate-400 font-mono">${p.card_number} | ${p.rarity || '-'}</p>` : ''}
                </div>
                <div class="flex items-center justify-between mt-4">
                    <span class="text-sm font-bold text-blue-600">${formattedPrice}</span>
                    <span class="text-xs font-bold ${hasStock ? 'text-emerald-600' : 'text-red-500'}">
                        ${hasStock ? `Stok: ${p.stock}` : 'Habis'}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

// Helper to format currency
function formatRupiah(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(amount);
}

// Add product to shopping cart
window.addToCart = function (productId) {
    const product = products.find(p => p.id === productId);
    if (!product || product.stock <= 0) return;

    const existing = cart.find(item => item.id === productId);
    if (existing) {
        if (existing.qty >= product.stock) {
            alert('Jumlah item melebihi sisa stok yang tersedia.');
            return;
        }
        existing.qty += 1;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            stock: product.stock,
            qty: 1
        });
    }

    renderCart();
};

// Render Cart items list
function renderCart() {
    if (cart.length === 0) {
        cartList.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                <span class="material-symbols-outlined text-[48px] mb-2">shopping_cart</span>
                <p class="text-sm font-medium">Keranjang belanja kosong</p>
            </div>
        `;
        cartSubtotal.innerText = 'Rp 0';
        cartTotal.innerText = 'Rp 0';
        return;
    }

    cartList.innerHTML = cart.map(item => {
        const formattedItemTotal = formatRupiah(item.price * item.qty);
        let priceHtml = `<p class="text-[10px] text-slate-500">${formatRupiah(item.price)} x ${item.qty}</p>`;
        
        if (isAdminUser) {
            priceHtml = `
                <div class="flex items-center gap-1 mt-1">
                    <span class="text-[10px] text-slate-400">Rp</span>
                    <input type="number" 
                           value="${item.price}" 
                           onchange="updateCartItemPrice('${item.id}', this.value)" 
                           class="w-20 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500" 
                           title="Ubah harga satuan" />
                    <span class="text-[10px] text-slate-500">x ${item.qty}</span>
                </div>
            `;
        }

        return `
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <div class="flex-1 min-w-0 pr-4">
                    <h4 class="text-xs font-bold text-slate-800 truncate">${item.name}</h4>
                    ${priceHtml}
                </div>
                <div class="flex items-center gap-3">
                    <!-- Qty Controls -->
                    <div class="flex items-center bg-slate-100 rounded-lg p-0.5">
                        <button onclick="updateCartQuantity('${item.id}', -1)" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white text-slate-600 transition-colors">
                            <span class="material-symbols-outlined text-sm">remove</span>
                        </button>
                        <span class="w-8 text-center text-xs font-bold text-slate-700">${item.qty}</span>
                        <button onclick="updateCartQuantity('${item.id}', 1)" class="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white text-slate-600 transition-colors">
                            <span class="material-symbols-outlined text-sm">add</span>
                        </button>
                    </div>
                    <!-- Item Total -->
                    <span class="text-xs font-bold text-slate-800 w-20 text-right">${formattedItemTotal}</span>
                </div>
            </div>
        `;
    }).join('');

    const subtotal = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
    cartSubtotal.innerText = formatRupiah(subtotal);
    cartTotal.innerText = formatRupiah(subtotal);
}

// Update item quantity in cart
window.updateCartQuantity = function (productId, delta) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;

    const newQty = item.qty + delta;
    if (newQty <= 0) {
        // Remove item from cart
        cart = cart.filter(i => i.id !== productId);
    } else {
        if (newQty > item.stock) {
            alert('Jumlah item melebihi sisa stok yang tersedia.');
            return;
        }
        item.qty = newQty;
    }
    renderCart();
};

// Event Listeners setup
function setupEventListeners() {
    // Barcode reader enter event
    barcodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const code = barcodeInput.value.trim();
            if (code !== '') {
                processBarcode(code);
            }
            barcodeInput.value = '';
        }
    });

    // Toggle camera scanner view
    toggleCameraBtn.addEventListener('click', () => {
        if (isCameraActive) {
            stopCameraScanner();
        } else {
            startCameraScanner();
        }
    });

    // Close camera scanner view
    closeCameraBtn.addEventListener('click', stopCameraScanner);

    // Search input typing event
    searchProductInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderProducts();
    });

    // Category filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active', 'bg-slate-800', 'text-white'));
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.add('bg-white', 'text-slate-600', 'border-slate-200'));
            
            tab.classList.remove('bg-white', 'text-slate-600', 'border-slate-200');
            tab.classList.add('active', 'bg-slate-800', 'text-white');
            
            activeCategory = tab.dataset.category;
            renderProducts();
        });
    });

    // Member Search typing query
    memberSearch.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        if (query.length < 2) {
            memberSearchResults.classList.add('hidden');
            return;
        }

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, username, current_points, user_level')
                .ilike('username', `%${query}%`)
                .limit(5);

            if (error) throw error;

            if (data.length === 0) {
                memberSearchResults.innerHTML = `<div class="p-3 text-xs text-slate-400">Tidak ada member ditemukan</div>`;
            } else {
                memberSearchResults.innerHTML = data.map(m => `
                    <div class="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-100 flex items-center justify-between text-xs"
                         onclick="selectCustomer('${m.id}', '${m.username}', ${m.current_points || 0}, '${m.user_level}')">
                        <span class="font-bold text-slate-800">${m.username}</span>
                        <span class="text-slate-500 font-semibold bg-slate-100 px-2 py-0.5 rounded-full">${m.user_level}</span>
                    </div>
                `).join('');
            }
            memberSearchResults.classList.remove('hidden');
        } catch (err) {
            console.error('Error searching member:', err);
        }
    });

    // Pay Method Toggle Buttons
    document.querySelectorAll('.pay-method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pay-method-btn').forEach(b => {
                b.classList.remove('active', 'border-blue-600', 'bg-blue-50/50', 'text-blue-700');
                b.classList.add('border-slate-200', 'text-slate-600');
            });
            btn.classList.remove('border-slate-200', 'text-slate-600');
            btn.classList.add('active', 'border-blue-600', 'bg-blue-50/50', 'text-blue-700');
        });
    });

    // Checkout execution
    checkoutBtn.addEventListener('click', handleCheckout);

    // Close Receipt modal
    closeReceiptBtn.addEventListener('click', () => {
        receiptModal.classList.add('hidden');
    });

    // Print Receipt logic (mock)
    printReceiptBtn.addEventListener('click', () => {
        window.print();
    });

    // Clear Customer handler
    clearCustomerBtn.addEventListener('click', () => {
        selectedCustomer = null;
        memberSearch.value = '';
        activeCustomerBadge.classList.add('hidden');
        clearCustomerBtn.classList.add('hidden');
        renderCart();
    });
}

// Process Barcode scan
function processBarcode(code) {
    const product = products.find(p => p.barcode === code);
    if (product) {
        addToCart(product.id);
    } else {
        alert(`Produk dengan barcode "${code}" tidak ditemukan dalam katalog.`);
    }
}

// Select customer from search drop list
window.selectCustomer = function (id, name, points, level) {
    selectedCustomer = { id, name, points, level };
    memberSearch.value = name;
    memberSearchResults.classList.add('hidden');
    
    // Update Badge details
    custName.innerText = `@${name}`;
    custPoints.innerText = `Poin: ${points} | Level: ${level}`;
    
    activeCustomerBadge.classList.remove('hidden');
    clearCustomerBtn.classList.remove('hidden');
};

// Handle Checkout submit
async function handleCheckout() {
    if (cart.length === 0) {
        alert('Keranjang belanja masih kosong.');
        return;
    }

    const payMethodBtn = document.querySelector('.pay-method-btn.active');
    const paymentMethod = payMethodBtn ? payMethodBtn.dataset.method : 'CASH';
    const subtotal = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);

    checkoutBtn.disabled = true;
    checkoutBtn.innerText = 'MEMPROSES...';

    try {
        // Run POS sale RPC
        const { data, error } = await supabase.rpc('process_pos_sale', {
            p_cashier_id: currentUserId,
            p_customer_id: selectedCustomer ? selectedCustomer.id : null,
            p_total_amount: subtotal,
            p_payment_method: paymentMethod,
            p_items: cart.map(item => ({
                product_id: item.id,
                quantity: item.qty,
                unit_price: item.price
            }))
        });

        if (error) throw error;

        // Show receipt details
        showReceipt(data, paymentMethod, subtotal);
        
        // Reset POS State
        cart = [];
        selectedCustomer = null;
        memberSearch.value = '';
        activeCustomerBadge.classList.add('hidden');
        clearCustomerBtn.classList.add('hidden');
        renderCart();
        
        // Reload products stock count
        await fetchProducts();
    } catch (err) {
        console.error('Checkout error:', err);
        alert(`Checkout gagal: ${err.message || err}`);
    } finally {
        checkoutBtn.disabled = false;
        checkoutBtn.innerHTML = `<span class="material-symbols-outlined">check_circle</span> PROSES TRANSAKSI`;
    }
}

// Display receipt modal popup
function showReceipt(data, method, total) {
    const timeStr = new Date().toLocaleString('id-ID');
    receiptTime.innerText = timeStr;

    let itemsHtml = cart.map(item => `
        <div class="flex justify-between">
            <span>${item.name} (${item.qty}x)</span>
            <span>${formatRupiah(item.price * item.qty)}</span>
        </div>
    `).join('');

    receiptContent.innerHTML = `
        <div class="text-center space-y-1 mb-4">
            <h4 class="font-bold text-slate-800">POKEMARET STORE</h4>
            <p class="text-[10px] text-slate-400">Physical Card Game & TCG Shop</p>
        </div>
        <hr class="border-dashed border-slate-200 my-2">
        <div class="space-y-1">
            <div class="flex justify-between">
                <span>Ref ID:</span>
                <span class="font-bold truncate w-32 text-right">${data.sale_id.substring(0, 8)}...</span>
            </div>
            <div class="flex justify-between">
                <span>Metode:</span>
                <span>${method}</span>
            </div>
            ${selectedCustomer ? `
            <div class="flex justify-between">
                <span>Member:</span>
                <span>@${selectedCustomer.name}</span>
            </div>
            ` : ''}
        </div>
        <hr class="border-dashed border-slate-200 my-2">
        <div class="space-y-1">
            ${itemsHtml}
        </div>
        <hr class="border-dashed border-slate-200 my-2">
        <div class="space-y-1 font-bold">
            <div class="flex justify-between text-slate-800">
                <span>TOTAL:</span>
                <span>${formatRupiah(total)}</span>
            </div>
            ${data.points_awarded > 0 ? `
            <div class="flex justify-between text-emerald-600 text-[10px]">
                <span>POIN DIDAPAT:</span>
                <span>+${data.points_awarded} Poin</span>
            </div>
            ` : ''}
        </div>
        <hr class="border-dashed border-slate-200 my-4">
        <p class="text-center text-[10px] text-slate-400 italic">Terima kasih atas kunjungan Anda!</p>
    `;

    receiptModal.classList.remove('hidden');
}

// Start Camera-based Barcode Scanner
window.startCameraScanner = function () {
    if (!window.Html5Qrcode) {
        alert('Kamera library belum siap!');
        return;
    }

    cameraScannerArea.classList.remove('hidden');

    html5QrCode = new window.Html5Qrcode("qr-reader-pos");
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
            // Success: barcode detected!
            processBarcode(decodedText);
            stopCameraScanner();
        },
        () => {} // Quietly ignore scanning errors
    ).then(() => {
        isCameraActive = true;
    }).catch(err => {
        console.error('Scanner error:', err);
        alert('Gagal mengakses kamera: ' + err);
        stopCameraScanner();
    });
};

// Stop Camera-based Barcode Scanner
window.stopCameraScanner = function () {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode = null;
            isCameraActive = false;
            cameraScannerArea.classList.add('hidden');
        }).catch(err => {
            console.error(err);
            cameraScannerArea.classList.add('hidden');
            html5QrCode = null;
            isCameraActive = false;
        });
    } else {
        cameraScannerArea.classList.add('hidden');
        isCameraActive = false;
    }
};

// Update individual cart item price (for Admin/Manager override)
window.updateCartItemPrice = function (productId, newPrice) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;

    const parsedPrice = parseInt(newPrice);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
        alert('Harga harus berupa angka dan bernilai positif.');
        renderCart(); // Re-render to restore previous valid price
        return;
    }

    item.price = parsedPrice;
    renderCart();
};
