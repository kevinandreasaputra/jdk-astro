import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { initializeAdminLayout } from '../core/admin-layout.js';
import { showNotification } from '../core/utils.js';

let allStickers = [];
let allPacks = [];
let editingPackId = null;
let currentFilter = {
    packId: 'all',
    search: ''
};

document.addEventListener('DOMContentLoaded', async () => {
    await initializeAdminLayout();
    await loadPacks();
    await loadStickers();

    // Preview logic
    const stickerUrlInput = document.getElementById('stickerUrl');
    stickerUrlInput.addEventListener('input', (e) => {
        const preview = document.getElementById('stickerPreview');
        if (e.target.value) {
            preview.innerHTML = `<img src="${e.target.value}" class="w-full h-full object-contain">`;
        } else {
            preview.innerHTML = `<span class="text-gray-300">No Image</span>`;
        }
    });

    // Paste Logic
    window.addEventListener('paste', handlePaste);

    // File Input Logic
    // Generic File Input Logic
    document.querySelectorAll('input[type="file"]').forEach(input => {
        input.addEventListener('change', handleFileUpload);
    });

    // Pack Thumbnail Preview Logic
    const packThumbInput = document.getElementById('packThumbnail');
    if (packThumbInput) {
        packThumbInput.addEventListener('input', (e) => {
            const preview = document.getElementById('packThumbnailPreview');
            if (e.target.value) {
                preview.innerHTML = `<img src="${e.target.value}" class="w-full h-full object-contain">`;
            } else {
                preview.innerHTML = `<span class="text-xs text-gray-300">Preview</span>`;
            }
        });
    }
});

/**
 * Handle Paste Event (Ctrl+V)
 */
async function handlePaste(e) {
    const addStickerModal = document.getElementById('addStickerModal');
    const managePacksModal = document.getElementById('managePacksModal');

    let target = null;
    if (!addStickerModal.classList.contains('hidden')) target = 'sticker';
    else if (!managePacksModal.classList.contains('hidden')) target = 'pack';

    if (!target) return;

    const items = Array.from((e.clipboardData || e.originalEvent.clipboardData).items);
    const imageItems = items.filter(item => item.type.indexOf('image') === 0);

    if (imageItems.length === 0) return;

    if (imageItems.length === 1 || target === 'pack') {
        const blob = imageItems[0].getAsFile();
        await uploadImage(blob, target, false);
    } else {
        showNotification(`Memproses ${imageItems.length} gambar...`, 'info');
        for (const item of imageItems) {
            const blob = item.getAsFile();
            await uploadImage(blob, 'sticker', true);
        }
        showNotification(`✅ Berhasil mengupload ${imageItems.length} sticker!`, 'success');
    }
}

/**
 * Handle File Upload via Input
 */
async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const target = e.target.id === 'packThumbnailFileInput' ? 'pack' : 'sticker';

    if (files.length === 1 || target === 'pack') {
        // Single file or pack: Manual review
        await uploadImage(files[0], target, false);
    } else {
        // Bulk stickers: Auto-save all
        showNotification(`Mengupload ${files.length} sticker...`, 'info');
        for (const file of files) {
            await uploadImage(file, 'sticker', true);
        }
        showNotification(`✅ Semua ${files.length} sticker berhasil diupload!`);
    }
}

/**
 * Upload Image to Supabase Storage
 */
/**
 * Upload Image to Supabase Storage (Generic)
 * @param {File} file 
 * @param {'sticker'|'pack'} target 
 * @param {boolean} autoSave Whether to insert into DB immediately
 */
