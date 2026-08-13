import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';

/**
 * Renders the inventory items in the profile peek modal
 */
export async function renderInventory(userId) {
    const list = document.getElementById('inventoryList');
    if (!list) return;

    list.innerHTML = `<div class="col-span-3 text-center py-4 text-xs font-bold text-gray-400">Memuat inventory...</div>`;

    try {
        const { data: items, error } = await sbClient
            .from('user_inventory')
            .select('*')
            .eq('user_id', userId)
            .gt('quantity', 0);

        if (error) throw error;

        if (!items || items.length === 0) {
            list.innerHTML = `<div class="col-span-3 text-center py-8">
                <p class="text-3xl mb-2">📭</p>
                <p class="text-[10px] font-black text-gray-400 uppercase">Inventory Kosong</p>
            </div>`;
            return;
        }

        list.innerHTML = items.map(item => {
            const isBox = item.item_key.includes('box');
            return `
                <div class="bg-white border-2 border-black rounded-xl p-2 flex flex-col items-center gap-1 shadow-comic-xs hover:scale-105 transition-all cursor-default">
                    <span class="text-2xl">${getItemIcon(item.item_key)}</span>
                    <span class="text-[8px] font-black uppercase text-center truncate w-full">${item.item_key.replace(/_/g, ' ')}</span>
                    <span class="bg-black text-white text-[8px] px-1.5 rounded-full font-black">x${item.quantity}</span>
                    ${isBox ? `<button onclick="window.openMysteryBox('${item.item_key}')" class="mt-1 w-full bg-yellow-400 border border-black text-[8px] font-black py-0.5 rounded shadow-sm hover:bg-yellow-300">BUKA</button>` : ''}
                </div>
            `;
        }).join('');

    } catch (err) {
        logger.error('Inventory Error:', err);
        list.innerHTML = `<div class="col-span-3 text-center py-4 text-xs font-bold text-red-500">Gagal memuat inventory.</div>`;
    }
}

function getItemIcon(key) {
    if (key.includes('box')) return '🎁';
    if (key.includes('shield')) return '🛡️';
    if (key.includes('double')) return '💰';
    if (key.includes('vision')) return '👁️';
    return '📦';
}

/**
 * Handles the mystery box unboxing process
 */
window.openMysteryBox = async (itemKey) => {
    const modal = document.getElementById('unboxingModal');
    const boxIcon = document.getElementById('unboxingBoxIcon');
    const resultArea = document.getElementById('unboxingResult');
    const title = document.getElementById('unboxingTitle');

    if (!modal) return;

    // Reset UI
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    boxIcon.className = 'text-8xl mb-6 animate-bounce-slow';
    boxIcon.innerText = '🎁';
    resultArea.classList.add('hidden');
    title.innerText = 'MEMBUKA KOTAK...';

    try {
        // Delay for effect
        await new Promise(r => setTimeout(r, 1500));

        boxIcon.classList.add('animate-ping');
        await new Promise(r => setTimeout(r, 500));

        const { data, error } = await sbClient.rpc('open_mystery_box', { box_item_key: itemKey });

        if (error) throw error;
        if (!data.success) throw new Error(data.message);

        // Reveal Reward
        boxIcon.classList.remove('animate-ping', 'animate-bounce-slow');
        boxIcon.className = 'text-9xl mb-6 animate-zoom-in';
        boxIcon.innerText = data.reward_type === 'points' ? '💰' : '✨';

        title.innerText = 'SELAMAT!';
        resultArea.classList.remove('hidden');
        document.getElementById('unboxingRewardName').innerText = data.reward_name;

        // Refresh Inventory in bg
        const user = (await sbClient.auth.getUser()).data.user;
        if (user) renderInventory(user.id);

    } catch (err) {
        modal.classList.add('hidden');
        showNotification(err.message, 'error');
    }
};

window.closeUnboxingModal = () => {
    document.getElementById('unboxingModal').classList.add('hidden');
};
