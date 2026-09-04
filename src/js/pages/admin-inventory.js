import { supabase } from '../core/supabase.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let inventoryLots = [];
let dbProducts = [];
let dbProfiles = [];
let searchFilter = '';
let acqCartItems = []; // Multi-item buyback cart

// Modern Bottom Toast Snackbar
function showBottomToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('bottomToastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-xl border backdrop-blur-md transition-all duration-300 transform translate-y-4 opacity-0 ${
        type === 'error'
            ? 'bg-red-900/90 border-red-500/40 text-white'
            : type === 'warning'
            ? 'bg-amber-900/90 border-amber-500/40 text-amber-100'
            : 'bg-slate-900/90 border-emerald-500/40 text-emerald-300'
    }`;

    const icon = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'check_circle';
    toast.innerHTML = `
        <span class="material-symbols-outlined text-[18px] shrink-0">${icon}</span>
        <span class="truncate flex-1">${message}</span>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
    });

    // Auto dismiss
    setTimeout(() => {
        toast.classList.add('translate-y-4', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Quick Confirmation Bottom Sheet (replaces window.confirm)
function showQuickConfirm(message, onConfirm) {
    const sheet = document.getElementById('quickConfirmSheet');
    const desc = document.getElementById('quickConfirmSheetDesc');
    const okBtn = document.getElementById('quickConfirmOkBtn');
    const cancelBtn = document.getElementById('quickConfirmCancelBtn');

    if (!sheet || !okBtn || !cancelBtn) {
        if (confirm(message)) onConfirm();
        return;
    }

    if (desc) desc.textContent = message;
    sheet.classList.remove('hidden');

    const handleOk = () => {
        cleanup();
        onConfirm();
    };

    const handleCancel = () => {
        cleanup();
    };

    const cleanup = () => {
        sheet.classList.add('hidden');
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', handleCancel);
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
}

// DOM Elements
const inventoryTableBody = document.getElementById('inventoryTableBody');
const inventorySearch = document.getElementById('inventorySearch');
const totalAssetCost = document.getElementById('totalAssetCost');
const totalUniqueItems = document.getElementById('totalUniqueItems');
const lowStockCount = document.getElementById('lowStockCount');

// Modals
const acqModal = document.getElementById('acqModal');
const productModal = document.getElementById('productModal');
const openAcqModalBtn = document.getElementById('openAcqModalBtn');
const openProductModalBtn = document.getElementById('openProductModalBtn');

// Forms & Inputs
const acqForm = document.getElementById('acqForm');
const acqType = document.getElementById('acqType');
const acqPaymentMethod = document.getElementById('acqPaymentMethod');
const acqCustomerSection = document.getElementById('acqCustomerSection');
const acqCustomerSelect = document.getElementById('acqCustomerSelect');
const acqProductSelect = document.getElementById('acqProductSelect');
const acqQty = document.getElementById('acqQty');
const acqCondition = document.getElementById('acqCondition');
const acqOwnership = document.getElementById('acqOwnership');
const consignSection = document.getElementById('consignSection');
const consignOwnerSelect = document.getElementById('consignOwnerSelect');
const consignFee = document.getElementById('consignFee');
const acqUnitCost = document.getElementById('acqUnitCost');
const acqSellingPrice = document.getElementById('acqSellingPrice');

const productForm = document.getElementById('productForm');
const prodName = document.getElementById('prodName');
const prodCategory = document.getElementById('prodCategory');
const prodGame = document.getElementById('prodGame');
const prodCardNumber = document.getElementById('prodCardNumber');
const prodRarity = document.getElementById('prodRarity');
const prodBarcode = document.getElementById('prodBarcode');
const prodSinglesDetails = document.getElementById('prodSinglesDetails');

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Core authentication & layout
    const perms = await initializeAdminLayout();
    if (!perms) return;

    // 2. Load Core Data
    await loadInventory();
    await loadDropdownData();

    // 3. Setup Listeners
    setupEventListeners();
});

// Load inventory lots and compute stats
async function loadInventory() {
    try {
        const { data, error } = await supabase
            .from('pm_inventory_lots')
            .select(`
                id, ownership_type, consignment_fee_percent, condition,
                quantity_initial, quantity_remaining, unit_cost, selling_price, created_at,
                pm_products(name, category, card_number, image_url, language),
                profiles!pm_inventory_lots_consignment_owner_id_fkey(username)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        inventoryLots = data || [];
        renderInventoryTable();
        calculateInventoryStats();
    } catch (err) {
        console.error('Error loading inventory lots:', err);
    }
}

// Render inventory layers in table
function renderInventoryTable() {
    const filtered = inventoryLots.filter(lot => {
        const prod = lot.pm_products;
        if (!prod) return false;
        const matchesSearch = searchFilter === '' || 
            prod.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
            (prod.card_number && prod.card_number.toLowerCase().includes(searchFilter.toLowerCase()));
        return matchesSearch;
    });

    if (filtered.length === 0) {
        inventoryTableBody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center p-8 text-slate-400">Tidak ada data inventory ditemukan</td>
            </tr>
        `;
        return;
    }

    inventoryTableBody.innerHTML = filtered.map(lot => {
        const prod = lot.pm_products;
        if (!prod) return '';
        const ownerName = lot.profiles ? `@${lot.profiles.username}` : '-';
        const formattedCost = formatRupiah(lot.unit_cost);
        const formattedPrice = formatRupiah(lot.selling_price);
        const dateStr = new Date(lot.created_at).toLocaleDateString('id-ID');
        
        let ownershipLabel = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700">Milik Toko</span>`;
        if (lot.ownership_type === 'CONSIGNMENT') {
            ownershipLabel = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700">Titip Jual (${ownerName})</span>`;
        }

        // Card image thumbnail
        const imgHtml = prod.image_url 
            ? `<img src="${prod.image_url}" class="w-8 h-12 object-cover rounded shadow border border-slate-100 mr-3 shrink-0" />`
            : `<div class="w-8 h-12 bg-slate-50 flex items-center justify-center rounded border border-dashed border-slate-200 mr-3 text-slate-400 shrink-0 select-none">
                 <span class="material-symbols-outlined text-[16px]">image</span>
               </div>`;

        // Language Badge
        let langBadge = '';
        if (prod.language) {
            const langNames = {
                'ID': 'Indo',
                'EN': 'Eng',
                'JP': 'Jpn',
                'CN': 'CN',
                'TW': 'TW/HK',
                'KR': 'Kor',
                'OTHER': 'Lain'
            };
            const langColors = {
                'ID': 'bg-red-50 text-red-700 border-red-200',
                'EN': 'bg-blue-50 text-blue-700 border-blue-200',
                'JP': 'bg-amber-50 text-amber-700 border-amber-200',
                'CN': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                'TW': 'bg-teal-50 text-teal-700 border-teal-200',
                'KR': 'bg-indigo-50 text-indigo-700 border-indigo-200',
                'OTHER': 'bg-slate-50 text-slate-700 border-slate-200'
            };
            const name = langNames[prod.language.toUpperCase()] || prod.language;
            const color = langColors[prod.language.toUpperCase()] || 'bg-slate-50 text-slate-700 border-slate-200';
            langBadge = `<span class="ml-1.5 px-1.5 py-0.5 rounded border text-[9px] font-bold ${color}">${name}</span>`;
        }

        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-4 flex items-center">
                    ${imgHtml}
                    <div>
                        <div class="flex items-center">
                            <p class="font-bold text-slate-800">${prod.name}</p>
                            ${langBadge}
                        </div>
                        ${prod.card_number ? `<p class="text-[10px] text-slate-400 font-mono mt-0.5">${prod.card_number}</p>` : ''}
                    </div>
                </td>
                <td class="p-4 uppercase font-semibold text-slate-500">${prod.category}</td>
                <td class="p-4">${ownershipLabel}</td>
                <td class="p-4 font-mono font-bold">${lot.condition}</td>
                <td class="p-4 font-bold ${lot.quantity_remaining <= 2 ? 'text-amber-600' : 'text-slate-700'}">
                    ${lot.quantity_remaining} <span class="text-slate-400 font-normal">/ ${lot.quantity_initial}</span>
                </td>
                <td class="p-4 text-slate-600 font-semibold">${formattedCost}</td>
                <td class="p-4 text-blue-600 font-bold">${formattedPrice}</td>
                <td class="p-4 text-slate-400">${dateStr}</td>
            </tr>
        `;
    }).join('');
}

// Calculate total asset cost, unique products and low stocks count
function calculateInventoryStats() {
    let totalCostVal = 0;
    const uniqueProductIds = new Set();
    const productStockMap = {}; // productId -> totalStock

    for (const lot of inventoryLots) {
        if (lot.quantity_remaining > 0) {
            totalCostVal += (lot.quantity_remaining * lot.unit_cost);
            uniqueProductIds.add(lot.pm_products?.name);
            
            // Map product stock for low stock checking
            const pId = lot.pm_products?.name;
            productStockMap[pId] = (productStockMap[pId] || 0) + lot.quantity_remaining;
        }
    }

    // Count low stocks
    let lowStockCountVal = 0;
    for (const pId in productStockMap) {
        if (productStockMap[pId] > 0 && productStockMap[pId] < 5) {
            lowStockCountVal++;
        }
    }

    totalAssetCost.innerText = formatRupiah(totalCostVal);
    totalUniqueItems.innerText = uniqueProductIds.size;
    lowStockCount.innerText = lowStockCountVal;
}

// Populate forms select inputs
async function loadDropdownData() {
    try {
        // 1. Fetch Products (including game and barcode for Cardtell lookup)
        const { data: prodData } = await supabase.from('pm_products').select('id, name, category, card_number, game, barcode, image_url, language, rarity').order('name');
        dbProducts = prodData || [];

        // Reset product selection values
        acqProductSelect.value = '';
        const acqProductSearch = document.getElementById('acqProductSearch');
        if (acqProductSearch) acqProductSearch.value = '';
        updateAcqProductPreview('');

        // 2. Fetch Profiles for customer/consignor selection
        const { data: profData } = await supabase.from('profiles').select('id, username').order('username');
        dbProfiles = profData || [];

        const profileOptions = `<option value="">-- Pilih Member --</option>` + dbProfiles.map(p => `
            <option value="${p.id}">@${p.username}</option>
        `).join('');

        acqCustomerSelect.innerHTML = profileOptions;
        consignOwnerSelect.innerHTML = profileOptions;
    } catch (err) {
        console.error('Error loading dropdown lists:', err);
    }
}

// Setup page elements listeners
function setupEventListeners() {
    // Search filter input typing
    inventorySearch.addEventListener('input', (e) => {
        searchFilter = e.target.value;
        renderInventoryTable();
    });

    // Modal Triggers
    openAcqModalBtn.addEventListener('click', () => acqModal.classList.remove('hidden'));
    openProductModalBtn.addEventListener('click', () => productModal.classList.remove('hidden'));

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            acqModal.classList.add('hidden');
            productModal.classList.add('hidden');
        });
    });

    // Form logic: Toggle fields based on Transaction Type
    acqType.addEventListener('change', (e) => {
        const type = e.target.value;
        
        if (type === 'CUSTOMER_BUYBACK') {
            acqCustomerSection.classList.remove('hidden');
            acqCustomerSelect.required = true;
            
            // Re-enable fields
            acqOwnership.value = 'OWNED';
            acqOwnership.disabled = false;
            acqOwnership.dispatchEvent(new Event('change'));
            acqPaymentMethod.disabled = false;
            acqUnitCost.disabled = false;
            acqUnitCost.placeholder = 'Rp 0';
        } else if (type === 'CONSIGNMENT_INTAKE') {
            acqCustomerSection.classList.add('hidden');
            acqCustomerSelect.required = false;
            acqCustomerSelect.value = '';
            
            // Lock ownership to Consignment
            acqOwnership.value = 'CONSIGNMENT';
            acqOwnership.disabled = true;
            acqOwnership.dispatchEvent(new Event('change'));
            
            // Disable cash payment method & unit cost
            acqPaymentMethod.disabled = true;
            acqUnitCost.disabled = true;
            acqUnitCost.value = '';
            acqUnitCost.placeholder = 'Otomatis (Bagi Hasil)';
        } else { // SUPPLIER_PURCHASE
            acqCustomerSection.classList.add('hidden');
            acqCustomerSelect.required = false;
            acqCustomerSelect.value = '';
            
            // Re-enable fields
            acqOwnership.value = 'OWNED';
            acqOwnership.disabled = false;
            acqOwnership.dispatchEvent(new Event('change'));
            acqPaymentMethod.disabled = false;
            acqUnitCost.disabled = false;
            acqUnitCost.placeholder = 'Rp 0';
        }
    });

    // Form logic: Toggle consignment options
    acqOwnership.addEventListener('change', (e) => {
        if (e.target.value === 'CONSIGNMENT') {
            consignSection.classList.remove('hidden');
            consignOwnerSelect.required = true;
        } else {
            consignSection.classList.add('hidden');
            consignOwnerSelect.required = false;
            consignOwnerSelect.value = '';
        }
    });

    // Multi-Item Buyback: Add to cart button
    const acqAddItemBtn = document.getElementById('acqAddItemBtn');
    if (acqAddItemBtn) {
        acqAddItemBtn.addEventListener('click', () => {
            const productId = acqProductSelect.value;
            const productSearch = document.getElementById('acqProductSearch');
            const productName = productSearch ? productSearch.value : '';
            const qty = parseInt(acqQty.value) || 1;
            const condition = acqCondition.value;
            const ownership = acqOwnership.value;
            const unitCost = parseInt(acqUnitCost.value) || 0;
            const sellingPrice = parseInt(acqSellingPrice.value) || 0;
            const consignOwner = consignOwnerSelect.value || null;
            const consignFeeVal = parseFloat(consignFee.value) || 0;
            
            if (!productId) {
                showBottomToast('⚠️ Pilih produk terlebih dahulu dari hasil pencarian!', 'warning', 3000);
                return;
            }
            if (!sellingPrice) {
                showBottomToast('⚠️ Isi estimasi harga jual terlebih dahulu!', 'warning', 3000);
                return;
            }
            
            const product = dbProducts.find(p => p.id === productId);
            
            acqCartItems.push({
                product_id: productId,
                name: productName,
                image_url: product?.image_url || null,
                qty,
                condition,
                ownership_type: ownership,
                unit_cost: unitCost,
                selling_price: sellingPrice,
                consignment_owner_id: consignOwner,
                consignment_fee_percent: consignFeeVal
            });
            
            renderAcqCart();
            
            // Reset item row for next entry (keep type/payment/customer)
            acqProductSelect.value = '';
            if (productSearch) productSearch.value = '';
            updateAcqProductPreview('');
            acqQty.value = '1';
            acqUnitCost.value = '';
            acqSellingPrice.value = '';
            acqCondition.value = 'NM';
        });
    }
    
    // Multi-Item Buyback: Clear cart button
    const acqClearCartBtn = document.getElementById('acqClearCartBtn');
    if (acqClearCartBtn) {
        acqClearCartBtn.addEventListener('click', () => {
            acqCartItems = [];
            renderAcqCart();
        });
    }

    // Form logic: Toggle code inputs if category !== SINGLES
    prodCategory.addEventListener('change', (e) => {
        if (e.target.value === 'SINGLES') {
            prodSinglesDetails.classList.remove('hidden');
        } else {
            prodSinglesDetails.classList.add('hidden');
            prodCardNumber.value = '';
            prodRarity.value = '';
        }
    });

    // One-Stop Stock Intake: toggle visibility
    const quickStockEnabled = document.getElementById('quickStockEnabled');
    const quickStockFields = document.getElementById('quickStockFields');
    if (quickStockEnabled && quickStockFields) {
        quickStockEnabled.addEventListener('change', () => {
            if (quickStockEnabled.checked) {
                quickStockFields.classList.remove('hidden');
            } else {
                quickStockFields.classList.add('hidden');
            }
        });
    }

    // Handle catalog product creation
    productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = document.getElementById('productFormSubmitBtn');
        const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>⏳ Menambahkan...</span>`;
        }

        const payload = {
            name: prodName.value.trim(),
            category: prodCategory.value,
            game: prodGame.value,
            card_number: prodCardNumber.value.trim() || null,
            rarity: prodRarity.value.trim() || null,
            barcode: prodBarcode.value.trim() || null,
            language: document.getElementById('prodLanguage').value,
            image_url: document.getElementById('prodImageUrl').value || null
        };

        // Duplicate detection before insertion (PRD Section 7.4)
        const isDuplicate = dbProducts.find(p => {
            // Match by barcode
            if (payload.barcode && p.barcode && p.barcode.toLowerCase() === payload.barcode.toLowerCase()) {
                return true;
            }
            // For singles, match by name, game, and card number
            if (payload.category === 'SINGLES' && p.category === 'SINGLES') {
                return p.name.toLowerCase() === payload.name.toLowerCase() &&
                       p.game === payload.game &&
                       p.card_number === payload.card_number;
            }
            return false;
        });

        if (isDuplicate) {
            const proceed = confirm(`⚠️ Peringatan Duplikasi!\n\nKartu/produk dengan nama "${isDuplicate.name}"${isDuplicate.card_number ? ` (${isDuplicate.card_number})` : ''} sudah ada di katalog.\n\nApakah Anda yakin ingin tetap menambahkannya sebagai produk baru? (Klik Batal/Cancel untuk menghindari duplikasi)`);
            if (!proceed) {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
                return;
            }
        }

        try {
            const { data: insertedProduct, error } = await supabase
                .from('pm_products')
                .insert(payload)
                .select('id')
                .single();
            if (error) throw error;

            // One-Stop Intake: if quick stock is enabled, also create inventory lot
            const quickStockEnabled = document.getElementById('quickStockEnabled');
            let didStock = false;

            if (quickStockEnabled && quickStockEnabled.checked && insertedProduct) {
                const qType = document.getElementById('quickStockType').value;
                const qQty = parseInt(document.getElementById('quickStockQty').value) || 1;
                const qCost = parseInt(document.getElementById('quickStockCost').value) || 0;
                const qPrice = parseInt(document.getElementById('quickStockPrice').value) || 0;
                const qCondition = document.getElementById('quickStockCondition').value;
                const qPayment = document.getElementById('quickStockPayment').value;
                
                const totalCostVal = qType === 'CONSIGNMENT_INTAKE' ? 0 : (qQty * qCost);
                
                const { error: acqError } = await supabase.rpc('process_pos_acquisition', {
                    p_type: qType === 'CONSIGNMENT_INTAKE' ? 'CUSTOMER_BUYBACK' : qType,
                    p_customer_id: null,
                    p_total_cost: totalCostVal,
                    p_payment_status: 'PAID',
                    p_payment_method: qPayment,
                    p_items: [{
                        product_id: insertedProduct.id,
                        quantity: qQty,
                        unit_cost: qCost,
                        selling_price: qPrice,
                        ownership_type: 'OWNED',
                        consignment_owner_id: null,
                        consignment_fee_percent: 0,
                        condition: qCondition
                    }]
                });

                if (acqError) {
                    console.error('Quick stock intake error:', acqError);
                    alert(`⚠️ Katalog berhasil disimpan, tetapi input stok gagal: ${acqError.message}\n\nSilakan tambahkan stok melalui tombol Restock / Buyback.`);
                } else {
                    didStock = true;
                }
            }

            productForm.reset();
            productModal.classList.add('hidden');

            // Reset quick stock fields
            if (quickStockEnabled) quickStockEnabled.checked = false;
            const qFields = document.getElementById('quickStockFields');
            if (qFields) qFields.classList.add('hidden');

            // Reset image preview and hidden image url
            document.getElementById('prodImageUrl').value = '';
            const previewContainer = document.getElementById('catalogOcrPreviewContainer');
            if (previewContainer) previewContainer.classList.add('hidden');

            // Reset Cardtell button
            const cardtellBtn = document.getElementById('catalogCardtellBtn');
            if (cardtellBtn) cardtellBtn.classList.add('hidden');

            // Reload products listing
            await loadDropdownData();
            await loadInventory();
            
            // If catalog tab is active, refresh the catalog list table too
            const catalogTableContainer = document.getElementById('catalogTableContainer');
            if (catalogTableContainer && !catalogTableContainer.classList.contains('hidden')) {
                renderCatalogTable();
            }

            if (didStock) {
                showBottomToast(`✅ Katalog & Stok "${payload.name}" berhasil disimpan! Siap dijual di kasir POS.`, 'success', 3500);
            } else {
                // Quick-Chain: if one-stop stock was NOT used, offer to restock right away via custom bottom sheet
                showBottomToast(`✅ Katalog "${payload.name}" berhasil disimpan!`, 'success', 3000);
                if (insertedProduct) {
                    showQuickConfirm(`Katalog "${payload.name}" sudah tersimpan. Mau langsung tambahkan stok kartu ini ke toko?`, () => {
                        window.triggerQuickRestock(insertedProduct.id, payload.name);
                    });
                }
            }
        } catch (err) {
            showBottomToast(`Gagal menambah produk: ${err.message}`, 'error', 4000);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
        }
    });

    // Handle restock/buyback submission
    acqForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Build items array: use cart if not empty, else use single item input row
        let itemsToSubmit = [];
        
        if (acqCartItems.length > 0) {
            // Multi-item mode: submit all items in the cart
            itemsToSubmit = acqCartItems;
        } else {
            // Single item mode: validate and use the current input row
            if (!acqProductSelect.value) {
                showBottomToast("⚠️ Pilih produk terlebih dahulu, atau masukkan kartu ke keranjang!", 'warning', 3000);
                return;
            }
            const qty = parseInt(acqQty.value) || 1;
            const sellingPrice = parseInt(acqSellingPrice.value) || 0;
            const type = acqType.value;
            let unitCost = 0;
            if (type === 'CONSIGNMENT_INTAKE') {
                const feePercent = parseFloat(consignFee.value) || 0;
                unitCost = Math.round(sellingPrice * (1 - feePercent / 100));
            } else {
                unitCost = parseInt(acqUnitCost.value) || 0;
            }
            itemsToSubmit = [{
                product_id: acqProductSelect.value,
                qty,
                condition: acqCondition.value,
                ownership_type: acqOwnership.value,
                unit_cost: unitCost,
                selling_price: sellingPrice,
                consignment_owner_id: consignOwnerSelect.value || null,
                consignment_fee_percent: parseFloat(consignFee.value) || 0
            }];
        }

        const submitBtn = document.getElementById('acqFormSubmitBtn');
        const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>⏳ Menyimpan...</span>`;
        }

        const type = acqType.value;
        const customerId = acqCustomerSelect.value || null;
        const paymentMethod = acqPaymentMethod.value;

        // Compute total cost across all items
        let totalCostVal = 0;
        const rpcItems = itemsToSubmit.map(item => {
            let unitCost = item.unit_cost;
            let itemTotal = 0;
            
            if (type === 'CONSIGNMENT_INTAKE') {
                const feePercent = item.consignment_fee_percent || 0;
                unitCost = Math.round(item.selling_price * (1 - feePercent / 100));
                itemTotal = 0;
            } else {
                itemTotal = item.qty * unitCost;
            }
            totalCostVal += itemTotal;
            
            return {
                product_id: item.product_id,
                quantity: item.qty,
                unit_cost: unitCost,
                selling_price: item.selling_price,
                ownership_type: item.ownership_type,
                consignment_owner_id: item.consignment_owner_id || null,
                consignment_fee_percent: item.consignment_fee_percent || 0,
                condition: item.condition
            };
        });

        try {
            // Run acquisition RPC transaction
            const { data, error } = await supabase.rpc('process_pos_acquisition', {
                p_type: type === 'CONSIGNMENT_INTAKE' ? 'CUSTOMER_BUYBACK' : type,
                p_customer_id: customerId,
                p_total_cost: totalCostVal,
                p_payment_status: 'PAID',
                p_payment_method: paymentMethod,
                p_items: rpcItems
            });

            if (error) throw error;

            showBottomToast('✅ Transaksi restock/buyback berhasil disimpan ke inventori!', 'success', 3500);
            acqForm.reset();
            acqProductSelect.value = '';
            const acqProductSearch = document.getElementById('acqProductSearch');
            if (acqProductSearch) acqProductSearch.value = '';
            updateAcqProductPreview('');
            acqCustomerSection.classList.add('hidden');
            consignSection.classList.add('hidden');
            acqModal.classList.add('hidden');

            // Reset multi-item cart
            acqCartItems = [];
            renderAcqCart();

            // Refresh table
            await loadInventory();
        } catch (err) {
            showBottomToast(`Gagal menyimpan transaksi: ${err.message}`, 'error', 4000);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
        }
    });

    // Autocomplete Product Search in Acquisition Form
    const acqProductSearch = document.getElementById('acqProductSearch');
    const acqProductSearchResults = document.getElementById('acqProductSearchResults');
    if (acqProductSearch) {
        acqProductSearch.addEventListener('input', (e) => {
            renderAcqProductSuggestions(e.target.value);
        });

        // Trigger suggestions as soon as input is clicked / focused
        acqProductSearch.addEventListener('focus', (e) => {
            renderAcqProductSuggestions(e.target.value);
        });

        // Hide search results if clicked outside
        document.addEventListener('click', (e) => {
            if (!acqProductSearch.contains(e.target) && !acqProductSearchResults.contains(e.target)) {
                acqProductSearchResults.classList.add('hidden');
            }
        });
    }
}

// Render searchable product options dynamically
function renderAcqProductSuggestions(query) {
    const acqProductSearch = document.getElementById('acqProductSearch');
    const acqProductSearchResults = document.getElementById('acqProductSearchResults');
    const acqProductSelect = document.getElementById('acqProductSelect');
    if (!acqProductSearch || !acqProductSearchResults) return;

    let filtered = [];
    let isDefaultList = false;

    if (query.trim() === '') {
        // Show first 15 products as default suggestions when empty
        filtered = dbProducts.slice(0, 15);
        isDefaultList = true;
    } else {
        filtered = dbProducts.filter(p => {
            return p.name.toLowerCase().includes(query.toLowerCase()) || 
                   (p.card_number && p.card_number.toLowerCase().includes(query.toLowerCase()));
        }).slice(0, 15); // Limit to top 15 matches
    }

    if (filtered.length === 0) {
        acqProductSearchResults.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center font-medium">Tidak ada produk ditemukan</div>`;
    } else {
        const titleHtml = isDefaultList 
            ? `<div class="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-400 border-b border-slate-100 uppercase tracking-wider">Rekomendasi Produk (Ketik untuk cari):</div>`
            : '';
            
        acqProductSearchResults.innerHTML = titleHtml + filtered.map(p => {
            const cardCode = p.card_number ? ` (${p.card_number})` : '';
            
            // Cardtell URL generator
            let cardtellUrl = '';
            if (p.game === 'POKEMON' && p.card_number) {
                const setCode = p.barcode ? p.barcode.split('-')[0].toUpperCase() : '';
                const setNames = {
                    'SV8A': 'Festival Terastal ex',
                    'SV7S': 'Kilat Rasi',
                    'SV6A': 'Impian Mega ex',
                    'SV2A': 'Kartu Pokémon 151',
                    'SV3': 'Kilau Hitam',
                    'DET1': 'det1'
                };
                const setName = setNames[setCode] || setCode;
                const searchKeyword = `${p.name} "${setName}" "${p.card_number}"`;
                cardtellUrl = `https://cardtell.id/search?q=${encodeURIComponent(searchKeyword)}`;
            }

            const cardtellBtn = cardtellUrl 
                ? `<a href="${cardtellUrl}" target="_blank" onclick="event.stopPropagation()" class="ml-2 inline-flex items-center gap-0.5 px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded text-[9px] font-bold border border-indigo-200 transition-colors" title="Cek harga pasar di Cardtell.id">
                     <span class="material-symbols-outlined text-[10px] align-middle">open_in_new</span> Cek Harga
                   </a>`
                : '';

            return `
                <div class="acq-search-item px-3 py-2 hover:bg-blue-50 text-xs text-slate-700 cursor-pointer font-medium border-b border-slate-100 last:border-0 transition-colors flex items-center justify-between"
                     data-id="${p.id}" data-display="${p.name}${cardCode}">
                    <div class="flex items-center">
                        <span>${p.name}${cardCode}</span>
                        ${cardtellBtn}
                    </div>
                    <span class="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded uppercase">${p.category}</span>
                </div>
            `;
        }).join('');
    }

    acqProductSearchResults.classList.remove('hidden');

    // Click handler for suggestion items
    document.querySelectorAll('.acq-search-item').forEach(el => {
        el.addEventListener('click', () => {
            acqProductSelect.value = el.dataset.id;
            acqProductSearch.value = el.dataset.display;
            acqProductSearchResults.classList.add('hidden');
            updateAcqProductPreview(el.dataset.id);
        });
    });
}

function formatRupiah(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(amount);
}

// ==========================================
// Catalog OCR Scanner Integration
// ==========================================
const catalogOcrToggleBtn = document.getElementById('catalogOcrToggleBtn');
const catalogOcrSection = document.getElementById('catalogOcrSection');
const catalogOcrVideo = document.getElementById('catalogOcrVideo');
const catalogCaptureBtn = document.getElementById('catalogCaptureBtn');
const catalogCancelScanBtn = document.getElementById('catalogCancelScanBtn');
const catalogOcrShutterFlash = document.getElementById('catalogOcrShutterFlash');
const catalogOcrSpinner = document.getElementById('catalogOcrSpinner');

let catalogCameraStream = null;

if (catalogOcrToggleBtn) {
    catalogOcrToggleBtn.addEventListener('click', async () => {
        const geminiKey = localStorage.getItem('gemini_api_key');
        if (!geminiKey) {
            alert('⚠️ Gemini API Key belum disetel. Silakan atur API Key Anda di panel kasir POS terlebih dahulu.');
            return;
        }

        try {
            catalogOcrToggleBtn.classList.add('hidden');
            catalogOcrSection.classList.remove('hidden');

            catalogCameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            catalogOcrVideo.srcObject = catalogCameraStream;
        } catch (err) {
            console.error("Camera access error:", err);
            alert('Gagal mengakses kamera: ' + err.message);
            stopCatalogCamera();
        }
    });
}

if (catalogCancelScanBtn) {
    catalogCancelScanBtn.addEventListener('click', () => {
        stopCatalogCamera();
    });
}

function stopCatalogCamera() {
    if (catalogCameraStream) {
        catalogCameraStream.getTracks().forEach(track => track.stop());
        catalogCameraStream = null;
    }
    if (catalogOcrVideo) catalogOcrVideo.srcObject = null;
    if (catalogOcrToggleBtn) catalogOcrToggleBtn.classList.remove('hidden');
    if (catalogOcrSection) catalogOcrSection.classList.add('hidden');
}

let acqCameraStream = null;
function stopAcqCamera() {
    const acqOcrToggleBtn = document.getElementById('acqOcrToggleBtn');
    const acqOcrSection = document.getElementById('acqOcrSection');
    const acqOcrVideo = document.getElementById('acqOcrVideo');

    if (acqCameraStream) {
        acqCameraStream.getTracks().forEach(track => track.stop());
        acqCameraStream = null;
    }
    if (acqOcrVideo) acqOcrVideo.srcObject = null;
    if (acqOcrToggleBtn) acqOcrToggleBtn.classList.remove('hidden');
    if (acqOcrSection) acqOcrSection.classList.add('hidden');
}

// Stop cameras if any modal is closed
document.querySelectorAll('.close-modal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        stopCatalogCamera();
        stopAcqCamera();
    });
});

