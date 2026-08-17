import { logger } from '../core/logger.js';
/**
 * Admin Coin Management Logic
 * JDK Entertainment
 */
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let allMembers = []; // Kept for modal usage, but only current page data
let currentAdminName = '';

// Pagination State
let currentPage = 1;
const itemsPerPage = 20;
let totalItems = 0;
let currentSearchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
    await initializeAdminLayout();

    // Auth Check & Admin Verification is handled by initializeAdminLayout partially,
    // but we need the admin username for logs.
    const { data: { user } } = await sbClient.auth.getUser();
    if (user) {
        const { data: profile } = await sbClient.from('profiles').select('username').eq('id', user.id).single();
        currentAdminName = profile?.username || 'Admin';
    }

    // Clear Search
    const searchInput = document.getElementById('searchMember');
    if (searchInput) {
        searchInput.value = '';
        searchInput.addEventListener('keyup', debounce((e) => {
            const newVal = e.target.value.trim();
            if (newVal !== currentSearchQuery) {
                currentSearchQuery = newVal;
                currentPage = 1; // Reset to page 1 on search
                loadMembers();
            }
        }, 500));
    }

    loadMembers();
});

async function loadMembers() {
    const tbody = document.getElementById('memberTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-12 text-center text-slate-500"><div class="flex flex-col items-center"><span class="material-symbols-outlined text-3xl animate-spin mb-2 text-slate-300">sync</span><span class="text-sm">Loading data...</span></div></td></tr>';
    }

    const from = (currentPage - 1) * itemsPerPage;
    const to = from + itemsPerPage - 1;

    let query = sbClient
        .from('profiles')
        .select('id, username, email, avatar_url, coin, user_level', { count: 'exact' });

    // Apply Search if exists
    if (currentSearchQuery) {
        // Use ilike for case-insensitive search on username or email
        query = query.or(`username.ilike.%${currentSearchQuery}%,email.ilike.%${currentSearchQuery}%`);
    }

    query = query
        .order('username', { ascending: true })
        .range(from, to);

    const { data, count, error } = await query;

    if (error) {
        showNotification('Error loading members: ' + error.message, 'error');
        if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="p-4 text-center text-red-500">Error: ${error.message}</td></tr>`;
        return;
    }

    allMembers = data || [];
    totalItems = count || 0;

    renderTable(allMembers);
    renderPagination();
}

function renderPagination() {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);

    // Update Info Text
    const startEl = document.getElementById('pageInfoStart');
    const endEl = document.getElementById('pageInfoEnd');
    const totalEl = document.getElementById('pageInfoTotal');
    const indEl = document.getElementById('pageIndicator');

    if (startEl) startEl.textContent = startItem;
    if (endEl) endEl.textContent = endItem;
    if (totalEl) totalEl.textContent = totalItems;
    if (indEl) indEl.textContent = `Page ${currentPage} of ${totalPages || 1}`;

    // Update Buttons
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');

    if (btnPrev) btnPrev.disabled = currentPage <= 1;
    if (btnNext) btnNext.disabled = currentPage >= totalPages;
}

window.prevPage = () => {
    if (currentPage > 1) {
        currentPage--;
        loadMembers();
    }
};

window.nextPage = () => {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        loadMembers();
    }
};

// Utils
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// Legacy bridging
window.filterMembers = () => {
    const val = document.getElementById('searchMember').value.trim();
    if (val !== currentSearchQuery) {
        currentSearchQuery = val;
        currentPage = 1;
        loadMembers();
    }
};

function renderTable(members) {
    const tbody = document.getElementById('memberTableBody');
    if (!tbody) return;

    if (members.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="p-12 text-center text-slate-500 font-medium">No members found.</td></tr>';
        return;
    }

    tbody.innerHTML = members.map(m => {
        const role = (m.user_level || 'Member').toUpperCase();
        const roleClass = role === 'ADMIN' ? 'bg-rose-100 text-rose-700 border-rose-200' :
            role === 'VIP' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                'bg-slate-100 text-slate-600 border-slate-200';

        return `
            <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100 cursor-pointer" onclick="openCoinModal('${m.id}')">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <img src="${m.avatar_url || '/images/default-avatar.png'}" class="w-10 h-10 rounded-full border border-slate-200 object-cover shadow-sm bg-slate-100">
                        <div class="flex flex-col">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-slate-800 text-sm">@${m.username || 'No Name'}</span>
                                <span class="px-2 py-0.5 rounded-full border text-[9px] font-bold ${roleClass}">${role}</span>
                            </div>
                            <span class="text-[11px] text-slate-400 font-medium">${m.email || '-'}</span>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-center">
                    <div class="flex flex-col items-center">
                        <span class="text-lg font-bold text-amber-500 font-display flex items-center gap-1">
                            ${(m.coin || 0).toLocaleString()}
                            <span class="material-symbols-outlined text-[20px] fill-current">toll</span>
                        </span>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <div class="flex items-center justify-center gap-1">
                        <button onclick="event.stopPropagation(); viewHistory('${m.id}')" 
                            class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="View History">
                            <span class="material-symbols-outlined text-[22px]">history</span>
                        </button>
                        <button onclick="event.stopPropagation(); openCoinModal('${m.id}')" 
                            class="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" title="Adjust Balance">
                            <span class="material-symbols-outlined text-[22px]">account_balance_wallet</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.openCoinModal = function (id) {
    const member = allMembers.find(m => m.id === id);
    if (!member) return;

    document.getElementById('cm_userId').value = member.id;
    const avatarImg = document.getElementById('cm_avatar');
    if (avatarImg) avatarImg.src = member.avatar_url || 'https://via.placeholder.com/40';

    document.getElementById('cm_username').textContent = member.username || 'No Name';
    document.getElementById('cm_currentCoin').textContent = (member.coin || 0).toLocaleString();

    // Set Date and Admin
    document.getElementById('cm_date').textContent = new Date().toLocaleString();
    document.getElementById('cm_admin').textContent = currentAdminName;

    document.getElementById('cm_amount').value = '';
    document.getElementById('cm_description').value = '';

    const modal = document.getElementById('coinModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeCoinModal = function () {
    const modal = document.getElementById('coinModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.updateCoin = async function (action) {
    const userId = document.getElementById('cm_userId').value;
    const amountStr = document.getElementById('cm_amount').value;
    const amount = parseInt(amountStr);
    const description = document.getElementById('cm_description').value.trim();

    if (isNaN(amount) || amount <= 0) {
        showNotification('Masukkan jumlah coin yang valid!', 'error');
        return;
    }

    if (!description) {
        showNotification('Harap isi keterangan alasan penambahan/pengurangan coin!', 'error');
        return;
    }

    const member = allMembers.find(m => m.id === userId);
    if (!member) return;

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminAdjustBalance',
                target_user_id: userId,
                balance_type: 'coin',
                amount: action === 'add' ? amount : -amount,
                description: description
            }
        });

        if (error) throw error;
        if (data.error) throw new Error(data.error);

        // Update local data and UI
        member.coin = data.new_balance;
        renderTable(allMembers);
        window.closeCoinModal();
        showNotification(`✅ Coin berhasil diupdate! Saldo baru: ${data.new_balance.toLocaleString()}`, 'success');
    } catch (err) {
        logger.error('Update coin error:', err);
        showNotification('Gagal update coin: ' + err.message, 'error');
    }
};

