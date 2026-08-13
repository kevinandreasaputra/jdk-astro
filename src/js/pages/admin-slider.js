import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let allSlides = [];

/**
 * Initialize Admin Slider page
 */
export async function initializeAdminSlider() {
    logger.log('🛠️ Initializing Admin Slider Management...');
    await initializeAdminLayout();
    await loadSlides();

    // Form submission
    const form = document.getElementById('sliderForm');
    if (form) {
        form.addEventListener('submit', handleFormSubmit);
    }
}

/**
 * Load slides from Supabase
 */
async function loadSlides() {
    const { data, error } = await sbClient
        .from('hero_sliders')
        .select('*')
        .order('order_index', { ascending: true });

    if (error) {
        logger.error('Error fetching slides:', error);
        return;
    }

    allSlides = data;
    renderSlides();
}

/**
 * Render slides list in table
 */
function renderSlides() {
    const list = document.getElementById('sliderList');
    if (!list) return;

    if (allSlides.length === 0) {
        list.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-12 text-center text-slate-500 font-medium italic">
                    Belum ada slide banner. Klik 'Add New Slide' untuk memulai.
                </td>
            </tr>
        `;
        return;
    }

    list.innerHTML = allSlides.map(slide => `
        <tr class="hover:bg-slate-50 transition-colors border-b border-slate-100">
            <td class="px-6 py-4">
                <img src="${slide.image_url}" class="h-14 w-24 object-cover rounded-lg border border-slate-200 shadow-sm" alt="${slide.title}">
            </td>
            <td class="px-6 py-4">
                <div class="flex flex-col">
                    <span class="font-bold text-slate-800 text-sm line-clamp-1 truncate">${slide.title}</span>
                    <span class="text-[10px] text-slate-400 font-medium line-clamp-1 italic">${slide.subtitle || '-'}</span>
                    <span class="text-[10px] text-blue-500 font-medium truncate max-w-[200px] mt-1">${slide.link_url || '-'}</span>
                </div>
            </td>
            <td class="px-6 py-4">
                <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                        <span class="material-symbols-outlined text-[14px]">event_available</span>
                        ${new Date(slide.start_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                    </div>
                    <div class="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                        <span class="material-symbols-outlined text-[14px]">event_busy</span>
                        ${new Date(slide.end_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${slide.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}">
                    ${slide.is_active ? 'ACTIVE' : 'INACTIVE'}
                </span>
            </td>
            <td class="px-6 py-4">
                <div class="flex items-center justify-end gap-1">
                    <button onclick="editSlide('${slide.id}')" 
                        class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Edit Slide">
                        <span class="material-symbols-outlined text-[20px]">edit</span>
                    </button>
                    <button onclick="deleteSlide('${slide.id}')" 
                        class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all" title="Delete Slide">
                        <span class="material-symbols-outlined text-[20px]">delete</span>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Handle form submission (Add/Edit)
 */
async function handleFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('slideId').value;
    const title = document.getElementById('slideTitle').value;
    const subtitle = document.getElementById('slideSubtitle').value;
    const link = document.getElementById('slideLink').value;
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;
    const active = document.getElementById('isActive').checked;
    const mascotUrl = document.getElementById('slideMascotUrl').value;
    const imageInput = document.getElementById('imageInput');

    let imageUrl = '';

    // Upload image if selected
    if (imageInput.files && imageInput.files[0]) {
        showNotification('Uploading image...', 'info');
        imageUrl = await uploadImage(imageInput.files[0]);
        if (!imageUrl) return; // Error handled in uploadImage
    }

    const slideData = {
        title,
        subtitle,
        link_url: link,
        start_date: new Date(start).toISOString(),
        end_date: new Date(end).toISOString(),
        is_active: active,
    };

    if (imageUrl) {
        slideData.image_url = imageUrl;
    }

    let actionParams = { action: 'adminManageSlider', data: slideData };

    if (id) {
        actionParams.sub_action = 'update';
        actionParams.id = id;
    } else {
        actionParams.sub_action = 'create';
        if (!imageUrl) {
            showNotification('Mohon upload gambar banner!', 'error');
            return;
        }
    }

    try {
        const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
            body: actionParams
        });

        if (fnError) throw fnError;
        if (!res.success) throw new Error(res.error || 'Save failed');

        showNotification('Slide berhasil disimpan!', 'success');
        closeModal();
        loadSlides();
    } catch (e) {
        showNotification('Gagal menyimpan slide: ' + e.message, 'error');
    }
}


/**
 * Upload image to Supabase Storage
 */
async function uploadImage(file) {
    const fileName = `${Date.now()}-${file.name.replace(/\s+/g, '-')}`;
    const filePath = `hero-banners/${fileName}`;

    const { data, error } = await sbClient.storage
        .from('hero-sliders')
        .upload(filePath, file);

    if (error) {
        logger.error('Upload error:', error);
        showNotification('Gagal mengunggah gambar: ' + error.message, 'error');
        return null;
    }

    const { data: { publicUrl } } = sbClient.storage
        .from('hero-sliders')
        .getPublicUrl(filePath);

    return publicUrl;
}

/**
 * Delete slide
 */
window.deleteSlide = async function (id) {
    if (!confirm('Yakin ingin menghapus slide ini?')) return;

    const { data: res, error: fnError } = await sbClient.functions.invoke('jdk-secure-handler', {
        body: {
            action: 'adminManageSlider',
            sub_action: 'delete',
            id: id
        }
    });

    const error = fnError || (res && !res.success ? { message: res.error } : null);

    if (error) {
        showNotification('Gagal menghapus slide: ' + error.message, 'error');
    } else {
        showNotification('Slide dihapus!', 'success');
        loadSlides();
    }
};

/**
 * Edit slide (populate modal)
 */
window.editSlide = function (id) {
    const slide = allSlides.find(s => s.id === id);
    if (!slide) return;

    document.getElementById('slideId').value = slide.id;
    document.getElementById('slideTitle').value = slide.title;
    document.getElementById('slideSubtitle').value = slide.subtitle || '';
    document.getElementById('slideLink').value = slide.link_url || '';
    document.getElementById('slideMascotUrl').value = slide.mascot_url || '';
    document.getElementById('startDate').value = slide.start_date.substring(0, 16);
    document.getElementById('endDate').value = slide.end_date.substring(0, 16);
    document.getElementById('isActive').checked = slide.is_active;

    document.getElementById('imagePreview').innerHTML = `<img src="${slide.image_url}" class="h-full w-full object-cover">`;
    document.getElementById('modalTitle').textContent = 'EDIT SLIDE';
    document.getElementById('sliderModal').classList.remove('hidden');
};

/**
 * UI Functions
 */
window.openAddModal = () => {
    document.getElementById('sliderForm').reset();
    document.getElementById('slideId').value = '';
    document.getElementById('imagePreview').innerHTML = '<span class="text-gray-400">Pilih gambar...</span>';
    document.getElementById('modalTitle').textContent = 'ADD NEW SLIDE';
    document.getElementById('sliderModal').classList.remove('hidden');
};

window.closeModal = () => {
    document.getElementById('sliderModal').classList.add('hidden');
};

window.previewImage = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('imagePreview').innerHTML = `<img src="${e.target.result}" class="h-full w-full object-cover">`;
        };
        reader.readAsDataURL(input.files[0]);
    }
};

// Initialize when imported
if (document.getElementById('sliderList')) {
    initializeAdminSlider();
}
