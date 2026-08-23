import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load local environment variables from .env
dotenv.config();

// Staging credentials reference
const STAGING_REF = process.env.VITE_SUPABASE_URL 
    ? process.env.VITE_SUPABASE_URL.split('.')[0].replace('https://', '').trim()
    : 'evppqcuruqitriqcyolt';

// Will be set dynamically during run
let SUPABASE_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_TOKEN || '';

// Execute raw SQL on Supabase Staging
async function executeSql(sql) {
    if (!SUPABASE_TOKEN) {
        throw new Error('Supabase Access Token is missing! Set SUPABASE_ACCESS_TOKEN environment variable or pass it as the 3rd command-line argument.');
    }
    const res = await fetch(`https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SUPABASE_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Supabase SQL query error: ${text}`);
    }
    return await res.json();
}

// Fetch helper with simple retry/backoff
async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            if (response.status === 429) {
                // Rate limited - wait and retry
                const waitTime = (i + 1) * 2000;
                console.log(`[Rate Limit] 429 received. Waiting ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
        } catch (e) {
            if (i === retries - 1) throw e;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

// English card importer (uses TCGdex API)
async function importEnglishCards(setCode) {
    const setLower = setCode.toLowerCase();
    const url = `https://api.tcgdex.net/v2/en/sets/${setLower}`;
    console.log(`Fetching English set details from TCGdex: ${url}...`);

    const res = await fetchWithRetry(url);
    const data = await res.json();

    if (!data.cards || data.cards.length === 0) {
        throw new Error(`No cards found for English set: ${setCode}`);
    }

    console.log(`Found ${data.cards.length} cards in English set ${data.name}. Fetching details...`);
    const cards = [];

    // Fetch individual card details from TCGdex in batches of 10
    const batchSize = 10;
    for (let i = 0; i < data.cards.length; i += batchSize) {
        const batch = data.cards.slice(i, i + batchSize);
        console.log(`Processing cards ${i + 1} to ${Math.min(i + batchSize, data.cards.length)}...`);
        
        await Promise.all(batch.map(async (c) => {
            try {
                const cardUrl = `https://api.tcgdex.net/v2/en/cards/${c.id}`;
                const cardRes = await fetchWithRetry(cardUrl);
                const detail = await cardRes.json();
                
                cards.push({
                    name: detail.name,
                    category: 'SINGLES',
                    game: 'POKEMON',
                    card_number: detail.localId || null,
                    rarity: detail.rarity || 'Common',
                    barcode: `${setCode.toUpperCase()}-${detail.localId || detail.id}-EN`,
                    image_url: detail.image ? `${detail.image}/high.png` : null
                });
            } catch (err) {
                console.error(`Failed to load card details for ${c.id}:`, err.message);
            }
        }));
        // Pause between batches to be polite
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    return cards;
}

// Japanese card importer (uses TCGdex API if available)
async function importJapaneseCards(setCode) {
    const setLower = setCode.toLowerCase();
    const url = `https://api.tcgdex.net/v2/ja/sets/${setLower}`;
    console.log(`Fetching Japanese set details from TCGdex: ${url}...`);

    const res = await fetchWithRetry(url);
    const data = await res.json();

    if (!data.cards || data.cards.length === 0) {
        throw new Error(`No cards found for Japanese set: ${setCode}`);
    }

    console.log(`Found ${data.cards.length} cards in Japanese set ${data.name}. Fetching details...`);
    const cards = [];

    const batchSize = 10;
    for (let i = 0; i < data.cards.length; i += batchSize) {
        const batch = data.cards.slice(i, i + batchSize);
        console.log(`Processing cards ${i + 1} to ${Math.min(i + batchSize, data.cards.length)}...`);
        
        await Promise.all(batch.map(async (c) => {
            try {
                const cardUrl = `https://api.tcgdex.net/v2/ja/cards/${c.id}`;
                const cardRes = await fetchWithRetry(cardUrl);
                const detail = await cardRes.json();
                
                cards.push({
                    name: detail.name,
                    category: 'SINGLES',
                    game: 'POKEMON',
                    card_number: detail.localId || null,
                    rarity: detail.rarity || 'Common',
                    barcode: `${setCode.toUpperCase()}-${detail.localId || detail.id}-JP`,
                    image_url: detail.image ? `${detail.image}/high.png` : null
                });
            } catch (err) {
                console.error(`Failed to load card details for ${c.id}:`, err.message);
            }
        }));
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    return cards;
}

// Indonesian card importer (scrapes official Trainer Website portal-pokemon)
async function importIndonesianCards(setCode) {
    const setUpper = setCode.toUpperCase();
    let pageNo = 1;
    let hasMorePages = true;
    const cardIds = new Set();

    console.log(`Scraping Indonesian cards from expansion: ${setUpper}...`);

    while (hasMorePages) {
        const searchUrl = `https://asia.pokemon-card.com/id/card-search/list/?pageNo=${pageNo}&expansionCodes=${setUpper}`;
        console.log(`Loading list page ${pageNo}: ${searchUrl}...`);

        const res = await fetchWithRetry(searchUrl);
        const html = await res.text();

        // Extract detail page IDs using regex
        const matches = [...html.matchAll(/\/id\/card-search\/detail\/(\d+)\//g)];
        if (matches.length === 0) {
            console.log(`No cards found on page ${pageNo}. Stopping search.`);
            hasMorePages = false;
            break;
        }

        const initialCount = cardIds.size;
        for (const m of matches) {
            cardIds.add(m[1]);
        }

        // If no new IDs added, we have reached the end/looping
        if (cardIds.size === initialCount) {
            console.log('No new cards detected on this page. Stopping.');
            hasMorePages = false;
            break;
        }

        console.log(`Found ${cardIds.size - initialCount} cards on page ${pageNo}. (Total collected: ${cardIds.size})`);
        pageNo++;
        await new Promise(resolve => setTimeout(resolve, 1000)); // Sleep between list pages
    }

    const cards = [];
    const idArray = Array.from(cardIds);
    console.log(`\nFound total ${idArray.length} unique cards. Scraping individual detail pages...`);

    const batchSize = 5;
    for (let i = 0; i < idArray.length; i += batchSize) {
        const batch = idArray.slice(i, i + batchSize);
        console.log(`Scraping card details ${i + 1} to ${Math.min(i + batchSize, idArray.length)}...`);

        await Promise.all(batch.map(async (id) => {
            try {
                const detailUrl = `https://asia.pokemon-card.com/id/card-search/detail/${id}/`;
                const detailRes = await fetchWithRetry(detailUrl);
                const detailHtml = await detailRes.text();

                // Regex parse card name
                const h1Match = detailHtml.match(/<h1 class="pageHeader cardDetail">([^]*?)<\/h1>/);
                let cardName = 'Unknown';
                if (h1Match) {
                    const rawHeader = h1Match[1];
                    const cleanedHeader = rawHeader.replace(/<span[^>]*>[^]*?<\/span>/gi, '');
                    cardName = cleanedHeader.replace(/<[^>]*>/g, '').trim();
                }
                cardName = cardName.replace(/\s+/g, ' '); // Clean duplicate spacing

                // Regex parse card number
                const numMatch = detailHtml.match(/<span class="collectorNumber">([^]*?)<\/span>/);
                const cardNumber = numMatch ? numMatch[1].replace(/<[^>]*>/g, '').trim() : null;

                // Regex parse image URL
                const imgMatch = detailHtml.match(/<div class="cardImage">[^]*?<img src="([^"]+)"/);
                let imgUrl = imgMatch ? imgMatch[1].trim() : null;
                if (imgUrl && imgUrl.startsWith('/')) {
                    imgUrl = `https://asia.pokemon-card.com${imgUrl}`;
                }

                // Clean name further (e.g. remove any leading/trailing weird character)
                if (cardName && cardNumber) {
                    cards.push({
                        name: cardName,
                        category: 'SINGLES',
                        game: 'POKEMON',
                        card_number: cardNumber,
                        rarity: 'Common', // Rarity text not easily scraped, default to Common
                        barcode: `${setUpper}-${cardNumber}-ID`,
                        image_url: imgUrl
                    });
                }
            } catch (err) {
                console.error(`Failed to scrape details for card ID ${id}:`, err.message);
            }
        }));

        await new Promise(resolve => setTimeout(resolve, 800)); // Pause between batches
    }

    return cards;
}

async function run() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node import_pokemon_cards.mjs <set_code> <language_code> [supabase_access_token]');
        console.log('Examples:');
        console.log('  node import_pokemon_cards.mjs SV8a id');
        console.log('  node import_pokemon_cards.mjs SV8a en sbp_xxxx...');
        process.exit(1);
    }

    const setCode = args[0].toUpperCase();
    const lang = args[1].toLowerCase();

    if (args[2]) {
        SUPABASE_TOKEN = args[2].trim();
    }

    if (!SUPABASE_TOKEN) {
        console.error('ERROR: Supabase Access Token is missing!');
        console.error('Please either:');
        console.error('  1. Add SUPABASE_ACCESS_TOKEN=sbp_xxxx... to your local .env file');
        console.error('  2. Pass it as the 3rd command line argument:');
        console.error('     node import_pokemon_cards.mjs ' + setCode + ' ' + lang + ' sbp_xxxx...');
        process.exit(1);
    }

    if (!['en', 'jp', 'id'].includes(lang)) {
        console.error('Invalid language! Use: en, jp, or id');
        process.exit(1);
    }

    console.log(`=== POKEMON TCG DB IMPORTER ===`);
    console.log(`Target Set: ${setCode}`);
    console.log(`Language  : ${lang.toUpperCase()}`);
    console.log(`================================\n`);

    let cards = [];
    if (lang === 'en') {
        cards = await importEnglishCards(setCode);
    } else if (lang === 'jp') {
        cards = await importJapaneseCards(setCode);
    } else if (lang === 'id') {
        cards = await importIndonesianCards(setCode);
    }

    console.log(`\nReady to upload ${cards.length} cards to Staging database...`);

    if (cards.length === 0) {
        console.log('No cards successfully processed. Exiting.');
        return;
    }

    // Deduplicate cards array by barcode to prevent PostgreSQL ON CONFLICT error
    const uniqueCardsMap = new Map();
    for (const card of cards) {
        uniqueCardsMap.set(card.barcode, card);
    }
    const uniqueCards = Array.from(uniqueCardsMap.values());
    console.log(`Deduplicated: ${cards.length} cards reduced to ${uniqueCards.length} unique barcodes.`);

    // Prepare batch SQL upsert
    // pm_products keys: name, category, game, card_number, rarity, barcode, image_url
    const valuesSql = uniqueCards.map(c => {
        const nameEscaped = c.name.replace(/'/g, "''");
        const rarityEscaped = c.rarity.replace(/'/g, "''");
        const cardNumEscaped = c.card_number ? `'${c.card_number.replace(/'/g, "''")}'` : 'NULL';
        const imgEscaped = c.image_url ? `'${c.image_url.replace(/'/g, "''")}'` : 'NULL';
        
        return `('${nameEscaped}', 'SINGLES', 'POKEMON', ${cardNumEscaped}, '${rarityEscaped}', '${c.barcode}', ${imgEscaped})`;
    }).join(',\n');

    const sqlQuery = `
        INSERT INTO public.pm_products (name, category, game, card_number, rarity, barcode, image_url)
        VALUES 
        ${valuesSql}
        ON CONFLICT (barcode) DO UPDATE 
        SET 
            name = EXCLUDED.name,
            card_number = EXCLUDED.card_number,
            rarity = EXCLUDED.rarity,
            image_url = EXCLUDED.image_url
        RETURNING id;
    `;

    console.log('Running database bulk upsert query...');
    try {
        const results = await executeSql(sqlQuery);
        console.log(`\nSUCCESS: Upserted ${results.length} cards into pm_products table!`);
    } catch (e) {
        console.error('Database insertion failed:', e.message);
    }
}

run();
