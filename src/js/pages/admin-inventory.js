import { supabase } from '../core/supabase.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let inventoryLots = [];
let dbProducts = [];
let dbProfiles = [];
let searchFilter = '';

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
        const { data: prodData } = await supabase.from('pm_products').select('id, name, category, card_number, game, barcode').order('name');
        dbProducts = prodData || [];

        // Reset product selection values
        acqProductSelect.value = '';
        const acqProductSearch = document.getElementById('acqProductSearch');
        if (acqProductSearch) acqProductSearch.value = '';

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

    // Handle catalog product creation
    productForm.addEventListener('submit', async (e) => {
        e.preventDefault();
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
            if (!proceed) return;
        }

        try {
            const { error } = await supabase.from('pm_products').insert(payload);
            if (error) throw error;

            alert('Katalog produk baru berhasil ditambahkan!');
            productForm.reset();
            productModal.classList.add('hidden');

            // Reload products listing
            await loadDropdownData();
        } catch (err) {
            alert(`Gagal menambah produk: ${err.message}`);
        }
    });

    // Handle restock/buyback submission
    acqForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const type = acqType.value;
        const customerId = acqCustomerSelect.value || null;
        const qty = parseInt(acqQty.value);
        const sellingPrice = parseInt(acqSellingPrice.value);
        const paymentMethod = acqPaymentMethod.value;

        let unitCost = 0;
        let totalCostVal = 0;

        if (type === 'CONSIGNMENT_INTAKE') {
            // Consignment HPP (Payout to owner) = Selling Price * (1 - fee/100)
            const feePercent = parseFloat(consignFee.value) || 0;
            unitCost = Math.round(sellingPrice * (1 - feePercent / 100));
            totalCostVal = 0; // Rp 0 cash paid out immediately!
        } else {
            unitCost = parseInt(acqUnitCost.value) || 0;
            totalCostVal = qty * unitCost;
        }

        // Compile items JSON
        const items = [{
            product_id: acqProductSelect.value,
            quantity: qty,
            unit_cost: unitCost,
            selling_price: sellingPrice,
            ownership_type: acqOwnership.value,
            consignment_owner_id: consignOwnerSelect.value || null,
            consignment_fee_percent: parseFloat(consignFee.value) || 0,
            condition: acqCondition.value
        }];

        try {
            // Run acquisition RPC transaction
            const { data, error } = await supabase.rpc('process_pos_acquisition', {
                p_type: type === 'CONSIGNMENT_INTAKE' ? 'CUSTOMER_BUYBACK' : type,
                p_customer_id: customerId,
                p_total_cost: totalCostVal,
                p_payment_status: 'PAID',
                p_payment_method: paymentMethod,
                p_items: items
            });

            if (error) throw error;

            alert('Transaksi restock berhasil dicatat ke inventori!');
            acqForm.reset();
            acqProductSelect.value = '';
            const acqProductSearch = document.getElementById('acqProductSearch');
            if (acqProductSearch) acqProductSearch.value = '';
            acqCustomerSection.classList.add('hidden');
            consignSection.classList.add('hidden');
            acqModal.classList.add('hidden');

            // Refresh table
            await loadInventory();
        } catch (err) {
            alert(`Gagal menyimpan transaksi masuk: ${err.message}`);
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

// Stop camera if productModal is closed
document.querySelectorAll('.close-modal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        stopCatalogCamera();
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

                    // Generate official illustration URL if setPrefix and cardNumber are present
                    const setCodeLower = setPrefix.toLowerCase();
                    const paddedNum = cardNumClean.padStart(3, '0');
                    const generatedImgUrl = `https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2F${setCodeLower}%2F${paddedNum}.png`;
                    document.getElementById('prodImageUrl').value = generatedImgUrl;

                    // Show photo preview in form
                    const previewImg = document.getElementById('catalogOcrPreviewImg');
                    const previewContainer = document.getElementById('catalogOcrPreviewContainer');
                    if (previewImg && previewContainer) {
                        previewImg.src = frameDataUrl;
                        previewContainer.classList.remove('hidden');
                    }
                    
                    alert(`✅ Scan Kartu Berhasil!\n\nNama: ${result.name || '-'}\nBahasa: ${result.language || '-'}\nRarity: ${result.rarity || '-'}\nKode Kartu: ${fullCardNum}\nBarcode: ${document.getElementById('prodBarcode').value}`);
                    stopCatalogCamera();
                } else {
                    alert('⚠️ Gagal memindai gambar. Pastikan objek kartu atau barcode terlihat jelas dan terfokus di dalam kamera.');
                    if (catalogOcrVideo) catalogOcrVideo.play();
                }
            }

        } catch (err) {
            console.error("Catalog scanning error:", err);
            alert("Gagal memindai: " + err.message);
            if (catalogOcrVideo) catalogOcrVideo.play();
        } finally {
            if (catalogOcrSpinner) catalogOcrSpinner.classList.add('hidden');
        }
    });
}
