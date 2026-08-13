import { logger } from '../core/logger.js';
import Splide from '@splidejs/splide';
import '@splidejs/splide/css';
import { sbClient } from '../core/supabase.js';
import { getAllActiveLeaderboardConfigs, fetchLeaderboardStandings } from '../modules/leaderboard.js';
import { calculateUserLevel } from '../modules/ranks.js';

let p5Instance = null;

/**
 * Initialize home page
 */
export async function initializeHomePage() {
    // Initialize particle background
    // Initialize particle background (only on desktop for maximum performance)
    if (document.getElementById('particle-container') && window.innerWidth >= 768) {
        initializeRetroParticles();
    }

    // Initialize JDK Box slider
    if (document.getElementById('jdkbox-slider')) {
        initializeJDKBoxSlider();
    }

    // Initialize Hero Slider
    if (document.getElementById('hero-slider')) {
        initializeHeroSlider();
    }

    // Initialize Full Leaderboard (if exists)
    if (document.getElementById('leaderboard-container')) {
        renderLeaderboard();
    }

    // Initialize Home Page Minimalist Leaderboard
    if (document.getElementById('home-leaderboard')) {
        renderHomeLeaderboard();
    }

    // Initialize Upcoming Events
    if (document.getElementById('upcoming-events-container')) {
        renderUpcomingEvents();
    }
}

/**
 * Fetch and render the 2 nearest upcoming events
 */
