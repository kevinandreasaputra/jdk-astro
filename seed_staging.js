import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const STAGING_URL = 'https://evppqcuruqitriqcyolt.supabase.co';
const STAGING_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

if (!STAGING_KEY) {
    console.error("Missing VITE_SUPABASE_ANON_KEY in environment!");
    process.exit(1);
}

const stagingClient = createClient(STAGING_URL, STAGING_KEY);

async function seed() {
    console.log("Seeding test cards to Staging database...");

    const testProducts = [
        {
            name: "Pikachu",
            category: "SINGLES",
            game: "POKEMON",
            card_number: "009/SM-P",
            rarity: "Promo",
            barcode: "SM-P-009-JP",
            image_url: "https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2Fsm-p%2F009.png"
        },
        {
            name: "Brambleghast",
            category: "SINGLES",
            game: "POKEMON",
            card_number: "012/187",
            rarity: "Common",
            barcode: "SV8A-012-ID",
            image_url: "https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2Fsv8a%2F012.png"
        },
        {
            name: "Charizard ex",
            category: "SINGLES",
            game: "POKEMON",
            card_number: "201/165",
            rarity: "Special Illustration Rare",
            barcode: "SV2A-201-ID",
            image_url: "https://images.weserv.nl/?url=https%3A%2F%2Fasia.pokemon-card.com%2Fid%2Fcard-search%2Fdetail%2Fimages%2Fsv2a%2F201.png"
        }
    ];

    // Clear staging table entries for these specific barcodes first to prevent conflict
    const barcodes = testProducts.map(p => p.barcode);
    console.log("Cleaning up old test entries...");
    
    // Get existing product IDs for these barcodes
    const { data: existingProds } = await stagingClient
        .from('pm_products')
        .select('id, barcode')
        .in('barcode', barcodes);

    if (existingProds && existingProds.length > 0) {
        const ids = existingProds.map(p => p.id);
        // Clear inventory lots first
        await stagingClient.from('pm_inventory_lots').delete().in('product_id', ids);
        // Clear products
        await stagingClient.from('pm_products').delete().in('id', ids);
    }

    // Insert products
    console.log("Inserting products...");
    const { data: insertedProds, error: prodErr } = await stagingClient
        .from('pm_products')
        .insert(testProducts)
        .select();

    if (prodErr) {
        console.error("Error inserting products:", prodErr.message);
        return;
    }

    console.log(`Inserted ${insertedProds.length} products successfully.`);

    // Insert stock (inventory lots) for each product
    const inventoryLots = insertedProds.map(p => {
        let price = 10000;
        if (p.name.includes("Pikachu")) price = 75000;
        if (p.name.includes("Brambleghast")) price = 800;
        if (p.name.includes("Charizard")) price = 7300000;

        return {
            product_id: p.id,
            quantity_remaining: 5,
            selling_price: price
        };
    });

    console.log("Inserting inventory lots (stock & price)...");
    const { data: insertedLots, error: lotsErr } = await stagingClient
        .from('pm_inventory_lots')
        .insert(inventoryLots)
        .select();

    if (lotsErr) {
        console.error("Error inserting inventory lots:", lotsErr.message);
        return;
    }

    console.log(`Inserted ${insertedLots.length} inventory lots successfully.`);
    console.log("\nStaging seeding finished! You can now scan:");
    console.log("1. Pikachu (009/SM-P) -> Price: Rp 75.000");
    console.log("2. Brambleghast (012/187) -> Price: Rp 800");
    console.log("3. Charizard ex (201/165) -> Price: Rp 7.300.000");
}

seed();