async function uploadImage(file, target = 'sticker', autoSave = false) {
    if (!autoSave) showNotification('Mengupload gambar... ⏳');

    try {
        const bucketName = 'stickers';
        const fileName = `${target}_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;

        const { data, error } = await sbClient.storage
            .from(bucketName)
            .upload(fileName, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            logger.error('Upload failed:', error);
            if (error.message.includes('Bucket not found') || error.statusCode === '404') {
                showNotification('⚠️ ERROR: Bucket "stickers" belum dibuat!', 'error', 10000);
            } else {
                showNotification('❌ Gagal upload: ' + error.message, 'error', 10000);
            }
            return;
        }

        const { data: { publicUrl } } = sbClient.storage
            .from(bucketName)
            .getPublicUrl(fileName);

        const name = file.name ? file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ") : `Sticker ${Date.now()}`;

        if (target === 'sticker') {
            if (autoSave) {
                const pack_id = document.getElementById('stickerPackId').value || null;
                const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
                    body: {
                        action: 'adminManageStickers',
                        sub_action: 'create_sticker',
                        data: { name, url: publicUrl, pack_id }
                    }
                });

                if (!fnError && res?.success) loadStickers();
            }

            // Always update UI with the last uploaded/pasted item
            document.getElementById('stickerUrl').value = publicUrl;
            document.getElementById('stickerName').value = name;
            const preview = document.getElementById('stickerPreview');
            preview.innerHTML = `<img src="${publicUrl}" class="w-full h-full object-contain">`;
        } else {
            document.getElementById('packThumbnail').value = publicUrl;
            const preview = document.getElementById('packThumbnailPreview');
            preview.innerHTML = `<img src="${publicUrl}" class="w-full h-full object-contain">`;
        }

        if (!autoSave) showNotification('✅ Berhasil diupload! Silakan klik Simpan.');
    } catch (err) {
        logger.error('Unexpected upload error:', err);
        showNotification('❌ Error tidak terduga: ' + err.message, 'error', 10000);
    }
}

async function loadPacks() {
    const { data, error } = await sbClient
        .from('sticker_packs')
        .select('*, stickers(count)')
        .order('name');

    if (error) {
        showNotification('Gagal memuat pack: ' + error.message, 'error');
        return;
    }

    allPacks = data || [];
    renderPackUI();
}

function renderPackUI() {
    // 1. Dropdown in Add Sticker Modal
    const select = document.getElementById('stickerPackId');
    const editSelect = document.getElementById('editStickerPackId');
    const currentValue = select.value;
    const currentEditValue = editSelect ? editSelect.value : '';

    const packOptions = '<option value="">- PILIH PACK -</option>' +
        allPacks.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    select.innerHTML = packOptions;
    if (editSelect) editSelect.innerHTML = packOptions;

    // 2. Filter Dropdown on main page
    const filterDropdown = document.getElementById('packFilter');
    if (filterDropdown) {
        filterDropdown.innerHTML = '<option value="all">SEMUA PACK</option>' +
            allPacks.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        if (currentFilter.packId) filterDropdown.value = currentFilter.packId;
    }

    if (currentValue) select.value = currentValue;
    if (editSelect && currentEditValue) editSelect.value = currentEditValue;

    // 3. Table in Manage Packs Modal
    const tableBody = document.getElementById('packTableBody');
    if (allPacks.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400 font-bold italic">Belum ada pack.</td></tr>';
        return;
    }

    tableBody.innerHTML = allPacks.map(p => `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
            <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                    <img src="${p.thumbnail_url || '/images/placeholder-pack.png'}" class="w-8 h-8 rounded object-cover border border-slate-200">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-800">${p.name}</span>
                        <span class="text-[10px] text-slate-400 font-medium">${p.price > 0 ? p.price + ' Points' : 'FREE'}</span>
                    </div>
                </div>
            </td>
            <td class="px-4 py-3 text-center">
                <span class="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-bold border border-blue-100">
                    ${p.stickers?.[0]?.count || 0} Items
                </span>
            </td>
            <td class="px-4 py-3">
                <div class="flex items-center justify-center gap-1">
                    <button onclick="window.viewPackStickers('${p.id}')" 
                        class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="View Items">
                        <span class="material-symbols-outlined text-[20px]">visibility</span>
                    </button>
                    <button onclick="window.editPack('${p.id}')" 
                        class="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" title="Edit Pack">
                        <span class="material-symbols-outlined text-[20px]">edit</span>
                    </button>
                    <button onclick="window.deletePack('${p.id}')" 
                        class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all" title="Delete Pack">
                        <span class="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function loadStickers() {
    const { data, error } = await sbClient
        .from('stickers')
        .select('*, sticker_packs(name)') // Join to see pack name
        .order('created_at', { ascending: false });

    if (error) {
        showNotification('Gagal memuat sticker: ' + error.message, 'error');
        return;
    }

    allStickers = data || [];
    renderStickerGrid();
}

function renderStickerGrid() {
    const grid = document.getElementById('stickerGrid');

    // Apply Filtering
    const filteredStickers = allStickers.filter(s => {
        const matchesPack = currentFilter.packId === 'all' || s.pack_id === currentFilter.packId;
        const matchesSearch = s.name.toLowerCase().includes(currentFilter.search.toLowerCase());
        return matchesPack && matchesSearch;
    });

    if (filteredStickers.length === 0) {
        grid.innerHTML = '<div class="col-span-full py-20 text-center font-bold text-gray-400">Tidak ada sticker yang cocok.</div>';
        return;
    }

    grid.innerHTML = filteredStickers.map(s => `
        <div class="group relative bg-white rounded-xl border border-slate-200 p-2 shadow-sm hover:border-blue-300 hover:shadow-md transition-all cursor-pointer" onclick="window.openEditStickerModal('${s.id}')">
            <button onclick="event.stopPropagation(); window.deleteSticker('${s.id}')" 
                class="absolute -top-2 -right-2 bg-white text-rose-500 w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all z-10 hover:bg-rose-50">
                <span class="material-symbols-outlined text-[18px]">delete</span>
            </button>
            
            <div class="aspect-square rounded-lg bg-slate-50 flex items-center justify-center p-3 mb-2 overflow-hidden border border-slate-100">
                <img src="${s.url}" class="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-300" alt="${s.name}">
            </div>
            
            <div class="space-y-1">
                <p class="text-[11px] font-bold text-slate-800 truncate text-center">${s.name}</p>
                <div class="flex justify-center">
                    <span class="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold uppercase tracking-tighter">
                        ${s.sticker_packs?.name || 'Uncategorized'}
                    </span>
                </div>
            </div>
        </div>
    `).join('');
}

window.openAddStickerModal = () => {
    // If we are filtering by a pack, pre-select it in the modal
    if (currentFilter.packId !== 'all') {
        document.getElementById('stickerPackId').value = currentFilter.packId;
    }
    document.getElementById('addStickerModal').classList.remove('hidden');
    document.getElementById('addStickerModal').classList.add('flex');
};

window.closeAddStickerModal = () => {
    document.getElementById('addStickerModal').classList.add('hidden');
    document.getElementById('addStickerModal').classList.remove('flex');
};

window.saveSticker = async () => {
    let name = document.getElementById('stickerName').value.trim();
    const url = document.getElementById('stickerUrl').value.trim();
    const pack_id = document.getElementById('stickerPackId').value || null;

    if (!url) {
        showNotification('Belum ada gambar! Upload atau paste gambar dulu.', 'error');
        return;
    }

    // Auto-generate name if empty but URL exists (addressing user feedback)
    if (!name) {
        name = `Sticker ${Date.now()}`;
        document.getElementById('stickerName').value = name; // Update UI to reflect
    }

    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageStickers',
                sub_action: 'create_sticker',
                data: { name, url, pack_id }
            }
        });

        if (fnError) throw fnError;
        if (!res.success) throw new Error(res.error || 'Operation failed');

        showNotification('Sticker ditambahkan!', 'success');
        window.closeAddStickerModal();
        document.getElementById('stickerName').value = '';
        document.getElementById('stickerUrl').value = '';
        loadStickers();
    } catch (err) {
        showNotification('Gagal menyimpan: ' + err.message, 'error');
    }
};