async function renderUpcomingEvents() {
    const container = document.getElementById('upcoming-events-container');
    if (!container) return;

    try {
        const now = new Date().toISOString();

        // Fetch 2 nearest upcoming events that are not past
        const { data: events, error } = await sbClient
            .from('events')
            .select('*')
            .gte('date', now.split('T')[0])
            .order('date', { ascending: true })
            .limit(2);

        if (error) throw error;

        if (!events || events.length === 0) {
            container.innerHTML = `
                <div class="col-span-full text-center py-12 bg-zinc-800/30 rounded-2xl border-2 border-dashed border-gray-700">
                    <div class="text-4xl mb-4">📅</div>
                    <p class="text-gray-400 font-bold uppercase tracking-wider">Belum Ada Event</p>
                    <p class="text-gray-500 text-sm mt-2">Terus pantau untuk update selanjutnya!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = events.map(event => {
            const eventDate = new Date(event.date);
            const dateStr = eventDate.toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

            // Determine event status dynamically if not set
            const now = new Date();
            const daysDiff = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));
            let eventStatus = event.status;
            if (!eventStatus) {
                if (daysDiff <= 0) {
                    eventStatus = 'SELESAI';
                } else if (daysDiff <= 7) {
                    eventStatus = 'SEGERA';
                } else {
                    eventStatus = 'OPEN';
                }
            }

            // Fallback for event image
            const eventImage = event.image_url || 'https://placehold.co/400x400/333/FFD400?text=' + encodeURIComponent(event.title || 'Event JDK');

            return `
                <article
                    class="flex flex-col lg:flex-row bg-background-dark border-2 border-black/10 rounded-2xl overflow-hidden hover:border-primary transition-all duration-300 group hover:shadow-[0_0_20px_rgba(255,212,0,0.15)] h-full">
                    <div class="p-8 flex-1 flex flex-col justify-between order-2 lg:order-1 min-w-0">
                        <div>
                            <h3 class="text-primary text-2xl font-black uppercase mb-2 leading-tight break-words">${event.title}</h3>
                            <div class="flex flex-col gap-2 mt-4 text-gray-300">
                                <div class="flex items-center gap-2">
                                    <span class="material-symbols-outlined text-primary">calendar_today</span>
                                    <span class="font-bold">${dateStr}</span>
                                </div>
                                <div class="flex items-center gap-2 min-w-0">
                                    <span class="material-symbols-outlined text-primary flex-shrink-0">location_on</span>
                                    <span class="font-medium truncate flex-1" title="${event.location || 'Online / TBA'}">${event.location || 'Online / TBA'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="mt-8">
                            <button onclick="window.location.href='/events.html?id=${event.id}'"
                                class="w-full lg:w-auto bg-primary hover:bg-primary-dark text-black px-6 py-3 rounded-lg font-black uppercase tracking-wide flex items-center justify-center gap-2 transition-transform hover:scale-105">
                                <span class="material-symbols-outlined text-xl">confirmation_number</span>
                                Detail / Daftar
                            </button>
                        </div>
                    </div>
                    <div
                        class="relative h-64 lg:h-auto lg:w-2/5 shrink-0 order-1 lg:order-2 overflow-hidden border-b-2 lg:border-b-0 lg:border-l-2 border-black/10">
                        <div class="w-full h-full bg-cover bg-center transition-transform duration-700 group-hover:scale-110"
                            role="img" aria-label="${event.title}"
                            style="background-image: url('${eventImage}')"></div>
                        <div
                            class="absolute inset-0 bg-gradient-to-t from-background-dark/80 to-transparent lg:bg-gradient-to-l">
                        </div>
                        <div class="absolute top-4 right-4">
                            <span
                                class="bg-primary text-black text-[10px] font-black px-3 py-1 rounded border border-black shadow-sm uppercase">${eventStatus}</span>
                        </div>
                    </div>
                </article>
            `;
        }).join('');

    } catch (err) {
        logger.error('Error loading upcoming events:', err);
        container.innerHTML = `
            <div class="col-span-full text-center py-12">
                <p class="text-gray-400 font-bold uppercase tracking-wider">Belum ada event</p>
            </div>
        `;
    }
}

/**
 * Render dynamic leaderboards (supports multiple active leaderboards)
 */
async function renderLeaderboard() {
    const container = document.getElementById('leaderboard-container');
    const configs = await getAllActiveLeaderboardConfigs();

    if (!configs || configs.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center py-12 text-gray-400 font-body">Belum ada kompetisi aktif.</div>';
        return;
    }

    // Clear container
    container.innerHTML = '';

    // Render each active leaderboard
    for (const config of configs) {
        const standings = await fetchLeaderboardStandings(config);

        // Create section for this leaderboard
        const section = document.createElement('div');
        section.className = 'col-span-full mb-16';

        // Add title for this leaderboard
        section.innerHTML = `
            <div class="text-center mb-8">
                <h3 class="section-title text-3xl md:text-4xl text-comic-purple mb-2">${config.title}</h3>
                <p class="text-sm text-gray-500 font-bold font-body">
                    📅 ${new Date(config.start_date).toLocaleDateString('id-ID')} - ${new Date(config.end_date).toLocaleDateString('id-ID')}
                </p>
            </div>
        `;

        // Render standings
        if (standings.length === 0) {
            section.innerHTML += '<div class="text-center py-8 text-gray-400 font-body">Tidak ada data untuk periode/metrik ini.</div>';
        } else {
            section.innerHTML += renderLeaderboardContent(standings, config);
        }

        container.appendChild(section);
    }
}

/**
 * Render leaderboard content (Top 3 cards + list for rank 4-10)
 */
function renderLeaderboardContent(standings, config) {
    const medals = ['🥇', '🥈', '🥉'];
    const cardColors = ['border-yellow-400', 'border-gray-300', 'border-orange-400'];

    // Render Top 3
    let html = '<div class="grid md:grid-cols-3 gap-6 mb-8">';
    html += standings.slice(0, 3).map((user, index) => {
        const lvlInfo = calculateUserLevel(user.xp || 0);
        return `
            <div class="bg-white rounded-2xl p-6 border-4 ${cardColors[index]} text-center relative overflow-hidden shadow-hard">
                <div class="absolute top-2 right-2 flex flex-col items-center">
                    <img src="${lvlInfo.rankIcon}" alt="${lvlInfo.rankName}" class="w-10 h-10 object-contain drop-shadow-sm" title="${lvlInfo.rankName}">
                    <span class="text-[10px] font-bold text-gray-400 uppercase leading-none">${lvlInfo.rankName}</span>
                </div>
                <div class="text-5xl mb-3 relative z-10">${medals[index]}</div>
                <div class="w-20 h-20 bg-gray-100 rounded-full mx-auto mb-3 flex items-center justify-center border-4 border-black overflow-hidden relative z-10 shadow-hard-sm">
                    <img src="${user.avatar_url || '/images/mr-jdk-mascot.png'}" alt="${user.username}" class="w-full h-full object-cover">
                </div>
                <h3 class="text-xl font-bold text-black mb-1 relative z-10 uppercase" style="font-family: 'Bangers', cursive;">${user.username}</h3>
                <div class="flex items-center justify-center gap-2 mb-3 relative z-10">
                    <span class="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded border-2 border-black">LVL ${lvlInfo.level}</span>
                    <div class="w-16 h-2 bg-gray-200 rounded-full border-2 border-black overflow-hidden">
                        <div class="h-full bg-green-500" style="width: ${lvlInfo.progressPercent}%"></div>
                    </div>
                </div>
                <div class="text-3xl font-bold text-red-500 mb-0 relative z-10" style="font-family: 'Bangers', cursive;">${user.score.toLocaleString()}</div>
                <p class="text-[10px] text-gray-500 font-bold uppercase relative z-10">${config.metric_type}</p>
                <div class="absolute -bottom-4 -right-4 w-20 h-20 bg-gray-50 rounded-full opacity-30 pointer-events-none"></div>
            </div>
        `;
    }).join('');
    html += '</div>';

    // Render list for rank 4-10 (Initially hidden)
    if (standings.length > 3) {
        const toggleId = `leaderboard-extra-${config.id}`;
        html += `
            <div id="${toggleId}" class="hidden mt-8">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${standings.slice(3).map((user, index) => {
            const lvlInfo = calculateUserLevel(user.xp || 0);
            return `
                            <div class="flex items-center gap-4 bg-white p-4 border-4 border-black rounded-xl shadow-hard-sm">
                                <div class="text-2xl font-bold text-gray-400 font-display w-8">${index + 4}</div>
                                <img src="${user.avatar_url || '/images/mr-jdk-mascot.png'}" class="w-12 h-12 rounded-full border-2 border-black object-cover">
                                <div class="flex-1">
                                    <div class="font-bold text-black uppercase leading-none mb-1 text-sm truncate">${user.username}</div>
                                    <div class="flex items-center gap-2">
                                        <span class="text-[8px] font-bold text-red-500">LVL ${lvlInfo.level}</span>
                                        <img src="${lvlInfo.rankIcon}" class="w-3 h-3 object-contain opacity-70">
                                        <span class="text-[8px] text-gray-400 uppercase">${lvlInfo.rankName}</span>
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="font-bold text-blue-600 font-display text-base">${user.score.toLocaleString()}</div>
                                    <div class="text-[8px] text-gray-400 uppercase font-bold">${config.metric_type}</div>
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
            <div class="text-center mt-8">
                <button onclick="toggleLeaderboardExtra('${toggleId}', this)" 
                        class="btn-secondary text-xs px-6 py-2 border-3">
                    🏆 TAMPILKAN TOP 10
                </button>
            </div>
        `;
    }

    return html;
}

/**
 * Render minimalist home page leaderboard (Top 5) with Category Slider
 */
async function renderHomeLeaderboard() {
    const SplideLib = typeof Splide !== 'undefined' ? Splide : null;
    const container = document.getElementById('home-leaderboard');
    if (!container || !SplideLib) return;

    try {
        // Show loading state initially
        container.innerHTML = `
            <div class="w-full text-center py-8">
                <div class="animate-spin inline-block w-6 h-6 border-2 border-current border-t-transparent text-primary rounded-full mb-2"></div>
                <p class="text-white/40 text-sm font-bold uppercase tracking-widest">Memuat Leaderboard...</p>
            </div>
        `;

        // 1. Prepare Configurations
        const activeConfigs = await getAllActiveLeaderboardConfigs();
        const slidesData = [];

        activeConfigs.forEach(config => {
            slidesData.push({
                id: `config-${config.id}`,
                title: config.title?.toUpperCase() || config.metric_type,
                metric: config.metric_type,
                config: config
            });
        });

        // 2. Fetch All Data in Parallel
        const results = await Promise.all(slidesData.map(async (slide) => {
            let standings = [];
            try {
                if (slide.config) {
                    standings = await fetchLeaderboardStandings(slide.config);
                    standings = standings.slice(0, 10);
                }
            } catch (e) {
                logger.error(`Failed to fetch standings for ${slide.title}`, e);
            }
            return { ...slide, standings };
        }));

        // 3. Render Slider HTML
        if (results.length === 0) {
            container.innerHTML = `
                <div class="w-full text-center py-12 bg-white/5 rounded-2xl border-2 border-dashed border-white/10">
                    <p class="text-white/40 text-sm font-bold uppercase tracking-widest">Belum ada kompetisi aktif</p>
                </div>
            `;
            return;
        }

        // Note: We use unique ID for splide instantiation to avoid conflicts
        const sliderHtml = `
            <div id="home-leaderboard-slider" class="splide w-full px-8 md:px-12 relative group">
                <!-- Custom Arrows Wrapper (Absolute/Side Positioning) -->
                <div class="splide__arrows splide__arrows--ltr">
                    <button class="splide__arrow splide__arrow--prev group bg-transparent hover:bg-yellow-400/80 text-white/30 hover:!text-black w-12 h-16 absolute left-0 top-24 flex items-center justify-center transition-all z-10 !border-0 !shadow-none !transform-none !static-0 rounded-none sm:rounded-l-2xl">
                        <span class="material-symbols-outlined text-4xl transform transition-transform group-hover:-translate-x-1 group-hover:!text-black">chevron_left</span>
                    </button>
                    <button class="splide__arrow splide__arrow--next group bg-transparent hover:bg-yellow-400/80 text-white/30 hover:!text-black w-12 h-16 absolute right-0 top-24 flex items-center justify-center transition-all z-10 !border-0 !shadow-none !transform-none !static-0 rounded-none sm:rounded-r-2xl">
                        <span class="material-symbols-outlined text-4xl transform transition-transform group-hover:translate-x-1 group-hover:!text-black">chevron_right</span>
                    </button>
                </div>

                <div class="splide__track overflow-hidden rounded-2xl">
                    <ul class="splide__list">
                        ${results.map(slide => renderLeaderboardSlide(slide)).join('')}
                    </ul>
                </div>
            </div>
        `;

        container.innerHTML = sliderHtml;

        // 4. Initialize Splide
        window.leaderboardSplide = new SplideLib('#home-leaderboard-slider', {
            type: 'loop',
            perPage: 1,
            arrows: true,
            pagination: true,
            drag: true,
            autoHeight: true,
            autoplay: true,
            interval: 5000,
            classes: {
                pagination: 'splide__pagination flex gap-2 justify-center mt-4',
                page: 'w-2 h-2 rounded-full bg-white/20 transition-all cursor-pointer [&.is-active]:bg-primary [&.is-active]:scale-125'
            }
        }).mount();

    } catch (err) {
        logger.error('Error rendering home leaderboard slider:', err);
        container.innerHTML = `
            <div class="w-full text-center py-8">
                <p class="text-white/40 text-sm font-bold uppercase tracking-widest">Gagal memuat leaderboard</p>
            </div>
        `;
    }
}

/**
 * Helper to render a single slide's HTML
 */
function renderLeaderboardSlide(slide) {
    const { id, title, standings, metric } = slide;
    const medals = ['🥇', '🥈', '🥉'];
    // Extended colors for Top 10 (keeping for borders if needed, or simplification)
    const borderColors = [
        'border-yellow-400', 'border-gray-400', 'border-orange-400',
        'border-zinc-600', 'border-zinc-600', 'border-zinc-700',
        'border-zinc-700', 'border-zinc-700', 'border-zinc-700', 'border-zinc-700'
    ];
    // Subtler backgrounds for row layout
    const bgColors = [
        'bg-yellow-400/15', 'bg-gray-400/15', 'bg-orange-400/15',
        'bg-white/10', 'bg-white/10', 'bg-white/10',
        'bg-white/10', 'bg-white/10', 'bg-white/10', 'bg-white/10'
    ];

    let contentHtml = '';

    if (!standings || standings.length === 0) {
        contentHtml = `<div class="text-center py-8 text-white/30 italic text-sm">Belum ada data kompetisi ini</div>`;
    } else {
        // Minimalist Logic: Top 3 by default, expand for rest
        const visibleCount = 3;
        const visibleStandings = standings.slice(0, visibleCount);
        const hiddenStandings = standings.slice(visibleCount);
        const hasHidden = hiddenStandings.length > 0;
        const hiddenId = `more-${slide.id || Math.random().toString(36).substr(2, 9)}`;

        const renderUserRow = (user, index) => {
            const lvlInfo = calculateUserLevel(user.xp || 0);
            const isTop3 = index < 3;
            const scoreDisplay = (user.score || 0).toLocaleString();
            const unitDisplay = user.unit || metric;
            const borderColor = borderColors[index] || 'border-zinc-700';
            const bgColor = bgColors[index] || 'bg-zinc-800/10';

            return `
                <a href="profile.html?id=${user.id}" class="group flex items-center gap-3 md:gap-4 p-3 rounded-xl border border-white/20 ${bgColor} hover:bg-white/10 transition-colors duration-300 w-full relative overflow-hidden">
                    <!-- Rank Indicator Bar (Left) -->
                    <div class="absolute left-0 top-0 bottom-0 w-1 ${borderColor.replace('border', 'bg')} opacity-60"></div>

                    <!-- Avatar (Left) -->
                    <div class="flex-shrink-0 relative">
                        <div class="w-9 h-9 md:w-10 md:h-10 rounded-full border-2 ${borderColor} overflow-hidden shadow-sm bg-zinc-800">
                            <img src="${user.avatar_url || '/images/mr-jdk-mascot.png'}" 
                                 alt="${user.username}" 
                                 class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                 onerror="this.src='/images/mr-jdk-mascot.png'">
                        </div>
                    </div>

                    <!-- User Details (Middle) -->
                    <div class="flex-1 min-w-0 flex flex-col justify-center text-left">
                        <h4 class="text-white font-black uppercase text-xs md:text-sm truncate w-full leading-tight mb-0.5">${user.username || 'JDKwan'}</h4>
                        <div class="flex items-center gap-2 opacity-80">
                            <span class="text-primary font-bold text-[10px] md:text-xs">${scoreDisplay} ${unitDisplay}</span>
                        </div>
                    </div>

                    <!-- Rank/Medal (Right) -->
                    <div class="flex-shrink-0 text-center flex items-center justify-center w-8">
                        <span class="text-xl md:text-2xl filter drop-shadow-sm">
                            ${isTop3 ? medals[index] : `<span class="text-white/40 font-black text-xs md:text-sm">#${index + 1}</span>`}
                        </span>
                    </div>
                </a>
             `;
        };

        contentHtml = `
            <div class="flex flex-col gap-3 w-full">
                <!-- Top 3 (Visible) -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    ${visibleStandings.map((u, i) => renderUserRow(u, i)).join('')}
                </div>

                <!-- Rest (Hidden) -->
                ${hasHidden ? `
                    <div id="${hiddenId}" class="hidden flex flex-col gap-2 mt-2">
                         ${hiddenStandings.map((u, i) => renderUserRow(u, visibleCount + i)).join('')}
                    </div>
                    
                    <!-- Toggle Button -->
                    <div class="text-center mt-3">
                        <button onclick="toggleSlideContent('${hiddenId}', this)" 
                                class="inline-flex items-center gap-2 text-[10px] font-bold text-white/30 hover:text-primary transition-colors uppercase tracking-widest px-4 py-1 hover:bg-white/5 rounded-full border border-transparent hover:border-white/10">
                            <span>Tampilkan Lengkap</span>
                            <span class="material-symbols-outlined text-sm">expand_more</span>
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    return `
        <li class="splide__slide">
            <div class="flex flex-col px-1">
                <!-- Slide Header -->
                <div class="text-center mb-4">
                    <h3 class="text-lg md:text-xl text-comic-yellow font-black uppercase tracking-wider inline-block transform -rotate-1 opacity-90">
                        ${title}
                    </h3>
                </div>
                <!-- Slide Content -->
                <div class="custom-scrollbar pl-1 pr-1 pb-1">
                    ${contentHtml}
                </div>
            </div>
        </li>
    `;
}

/**
 * Toggle visibility of extra slide content
 */
window.toggleSlideContent = (id, btn) => {
    // Look within the same slide first (for Splide clones)
    const slide = btn.closest('.splide__slide');
    const el = slide ? slide.querySelector('#' + id) : document.getElementById(id);
    if (!el) return;

    const isHidden = el.classList.contains('hidden');
    if (isHidden) {
        el.classList.remove('hidden');
        const spanText = btn.querySelector('span:first-child');
        const spanIcon = btn.querySelector('span:last-child');
        if (spanText) spanText.textContent = 'Tutup';
        if (spanIcon) spanIcon.textContent = 'expand_less';
    } else {
        el.classList.add('hidden');
        const spanText = btn.querySelector('span:first-child');
        const spanIcon = btn.querySelector('span:last-child');
        if (spanText) spanText.textContent = 'Tampilkan Lengkap';
        if (spanIcon) spanIcon.textContent = 'expand_more';
    }

    // Refresh Splide layout to adjust height and arrows
    if (window.leaderboardSplide) {
        // Small delay to ensure DOM update is processed
        setTimeout(() => {
            window.leaderboardSplide.refresh();
        }, 150);
    }
};

/**
 * Toggle visibility of extra leaderboard ranks
 */
window.toggleLeaderboardExtra = (id, btn) => {
    const el = document.getElementById(id);
    if (!el) return;

    const isHidden = el.classList.contains('hidden');
    if (isHidden) {
        el.classList.remove('hidden');
        btn.textContent = '✖ TUTUP KLASEMEN';
        btn.classList.replace('btn-secondary', 'btn-primary');
    } else {
        el.classList.add('hidden');
        btn.textContent = '🏆 TAMPILKAN TOP 10';
        btn.classList.replace('btn-primary', 'btn-secondary');
    }
};

/**
 * Initialize retro particle effect using p5.js
 */
async function initializeRetroParticles() {
    if (p5Instance) {
        p5Instance.remove();
        p5Instance = null;
    }
    
    const p5 = (await import('p5')).default;

    p5Instance = new p5((p) => {
        let particles = [];
        let time = 0;

        p.setup = () => {
            const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
            canvas.parent('particle-container');

            // Create retro-style particles
            for (let i = 0; i < 80; i++) {
                particles.push({
                    x: p.random(p.width),
                    y: p.random(p.height),
                    vx: p.random(-1, 1),
                    vy: p.random(-1, 1),
                    size: p.random(1, 4),
                    color: p.random(['#00ff41', '#ff073a', '#00d4ff', '#ffff00']),
                    pulse: p.random(0, p.TWO_PI)
                });
            }
        };

        p.draw = () => {
            p.clear();
            time += 0.02;

            // Update and draw particles
            particles.forEach((particle) => {
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.pulse += 0.1;

                // Wrap around edges
                if (particle.x < 0) particle.x = p.width;
                if (particle.x > p.width) particle.x = 0;
                if (particle.y < 0) particle.y = p.height;
                if (particle.y > p.height) particle.y = 0;

                // Pulsing effect
                const pulseSize = particle.size + p.sin(particle.pulse) * 2;
                const alpha = 150 + p.sin(particle.pulse * 2) * 105;

                // Draw particle
                p.fill(particle.color + Math.floor(alpha).toString(16).padStart(2, '0'));
                p.noStroke();
                p.ellipse(particle.x, particle.y, pulseSize);

                // Add pixel effect
                p.fill(255, 255, 255, alpha * 0.5);
                p.rect(particle.x - 1, particle.y - 1, 2, 2);
            });

            // Draw connections with neon effect
            particles.forEach((particle, i) => {
                particles.slice(i + 1).forEach(other => {
                    const distance = p.dist(particle.x, particle.y, other.x, other.y);
                    if (distance < 150) {
                        const alpha = p.map(distance, 0, 150, 100, 0);
                        p.stroke(0, 255, 65, alpha);
                        p.strokeWeight(1);
                        p.line(particle.x, particle.y, other.x, other.y);

                        // Add glow effect
                        p.stroke(0, 255, 65, alpha * 0.5);
                        p.strokeWeight(3);
                        p.line(particle.x, particle.y, other.x, other.y);
                    }
                });
            });

            // Add floating retro elements
            for (let i = 0; i < 5; i++) {
                const x = p.width * 0.2 + p.sin(time + i) * 100;
                const y = p.height * 0.3 + p.cos(time + i) * 50;
                p.fill(255, 7, 58, 100);
                p.noStroke();
                p.rect(x, y, 4, 4);
            }
        };

        p.windowResized = () => {
            p.resizeCanvas(p.windowWidth, p.windowHeight);
        };
    });
}

/**
 * Initialize JDK Box slider using Splide.js with dynamic data from Supabase
 */
async function initializeJDKBoxSlider() {
    const sliderList = document.getElementById('jdkbox-slider-list');
    if (!sliderList) return;

    try {
        // Fetch latest approved products (limit 8 for slider)
        const { data: products, error } = await sbClient
            .from('products')
            .select('id, name, description, price, image_url, category')
            .eq('status', 'available')
            .order('created_at', { ascending: false })
            .limit(8);

        if (error) throw error;

        if (products && products.length > 0) {
            // Render dynamic products
            sliderList.innerHTML = products.map(product => `
                <li class="splide__slide">
                    <div class="card-hover bg-white rounded-2xl overflow-hidden border-4 border-black">
                        <img src="${product.image_url || '/placeholder.svg'}" 
                             alt="${product.name}" 
                             class="w-full h-64 object-cover"
                             loading="lazy"
                             onerror="this.src='/placeholder.svg'">
                        <div class="p-6">
                            <h3 class="text-xl font-bold text-red-500 mb-2 truncate"
                                style="font-family: 'Roboto Condensed', sans-serif;">${product.name}</h3>
                            <p class="text-gray-600 mb-4 line-clamp-2" style="font-family: 'Comic Neue', cursive;">
                                ${product.description || product.category}
                            </p>
                            <div class="flex justify-between items-center">
                                <span class="text-2xl font-bold text-red-500"
                                    style="font-family: 'Bangers', cursive;">Rp ${product.price.toLocaleString('id-ID')}</span>
                                <button class="btn-primary" onclick="window.location.href='/marketplace.html?id=${product.id}'">
                                    LIHAT
                                </button>
                            </div>
                        </div>
                    </div>
                </li>
            `).join('');
        } else {
            // Fallback: show placeholder message
            sliderList.innerHTML = `
                <li class="splide__slide">
                    <div class="card-hover bg-white rounded-2xl overflow-hidden border-4 border-black p-8 text-center">
                        <div class="text-6xl mb-4">📦</div>
                        <h3 class="text-xl font-bold text-gray-400 mb-2">Belum ada produk</h3>
                        <p class="text-gray-400">Jadilah yang pertama menjual di JDK Box!</p>
                        <button class="btn-primary mt-4" onclick="window.location.href='/marketplace.html'">
                            JUAL BARANG
                        </button>
                    </div>
                </li>
            `;
        }
    } catch (err) {
        logger.error('Error loading JDK Box products:', err);
        // Keep loading skeleton on error
    }

    // Initialize Splide after content is loaded
    new Splide('#jdkbox-slider', {
        type: 'loop',
        perPage: 3,
        perMove: 1,
        gap: '2rem',
        autoplay: true,
        interval: 4000,
        breakpoints: {
            1024: { perPage: 2 },
            640: { perPage: 1 }
        }
    }).mount();
}


/**
 * Initialize Hero Slider using Splide.js with dynamic data from Supabase
 */
async function initializeHeroSlider() {
    const SplideLib = typeof Splide !== 'undefined' ? Splide : null;
    if (!SplideLib) return;

    try {
        // Relaxed query: only filter by is_active. 
        // Dates will be checked in memory to avoid issues with timezones/minor offsets
        const { data: allSlides, error } = await sbClient
            .from('hero_sliders')
            .select('*')
            .eq('is_active', true)
            .order('order_index', { ascending: true });

        if (error) throw error;

        const now = new Date();
        const slides = (allSlides || []).filter(slide => {
            const start = new Date(slide.start_date);
            const end = new Date(slide.end_date);
            // Allow a 1-minute buffer for start date to handle server/client clock drift
            const startOk = start <= new Date(now.getTime() + 60000);
            const endOk = end >= now;
            return startOk && endOk;
        });

        if (slides.length === 0) {
            logger.log('No active slides match the current date criteria.');
            document.querySelector('.hero-slider-section').style.display = 'none';
            return;
        }

        const sliderList = document.getElementById('hero-slider-list');
        if (!sliderList) return;

        sliderList.innerHTML = slides.map((slide, idx) => `
            <li class="splide__slide">
                <a href="${slide.link_url || '#'}" class="block w-full h-full cursor-pointer group">
                    <div class="hero-slide-content min-h-[400px] md:min-h-[500px] lg:min-h-[600px] overflow-hidden relative">
                        <!-- Full Image Background -->
                        <img src="${slide.image_url}" 
                             alt="${slide.title || 'JDK Slider'}"
                             class="w-full h-full object-cover absolute inset-0 transition-transform duration-500 group-hover:scale-105"
                             ${idx === 0 ? 'fetchpriority="high" loading="eager"' : 'loading="lazy"'}
                             onerror="this.style.display='none'; this.parentElement.style.background='var(--comic-yellow)';">
                        
                        <!-- Text Overlay -->
                        ${(slide.title || slide.subtitle) ? `
                            <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-6 md:p-8 lg:p-12">
                                ${slide.title ? `
                                    <h2 class="text-white text-2xl md:text-4xl lg:text-5xl font-black uppercase tracking-tight drop-shadow-lg mb-2">
                                        ${slide.title}
                                    </h2>
                                ` : ''}
                                ${slide.subtitle ? `
                                    <p class="text-white/90 text-sm md:text-lg lg:text-xl font-medium max-w-2xl leading-relaxed">
                                        ${slide.subtitle}
                                    </p>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>
                </a>
            </li>
        `).join('');

        const splide = new SplideLib('#hero-slider', {
            type: 'fade',
            rewind: true,
            autoplay: true,
            interval: 6000,
            pauseOnHover: false,
            arrows: true, // Enabled arrows
            drag: true,   // Enabled drag/swipe
            speed: 800,
            classes: {
                pagination: 'splide__pagination comic-pagination',
                page: 'splide__pagination__page comic-pagination-bullet',
                arrows: 'splide__arrows comic-arrows',
                arrow: 'splide__arrow comic-arrow',
                prev: 'splide__arrow--prev comic-arrow-prev',
                next: 'splide__arrow--next comic-arrow-next',
            },
        });

        const bar = document.querySelector('.hero-slider-progress-bar');
        splide.on('mounted move', () => {
            if (bar) bar.style.width = '0%';
        });
        splide.on('autoplay:playing', (rate) => {
            if (bar) bar.style.width = String(100 * rate) + '%';
        });

        splide.mount();

    } catch (err) {
        logger.error('Error initializing dynamic slider:', err);
    }
}

export function cleanupHomePage() {
    if (p5Instance) {
        p5Instance.remove();
        p5Instance = null;
        logger.log('🧹 Homepage particle background destroyed');
    }
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.initializeHomePage = initializeHomePage;
    window.cleanupHomePage = cleanupHomePage;
}