// Capture and analyze frame using Gemini API
if (catalogCaptureBtn) {
    catalogCaptureBtn.addEventListener('click', async () => {
        const geminiKey = localStorage.getItem('gemini_api_key');
        if (!geminiKey) return;

        // Flash shutter effect
        if (catalogOcrShutterFlash) {
            catalogOcrShutterFlash.classList.remove('opacity-0');
            catalogOcrShutterFlash.classList.add('opacity-80');
            setTimeout(() => {
                catalogOcrShutterFlash.classList.remove('opacity-80');
                catalogOcrShutterFlash.classList.add('opacity-0');
            }, 150);
        }

        // Show spinner and freeze video
        if (catalogOcrSpinner) catalogOcrSpinner.classList.remove('hidden');
        if (catalogOcrVideo) catalogOcrVideo.pause();

        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const videoW = catalogOcrVideo.videoWidth;
            const videoH = catalogOcrVideo.videoHeight;
            
            // Set canvas size (no crop for full card / barcode scanner view)
            canvas.width = videoW;
            canvas.height = videoH;
            ctx.drawImage(catalogOcrVideo, 0, 0, videoW, videoH);

            const frameDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const base64Data = frameDataUrl.split(',')[1];

             const promptText = "Analyze this image. It can be either a Pokemon/TCG card (Singles) or a sealed product packaging showing a barcode (Sealed Pack/Box, Accessories).\n\nFirst, determine the type of product in the image:\n- If it is a Pokemon/TCG card, return JSON with: \n  1. productType: 'SINGLES'\n  2. name: Card name at the top (e.g. 'Eevee ex', 'Pikachu', 'Brambleghast')\n  3. rarity: Rarity symbol/letter at the bottom left (e.g. 'C', 'U', 'R', 'RR', 'SR', 'SAR', or 'Promo')\n  4. setCode: Set code at the bottom left (e.g. 'SV8a', 'SV2a', or null)\n  5. cardNumber: Collector number (e.g. '142', '009')\n  6. totalNumber: Total cards in set (e.g. '187', '165', or null)\n  7. language: Detect the language of the card text. Format strictly as one of: 'ID' (Indonesian), 'EN' (English), 'JP' (Japanese), 'CN' (Chinese/Mandarin Simplified), 'TW' (Chinese/Mandarin Traditional), 'KR' (Korean), or 'OTHER'.\n- If it is a product packaging with a barcode, return JSON with:\n  1. productType: 'SEALED'\n  2. barcode: Read the numeric barcode digits printed below the barcode lines (EAN/UPC barcode).\n\nFormat your response strictly as a single JSON object. If TCG card, keys must be: productType, name, rarity, setCode, cardNumber, totalNumber, language. If packaging, keys must be: productType, barcode. Do not include any markdown formatting like ```json or ```, just return the raw JSON string.";

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
                                text: promptText
                            },
                            {
                                inlineData: {
                                    mimeType: "image/jpeg",
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
                throw new Error(`Gemini API Error: ${response.status} - ${await response.text()}`);
            }

            const data = await response.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            
            // Parse JSON
            const cleanJsonText = rawText.replace(/```json|```/gi, '').trim();
            const result = JSON.parse(cleanJsonText);

            if (result.productType === 'SEALED') {
                if (result.barcode) {
                    const cleanBarcode = result.barcode.replace(/\s+/g, '');
                    
                    // Auto switch category to SEALED
                    document.getElementById('prodCategory').value = 'SEALED';
                    document.getElementById('prodCategory').dispatchEvent(new Event('change'));
                    
                    document.getElementById('prodBarcode').value = cleanBarcode;
                    
                    // Show photo preview in form
                    const previewImg = document.getElementById('catalogOcrPreviewImg');
                    const previewContainer = document.getElementById('catalogOcrPreviewContainer');
                    if (previewImg && previewContainer) {
                        previewImg.src = frameDataUrl;
                        previewContainer.classList.remove('hidden');
                    }

                    alert(`✅ Scan Barcode Berhasil!\nKategori otomatis diubah ke Sealed Pack/Box.\nBarcode EAN: ${cleanBarcode}`);
                    stopCatalogCamera();
                } else {
                    alert('⚠️ Gagal membaca barcode kemasan. Pastikan garis-garis barcode berada di tengah kotak bidik dan gambar fokus.');
                    if (catalogOcrVideo) catalogOcrVideo.play();
                }
            } else {
                // Default fallback or SINGLES
                if (result.cardNumber) {
                    // Auto switch category to SINGLES
                    document.getElementById('prodCategory').value = 'SINGLES';
                    document.getElementById('prodCategory').dispatchEvent(new Event('change'));

                    // Swap safeguard for inverted promo cards (e.g. 174/SM-P)
                    if (result.setCode && /^\d+$/.test(result.setCode) && result.cardNumber && /^[a-zA-Z\-_]+$/.test(result.cardNumber)) {
                        const temp = result.setCode;
                        result.setCode = result.cardNumber;
                        result.cardNumber = temp;
                    }

                    // Populate Card Name
                    if (result.name) {
                        document.getElementById('prodName').value = result.name;
                    }

                    // Populate Rarity
                    if (result.rarity) {
                        document.getElementById('prodRarity').value = result.rarity;
                    }

                    // Populate Language
                    if (result.language) {
                        document.getElementById('prodLanguage').value = result.language.toUpperCase();
                    }

                    // Populate Card Number
                    const fullCardNum = result.totalNumber 
                        ? `${result.cardNumber}/${result.totalNumber}` 
                        : result.cardNumber;
                    document.getElementById('prodCardNumber').value = fullCardNum;
                    
                    // Build Barcode (using fallback if setCode is missing)
                    let setPrefix = result.setCode 
                        ? result.setCode.toUpperCase() 
                        : (result.totalNumber ? result.totalNumber.toUpperCase() : 'UNKNOWN');
                    
                    // Normalize setPrefix for common OCR misreads (S-P or SMP -> SM-P)
                    if (setPrefix === 'S-P' || setPrefix === 'SMP') {
                        setPrefix = 'SM-P';
                    }

                    const cardNumClean = result.cardNumber.replace(/\D/g, '');
                    document.getElementById('prodBarcode').value = `${setPrefix}-${cardNumClean}-ID`;

                    // Handle Card Image:
                    // Official pokemon-card.com/id URL only exists for Indonesian cards ('ID').
                    // For foreign cards (CN, JP, EN, etc.), official URL gives 404/corrupt, so use camera snapshot.
                    const cardLang = (result.language || 'ID').toUpperCase();
                    let finalImgUrl = frameDataUrl;

                    if (cardLang === 'ID' && setPrefix && setPrefix !== 'UNKNOWN' && cardNumClean) {
                        const setCodeLower = setPrefix.toLowerCase();
                        const paddedNum = cardNumClean.padStart(3, '0');
                        finalImgUrl = `https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2F${setCodeLower}%2F${paddedNum}.png`;
                    }

                    document.getElementById('prodImageUrl').value = finalImgUrl;

                    // Show clean preview in form with robust fallback
                    const previewImg = document.getElementById('catalogOcrPreviewImg');
                    const previewContainer = document.getElementById('catalogOcrPreviewContainer');
                    if (previewImg && previewContainer) {
                        previewImg.src = finalImgUrl;
                        previewImg.onerror = () => {
                            previewImg.src = frameDataUrl;
                            document.getElementById('prodImageUrl').value = frameDataUrl;
                        };
                        previewContainer.classList.remove('hidden');
                    }

                    // Enable and update "Cek Harga (Cardtell)" button
                    const cardtellBtn = document.getElementById('catalogCardtellBtn');
                    if (cardtellBtn) {
                        const searchKeyword = `${result.name || ''} ${fullCardNum || ''}`.trim();
                        cardtellBtn.href = `https://cardtell.id/search?q=${encodeURIComponent(searchKeyword)}`;
                        cardtellBtn.classList.remove('hidden');
                    }
                    
                    showBottomToast(`✅ Berhasil mendeteksi: ${result.name || 'Kartu'} (${fullCardNum})`, 'success', 3500);
                    stopCatalogCamera();
                } else {
                    showBottomToast('⚠️ Gambar kurang jelas. Posisikan kartu di tengah bingkai.', 'warning', 3500);
                    if (catalogOcrVideo) catalogOcrVideo.play();
                }
            }

        } catch (err) {
            console.error("Catalog scanning error:", err);
            showBottomToast("Gagal memindai: " + err.message, 'error', 4000);
            if (catalogOcrVideo) catalogOcrVideo.play();
        } finally {
            if (catalogOcrSpinner) catalogOcrSpinner.classList.add('hidden');
        }
    });
}

