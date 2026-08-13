import { logger } from './logger.js';
/**
 * JDK Entertainment - Lightweight AJAX Router
 * Handles seamless page transitions to keep global widgets (like Radio) alive.
 */

export class Router {
    constructor(options = {}) {
        this.contentSelector = options.contentSelector || 'main';
        this.navLinksSelector = options.navLinksSelector || 'a:not([target="_blank"]):not([href^="http"]):not([href^="#"]):not([data-no-spa])';
        this.excludedPatterns = options.excludedPatterns || []; // NEW: list of regex or strings to exclude
        this.onPageLoad = options.onPageLoad || (() => { });
        this.onPageUnload = options.onPageUnload || (() => { }); // NEW: cleanup callback
        this.loadingIndicator = null;

        this.init();
    }

    init() {
        // Handle browser back/forward
        window.addEventListener('popstate', (e) => {
            this.loadPage(window.location.pathname + window.location.search, false);
        });

        // Intercept link clicks
        document.addEventListener('click', (e) => {
            const link = e.target.closest(this.navLinksSelector);
            if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                const href = link.getAttribute('href');

                // Final check: is it internal?
                if (href && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
                    // NEW: Check if this URL should be excluded from SPA
                    if (this.isExcluded(href)) {
                        logger.log(`🚀 Router - Path excluded, doing full reload: ${href}`);
                        return; // Let the browser handle it naturally
                    }

                    e.preventDefault();
                    this.loadPage(href);
                }
            }
        });