window.deleteSticker = async (id) => {
    if (!confirm('Hapus sticker ini?')) return;

    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageStickers',
                sub_action: 'delete_sticker',
                id: id
            }
        });

        if (fnError) throw fnError;
        if (!res.success) throw new Error(res.error || 'Delete failed');

        showNotification('Sticker dihapus!', 'success');
        loadStickers();
        loadPacks();
    } catch (err) {
        showNotification('Gagal menghapus: ' + err.message, 'error');
    }
};

window.openManagePacksModal = () => {
    document.getElementById('managePacksModal').classList.remove('hidden');
    document.getElementById('managePacksModal').classList.add('flex');
};

window.closeManagePacksModal = () => {
    document.getElementById('managePacksModal').classList.add('hidden');
    document.getElementById('managePacksModal').classList.remove('flex');
};

window.savePack = async () => {
    const name = document.getElementById('packName').value.trim();
    const description = document.getElementById('packDesc').value.trim();
    const thumbnail_url = document.getElementById('packThumbnail').value.trim();
    const price = parseInt(document.getElementById('packPrice').value) || 0;

    if (!name) {
        showNotification('Harap masukkan nama pack!', 'error');
        return;
    }

    try {
        let actionParams = { action: 'adminManageStickers', data: { name, description, thumbnail_url, price } };

        if (editingPackId) {
            actionParams.sub_action = 'update_pack';
            actionParams.id = editingPackId;
        } else {
            actionParams.sub_action = 'create_pack';
        }

        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: actionParams
        });

        if (fnError) throw fnError;
        if (!res.success) throw new Error(res.error || 'Operation failed');

        if (editingPackId) {
            showNotification('Sticker Pack berhasil diperbarui! ✨', 'success');
            window.cancelPackEdit();
        } else {
            showNotification('Sticker Pack baru berhasil dibuat! 📦', 'success');
            document.getElementById('packName').value = '';
            document.getElementById('packDesc').value = '';
            document.getElementById('packThumbnail').value = '';
            document.getElementById('packThumbnailPreview').innerHTML = `<span class="text-xs text-gray-300">Preview</span>`;
        }
        loadPacks();

    } catch (err) {
        showNotification('Gagal menyimpan pack: ' + err.message, 'error');
    }
};