// =========================================================================
// BUYBACK BATCH / CONTINUOUS CAMERA SCANNER
// =========================================================================
const acqOcrToggleBtn = document.getElementById('acqOcrToggleBtn');
const acqOcrSection = document.getElementById('acqOcrSection');
const acqOcrVideo = document.getElementById('acqOcrVideo');
const acqCaptureBtn = document.getElementById('acqCaptureBtn');
const acqCancelScanBtn = document.getElementById('acqCancelScanBtn');
const acqOcrShutterFlash = document.getElementById('acqOcrShutterFlash');
const acqOcrSpinner = document.getElementById('acqOcrSpinner');

if (acqOcrToggleBtn) {
    acqOcrToggleBtn.addEventListener('click', async () => {
        const geminiKey = localStorage.getItem('gemini_api_key');
        if (!geminiKey) {
            alert('⚠️ Gemini API Key belum disetel. Silakan atur API Key Anda di panel kasir POS terlebih dahulu.');
            return;
        }

        try {
            acqOcrToggleBtn.classList.add('hidden');
            acqOcrSection.classList.remove('hidden');

            acqCameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            acqOcrVideo.srcObject = acqCameraStream;
        } catch (err) {
            console.error("Camera access error (Buyback):", err);
            alert('Gagal mengakses kamera: ' + err.message);
            stopAcqCamera();
        }
    });
}

