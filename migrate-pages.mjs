import fs from 'fs';
import path from 'path';

const srcDir = '../'; // Root folder containing html files
const destDir = './src/pages'; // Target folder for Astro pages

if (!fs.existsSync(destDir)){
    fs.mkdirSync(destDir, { recursive: true });
}

// Find all HTML files in srcDir (excluding jdk-astro or subdirectories)
const files = fs.readdirSync(srcDir).filter(file => file.endsWith('.html'));

files.forEach(file => {
    // Skip index.html since we migrated it manually
    if (file === 'index.html') return;

    const filePath = path.join(srcDir, file);
    let html = fs.readFileSync(filePath, 'utf8');

    // Fix imports in inline scripts: change relative root path ./js/ to ../js/
    html = html.replace(/(import\s+.*?from\s+['"])\.\/js\//g, '$1../js/');

    // 1. Get title and description
    let title = 'JDK Entertainment';
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    if (titleMatch) {
        title = titleMatch[1];
    }

    let description = 'Menghubungkan masa lalu dan masa kini melalui PopCulture, komunitas, retro arcade, dan marketplace vintage.';
    const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || 
                      html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"/i);
    if (descMatch) {
        description = descMatch[1];
    }

    // 2. Extract <main> content
    let mainContent = '';
    // Match <main ...> ... </main> including attributes
    const mainMatch = html.match(/<main([^>]*)>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
        const attributes = mainMatch[1];
        const innerContent = mainMatch[2];
        mainContent = `<main${attributes}>${innerContent}</main>`;
    } else {
        // Fallback: extract everything inside <body> except <nav> and <footer>
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            let bodyContent = bodyMatch[1];
            // Remove navigation
            bodyContent = bodyContent.replace(/<nav[\s\S]*?<\/nav>/gi, '');
            // Remove footer
            bodyContent = bodyContent.replace(/<footer[\s\S]*?<\/footer>/gi, '');
            mainContent = bodyContent;
        } else {
            console.log(`⚠️ Skip ${file} - Could not extract body/main content`);
            return;
        }
    }

    // 3. Extract <style> blocks
    let styleBlocks = [];
    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    while ((match = styleRegex.exec(html)) !== null) {
        styleBlocks.push(match[1]);
    }

    // 4. Extract structured data json-ld
    let scriptBlocks = [];
    const scriptRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
    while ((match = scriptRegex.exec(html)) !== null) {
        scriptBlocks.push(match[1]);
    }

    // 5. Replace links: href="xxxx.html" -> href="/xxxx" (or /admin_events, etc.)
    // Avoid changing absolute URLs
    mainContent = mainContent.replace(/href="(?!\/)([^"]+)\.html"/g, 'href="/$1"');
    mainContent = mainContent.replace(/href="\/([^"]+)\.html"/g, 'href="/$1"');

    // Strip out duplicate navs and footers that might be nested inside <main>
    mainContent = mainContent.replace(/<nav[\s\S]*?<\/nav>/gi, '');
    mainContent = mainContent.replace(/<footer[\s\S]*?<\/footer>/gi, '');

    // 6. Generate Astro code
    const escapedTitle = title.replace(/"/g, '&quot;');
    const escapedDesc = description.replace(/"/g, '&quot;');
    let astroContent = `---
import Layout from '../layouts/Layout.astro';
---

<Layout title="${escapedTitle}" description="${escapedDesc}">
    ${mainContent}
`;

    if (scriptBlocks.length > 0) {
        scriptBlocks.forEach(sb => {
            astroContent += `
    <script is:inline type="application/ld+json">
    ${sb}
    </script>`;
        });
    }

    astroContent += `\n</Layout>\n`;

    if (styleBlocks.length > 0) {
        astroContent += `\n<style is:global>\n${styleBlocks.join('\n')}\n</style>\n`;
    }

    // Output filename mapping
    const outFileName = file.replace('.html', '.astro');
    const outPath = path.join(destDir, outFileName);

    fs.writeFileSync(outPath, astroContent, 'utf8');
    console.log(`✅ Migrated ${file} -> ${outFileName}`);
});
