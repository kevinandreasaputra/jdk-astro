import { logger } from '../core/logger.js';
/**
 * Admin Dedicated QR Scanner Logic
 * JDK Entertainment
 */
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let html5QrCode = null;
let currentRegistration = null;
let selectedEventId = null;

document.addEventListener('DOMContentLoaded', async () => {
    await initializeAdminLayout();

    // Initial load
    window.loadEvents();
});

// --- GLOBAL FUNCTIONS (attached to window for onclick) ---

window.loadEvents = async function () {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        const { data, error } = await sbClient
            .from('events')
            .select('id, title, date')
            .gte('date', todayStr) // Filter: Date >= Today
            .order('date', { ascending: true }); // Sort: Nearest first

        if (error) throw error;

        const select = document.getElementById('eventSelect');
        if (!select) return;

        if (data.length === 0) {
            select.innerHTML = '<option value="">-- Tidak ada event aktif --</option>';
            return;
        }

        // Format date for display
        const formatDate = (dateString) => {
            const options = { day: 'numeric', month: 'short', year: 'numeric' };
            return new Date(dateString).toLocaleDateString('id-ID', options);
        };

        select.innerHTML = '<option value="">-- Pilih Event --</option>' +
            data.map(e => `<option value="${e.id}">${formatDate(e.date)} - ${e.title}</option>`).join('');

        select.onchange = () => {
            selectedEventId = select.value;
            if (selectedEventId) {
                window.loadStats();
                window.loadParticipants(); // Load list when event selected
            } else {
                // Clear participant list if no event selected
                const listContainer = document.getElementById('participantListContainer');
                if (listContainer) listContainer.innerHTML = '';
            }
        };
    } catch (err) {
        logger.error('Error loading events:', err);
    }
};

window.loadParticipants = async function () {
    if (!selectedEventId) return;

    const listContainer = document.getElementById('participantListContainer');
    if (listContainer) {
        listContainer.innerHTML = '<div class="text-center p-4 text-slate-500">Loading participants...</div>';
    }

    try {
        const { data, error } = await sbClient
            .from('event_registrations')
            .select('*')
            .eq('event_id', selectedEventId)
            // Order by status (confirmed first, then pending), then name
            .order('status', { ascending: false })
            .order('full_name', { ascending: true });

        if (error) throw error;

        window.renderParticipants(data || []);
    } catch (err) {
        logger.error('Error loading participants:', err);
        if (listContainer) listContainer.innerHTML = '<div class="text-center p-4 text-red-500">Gagal memuat peserta.</div>';
    }
};

window.renderParticipants = function (participants) {
    const listContainer = document.getElementById('participantListContainer');
    if (!listContainer) return;

    if (participants.length === 0) {
        listContainer.innerHTML = '<div class="text-center p-8 text-slate-400 bg-slate-50 rounded-xl border border-slate-200">Belum ada peserta terdaftar.</div>';
        return;
    }

    const html = participants.map(p => {
        const isAttended = p.status === 'attended';
        const isConfirmed = p.status === 'confirmed';

        let statusBadge = '';
        if (isAttended) statusBadge = '<span class="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold uppercase rounded-full">Hadir</span>';
        else if (isConfirmed) statusBadge = '<span class="px-2 py-1 bg-blue-100 text-blue-700 text-[10px] font-bold uppercase rounded-full">Confirmed</span>';
        else statusBadge = `<span class="px-2 py-1 bg-gray-100 text-gray-700 text-[10px] font-bold uppercase rounded-full">${p.status}</span>`;

        return `
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between gap-3 transition-colors ${isAttended ? 'bg-green-50/50' : ''}">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <h4 class="font-bold text-slate-800 text-sm truncate">${p.full_name}</h4>
                    ${statusBadge}
                </div>
                <div class="text-xs text-slate-500 truncate">${p.phone}</div>
                 ${p.qr_code ? `<div class="text-[10px] text-slate-400 font-mono mt-0.5">${p.qr_code}</div>` : ''}
            </div>
            
            ${!isAttended ? `
            <button onclick="manualCheckIn('${p.id}', '${p.full_name.replace(/'/g, "\\'")}')" 
                class="shrink-0 bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg shadow-sm transition-colors" title="Check In Manual">
                <span class="material-symbols-outlined text-[20px]">check_circle</span>
            </button>
            ` : `
            <div class="shrink-0 text-green-600">
                <span class="material-symbols-outlined text-[24px]">verified</span>
            </div>
            `}
        </div>
        `;
    }).join('');

    listContainer.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 gap-3">${html}</div>`;
};

window.manualCheckIn = async function (regId, name) {
    if (!confirm(`Konfirmasi kehadiran untuk ${name}?`)) return;

    try {
        // Reuse the secure handler
        const { data, error } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'confirmAttendance',
                registration_id: regId
            }
        });

        if (error) throw error;
        // Check for edge function custom error format
        if (data && !data.success) throw new Error(data.error || 'Unknown error');

        let msg = `✅ ${name} berhasil check-in!`;
        if (data.email_sent) {
            msg += '\n📧 Email sertifikat terkirim.';
        } else if (data.email_status) {
            msg += `\n⚠️ Email gagal: ${data.email_status}`;
        }

        showNotification(msg, data.email_sent ? 'success' : 'warning');

        // Refresh local stats and list
        window.loadStats();
        window.loadParticipants();

    } catch (err) {
        logger.error('Manual check-in error:', err);
        showNotification('Gagal check-in: ' + err.message, 'error');
    }
};

