import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const STAGING_URL = 'https://evppqcuruqitriqcyolt.supabase.co';
const STAGING_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

const stagingClient = createClient(STAGING_URL, STAGING_KEY);

async function testRpc() {
    console.log("Testing RPC 'exec_sql' on Staging database...");
    
    // Try to run a simple query
    const { data, error } = await stagingClient.rpc('exec_sql', { 
        sql_query: 'SELECT NOW() as db_time;' 
    });

    if (error) {
        console.error("❌ RPC 'exec_sql' failed:", error.message);
    } else {
        console.log("✅ RPC 'exec_sql' is available! Result:", data);
    }
}

testRpc();