window.editPack = (id) => {
    const pack = allPacks.find(p => p.id === id);
    if (!pack) return;

    editingPackId = pack.id;
    document.getElementById('packName').value = pack.name;
    document.getElementById('packDesc').value = pack.description || '';
    document.getElementById('packThumbnail').value = pack.thumbnail_url || '';
    document.getElementById('packPrice').value = pack.price || 0;

    // Update buttons and titles
    document.getElementById('packFormTitle').textContent = 'Edit Sticker Pack';
    document.getElementById('btnSavePack').textContent = '💾 UPDATE PACK';
    document.getElementById('btnCancelPackEdit').classList.remove('hidden');

    // Update preview
    const preview = document.getElementById('packThumbnailPreview');
    if (pack.thumbnail_url) {
        preview.innerHTML = `<img src="${pack.thumbnail_url}" class="w-full h-full object-contain">`;
    } else {
        preview.innerHTML = `<span class="text-xs text-gray-300">Preview</span>`;
    }
};

window.cancelPackEdit = () => {
    editingPackId = null;
    document.getElementById('packName').value = '';
    document.getElementById('packDesc').value = '';
    document.getElementById('packThumbnail').value = '';
    document.getElementById('packPrice').value = 0;

    document.getElementById('packFormTitle').textContent = 'Create New Pack';
    document.getElementById('btnSavePack').textContent = '💾 CREATE PACK';
    document.getElementById('btnCancelPackEdit').classList.add('hidden');
    document.getElementById('packThumbnailPreview').innerHTML = `<span class="text-xs text-gray-300">Preview</span>`;
};

window.deletePack = async (id) => {
    if (!confirm('Hapus pack ini? Pack akan dihapus secara permanen. Sticker di dalamnya TIDAK akan terhapus tapi tidak akan memiliki pack.')) return;

    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageStickers',
                sub_action: 'delete_pack',
                id: id
            }
        });

        if (fnError) throw fnError;
        if (!res.success) throw new Error(res.error || 'Delete failed');

        showNotification('Sticker Pack berhasil dihapus.');
        loadPacks();
        loadStickers();
    } catch (err) {
        showNotification('Gagal menghapus pack: ' + err.message, 'error');
    }
};

window.openEditStickerModal = (id) => {
    const sticker = allStickers.find(s => s.id === id);
    if (!sticker) return;

    document.getElementById('editStickerId').value = sticker.id;
    document.getElementById('editStickerName').value = sticker.name;
    document.getElementById('editStickerPackId').value = sticker.pack_id || '';
    document.getElementById('editStickerUrl').value = sticker.url;
    document.getElementById('editStickerPreviewImg').src = sticker.url;

    document.getElementById('editStickerModal').classList.remove('hidden');
    document.getElementById('editStickerModal').classList.add('flex');
};

window.closeEditStickerModal = () => {
    document.getElementById('editStickerModal').classList.add('hidden');
    document.getElementById('editStickerModal').classList.remove('flex');
};

window.updateSticker = async () => {
    const id = document.getElementById('editStickerId').value;
    const name = document.getElementById('editStickerName').value.trim();
    const pack_id = document.getElementById('editStickerPackId').value || null;
    const url = document.getElementById('editStickerUrl').value.trim();

    if (!name || !url) {
        showNotification('Nama dan URL tidak boleh kosong!', 'error');
        return;
    }

    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: {
                action: 'adminManageStickers',
                sub_action: 'update_sticker',
                id: id,
                data: { name, pack_id, url }
            }
        });

        if (fnError) throw fnError;
        if (!res.success) throw new Error(res.error || 'Update failed');

        showNotification('Sticker diperbarui! ✨', 'success');
        window.closeEditStickerModal();
        loadStickers();
    } catch (err) {
        showNotification('Gagal update sticker: ' + err.message, 'error');
    }
};

/**
 * Filter Management
 */
window.handleFilterChange = () => {
    currentFilter.search = document.getElementById('stickerSearch').value;
    currentFilter.packId = document.getElementById('packFilter').value;
    renderStickerGrid();
};

window.clearFilters = () => {
    document.getElementById('stickerSearch').value = '';
    document.getElementById('packFilter').value = 'all';
    currentFilter.search = '';
    currentFilter.packId = 'all';
    renderStickerGrid();
};

window.viewPackStickers = (packId) => {
    currentFilter.packId = packId;
    document.getElementById('packFilter').value = packId;
    renderStickerGrid();
    window.closeManagePacksModal();
    // Scroll to grid top if needed
    document.getElementById('stickerGrid').scrollIntoView({ behavior: 'smooth' });
};
