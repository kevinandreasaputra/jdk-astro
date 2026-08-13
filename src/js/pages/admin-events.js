import { logger } from '../core/logger.js';
/**
 * Admin Events Management Logic
 * JDK Entertainment
 */
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let allEvents = [];
let currentEventId = null;
let html5QrCode = null;
let currentQrRegistration = null;
let selectedQrEventId = null;
let currentUserRole = 'Member';
let currentUserId = null;
let currentHostList = []; // Array of {id, name}
let allMembers = []; // Store all potential hosts


export async function initializeAdminEvents() {
    const perms = await initializeAdminLayout();

    // Get current user info for filtering
    const { data: { user } } = await sbClient.auth.getUser();
    if (user) {
        currentUserId = user.id;
        const { data: profile } = await sbClient.from('profiles').select('user_level').eq('id', user.id).single();
        currentUserRole = profile?.user_level || 'Member';
    }

    // Auth Check & Admin Verification is handled by initializeAdminLayout,
    // but we can proceed with loading data.
    await window.loadEvents();
    window.loadBadges();
    window.loadMembers(); // Load JDKwan members for Host dropdown

    // Check for auto-open cert designer
    const urlParams = new URLSearchParams(window.location.search);
    const designId = urlParams.get('design');
    if (designId) {
        logger.log('[DEBUG] Auto-opening cert designer for event:', designId);
        window.openCertEditModal(designId);
    }

    // Hide administrative controls if not Admin
    if (currentUserRole !== 'Admin') {
        const adminOnlyElements = document.querySelectorAll('.admin-only');
        adminOnlyElements.forEach(el => el.classList.add('hidden'));
    }
}

document.addEventListener('DOMContentLoaded', initializeAdminEvents);

// --- GLOBAL FUNCTIONS (attached to window for onclick) ---

window.loadEvents = async function () {
    // Fetch events with host profile
    let query = sbClient
        .from('events')
        .select('*, host:profiles!host_id(id, username, full_name)');

    // Filter if not Admin (Hosts, Dynamic Hosts, etc.)
    if (currentUserRole !== 'Admin') {
        query = query.eq('host_id', currentUserId);
    }

    const { data: eventsData, error: eventsError } = await query
        .order('date', { ascending: false });

    if (eventsError) {
        logger.error(eventsError);
        showNotification('❌ Gagal memuat event', 'error');
        return;
    }

    // Fetch registration counts for all events
    const { data: regCounts, error: regError } = await sbClient
        .from('event_registrations')
        .select('event_id');

    if (regError) {
        logger.error('Error fetching registrations:', regError);
    }

    // Count registrations per event
    const countMap = {};
    if (regCounts) {
        regCounts.forEach(reg => {
            countMap[reg.event_id] = (countMap[reg.event_id] || 0) + 1;
        });
    }

    // Attach registration count and host name to each event
    allEvents = eventsData.map(event => ({
        ...event,
        registration_count: countMap[event.id] || 0,
        host_name: event.host ? (event.host.username || event.host.full_name || '-') : '-'
    }));

    renderEvents();
};

window.loadBadges = async function () {
    const { data, error } = await sbClient
        .from('achievements')
        .select('id, title, icon_emoji')
        .order('title', { ascending: true });

    if (error) {
        logger.error('Error loading badges:', error);
        return;
    }

    const select = document.getElementById('eventRewardAchievement');
    const rewardSelect = document.getElementById('hostRewardBadge');

    if (select) {
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- Tanpa Hadiah Badge --</option>' +
            data.map(ach => `<option value="${ach.id}">${ach.icon_emoji} ${ach.title}</option>`).join('');
        select.value = currentVal;
    }

    if (rewardSelect) {
        const currentVal = rewardSelect.value;
        rewardSelect.innerHTML = '<option value="">-- Tanpa Hadiah Badge --</option>' +
            data.map(ach => `<option value="${ach.id}">${ach.icon_emoji} ${ach.title}</option>`).join('');
        rewardSelect.value = currentVal;
    }
};

window.loadMembers = async function () {
    const { data, error } = await sbClient
        .from('profiles')
        .select('id, username, full_name')
        .order('username', { ascending: true });

    if (error) {
        logger.error('Error loading members:', error);
        return;
    }

    allMembers = data || [];
};

window.searchHosts = function (query) {
    const resultsContainer = document.getElementById('hostSearchResults');
    if (!query || query.length < 1) {
        resultsContainer.classList.add('hidden');
        resultsContainer.innerHTML = '';
        return;
    }

    const lowerQuery = query.toLowerCase();
    const matches = allMembers.filter(m => {
        const username = (m.username || '').toLowerCase();
        const fullName = (m.full_name || '').toLowerCase();
        return username.includes(lowerQuery) || fullName.includes(lowerQuery);
    });

    if (matches.length === 0) {
        resultsContainer.innerHTML = '<div class="p-2 text-[10px] text-slate-400 italic text-center">No users found</div>';
    } else {
        resultsContainer.innerHTML = matches.map(m => {
            const displayName = m.username || m.full_name || 'Unknown';
            const extraInfo = m.full_name && m.username ? `(${m.full_name})` : '';
            return `
                <div onclick="selectHost('${m.id}')" class="p-2 hover:bg-emerald-50 cursor-pointer flex items-center justify-between group">
                    <div>
                        <span class="font-bold text-slate-700 text-xs">${displayName}</span>
                        <span class="text-[10px] text-slate-400 ml-1">${extraInfo}</span>
                    </div>
                    <span class="material-symbols-outlined text-emerald-500 text-sm opacity-0 group-hover:opacity-100">add_circle</span>
                </div>
            `;
        }).join('');
    }

    resultsContainer.classList.remove('hidden');
};

window.selectHost = function (id) {
    const member = allMembers.find(m => m.id === id);
    if (!member) return;

    if (currentHostList.find(h => h.id === id)) {
        alert('Host already added!');
        document.getElementById('hostSearchInput').value = '';
        document.getElementById('hostSearchResults').classList.add('hidden');
        return;
    }

    currentHostList.push({
        id: member.id,
        name: member.username || member.full_name
    });

    renderHostList();

    // Reset UI
    document.getElementById('hostSearchInput').value = '';
    document.getElementById('hostSearchResults').classList.add('hidden');
    document.getElementById('hostSearchInput').focus();
};

/* Removed window.addHost as it is replaced by search/select logic */

window.removeHost = function (id) {
    currentHostList = currentHostList.filter(h => h.id !== id);
    renderHostList();
};

function renderHostList() {
    const container = document.getElementById('hostList');
    if (!container) return;

    if (currentHostList.length === 0) {
        container.innerHTML = '<p class="text-[10px] text-slate-400 italic">No hosts selected.</p>';
        return;
    }

    container.innerHTML = currentHostList.map((h, index) => `
        <div class="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1.5 text-xs">
            <div class="flex items-center gap-2">
                <span class="font-bold text-slate-700">${h.name}</span>
                ${index === 0 ? '<span class="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold rounded uppercase">Primary</span>' : ''}
            </div>
            <button type="button" onclick="removeHost('${h.id}')" class="text-slate-400 hover:text-red-500">
                <span class="material-symbols-outlined text-sm">close</span>
            </button>
        </div>
    `).join('');
}

