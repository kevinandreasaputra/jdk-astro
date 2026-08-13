import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Authentication Module
 * Handles login, register, logout, and OAuth functionality
 */

import { sbClient } from '../core/supabase.js';
import { showNotification, checkPasswordStrength } from '../core/utils.js';
import { initializeUserSession, updateUserInterface, setCurrentUser } from './user-session.js';

// 🔒 SECURITY: Reserved usernames to prevent identity hijacking
const RESERVED_USERNAMES = ['dinda', 'admin', 'system', 'jdk', 'jdkwan', 'mod', 'moderator', 'support'];

/**
 * Handle user login
 * @param {string} identifier - Email or username
 * @param {string} password - Password
 * @returns {Promise<boolean>} Success status
 */
export async function handleLogin(identifier, password) {
    if (!sbClient) return showNotification('Sistem belum siap.');

    showNotification('Sedang login...');

    try {
        let email = identifier;

        // Check if input is NOT an email (assuming username)
        if (!identifier.includes('@')) {
            showNotification('Mencari username...');
            const { data: userProfile, error: profileError } = await sbClient
                .from('profiles')
                .select('email')
                .ilike('username', identifier)
                .single();

            if (profileError || !userProfile || !userProfile.email) {
                logger.warn('Username lookup failed:', profileError);
                throw new Error('Username tidak ditemukan atau belum terhubung dengan email.');
            }

            email = userProfile.email;
        }

        const { data, error } = await sbClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        const initSuccess = await initializeUserSession();
        if (!initSuccess) {
            return false;
        }

        closeAllModals();
        showNotification('✅ Login berhasil! Selamat datang kembali.');
        setTimeout(() => window.location.href = 'profile.html', 1000);
        return true;
    } catch (err) {
        logger.error('Login error:', err);

        // Handle unconfirmed email error specifically
        const errorMsg = err.message.toLowerCase();
        if (errorMsg.includes('email not confirmed')) {
            showNotification(`
                <div class="text-2xl mb-2 text-comic-red">🚫 EMAIL BELUM DIKONFIRMASI</div>
                <div class="text-base font-normal">
                    Silakan cek kotak masuk email kamu <br>
                    dan klik link konfirmasi untuk bisa login.
                </div>
            `, 10000);
        } else if (errorMsg.includes('invalid login credentials')) {
            showNotification(`
                <div class="text-2xl mb-2 text-comic-red">🛑 WADUH, PASSWORD SALAH!</div>
                <div class="text-base font-normal">
                    Email/Username atau Password kamu nggak cocok nih. <br>
                    Coba cek lagi pelan-pelan ya, JDKwan! 🧐
                </div>
            `, 8000);
        } else {
            showNotification('❌ Gagal login: ' + err.message);
        }
        return false;
    }
}

/**
 * Handle user registration
 * @param {string} email - Email address
 * @param {string} password - Password
 * @param {string} username - Username
 * @param {string} fullName - Full name
 * @returns {Promise<boolean>} Success status
 */
