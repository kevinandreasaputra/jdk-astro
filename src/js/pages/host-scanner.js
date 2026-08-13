import { logger } from '../core/logger.js';
/**
 * Host Scanner Logic
 * JDK Entertainment
 * 
 * Allows event Hosts to scan attendee QR codes.
 */
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';

let html5QrCode = null;
let selectedEventId = null;
let currentRegistration = null;
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const { data: { user } } = await sbClient.auth.getUser();

    if (!user) {
        document.getElementById('authStatus').innerHTML = `
            <div class="bg-white rounded-3xl p-8 border-2 border-black shadow-comic text-center space-y-6">
                <div class="w-20 h-20 bg-blue-100 text-comic-blue border-2 border-blue-200 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span class="material-symbols-outlined text-[40px]">lock</span>
                </div>
                <h2 class="text-2xl font-black text-black uppercase">Login Required</h2>
                <p class="text-gray-600 font-bold leading-relaxed max-w-sm mx-auto">
                    Please log in to your account to access the host scanner tools.
                </p>
                <a href="login.html" class="btn-primary w-full max-w-xs mx-auto">
                    Go to Login
                </a>
            </div>
        `;
        return;
    }

    currentUser = user;

    // Get profile to check role
    const { data: profile } = await sbClient.from('profiles').select('full_name, username, user_level').eq('id', user.id).single();
    if (profile) {
        const displayName = profile.full_name || profile.username || 'Host';
        document.getElementById('currentUserName').textContent = displayName;
        document.getElementById('userBadge').classList.remove('hidden');
        document.getElementById('userBadge').classList.add('flex');
    }

    // Load events
    await loadMyEvents(profile?.user_level);
});

window.loadMyEvents = async function (role) {
    let query = sbClient
        .from('events')
        .select('id, title, date');

    // If not Admin, only show events where user is Host
    if (role !== 'Admin') {
        query = query.eq('host_id', currentUser.id);
    }

    const { data: events, error } = await query
        .order('date', { ascending: false });

    if (error) {
        logger.error('Error loading host events:', error);
        showNotification('Gagal memuat event', 'error');
        return;
    }

    if (!events || events.length === 0) {
        document.getElementById('authStatus').classList.add('hidden');
        document.getElementById('notHostMessage').classList.remove('hidden');
        return;
    }

    // Populate event selector
    const select = document.getElementById('eventSelect');
    select.innerHTML = '<option value="">-- Pilih Event --</option>' +
        events.map(e => `<option value="${e.id}">${e.date} - ${e.title}</option>`).join('');

    select.onchange = () => {
        selectedEventId = select.value;
        const selectedText = select.options[select.selectedIndex].text;

        if (selectedEventId) {
            document.getElementById('activeEventBadge').classList.remove('hidden');
            document.getElementById('activeEventBadge').classList.add('flex');
            document.getElementById('activeEventTitle').textContent = selectedText.split(' - ')[1] || selectedText;

            loadStats();
            loadEventInfo();
            loadAttendees();
            document.getElementById('eventInfoSection').classList.remove('hidden');
            document.getElementById('attendeeSection').classList.remove('hidden');
        } else {
            document.getElementById('activeEventBadge').classList.add('hidden');
            document.getElementById('activeEventBadge').classList.remove('flex');
            document.getElementById('eventInfoSection').classList.add('hidden');
            document.getElementById('attendeeSection').classList.add('hidden');
        }
    };

    // Show main content
    document.getElementById('authStatus').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');

    // Handle initial event selection from URL
    const urlParams = new URLSearchParams(window.location.search);
    const urlEventId = urlParams.get('event');
    if (urlEventId) {
        select.value = urlEventId;
        select.dispatchEvent(new Event('change'));
    }
};

window.loadStats = async function () {
    if (!selectedEventId) return;

    const { data: registrations, error } = await sbClient
        .from('event_registrations')
        .select('status')
        .eq('event_id', selectedEventId);

    if (error) {
        logger.error('Error loading stats:', error);
        return;
    }

    const total = registrations.length;
    const attended = registrations.filter(r => r.status === 'attended').length;
    const remaining = total - attended;

    document.getElementById('statRegistered').textContent = total;
    document.getElementById('statAttended').textContent = attended;
    document.getElementById('statRemaining').textContent = remaining;
};

