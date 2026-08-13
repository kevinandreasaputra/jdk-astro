import { logger } from '../core/logger.js';
/**
 * JDK Entertainment - Certificate Logic
 * Fetches registration & event data to populate the e-certificate
 */

import { sbClient } from '../core/supabase.js';
import { showNotification } from '../core/utils.js';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const regId = urlParams.get('id');

    if (!regId) {
        showNotification('ID Sertifikat tidak ditemukan.');
        setTimeout(() => window.location.href = '/profile.html', 3000);
        return;
    }

    try {
        await loadCertificateData(regId);
    } catch (error) {
        logger.error('Certificate Load Error:', error);
        showNotification('Gagal memuat sertifikat: ' + error.message);
    } finally {
        document.getElementById('loading-overlay').style.display = 'none';
    }

    // Setup Download Buttons
    const btnPng = document.getElementById('download-btn');
    if (btnPng) btnPng.addEventListener('click', () => downloadCertificate('png'));

    const btnPdf = document.getElementById('download-pdf-btn');
    if (btnPdf) btnPdf.addEventListener('click', () => downloadCertificate('pdf'));

});

/**
 * Load data from Supabase and update DOM
 */
async function loadCertificateData(regId) {
    // 1. Check Auth (Optional but recommended)
    const { data: { user } } = await sbClient.auth.getUser();

    // 2. Fetch Registration details with Event join
    const { data: reg, error } = await sbClient
        .from('event_registrations')
        .select(`
            id,
            full_name,
            status,
            attended_at,
            events (
                title,
                date,
                cert_title,
                cert_body,
                cert_signer_name,
                cert_signer_role,
                cert_bg_url
            )
        `)
        .eq('id', regId)
        .single();

    if (error || !reg) {
        throw new Error('Sertifikat tidak valid atau tidak ditemukan.');
    }

    // 3. Status Verification: Only 'attended' users get certificates
    if (reg.status !== 'attended') {
        throw new Error('Sertifikat belum tersedia. Pastikan Anda telah melakukan absensi di lokasi event.');
    }

    const event = reg.events;

    // 4. Update UI - MATCHING NEW PROFESSIONAL STRUCTURE

    // Title
    const titleEl = document.getElementById('display-title');
    if (titleEl) {
        titleEl.textContent = event.cert_title ?? 'CERTIFICATE OF APPRECIATION';
    }

    // Recipient Name (Center Prominent)
    const nameMainEl = document.getElementById('display-fullname-main');
    if (nameMainEl) nameMainEl.textContent = reg.full_name;

    // Signer
    const signerEl = document.getElementById('display-signer');
    if (signerEl) signerEl.textContent = event.cert_signer_name || 'JDK Administration';

    const roleEl = document.getElementById('display-role');
    if (roleEl) roleEl.textContent = event.cert_signer_role || 'Event Organizer';

    // Body with Replacements
    let bodyText = event.cert_body || 'Sebagai apresiasi atas partisipasi [NAME] dalam event [EVENT].';

    const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    const dateStr = reg.attended_at
        ? new Date(reg.attended_at).toLocaleDateString('id-ID', dateOptions)
        : new Date(event.date).toLocaleDateString('id-ID', dateOptions);

    // Apply Replacements
    // Use inline styles to ensure html2canvas captures them correctly
    bodyText = bodyText.replace(/\[NAME\]/g, `<span style="font-weight: 800; font-style: italic; color: #000;">${reg.full_name}</span>`);
    bodyText = bodyText.replace(/\[EVENT\]/g, `<span style="font-weight: 800; font-style: italic; color: #000;">${event.title}</span>`);
    bodyText = bodyText.replace(/\[DATE\]/g, `<span style="font-weight: 800; color: #000;">${dateStr}</span>`);

    const bodyEl = document.getElementById('display-body');
    if (bodyEl) bodyEl.innerHTML = bodyText;

    // Metadata for Filename
    const nameMeta = document.getElementById('display-name');
    if (nameMeta) nameMeta.textContent = reg.full_name;

    // Optional Background
    if (event.cert_bg_url) {
        const certContainer = document.getElementById('certificate-content');

        // Check if PDF
        if (event.cert_bg_url.toLowerCase().endsWith('.pdf')) {
            try {
                if (window.pdfjsLib) {
                    const loadingTask = pdfjsLib.getDocument(event.cert_bg_url);
                    const pdf = await loadingTask.promise;
                    const page = await pdf.getPage(1);

                    // High quality render
                    const viewport = page.getViewport({ scale: 2.5 });

                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({ canvasContext: context, viewport: viewport }).promise;

                    certContainer.style.backgroundImage = `url(${canvas.toDataURL('image/png', 1.0)})`;
                }
            } catch (e) {
                logger.error('Failed to render PDF background:', e);
            }
        } else {
            // Image
            certContainer.style.backgroundImage = `url(${event.cert_bg_url})`;
        }
    }
}



/**
 * Capture certificate as image and download as PNG or PDF
 * @param {string} type - 'png' or 'pdf'
 */
async function downloadCertificate(type = 'png') {
    const btn = type === 'png' ? document.getElementById('download-btn') : document.getElementById('download-pdf-btn');
    const originalText = btn.innerHTML;

    try {
        btn.disabled = true;
        btn.innerHTML = 'Generating...';

        const certificate = document.getElementById('certificate-content');

        // Capture with html2canvas
        // High scale for better PDF quality
        const scale = type === 'pdf' ? 3 : 2;

        const canvas = await html2canvas(certificate, {
            scale: scale,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            // Fix for mobile: Reset scale transform in clone
            windowWidth: 1400,
            windowHeight: 1000,
            onclone: (clonedDoc) => {
                const wrapper = clonedDoc.getElementById('certificate-wrapper');
                const content = clonedDoc.getElementById('certificate-content');
                if (wrapper) {
                    wrapper.style.scale = '1';
                    wrapper.style.transform = 'none';
                    wrapper.style.margin = '0 auto';
                    wrapper.style.marginTop = '0px';
                }
                if (content) {
                    // Ensure content is visible and centered
                    content.style.transform = 'none';
                    content.style.margin = '0';
                }
            }
        });

        const fileName = `Certificate_JDK_${document.getElementById('display-name').textContent.replace(/\s+/g, '_')}`;

        if (type === 'png') {
            const image = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = image;
            link.download = `${fileName}.png`;
            link.click();
            showNotification('Sertifikat (PNG) berhasil diunduh!');
        } else if (type === 'pdf') {
            // A4 Landscape: 297mm x 210mm
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('l', 'mm', 'a4');

            const imgData = canvas.toDataURL('image/png');

            // Calculate dimensions to fit A4 Landscape
            const pdfWidth = 297;
            const pdfHeight = 210;

            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`${fileName}.pdf`);
            showNotification('Sertifikat (PDF) berhasil diunduh!');
        }

    } catch (err) {
        logger.error('Download error:', err);
        showNotification('Gagal mengunduh sertifikat.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