window.filterEvents = function () {
    const query = document.getElementById('searchEvent').value.toLowerCase();
    const rows = document.querySelectorAll('#eventsTableBody tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
};

function renderEvents() {
    const tbody = document.getElementById('eventsTableBody');
    const cardView = document.getElementById('eventsCardView');
    if (!tbody || !cardView) return;

    if (allEvents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-gray-500 font-body">Belum ada event.</td></tr>';
        cardView.innerHTML = '<div class="text-center py-8 text-gray-500 font-body">Belum ada event.</div>';
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Desktop Table View
    tbody.innerHTML = allEvents.map(event => {
        const eventDate = new Date(event.date);
        const isPast = eventDate < today;

        // Visual distinction for past events
        const rowClass = isPast
            ? 'bg-slate-50 opacity-60'
            : 'bg-white hover:bg-slate-50 transition-colors';

        const statusLabel = isPast ? 'SELESAI' : 'UPCOMING';
        const badgeClass = isPast
            ? 'bg-slate-200 text-slate-600'
            : 'bg-emerald-100 text-emerald-700 font-bold';

        // Custom Date Formatting
        const dateStr = eventDate.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });

        const isAdmin = currentUserRole === 'Admin';

        return `
        <tr class="${rowClass} border-b border-slate-100">
            <td class="p-4">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badgeClass}">
                    ${statusLabel}
                </span>
            </td>
            <td class="p-4 whitespace-nowrap font-medium text-slate-600">${dateStr}</td>
            <td class="p-4">
                <div class="flex flex-col">
                    <span class="font-bold text-slate-800 text-sm line-clamp-1">${event.title}</span>
                    <span class="text-[10px] text-slate-400 font-medium">${event.google_event_id ? '🔗 Synced' : ''}</span>
                </div>
            </td>
            <td class="p-4">
                <div class="flex items-center gap-1.5 text-xs text-slate-500">
                    <span class="material-symbols-outlined text-sm">location_on</span>
                    <span class="line-clamp-1">${event.location || '-'}</span>
                </div>
            </td>
            <td class="p-4">
                <div class="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                    ${event.host_name !== '-' ? `<span class="material-symbols-outlined text-sm">mic_external_on</span> ${event.host_name}` : '-'}
                </div>
            </td>
            <td class="p-4">
                <span class="font-bold text-slate-700 text-xs">${event.price}</span>
            </td>
            <td class="p-4">
                <div class="flex flex-col gap-1">
                    <div class="flex items-center justify-between text-[11px] font-bold text-slate-700">
                        <span>${event.registration_count}</span>
                        <span class="text-slate-300">/</span>
                        <span>${event.total_quota}</span>
                    </div>
                    <div class="w-16 h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div class="h-full bg-blue-500 rounded-full" style="width: ${Math.min((event.registration_count / event.total_quota) * 100, 100)}%"></div>
                    </div>
                </div>
            </td>
            <td class="p-4">
                <div class="flex items-center gap-1 justify-center" onclick="event.stopPropagation()">
                    <!-- Participants -->
                    <button onclick="viewParticipants('${event.id}', '${event.title.replace(/'/g, "\\'")}')" 
                        class="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View Participants">
                        <span class="material-symbols-outlined text-[20px]">groups</span>
                    </button>
                    <!-- Broadcast -->
                    <button onclick="openBroadcastModal('${event.id}', '${event.title.replace(/'/g, "\\'")}')" 
                        class="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Broadcast">
                        <span class="material-symbols-outlined text-[20px]">campaign</span>
                    </button>
                    
                    <!-- Certificate Designer -->
                    <button onclick="openCertEditModal('${event.id}')" 
                        class="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Design Certificate">
                        <span class="material-symbols-outlined text-[20px]">workspace_premium</span>
                    </button>

                    <!-- Reward Host (If Admin) -->
                    ${isAdmin && event.host_id ? `
                    <button onclick="openRewardHostModal('${event.id}')" 
                        class="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Reward Host">
                        <span class="material-symbols-outlined text-[20px]">military_tech</span>
                    </button>` : ''}

                    <!-- Edit/Delete (If Admin) -->
                    ${isAdmin ? `
                    <button onclick="editEvent('${event.id}')" 
                        class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                        <span class="material-symbols-outlined text-[20px]">edit</span>
                    </button>
                    <button onclick="deleteEvent('${event.id}')" 
                        class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Delete">
                        <span class="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `}).join('');

    // Mobile Card View
    cardView.innerHTML = allEvents.map(event => {
        const eventDate = new Date(event.date);
        const isPast = eventDate < today;
        const isAdmin = currentUserRole === 'Admin';

        const statusLabel = isPast ? 'SELESAI' : 'UPCOMING';
        const badgeClass = isPast
            ? 'bg-slate-200 text-slate-500'
            : 'bg-emerald-100 text-emerald-700';

        const dateStr = eventDate.toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });

        return `
        <div class="bg-white border-none rounded-2xl overflow-hidden shadow-sm mb-4 ${isPast ? 'opacity-70 grayscale' : ''}">
            <div class="p-5">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex flex-col gap-1.5">
                        <span class="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider w-fit ${badgeClass}">
                            ${statusLabel}
                        </span>
                        <div class="text-[12px] font-bold text-slate-400 flex items-center gap-1">
                            <span class="material-symbols-outlined text-sm">calendar_month</span>
                            ${dateStr}
                        </div>
                    </div>
                </div>

                <h4 class="text-base font-bold text-slate-800 leading-tight mb-4 line-clamp-2">${event.title}</h4>
                
                <div class="flex flex-col gap-2 mb-5">
                    <div class="flex items-center gap-2 text-xs text-slate-500">
                        <span class="material-symbols-outlined text-sm text-slate-400">location_on</span>
                        <span class="line-clamp-1">${event.location || '-'}</span>
                    </div>
                    <div class="flex items-center gap-2 text-xs text-slate-500">
                        <span class="material-symbols-outlined text-sm text-slate-400">mic_external_on</span>
                        <span class="font-medium text-emerald-600">${event.host_name !== '-' ? event.host_name : 'No Host'}</span>
                    </div>
                    <div class="flex items-center justify-between mt-1">
                        <div class="flex items-center gap-2 text-xs font-bold text-slate-600">
                            <span class="material-symbols-outlined text-sm text-slate-400">confirmation_number</span>
                            ${event.price}
                        </div>
                        <div class="flex flex-col items-end">
                            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Registration</div>
                            <div class="text-sm font-black text-slate-800">${event.registration_count} / ${event.total_quota}</div>
                        </div>
                    </div>
                </div>

                <!-- Action Grid -->
                <div class="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-50">
                    <button onclick="viewParticipants('${event.id}', '${event.title.replace(/'/g, "\\'")}')" 
                        class="flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 py-3 rounded-xl text-xs font-bold transition-colors">
                        <span class="material-symbols-outlined text-[18px]">groups</span> LIST
                    </button>
                    <button onclick="openCertEditModal('${event.id}')" 
                        class="flex items-center justify-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 py-3 rounded-xl text-xs font-bold transition-colors">
                        <span class="material-symbols-outlined text-[18px]">workspace_premium</span> CERT
                    </button>
                    <button onclick="openBroadcastModal('${event.id}', '${event.title.replace(/'/g, "\\'")}')" 
                        class="col-span-2 flex items-center justify-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-3 rounded-xl text-xs font-bold transition-colors">
                        <span class="material-symbols-outlined text-[18px]">campaign</span> BROADCAST PARTICIPANTS
                    </button>
                    
                    ${isAdmin ? `
                        <button onclick="editEvent('${event.id}')" 
                            class="flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-700 py-3 rounded-xl text-xs font-bold transition-colors">
                            <span class="material-symbols-outlined text-[18px]">edit</span> EDIT
                        </button>
                        <button onclick="deleteEvent('${event.id}')" 
                            class="flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-700 py-3 rounded-xl text-xs font-bold transition-colors">
                            <span class="material-symbols-outlined text-[18px]">delete</span> DEL
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `}).join('');

    // Also populate the QR scanner event select
    populateQrEventSelect();
}

function populateQrEventSelect() {
    const select = document.getElementById('qrEventSelect');
    if (!select || !allEvents) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filter to only show today's or upcoming events for scanning
    const upcomingEvents = allEvents.filter(e => {
        const eventDate = new Date(e.date);
        eventDate.setHours(0, 0, 0, 0);
        return eventDate >= today;
    });

    select.innerHTML = '<option value="">-- Pilih Event --</option>' +
        upcomingEvents.map(e => `<option value="${e.id}">${e.date} - ${e.title}</option>`).join('');

    select.onchange = () => {
        selectedQrEventId = select.value;
        if (selectedQrEventId) window.loadQrStats();
    };
}

window.viewParticipants = async function (eventId, title) {
    currentEventId = eventId;
    document.getElementById('participantModalTitle').textContent = `PESERTA: ${title}`;
    document.getElementById('participantTableBody').innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500 font-body">Loading...</td></tr>';

    const modal = document.getElementById('participantModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const { data, error } = await sbClient
        .from('event_registrations')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });

    if (error) {
        const errorMsg = '<tr><td colspan="5" class="p-8 text-center text-red-500 font-body">Gagal memuat peserta</td></tr>';
        document.getElementById('participantTableBody').innerHTML = errorMsg;
        document.getElementById('participantMobileList').innerHTML = errorMsg;
        return;
    }

    renderParticipants(data || []);
};

function renderParticipants(participants) {
    const tbody = document.getElementById('participantTableBody');
    const mobileList = document.getElementById('participantMobileList');
    if (!tbody || !mobileList) return;

    if (participants.length === 0) {
        const emptyMsg = '<div class="p-8 text-center text-gray-400 font-body">Belum ada pendaftar.</div>';
        tbody.innerHTML = `<tr><td colspan="5">${emptyMsg}</td></tr>`;
        mobileList.innerHTML = emptyMsg;
        return;
    }

    // Desktop View
    tbody.innerHTML = participants.map(p => `
        <tr class="border-b border-gray-100 text-black">
            <td class="p-2 text-[11px] font-bold font-body text-black">${p.full_name}</td>
            <td class="p-2 text-[10px] font-body text-black">${p.phone}</td>
            <td class="p-2 text-[10px] font-body">
                ${p.payment_proof_url ? `<a href="${p.payment_proof_url}" target="_blank" class="text-blue-600 underline font-black">View Proof</a>` : `<span class="text-gray-400">-</span>`}
            </td>
            <td class="p-2">
                <span class="px-2 py-0.5 rounded-full text-[9px] font-black border border-black font-ui
                    ${p.status === 'confirmed' ? 'bg-green-100 text-green-700' : p.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">
                    ${p.status.toUpperCase()}
                </span>
            </td>
            <td class="p-2 scoring-col hidden">
                ${p.user_id ? `
                    <input type="number" data-user-id="${p.user_id}" 
                        class="tournament-score-input w-20 border-2 border-amber-300 rounded p-1 text-xs font-bold" 
                        placeholder="Score..." ${['confirmed', 'attended'].includes(p.status) ? '' : 'disabled title="Status harus Confirmed/Attended"'}>
                ` : `
                    <span class="text-[9px] text-slate-400 italic">Bukan Member</span>
                `}
            </td>
            <td class="p-2 text-center flex items-center justify-center gap-1">
                <select onchange="updateParticipantStatus('${p.id}', this.value)" 
                    class="text-[10px] border-2 border-black rounded p-1 font-body bg-white text-black font-bold">
                    <option value="pending" ${p.status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="confirmed" ${p.status === 'confirmed' ? 'selected' : ''}>Confirm</option>
                    <option value="attended" ${p.status === 'attended' ? 'selected' : ''}>Attended</option>
                    <option value="cancelled" ${p.status === 'cancelled' ? 'selected' : ''}>Cancel</option>
                </select>
                ${currentUserRole === 'Admin' ? `
                <button onclick="deleteRegistration('${p.id}')" 
                    class="bg-red-500 text-white rounded p-1.5 text-[10px] border-2 border-black hover:scale-110 shadow-sm">🗑️</button>
                ` : ''}
            </td>
        </tr>
    `).join('');

    // Mobile Card View
    mobileList.innerHTML = participants.map(p => `
        <div class="p-4 bg-white border-b-2 border-black/5 last:border-0">
            <div class="flex justify-between items-start mb-3">
                <div class="flex-1">
                    <div class="font-black font-body text-sm leading-tight mb-1 capitalize">${p.full_name}</div>
                    <div class="text-[10px] font-bold opacity-60 font-body">${p.phone}</div>
                </div>
                <div class="text-right">
                    <span class="px-2 py-0.5 rounded border-2 border-black text-[9px] font-black tracking-tighter
                        ${p.status === 'confirmed' ? 'bg-green-100 text-green-700' : p.status === 'attended' ? 'bg-blue-100 text-blue-700' : p.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">
                        ${p.status.toUpperCase()}
                    </span>
                    <div class="mt-2">
                        ${p.payment_proof_url ? `<a href="${p.payment_proof_url}" target="_blank" class="text-[9px] font-black text-blue-600 underline">PROOF 📸</a>` : `<span class="text-[9px] opacity-20">NO PROOF</span>`}
                    </div>
                </div>
            </div>
            
            <div class="flex gap-2">
                <div class="flex-1">
                    <select onchange="updateParticipantStatus('${p.id}', this.value)" 
                        class="w-full text-[10px] border-4 border-black rounded-lg p-3 font-black bg-white text-black shadow-[2px_2px_0px_#000]">
                        <option value="pending" ${p.status === 'pending' ? 'selected' : ''}>PENDING</option>
                        <option value="confirmed" ${p.status === 'confirmed' ? 'selected' : ''}>CONFIRM</option>
                        <option value="attended" ${p.status === 'attended' ? 'selected' : ''}>ATTENDED</option>
                        <option value="cancelled" ${p.status === 'cancelled' ? 'selected' : ''}>CANCEL</option>
                    </select>
                </div>
                ${currentUserRole === 'Admin' ? `
                <button onclick="deleteRegistration('${p.id}')" 
                    class="bg-comic-red text-white rounded-lg px-4 border-4 border-black shadow-[2px_2px_0px_#000] active:shadow-none translate-y-[-2px] active:translate-y-0 transition-all">
                    🗑️
                </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

window.deleteRegistration = async function (regId) {
    if (!confirm('⚠️ HAPUS PENDAFTARAN?\n\nPoints yang terpotong (jika ada) akan dikembalikan otomatis ke user. History transaksi pendaftaran juga akan dihapus.')) return;

    // Show Loading
    showNotification('Menghapus pendaftaran... ⏳', 'info');

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminDeleteRegistration',
                registration_id: regId
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        showNotification('✅ Pendaftaran dihapus & Points dikembalikan', 'success');
        const eventTitle = document.getElementById('participantModalTitle').innerText.replace('PESERTA: ', '');
        window.viewParticipants(currentEventId, eventTitle);
        window.loadEvents();

    } catch (err) {
        logger.error('Delete registration error:', err);
        showNotification('Gagal menghapus: ' + err.message, 'error');
    }
};

window.confirmAttendance = async function () {
    if (!currentQrRegistration) return;
    const reg = currentQrRegistration;
    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'confirmAttendance',
                registration_id: reg.id
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        showNotification('✅ Kehadiran dikonfirmasi!', 'success');
        window.loadQrStats(); // Refresh QR stats
        window.loadEvents(); // Refresh event list to update counts
    } catch (err) {
        logger.error('Confirm attendance error:', err);
        showNotification('Gagal konfirmasi kehadiran: ' + err.message, 'error');
    }
};
window.updateParticipantStatus = async function (regId, newStatus) {
    if (newStatus === 'attended') {
        if (!confirm('Ubah status ke HADIR? User akan otomatis menerima XP & Points reward via sistem.')) {
            // Refresh to reset dropdown if cancelled
            const eventTitle = document.getElementById('participantModalTitle').innerText.replace('PESERTA: ', '');
            window.viewParticipants(currentEventId, eventTitle);
            return;
        }
    }

    // Show Loading
    showNotification('Updating status... ⏳', 'info');

    // Determine Action: 'attended' uses the special handler (with email trigger), others use generic update
    const action = newStatus === 'attended' ? 'confirmAttendance' : 'adminUpdateRegistrationStatus';

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: action,
                registration_id: regId,
                status: newStatus
            }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Unknown error');

        showNotification('✅ Status berhasil diperbarui!', 'success');

        // Refresh data to ensure UI sync
        // extract event title from modal for viewParticipants
        const eventTitle = document.getElementById('participantModalTitle').innerText.replace('PESERTA: ', '');
        window.viewParticipants(currentEventId, eventTitle);
        window.loadEvents(); // Refresh event list to update counts

    } catch (err) {
        logger.error('Update status error:', err);
        showNotification('Gagal update status: ' + err.message, 'error');
        // Refresh to reset dropdown on error
        const eventTitle = document.getElementById('participantModalTitle').innerText.replace('PESERTA: ', '');
        window.viewParticipants(currentEventId, eventTitle);
    }
};

async function grantAchievement(userId, achievementTitle) {
    const { data: ach } = await sbClient
        .from('achievements')
        .select('id, title, icon_emoji')
        .eq('title', achievementTitle)
        .single();

    if (!ach) return;

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminGrantAchievement',
                target_user_id: userId,
                achievement_id: ach.id,
                reason: `Event Attendance: ${ach.title}`
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        if (!data.already_owned) {
            showNotification(`🏆 Badge Unlocked: ${ach.title} ${ach.icon_emoji || ''}`, 'success');
        }
    } catch (err) {
        logger.error('Error granting achievement:', err);
    }
}

window.closeParticipantModal = function () {
    document.getElementById('participantModal').classList.add('hidden');
    document.getElementById('participantModal').classList.remove('flex');
};

window.openEventModal = function () {
    document.getElementById('eventId').value = '';
    document.getElementById('modalTitle').textContent = 'ADD NEW EVENT';
    document.getElementById('eventTitle').value = '';
    document.getElementById('eventDescription').value = '';
    document.getElementById('eventDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('eventDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('eventStartTime').value = '18:00';
    document.getElementById('eventEndTime').value = '21:00';
    document.getElementById('eventLocation').value = '';
    document.getElementById('eventPrice').value = 'Gratis';
    document.getElementById('eventQuota').value = 50;
    document.getElementById('eventGoogleId').value = '';
    document.getElementById('eventImageUrl').value = '';
    document.getElementById('eventXpReward').value = 0;
    document.getElementById('eventPointReward').value = 0;
    document.getElementById('eventRewardAchievement').value = '';
    document.getElementById('eventMinLevel').value = '0';
    document.getElementById('eventPointFee').value = 0;
    document.getElementById('eventPointFee').value = 0;
    // document.getElementById('eventHost').value = ''; // Deprecated
    currentHostList = [];
    renderHostList();

    // Reset Image Preview
    document.getElementById('uploadPreview').classList.add('hidden');
    document.getElementById('uploadPlaceholder').classList.remove('hidden');

    document.getElementById('btnDeleteEvent').classList.add('hidden');
    const modal = document.getElementById('eventModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.editEvent = function (id) {
    const event = allEvents.find(e => e.id == id);
    if (!event) return;

    document.getElementById('eventId').value = event.id;
    document.getElementById('modalTitle').textContent = 'EDIT EVENT';
    document.getElementById('eventTitle').value = event.title;
    document.getElementById('eventDescription').value = event.description || '';

    const rawDate = event.date;
    document.getElementById('eventDate').value = rawDate ? rawDate.split('T')[0] : '';

    const timeStr = event.time || '';
    const [start, end] = timeStr.includes('-') ? timeStr.split('-').map(s => s.trim()) : [timeStr, ''];
    document.getElementById('eventStartTime').value = start || '';
    document.getElementById('eventEndTime').value = end || '';

    document.getElementById('eventLocation').value = event.location || '';
    document.getElementById('eventPrice').value = event.price || 'Gratis';
    document.getElementById('eventQuota').value = event.total_quota || 50;
    document.getElementById('eventGoogleId').value = event.google_event_id || '';
    document.getElementById('eventImageUrl').value = event.image_url || '';
    document.getElementById('eventXpReward').value = event.xp_reward || 0;
    document.getElementById('eventPointReward').value = event.point_reward || 0;
    document.getElementById('eventRewardAchievement').value = event.reward_achievement_id || '';
    document.getElementById('eventMinLevel').value = event.min_level || '0';
    document.getElementById('eventPointFee').value = event.point_fee || 0;
    document.getElementById('eventPointFee').value = event.point_fee || 0;

    // Load Hosts
    currentHostList = [];
    renderHostList(); // Clear initially

    // Fetch hosts from event_hosts table
    sbClient
        .from('event_hosts')
        .select('user_id, profiles(username, full_name)')
        .eq('event_id', id)
        .then(({ data, error }) => {
            if (data && data.length > 0) {
                currentHostList = data.map(h => ({
                    id: h.user_id,
                    name: h.profiles.username || h.profiles.full_name
                }));
            } else if (event.host_id) {
                // Fallback for legacy events or if event_hosts is empty but host_id exists
                currentHostList = [{
                    id: event.host_id,
                    name: event.host_name // host_name is pre-calculated in loadEvents
                }];
            }
            renderHostList();
        });

    // Preview image if exists
    if (event.image_url) {
        document.getElementById('previewImg').src = event.image_url;
        document.getElementById('uploadPreview').classList.remove('hidden');
        document.getElementById('uploadPlaceholder').classList.add('hidden');
    } else {
        document.getElementById('uploadPreview').classList.add('hidden');
        document.getElementById('uploadPlaceholder').classList.remove('hidden');
    }

    document.getElementById('btnDeleteEvent').classList.remove('hidden');
    const modal = document.getElementById('eventModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeEventModal = function () {
    const modal = document.getElementById('eventModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.saveEvent = async function () {
    const id = document.getElementById('eventId').value;
    const btnSave = document.querySelector('#eventForm button[type="submit"]');
    const originalBtnText = btnSave.innerHTML;

    const eventData = {
        title: document.getElementById('eventTitle').value,
        description: document.getElementById('eventDescription').value,
        date: document.getElementById('eventDate').value,
        time: `${document.getElementById('eventStartTime').value} - ${document.getElementById('eventEndTime').value}`,
        location: document.getElementById('eventLocation').value,
        price: document.getElementById('eventPrice').value,
        total_quota: parseInt(document.getElementById('eventQuota').value) || 50,
        google_event_id: document.getElementById('eventGoogleId').value,
        image_url: document.getElementById('eventImageUrl').value,
        xp_reward: parseInt(document.getElementById('eventXpReward').value) || 0,
        point_reward: parseInt(document.getElementById('eventPointReward').value) || 0,
        reward_achievement_id: document.getElementById('eventRewardAchievement').value || null,
        min_level: parseInt(document.getElementById('eventMinLevel').value) || 0,
        point_fee: parseInt(document.getElementById('eventPointFee').value) || 0,
        min_level: parseInt(document.getElementById('eventMinLevel').value) || 0,
        point_fee: parseInt(document.getElementById('eventPointFee').value) || 0,
        host_ids: currentHostList.map(h => h.id)
    };

    if (!eventData.title || !eventData.date) {
        showNotification('Judul dan Tanggal wajib diisi!', 'error');
        return;
    }

    // Set Loading State
    btnSave.disabled = true;
    btnSave.innerHTML = `<span class="material-symbols-outlined animate-spin text-sm">sync</span> Saving...`;

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageEvents',
                sub_action: id ? 'update' : 'create',
                event_id: id || undefined,
                event_data: eventData
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        showNotification('✅ Event berhasil disimpan!', 'success');
        window.closeEventModal();
        window.loadEvents();

    } catch (err) {
        logger.error('Save event error:', err);
        showNotification('Gagal menyimpan event: ' + err.message, 'error');
    } finally {
        // Restore Button State
        btnSave.disabled = false;
        btnSave.innerHTML = originalBtnText;
    }
};

window.deleteEvent = async function (id) {
    if (!confirm('Hapus event ini? Data pendaftaran juga akan terhapus.')) return;

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageEvents',
                sub_action: 'delete',
                event_id: id
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Unknown error');

        showNotification('✅ Event dihapus!', 'success');
        window.closeEventModal();
        window.loadEvents();
    } catch (err) {
        logger.error('Error deleting event:', err);
        showNotification('❌ Gagal menghapus: ' + err.message, 'error');
    }
};

window.handleDeleteFromModal = function () {
    const id = document.getElementById('eventId').value;
    if (id) window.deleteEvent(id);
};

window.handleImageUpload = async function (input) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        showNotification("File terlalu besar! Maksimal 2MB.", "error");
        input.value = '';
        return;
    }

    const placeholder = document.getElementById('uploadPlaceholder');
    const preview = document.getElementById('uploadPreview');
    const loading = document.getElementById('uploadLoading');
    const previewImg = document.getElementById('previewImg');
    const urlInput = document.getElementById('eventImageUrl');

    placeholder.classList.add('hidden');
    preview.classList.add('hidden');
    loading.classList.remove('hidden');

    try {
        const fileName = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
        const { data, error } = await sbClient.storage
            .from('events')
            .upload(fileName, file);

        if (error) throw error;

        const { data: { publicUrl } } = sbClient.storage
            .from('events')
            .getPublicUrl(fileName);

        urlInput.value = publicUrl;
        previewImg.src = publicUrl;
        loading.classList.add('hidden');
        preview.classList.remove('hidden');
        preview.classList.add('flex');

    } catch (err) {
        logger.error("Upload error:", err);
        showNotification("Gagal upload gambar: " + err.message, "error");
        loading.classList.add('hidden');
        placeholder.classList.remove('hidden');
        input.value = '';
    }
};

// --- QR SCANNER ---

window.toggleQrScanner = function () {
    const content = document.getElementById('qrScannerContent');
    const arrow = document.getElementById('qrScannerArrow');
    content.classList.toggle('hidden');
    arrow.style.transform = content.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
};

window.startScanner = function () {
    if (!selectedQrEventId) {
        showNotification('Pilih event terlebih dahulu!', 'warning');
        return;
    }

    if (!window.Html5Qrcode) {
        showNotification('QR Library belum siap!', 'error');
        return;
    }

    html5QrCode = new window.Html5Qrcode("qr-reader");
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        onQrScanSuccess,
        () => { } // Ignore failures
    ).then(() => {
        document.getElementById('startScanBtn').classList.add('hidden');
        document.getElementById('stopScanBtn').classList.remove('hidden');
    }).catch(err => {
        logger.error('Scanner error:', err);
        showNotification('Gagal mengakses kamera: ' + err, 'error');
    });
};

window.stopScanner = function () {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            document.getElementById('startScanBtn').classList.remove('hidden');
            document.getElementById('stopScanBtn').classList.add('hidden');
        });
    }
};

async function onQrScanSuccess(decodedText) {
    window.stopScanner();
    await processQrCode(decodedText);
}

window.processManualInput = async function () {
    const code = document.getElementById('manualQrCode').value.trim();
    if (!code) {
        showNotification('Masukkan kode QR!', 'warning');
        return;
    }
    await processQrCode(code);
};

async function processQrCode(qrCode) {
    if (!selectedQrEventId) {
        showNotification('Pilih event terlebih dahulu!', 'warning');
        return;
    }

    const { data: reg, error } = await sbClient
        .from('event_registrations')
        .select('*, events(title, xp_reward, point_reward, reward_achievement_id)')
        .eq('qr_code', qrCode)
        .single();

    if (error || !reg) {
        showQrResult({ success: false, message: '❌ QR Code tidak ditemukan!' });
        return;
    }

    if (reg.event_id !== selectedQrEventId) {
        showQrResult({ success: false, message: '⚠️ QR Code ini untuk event berbeda!' });
        return;
    }

    if (reg.status === 'attended') {
        showQrResult({ success: false, message: '⚠️ Peserta sudah tercatat HADIR!', data: reg });
        return;
    }

    currentQrRegistration = reg;
    showQrResult({ success: true, message: '✅ Peserta ditemukan!', data: reg });
}

function showQrResult(result) {
    const area = document.getElementById('qrResultArea');
    const content = document.getElementById('qrResultContent');
    const confirmBtn = document.getElementById('confirmAttendBtn');

    area.classList.remove('hidden');

    if (result.data) {
        content.innerHTML = `
            <div class="text-center p-6 border-4 border-black rounded-2xl font-body ${result.success ? 'bg-green-50' : 'bg-yellow-50'} shadow-[4px_4px_0px_#000]">
                <div class="w-20 h-20 mx-auto bg-white border-4 border-black rounded-full flex items-center justify-center text-3xl mb-4 shadow-[4px_4px_0px_#000]">
                    ${result.success ? '✅' : '⚠️'}
                </div>
                <p class="text-[10px] font-black opacity-40 uppercase tracking-widest mb-1">${result.message}</p>
                <p class="text-2xl font-black text-black leading-tight mb-2 uppercase drop-shadow-sm">${result.data.full_name}</p>
                <div class="flex justify-center gap-2 mb-4">
                    <span class="bg-black text-white px-3 py-1 rounded-full text-[10px] font-black">${result.data.phone || 'NO PHONE'}</span>
                    <span class="px-3 py-1 rounded-full text-[10px] font-black border-2 border-black uppercase ${result.data.status === 'attended' ? 'bg-blue-500 text-white' : 'bg-white text-black'}">
                        STATUS: ${result.data.status}
                    </span>
                </div>
            </div>
        `;
        confirmBtn.classList.toggle('hidden', !result.success || result.data.status === 'attended');
    } else {
        content.innerHTML = `
            <div class="text-center p-8 bg-red-50 border-4 border-black rounded-2xl font-body shadow-[4px_4px_0px_#000]">
                <div class="text-5xl mb-4">🚫</div>
                <p class="text-xl font-black text-red-600 uppercase tracking-tighter">${result.message}</p>
                <p class="text-xs font-bold opacity-60 mt-2 italic">Pastikan QR Code berasal dari tiket event yang benar.</p>
            </div>
        `;
        confirmBtn.classList.add('hidden');
    }
}

window.clearQrResult = function () {
    const area = document.getElementById('qrResultArea');
    if (area) area.classList.add('hidden');
    const input = document.getElementById('manualQrCode');
    if (input) input.value = '';
    currentQrRegistration = null;
};

window.confirmAttendance = async function () {
    if (!currentQrRegistration) return;
    const reg = currentQrRegistration;
    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'confirmAttendance',
                registration_id: reg.id
            }
        });

        if (error) throw error;
        if (data && !data.success) throw new Error(data.error || 'Server error');

        showNotification(`✅ ${reg.full_name} tercatat HADIR!`, 'success');
        window.clearQrResult();
        window.loadQrStats();
        window.loadEvents();

    } catch (err) {
        logger.error('Error confirming attendance:', err);
        showNotification('Gagal mengkonfirmasi: ' + err.message, 'error');
    }
};

window.loadQrStats = async function () {
    if (!selectedQrEventId) return;

    const { count: total } = await sbClient
        .from('event_registrations')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', selectedQrEventId);

    const { count: attended } = await sbClient
        .from('event_registrations')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', selectedQrEventId)
        .eq('status', 'attended');

    document.getElementById('qrTotalRegistered').textContent = total || 0;
    document.getElementById('qrTotalAttended').textContent = attended || 0;
    document.getElementById('qrTotalRemaining').textContent = (total || 0) - (attended || 0);
};

// --- REWARD HOST ---

window.openRewardHostModal = function (eventId) {
    const event = allEvents.find(e => e.id == eventId);
    if (!event || !event.host_id) {
        showNotification('Host tidak ditemukan untuk event ini.', 'error');
        return;
    }

    document.getElementById('rewardHostEventId').value = eventId;
    document.getElementById('rewardHostProfileId').value = event.host_id;
    document.getElementById('rewardEventTitle').textContent = event.title;
    document.getElementById('rewardHostName').textContent = event.host_name || 'JDKwan Member';
    document.getElementById('hostRewardXp').value = 100; // Default XP reward
    document.getElementById('hostRewardBadge').value = '';

    const modal = document.getElementById('rewardHostModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeRewardHostModal = function () {
    const modal = document.getElementById('rewardHostModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.grantHostReward = async function () {
    const eventId = document.getElementById('rewardHostEventId').value;
    const profileId = document.getElementById('rewardHostProfileId').value;
    const xpAmount = parseInt(document.getElementById('hostRewardXp').value) || 0;
    const badgeId = document.getElementById('hostRewardBadge').value;
    const eventTitle = document.getElementById('rewardEventTitle').textContent;

    if (!profileId) return;

    try {
        // 1. Grant XP if applicable
        if (xpAmount > 0) {
            const { data: xpResult, error: xpError } = await sbClient.functions.invoke('jdk-secure-handler', {
                body: {
                    action: 'adminAdjustBalance',
                    target_user_id: profileId,
                    balance_type: 'xp',
                    amount: xpAmount,
                    description: `Reward hosting event: ${eventTitle}`
                }
            });
            if (xpError) throw xpError;
            if (!xpResult.success) throw new Error(xpResult.error || 'Gagal mengirim XP');
        }

        // 2. Grant Badge if applicable
        if (badgeId) {
            const { data: ach } = await sbClient
                .from('achievements')
                .select('id, title, icon_emoji')
                .eq('id', badgeId)
                .single();

            if (ach) {
                const { data: achResult, error: achError } = await sbClient.functions.invoke('jdk-secure-handler', {
                    body: {
                        action: 'adminGrantAchievement',
                        target_user_id: profileId,
                        achievement_id: ach.id,
                        reason: `Reward hosting event: ${eventTitle}`
                    }
                });
                if (achError) throw achError;
                if (!achResult.success) throw new Error(achResult.error || 'Gagal mengirim Badge');

                if (!achResult.already_owned) {
                    showNotification(`🏆 Badge Unlocked: ${ach.title} ${ach.icon_emoji || ''}`, 'success');
                }
            }
        }

        showNotification('✅ Reward berhasil dikirim ke Host!', 'success');
        window.closeRewardHostModal();

    } catch (err) {
        logger.error('Grant host reward error:', err);
        showNotification('Gagal mengirim reward: ' + err.message, 'error');
    }
};

// --- CERTIFICATE EDITOR ---

// Dynamic Template Loading
// We now try to fetch from server first (PHP scanner) for runtime updates.
// import.meta.glob is removed because it's build-time only.

// PDF to Image Converter Helper
async function convertPdfToImage(url) {
    try {
        if (typeof pdfjsLib === 'undefined') {
            logger.error('pdfjsLib is not loaded. Make sure to include it.');
            return null;
        }
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 }); // Reasonable scale for quality
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        return canvas.toDataURL('image/png');
    } catch (error) {
        logger.error('Error converting PDF to image:', error);
        return null;
    }
}

async function renderCertTemplates() {
    const container = document.getElementById('certTemplateGrid');
    if (!container) return;

    container.innerHTML = '<p class="col-span-3 text-xs text-center py-2"><span class="material-symbols-outlined animate-spin text-sm">sync</span> Loading...</span></p>';

    let templatePaths = [];

    // 1. Try to fetch from server scanner (Hostinger)
    try {
        const response = await fetch('scan_templates.php');
        if (response.ok) {
            templatePaths = await response.json();
            logger.log('[DEBUG] Loaded templates from server:', templatePaths);
        } else {
            throw new Error('Scanner not found');
        }
    } catch (e) {
        logger.warn('[DEBUG] Server scan failed (expected locally), using static fallback.');
        // Fallback for local dev (hardcoded list since glob is tricky with public folder in local serve)
        templatePaths = [
            'images/cert_templates/cert_bg_classic.png',
            'images/cert_templates/cert_bg_modern.png',
            'images/cert_templates/cert_bg_minimal.png',
            'images/cert_templates/cert_bg_nano_fun.png',
            'images/cert_templates/cert_bg_nano_tech.png',
            'images/cert_templates/cert_bg_nano_gold.png'
        ];
    }

    container.innerHTML = '';

    if (templatePaths.length === 0) {
        container.innerHTML = '<p class="col-span-3 text-xs text-slate-400 italic text-center py-2">No templates found</p>';
        return;
    }

    templatePaths.sort();

    for (const path of templatePaths) {
        const url = path; // Path relative to root is usually valid URL for public assets
        let name = path.split('/').pop().replace(/\.[^/.]+$/, '');
        name = name.replace(/^cert_bg_/, '').replace(/_/g, ' ').toUpperCase();
        if (name.startsWith('NANO ')) name = name.replace('NANO ', 'NANO<br>');

        const isPdf = path.toLowerCase().endsWith('.pdf');

        const div = document.createElement('div');
        div.className = 'cursor-pointer border-2 border-slate-200 hover:border-blue-500 rounded-lg overflow-hidden relative group';
        div.innerHTML = `
            <div class="w-full h-20 bg-slate-100 flex items-center justify-center">
                <span class="material-symbols-outlined animate-spin text-slate-400">progress_activity</span>
            </div>
            <div class="absolute inset-0 bg-black/40 hidden group-hover:flex items-center justify-center text-white text-[10px] font-bold text-center leading-tight">
                ${name}
            </div>
        `;
        container.appendChild(div);

        // Render content
        try {
            let imgSrc = url;
            if (isPdf) {
                const converted = await convertPdfToImage(url);
                if (converted) imgSrc = converted;
            }

            // Update inner HTML
            div.onclick = () => window.selectCertTemplate(url); // Pass original URL (PDF or Image)
            div.querySelector('div').replaceWith(Object.assign(document.createElement('img'), {
                src: imgSrc,
                className: `w-full h-20 object-cover ${name.includes('NANO') ? 'object-top' : ''}`,
                onerror: () => { div.innerHTML = '<span class="text-[10px] text-red-500 p-2">Failed to load</span>'; }
            }));

        } catch (e) {
            logger.error('Template render error:', e);
            div.innerHTML = `<div class="w-full h-20 bg-red-50 flex items-center justify-center text-xs text-red-500">Error</div>`;
        }
    }
}

window.openCertEditModal = function (eventId) {
    logger.log('[DEBUG] request OpenCertModal:', eventId);
    renderCertTemplates(); // Load templates when modal opens

    const event = allEvents.find(e => e.id == eventId);

    if (!event) {
        logger.error('[DEBUG] Event not found for ID:', eventId);
        showNotification('Data event tidak ditemukan', 'error');
        return;
    }

    document.getElementById('certEventId').value = eventId;
    document.getElementById('certTitle').value = event.cert_title ?? 'CERTIFICATE OF APPRECIATION';
    document.getElementById('certBody').value = event.cert_body || 'Dengan ini menyatakan bahwa [NAME] telah berhasil mengikuti dan menyelesaikan rangkaian kegiatan [EVENT] yang diselenggarakan oleh JDK Entertainment pada tanggal [DATE].';
    document.getElementById('certSignerName').value = event.cert_signer_name || 'JADUL KEKINIAN';
    document.getElementById('certSignerRole').value = event.cert_signer_role || 'Event Coordinator';

    // Handle BG URL and Preview State
    const bgUrl = event.cert_bg_url || '';
    document.getElementById('certBgUrl').value = bgUrl;

    const previewImg = document.getElementById('certPreviewImg');
    const uploadPlaceholder = document.getElementById('certUploadPlaceholder');
    const uploadPreview = document.getElementById('certUploadPreview');

    if (bgUrl) {
        previewImg.src = bgUrl;
        uploadPreview.classList.remove('hidden');
        uploadPreview.classList.add('flex');
        uploadPlaceholder.classList.add('hidden');
    } else {
        uploadPreview.classList.add('hidden');
        uploadPreview.classList.remove('flex');
        uploadPlaceholder.classList.remove('hidden');
    }

    const modal = document.getElementById('certEditModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.handleCertBgUpload = async function (input) {
    const file = input.files[0];
    if (!file) return;

    // Validate size (2MB)
    if (file.size > 2 * 1024 * 1024) {
        alert('File size too large! Max 2MB.');
        input.value = '';
        return;
    }

    const preview = document.getElementById('certUploadPreview');
    const placeholder = document.getElementById('certUploadPlaceholder');
    const loading = document.getElementById('certUploadLoading');
    const previewImg = document.getElementById('certPreviewImg');
    const urlInput = document.getElementById('certBgUrl');

    preview.classList.remove('flex');
    preview.classList.add('hidden');
    placeholder.classList.add('hidden');
    loading.classList.remove('hidden');

    try {
        let fileToUpload = file;
        let fileExt = file.name.split('.').pop();

        // If PDF, convert to PNG first
        if (file.type === 'application/pdf') {
            const fileUrl = URL.createObjectURL(file);
            const pngDataUrl = await convertPdfToImage(fileUrl);
            if (!pngDataUrl) throw new Error("PDF Conversion failed");

            // Convert DataURL to Blob
            const response = await fetch(pngDataUrl);
            const blob = await response.blob();
            fileToUpload = new File([blob], file.name.replace('.pdf', '.png'), { type: 'image/png' });
            fileExt = 'png';
            URL.revokeObjectURL(fileUrl);
        }

        // Upload to Supabase
        const fileName = `cert_bg_${Date.now()}.${fileExt}`;
        const { data, error } = await sbClient.storage
            .from('events')
            .upload(fileName, fileToUpload);

        if (error) throw error;

        // Get Public URL
        const { data: { publicUrl } } = sbClient.storage
            .from('events')
            .getPublicUrl(fileName);

        urlInput.value = publicUrl;
        previewImg.src = publicUrl;

        // Show preview
        loading.classList.add('hidden');
        preview.classList.remove('hidden');
        preview.classList.add('flex');

    } catch (error) {
        logger.error('Upload error:', error);
        alert('Upload failed: ' + error.message);
        loading.classList.add('hidden');
        placeholder.classList.remove('hidden');
    } finally {
        input.value = ''; // Reset input
    }
};

window.openCertPreview = async function () {
    const title = document.getElementById('certTitle').value;
    const body = document.getElementById('certBody').value;
    const signer = document.getElementById('certSignerName').value;
    const role = document.getElementById('certSignerRole').value;
    let bgUrl = document.getElementById('certBgUrl').value;

    const modal = document.getElementById('certPreviewModal');
    const container = document.getElementById('certPreviewContainer');
    const prevTitle = document.getElementById('prevCertTitle');
    const prevBody = document.getElementById('prevCertBody');
    const prevSigner = document.getElementById('prevCertSigner');
    const prevRole = document.getElementById('prevCertRole');

    // Handle PDF background for preview
    if (bgUrl && bgUrl.toLowerCase().endsWith('.pdf')) {
        const imgData = await convertPdfToImage(bgUrl);
        if (imgData) {
            container.style.backgroundImage = `url(${imgData})`;
        } else {
            container.style.backgroundImage = 'none';
        }
    } else {
        container.style.backgroundImage = bgUrl ? `url(${bgUrl})` : 'none';
        // Add white background fallback if none
        if (!bgUrl) container.style.backgroundColor = '#ffffff';
    }

    prevTitle.textContent = title;

    let formattedBody = body;
    const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    const dateStr = event && event.date
        ? new Date(event.date).toLocaleDateString('id-ID', dateOptions)
        : new Date().toLocaleDateString('id-ID', dateOptions);

    formattedBody = formattedBody.replace(/\[NAME\]/g, '<strong>JOHN DOE</strong>');
    formattedBody = formattedBody.replace(/\[EVENT\]/g, '<strong>EVENT TITLE</strong>');
    formattedBody = formattedBody.replace(/\[DATE\]/g, `<strong>${dateStr}</strong>`);

    prevBody.innerHTML = formattedBody;
    prevSigner.textContent = signer;
    prevRole.textContent = role;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeCertPreview = function () {
    const modal = document.getElementById('certPreviewModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.closeCertEditModal = function () {
    const modal = document.getElementById('certEditModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.selectCertTemplate = async function (url) {
    document.getElementById('certBgUrl').value = url;

    const previewImg = document.getElementById('certPreviewImg');

    // Check if PDF
    if (url.toLowerCase().endsWith('.pdf')) {
        // Show loading state if needed, or just wait
        const imgData = await convertPdfToImage(url);
        if (imgData) {
            previewImg.src = imgData;
        } else {
            previewImg.alt = 'PDF Template Selected';
            previewImg.src = ''; // Clear broken image
        }
    } else {
        previewImg.src = url;
    }

    // Update preview state
    document.getElementById('certUploadPreview').classList.remove('hidden');
    document.getElementById('certUploadPreview').classList.add('flex');
    document.getElementById('certUploadPlaceholder').classList.add('hidden');
};

window.removeCertBackground = function () {
    document.getElementById('certBgUrl').value = '';
    document.getElementById('certPreviewImg').src = '';

    // Reset preview state
    document.getElementById('certUploadPreview').classList.add('hidden');
    document.getElementById('certUploadPreview').classList.remove('flex');
    document.getElementById('certUploadPlaceholder').classList.remove('hidden');
};

window.saveCertTemplate = async function () {
    const eventId = document.getElementById('certEventId').value;
    const certData = {
        cert_title: document.getElementById('certTitle').value,
        cert_body: document.getElementById('certBody').value,
        cert_signer_name: document.getElementById('certSignerName').value,
        cert_signer_role: document.getElementById('certSignerRole').value,
        cert_bg_url: document.getElementById('certBgUrl').value
    };

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminUpdateCertTemplate',
                event_id: eventId,
                cert_data: certData
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Server error');

        showNotification('✅ Desain sertifikat disimpan!', 'success');
        window.closeCertEditModal();
        window.loadEvents(); // Refresh local data

    } catch (err) {
        logger.error('Error saving cert template:', err);
        showNotification('❌ Gagal menyimpan: ' + err.message, 'error');
    }
};

/**
 * Broadcast to all participants of current event
 */
window.openBroadcastModal = function (eventId, eventTitle) {
    if (eventId) currentEventId = eventId;
    const modal = document.getElementById('broadcastModal');
    const title = eventTitle || document.getElementById('participantModalTitle').innerText;

    // Set title and clear inputs
    document.getElementById('broadcastEventTitle').innerText = title.replace('PESERTA: ', '');
    document.getElementById('ebc_title').value = '';
    document.getElementById('ebc_message').value = '';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

window.closeBroadcastModal = function () {
    const modal = document.getElementById('broadcastModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

window.sendEventBroadcast = async function () {
    if (!currentEventId) return;

    const title = document.getElementById('ebc_title').value;
    const message = document.getElementById('ebc_message').value;
    const btn = document.getElementById('sendBroadcastBtn');

    if (!title || !message) return showNotification('Harap isi judul dan pesan!');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">sync</span> Mengirim...';
    }

    showNotification('Mengirim broadcast ke peserta... ⏳', 'info');

    try {
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminEventBroadcast',
                event_id: currentEventId,
                title: title,
                message: message
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Gagal mengirim broadcast');

        showNotification(`✅ Berhasil! ${data.message}`, 'success');
        window.closeBroadcastModal();
    } catch (err) {
        logger.error('Broadcast error:', err);
        showNotification('Gagal: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<span class="material-symbols-outlined">send</span> Kirim Broadcast';
        }
    }
}

// --- TOURNAMENT SCORING ---

window.toggleTournamentScoring = async function () {
    const colHeads = document.querySelectorAll('.scoring-col');
    const controls = document.getElementById('scoringControls');
    const closeBtn = document.getElementById('btnCloseParticipantModal');
    const isVisible = !controls.classList.contains('hidden');

    if (isVisible) {
        // Hide
        colHeads.forEach(el => el.classList.add('hidden'));
        controls.classList.add('hidden');
        closeBtn.classList.remove('hidden');
    } else {
        // Show
        colHeads.forEach(el => el.classList.remove('hidden'));
        controls.classList.remove('hidden');
        closeBtn.classList.add('hidden');

        // Populate games if needed
        const select = document.getElementById('scoringGameId');
        if (select.options.length <= 1) {
            const { data, error } = await sbClient.from('games').select('id, name').order('name');
            if (data) {
                select.innerHTML = '<option value="">-- PILIH GAME LEADERBOARD --</option>' +
                    data.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
            }
        }
    }
};

window.saveAllTournamentScores = async function () {
    const gameId = document.getElementById('scoringGameId').value;
    const inputs = document.querySelectorAll('.tournament-score-input');
    const btn = document.getElementById('btnSaveAllScores');

    if (!gameId) return showNotification('Pilih game leaderboard dulu!', 'warning');

    const scoresToSave = [];
    inputs.forEach(input => {
        const val = input.value.trim();
        const userId = input.getAttribute('data-user-id');

        // Validation: Must have value, must not be disabled, and MUST be a valid UUID
        if (val !== '' && !input.disabled && userId && userId !== 'null' && userId.length > 20) {
            scoresToSave.push({
                user_id: userId,
                score: parseInt(val)
            });
        }
    });

    if (scoresToSave.length === 0) return showNotification('Tidak ada skor yang diisi!', 'warning');

    if (!confirm(`Simpan ${scoresToSave.length} hasil tournament?`)) return;

    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-sm">sync</span> Processing...';

    let successCount = 0;
    let failCount = 0;

    for (const item of scoresToSave) {
        try {
            const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
                body: {
                    action: 'adminRecordScore',
                    target_user_id: item.user_id,
                    game_id: gameId,
                    score: item.score
                }
            });

            if (error || (data && !data.success)) {
                logger.error(`Error saving score for ${item.user_id}:`, error || data.error);
                failCount++;
            } else {
                successCount++;
            }
        } catch (err) {
            logger.error(err);
            failCount++;
        }
    }

    showNotification(`✅ Selesai! ${successCount} skor tersimpan. ${failCount > 0 ? `${failCount} gagal.` : ''}`, successCount > 0 ? 'success' : 'error');

    if (successCount > 0) {
        toggleTournamentScoring();
    }
    btn.disabled = false;
    btn.innerHTML = originalText;
};
