import { logger } from '../core/logger.js';
import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';
import { getCurrentUser } from '../modules/user-session.js';

let widgetSettings = {
    pointCost: 500
};

let playerInstance = null;
let isMuted = true;
let currentSongId = null;
let isApiReady = false;

/**
 * Initialize the Floating YouTube Radio Widget
 * Injects HTML, CSS, and attaches event listeners
 */
export async function initializeRadioWidget() {
    // Check for existing widget
    const existingWidget = document.getElementById('jdk-radio-widget');

    // Detect stale widget: DOM exists but JS state is missing (after manual refresh)
    if (existingWidget) {
        if (!playerInstance && !isApiReady) {
            logger.log('📻 Detected stale widget after refresh, cleaning up...');
            existingWidget.remove();
            const existingStyles = document.getElementById('radio-widget-styles');
            if (existingStyles) existingStyles.remove();

            // Reset state
            playerInstance = null;
            isMuted = true;
            currentSongId = null;
            isApiReady = false;
            // Continue with fresh initialization below
        } else {
            logger.log('📻 Radio Widget already initialized, skipping...');
            return;
        }
    }

    logger.log('📻 Initializing YouTube Radio Widget...');

    // 1. Inject CSS
    injectWidgetStyles();

    // 2. Inject HTML
    injectWidgetHTML();

    // 3. Load YouTube IFrame API
    await loadYouTubeAPI();

    // 4. Attach Event Listeners
    attachWidgetListeners();

    // 5. Initial Data Load
    await Promise.all([
        loadWidgetNowPlaying(),
        loadWidgetSettings(),
        loadWidgetQueue()
    ]);

    // 6. Setup Realtime Subscription
    setupWidgetSubscription();

    // 7. Auto-refresh queue every 30s
    setInterval(loadWidgetQueue, 30000);
}

/**
 * Load React Player from CDN with improved error handling and retry logic
 */
function loadYouTubeAPI() {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) {
            isApiReady = true;
            resolve();
            return;
        }

        logger.log('📻 Loading YouTube IFrame API...');

        try {
            const tag = document.createElement('script');
            tag.src = "https://www.youtube.com/iframe_api";
            tag.onerror = () => {
                logger.warn('⚠️ YouTube API blocked by client (AdBlocker?)');
                resolve(); // Resolve anyway so we don't hang apps waiting for this
            };

            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

            window.onYouTubeIframeAPIReady = () => {
                logger.log('✅ YouTube IFrame API Ready');
                isApiReady = true;
                resolve();
            };

            // Fallback if the script loads but callback doesn't fire
            setTimeout(() => {
                if (window.YT && window.YT.Player) {
                    isApiReady = true;
                } else {
                    logger.warn('⚠️ YouTube API timeout - likely blocked');
                }
                resolve(); // Always resolve to unblock main thread
            }, 3000);

        } catch (e) {
            logger.error('Failed to inject YouTube API:', e);
            resolve();
        }
    });
}

/**
 * Inject Styles for the Widget (Clean Refined Design)
 */
