import { logger } from '../core/logger.js';
/**
 * Admin Achievements / Badges Logic
 * JDK Entertainment
 */
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let allBadges = [];

document.addEventListener('DOMContentLoaded', async () => {
    await initializeAdminLayout();
    await loadBadges();
});

export async function loadBadges() {
    const { data, error } = await sbClient
        .from('achievements')
        .select('*')
        .order('category', { ascending: true });

    if (error) {
        logger.error(error);
        showNotification('❌ Gagal memuat badge', 'error');
        return;
    }

    allBadges = data || [];
    renderBadges();
}

function renderBadges() {
    const container = document.getElementById('badgeContainer');
    if (!container) return;

    if (allBadges.length === 0) {
        container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-500 font-medium">Belum ada badge.</div>';
        return;
    }

    container.innerHTML = allBadges.map(badge => `
        <div class="group relative bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:border-blue-300 hover:shadow-md transition-all cursor-pointer flex flex-col h-full" onclick="editBadge('${badge.id}')">
            <!-- Header: Icon & Title -->
            <div class="flex items-start gap-4 mb-4">
                <div class="text-5xl group-hover:scale-110 transition-transform shrink-0 drop-shadow-sm flex items-center justify-center w-16 h-16 bg-slate-50 rounded-2xl border border-slate-100">
                    ${badge.icon_emoji || '🏆'}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2 mb-1">
                        <h3 class="font-bold text-slate-800 text-lg leading-tight truncate" title="${badge.title}">${badge.title}</h3>
                        ${badge.is_hidden ? '<span class="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-200 font-bold uppercase tracking-wider">Secret</span>' : ''}
                    </div>
                    <span class="inline-block px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold uppercase tracking-wider">
                        ${badge.category} Badge
                    </span>
                </div>
            </div>

            <!-- Body: Description -->
            <div class="flex-1">
                <p class="text-sm text-slate-500 leading-relaxed line-clamp-3" title="${badge.description || '-'}">
                    ${badge.description || 'No description provided.'}
                </p>
            </div>

            <!-- Actions Overlay (Optional but nice) -->
            <div class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <div class="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <span class="material-symbols-outlined text-[20px]">edit</span>
                </div>
            </div>
        </div>
    `).join('');
}

window.filterBadges = function () {
    const query = document.getElementById('searchBadge').value.toLowerCase();
    const cards = document.querySelectorAll('#badgeContainer > div');
    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(query) ? '' : 'none';
    });
};

window.openBadgeModal = function () {
    const form = document.querySelector('#badgeModal form') || { reset: () => { } };
    document.getElementById('badgeId').value = '';
    document.getElementById('modalTitle').textContent = 'ADD NEW BADGE';
    document.getElementById('modalIcon').innerText = '🏆';
    document.getElementById('badgeTitle').value = '';
    document.getElementById('badgeDescription').value = '';
    document.getElementById('badgeIcon').value = '🏆';
    document.getElementById('badgeCategory').value = 'Event';
    document.getElementById('badgeIsHidden').checked = false;

    document.getElementById('btnDeleteBadge').classList.add('hidden');
    document.getElementById('badgeModal').classList.remove('hidden');
    document.getElementById('badgeModal').classList.add('flex');
};

window.editBadge = function (id) {
    const badge = allBadges.find(b => b.id === id);
    if (!badge) return;

    document.getElementById('badgeId').value = badge.id;
    document.getElementById('modalTitle').textContent = 'EDIT BADGE';
    document.getElementById('modalIcon').innerText = badge.icon_emoji || '🏆';
    document.getElementById('badgeTitle').value = badge.title;
    document.getElementById('badgeDescription').value = badge.description || '';
    document.getElementById('badgeIcon').value = badge.icon_emoji || '🏆';
    document.getElementById('badgeCategory').value = badge.category || 'Event';
    document.getElementById('badgeIsHidden').checked = badge.is_hidden || false;

    document.getElementById('btnDeleteBadge').classList.remove('hidden');
    document.getElementById('badgeModal').classList.remove('hidden');
    document.getElementById('badgeModal').classList.add('flex');
};

window.closeBadgeModal = function () {
    document.getElementById('badgeModal').classList.add('hidden');
    document.getElementById('badgeModal').classList.remove('flex');
};

window.saveBadge = async function () {
    const id = document.getElementById('badgeId').value;
    const badgeData = {
        title: document.getElementById('badgeTitle').value,
        description: document.getElementById('badgeDescription').value,
        icon_emoji: document.getElementById('badgeIcon').value,
        category: document.getElementById('badgeCategory').value,
        is_hidden: document.getElementById('badgeIsHidden').checked
    };

    if (!badgeData.title) {
        showNotification('Judul badge wajib diisi!', 'error');
        return;
    }

    let result;
    if (id) {
        result = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'adminManageAchievements', sub_action: 'update', id, data: badgeData }
        });
    } else {
        result = await sbClient.functions.invoke('jdk-secure-handler', {
            body: { action: 'adminManageAchievements', sub_action: 'create', data: badgeData }
        });
    }

    // Normalize result
    if (result.data && result.data.success) {
        result.error = null;
    } else {
        result.error = result.error || { message: result.data?.error || 'Unknown error' };
    }

    if (result.error) {
        showNotification('❌ Gagal menyimpan: ' + result.error.message, 'error');
    } else {
        showNotification('✅ Badge berhasil disimpan!', 'success');
        window.closeBadgeModal();
        loadBadges();
    }
};

window.handleDeleteFromModal = async function () {
    const id = document.getElementById('badgeId').value;
    if (!id) return;
    if (!confirm('Hapus badge ini? User yang sudah memiliki badge ini akan kehilangan lencananya.')) return;

    const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
        body: { action: 'adminManageAchievements', sub_action: 'delete', id }
    });
    const error = fnError || (res && !res.success ? { message: res.error } : null);

    if (error) {
        showNotification('❌ Gagal menghapus: ' + error.message, 'error');
    } else {
        showNotification('✅ Badge dihapus!', 'success');
        window.closeBadgeModal();
        loadBadges();
    }
};

window.handleLogout = async function () {
    await sbClient.auth.signOut();
    window.location.href = '/index.html';
};