// --- SCANNER LOGIC ---

let scannerMode = 'camera'; // 'camera' or 'file'

window.startScanner = function () {
    if (!selectedEventId) {
        showNotification('Pilih event terlebih dahulu!', 'warning');
        return;
    }

    if (!window.Html5Qrcode) {
        showNotification('QR Library belum siap!', 'error');
        return;
    }

    if (scannerMode === 'file') {
        window.toggleFileMode(); // Switch back to camera if we clicked Start Camera while in file mode
    }

    // Ensure stop any previous instance
    if (html5QrCode) {
        html5QrCode.stop().catch(() => { }).finally(() => {
            initLiveScanner();
        });
    } else {
        initLiveScanner();
    }
};

function initLiveScanner() {
    html5QrCode = new window.Html5Qrcode("qr-reader");
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 250, height: 250 } },
        onScanSuccess,
        () => { }
    ).then(() => {
        document.getElementById('startScanBtn').classList.add('hidden');
        document.getElementById('stopScanBtn').classList.remove('hidden');
        const scanLine = document.getElementById('scanLine');
        if (scanLine) {
            scanLine.classList.add('opacity-100');
            scanLine.style.animation = 'scan 2s linear infinite';
        }
        document.getElementById('scanModeLabel').textContent = 'Live Camera';
        document.getElementById('scanModeLabel').classList.remove('bg-comic-purple');
        document.getElementById('scanModeLabel').classList.add('bg-comic-blue');
    }).catch(err => {
        logger.error('Scanner error:', err);
        showNotification('Gagal mengakses kamera', 'error');
    });
}

window.stopScanner = function () {
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().then(() => {
            document.getElementById('startScanBtn').classList.remove('hidden');
            document.getElementById('stopScanBtn').classList.add('hidden');
            const scanLine = document.getElementById('scanLine');
            if (scanLine) {
                scanLine.classList.remove('opacity-100');
                scanLine.style.animation = 'none';
            }
        });
    }
};

window.toggleFileMode = function () {
    if (scannerMode === 'camera') {
        window.stopScanner();
        scannerMode = 'file';
        document.getElementById('fileUploadOverlay').classList.remove('hidden');
        document.getElementById('fileBtnIcon').textContent = 'photo_camera';
        document.getElementById('fileBtnText').textContent = 'Camera';
        document.getElementById('scanModeLabel').textContent = 'Photo Scan';
        document.getElementById('scanModeLabel').classList.add('bg-comic-purple');
        document.getElementById('scanModeLabel').classList.remove('bg-comic-blue');
    } else {
        scannerMode = 'camera';
        document.getElementById('fileUploadOverlay').classList.add('hidden');
        document.getElementById('fileBtnIcon').textContent = 'file_upload';
        document.getElementById('fileBtnText').textContent = 'File';
        document.getElementById('scanModeLabel').textContent = 'Live Camera';
    }
};

// Handle File Input
document.getElementById('qrFileInput')?.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files.length > 0) {
        const imageFile = e.target.files[0];

        if (!selectedEventId) {
            showNotification('Pilih event terlebih dahulu!', 'warning');
            return;
        }

        // Initialize scanner instance if not exists
        if (!html5QrCode) {
            html5QrCode = new window.Html5Qrcode("qr-reader");
        }

        window.showNotification('Scanning image... ⏳', 'info');

        html5QrCode.scanFile(imageFile, true)
            .then(decodedText => {
                processQrCode(decodedText);
            })
            .catch(err => {
                logger.error('File scan error:', err);
                showNotification('QR Code tidak terdeteksi di gambar ini.', 'error');
            });
    }
});

async function onScanSuccess(decodedText) {
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
    if (!selectedEventId) {
        showNotification('Pilih event terlebih dahulu!', 'warning');
        return;
    }

    const { data: reg, error } = await sbClient
        .from('event_registrations')
        .select('*, events(title, xp_reward, point_reward, reward_achievement_id)')
        .eq('qr_code', qrCode)
        .single();

    if (error || !reg) {
        showResult({ success: false, message: '❌ QR Code tidak ditemukan!' });
        return;
    }

    if (reg.event_id !== selectedEventId) {
        showResult({ success: false, message: '⚠️ QR Code ini untuk event berbeda!' });
        return;
    }

    if (reg.status === 'attended') {
        showResult({ success: false, message: '⚠️ Peserta sudah tercatat HADIR!', data: reg });
        return;
    }

    currentRegistration = reg;
    showResult({ success: true, message: '✅ Peserta ditemukan!', data: reg });
}

