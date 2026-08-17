import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Rekber Transaction Room
 * Handles lifecycle of a single Escrow transaction
 */

import { sbClient } from '../core/supabase.js';
import { showNotification, getRelativeTime, escapeHTML } from '../core/utils.js';
import { getCurrentUser } from '../modules/user-session.js';
import { calculateUserLevel } from '../modules/ranks.js';

let currentTransaction = null;
let currentUser = null;
let messageSubscription = null;

/**
 * Initialize Rekber Page
 */
export async function initializeRekberPage() {
    currentUser = getCurrentUser();
    if (!currentUser) {
        window.location.href = '/';
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const transactionId = urlParams.get('id');

    if (!transactionId) {
        window.location.href = '/marketplace';
        return;
    }

    await loadTransactionData(transactionId);
    setupChatForm();
    setupRealtimeSubscription(transactionId);
}

/**
 * Load Transaction Data & UI
 */
async function loadTransactionData(id) {
    try {
        const { data, error } = await sbClient
            .from('rekber_transactions')
            .select('*, products(id, name, price, image_url), buyer:profiles!rekber_transactions_buyer_id_fkey(*), seller:profiles!rekber_transactions_seller_id_fkey(*)')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data) throw new Error('Transaksi tidak ditemukan.');

        // Security check
        const isAdmin = currentUser.user_level === 'Admin';
        const isParticipant = currentUser.id === data.buyer_id || currentUser.id === data.seller_id;

        if (!isAdmin && !isParticipant) {
            showNotification('Maaf, kamu tidak punya akses ke ruang ini. 🔒', 'error');
            setTimeout(() => window.location.href = '/marketplace', 1500);
            return;
        }

        currentTransaction = data;

        renderHeader(data);
        renderParties(data);
        renderChat(id);
        renderContextActions(data);
        updateProgressTracker(data.status);
        renderInstructions(data);

    } catch (err) {
        logger.error('Error loading rekber:', err);
        showNotification(err.message, 'error');
    }
}

/**
* Render Dynamic Instructions
*/
function renderInstructions(tx) {
    const textEl = document.getElementById('instructionText');
    const boxEl = document.getElementById('instructionBox');
    if (!textEl || !boxEl) return;

    const isBuyer = currentUser.id === tx.buyer_id;
    const isSeller = currentUser.id === tx.seller_id;
    const isAdmin = currentUser.user_level === 'Admin';

    let instruction = "Menunggu pembaruan status...";

    switch (tx.status) {
        case 'REQUESTED':
            if (isSeller) instruction = "Klik tombol <b>'Setujui Rekber'</b> jika Anda siap mengirim barang ini sesuai harga yang tertera.";
            else if (isBuyer) instruction = "Menunggu Penjual menyetujui permintaan Anda. Anda akan diberitahu jika sudah disetujui.";
            else instruction = "Menunggu Penjual menyetujui transaksi ini.";
            break;
        case 'APPROVED':
            if (isBuyer) instruction = "Silakan lakukan pembayaran ke rekening JDK dan klik tombol <b>'Upload Bukti'</b> di bawah.";
            else if (isSeller) instruction = "Menunggu Pembeli melakukan pembayaran ke Admin JDK.";
            else instruction = "Menunggu Pembeli melakukan pembayaran.";
            break;
        case 'WAITING_PAYMENT':
            if (isBuyer) instruction = "Silakan klik tombol <b>'Upload Bukti'</b> untuk mengirim bukti transfer Anda.";
            else instruction = "Menunggu Pembeli mengunggah bukti pembayaran.";
            break;
        case 'VERIFYING':
            if (isAdmin) instruction = "Cek mutasi bank JDK. Jika uang sudah masuk, klik <b>'Verifikasi Pembayaran'</b>.";
            else instruction = "Admin sedang memverifikasi bukti pembayaran. Mohon tunggu sebentar.";
            break;
        case 'ON_SHIPPING':
            if (isSeller && !tx.shipping_receipt) instruction = "Silakan kirim paket Anda dan masukkan nomor resi dengan klik tombol <b>'Input Resi'</b>.";
            else if (isBuyer) instruction = "Penjual sedang menyiapkan/mengirim barang. Cek nomor resi secara berkala.";
            else instruction = "Menunggu Penjual mengirimkan barang dan menginput resi.";
            break;
        case 'DELIVERED':
            if (isBuyer) instruction = "Jika barang sudah Anda terima dan sesuai, silakan klik tombol <b>'Barang Sudah Sampai'</b>.";
            else if (isAdmin) instruction = "Barang sudah diterima Buyer. Silakan klik <b>'Cairkan Dana'</b> untuk mengirim uang ke Seller.";
            else instruction = "Barang sudah sampai. Menunggu konfirmasi akhir dan pencairan dana.";
            break;
        case 'FINISHED':
            instruction = "Transaksi sukses! Dana telah diteruskan ke Penjual. Terima kasih telah menggunakan JDK Rekber.";
            boxEl.className = "bg-green-100 border-2 border-dashed border-green-600 rounded-2xl p-4 flex gap-3 items-center";
            break;
        case 'CANCELLED':
            instruction = "Transaksi ini telah dibatalkan.";
            boxEl.className = "bg-gray-100 border-2 border-dashed border-gray-600 rounded-2xl p-4 flex gap-3 items-center";
            break;
        case 'DISPUTE':
            instruction = "Terjadi kendala (Komplain). Admin akan menengahi diskusi di sini.";
            boxEl.className = "bg-red-100 border-2 border-dashed border-red-600 rounded-2xl p-4 flex gap-3 items-center";
            break;
    }

    textEl.innerHTML = instruction;
}

