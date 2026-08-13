/**
 * JDK Entertainment - Animations Component
 * Handles scroll reveal and counter animations
 */

/**
 * Initialize all animations
 */
export function initializeAnimations() {
    initializeScrollReveal();
    initializeCounters();
}

/**
 * Initialize scroll reveal animation
 */
function initializeScrollReveal() {
    const revealElements = document.querySelectorAll('.reveal');

    if (revealElements.length === 0) return;

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    revealElements.forEach(element => {
        revealObserver.observe(element);
    });
}

/**
 * Initialize counter animations
 */
function initializeCounters() {
    const statsNumbers = document.querySelectorAll('.stats-number');
    statsNumbers.forEach(stat => {
        const target = parseInt(stat.dataset.target);
        if (!isNaN(target)) {
            animateCounter(stat, target);
        }
    });
}

/**
 * Animate a counter element
 * @param {HTMLElement} element - The element to animate
 * @param {number} target - The target number
 */
export function animateCounter(element, target) {
    let current = 0;
    const increment = target / 100;
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        element.textContent = Math.floor(current);
    }, 20);
}

// Expose to window for global access
if (typeof window !== 'undefined') {
    window.initializeAnimations = initializeAnimations;
    window.animateCounter = animateCounter;
}