export async function handleRegister(email, password, username, fullName) {
    if (!sbClient) return showNotification('Sistem belum siap, coba sesaat lagi.');

    showNotification('Sedang mendaftarkan akun...');

    try {
        const { data, error } = await sbClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    username: username,
                    full_name: fullName,
                    email: email,
                    user_level: 'Member',
                    points: 0,
                    referred_by: sessionStorage.getItem('jdk_referral_code') || null
                }
            }
        });

        if (error) throw error;

        if (data?.session) {
            showNotification('✅ Registrasi berhasil! Kamu sudah login.');
            window.location.reload();
        } else if (data?.user) {
            showNotification(`
                <div class="text-2xl mb-2">📩 CEK EMAIL KAMU!</div>
                <div class="text-base font-normal">
                    Silakan klik link konfirmasi di email kamu <br>
                    agar akun bisa digunakan untuk login.
                </div>
            `, 10000); // Tampilkan selama 10 detik
            closeAllModals();
        }
        return true;
    } catch (err) {
        logger.error('Register error:', err);
        const msg = err.message.toLowerCase();

        if (msg.includes('already registered') || msg.includes('already been registered') || msg.includes('user already registered')) {
            showNotification(`
                <div class="text-2xl mb-2 text-comic-red">🛑 WADUH, EMAIL SUDAH ADA!</div>
                <div class="text-base font-normal">
                    Email ini sudah terdaftar di markas JDK. <br>
                    Mending langsung <b>Login</b> aja yuk! 🚀
                </div>
            `, 8000);
        } else if (msg.includes('username') && msg.includes('unique')) {
            showNotification(`
                <div class="text-2xl mb-2 text-comic-red">🕵️ NAMA SUDAH DIPAKAI!</div>
                <div class="text-base font-normal">
                    Username ini sudah ada yang punya. <br>
                    Cari nama lain yang lebih keren ya! 😎
                </div>
            `, 8000);
        } else if (msg.includes('security purposes') || msg.includes('after 6 seconds')) {
            showNotification(`
                <div class="text-2xl mb-2 text-comic-blue">⏳ SABAR DULU PAK!</div>
                <div class="text-base font-normal">
                    Demi keamanan, jangan klik terlalu cepat. <br>
                    Tunggu sebentar (sekitar 6 detik) baru klik lagi ya! ✌️
                </div>
            `, 8000);
        } else {
            showNotification('❌ Gagal registrasi: ' + err.message);
        }
        return false;
    }
}

/**
 * Handle user logout
 */
export async function handleLogout() {
    if (!sbClient) return;
    try {
        await sbClient.auth.signOut();
        setCurrentUser(null);
        showNotification('Logout berhasil 👋 Sampai jumpa!');
        setTimeout(() => window.location.href = 'index.html', 1000);
    } catch (error) {
        logger.error('Logout error:', error);
        window.location.href = 'index.html';
    }
}

/**
 * Handle Google OAuth login
 */
export async function handleGoogleLogin() {
    if (!sbClient) {
        showNotification('Supabase belum siap!');
        return;
    }

    try {
        const { data, error } = await sbClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + '/index.html'
            }
        });

        if (error) {
            showNotification('Gagal login dengan Google: ' + error.message);
        }
    } catch (err) {
        showNotification('Error: ' + err.message);
    }
}

/**
 * Handle forgot password with rate limiting
 */