/**
 * Render Header Info
 */
function renderHeader(tx) {
    document.getElementById('productTitle').textContent = tx.products?.name || 'Item Terhapus';
    document.getElementById('transactionId').textContent = `TRX-ID: ${tx.id.substring(0, 8).toUpperCase()}`;
    document.getElementById('transactionAmount').textContent = `Rp ${tx.amount.toLocaleString()}`;

    const feeEl = document.getElementById('adminFeeDisplay');
    if (feeEl) feeEl.textContent = `FEE (JDK): Rp ${tx.admin_fee?.toLocaleString() || '0'}`;

    const pill = document.getElementById('statusPill');
    if (pill) {
        pill.textContent = tx.status;
        pill.className = `status-pill status-${tx.status}`;
    }

    if (tx.shipping_receipt) {
        const card = document.getElementById('shippingCard');
        if (card) {
            card.classList.remove('hidden');
            document.getElementById('receiptNumber').textContent = tx.shipping_receipt;
        }
    }
}

/**
 * Render Parties info
 */
function renderParties(tx) {
    const isBuyer = currentUser.id === tx.buyer_id;
    const isSeller = currentUser.id === tx.seller_id;

    document.getElementById('buyerName').textContent = `@${tx.buyer?.username || 'Buyer'}`;
    document.getElementById('buyerAvatar').src = tx.buyer?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tx.buyer?.username}`;

    document.getElementById('sellerName').textContent = `@${tx.seller?.username || 'Seller'}`;
    document.getElementById('sellerAvatar').src = tx.seller?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${tx.seller?.username}`;

    // Highlight current user's role
    const buyerRow = document.getElementById('buyerAvatar').closest('.flex');
    const sellerRow = document.getElementById('sellerAvatar').closest('.flex');

    if (isBuyer && buyerRow) {
        buyerRow.classList.add('bg-yellow-100', 'rounded-xl', 'p-2', '-m-2', 'border-2', 'border-yellow-400');
        const badge = document.createElement('span');
        badge.className = 'ml-auto text-[9px] font-black uppercase bg-yellow-400 text-black px-2 py-0.5 rounded-full border border-black';
        badge.textContent = '👈 KAMU';
        buyerRow.appendChild(badge);
    }

    if (isSeller && sellerRow) {
        sellerRow.classList.add('bg-blue-50', 'rounded-xl', 'p-2', '-m-2', 'border-2', 'border-blue-400');
        const badge = document.createElement('span');
        badge.className = 'ml-auto text-[9px] font-black uppercase bg-blue-400 text-white px-2 py-0.5 rounded-full border border-black';
        badge.textContent = '👈 KAMU';
        sellerRow.appendChild(badge);
    }
}

/**
 * Update Progress Tracker
 */
