import { logger } from '../core/logger.js';
/**
 * Gallery Service - Handle photo fetching via Edge Function
 * Uses Supabase Edge Function for secure Cloudinary access
 */

import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../core/supabase.js';

const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/cloudinary-fetch`;

/**
 * Fetch photos by event ID (Direct Supabase query)
 * @param {string} eventId - Event UUID
 * @returns {Promise<Array>} Array of photo objects
 */
export async function fetchPhotosByEvent(eventId) {
    try {
        const { data: photos, error } = await supabase
            .from('photo_discussions')
            .select('id, public_id, event_id, photo_url, thumbnail_url, caption, is_hidden, created_at, photo_comments(count)')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Transform to match expected format with optimized URL
        return photos.map(photo => ({
            ...photo,
            optimized_url: photo.photo_url,
            thumbnail_url: photo.thumbnail_url || photo.photo_url,
            comment_count: photo.photo_comments ? photo.photo_comments[0]?.count : 0
        }));
    } catch (error) {
        logger.error('Error fetching photos by event:', error);
        return [];
    }
}

/**
 * Fetch photos by Cloudinary tag (Direct Supabase query)
 * Note: This requires event lookup first
 * @param {string} tag - Gallery tag
 * @returns {Promise<Array>} Array of photo objects
 */
export async function fetchPhotosByTag(tag) {
    try {
        // Find event by gallery_tag
        const { data: event, error: eventError } = await supabase
            .from('events')
            .select('id')
            .eq('gallery_tag', tag)
            .single();

        if (eventError) throw eventError;
        if (!event) return [];

        // Fetch photos for that event
        return await fetchPhotosByEvent(event.id);
    } catch (error) {
        logger.error('Error fetching photos by tag:', error);
        return [];
    }
}

/**
 * Fetch all events with gallery tags
 * @returns {Promise<Array>} Array of events with gallery_tag
 */
export async function fetchEventsWithGallery() {
    try {
        const { data, error } = await supabase
            .from('events')
            .select(`
                id, 
                title, 
                date, 
                description,
                gallery_tag, 
                image_url,
                photo_discussions (id)
            `)
            .order('date', { ascending: false });

        if (error) throw error;

        // Add photo_count to each event object
        const eventsWithCount = (data || []).map(event => ({
            ...event,
            photo_count: event.photo_discussions ? event.photo_discussions.length : 0
        }));

        return eventsWithCount;
    } catch (error) {
        logger.error('Error fetching events with gallery:', error);
        return [];
    }
}

/**
 * Generate optimized Cloudinary URL (client-side)
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} options - Transformation options
 * @returns {string} Optimized URL
 */
export function generateOptimizedUrl(publicId, options = {}) {
    const {
        width = 800,
        quality = 'auto',
        format = 'auto',
        crop = 'scale',
    } = options;

    const cloudName = 'dcurlsei7';
    const transformations = `w_${width},c_${crop},f_${format},q_${quality}`;

    return `https://res.cloudinary.com/${cloudName}/image/upload/${transformations}/${publicId}`;
}

/**
 * Share photo using Web Share API or fallback
 * @param {string} photoUrl - URL of the photo
 * @param {string} caption - Photo caption
 * @returns {Promise<boolean>} Success status
 */
export async function sharePhoto(photoUrl, caption = '') {
    try {
        // Check if Web Share API is available
        if (navigator.share) {
            await navigator.share({
                title: 'JDK Gallery Photo',
                text: caption || 'Check out this photo from JDK Entertainment!',
                url: photoUrl,
            });
            return true;
        } else {
            // Fallback: Copy to clipboard
            await navigator.clipboard.writeText(photoUrl);
            return true;
        }
    } catch (error) {
        logger.error('Error sharing photo:', error);
        return false;
    }
}

/**
 * Update photo caption (Admin only)
 * @param {string} photoId - Photo discussion ID
 * @param {string} newCaption - Updated caption text
 * @returns {Promise<boolean>} Success status
 */
export async function updatePhotoCaption(photoId, newCaption) {
    try {
        const { error } = await supabase
            .from('photo_discussions')
            .update({
                caption: newCaption,
                updated_at: new Date().toISOString()
            })
            .eq('id', photoId);

        if (error) throw error;
        return true;
    } catch (error) {
        logger.error('Error updating photo caption:', error);
        throw error;
    }
}

/**
 * Delete photo (Admin only)
 * @param {string} photoId - Photo discussion ID
 * @returns {Promise<boolean>} Success status
 */
export async function deletePhoto(photoId) {
    try {
        const { error } = await supabase
            .from('photo_discussions')
            .delete()
            .eq('id', photoId);

        if (error) throw error;
        return true;
    } catch (error) {
        logger.error('Error deleting photo:', error);
        throw error;
    }
}

/**
 * Toggle photo visibility (Admin only)
 * @param {string} photoId - Photo discussion ID
 * @param {boolean} isHidden - Hide status
 * @returns {Promise<boolean>} Success status
 */
export async function togglePhotoVisibility(photoId, isHidden) {
    try {
        const { error } = await supabase
            .from('photo_discussions')
            .update({
                is_hidden: isHidden,
                updated_at: new Date().toISOString()
            })
            .eq('id', photoId);

        if (error) throw error;
        return true;
    } catch (error) {
        logger.error('Error toggling photo visibility:', error);
        throw error;
    }
}
