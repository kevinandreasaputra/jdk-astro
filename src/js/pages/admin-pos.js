import { supabase } from '../core/supabase.js';
import { initializeAdminLayout } from '../core/admin-layout.js';
import { showNotification } from '../core/utils.js';

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
        const hasStock = p.stock > 0;
        return matchesCategory && matchesSearch && hasStock;
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
    if (!product) return;

    if (product.stock <= 0) {
        showNotification(`⚠️ Stok kartu "${product.name}" kosong! Silakan restock terlebih dahulu.`, "warning");
        return;
    }

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
        updateMobileCartUI();
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

        // Generate Cardtell link
        const origProd = products.find(p => p.id === item.id);
        let cardtellLinkHtml = '';
        if (origProd && origProd.game === 'POKEMON' && origProd.card_number) {
            const setCode = origProd.barcode ? origProd.barcode.split('-')[0].toUpperCase() : '';
            const setNames = {
                'SV8A': 'Festival Terastal ex',
                'SV7S': 'Kilat Rasi',
                'SV6A': 'Impian Mega ex',
                'SV2A': 'Kartu Pokémon 151',
                'SV3': 'Kilau Hitam',
                'DET1': 'det1'
            };
            const setName = setNames[setCode] || setCode;
            const searchKeyword = `${origProd.name} "${setName}" "${origProd.card_number}"`;
            const cardtellUrl = `https://cardtell.id/search?q=${encodeURIComponent(searchKeyword)}`;
            cardtellLinkHtml = `
                <div class="mt-1">
                    <a href="${cardtellUrl}" target="_blank" class="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 hover:text-indigo-800 font-bold hover:underline" title="Cek harga pasar di Cardtell.id">
                        <span class="material-symbols-outlined text-[12px] align-middle">open_in_new</span> Cek Harga Cardtell
                    </a>
                </div>
            `;
        }

        return `
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <div class="flex-1 min-w-0 pr-4">
                    <h4 class="text-xs font-bold text-slate-800 truncate">${item.name}</h4>
                    ${priceHtml}
                    ${cardtellLinkHtml}
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
    updateMobileCartUI();
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
            stopOcrScanner(); // Stop OCR first
            startCameraScanner();
        }
    });

    // Toggle OCR scanner view
    const toggleOcrCameraBtn = document.getElementById('toggleOcrCameraBtn');
    if (toggleOcrCameraBtn) {
        toggleOcrCameraBtn.addEventListener('click', () => {
            if (isOcrActive) {
                stopOcrScanner();
            } else {
                stopCameraScanner(); // Stop Barcode first
                startOcrScanner();
            }
        });
    }

    // Close camera scanner view
    closeCameraBtn.addEventListener('click', () => {
        stopCameraScanner();
        stopOcrScanner();
    });

    // Trigger manual OCR scan
    const triggerOcrBtn = document.getElementById('triggerOcrBtn');
    if (triggerOcrBtn) {
        triggerOcrBtn.addEventListener('click', () => {
            runOcrScanningManual();
        });
    }

    // Seed DB Button for staging testing
    const seedDbBtn = document.getElementById('seedDbBtn');
    if (seedDbBtn) {
        // Auto-hide seeder button if NOT on localhost or vercel staging/testing environments
        const hostname = window.location.hostname;
        const isTestEnv = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('vercel.app') || hostname.includes('staging');
        if (!isTestEnv) {
            seedDbBtn.classList.add('hidden');
        }

        seedDbBtn.addEventListener('click', async () => {
            seedDbBtn.disabled = true;
            const originalText = seedDbBtn.innerHTML;
            seedDbBtn.innerHTML = '⏳ SEEDING DATABASE...';
            
            try {
                const testProducts = [
                    {
                        name: "Pikachu",
                        category: "SINGLES",
                        game: "POKEMON",
                        card_number: "009/SM-P",
                        rarity: "Promo",
                        barcode: "SM-P-009-JP",
                        image_url: "https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2Fsm-p%2F009.png"
                    },
                    {
                        name: "Brambleghast",
                        category: "SINGLES",
                        game: "POKEMON",
                        card_number: "012/187",
                        rarity: "Common",
                        barcode: "SV8A-012-ID",
                        image_url: "https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2Fsv8a%2F012.png"
                    },
                    {
                        name: "Charizard ex",
                        category: "SINGLES",
                        game: "POKEMON",
                        card_number: "201/165",
                        rarity: "Special Illustration Rare",
                        barcode: "SV2A-201-ID",
                        image_url: "https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2Fsv2a%2F201.png"
                    },
                    {
                        name: "Eevee",
                        category: "SINGLES",
                        game: "POKEMON",
                        card_number: "142/187",
                        rarity: "Common",
                        barcode: "SV8A-142-ID",
                        image_url: "https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2Fsv8a%2F142.png"
                    }
                ];

                for (const p of testProducts) {
                    // Check if product exists in pm_products
                    const { data: existing } = await supabase
                        .from('pm_products')
                        .select('id')
                        .eq('barcode', p.barcode)
                        .maybeSingle();

                    let prodId;
                    if (existing) {
                        prodId = existing.id;
                        const { error: updateErr } = await supabase
                            .from('pm_products')
                            .update({
                                name: p.name,
                                card_number: p.card_number,
                                rarity: p.rarity,
                                image_url: p.image_url
                            })
                            .eq('id', prodId);
                        if (updateErr) throw updateErr;
                    } else {
                        const { data: inserted, error: insertErr } = await supabase
                            .from('pm_products')
                            .insert(p)
                            .select('id')
                            .single();
                        
                        if (insertErr) throw insertErr;
                        prodId = inserted.id;
                    }

                    // Check if inventory lot exists
                    const { data: existingLot } = await supabase
                        .from('pm_inventory_lots')
                        .select('id')
                        .eq('product_id', prodId)
                        .maybeSingle();

                    let price = 10000;
                    if (p.name.includes("Pikachu")) price = 75000;
                    if (p.name.includes("Brambleghast")) price = 800;
                    if (p.name.includes("Charizard")) price = 7300000;
                    if (p.name.includes("Eevee")) price = 12000;

                    const cost = Math.round(price * 0.7);

                    if (existingLot) {
                        const { error: lotUpdateErr } = await supabase
                            .from('pm_inventory_lots')
                            .update({
                                quantity_initial: 5,
                                quantity_remaining: 5,
                                unit_cost: cost,
                                selling_price: price
                            })
                            .eq('id', existingLot.id);
                        if (lotUpdateErr) throw lotUpdateErr;
                    } else {
                        const { error: lotErr } = await supabase
                            .from('pm_inventory_lots')
                            .insert({
                                product_id: prodId,
                                quantity_initial: 5,
                                quantity_remaining: 5,
                                unit_cost: cost,
                                selling_price: price
                            });
                        if (lotErr) throw lotErr;
                    }
                }

                // Auto-seed stock for all other products in the database
                const { data: allProds } = await supabase
                    .from('pm_products')
                    .select('id, name');

                if (allProds && allProds.length > 0) {
                    console.log(`Auto-seeding stock for ${allProds.length} total products in database...`);
                    for (const prod of allProds) {
                        const { data: existingLot } = await supabase
                            .from('pm_inventory_lots')
                            .select('id')
                            .eq('product_id', prod.id)
                            .maybeSingle();

                        if (!existingLot) {
                            await supabase
                                .from('pm_inventory_lots')
                                .insert({
                                    product_id: prod.id,
                                    quantity_initial: 10,
                                    quantity_remaining: 10,
                                    unit_cost: 10000,
                                    selling_price: 15000
                                });
                        } else {
                            // Reset stock to 10 if it was 0 for testing
                            await supabase
                                .from('pm_inventory_lots')
                                .update({
                                    quantity_initial: 10,
                                    quantity_remaining: 10,
                                    unit_cost: 10000
                                })
                                .eq('id', existingLot.id);
                        }
                    }
                }

                alert('✅ Database staging berhasil di-seed!\nKartu Pikachu, Brambleghast, Charizard, Eevee, dan semua produk lain di database sekarang memiliki stok aktif.');
                // Refetch products list
                await fetchProducts();
                renderProducts();
            } catch (err) {
                console.error("Seeding error:", err);
                alert('❌ Gagal seeder database: ' + err.message);
            } finally {
                seedDbBtn.disabled = false;
                seedDbBtn.innerHTML = originalText;
            }
        });
    }

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

    // 8. Mobile responsive layouts
    setupMobileTabs();

    // Setup local storage bindings for Gemini API key
    const geminiInput = document.getElementById('geminiApiKeyInput');
    const saveGeminiBtn = document.getElementById('saveGeminiKeyBtn');
    if (geminiInput && saveGeminiBtn) {
        geminiInput.value = localStorage.getItem('gemini_api_key') || '';
        saveGeminiBtn.addEventListener('click', () => {
            const val = geminiInput.value.trim();
            if (val) {
                localStorage.setItem('gemini_api_key', val);
                showNotification("Gemini API Key berhasil disimpan! 🔑", "success");
            } else {
                localStorage.removeItem('gemini_api_key');
                showNotification("Gemini API Key dihapus.", "warning");
            }
        });
    }

    // Start background preloading of OCR (now disabled/mocked)
    preloadOcrWorker();
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
    stopOcrScanner();
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

// Toggle catalog and cart panels on mobile screen sizes
function setupMobileTabs() {
    const tabCatalogBtn = document.getElementById('tabCatalogBtn');
    const tabCartBtn = document.getElementById('tabCartBtn');
    const catalogColumn = document.getElementById('catalogColumn');
    const cartColumn = document.getElementById('cartColumn');
    const viewCartTabBtn = document.getElementById('viewCartTabBtn');

    if (!tabCatalogBtn || !tabCartBtn) return;

    function switchTab(activeTab) {
        if (activeTab === 'catalog') {
            // Activate Catalog Tab button styles
            tabCatalogBtn.classList.add('border-blue-600', 'text-blue-600');
            tabCatalogBtn.classList.remove('border-transparent', 'text-slate-500');

            tabCartBtn.classList.add('border-transparent', 'text-slate-500');
            tabCartBtn.classList.remove('border-blue-600', 'text-blue-600');

            // Toggle HTML column visibility
            catalogColumn.classList.remove('hidden');
            cartColumn.classList.add('hidden', 'lg:flex');
            cartColumn.classList.remove('flex');
            
            updateMobileCartUI();
        } else {
            // Activate Cart Tab button styles
            tabCartBtn.classList.add('border-blue-600', 'text-blue-600');
            tabCartBtn.classList.remove('border-transparent', 'text-slate-500');

            tabCatalogBtn.classList.add('border-transparent', 'text-slate-500');
            tabCatalogBtn.classList.remove('border-blue-600', 'text-blue-600');

            // Toggle HTML column visibility
            catalogColumn.classList.add('hidden');
            cartColumn.classList.remove('hidden', 'lg:flex');
            cartColumn.classList.add('flex'); // Force flex view for mobile
            
            // Hide floating bar when directly viewing cart panel
            const floatingCartBar = document.getElementById('floatingCartBar');
            if (floatingCartBar) floatingCartBar.classList.add('hidden');
        }
    }

    tabCatalogBtn.addEventListener('click', () => switchTab('catalog'));
    tabCartBtn.addEventListener('click', () => switchTab('cart'));
    if (viewCartTabBtn) {
        viewCartTabBtn.addEventListener('click', () => switchTab('cart'));
    }
}

// Update Mobile-specific UI elements (Floating subtotal bar & Tab badges)
function updateMobileCartUI() {
    const cartCountBadge = document.getElementById('cartCountBadge');
    const floatingCartBar = document.getElementById('floatingCartBar');
    const floatingCartCount = document.getElementById('floatingCartCount');
    const floatingCartTotal = document.getElementById('floatingCartTotal');
    const catalogColumn = document.getElementById('catalogColumn');

    const totalQty = cart.reduce((acc, item) => acc + item.qty, 0);
    const subtotal = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);

    // 1. Update Cart Tab Item Badge
    if (cartCountBadge) {
        if (totalQty > 0) {
            cartCountBadge.innerText = totalQty;
            cartCountBadge.classList.remove('hidden');
        } else {
            cartCountBadge.classList.add('hidden');
        }
    }

    // 2. Update Floating Bottom Cart bar (visible on catalog tab if cart has items)
    if (floatingCartBar) {
        const isCatalogActive = catalogColumn && !catalogColumn.classList.contains('hidden');
        if (totalQty > 0 && isCatalogActive) {
            if (floatingCartCount) floatingCartCount.innerText = `${totalQty} Item`;
            if (floatingCartTotal) floatingCartTotal.innerText = formatRupiah(subtotal);
            floatingCartBar.classList.remove('hidden');
        } else {
            floatingCartBar.classList.add('hidden');
        }
    }
}

// Variables for Card OCR Scanner
let ocrWorker = null;
let ocrStream = null;
let isOcrActive = false;
let isOcrInitializing = false;

// OCR Scanner UI & Feedback Helpers
function updateOcrStatus(status) {
    const dot = document.getElementById('ocrStatusDot');
    const text = document.getElementById('ocrStatusText');
    if (!dot || !text) return;

    dot.className = "w-2 h-2 rounded-full";
    if (status === 'READY') {
        dot.classList.add('bg-indigo-500', 'animate-ping');
        text.innerText = "SIAP MEMINDAI";
        text.className = "text-slate-300";
    } else if (status === 'PROCESSING') {
        dot.classList.add('bg-amber-500', 'animate-pulse');
        text.innerText = "SEDANG MEMBACA...";
        text.className = "text-amber-400 font-bold";
    } else if (status === 'SUCCESS') {
        dot.classList.add('bg-emerald-500');
        text.innerText = "KODE COCOK";
        text.className = "text-emerald-400 font-bold";
    } else if (status === 'INVALID') {
        dot.classList.add('bg-rose-500');
        text.innerText = "BACA GAGAL / COBA LAGI";
        text.className = "text-rose-400 font-bold";
    }
}

function showOcrViewportToast(message, type = 'success') {
    const toast = document.getElementById('ocrViewportToast');
    const toastIcon = document.getElementById('ocrViewportToastIcon');
    const toastMsg = document.getElementById('ocrViewportToastMsg');

    if (!toast || !toastIcon || !toastMsg) return;

    toastMsg.innerText = message;
    
    // Reset classes
    toast.className = "absolute top-3 left-3 right-3 transform flex items-center gap-2 px-3 py-2.5 rounded-lg text-[10px] font-bold shadow-lg border backdrop-blur-md transition-all duration-300 z-10";
    
    if (type === 'success') {
        toast.classList.add('bg-emerald-950/95', 'text-emerald-300', 'border-emerald-700');
        toastIcon.innerText = "check_circle";
        toastIcon.className = "material-symbols-outlined text-[16px] text-emerald-400";
    } else if (type === 'warning') {
        toast.classList.add('bg-amber-950/95', 'text-amber-300', 'border-amber-700');
        toastIcon.innerText = "warning";
        toastIcon.className = "material-symbols-outlined text-[16px] text-amber-400";
    } else {
        toast.classList.add('bg-rose-950/95', 'text-rose-300', 'border-rose-700');
        toastIcon.innerText = "cancel";
        toastIcon.className = "material-symbols-outlined text-[16px] text-rose-400";
    }

    // Slide in
    toast.classList.remove('hidden', 'translate-y-[-20px]', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    // Audio feedback
    playScannerBeep(type === 'success' || type === 'warning');

    // Auto hide
    setTimeout(() => {
        toast.classList.add('translate-y-[-20px]', 'opacity-0');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 300);
    }, 4000);
}

function playScannerBeep(success = true) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        if (success) {
            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            osc.start();
            setTimeout(() => {
                osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
                setTimeout(() => {
                    osc.stop();
                }, 70);
            }, 70);
        } else {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(140, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
            osc.start();
            setTimeout(() => {
                osc.stop();
            }, 180);
        }
    } catch (e) {
        console.log("Audio not supported or blocked:", e);
    }
}

// Preload Tesseract worker (Disabled: using Gemini Cloud API)
async function preloadOcrWorker(silent = true) {
    console.log("Gemini Cloud API OCR mode is active.");
}

// Start Card OCR Scanner
window.startOcrScanner = async function () {
    if (isOcrActive) return;

    const cameraScannerArea = document.getElementById('cameraScannerArea');
    const qrReaderPos = document.getElementById('qr-reader-pos');
    const ocrVideo = document.getElementById('ocrVideo');
    const ocrOverlay = document.getElementById('ocrOverlay');
    const ocrActionContainer = document.getElementById('ocrActionContainer');

    if (!cameraScannerArea || !qrReaderPos || !ocrVideo || !ocrOverlay || !ocrActionContainer) {
        alert("Elemen Scanner OCR tidak ditemukan!");
        return;
    }

    // Hide QR Reader, show OCR Video, Overlay, and Manual Button
    qrReaderPos.classList.add('hidden');
    ocrVideo.classList.remove('hidden');
    ocrOverlay.classList.remove('hidden');
    ocrActionContainer.classList.remove('hidden');
    cameraScannerArea.classList.remove('hidden');

    isOcrActive = true;
    updateOcrStatus('READY');

    // Start video stream
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        ocrStream = stream;
        ocrVideo.srcObject = stream;
        ocrVideo.play();
    } catch (err) {
        console.error("Gagal membuka kamera untuk OCR:", err);
        showNotification("Gagal mengakses kamera. Pastikan izin kamera aktif.", "error");
        stopOcrScanner();
        return;
    }
};

// Stop Card OCR Scanner
window.stopOcrScanner = function () {
    isOcrActive = false;
    
    // Stop video stream
    if (ocrStream) {
        ocrStream.getTracks().forEach(track => track.stop());
        ocrStream = null;
    }

    const ocrVideo = document.getElementById('ocrVideo');
    if (ocrVideo) {
        ocrVideo.srcObject = null;
        ocrVideo.classList.add('hidden');
    }

    const ocrOverlay = document.getElementById('ocrOverlay');
    if (ocrOverlay) {
        ocrOverlay.classList.add('hidden');
    }

    const ocrActionContainer = document.getElementById('ocrActionContainer');
    if (ocrActionContainer) {
        ocrActionContainer.classList.add('hidden');
    }

    const qrReaderPos = document.getElementById('qr-reader-pos');
    if (qrReaderPos) {
        qrReaderPos.classList.remove('hidden');
    }

    const cameraScannerArea = document.getElementById('cameraScannerArea');
    if (cameraScannerArea) {
        cameraScannerArea.classList.add('hidden');
    }
};

// Manual Trigger OCR Scanner
window.runOcrScanningManual = async function () {
    if (!isOcrActive) return;

    const triggerOcrBtn = document.getElementById('triggerOcrBtn');
    const triggerOcrBtnText = document.getElementById('triggerOcrBtnText');
    const video = document.getElementById('ocrVideo');
    const flash = document.getElementById('ocrCameraFlash');
    const spinner = document.getElementById('ocrSpinnerContainer');

    if (!video || video.paused || video.ended) {
        showOcrViewportToast("Kamera belum siap!", "warning");
        return;
    }

    // Get the Gemini API Key from localStorage or environment
    const geminiKey = localStorage.getItem('gemini_api_key') || import.meta.env.VITE_GEMINI_API_KEY || '';
    if (!geminiKey) {
        showOcrViewportToast("⚠️ API Key belum diisi!", "warning");
        alert("Silakan masukkan API Key Gemini Anda pada menu Konfigurasi di bawah kamera terlebih dahulu.");
        return;
    }

    // 1. Photographic shutter flash effect
    if (flash) {
        flash.classList.remove('opacity-0');
        flash.classList.add('opacity-80');
        setTimeout(() => {
            flash.classList.remove('opacity-80');
            flash.classList.add('opacity-0');
        }, 150);
    }

    // 2. Freeze camera stream
    video.pause();

    // 3. Show Spinner Overlay and status flag
    if (spinner) {
        spinner.classList.remove('hidden');
    }
    updateOcrStatus('PROCESSING');

    // Disable button and show loading state
    if (triggerOcrBtn && triggerOcrBtnText) {
        triggerOcrBtn.disabled = true;
        triggerOcrBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
        triggerOcrBtn.classList.add('bg-slate-400', 'cursor-not-allowed');
        triggerOcrBtnText.innerText = "MEMBACA KODE KARTU...";
    }

    try {
        // Draw the frozen frame onto canvas for OCR preprocessing
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error("Gagal mengambil context canvas.");
        }

        const vW = video.videoWidth || 640;
        const vH = video.videoHeight || 480;
        const displayW = video.offsetWidth || 320;
        const displayH = video.offsetHeight || 240;

        const scaleX = vW / displayW;
        const scaleY = vH / displayH;

        // Bounding box size (208px width x 56px height relative to display)
        const cropW = Math.round(208 * scaleX);
        const cropH = Math.round(56 * scaleY);
        const cropX = Math.round((vW - cropW) / 2);
        const cropY = Math.round((vH - cropH) / 2);

        canvas.width = cropW;
        canvas.height = cropH;

        ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const frameDataUrl = canvas.toDataURL('image/png');
        const base64Data = frameDataUrl.split(',')[1];

        // Call Google Gemini 2.5 Flash API
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            text: "Extract the Pokemon card set code and collector number from this cropped corner image of the card's bottom. For example, if you see 'SV8a' and '012/187', extract 'SV8a' as setCode, '012' as cardNumber, and '187' as totalNumber. If you only see a collector code like '009/SM-P', return setCode null, cardNumber '009', and totalNumber 'SM-P'. Format your response strictly as a single JSON object with keys: setCode (string or null), cardNumber (string), totalNumber (string). Do not include any markdown formatting like ```json or ```, just return the raw JSON string."
                        },
                        {
                            inlineData: {
                                mimeType: "image/png",
                                data: base64Data
                            }
                        }
                    ]
                }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API Error: ${response.status} - ${response.statusText}`);
        }

        const resData = await response.json();
        const jsonText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) {
            throw new Error("API tidak mengembalikan teks hasil pembacaan.");
        }

        console.log("Gemini OCR response:", jsonText);

        // Strip markdown wraps if present
        let cleanedJson = jsonText.trim();
        if (cleanedJson.startsWith("```")) {
            cleanedJson = cleanedJson.replace(/^```(json)?/, '').replace(/```$/, '').trim();
        }

        const parsed = JSON.parse(cleanedJson);
        if (parsed && parsed.cardNumber) {
            // Swap safeguard for inverted promo cards (e.g. 174/SM-P)
            if (parsed.setCode && /^\d+$/.test(parsed.setCode) && parsed.cardNumber && /^[a-zA-Z\-_]+$/.test(parsed.cardNumber)) {
                const temp = parsed.setCode;
                parsed.setCode = parsed.cardNumber;
                parsed.cardNumber = temp;
            }
            console.log("Gemini parsed card code:", parsed);
            
            // Normalize setCode, cardNumber, and totalNumber
            const setCode = parsed.setCode ? parsed.setCode.trim() : null;
            const cardNumber = parsed.cardNumber.trim();
            const totalNumber = parsed.totalNumber ? parsed.totalNumber.trim() : null;

            const matched = lookupProductByCode(setCode, cardNumber, totalNumber);
            if (matched) {
                // Success feedback
                playScannerBeep(true);
                if (navigator.vibrate) navigator.vibrate(200);
                
                window.addToCart(matched.id);
                
                updateOcrStatus('SUCCESS');
                showOcrViewportToast(`✅ ${matched.name} (${cardNumber}/${totalNumber || '?'})`, 'success');
            } else {
                // Warning feedback (matched text, but not in DB)
                playScannerBeep(false);
                updateOcrStatus('INVALID');
                showOcrViewportToast(`⚠️ Kode [${setCode || ''} ${cardNumber}/${totalNumber || ''}] tidak ada di katalog.`, 'warning');
            }
        } else {
            // Error feedback (could not parse any card format)
            playScannerBeep(false);
            updateOcrStatus('INVALID');
            showOcrViewportToast(`❌ Gagal membaca kode kartu.`, 'error');
        }
    } catch (err) {
        console.error("Gemini API OCR manual scan error:", err);
        playScannerBeep(false);
        updateOcrStatus('INVALID');
        showOcrViewportToast(`❌ Kesalahan API: ${err.message || err}`, "error");
    }

    // Auto resume stream after 2 seconds
    setTimeout(() => {
        if (isOcrActive) {
            video.play().catch(e => console.error("Error resuming camera stream:", e));
            if (spinner) spinner.classList.add('hidden');
            updateOcrStatus('READY');
            resetTriggerOcrBtn();
        }
    }, 2000);
};