function updateProgressTracker(status) {
    const dots = {
        'APPROVED': 'dot-approved',
        'WAITING_PAYMENT': 'dot-payment',
        'VERIFYING': 'dot-payment',
        'ON_SHIPPING': 'dot-shipping',
        'DELIVERED': 'dot-shipping',
        'FINISHED': 'dot-finished'
    };

    // Reset dots (Desktop & Mobile)
    document.querySelectorAll('.progress-dot').forEach(d => d.classList.remove('active', 'complete'));
    document.querySelectorAll('.rekber-step-item').forEach(d => d.classList.remove('active', 'complete'));

    // REQUESTED is always complete
    const dotMap = ['REQUESTED', 'APPROVED', 'WAITING_PAYMENT', 'VERIFYING', 'ON_SHIPPING', 'DELIVERED', 'FINISHED'];
    const currentIndex = dotMap.indexOf(status);

    dotMap.forEach((s, i) => {
        // Desktop
        const dotId = dots[s];
        if (dotId) {
            const el = document.getElementById(dotId);
            if (el) {
                if (i < currentIndex) el.classList.add('complete');
                if (i === currentIndex) el.classList.add('active');
            }
        }

        // Mobile
        const mobDotId = 'mob-' + dots[s]; // derived ID
        const mobEl = document.getElementById(mobDotId);
        // Special case for REQUESTED which is first item without ID in my HTML, but let's target by class or add ID if needed.
        // Actually I hardcoded REQUESTED as complete in HTML. Let's make it dynamic if we want full correctness.
        // For now, let's just handle the dynamic ones.
        if (mobEl) {
            if (i < currentIndex) mobEl.classList.add('complete');
            if (i === currentIndex) mobEl.classList.add('active');
        }
    });

    // Ensure First item (REQUESTED) is always complete/active if index >= 0
    const reqMobile = document.querySelector('.rekber-step-item:first-child');
    if (reqMobile) {
        if (currentIndex > 0) reqMobile.classList.add('complete');
        if (currentIndex === 0) reqMobile.classList.add('active');
    }
}

/**
 * Render Contextual Action Buttons
 */
function renderContextActions(tx) {
    const container = document.getElementById('contextActions');
    if (!container) return;
    container.innerHTML = '';

    const isBuyer = currentUser.id === tx.buyer_id;
    const isSeller = currentUser.id === tx.seller_id;
    const isAdmin = currentUser.user_level === 'Admin';

    // 1. REQUESTED -> Seller need to Approve
    if (tx.status === 'REQUESTED' && isSeller) {
        addActionButton(container, '✅ Setujui Rekber', 'bg-green-500 text-white', (e) => handleSellerApprove(e.target));
        addActionButton(container, '❌ Tolak', 'bg-gray-200 text-black', (e) => handleSellerCancel(e.target));
    }
    // 1b. REQUESTED -> Buyer can cancel their own request
    if (tx.status === 'REQUESTED' && isBuyer) {
        addActionButton(container, '❌ Batalkan Request', 'bg-red-100 text-red-700', (e) => handleBuyerCancel(e.target));
    }

    // 2. APPROVED -> Buyer need to Pay
    if (tx.status === 'APPROVED' && isBuyer) {
        addActionButton(container, '💰 Saya Sudah Bayar (Upload Bukti)', 'bg-yellow-400 text-black', () => openProofModal());
        addActionButton(container, '❌ Batalkan Rekber', 'bg-red-100 text-red-700', (e) => handleBuyerCancel(e.target));
    }
    // 2b. APPROVED -> Seller can cancel before buyer pays
    if (tx.status === 'APPROVED' && isSeller) {
        addActionButton(container, '❌ Batalkan Rekber', 'bg-red-100 text-red-700', (e) => handleSellerCancel(e.target));
    }

    // 3. VERIFYING -> Admin need to Verify
    if (tx.status === 'VERIFYING' && isAdmin) {
        addActionButton(container, '✅ Verifikasi Pembayaran', 'bg-green-500 text-white', (e) => handleAdminVerify(e.target));
    }

    // 4. ON_SHIPPING -> Seller need to input receipt
    if (tx.status === 'ON_SHIPPING' && isSeller && !tx.shipping_receipt) {
        addActionButton(container, '📦 Input Nomor Resi', 'bg-blue-500 text-white', () => promptShippingReceipt());
    }

    // 5. ON_SHIPPING/DELIVERED -> Buyer confirm delivery
    if ((tx.status === 'ON_SHIPPING' || tx.status === 'DELIVERED') && isBuyer) {
        addActionButton(container, '📦 Barang Saya Sudah Sampai', 'bg-green-500 text-white', () => handleBuyerConfirm());
    }

    // 6. DELIVERED/DISPUTE -> Admin Releases Fund
    if ((tx.status === 'DELIVERED' || tx.status === 'DISPUTE') && isAdmin) {
        addActionButton(container, '💸 Cairkan Dana ke Seller', 'bg-primary text-black', (e) => handleFinishTransaction(e.target));
    }
}