function injectWidgetStyles() {
    if (document.getElementById('radio-widget-styles')) return;

    const style = document.createElement('style');
    style.id = 'radio-widget-styles';
    style.textContent = `
        /* Widget Container */
        #jdk-radio-widget {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 4000; /* Below modals (5000) and nav (9999) */
            font-family: 'Plus Jakarta Sans', sans-serif;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 10px;
            pointer-events: none; /* Critical: Don't block clicks on elements behind the container */
        }

        /* Floating Toggle Button */
        #radio-toggle-btn {
            width: 60px;
            height: 60px;
            background: #FACC15;
            border: 3px solid #000;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 6px 6px 0px #000;
            transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            pointer-events: auto; /* Re-enable clicks for the button */
        }

        #radio-toggle-btn:hover {
            transform: scale(1.1) rotate(-5deg);
        }

        #radio-toggle-btn:active {
            transform: scale(0.95);
            box-shadow: 2px 2px 0px #000;
        }

        /* Widget Panel */
        #radio-panel {
            background: #fff;
            width: 350px;
            max-width: 90vw;
            border: 3px solid #000;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 8px 8px 0px rgba(0,0,0,0.5);
            transform-origin: bottom right;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            opacity: 0;
            transform: scale(0.8) translateY(20px);
            pointer-events: none;
            display: flex;
            flex-direction: column;
            max-height: 80vh;
        }

        #radio-panel.active {
            opacity: 1;
            transform: scale(1) translateY(0);
            pointer-events: auto; /* Re-enable clicks for the panel when active */
        }

        /* Header */
        .widget-header {
            background: #000;
            color: #fff;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .widget-title {
            font-family: 'Bangers', cursive;
            text-transform: uppercase;
            font-size: 1.25rem;
            letter-spacing: 1px;
            color: #FACC15;
        }

        /* Content Area */
        .widget-content {
            overflow-y: auto;
            max-height: 500px;
        }

        /* Tabs */
        .widget-tabs {
            display: flex;
            border-bottom: 2px solid #000;
            background: #f3f4f6;
        }

        .widget-tab {
            flex: 1;
            padding: 10px;
            text-align: center;
            font-weight: 800;
            text-transform: uppercase;
            font-size: 0.8rem;
            cursor: pointer;
            border-bottom: 3px solid transparent;
            color: #6b7280;
            transition: all 0.2s;
        }

        .widget-tab.active {
            background: #fff;
            color: #000;
            border-bottom: 3px solid #FACC15;
        }

        .tab-content {
            display: none;
            padding: 16px;
        }

        .tab-content.active {
            display: block;
        }

        /* YouTube Player Container - Standard Visible */
        .yt-player-container {
            background: #000;
            border-radius: 12px;
            padding: 2px;
            margin-bottom: 12px;
            aspect-ratio: 16 / 9;
            width: 100%;
            overflow: hidden;
        }

        /* Power Button */
        .power-button {
            background: #FACC15;
            color: #000;
            border: 2px solid #000;
            padding: 10px 16px;
            font-weight: 800;
            font-size: 0.85rem;
            cursor: pointer;
            border-radius: 8px;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            text-transform: uppercase;
            width: 100%;
            margin-bottom: 12px;
        }

        .power-button:hover {
            background: #ffd700;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }

        .power-button.muted {
            background: #6b7280;
            color: #fff;
            border-color: #4b5563;
        }

        /* Queue List */
        .mini-queue-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px;
            border-bottom: 1px solid #e5e7eb;
            font-size: 0.85rem;
        }
        
        .mini-queue-item:last-child {
            border-bottom: none;
        }

        /* Form Elements */
        .widget-input {
            width: 100%;
            padding: 8px 12px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .widget-input:focus {
            outline: none;
            border-color: #000;
            background: #fffbeb;
        }

        .widget-btn {
            width: 100%;
            background: #000;
            color: #FACC15;
            font-weight: 800;
            text-transform: uppercase;
            padding: 10px;
            border-radius: 8px;
            margin-top: 8px;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
        }
        
        .widget-btn:hover {
            background: #333;
        }

        /* Scrollbar */
        .widget-content::-webkit-scrollbar {
            width: 6px;
        }
        .widget-content::-webkit-scrollbar-track {
            background: #f1f1f1;
        }
        .widget-content::-webkit-scrollbar-thumb {
            background: #d1d5db;
            border-radius: 3px;
        }
        
        /* Mobile */
        @media (max-width: 640px) {
            #jdk-radio-widget {
                bottom: 100px !important;
                right: 15px;
            }
            #radio-panel {
                width: calc(100vw - 30px);
                bottom: 70px; /* Distance from toggle button */
            }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Inject HTML Structure
 */
function injectWidgetHTML() {
    // Check if already injected to prevent duplicate IDs
    if (document.getElementById('jdk-radio-widget')) {
        logger.log('📻 Radio Widget already in DOM, skipping injection');
        return;
    }

    const container = document.createElement('div');
    container.id = 'jdk-radio-widget';

    container.innerHTML = `
        <!-- Main Panel -->
        <div id="radio-panel">
            <!-- Header -->
            <div class="widget-header">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined">radio</span>
                    <span class="widget-title">JDK RADIO</span>
                </div>
                <div style="background: #ef4444; color: #fff; font-size: 10px; text-transform: uppercase; font-weight: 800; padding: 4px 10px; border-radius: 12px; animation: pulse 2s ease infinite;">
                    ● LIVE
                </div>
            </div>

            <!-- Tabs -->
            <div class="widget-tabs">
                <div class="widget-tab active" data-tab="player">▶ PLAYER</div>
                <div class="widget-tab" data-tab="request">🎵 REQUEST</div>
            </div>

            <!-- Tab: Player -->
            <div id="tab-player" class="tab-content active widget-content">
                <!-- YouTube Player -->
                <div class="yt-player-container">
                    <div id="widget-yt-player"></div>
                </div>

                <!-- Power Button -->
                <button class="power-button muted" id="widget-power-btn">
                    <span class="material-symbols-outlined">volume_off</span>
                    <span>POWER ON</span>
                </button>

                <!-- Now Playing Info -->
                <div style="text-align: center; margin-bottom: 16px; padding: 12px; background: #FFFBEB; border: 2px solid #FACC15; border-radius: 12px;">
                    <div id="widget-song-title" style="font-weight: 900; font-size: 14px; text-transform: uppercase; color: #000; margin-bottom: 4px; line-height: 1.2;">
                        NO SONG PLAYING
                    </div>
                    <div id="widget-requester" style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #666;">
                        Requested by: -
                    </div>
                    <div id="widget-message-box" style="display: none; margin-top: 8px; font-size: 10px; font-style: italic; color: #444; border-top: 1px dashed #FACC15; pt-2;">
                    </div>
                </div>

                <!-- Up Next / Queue -->
                <div style="border-top: 4px solid #000; padding-top: 12px;">
                    <h4 style="font-weight: 800; font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 10px;">⏭️ UP NEXT</h4>
                    <div id="widget-queue-list">
                        <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">No songs in queue</div>
                    </div>
                </div>
            </div>

            <!-- Tab: Request -->
            <div id="tab-request" class="tab-content widget-content">
                <form id="widget-request-form">
                    <div class="space-y-3">
                        <div>
                            <label class="text-[10px] font-bold uppercase text-gray-500 block mb-1">YouTube URL</label>
                            <input type="url" id="w-youtube-url" placeholder="Paste YouTube Link..." required class="widget-input">
                        </div>
                        <div>
                            <label class="text-[10px] font-bold uppercase text-gray-500 block mb-1">Song Title</label>
                            <input type="text" id="w-song-title" placeholder="Enter song title" required class="widget-input">
                        </div>
                        <div>
                            <div class="flex justify-between">
                                <label class="text-[10px] font-bold uppercase text-gray-500 block mb-1">Message (Optional)</label>
                                <span id="w-char-count" class="text-[10px] text-gray-400">0/100</span>
                            </div>
                            <textarea id="w-message" rows="2" maxlength="100" placeholder="Type a message..." class="widget-input resize-none"></textarea>
                        </div>
                        
                        <div class="flex justify-between items-center bg-yellow-50 p-2 rounded border border-yellow-200 text-black">
                            <span class="text-[10px] font-bold uppercase">Cost</span>
                            <span class="font-black text-sm" id="w-point-cost">500 PTS</span>
                        </div>

                        <button type="submit" id="w-submit-btn" class="widget-btn">
                            🚀 Submit Request
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Toggle Button -->
        <div id="radio-toggle-btn">
            <span class="material-symbols-outlined" style="font-size: 36px; font-weight: 800;">music_note</span>
        </div>
    `;

    const radioContainer = document.getElementById('jdk-radio-container');
    if (radioContainer) {
        radioContainer.appendChild(container);
    } else {
        document.body.appendChild(container);
    }
}

/**
 * Attach Event Listeners
 */
function attachWidgetListeners() {
    // Toggle Button
    const toggleBtn = document.getElementById('radio-toggle-btn');
    const panel = document.getElementById('radio-panel');
    const icon = toggleBtn.querySelector('span');

    toggleBtn.addEventListener('click', () => {
        const isOpen = panel.classList.contains('active');
        if (isOpen) {
            panel.classList.remove('active');
            icon.textContent = 'music_note';
        } else {
            panel.classList.add('active');
            icon.textContent = 'close';
            loadWidgetQueue(); // Refresh queue when opened
        }
    });

    // Power Button
    const powerBtn = document.getElementById('widget-power-btn');
    powerBtn.addEventListener('click', togglePower);

    // Tab Switching
    const tabs = document.querySelectorAll('.widget-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.widget-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const targetId = `tab-${tab.dataset.tab}`;
            document.getElementById(targetId).classList.add('active');
        });
    });

    // Character Counter
    const msgInput = document.getElementById('w-message');
    msgInput.addEventListener('input', () => {
        const len = msgInput.value.length;
        const counter = document.getElementById('w-char-count');
        if (counter) counter.textContent = `${len}/100`;
    });

    // YouTube URL Auto-Fetch Metadata
    const urlInput = document.getElementById('w-youtube-url');
    if (urlInput) {
        urlInput.addEventListener('input', debounce(async (e) => {
            const url = e.target.value.trim();
            if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
                await fetchYouTubeMetadata(url);
            }
        }, 800));
    }

    // Submit Form
    const form = document.getElementById('widget-request-form');
    if (form) form.addEventListener('submit', handleWidgetSubmit);
}

/**
 * Debounce helper
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Fetch YouTube Metadata via oEmbed
 */
async function fetchYouTubeMetadata(url) {
    const titleInput = document.getElementById('w-song-title');
    if (!titleInput) return;

    // Don't overwrite if manual title already entered? 
    // Actually user might want auto-fill after paste.

    titleInput.placeholder = 'Fetching title...';

    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const response = await fetch(oembedUrl);
        if (response.ok) {
            const data = await response.json();
            if (data && data.title) {
                titleInput.value = data.title;
            }
        }
    } catch (err) {
        logger.error('Metadata fetch error:', err);
    } finally {
        titleInput.placeholder = 'Enter song title';
    }
}

/**
 * Toggle Power (Mute/Unmute)
 */
function togglePower() {
    isMuted = !isMuted;
    const btn = document.getElementById('widget-power-btn');
    if (!btn) return;

    if (isMuted) {
        btn.classList.add('muted');
        btn.innerHTML = '<span class="material-symbols-outlined">volume_off</span><span>POWER ON</span>';
        if (playerInstance && playerInstance.mute) playerInstance.mute();
    } else {
        btn.classList.remove('muted');
        btn.innerHTML = '<span class="material-symbols-outlined">volume_up</span><span>ON AIR</span>';
        if (playerInstance && playerInstance.unMute) {
            playerInstance.unMute();
            playerInstance.playVideo(); // Ensure playback starts on unmute
        }
    }
}

/**
 * Handle Form Submission
 */
async function handleWidgetSubmit(e) {
    e.preventDefault();

    const user = getCurrentUser();
    if (!user) {
        showNotification('Please login first!', 'warning');
        if (window.openLoginModal) window.openLoginModal();
        return;
    }

    const btn = document.getElementById('w-submit-btn');
    const originalText = btn.textContent;
    btn.textContent = 'SENDING...';
    btn.disabled = true;

    try {
        const { data, error } = await sbClient.rpc('process_youtube_request', {
            p_user_id: user.id,
            p_youtube_url: document.getElementById('w-youtube-url').value,
            p_title: document.getElementById('w-song-title').value,
            p_message: document.getElementById('w-message').value || null
        });

        if (error) throw error;

        if (data.success) {
            showNotification('✅ Song queued!');
            e.target.reset();
            document.querySelector('[data-tab="player"]').click();
            loadWidgetQueue();
        } else {
            showNotification(data.error || 'Failed to submit', 'error');
        }
    } catch (err) {
        logger.error(err);
        showNotification('System error', 'error');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

/**
 * Load Now Playing Data
 */
async function loadWidgetNowPlaying() {
    try {
        const { data } = await sbClient.rpc('get_now_playing');

        if (data && data.length > 0) {
            const song = data[0];
            currentSongId = song.id;

            // Update UI
            document.getElementById('widget-song-title').textContent = song.title || 'Untitled Song';
            document.getElementById('widget-requester').textContent =
                `Requested by: ${song.requester_name || 'Anonymous'}`;

            // Update Message
            const msgBox = document.getElementById('widget-message-box');
            if (song.message) {
                msgBox.textContent = `💬 "${song.message}"`;
                msgBox.style.display = 'block';
            } else {
                msgBox.style.display = 'none';
            }

            // Render YouTube Player
            renderYouTubePlayer(song.youtube_url);
        } else {
            // Try to load next song if nothing is playing
            const { data: nextSong } = await sbClient.rpc('get_next_song');
            if (nextSong && nextSong.length > 0) {
                const song = nextSong[0];
                await sbClient.rpc('mark_song_played', { p_song_id: song.id });
                loadWidgetNowPlaying(); // Recursive call to load the newly played song
            }
        }
    } catch (e) {
        logger.error('Widget error:', e);
    }
}

/**
 * Helper to extract YouTube ID
 */
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

/**
 * Render YouTube Player with Native API
 */
function renderYouTubePlayer(youtubeUrl, retryCount = 0) {
    const container = document.getElementById('widget-yt-player');
    if (!container) return;

    if (!isApiReady || !window.YT) {
        if (retryCount >= 10) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #ef4444; font-size: 11px;">⚠️ Failed to load API</div>';
            return;
        }
        setTimeout(() => renderYouTubePlayer(youtubeUrl, retryCount + 1), 500);
        return;
    }

    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
        logger.error('📻 Invalid YouTube ID:', youtubeUrl);
        handleSongEnd();
        return;
    }

    // Check if player already exists
    if (playerInstance && playerInstance.loadVideoById) {
        const lastUrl = container.getAttribute('data-last-url');
        if (lastUrl !== youtubeUrl) {
            logger.log('📻 Loading new video:', videoId);
            playerInstance.loadVideoById(videoId);
            container.setAttribute('data-last-url', youtubeUrl);
        }
        return;
    }

    logger.log('📻 Initializing Native YouTube Player for:', videoId);

    // Clear container to ensure clean start (YT API replaces the element)
    container.innerHTML = '<div id="yt-iframe-placeholder"></div>';

    playerInstance = new window.YT.Player('yt-iframe-placeholder', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'autoplay': 1,
            'controls': 0,
            'modestbranding': 1,
            'rel': 0,
            'origin': window.location.origin
        },
        events: {
            'onReady': (event) => {
                logger.log('✅ Player Ready');
                if (isMuted) event.target.mute();
                else event.target.unMute();
                event.target.playVideo();
            },
            'onStateChange': (event) => {
                // YT.PlayerState.ENDED = 0
                if (event.data === 0) {
                    handleSongEnd();
                }
            },
            'onError': (error) => {
                logger.error('📻 Player Error:', error);
                handleSongEnd();
            }
        }
    });

    container.setAttribute('data-last-url', youtubeUrl);
}

/**
 * Handle Song End
 */
async function handleSongEnd() {
    logger.log('Song ended, loading next...');
    await loadWidgetNowPlaying();
    await loadWidgetQueue();
}

/**
 * Load Radio Settings (Point Cost)
 */
async function loadWidgetSettings() {
    try {
        const { data } = await sbClient
            .from('system_settings')
            .select('radio_point_cost')
            .eq('id', 1)
            .single();

        if (data) {
            widgetSettings.pointCost = parseInt(data.radio_point_cost) || 500;
        }

        document.getElementById('w-point-cost').textContent = `${widgetSettings.pointCost} PTS`;
    } catch (err) {
        logger.error('Failed to load settings:', err);
        document.getElementById('w-point-cost').textContent = '500 PTS';
    }
}

/**
 * Load Queue (Top 5)
 */
async function loadWidgetQueue() {
    try {
        const { data } = await sbClient.rpc('get_upcoming_queue', { p_limit: 5 });
        const container = document.getElementById('widget-queue-list');

        if (!data || data.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">No songs in queue</div>';
            return;
        }

        container.innerHTML = data.map((q, i) => `
            <div class="mini-queue-item">
                <span style="font-weight: 800; color: #FACC15;">#${i + 1}</span>
                <div style="flex: 1; overflow: hidden;">
                    <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700;">${q.title}</div>
                    <div style="font-size: 10px; color: #666;">Requested by ${q.requester_name}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        logger.error('Queue load error:', e);
    }
}

/**
 * Setup Realtime Subscription
 */
function setupWidgetSubscription() {
    sbClient
        .channel('radio-widget')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'radio_queue' }, () => {
            logger.log('📻 Radio update received!');
            loadWidgetNowPlaying();
            loadWidgetQueue();
        })
        .subscribe();
}
