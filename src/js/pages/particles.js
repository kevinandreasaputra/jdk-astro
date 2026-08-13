import p5 from 'p5';

let p5Instance = null;

/**
 * Initialize retro particle effect using p5.js
 */
export function initializeRetroParticles() {
    if (p5Instance) {
        p5Instance.remove();
        p5Instance = null;
    }
    
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
 * Clean up retro particle effect
 */
export function cleanupRetroParticles() {
    if (p5Instance) {
        p5Instance.remove();
        p5Instance = null;
    }
}