function resetTriggerOcrBtn() {
    const triggerOcrBtn = document.getElementById('triggerOcrBtn');
    const triggerOcrBtnText = document.getElementById('triggerOcrBtnText');
    if (triggerOcrBtn && triggerOcrBtnText) {
        triggerOcrBtn.disabled = false;
        triggerOcrBtn.classList.remove('bg-slate-400', 'cursor-not-allowed');
        triggerOcrBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        triggerOcrBtnText.innerText = "BACA KODE KARTU";
    }
}

// Regex parsing for card number/set format
function parseOcrText(text) {
    if (!text) return null;
    const cleaned = text.replace(/[^a-zA-Z0-9\/\s\-]/g, ' ').replace(/\s+/g, ' ').trim();

    // Pattern 1: Set Code + Collector Number (e.g. SV8a 012/187)
    const matchFull = cleaned.match(/([A-Z0-9\-]+)\s+(\d+)\/([A-Z0-9\-]+)/i);
    if (matchFull) {
        return {
            setCode: matchFull[1],
            cardNumber: matchFull[2],
            totalNumber: matchFull[3]
        };
    }

    // Pattern 2: Collector number only (e.g. 009/SM-P or 012/187)
    const matchNum = cleaned.match(/(\d+)\/([A-Z0-9\-]+)/i);
    if (matchNum) {
        return {
            setCode: null,
            cardNumber: matchNum[1],
            totalNumber: matchNum[2]
        };
    }

    return null;
}