        logger.log('🚀 Router - Initialized');
    }

    async loadPage(url, pushState = true) {
        // Safety check for exclusion (e.g. from popstate)
        if (this.isExcluded(url)) {
            window.location.href = url;
            return;
        }

        logger.log(`🔗 Router - Navigating to: ${url}`);

        // Call cleanup callback BEFORE loading new content
        if (this.onPageUnload) {
            try {
                await this.onPageUnload(url);
            } catch (e) {
                logger.error('Router - onPageUnload error:', e);
            }
        }

        this.showLoading();

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 1. Update Title
            document.title = doc.title;

            // 2. Identify new content
            // We search for <main> first, then common containers, then fallback to everything between nav and footer
            let newContent = doc.querySelector(this.contentSelector);

            // If main not found, try to find the biggest container between nav and footer
            if (!newContent) {
                // Heuristic: Find first element after nav
                const nav = doc.querySelector('nav');
                if (nav && nav.nextElementSibling) {
                    newContent = nav.nextElementSibling;
                }
            }

            const currentContent = document.querySelector(this.contentSelector) ||
                (document.querySelector('nav') ? document.querySelector('nav').nextElementSibling : null);

            if (newContent && currentContent) {
                // Update body classes if needed (some pages might have specific classes)
                document.body.className = doc.body.className;

                // Sync all attributes from newContent to currentContent (classes, ids, etc.)
                // This is critical for layout-specific classes on <main>
                const newAttrs = Array.from(newContent.attributes);
                const currentAttrs = Array.from(currentContent.attributes);

                // Remove old attributes that aren't in the new element
                currentAttrs.forEach(attr => {
                    if (!newContent.hasAttribute(attr.name)) {
                        currentContent.removeAttribute(attr.name);
                    }
                });

                // Set new/updated attributes
                newAttrs.forEach(attr => {
                    currentContent.setAttribute(attr.name, attr.value);
                });

                // 2b. Sync Head Styles (Critical for Lobby/Marketplace per-page CSS)
                // FIRST: Remove old page-specific styles to prevent accumulation
                document.querySelectorAll('head style[data-page-style]').forEach(el => el.remove());

                // THEN: Add new page-specific styles
                const newStyles = doc.querySelectorAll('head style, head link[rel="stylesheet"]');
                newStyles.forEach(style => {
                    // Check if style already exists to avoid duplicates
                    const isLink = style.tagName === 'LINK';
                    const id = isLink ? style.href : style.innerHTML.substring(0, 100); // Simple heuristic ID
                    const selector = isLink ? `link[href="${style.href}"]` : `style[data-page-style]`;

                    // For inline styles, we check if the content already exists
                    let exists = false;
                    if (isLink) {
                        exists = !!document.head.querySelector(`link[href="${style.href}"]`);
                    } else {
                        // Check if any existing style has the same content
                        const existingStyles = document.head.querySelectorAll('style');
                        for (let s of existingStyles) {
                            if (s.innerHTML === style.innerHTML) {
                                exists = true;
                                break;
                            }
                        }
                    }

                    if (!exists) {
                        const styleClone = style.cloneNode(true);
                        if (!isLink) styleClone.setAttribute('data-page-style', 'true');
                        document.head.appendChild(styleClone);
                    }
                });

                // Swap main content
                currentContent.innerHTML = newContent.innerHTML;

                // 2e. Sync Footer Element (NEW FIX)
                // Some pages like lobby.html don't have footer, others like index.html do
                const newFooter = doc.querySelector('footer');
                const currentFooter = document.querySelector('footer');

                if (newFooter && !currentFooter) {
                    // New page has footer but current doesn't - add it
                    document.body.appendChild(newFooter.cloneNode(true));
                } else if (!newFooter && currentFooter) {
                    // New page doesn't have footer but current does - remove it  
                    currentFooter.remove();
                } else if (newFooter && currentFooter) {
                    // Both have footer - sync the content
                    currentFooter.className = newFooter.className;
                    currentFooter.innerHTML = newFooter.innerHTML;
                }

                // Sync Meta Description
                const newDesc = doc.querySelector('meta[name="description"]');
                const currDesc = document.querySelector('meta[name="description"]');
                if (newDesc && currDesc) currDesc.setAttribute('content', newDesc.getAttribute('content'));
                else if (newDesc) {
                    const meta = document.createElement('meta');
                    meta.name = 'description';
                    meta.content = newDesc.getAttribute('content');
                    document.head.appendChild(meta);
                }

                // 2c. Sync Canonical
                const newCan = doc.querySelector('link[rel="canonical"]');
                const currCan = document.querySelector('link[rel="canonical"]');
                if (newCan && currCan) currCan.setAttribute('href', newCan.getAttribute('href'));

                // 2d. Sync Open Graph & Twitter Tags
                const metaTags = [
                    'og:title', 'og:description', 'og:image', 'og:url', 'og:type',
                    'twitter:title', 'twitter:description', 'twitter:image', 'twitter:card'
                ];

                metaTags.forEach(tag => {
                    const isOG = tag.startsWith('og:');
                    const attrName = isOG ? 'property' : 'name';
                    const newVal = doc.querySelector(`meta[${attrName}="${tag}"]`);
                    let currVal = document.querySelector(`meta[${attrName}="${tag}"]`);

                    if (newVal) {
                        if (!currVal) {
                            currVal = document.createElement('meta');
                            currVal.setAttribute(attrName, tag);
                            document.head.appendChild(currVal);
                        }
                        currVal.setAttribute('content', newVal.getAttribute('content'));
                    } else if (currVal) {
                        currVal.remove();
                    }
                });

                // 3. Update URL
                if (pushState) {
                    window.history.pushState({}, '', url);
                }

                // 4. Scroll to top
                window.scrollTo(0, 0);

                // 5. Trigger lifecycle hook
                this.onPageLoad(url);
            } else {
                // Fallback: if we can't find content, do a full reload
                logger.warn('Router - Content selector not found, falling back to full reload');
                window.location.href = url;
            }
        } catch (error) {
            logger.error('Router - Navigation failed:', error);
            // Fallback to full reload on error
            window.location.href = url;
        } finally {
            this.hideLoading();
        }
    }

    showLoading() {
        if (!this.loadingIndicator) {
            this.loadingIndicator = document.createElement('div');
            this.loadingIndicator.id = 'page-loader';
            this.loadingIndicator.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 0%;
                height: 4px;
                background: #FACC15;
                z-index: 10000;
                transition: width 0.3s ease;
            `;
            document.body.appendChild(this.loadingIndicator);
        }

        // Start progress
        setTimeout(() => {
            if (this.loadingIndicator) this.loadingIndicator.style.width = '70%';
        }, 10);
    }

    hideLoading() {
        if (this.loadingIndicator) {
            this.loadingIndicator.style.width = '100%';
            setTimeout(() => {
                if (this.loadingIndicator) {
                    this.loadingIndicator.style.width = '0%';
                }
            }, 300);
        }
    }

    isExcluded(url) {
        if (!url) return false;
        // Normalize URL for check (remove leading slash if present for relative paths)
        const path = url.startsWith('/') ? url : `/${url}`;

        return this.excludedPatterns.some(pattern => {
            if (pattern instanceof RegExp) {
                return pattern.test(path);
            }
            return path.includes(pattern);
        });
    }
}
