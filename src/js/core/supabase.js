import { logger } from './logger.js';
/**
 * JDK Entertainment - Supabase Configuration
 * Single source of truth for Supabase client
 */

import { createClient } from '@supabase/supabase-js';

// Supabase Configuration
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate environment variables
if (!SUPABASE_URL || !SUPABASE_KEY) {
    logger.error('❌ Missing Supabase environment variables!');
    logger.error('VITE_SUPABASE_URL:', SUPABASE_URL ? '✓ Set' : '✗ Missing');
    logger.error('VITE_SUPABASE_ANON_KEY:', SUPABASE_KEY ? '✓ Set' : '✗ Missing');
} else {
    logger.log('✅ Supabase config loaded:', SUPABASE_URL);
}

// Create Supabase client (only if SDK is loaded)
const globalSupabase = typeof window !== 'undefined' && window.supabase;

export const sbClient = globalSupabase
    ? globalSupabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : createClient(SUPABASE_URL, SUPABASE_KEY);

export { sbClient as supabase };

// Export for non-module usage
if (typeof window !== 'undefined') {
    window.sbClient = sbClient;
}