window.viewHistory = async function (userId) {
    const member = allMembers.find(m => m.id === userId);
    if (!member) return;

    document.getElementById('historyUsername').textContent = member.username || 'No Name';
    document.getElementById('historyTableBody').innerHTML = '<tr><td colspan="4" class="p-4 text-center">Loading...</td></tr>';

    const modal = document.getElementById('historyModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // Fetch History
    const { data, error } = await sbClient
        .from('coin_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        document.getElementById('historyTableBody').innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500">Error: ${error.message}</td></tr>`;
        return;
    }

    renderHistoryTable(data || []);
};

function renderHistoryTable(transactions) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;

    if (transactions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-500 font-medium font-body italic">Belum ada transaksi.</td></tr>';
        return;
    }

    tbody.innerHTML = transactions.map(t => {
        const date = new Date(t.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const isPositive = t.amount > 0;
        const colorClass = isPositive ? 'text-emerald-600' : 'text-rose-600';
        const bgClass = isPositive ? 'bg-emerald-50' : 'bg-rose-50';

        return `
            <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
                <td class="px-4 py-3">
                    <div class="flex flex-col">
                        <span class="text-[10px] font-bold text-slate-500 font-mono tracking-tighter">${date}</span>
                    </div>
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 rounded font-bold text-xs ${bgClass} ${colorClass}">
                        ${isPositive ? '+' : ''}${t.amount.toLocaleString()} 🪙
                    </span>
                </td>
                <td class="px-4 py-3">
                    <p class="text-[11px] text-slate-600 font-medium leading-tight line-clamp-2" title="${t.description || '-'}">
                        ${t.description || '-'}
                    </p>
                </td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-1 text-[10px] font-bold text-slate-400 italic">
                        <span class="material-symbols-outlined text-[12px]">shield_person</span>
                        ${t.admin_id ? '@' + (t.admin_id.substring(0, 8)) : (t.type || '-')}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.closeHistoryModal = function () {
    const modal = document.getElementById('historyModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};