function addActionButton(container, text, classes, onClick) {
    const btn = document.createElement('button');
    btn.className = `${classes} px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-tighter border-2 border-black shadow-[2px_2px_0_#000] hover:translate-y-0.5 hover:shadow-none transition-all`;
    btn.textContent = text;
    btn.onclick = onClick;
    container.appendChild(btn);
}

// --- Status Handlers ---

async function updateStatus(newStatus, systemMsg = null, btnEl = null) {
    let originalText = '';
    if (btnEl) {
        originalText = btnEl.textContent;
        btnEl.disabled = true;
        btnEl.textContent = 'MEMPROSES...';
    }

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageRekber',
                sub_action: 'updateStatus',
                transaction_id: currentTransaction.id,
                data: { status: newStatus, message: systemMsg }
            }
        });

        if (error) throw error;

        // Handle JSON-wrapped errors from Edge Function (200 OK but with error body)
        if (data && data.success === false) {
            throw new Error(data.error || 'Terjadi kesalahan sistem.');
        }

        showNotification('Status berhasil diperbarui!', 'success');
        setTimeout(() => window.location.reload(), 800);
    } catch (err) {
        logger.error('Update status error:', err);
        showNotification(err.message, 'error');
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = originalText;
        }
    }
}

async function handleSellerApprove(btnEl) {
    if (!confirm('Setujui permintaan rekber ini?')) return;

    let originalText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = 'MENYETUJUI...';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageRekber',
                sub_action: 'approve',
                transaction_id: currentTransaction.id
            }
        });

        if (error) throw error;

        if (data && data.success === false) {
            throw new Error(data.error || 'Gagal menyetujui transaksi.');
        }

        showNotification('Transaksi disetujui! Menunggu pembayaran.', 'success');
        setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
        logger.error('Approve error:', err);
        showNotification(err.message, 'error');
        btnEl.disabled = false;
        btnEl.textContent = originalText;
    }
}

async function handleSellerCancel(btnEl) {
    if (!confirm('Yakin ingin membatalkan rekber ini?')) return;

    let originalText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = 'MEMBATALKAN...';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageRekber',
                sub_action: 'sellerCancel',
                transaction_id: currentTransaction.id
            }
        });
        if (error) throw error;
        if (data && data.success === false) throw new Error(data.error || 'Gagal membatalkan.');

        showNotification('Rekber dibatalkan.', 'success');
        setTimeout(() => window.location.reload(), 800);
    } catch (err) {
        logger.error('Seller cancel error:', err);
        showNotification(err.message, 'error');
        btnEl.disabled = false;
        btnEl.textContent = originalText;
    }
}

async function handleBuyerCancel(btnEl) {
    if (!confirm('Yakin ingin membatalkan rekber ini?')) return;

    let originalText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = 'MEMBATALKAN...';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageRekber',
                sub_action: 'buyerCancel',
                transaction_id: currentTransaction.id
            }
        });
        if (error) throw error;
        if (data && data.success === false) throw new Error(data.error || 'Gagal membatalkan.');

        showNotification('Rekber dibatalkan.', 'success');
        setTimeout(() => window.location.reload(), 800);
    } catch (err) {
        logger.error('Buyer cancel error:', err);
        showNotification(err.message, 'error');
        btnEl.disabled = false;
        btnEl.textContent = originalText;
    }
}

/**
 * Handle Payment Proof Upload
 */