export async function handleForgotPassword() {
    const email = document.getElementById('forgotEmail')?.value;
    if (!email) {
        showNotification('Masukkan email kamu!');
        return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showNotification('Format email tidak valid!');
        return;
    }

    if (!sbClient) {
        showNotification('Supabase belum siap!');
        return;
    }

    // Rate limiting: 60 second cooldown
    const COOLDOWN_MS = 60000;
    const lastResetKey = 'jdk_last_reset_request';
    const now = Date.now();
    const lastReset = parseInt(localStorage.getItem(lastResetKey) || '0');

    if (now - lastReset < COOLDOWN_MS) {
        const remaining = Math.ceil((COOLDOWN_MS - (now - lastReset)) / 1000);
        showNotification(`⏳ Tunggu ${remaining} detik sebelum minta reset lagi.`);
        return;
    }

    // Show loading state
    const btn = document.querySelector('#forgotPasswordModal button.btn-primary');
    const originalText = btn ? btn.innerHTML : 'KIRIM LINK RESET';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Mengirim...';
    }

    try {
        const { data, error } = await sbClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/profile.html'
        });

        if (error) {
            showNotification('Gagal mengirim email: ' + error.message);
            return;
        }

        // Save timestamp for rate limiting
        localStorage.setItem(lastResetKey, now.toString());

        showNotification('✅ Link reset password telah dikirim ke email kamu!');
        closeForgotPasswordModal();
    } catch (err) {
        showNotification('Error: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

/**
 * Submit login form
 */
export async function submitLogin() {
    const identifier = document.getElementById('loginIdentifier')?.value?.trim();
    const pass = document.getElementById('loginPassword')?.value;
    if (!identifier || !pass) return showNotification('Isi email/username dan password!');
    await handleLogin(identifier, pass);
}

/**
 * Submit register form
 */
export async function submitRegister() {
    const email = document.getElementById('authRegEmail')?.value?.trim();
    const pass = document.getElementById('authRegPassword')?.value;
    const confirmPass = document.getElementById('authRegConfirmPassword')?.value;
    const username = document.getElementById('authRegUsername')?.value?.trim();
    const fullName = document.getElementById('authRegFullName')?.value;
    const manualRefCode = document.getElementById('authRegReferralCode')?.value;

    if (!email || !pass || !confirmPass || !username) {
        return showNotification('Isi semua data!');
    }

    // Email regex validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return showNotification('Format email tidak valid!');
    }

    // Username validation: Alphanumeric and . _ - only
    const usernameRegex = /^[a-zA-Z0-9._-]+$/;
    if (!usernameRegex.test(username)) {
        return showNotification('❌ Username hanya boleh huruf, angka, titik, underscore, atau tanda hubung!');
    }

    // 🔒 SECURITY: Check reserved usernames
    if (RESERVED_USERNAMES.includes(username.toLowerCase())) {
        return showNotification(`❌ Username "${username}" tidak diperbolehkan (Reserved Name).`, 'error');
    }

    if (pass !== confirmPass) {
        return showNotification('Password konfirmasi tidak sama!');
    }

    if (pass.length < 6) {
        return showNotification('Password minimal 6 karakter!');
    }

    // Check password strength
    const strength = checkPasswordStrength(pass);
    if (strength.score < 2) {
        return showNotification('❌ Password terlalu lemah! Gunakan kombinasi huruf besar, angka, dan simbol.');
    }

    // Check for duplicate username
    if (sbClient) {
        showNotification('Memeriksa data...');

        const { data: existingUsername, error: usernameError } = await sbClient
            .from('profiles')
            .select('username')
            .ilike('username', username)
            .maybeSingle();

        if (usernameError) {
            logger.error('Username check error:', usernameError);
            return showNotification('❌ Gagal memeriksa username. Coba lagi.');
        }

        if (existingUsername) {
            return showNotification(`❌ Username "${username}" sudah digunakan! Pilih nama lain.`);
        }

        // Validate Referral Code if provided
        const referralToValidate = manualRefCode || sessionStorage.getItem('jdk_referral_code');
        if (referralToValidate) {
            const { data: referrer, error: refError } = await sbClient
                .from('profiles')
                .select('id, username')
                .eq('referral_code', referralToValidate)
                .maybeSingle();

            if (refError) {
                logger.error('Referral validation error:', refError);
            } else if (!referrer) {
                return showNotification(`❌ Kode referal "${referralToValidate}" tidak ditemukan! Periksa kembali kodenya.`);
            } else {
                logger.log('Referral validated for:', referrer.username);
            }
        }
    }

    // Use manual ref code if provided, otherwise fallback to session storage
    const referralToUse = manualRefCode || sessionStorage.getItem('jdk_referral_code') || null;

    // Temporarily store manual ref code if user typed it, so handleRegister can pick it up
    if (manualRefCode) {
        sessionStorage.setItem('jdk_referral_code', manualRefCode);
    }

    await handleRegister(email, pass, username, fullName);
}

/**
 * Update password strength indicator UI for registration
 * @param {string} password - Password to check
 */
export function updateRegPasswordStrengthUI(password) {
    const strength = checkPasswordStrength(password);

    const strengthBar = document.getElementById('regPasswordStrengthBar');
    const strengthText = document.getElementById('regPasswordStrengthText');

    if (strengthBar) {
        strengthBar.style.width = `${strength.width}%`;
        strengthBar.className = `h-full rounded-full transition-all duration-300 ${strength.color}`;
    }

    if (strengthText) {
        strengthText.textContent = strength.label;
        strengthText.className = `text-xs mt-1 font-bold ${strength.score >= 3 ? 'text-green-600' : strength.score >= 2 ? 'text-yellow-600' : 'text-red-500'}`;
    }
}

// Modal functions
export function openLoginModal() {
    closeAllModals();
    const m = document.getElementById('loginModal');
    if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');
    }
}

