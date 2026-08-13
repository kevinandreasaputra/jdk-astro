import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const imagesDir = './public';

if (!fs.existsSync(imagesDir)) {
    console.error('❌ Public images directory not found!');
    process.exit(1);
}

// Find all PNG, JPG, JPEG files in public/images
const getFiles = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getFiles(filePath));
        } else {
            const ext = path.extname(file).toLowerCase();
            if (['.png', '.jpg', '.jpeg'].includes(ext)) {
                results.push(filePath);
            }
        }
    });
    return results;
};

const imageFiles = getFiles(imagesDir);

console.log(`🖼️ Found ${imageFiles.length} images to compress...\n`);

let totalSaved = 0;

for (const file of imageFiles) {
    const originalSize = fs.statSync(file).size;
    const ext = path.extname(file).toLowerCase();
    
    try {
        let sharpInstance = sharp(file);
        let buffer;
        
        if (ext === '.png') {
            buffer = await sharpInstance
                .png({ quality: 80, compressionLevel: 9, effort: 10 })
                .toBuffer();
        } else if (['.jpg', '.jpeg'].includes(ext)) {
            buffer = await sharpInstance
                .jpeg({ quality: 80, mozjpeg: true })
                .toBuffer();
        }
        
        const newSize = buffer.length;
        
        if (newSize < originalSize) {
            fs.writeFileSync(file, buffer);
            const saved = originalSize - newSize;
            totalSaved += saved;
            const percentage = ((saved / originalSize) * 100).toFixed(1);
            console.log(`✅ Optimized ${path.basename(file)}: ${(originalSize / 1024).toFixed(1)}KB -> ${(newSize / 1024).toFixed(1)}KB (Saved ${percentage}%)`);
        } else {
            console.log(`ℹ️ Skipped ${path.basename(file)}: Already optimal`);
        }
    } catch (err) {
        console.error(`❌ Failed to compress ${path.basename(file)}:`, err.message);
    }
}

console.log(`\n🎉 Image compression complete! Total bandwidth saved: ${(totalSaved / (1024 * 1024)).toFixed(2)} MB`);