function showResult(result) {
    const area = document.getElementById('resultArea');
    const content = document.getElementById('resultContent');
    const confirmBtn = document.getElementById('confirmBtn');
    const badge = document.getElementById('resultStatusBadge');

    area.classList.remove('hidden');

    if (result.data) {
        const isAttended = result.data.status === 'attended';

        badge.textContent = isAttended ? 'ATTENDED' : 'FOUND';
        badge.className = `px-2 py-0.5 rounded-full text-[9px] font-bold ${isAttended ? 'bg-comic-green text-white' : 'bg-comic-blue text-white'}`;

        content.innerHTML = `
            <div class="flex flex-col items-center">
                <div class="w-16 h-16 bg-white border-2 border-black rounded-full flex items-center justify-center mb-4 text-2xl shadow-[2px_2px_0px_#000]">
                    ${isAttended ? '✅' : '👤'}
                </div>
                <h2 class="text-2xl font-black text-black tracking-tight uppercase">${result.data.full_name}</h2>
                <div class="flex items-center gap-2 text-gray-500 text-sm mt-1 font-bold">
                    <span class="material-symbols-outlined text-[16px]">phone</span>
                    <span>${result.data.phone || 'No Phone'}</span>
                </div>
                
                <div class="mt-6 p-4 rounded-xl w-full ${result.success ? 'bg-green-100 text-green-800 border-2 border-green-200' : 'bg-yellow-100 text-yellow-800 border-2 border-yellow-200'}">
                    <p class="text-sm font-black uppercase tracking-widest mb-1">${result.message}</p>
                    <p class="text-[10px] font-bold opacity-80">ID: ${result.data.id.split('-')[0]}...</p>
                </div>
            </div>
        `;
        confirmBtn.classList.toggle('hidden', !result.success || isAttended);
    } else {
        badge.textContent = 'NOT FOUND';
        badge.className = 'px-2 py-0.5 rounded-full text-[9px] font-bold bg-comic-red text-white';

        content.innerHTML = `
            <div class="py-6 flex flex-col items-center">
                <div class="w-16 h-16 bg-red-100 text-comic-red border-2 border-red-200 rounded-full flex items-center justify-center mb-4">
                    <span class="material-symbols-outlined text-[32px]">error</span>
                </div>
                <h3 class="font-black text-black uppercase">${result.message}</h3>
                <p class="text-xs text-gray-500 mt-2 font-bold">Please try scanning again or input manually.</p>
            </div>
        `;
        confirmBtn.classList.add('hidden');
    }
}

window.clearResult = function () {
    document.getElementById('resultArea').classList.add('hidden');
    document.getElementById('manualQrCode').value = '';
    currentRegistration = null;
};

window.confirmAttendance = async function () {
    if (!currentRegistration) {
        showNotification('Tidak ada data peserta!', 'error');
        return;
    }

    const reg = currentRegistration;
    const confirmBtn = document.getElementById('confirmBtn');

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="material-symbols-outlined animate-spin">sync</span> Confirming...';

    try {
        // 1. Update registration status via secure Edge Function
        const { data, error: updateError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'confirmAttendance',
                registration_id: reg.id
            }
        });

        if (updateError) throw updateError;
        if (!data.success) throw new Error(data.error || 'Server error');

        showNotification(`✅ ${reg.full_name} tercatat HADIR!`, 'success');
        clearResult();
        loadStats();
        loadAttendees(); // Refresh attendee list

    } catch (err) {
        logger.error('Error confirming:', err);
        showNotification('❌ Gagal: ' + err.message, 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<span class="material-symbols-outlined">done_all</span> Confirm Attendance';
    }
};

// --- EVENT INFO ---
let currentEventData = null;