if (acqCancelScanBtn) {
    acqCancelScanBtn.addEventListener('click', () => {
        stopAcqCamera();
    });
}

if (acqCaptureBtn) {
    acqCaptureBtn.addEventListener('click', async () => {
        const geminiKey = localStorage.getItem('gemini_api_key');
        if (!geminiKey) return;

        // Flash shutter effect
        if (acqOcrShutterFlash) {
            acqOcrShutterFlash.classList.remove('opacity-0');
            acqOcrShutterFlash.classList.add('opacity-80');
            setTimeout(() => {
                acqOcrShutterFlash.classList.remove('opacity-80');
                acqOcrShutterFlash.classList.add('opacity-0');
            }, 150);
        }

        if (acqOcrSpinner) acqOcrSpinner.classList.remove('hidden');
        if (acqOcrVideo) acqOcrVideo.pause();

        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const videoW = acqOcrVideo.videoWidth;
            const videoH = acqOcrVideo.videoHeight;
            
            canvas.width = videoW;
            canvas.height = videoH;
            ctx.drawImage(acqOcrVideo, 0, 0, videoW, videoH);

            const frameDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            const base64Data = frameDataUrl.split(',')[1];

            const promptText = "Analyze this image. It is a Pokemon/TCG card or product barcode.\nExtract JSON with:\n1. productType: 'SINGLES' or 'SEALED'\n2. name: Card/Product Name\n3. cardNumber: Collector number (e.g. '015', '142')\n4. totalNumber: Total set cards (e.g. '129', '187' or null)\n5. setCode: Set code (e.g. 'SV4c', 'SV8a' or null)\n6. rarity: Rarity symbol/letter (e.g. 'U', 'R', 'SAR' or null)\n7. barcode: Numeric digits if sealed product.\nReturn raw JSON only without markdown.";

            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: promptText },
                            { inlineData: { mimeType: "image/jpeg", data: base64Data } }
                        ]
                    }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (!response.ok) {
                throw new Error(`Gemini API Error: ${response.status}`);
            }

            const data = await response.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const cleanJsonText = rawText.replace(/```json|```/gi, '').trim();
            const result = JSON.parse(cleanJsonText);

            // Accurate Match Logic:
            // 1. Strict match: card number AND name match
            let matchedProduct = null;
            const scanName = (result.name || '').trim().toLowerCase();
            const scanCardNum = (result.cardNumber || '').replace(/\D/g, '');
            const scanTotalNum = (result.totalNumber || '').replace(/\D/g, '');

            if (scanCardNum) {
                matchedProduct = dbProducts.find(p => {
                    const pName = (p.name || '').toLowerCase();
                    const pCardNum = (p.card_number || '').replace(/\D/g, '');
                    const pFirstNum = p.card_number ? p.card_number.split('/')[0].replace(/\D/g, '') : '';
                    
                    const numMatches = (pFirstNum === scanCardNum) || (pCardNum === scanCardNum);
                    
                    if (numMatches) {
                        // If card numbers match, require name similarity to avoid false positives!
                        if (scanName && (pName.includes(scanName) || scanName.includes(pName))) {
                            return true;
                        }
                        // If set total number also matches (e.g. 045/120 vs 045/120)
                        if (scanTotalNum && p.card_number && p.card_number.includes(scanTotalNum)) {
                            return true;
                        }
                    }
                    return false;
                });
            }

            // 2. Exact name match fallback
            if (!matchedProduct && scanName) {
                matchedProduct = dbProducts.find(p => {
                    const pName = (p.name || '').trim().toLowerCase();
                    return pName === scanName;
                });
            }

            // 3. Partial name match fallback (only if unique or very close)
            if (!matchedProduct && scanName && scanName.length >= 3) {
                matchedProduct = dbProducts.find(p => {
                    const pName = (p.name || '').toLowerCase();
                    return pName.startsWith(scanName) || scanName.startsWith(pName);
                });
            }

            if (matchedProduct) {
                const defaultQty = 1;
                const condition = 'NM';
                const ownership = document.getElementById('acqOwnership')?.value || 'OWNED';
                const defaultCost = 0;
                const defaultPrice = 0;

                const displayName = matchedProduct.name + (matchedProduct.card_number ? ` (${matchedProduct.card_number})` : '');

                acqCartItems.push({
                    product_id: matchedProduct.id,
                    name: displayName,
                    image_url: matchedProduct.image_url || null,
                    qty: defaultQty,
                    condition: condition,
                    ownership_type: ownership,
                    unit_cost: defaultCost,
                    selling_price: defaultPrice,
                    consignment_owner_id: null,
                    consignment_fee_percent: 0
                });

                renderAcqCart();

                // Play video again immediately so user can scan NEXT card
                if (acqOcrVideo) acqOcrVideo.play();

                // Show Clear Floating Toast Banner Feedback
                const toast = document.getElementById('acqOcrToast');
                const toastMsg = document.getElementById('acqOcrToastMsg');
                if (toast && toastMsg) {
                    toastMsg.textContent = `✅ Masuk Keranjang: ${displayName}`;
                    toast.classList.remove('hidden');
                    setTimeout(() => {
                        toast.classList.add('hidden');
                    }, 2500);
                }

                // Update button indicator
                const count = acqCartItems.length;
                acqCaptureBtn.innerHTML = `<span class="material-symbols-outlined text-[16px]">check_circle</span> Masuk Keranjang (${count})! Pindai Lagi...`;
                setTimeout(() => {
                    acqCaptureBtn.innerHTML = `<span class="material-symbols-outlined text-[16px]">photo_camera</span> Pindai & Masukkan Keranjang`;
                }, 1800);

            } else {
                const cardLabel = result.name ? `"${result.name}"${result.cardNumber ? ` (${result.cardNumber})` : ''}` : 'Kartu ini';
                showBottomToast(`⚠️ ${cardLabel} belum ada di katalog. Tambahkan ke katalog dulu.`, 'warning', 4000);
                if (acqOcrVideo) acqOcrVideo.play();
            }

        } catch (err) {
            console.error("Buyback scanning error:", err);
            showBottomToast("Gagal memindai: " + err.message, 'error', 4000);
            if (acqOcrVideo) acqOcrVideo.play();
        } finally {
            if (acqOcrSpinner) acqOcrSpinner.classList.add('hidden');
        }
    });
}