function openProofModal() {
    const modal = document.getElementById('uploadProofModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

window.addEventListener('DOMContentLoaded', () => {
    // Modal image preview
    const proofInput = document.getElementById('proofInput');
    const previewImg = document.getElementById('previewImg');
    if (proofInput) {
        proofInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    previewImg.src = ev.target.result;
                    previewImg.classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            }
        };
    }

    const btnSubmitProof = document.getElementById('btnSubmitProof');
    if (btnSubmitProof) {
        btnSubmitProof.onclick = async () => {
            const file = document.getElementById('proofInput').files[0];
            if (!file) return showNotification('Pilih foto bukti dulu!', 'error');

            btnSubmitProof.disabled = true;
            btnSubmitProof.textContent = 'MENGUPLOAD...';

            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `proof_${currentTransaction.id}_${Date.now()}.${fileExt}`;
                const { error: uploadError } = await sbClient.storage
                    .from('transaction-proofs')
                    .upload(fileName, file);

                if (uploadError) throw uploadError;

                const { data: { publicUrl } } = sbClient.storage.from('transaction-proofs').getPublicUrl(fileName);

                const { error } = await sbClient.functions.invoke('jdk-secure-handler', {
                    body: {
                        action: 'adminManageRekber',
                        sub_action: 'uploadProof',
                        transaction_id: currentTransaction.id,
                        data: { proof_url: publicUrl }
                    }
                });

                if (error) throw error;
                window.location.reload();

            } catch (err) {
                showNotification(err.message, 'error');
                btnSubmitProof.disabled = false;
                btnSubmitProof.textContent = '🚀 KIRIM SEKARANG';
            }
        };
    }
});

async function handleAdminVerify(btnEl) {
    if (!confirm('Konfirmasi: Dana sudah masuk ke mutasi JDK?')) return;

    let originalText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = 'MEMVERIFIKASI...';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageRekber',
                sub_action: 'verify',
                transaction_id: currentTransaction.id
            }
        });
        if (error) throw error;

        if (data && data.success === false) {
            throw new Error(data.error || 'Gagal verifikasi pembayaran.');
        }

        showNotification('Pembayaran diverifikasi!', 'success');
        setTimeout(() => window.location.reload(), 800);
    } catch (err) {
        showNotification(err.message, 'error');
        btnEl.disabled = false;
        btnEl.textContent = originalText;
    }
}

async function promptShippingReceipt() {
    const receipt = prompt('Masukkan Nomor Resi Pengiriman:');
    if (!receipt) return;

    try {
        const { error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageRekber',
                sub_action: 'ship',
                transaction_id: currentTransaction.id,
                data: { receipt }
            }
        });
        if (error) throw error;
        window.location.reload();
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

async function handleBuyerConfirm() {
    if (!confirm('Konfirmasi: Barang sudah diterima dengan baik?')) return;

    try {
        const { error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageRekber',
                sub_action: 'confirmArrival',
                transaction_id: currentTransaction.id
            }
        });
        if (error) throw error;
        window.location.reload();
    } catch (err) {
        showNotification(err.message, 'error');
    }
}

async function handleFinishTransaction(btnEl) {
    if (!confirm('KONFIRMASI AKHIR: Teruskan dana ke Rekening Seller?')) return;

    let originalText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = 'MENCAIRKAN...';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageRekber',
                sub_action: 'finish',
                transaction_id: currentTransaction.id
            }
        });
        if (error) throw error;

        if (data && data.success === false) {
            throw new Error(data.error || 'Gagal mencairkan dana.');
        }

        showNotification('Transaksi selesai! Dana dicairkan.', 'success');
        setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
        showNotification(err.message, 'error');
        btnEl.disabled = false;
        btnEl.textContent = originalText;
    }
}

// --- Chat Logic ---

async function renderChat(id) {
    const { data: messages, error } = await sbClient
        .from('rekber_messages')
        .select('*')
        .eq('transaction_id', id)
        .order('created_at', { ascending: true });

    if (error) return;

    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '';

    messages.forEach(msg => renderMessage(msg));
    container.scrollTop = container.scrollHeight;
}