window.loadEventInfo = async function () {
    if (!selectedEventId) return;

    const { data: event, error } = await sbClient
        .from('events')
        .select('title, date, time, location, xp_reward, point_reward, total_quota')
        .eq('id', selectedEventId)
        .single();

    if (error || !event) {
        logger.error('Error loading event info:', error);
        return;
    }

    currentEventData = event;

    const content = document.getElementById('eventInfoContent');
    content.innerHTML = `
        <div class="space-y-1">
            <span class="text-[10px] font-black text-gray-400 uppercase">Waktu</span>
            <p class="text-xs font-bold text-black">${event.time || '-'}</p>
        </div>
        <div class="space-y-1">
            <span class="text-[10px] font-black text-gray-400 uppercase">Lokasi</span>
            <p class="text-xs font-bold text-black">${event.location || '-'}</p>
        </div>
        <div class="space-y-1">
            <span class="text-[10px] font-black text-gray-400 uppercase">XP Reward</span>
            <p class="text-xs font-black text-comic-blue">${event.xp_reward || 0} XP</p>
        </div>
        <div class="space-y-1">
            <span class="text-[10px] font-black text-gray-400 uppercase">Points</span>
            <p class="text-xs font-black text-comic-orange">${event.point_reward || 0} Pts</p>
        </div>
    `;
};

// --- ATTENDEE LIST ---
let attendeesData = [];

window.loadAttendees = async function () {
    if (!selectedEventId) return;

    const { data: registrations, error } = await sbClient
        .from('event_registrations')
        .select('id, full_name, phone, status, qr_code')
        .eq('event_id', selectedEventId)
        .order('full_name', { ascending: true });

    if (error) {
        logger.error('Error loading attendees:', error);
        return;
    }

    attendeesData = registrations || [];
    window.filterAttendees(); // Initial render with empty filter
};

window.filterAttendees = function () {
    const query = (document.getElementById('attendeeSearch')?.value || '').toLowerCase();
    const filtered = attendeesData.filter(p =>
        p.full_name.toLowerCase().includes(query) ||
        p.phone.toLowerCase().includes(query)
    );
    renderAttendeeList(filtered);
};

function renderAttendeeList(data) {
    const container = document.getElementById('attendeeList');
    const displayData = data || attendeesData;

    if (displayData.length === 0) {
        container.innerHTML = '<p class="text-center text-slate-400 text-xs py-8">No participants found.</p>';
        return;
    }

    container.innerHTML = displayData.map(p => {
        const isAttended = p.status === 'attended';
        const isCancelled = p.status === 'cancelled';

        const statusClass = isAttended ? 'bg-green-100 text-green-700 border-green-200' :
            isCancelled ? 'bg-red-100 text-red-700 border-red-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200';

        const canMark = !isAttended && !isCancelled;

        return `
            <div class="flex items-center justify-between p-3 bg-white rounded-xl border border-black shadow-[2px_2px_0px_#000] hover:bg-gray-50 transition-all">
                <div class="flex-1 min-w-0 pr-3">
                    <p class="font-black text-sm text-black truncate uppercase">${p.full_name}</p>
                    <p class="text-[10px] text-gray-500 font-bold">${p.phone || 'No Phone'}</p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded-full text-[8px] font-black border-2 ${statusClass} uppercase tracking-wider">
                        ${p.status}
                    </span>
                    ${canMark ? `
                        <button onclick="markAttended('${p.id}')" class="w-8 h-8 rounded-lg bg-green-100 text-green-600 border border-green-200 flex items-center justify-center hover:bg-comic-green hover:text-white transition-all shadow-sm">
                            <span class="material-symbols-outlined text-[18px] font-bold">check</span>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

window.toggleAttendeeList = function () {
    const container = document.getElementById('attendeeListContainer');
    const icon = document.getElementById('attendeeToggleIcon');

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        if (icon) icon.style.transform = 'rotate(180deg)';
    } else {
        container.classList.add('hidden');
        if (icon) icon.style.transform = 'rotate(0deg)';
    }
};

window.markAttended = async function (regId) {
    if (!confirm('Tandai peserta ini sebagai HADIR?')) return;

    // Show indicator
    showNotification('Updating status... ⏳', 'info');

    try {
        // Update status via secure Edge Function
        const { data, error: updateError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'confirmAttendance',
                registration_id: regId
            }
        });

        if (updateError) throw updateError;
        if (!data.success) throw new Error(data.error || 'Server error');

        showNotification('✅ Status berhasil diperbarui!', 'success');
        loadStats();
        loadAttendees();

    } catch (err) {
        logger.error('Error marking attended:', err);
        showNotification('❌ Gagal: ' + err.message, 'error');
    }
};