// Lookup product in memory list by card codes
function lookupProductByCode(setCode, cardNumber, totalNumber) {
    if (!products || products.length === 0) return null;
    
    // Normalize setCode & totalNumber for common OCR misreads (e.g. S-P or SMP -> SM-P)
    let cleanSet = setCode ? setCode.trim().toUpperCase() : null;
    let cleanTotal = totalNumber ? totalNumber.trim().toUpperCase() : null;

    if (cleanSet === 'S-P' || cleanSet === 'SMP') cleanSet = 'SM-P';
    if (cleanTotal === 'S-P' || cleanTotal === 'SMP') cleanTotal = 'SM-P';

    // Normalize card number by removing leading zeros for flexible comparison
    const normNum = cardNumber ? parseInt(cardNumber, 10).toString() : '';
    if (!normNum) return null;

    // 1. Try to match barcode or exact set code prefix (e.g. SV8a-012)
    if (cleanSet) {
        const paddedNum = normNum.padStart(3, '0');
        const match = products.find(p => {
            const barcodeUpper = p.barcode ? p.barcode.toUpperCase() : '';
            return barcodeUpper.includes(`${cleanSet}-${paddedNum}`) || 
                   barcodeUpper.includes(`${cleanSet}-${normNum}`);
        });
        if (match) return match;
    }

    // 2. Try to match card_number containing both cardNumber and totalNumber (e.g. card_number: "009/SM-P")
    const matchByNumAndTotal = products.find(p => {
        if (!p.card_number) return false;
        const cardNumClean = p.card_number.replace(/\s+/g, '').toUpperCase();
        const hasNumber = cardNumClean.includes(normNum);
        const hasTotal = cleanTotal ? cardNumClean.includes(cleanTotal) : true;
        return hasNumber && hasTotal;
    });
    if (matchByNumAndTotal) return matchByNumAndTotal;

    // 3. Fallback: match by card_number start
    const paddedNum = normNum.padStart(3, '0');
    const matchFallback = products.find(p => p.card_number && p.card_number.startsWith(paddedNum));
    if (matchFallback) return matchFallback;

    return null;
}
