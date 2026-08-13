import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Admin Rekber Dashboard
 * Handles management of all Rekber transactions
 */

import { sbClient } from '../core/supabase.js';
import { showNotification, escapeHTML } from '../core/utils.js';
import { initializeUserSession, getCurrentUser } from '../modules/user-session.js';

let allTransactions = [];

/**
 * Initialize Admin Rekber Page
 */
export async function initializeAdminRekberPage() {
    logger.log('📦 Initializing Admin Rekber Page...');
    await initializeUserSession();

    const user = getCurrentUser();
    if (!user || user.user_level !== 'Admin') {
        logger.warn('❌ Access Denied: Not an Admin or No Session');
        window.location.href = '/index.html';
        return;
    }

    logger.log('✅ Admin Session Verified:', user.username);
    setupEventListeners();
    await loadTransactions();
}

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
    const statusFilter = document.getElementById('statusFilter');
    if (statusFilter) {
        statusFilter.onchange = () => renderTransactions();
    }

    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) {
        btnRefresh.onclick = () => loadTransactions();
    }
}

/**
 * Load Transactions from DB
 */
async function loadTransactions() {
    const container = document.getElementById('transactionList');
    container.innerHTML = `
        <div class="col-span-full py-20 text-center flex flex-col items-center justify-center text-slate-400">
            <span class="material-symbols-outlined text-4xl animate-spin mb-3 text-slate-300">sync</span>
            <p class="text-sm font-semibold uppercase tracking-wider">Memuat Transaksi...</p>
        </div>
    `;

    try {
        const { data, error } = await sbClient
            .from('rekber_transactions')
            .select('*, products(name, image_url), buyer:profiles!rekber_transactions_buyer_id_fkey(username), seller:profiles!rekber_transactions_seller_id_fkey(username)')
            .order('created_at', { ascending: false });

        if (error) throw error;
        allTransactions = data;
        renderTransactions();

    } catch (err) {
        logger.error('Error loading admin rekber:', err);
        container.innerHTML = `
            <div class="col-span-full py-10 text-center">
                <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-500 mb-3">
                    <span class="material-symbols-outlined">error</span>
                </div>
                <h3 class="text-lg font-bold text-slate-800 mb-1">Gagal Memuat Data</h3>
                <p class="text-sm text-slate-500 mb-4">${escapeHTML(err.message)}</p>
                <button onclick="window.location.reload()" class="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors">
                    Coba Lagi
                </button>
            </div>
        `;
        showNotification(err.message, 'error');
    }
}

/**
 * Render Transactions to UI
 */
function renderTransactions() {
    const container = document.getElementById('transactionList');
    const statusFilter = document.getElementById('statusFilter').value;

    let filtered = allTransactions;
    if (statusFilter !== 'ALL') {
        filtered = allTransactions.filter(tx => tx.status === statusFilter);
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-20 bg-white border-4 border-black border-dashed rounded-3xl text-center">
                <p class="font-black uppercase text-black/20">Tidak ada transaksi ditemukan</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(tx => {
        let statusClass = 'bg-slate-100 text-slate-600';
        let statusLabel = tx.status;

        switch (tx.status) {
            case 'VERIFYING': statusClass = 'bg-amber-100 text-amber-700'; break;
            case 'DISPUTE': statusClass = 'bg-rose-100 text-rose-700'; break;
            case 'ON_SHIPPING': statusClass = 'bg-blue-100 text-blue-700'; break;
            case 'FINISHED': statusClass = 'bg-emerald-100 text-emerald-700'; break;
        }

        return `
            <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all flex flex-col md:flex-row items-center gap-6 group">
                <!-- Product Info -->
                <div class="flex items-center gap-4 flex-1 w-full md:w-auto">
                    <div class="relative shrink-0">
                        <img src="${tx.products?.image_url || 'images/placeholder-product.png'}" class="w-16 h-16 rounded-xl border border-slate-200 object-cover shadow-sm">
                        <div class="absolute -bottom-1 -right-1 bg-white rounded-full p-1 shadow-sm border border-slate-100">
                            <span class="material-symbols-outlined text-[14px] text-blue-600">verified_user</span>
                        </div>
                    </div>
                    <div class="flex-1 min-w-0">
                        <h3 class="font-bold text-slate-800 text-base leading-tight truncate mb-1" title="${tx.products?.name}">${escapeHTML(tx.products?.name)}</h3>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-[10px] font-bold text-slate-400 font-mono tracking-tighter uppercase px-1.5 py-0.5 bg-slate-50 rounded border border-slate-100">TX#${tx.id.substring(0, 8)}</span>
                            <span class="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                                @${escapeHTML(tx.buyer?.username)} &rarr; @${escapeHTML(tx.seller?.username)}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Price & Status -->
                <div class="flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-4 md:gap-1 px-4 md:px-0 py-4 md:py-0 border-y md:border-y-0 border-slate-50">
                    <div class="text-right">
                        <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net Earnings</div>
                        <div class="text-xl font-bold text-emerald-600 font-display leading-tight">
                            Rp ${(tx.amount - (tx.admin_fee || 0)).toLocaleString()}
                        </div>
                        <div class="text-[10px] font-medium text-slate-400">Total: Rp ${tx.amount.toLocaleString()}</div>
                    </div>
                    
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${statusClass}">
                        ${statusLabel}
                    </span>
                </div>

                <!-- Action -->
                <div class="w-full md:w-auto">
                    <a href="rekber.html?id=${tx.id}" class="w-full md:w-auto h-11 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2 group-hover:scale-105">
                        <span class="material-symbols-outlined text-lg">forum</span>
                        Enter Room
                    </a>
                </div>
            </div>
        `;
    }).join('');
}

// Expose to window
if (typeof window !== 'undefined') {
    window.initializeAdminRekberPage = initializeAdminRekberPage;
    document.addEventListener('DOMContentLoaded', initializeAdminRekberPage);
}
