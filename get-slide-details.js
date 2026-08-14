import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '/home/kevin/Downloads/folder/jdk-astro/.env' });

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL || 'https://vadcglyhrcuwnfenyzgk.supabase.co';
const supabaseKey = process.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseKey) {
    console.error('No Supabase Key found');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function getSlideDetails() {
    const { data, error } = await supabase
        .from('hero_sliders')
        .select('*')
        .eq('is_active', true)
        .order('order_index', { ascending: true });

    if (error) {
        console.error(error);
        return;
    }

    console.log(JSON.stringify(data, null, 2));
}

getSlideDetails();