window.loadStats = async function () {
    if (!selectedEventId) return;

    try {
        const { count: total } = await sbClient
            .from('event_registrations')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', selectedEventId);

        const { count: attended } = await sbClient
            .from('event_registrations')
            .select('*', { count: 'exact', head: true })
            .eq('event_id', selectedEventId)
            .eq('status', 'attended');

        const totalEl = document.getElementById('totalRegistered');
        const attendedEl = document.getElementById('totalAttended');
        const remainingEl = document.getElementById('totalRemaining');

        if (totalEl) totalEl.textContent = total || 0;
        if (attendedEl) attendedEl.textContent = attended || 0;
        if (remainingEl) remainingEl.textContent = (total || 0) - (attended || 0);
    } catch (err) {
        logger.error('Error loading stats:', err);
    }
};

window.startScanner = function () {
    if (!selectedEventId) {
        showNotification('Pilih event terlebih dahulu!', 'warning');
        return;
    }

    const readerEl = document.getElementById('qr-reader');
    if (!readerEl) return;

    if (!window.Html5Qrcode) {
        showNotification('Scanner library belum termuat. Coba refresh halaman.', 'error');
        return;
    }

    html5QrCode = new window.Html5Qrcode("qr-reader");
    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        window.onScanSuccess,
        window.onScanFailure
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
        }).catch(err => logger.error(err));
    }
};

window.onScanSuccess = async function (decodedText) {
    window.stopScanner();
    await window.processQrCode(decodedText);
};

window.onScanFailure = function (error) {
    // Quietly ignore scan failures
};

window.processManualInput = async function () {
    const code = document.getElementById('manualQrCode').value.trim();
    if (!code) {
        showNotification('Masukkan kode QR!', 'warning');
        return;
    }
    await window.processQrCode(code);
};

window.processQrCode = async function (qrCode) {
    if (!selectedEventId) {
        showNotification('Pilih event terlebih dahulu!', 'warning');
        return;
    }

    try {
        // Find registration by QR code
        const { data: reg, error } = await sbClient
            .from('event_registrations')
            .select('*, events(title, xp_reward, point_reward, reward_achievement_id)')
            .eq('qr_code', qrCode)
            .single();

        if (error || !reg) {
            window.showResult({
                success: false,
                message: '❌ QR Code tidak ditemukan!'
            });
            return;
        }

        // Validate event matches
        if (reg.event_id !== selectedEventId) {
            window.showResult({
                success: false,
                message: '⚠️ QR Code ini untuk event berbeda!'
            });
            return;
        }

        // Check if already attended
        if (reg.status === 'attended') {
            window.showResult({
                success: false,
                message: '⚠️ Peserta sudah tercatat HADIR!',
                data: reg
            });
            return;
        }

        currentRegistration = reg;
        window.showResult({
            success: true,
            message: '✅ Peserta ditemukan!',
            data: reg
        });
    } catch (err) {
        logger.error('Process QR error:', err);
        showNotification('Error memproses QR', 'error');
    }
};

window.showResult = function (result) {
    const area = document.getElementById('resultArea');
    const content = document.getElementById('resultContent');
    const confirmBtn = document.getElementById('confirmAttendBtn');

    if (!area || !content) return;

    area.classList.remove('hidden');

    if (result.data) {
        content.innerHTML = `
            <div class="text-center p-6 ${result.success ? 'bg-green-50' : 'bg-yellow-50'} border-3 border-black rounded-xl">
                <p class="text-xl font-bold mb-2 font-ui">${result.message}</p>
                <p class="text-3xl font-comic text-comic-blue">${result.data.full_name}</p>
                <p class="text-sm text-gray-600 font-body">${result.data.phone}</p>
                <div class="mt-4 inline-block px-3 py-1 rounded-full border-2 border-black font-bold uppercase text-xs ${result.data.status === 'attended' ? 'bg-green-400' : 'bg-orange-400'}">
                    Status: ${result.data.status}
                </div>
            </div>
        `;
        if (confirmBtn) confirmBtn.classList.toggle('hidden', !result.success || result.data.status === 'attended');
    } else {
        content.innerHTML = `
            <div class="text-center p-6 bg-red-50 border-3 border-black rounded-xl">
                <p class="text-xl font-bold text-red-600 font-ui">${result.message}</p>
            </div>
        `;
        if (confirmBtn) confirmBtn.classList.add('hidden');
    }
};

window.clearResult = function () {
    const area = document.getElementById('resultArea');
    const input = document.getElementById('manualQrCode');
    if (area) area.classList.add('hidden');
    if (input) input.value = '';
    currentRegistration = null;
};

window.confirmAttendance = async function () {
    if (!currentRegistration) return;

    const reg = currentRegistration;

    try {
        // 1. Update status to attended via secure Edge Function
        const { data, error: regError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'confirmAttendance',
                registration_id: reg.id
            }
        });

        if (regError) throw regError;

        showNotification(`✅ ${reg.full_name} tercatat HADIR!`, 'success');

        window.clearResult();
        window.loadStats();

    } catch (err) {
        logger.error('Error confirming attendance:', err);
        showNotification('Gagal mengkonfirmasi: ' + err.message, 'error');
    }
};
