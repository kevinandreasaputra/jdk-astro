import { logger } from '../core/logger.js';
/**
 * Photo Discussion Service
 * Handles comments, likes, and realtime updates for gallery photos
 */

import { supabase } from '../core/supabase.js';

/**
 * Fetch discussion data (photo metadata, comments, likes)
 * @param {string} publicId - Cloudinary Public ID
 */
export async function fetchDiscussion(publicId) {
    // 1. Get Discussion Metadata (without join first to avoid PGRST200)
    const { data: discussion, error } = await supabase
        .from('photo_discussions')
        .select('*')
        .eq('public_id', publicId)
        .single();

    if (error) {
        if (error.code !== 'PGRST116') {
            logger.error('Error fetching discussion:', error);
            return { error };
        }
        return null; // Not found
    }

    if (!discussion) return null;

    // 2. Fetch Author Profile (Manual Join)
    let authorProfile = null;
    if (discussion.created_by) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', discussion.created_by)
            .single();
        authorProfile = profile;
    }

    // 3. Get Like Count
    const { count: likesCount } = await supabase
        .from('photo_likes')
        .select('*', { count: 'exact', head: true })
        .eq('discussion_id', discussion.id);

    // 4. Check if current user liked
    const { data: { user } } = await supabase.auth.getUser();
    let hasLiked = false;

    if (user) {
        const { data: likeData } = await supabase
            .from('photo_likes')
            .select('id')
            .eq('discussion_id', discussion.id)
            .eq('user_id', user.id)
            .single();
        hasLiked = !!likeData;
    }

    // 5. Fetch Comments
    const { data: comments, error: commentsError } = await supabase
        .from('photo_comments')
        .select(`
            id,
            parent_id,
            content,
            created_at,
            is_deleted,
            user:profiles(id, username, avatar_url, user_level)
        `)
        .eq('discussion_id', discussion.id)
        .order('created_at', { ascending: true });

    return {
        ...discussion,
        created_by: authorProfile, // Attach manually fetched profile
        likes_count: likesCount || 0,
        has_liked: hasLiked,
        comments: comments || []
    };
}

/**
 * Add a comment to a photo
 */
export async function addComment(discussionId, content, parentId = null) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Must be logged in to comment');

    const { data, error } = await supabase.functions.invoke('jdk-secure-handler', {
        body: {
            action: 'photoComment',
            discussion_id: discussionId,
            content: content,
            parent_id: parentId
        }
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.error || 'Failed to post comment');

    // The handler should return the inserted comment. We need to attach the user profile for the UI.
    const comment = data.data;

    // If user profile is missing in response, fetch it or construct it
    if (comment && !comment.user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, user_level')
            .eq('id', user.id)
            .single();
        comment.user = profile;
    }

    return comment;
}

/**
 * Toggle Like on a photo
 */
export async function toggleLike(discussionId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Must be logged in to like');

    const { data, error } = await supabase.functions.invoke('jdk-secure-handler', {
        body: { action: 'togglePhotoLike', discussion_id: discussionId }
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.error || 'Failed to toggle like');

    return data.liked;
}

/**
 * Soft Delete Comment
 */
export async function deleteComment(commentId) {
    const { data, error } = await supabase.functions.invoke('jdk-secure-handler', {
        body: { action: 'deletePhotoComment', comment_id: commentId }
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.error || 'Failed to delete comment');
}

/**
 * Subscribe to Realtime Updates
 */
export function subscribeToDiscussion(discussionId, callback) {
    return supabase
        .channel(`discussion:${discussionId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'photo_comments',
                filter: `discussion_id=eq.${discussionId}`
            },
            (payload) => {
                // Determine event type and pass to callback
                callback(payload);
            }
        )
        .subscribe();
}