function renderMessage(msg) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    // Use getCurrentUser() to ensure we have the latest session state
    const user = currentUser || getCurrentUser();
    if (!user) {
        logger.warn('renderMessage: No user session found');
        return;
    }

    // Robust ID comparison (handle string/uuid casing)
    const isMine = msg.sender_id && user.id &&
        msg.sender_id.toString().toLowerCase().trim() === user.id.toString().toLowerCase().trim();

    logger.log(`Rendering message: "${msg.content.substring(0, 10)}..." Mine: ${isMine}`);

    const div = document.createElement('div');

    if (msg.is_system) {
        div.className = 'message-system message-bubble';
        div.innerHTML = `
        <div class="flex items-center justify-center gap-2">
            <span class="material-symbols-outlined text-sm">notifications</span>
            ${escapeHTML(msg.content)}
        </div>
        ${msg.image_url ? `<img src="${msg.image_url}" class="mt-2 rounded-xl border border-black max-w-xs mx-auto">` : ''}
    `;
    } else {
        div.className = `flex ${isMine ? 'justify-end' : 'justify-start'} w-full`;
        div.innerHTML = `
        <div class="message-bubble ${isMine ? 'bg-primary' : 'bg-white'}">
            <p class="text-[8px] font-black uppercase text-black/40 mb-1">${isMine ? 'SAYA' : 'LAWAN'}</p>
            <p class="text-sm font-bold leading-tight">${escapeHTML(msg.content)}</p>
            ${msg.image_url ? `<img src="${msg.image_url}" class="mt-2 rounded-xl border border-black max-w-xs">` : ''}
            <p class="text-[7px] font-bold text-black/20 mt-1 uppercase text-right">${getRelativeTime(msg.created_at)}</p>
        </div>
    `;
    }

    container.appendChild(div);
}

function setupChatForm() {
    const form = document.getElementById('chatForm');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const input = document.getElementById('chatInput');
            const content = input.value.trim();
            if (!content) return;

            input.value = '';

            // Optimistic UI: Render dummy local message immediately
            const localMsg = {
                transaction_id: currentTransaction.id,
                sender_id: currentUser.id,
                content: content,
                created_at: new Date().toISOString(),
                is_local: true // Flag to avoid duplication from realtime
            };
            renderMessage(localMsg);

            try {
                const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
                    body: { action: 'sendRekberMessage', transaction_id: currentTransaction.id, content: content }
                });

                if (error) throw error;
                if (data && !data.success) throw new Error(data.error || 'Gagal mengirim pesan');

            } catch (err) {
                logger.error('Send message error:', err);
                showNotification(err.message || 'Gagal mengirim pesan', 'error');
            }
        };
    }

    // Image upload button
    const btnUploadImage = document.getElementById('btnUploadImage');
    if (btnUploadImage) {
        btnUploadImage.onclick = () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                btnUploadImage.disabled = true;
                btnUploadImage.innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span>';

                try {
                    const fileExt = file.name.split('.').pop();
                    const fileName = `chat_${currentTransaction.id}_${Date.now()}.${fileExt}`;
                    const { error: uploadError } = await sbClient.storage
                        .from('transaction-proofs')
                        .upload(fileName, file);

                    if (uploadError) throw uploadError;

                    const { data: { publicUrl } } = sbClient.storage.from('transaction-proofs').getPublicUrl(fileName);

                    const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
                        body: {
                            action: 'sendRekberMessage',
                            transaction_id: currentTransaction.id,
                            content: '📷 Gambar',
                            image_url: publicUrl
                        }
                    });

                    if (error) throw error;
                    if (data && !data.success) throw new Error(data.error || 'Gagal mengirim gambar');

                } catch (err) {
                    logger.error('Image upload error:', err);
                    showNotification(err.message || 'Gagal upload gambar', 'error');
                } finally {
                    btnUploadImage.disabled = false;
                    btnUploadImage.innerHTML = '<span class="material-symbols-outlined">image</span>';
                }
            };
            fileInput.click();
        };
    }
}



function setupRealtimeSubscription(id) {
    if (messageSubscription) messageSubscription.unsubscribe();

    messageSubscription = sbClient
        .channel(`rekber-${id}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'rekber_messages',
            filter: `transaction_id=eq.${id}`
        }, payload => {
            // Check if this is the message we just sent (avoid doubling with optimistic UI)
            // We usually check by content + sender for simplicity in this case
            const container = document.getElementById('chatMessages');
            const alreadyRendered = Array.from(container.children).some(el =>
                el.innerText.includes(payload.new.content) && el.innerText.includes('BARUSAJA')
            );

            if (!alreadyRendered) {
                renderMessage(payload.new);
                container.scrollTop = container.scrollHeight;
            }
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'rekber_transactions',
            filter: `id=eq.${id}`
        }, payload => {
            // If status changed, reload
            if (currentTransaction && payload.new.status !== currentTransaction.status) {
                window.location.reload();
            }
        })
        .subscribe();
}

// Expose to window
if (typeof window !== 'undefined') {
    window.initializeRekberPage = initializeRekberPage;
}
