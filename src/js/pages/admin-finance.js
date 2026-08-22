import { supabase } from '../core/supabase.js';
import { initializeAdminLayout } from '../core/admin-layout.js';

let moneyAccounts = [];
let ledgerEntries = [];

// DOM Elements
const moneyAccountsContainer = document.getElementById('moneyAccountsContainer');
const totalRevenue = document.getElementById('totalRevenue');
const totalExpenses = document.getElementById('totalExpenses');
const netProfit = document.getElementById('netProfit');
const ledgerTableBody = document.getElementById('ledgerTableBody');

// Modal Elements
const expenseModal = document.getElementById('expenseModal');
const openExpenseModalBtn = document.getElementById('openExpenseModalBtn');
const expenseForm = document.getElementById('expenseForm');
const expCategory = document.getElementById('expCategory');
const expAmount = document.getElementById('expAmount');
const expPaymentMethod = document.getElementById('expPaymentMethod');
const expDescription = document.getElementById('expDescription');

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Core authentication & layout
    const perms = await initializeAdminLayout();
    if (!perms) return;

    // 2. Load Finance Data
    await loadFinanceData();

    // 3. Setup Listeners
    setupEventListeners();
});

// Load account balances, compute P&L metrics, and populate ledger
async function loadFinanceData() {
    try {
        // 1. Load Money Accounts
        const { data: accountsData, error: accountsErr } = await supabase
            .from('pm_money_accounts')
            .select('*')
            .order('name');
        if (accountsErr) throw accountsErr;

        moneyAccounts = accountsData || [];
        renderMoneyAccounts();

        // 2. Compute P&L Metrics
        // A. Total Revenue (Sales)
        const { data: salesSum, error: salesErr } = await supabase
            .from('pm_sales')
            .select('total_amount');
        if (salesErr) throw salesErr;
        const totalSalesVal = (salesSum || []).reduce((acc, row) => acc + parseInt(row.total_amount), 0);

        // B. Total COGS / HPP (Cost of Goods Sold)
        const { data: cogsSum, error: cogsErr } = await supabase
            .from('pm_sale_items')
            .select('quantity, unit_cost');
        if (cogsErr) throw cogsErr;
        const totalCogsVal = (cogsSum || []).reduce((acc, row) => acc + (parseInt(row.quantity) * parseInt(row.unit_cost)), 0);

        // C. Total Operational Expenses
        const { data: expSum, error: expErr } = await supabase
            .from('pm_expenses')
            .select('amount');
        if (expErr) throw expErr;
        const totalExpVal = (expSum || []).reduce((acc, row) => acc + parseInt(row.amount), 0);

        // Compute Net Profit = Revenue (Sales) - COGS (HPP) - Operational Expenses
        const netProfitVal = totalSalesVal - totalCogsVal - totalExpVal;

        totalRevenue.innerText = formatRupiah(totalSalesVal);
        // Display operational expenses + HPP (Acquisitions are already reflected in HPP when sold)
        totalExpenses.innerText = formatRupiah(totalExpVal + totalCogsVal);
        
        netProfit.innerText = formatRupiah(netProfitVal);
        if (netProfitVal >= 0) {
            netProfit.className = "text-2xl font-bold text-emerald-600 mt-1";
        } else {
            netProfit.className = "text-2xl font-bold text-red-500 mt-1";
        }

        // 3. Load Financial Ledger entries
        const { data: ledgerData, error: ledgerErr } = await supabase
            .from('pm_financial_ledger')
            .select(`
                id, type, category, amount, description, created_at,
                pm_money_accounts(name)
            `)
            .order('created_at', { ascending: false });
        if (ledgerErr) throw ledgerErr;

        ledgerEntries = ledgerData || [];
        renderLedgerTable();

    } catch (err) {
        console.error('Error loading financial data:', err);
    }
}

// Render register / bank accounts card list
function renderMoneyAccounts() {
    if (moneyAccounts.length === 0) {
        moneyAccountsContainer.innerHTML = `<div class="bg-white p-5 rounded-xl border border-slate-200 text-center text-slate-400 col-span-3">Tidak ada akun keuangan aktif</div>`;
        return;
    }

    moneyAccountsContainer.innerHTML = moneyAccounts.map(acc => {
        let icon = 'payments';
        let iconClass = 'text-emerald-600 bg-emerald-50';
        if (acc.name === 'QRIS') {
            icon = 'qr_code_2';
            iconClass = 'text-blue-600 bg-blue-50';
        } else if (acc.name === 'BCA_TRANSFER') {
            icon = 'account_balance';
            iconClass = 'text-indigo-600 bg-indigo-50';
        }

        return `
            <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                    <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">${acc.name}</span>
                    <h3 class="text-xl font-bold text-slate-800 mt-1">${formatRupiah(acc.current_balance)}</h3>
                </div>
                <span class="material-symbols-outlined ${iconClass} p-3 rounded-xl">${icon}</span>
            </div>
        `;
    }).join('');
}

// Render ledger list in table
function renderLedgerTable() {
    if (ledgerEntries.length === 0) {
        ledgerTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center p-8 text-slate-400">Belum ada transaksi tercatat di buku kas</td>
            </tr>
        `;
        return;
    }

    ledgerTableBody.innerHTML = ledgerEntries.map(entry => {
        const accName = entry.pm_money_accounts ? entry.pm_money_accounts.name : '-';
        const dateStr = new Date(entry.created_at).toLocaleString('id-ID');
        const formattedAmount = formatRupiah(entry.amount);

        const isInflow = entry.type === 'INFLOW';
        const typeLabel = isInflow 
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">INFLOW (Uang Masuk)</span>` 
            : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700">OUTFLOW (Uang Keluar)</span>`;

        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-4 text-slate-400 font-mono">${dateStr}</td>
                <td class="p-4 font-bold text-slate-700">${accName}</td>
                <td class="p-4">${typeLabel}</td>
                <td class="p-4 uppercase font-semibold text-slate-500">${entry.category}</td>
                <td class="p-4 font-bold ${isInflow ? 'text-emerald-600' : 'text-red-500'}">
                    ${isInflow ? '+' : '-'}${formattedAmount}
                </td>
                <td class="p-4 text-slate-600">${entry.description || '-'}</td>
            </tr>
        `;
    }).join('');
}

// Setup listeners
function setupEventListeners() {
    openExpenseModalBtn.addEventListener('click', () => expenseModal.classList.remove('hidden'));

    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            expenseModal.classList.add('hidden');
        });
    });

    // Handle new operational expense submission
    expenseForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const category = expCategory.value;
        const amount = parseInt(expAmount.value);
        const description = expDescription.value.trim();
        const paymentMethod = expPaymentMethod.value;

        try {
            // Run expense RPC transaction
            const { data, error } = await supabase.rpc('process_pos_expense', {
                p_category: category,
                p_amount: amount,
                p_description: description,
                p_payment_method: paymentMethod
            });

            if (error) throw error;

            alert('Pengeluaran berhasil dicatat!');
            expenseForm.reset();
            expenseModal.classList.add('hidden');

            // Refresh table and stats
            await loadFinanceData();
        } catch (err) {
            alert(`Gagal menyimpan pengeluaran: ${err.message}`);
        }
    });
}

function formatRupiah(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0
    }).format(amount);
}