// =========================================================================
// TAB CONTROL & MASTER CATALOG LISTING LOGIC
// =========================================================================
const tabLotsBtn = document.getElementById('tabLotsBtn');
const tabCatalogBtn = document.getElementById('tabCatalogBtn');
const lotsTableContainer = document.getElementById('lotsTableContainer');
const catalogTableContainer = document.getElementById('catalogTableContainer');

if (tabLotsBtn && tabCatalogBtn) {
    tabLotsBtn.addEventListener('click', () => {
        tabLotsBtn.className = "px-4 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white shadow-sm border border-slate-800 transition-colors cursor-pointer flex items-center gap-1.5";
        tabCatalogBtn.className = "px-4 py-2 text-xs font-bold rounded-lg bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 transition-colors cursor-pointer flex items-center gap-1.5";
        lotsTableContainer.classList.remove('hidden');
        catalogTableContainer.classList.add('hidden');
    });

    tabCatalogBtn.addEventListener('click', () => {
        tabCatalogBtn.className = "px-4 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white shadow-sm border border-slate-800 transition-colors cursor-pointer flex items-center gap-1.5";
        tabLotsBtn.className = "px-4 py-2 text-xs font-bold rounded-lg bg-white text-slate-600 hover:bg-slate-50 border border-slate-200 transition-colors cursor-pointer flex items-center gap-1.5";
        catalogTableContainer.classList.remove('hidden');
        lotsTableContainer.classList.add('hidden');
        renderCatalogTable();
    });
}