export function openRegisterModal() {
    closeAllModals();
    const m = document.getElementById('registerModalAuth');
    if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');

        // Auto-fill Referral Code from Session Storage
        const refCode = sessionStorage.getItem('jdk_referral_code');
        const refInput = document.getElementById('authRegReferralCode');
        const welcomeEl = document.getElementById('regReferralWelcome');

        if (refCode && refInput) {
            refInput.value = refCode;

            // Show welcome message if possible
            if (welcomeEl) {
                welcomeEl.innerHTML = `<span class="text-comic-blue">✨</span> Kamu diajak bergabung dengan kode: <b class="text-comic-blue">${refCode}</b>`;
                welcomeEl.classList.remove('hidden');
            }
        }
    }
}

export function openForgotPasswordModal() {
    closeAllModals();
    const m = document.getElementById('forgotPasswordModal');
    if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');
    }
}

export function closeForgotPasswordModal() {
    const m = document.getElementById('forgotPasswordModal');
    if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
    }
}

export function closeAllModals() {
    const modals = document.querySelectorAll('[id$="Modal"], [id$="ModalAuth"]');
    modals.forEach(modal => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    });
}

/**
 * Create and inject auth modals into the page
 */
export function createAuthModals() {
    const modalHTML = `
    <!-- Login Modal -->
    <div id="loginModal" class="comic-modal-overlay hidden">
        <div class="comic-modal w-full max-w-lg mx-4 flex flex-col !bg-[#FFD700] !border-2 !border-black !rounded-xl !p-0 overflow-hidden relative shadow-[8px_8px_0_#000]">
            
             <!-- Header: White Strip -->
            <div class="comic-modal-header text-center flex-shrink-0 !py-3 relative !bg-white !border-b-2 !border-black !mb-0">
                <div class="comic-modal-badge bg-comic-purple text-white !top-1.5 rotate-2 !border-2 shadow-[2px_2px_0_#000]">MEMBER!</div>
                <button onclick="closeAllModals()" class="comic-modal-close !bg-white !top-1.5 !right-2 !w-8 !h-8 !text-lg !border-2 hover:bg-red-500 hover:text-white">&times;</button>
                <h3 class="comic-modal-title text-black text-xl uppercase tracking-tighter">LOGIN AREA</h3>
            </div>
            
            <!-- Body: Yellow (Transparent to show container bg) -->
            <div class="comic-modal-body flex-1 overflow-y-auto !p-6 !bg-transparent">
                <div class="space-y-4">
                    <div>
                        <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">EMAIL / USERNAME</label>
                        <input type="text" id="loginIdentifier" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl" placeholder="Email atau username" required>
                    </div>
                    <div>
                        <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">PASSWORD</label>
                        <div class="relative">
                             <input type="password" id="loginPassword" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl" placeholder="••••••••" onkeydown="if(event.key === 'Enter') submitLogin()">
                        </div>
                    </div>
                    <div class="flex justify-between items-center text-[10px] pt-1 px-1">
                        <label class="flex items-center space-x-2 cursor-pointer group select-none">
                            <input type="checkbox" class="form-checkbox text-black rounded border-2 border-black w-4 h-4 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-black">
                            <span class="font-bold text-black uppercase tracking-wide">Ingat Saya</span>
                        </label>
                        <a href="#" onclick="openForgotPasswordModal()" class="text-black font-black hover:underline uppercase tracking-wide decoration-2 underline-offset-2">Lupa Password?</a>
                    </div>
                </div>
            </div>

            <!-- Footer: Transparent -->
            <div class="comic-modal-footer !p-6 !pt-0 !bg-transparent !border-0 flex-shrink-0 flex flex-col gap-3">
                <button onclick="submitLogin()" class="w-full bg-[#E74C3C] text-white py-3.5 rounded-xl font-black text-sm border-2 border-black hover:bg-black hover:text-white hover:scale-[1.01] active:scale-[0.99] transition-all shadow-[4px_4px_0_#000] uppercase tracking-wider flex items-center justify-center gap-2">
                    🚀 MASUK SEKARANG
                </button>
                
                <div class="relative flex items-center py-1 opacity-40">
                    <div class="flex-grow border-t-2 border-black"></div>
                    <span class="mx-3 text-[10px] text-black font-black uppercase tracking-widest">ATAU</span>
                    <div class="flex-grow border-t-2 border-black"></div>
                </div>

                <button onclick="handleGoogleLogin()" class="w-full bg-white text-black py-2.5 rounded-xl font-bold text-xs border-2 border-black hover:bg-gray-50 hover:shadow-[2px_2px_0_#000] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 shadow-sm">
                    <img src="https://www.google.com/favicon.ico" class="w-4 h-4" alt="Google">
                    LOGIN GOOGLE
                </button>
                
                <p class="text-center text-[10px] mt-1 font-bold">
                    Belum punya akun? <a href="#" onclick="openRegisterModal()" class="text-black font-black hover:underline hover:scale-105 inline-block transition-transform border-b-2 border-black">DAFTAR DISINI</a>
                </p>
            </div>
        </div>
    </div>

    <!-- Register Modal -->
    <div id="registerModalAuth" class="comic-modal-overlay hidden">
        <div class="comic-modal w-full max-w-lg mx-4 flex flex-col max-h-[90vh] !bg-[#FFD700] !border-2 !border-black !rounded-xl !p-0 overflow-hidden relative shadow-[8px_8px_0_#000]">
            
            <!-- Header -->
            <div class="comic-modal-header text-center flex-shrink-0 !py-3 relative !bg-white !border-b-2 !border-black !mb-0">
                <div class="comic-modal-badge bg-comic-green text-black !top-1.5 -rotate-2 !border-2 shadow-[2px_2px_0_#000]">BARU!</div>
                <button onclick="closeAllModals()" class="comic-modal-close !bg-white !top-1.5 !right-2 !w-8 !h-8 !text-lg !border-2 hover:bg-red-500 hover:text-white">&times;</button>
                <h3 class="comic-modal-title text-black text-xl uppercase tracking-tighter">DAFTAR MEMBER</h3>
            </div>
            
            <div class="comic-modal-body flex-1 overflow-y-auto !p-6 !bg-transparent">
                <div class="space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">USERNAME</label>
                            <input type="text" id="authRegUsername" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl" placeholder="Username unik">
                        </div>
                        <div>
                            <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">NAMA LENGKAP</label>
                            <input type="text" id="authRegFullName" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl" placeholder="Nama kamu">
                        </div>
                    </div>
                    <div>
                        <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">EMAIL</label>
                        <input type="email" id="authRegEmail" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl" placeholder="email@contoh.com">
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">PASSWORD</label>
                            <input type="password" id="authRegPassword" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl" placeholder="Min 6 karakter" oninput="updateRegPasswordStrengthUI(this.value)">
                            <div class="mt-1 flex items-center gap-2 h-1 bg-black/10 rounded-full overflow-hidden">
                                <div id="regPasswordStrengthBar" class="h-full w-0 bg-red-500 transition-all duration-300"></div>
                            </div>
                            <div id="regPasswordStrengthText" class="text-[9px] font-bold text-black mt-1 uppercase tracking-wide"></div>
                        </div>
                        <div>
                            <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">KONFIRMASI</label>
                            <input type="password" id="authRegConfirmPassword" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl" placeholder="Ulangi password">
                        </div>
                    </div>
                    <div>
                         <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">KODE REFERAL (OPSIONAL)</label>
                         <div id="regReferralWelcome" class="hidden text-xs font-bold mb-2 bg-white/50 p-2 rounded border border-black/10 text-black"></div>
                         <input type="text" id="authRegReferralCode" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black border-dashed shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl font-bold" placeholder="Punya kode teman?">
                    </div>
                </div>
            </div>
            
            <div class="comic-modal-footer !p-6 !pt-0 !bg-transparent !border-0 flex-shrink-0 flex flex-col gap-3">
                <button onclick="submitRegister()" class="w-full bg-[#E74C3C] text-white py-3.5 rounded-xl font-black text-sm border-2 border-black hover:bg-black hover:text-white hover:scale-[1.01] active:scale-[0.99] transition-all shadow-[4px_4px_0_#000] uppercase tracking-wider flex items-center justify-center gap-2">
                    ✨ GABUNG SEKARANG!
                </button>
                 <button onclick="handleGoogleLogin()" class="w-full bg-white text-black py-2.5 rounded-xl font-bold text-xs border-2 border-black hover:bg-gray-50 hover:shadow-[2px_2px_0_#000] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 shadow-sm">
                    <img src="https://www.google.com/favicon.ico" class="w-4 h-4" alt="Google">
                    DAFTAR DENGAN GOOGLE
                </button>
                <p class="text-center text-[10px] mt-2 font-bold opacity-80">
                    Sudah punya akun? <a href="#" onclick="openLoginModal()" class="text-black font-black hover:underline hover:scale-105 inline-block transition-transform border-b-2 border-black">LOGIN DISINI ▸</a>
                </p>
            </div>
        </div>
    </div>

    <!-- Forgot Password Modal -->
    <div id="forgotPasswordModal" class="comic-modal-overlay hidden">
        <div class="comic-modal w-full max-w-lg mx-4 flex flex-col !bg-[#FFD700] !border-2 !border-black !rounded-xl !p-0 overflow-hidden relative shadow-[8px_8px_0_#000]">
            
            <div class="comic-modal-header text-center flex-shrink-0 !py-3 relative !bg-white !border-b-2 !border-black !mb-0">
                <button onclick="closeForgotPasswordModal()" class="comic-modal-close !bg-white !top-1.5 !right-2 !w-8 !h-8 !text-lg !border-2 hover:bg-red-500 hover:text-white">&times;</button>
                <h3 class="comic-modal-title text-black text-xl uppercase tracking-tighter">LUPA PASSWORD</h3>
            </div>
            
            <div class="comic-modal-body flex-1 overflow-y-auto !p-6 !bg-transparent">
                <div class="space-y-4">
                    <p class="text-xs font-bold text-black text-center uppercase tracking-wide opacity-70">
                        Jangan panik! Masukkan email kamu dan kami akan kirimkan link reset password.
                    </p>
                    <div>
                        <label class="block font-black text-[10px] opacity-70 uppercase tracking-widest mb-1 text-black">EMAIL KAMU</label>
                        <input type="email" id="forgotEmail" class="comic-input !text-xs !p-3 !bg-white !border-2 !border-black shadow-none focus:shadow-[4px_4px_0_#000] focus:-translate-y-1 transition-all rounded-xl" placeholder="email@contoh.com">
                    </div>
                </div>
            </div>
            
            <div class="comic-modal-footer !p-6 !pt-0 !bg-transparent !border-0 flex-shrink-0 flex flex-col gap-3">
                <button onclick="handleForgotPassword()" class="w-full bg-[#E74C3C] text-white py-3.5 rounded-xl font-black text-sm border-2 border-black hover:bg-black hover:text-white hover:scale-[1.01] active:scale-[0.99] transition-all shadow-[4px_4px_0_#000] uppercase tracking-wider flex items-center justify-center gap-2">
                    📨 KIRIM LINK RESET
                </button>
                <p class="text-center text-[10px] mt-2 font-bold opacity-80">
                    Ingat password? <a href="#" onclick="openLoginModal()" class="text-black font-black hover:underline hover:scale-105 inline-block transition-transform border-b-2 border-black">LOGIN DISINI ▸</a>
                </p>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

/**
 * Toggle password visibility for specific input
 */
export function toggleRegPassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁';
    }
}

// Expose to window for global access (needed for onclick handlers in modals)
if (typeof window !== 'undefined') {
    window.handleLogin = handleLogin;
    window.handleRegister = handleRegister;
    window.handleLogout = handleLogout;
    window.handleGoogleLogin = handleGoogleLogin;
    window.handleForgotPassword = handleForgotPassword;
    window.submitLogin = submitLogin;
    window.submitRegister = submitRegister;
    window.openLoginModal = openLoginModal;
    window.openRegisterModal = openRegisterModal;
    window.openForgotPasswordModal = openForgotPasswordModal;
    window.closeForgotPasswordModal = closeForgotPasswordModal;
    window.closeAllModals = closeAllModals;
    window.updateRegPasswordStrengthUI = updateRegPasswordStrengthUI;
    window.toggleRegPassword = toggleRegPassword;
}