let catalogSearchFilter = "";
const catalogSearchInput = document.getElementById('catalogSearch');
if (catalogSearchInput) {
    catalogSearchInput.addEventListener('input', (e) => {
        catalogSearchFilter = e.target.value;
        renderCatalogTable();
    });
}

function renderCatalogTable() {
    const catalogTableBody = document.getElementById('catalogTableBody');
    if (!catalogTableBody) return;

    const filtered = dbProducts.filter(p => {
        return catalogSearchFilter === '' || 
            p.name.toLowerCase().includes(catalogSearchFilter.toLowerCase()) ||
            (p.card_number && p.card_number.toLowerCase().includes(catalogSearchFilter.toLowerCase())) ||
            (p.barcode && p.barcode.toLowerCase().includes(catalogSearchFilter.toLowerCase()));
    });

    if (filtered.length === 0) {
        catalogTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center p-8 text-slate-400">Tidak ada katalog produk ditemukan</td>
            </tr>
        `;
        return;
    }

    catalogTableBody.innerHTML = filtered.map(p => {
        // Card image thumbnail
        const imgHtml = p.image_url 
            ? `<img src="${p.image_url}" class="w-8 h-12 object-cover rounded shadow border border-slate-100 mr-3 shrink-0" />`
            : `<div class="w-8 h-12 bg-slate-50 flex items-center justify-center rounded border border-dashed border-slate-200 mr-3 text-slate-400 shrink-0 select-none">
                 <span class="material-symbols-outlined text-[16px]">image</span>
               </div>`;

        // Language Badge
        let langBadge = '';
        if (p.language) {
            const langNames = {
                'ID': 'Indo',
                'EN': 'Eng',
                'JP': 'Jpn',
                'CN': 'CN',
                'TW': 'TW/HK',
                'KR': 'Kor',
                'OTHER': 'Lain'
            };
            const langColors = {
                'ID': 'bg-red-50 text-red-700 border-red-200',
                'EN': 'bg-blue-50 text-blue-700 border-blue-200',
                'JP': 'bg-amber-50 text-amber-700 border-amber-200',
                'CN': 'bg-emerald-50 text-emerald-700 border-emerald-200',
                'TW': 'bg-teal-50 text-teal-700 border-teal-200',
                'KR': 'bg-indigo-50 text-indigo-700 border-indigo-200',
                'OTHER': 'bg-slate-50 text-slate-700 border-slate-200'
            };
            const name = langNames[p.language.toUpperCase()] || p.language;
            const color = langColors[p.language.toUpperCase()] || 'bg-slate-50 text-slate-700 border-slate-200';
            langBadge = `<span class="ml-1.5 px-1.5 py-0.5 rounded border text-[9px] font-bold ${color}">${name}</span>`;
        }

        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-4 flex items-center">
                    ${imgHtml}
                    <div>
                        <div class="flex items-center">
                            <p class="font-bold text-slate-800">${p.name}</p>
                            ${langBadge}
                        </div>
                        ${p.card_number ? `<p class="text-[10px] text-slate-400 font-mono mt-0.5">${p.card_number}</p>` : ''}
                    </div>
                </td>
                <td class="p-4 uppercase font-semibold text-slate-500">${p.category}</td>
                <td class="p-4 font-semibold text-slate-600">${p.game || '-'}</td>
                <td class="p-4 font-mono">${p.rarity || '-'}</td>
                <td class="p-4 font-mono font-semibold text-slate-500">${p.barcode || '-'}</td>
                <td class="p-4 text-center">
                    <button onclick="triggerQuickRestock('${p.id}', '${p.name.replace(/'/g, "\\'")}')" class="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded text-xs font-bold border border-blue-200 transition-colors cursor-pointer">
                        📦 Restock
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

window.triggerQuickRestock = function(productId, productName) {
    // Open restock modal
    const acqModal = document.getElementById('acqModal');
    if (acqModal) {
        acqModal.classList.remove('hidden');
        
        // Populate inputs
        document.getElementById('acqProductSelect').value = productId;
        document.getElementById('acqProductSearch').value = productName;
        updateAcqProductPreview(productId);
    }
};

function updateAcqProductPreview(productId) {
    const previewImg = document.getElementById('acqProductPreviewImg');
    const previewContainer = document.getElementById('acqProductPreviewContainer');
    
    if (!previewImg || !previewContainer) return;
    
    if (!productId) {
        previewImg.classList.add('hidden');
        previewContainer.classList.add('hidden');
        return;
    }
    
    const product = dbProducts.find(p => p.id === productId);
    if (product && product.image_url) {
        previewImg.src = product.image_url;
        previewImg.classList.remove('hidden');
        previewContainer.classList.add('hidden');
    } else {
        previewImg.classList.add('hidden');
        previewContainer.classList.remove('hidden');
    }
}

// =========================================================================
// MULTI-ITEM BUYBACK CART
// =========================================================================
function renderAcqCart() {
    const cart = acqCartItems;
    const cartContainer = document.getElementById('acqItemsCart');
    const cartBody = document.getElementById('acqCartBody');
    const cartCount = document.getElementById('acqCartCount');
    const totalPayoutEl = document.getElementById('acqCartTotalPayout');
    const totalSellingEl = document.getElementById('acqCartTotalSelling');
    
    if (!cartContainer || !cartBody) return;
    
    if (cart.length === 0) {
        cartContainer.classList.add('hidden');
        return;
    }
    
    cartContainer.classList.remove('hidden');
    if (cartCount) cartCount.textContent = cart.length;

    let totalPayout = 0;
    let totalSelling = 0;

    cartBody.innerHTML = cart.map((item, idx) => {
        const itemPayout = (item.qty || 1) * (item.unit_cost || 0);
        const itemSell = (item.qty || 1) * (item.selling_price || 0);
        totalPayout += itemPayout;
        totalSelling += itemSell;

        return `
            <div class="p-2.5 text-xs space-y-2 hover:bg-slate-100/60 transition-colors">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                        ${item.image_url ? `<img src="${item.image_url}" class="w-6 h-8 object-cover rounded shadow border border-slate-200 shrink-0" />` : '<div class="w-6 h-8 bg-slate-200 rounded shrink-0"></div>'}
                        <div class="min-w-0">
                            <p class="font-bold text-slate-800 truncate">${item.name}</p>
                            <span class="text-[9px] text-slate-400 uppercase font-mono">${item.ownership_type === 'CONSIGNMENT' ? 'Titip Jual' : 'Milik Toko'}</span>
                        </div>
                    </div>
                    <button type="button" onclick="removeAcqCartItem(${idx})" class="text-red-400 hover:text-red-600 p-1 shrink-0 cursor-pointer" title="Hapus dari keranjang">
                        <span class="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
                <!-- Interactive Price & Qty Row -->
                <div class="grid grid-cols-12 gap-1.5 items-center">
                    <div class="col-span-2">
                        <label class="block text-[9px] text-slate-400 font-bold">Qty</label>
                        <input type="number" min="1" value="${item.qty}" oninput="updateAcqCartField(${idx}, 'qty', this.value)" class="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[11px] text-center font-bold" />
                    </div>
                    <div class="col-span-3">
                        <label class="block text-[9px] text-slate-400 font-bold">Kondisi</label>
                        <select onchange="updateAcqCartField(${idx}, 'condition', this.value)" class="w-full bg-white border border-slate-200 rounded px-1 py-1 text-[10px] font-bold">
                            <option value="NM" ${item.condition === 'NM' ? 'selected' : ''}>NM</option>
                            <option value="LP" ${item.condition === 'LP' ? 'selected' : ''}>LP</option>
                            <option value="MP" ${item.condition === 'MP' ? 'selected' : ''}>MP</option>
                            <option value="HP" ${item.condition === 'HP' ? 'selected' : ''}>HP</option>
                            <option value="DMG" ${item.condition === 'DMG' ? 'selected' : ''}>DMG</option>
                        </select>
                    </div>
                    <div class="col-span-4">
                        <label class="block text-[9px] text-blue-600 font-bold">HPP Beli (Rp)</label>
                        <input type="number" min="0" value="${item.unit_cost || ''}" placeholder="0" oninput="updateAcqCartField(${idx}, 'unit_cost', this.value)" class="w-full bg-white border border-blue-200 rounded px-1.5 py-1 text-[11px] font-bold text-blue-700" />
                    </div>
                    <div class="col-span-3">
                        <label class="block text-[9px] text-slate-500 font-bold">Jual (Rp)</label>
                        <input type="number" min="0" value="${item.selling_price || ''}" placeholder="0" oninput="updateAcqCartField(${idx}, 'selling_price', this.value)" class="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-[11px] font-semibold text-slate-700" />
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (totalPayoutEl) totalPayoutEl.textContent = formatRupiah(totalPayout);
    if (totalSellingEl) totalSellingEl.textContent = formatRupiah(totalSelling);
}

window.updateAcqCartField = function(idx, field, val) {
    if (!acqCartItems[idx]) return;
    if (field === 'qty') {
        acqCartItems[idx].qty = parseInt(val) || 1;
    } else if (field === 'unit_cost') {
        acqCartItems[idx].unit_cost = parseInt(val) || 0;
    } else if (field === 'selling_price') {
        acqCartItems[idx].selling_price = parseInt(val) || 0;
    } else if (field === 'condition') {
        acqCartItems[idx].condition = val;
    }

    // Re-compute totals without re-rendering inputs to preserve focus
    let totalPayout = 0;
    let totalSelling = 0;
    for (const item of acqCartItems) {
        totalPayout += (item.qty || 1) * (item.unit_cost || 0);
        totalSelling += (item.qty || 1) * (item.selling_price || 0);
    }
    const totalPayoutEl = document.getElementById('acqCartTotalPayout');
    const totalSellingEl = document.getElementById('acqCartTotalSelling');
    if (totalPayoutEl) totalPayoutEl.textContent = formatRupiah(totalPayout);
    if (totalSellingEl) totalSellingEl.textContent = formatRupiah(totalSelling);
};

window.removeAcqCartItem = function(idx) {
    acqCartItems.splice(idx, 1);
    renderAcqCart();
};
