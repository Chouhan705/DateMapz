// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Client } = require('@googlemaps/google-maps-services-js');

// --- INITIALIZATION ---
const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const mapsClient = new Client({});

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- FUNCTION CALLING DEFINITIONS ---
const createDateStopTool = {
    functionDeclarations: [{
        name: 'create_date_stop',
        description: 'Creates a single stop in the date itinerary.',
        parameters: {
            type: 'OBJECT',
            properties: {
                stopNumber: { type: 'NUMBER', description: 'The sequence number of the stop (1, 2, 3, etc.).' },
                name: { type: 'STRING', description: 'The name of the location.' },
                description: { type: 'STRING', description: 'A 2-sentence compelling description of the place and why it fits the vibe.' },
                address: { type: 'STRING', description: 'The full street address of the location.' },
                lat: { type: 'NUMBER', description: 'The latitude coordinate.' },
                lng: { type: 'NUMBER', description: 'The longitude coordinate.' },
                type: { type: 'STRING', description: 'The category of the location. Must be one of: Food, Cafe, Bar, Activity, Park, Shop.' },
                startTime: { type: 'STRING', description: 'The suggested start time for this stop (e.g., "18:00").' },
                duration: { type: 'STRING', description: 'The suggested duration for this stop (e.g., "1.5 hours").' },
            },
            required: ['stopNumber', 'name', 'description', 'address', 'lat', 'lng', 'type', 'startTime', 'duration'],
        },
    }],
};

const createTravelLegTool = {
    functionDeclarations: [{
        name: 'create_travel_leg',
        description: 'Creates a travel leg between two stops.',
        parameters: {
            type: 'OBJECT',
            properties: {
                fromStop: { type: 'NUMBER', description: 'The stop number this travel leg starts FROM (e.g., 1).' },
                toStop: { type: 'NUMBER', description: 'The stop number this travel leg goes TO (e.g., 2).' },
                transportMode: { type: 'STRING', description: 'The mode of transport for this leg (e.g., "Walking", "Auto-rickshaw").' },
                travelTime: { type: 'STRING', description: 'The estimated travel time for this leg (e.g., "15 minutes").' },
            },
            required: ['fromStop', 'toStop', 'transportMode', 'travelTime'],
        },
    }],
};

// --- HELPER FUNCTIONS ---

function getRadiusFromTransport(transportMode) {
    switch (transportMode.toLowerCase()) {
        case 'walking': return 2000;
        case 'transit': return 5000;
        case 'driving': return 10000;
        default: return 3000;
    }
}

function getKeywordFromVibe(dateVibe, isAdult) {
    const vibe = dateVibe.toLowerCase();
    if (isAdult) {
        switch (vibe) {
            case 'romantic': return 'romantic restaurant OR scenic viewpoint OR cocktail lounge OR wine bar';
            case 'adventurous': return 'axe throwing OR escape room OR rock climbing OR live music venue OR go karting';
            case 'artsy': return 'art gallery OR museum OR theatre OR live music venue OR comedy club';
            case 'foodie': return 'gourmet restaurant OR brewery OR distillery OR unique dining OR gastropub';
            case 'casual': return 'pub OR bar OR lounge OR beer garden OR sports bar';
            default: return 'bar OR lounge OR point of interest';
        }
    } else {
        switch (vibe) {
            case 'romantic': return 'romantic restaurant OR scenic viewpoint OR cozy cafe OR beautiful park';
            case 'adventurous': return 'adventure OR escape room OR rock climbing OR hiking trail OR outdoor activity OR go karting';
            case 'artsy': return 'art gallery OR museum OR public art OR sculpture OR theatre';
            case 'foodie': return 'gourmet restaurant OR food market OR unique dining OR top rated food';
            case 'casual': return 'cafe OR lounge OR park OR casual dining OR board game cafe';
            default: return 'point of interest';
        }
    }
}

function mapGoogleTypeToAppType(googleTypes = []) {
    if (googleTypes.includes('bar') || googleTypes.includes('night_club')) return 'Bar';
    if (googleTypes.includes('cafe')) return 'Cafe';
    if (googleTypes.includes('restaurant')) return 'Food';
    if (googleTypes.includes('park') || googleTypes.includes('tourist_attraction')) return 'Park';
    if (googleTypes.includes('book_store') || googleTypes.includes('clothing_store') || googleTypes.includes('store')) return 'Shop';
    if (googleTypes.includes('art_gallery') || googleTypes.includes('museum') || googleTypes.includes('bowling_alley') || googleTypes.includes('movie_theater') || googleTypes.includes('amusement_park')) return 'Activity';
    return 'Activity'; // Default fallback
}

async function performGoogleSearch(location, radius, keyword) {
    console.log(`- Performing search: radius=${radius}m, keyword='${keyword}'`);
    const params = {
        location,
        radius,
        keyword,
        key: process.env.GOOGLE_MAPS_API_KEY,
    };
    try {
        const response = await mapsClient.placesNearby({ params });
        return response.data.results.map(place => ({
            name: place.name,
            address: place.vicinity,
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng,
            type: mapGoogleTypeToAppType(place.types),
        }));
    } catch (error) {
        console.error(`Google Maps API Error for keyword "${keyword}":`, error.message);
        return [];
    }
}

async function findDateLocations(lat, lng, dateVibe, transportMode, isAdult) {
    const radius = getRadiusFromTransport(transportMode);
    const location = { lat, lng };
    const vibe = dateVibe.toLowerCase();

    // 1. Perform the VIBE-FIRST search.
    console.log("-> Performing VIBE-FIRST search...");
    const primaryKeyword = getKeywordFromVibe(vibe, isAdult);
    let primaryPlaces = await performGoogleSearch(location, radius, primaryKeyword);
    console.log(`-> Found ${primaryPlaces.length} primary vibe locations.`);
    
    const candidatePlaces = new Map();
    primaryPlaces.forEach(place => {
        if (place.address && !candidatePlaces.has(place.address)) {
            candidatePlaces.set(place.address, place);
        }
    });

    // 2. Check for sufficiency. ONLY run backups if needed.
    if (candidatePlaces.size < 6) {
        console.log("-> Primary search results are sparse. Running supplemental searches...");
        let backupSearches = [];

        // Add a food search unless the vibe was already foodie
        if (vibe !== 'foodie') {
            const foodKeyword = isAdult ? 'restaurant OR gastropub' : 'restaurant OR cafe';
            backupSearches.push(performGoogleSearch(location, radius, foodKeyword));
        }

        // Always add an ambiance search for variety
        const ambianceKeyword = isAdult ? 'lounge OR rooftop OR scenic' : 'park OR dessert OR scenic';
        backupSearches.push(performGoogleSearch(location, radius, ambianceKeyword));

        const backupResults = await Promise.all(backupSearches);
        backupResults.flat().forEach(place => {
            if (place.address && !candidatePlaces.has(place.address)) {
                candidatePlaces.set(place.address, place);
            }
        });
    }

    return Array.from(candidatePlaces.values()).slice(0, 20);
}

function constructItineraryPrompt(candidatePlaces, dateVibe, isAdult) {
    const placesString = JSON.stringify(candidatePlaces, null, 2);
    const ageInstruction = isAdult ? "The plan is for adults..." : "The plan MUST be all-ages...";

    return `
    You are a world-class, creative, and expert date planner. Your goal is to generate the best possible date itinerary by curating from a list of real, vetted locations.

    **CRITICAL RULE: You MUST choose all your locations ONLY from the "List of Potential Places" provided below. Do NOT invent your own generic places. You must use the actual names, addresses, and coordinates from the list.**

    **Core Philosophy:**
    -   **The Vibe is Key:** The user's desired vibe is "${dateVibe}". Your selections should strongly reflect this. You can use other places from the list to fill out the itinerary, but the core should match the vibe.
    -   **Audience:** ${ageInstruction}

    **Your Task & Rules:**
    1.  First, come up with a single, creative 'planTitle' for the entire date. This is the very first part of your text response.
    2.  Then, use the provided tools to build the itinerary step-by-step using ONLY places from the list below.
    3.  Call the 'create_date_stop' function for each stop in your ideal plan (typically 2-4 stops).
    4.  Call the 'create_travel_leg' function to define the journey BETWEEN each stop.

    **List of Potential Places:**
    ${placesString}
  `;
}

// --- API ROUTE ---
app.post('/api/generate-plan', async (req, res) => {
  try {
    const { location, dateVibe, transportMode, isAdult = false } = req.body;
    const { lat, lng } = location;

    if (!lat || !lng || !dateVibe || !transportMode) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    console.log("Stage 1: Finding real candidate places with PRIORITIZED search...");
    const candidatePlaces = await findDateLocations(lat, lng, dateVibe, transportMode, isAdult);
    if (candidatePlaces.length < 2) {
      throw new Error("Could not find enough suitable locations in the area to build a plan.");
    }
    console.log(`-> Found ${candidatePlaces.length} total real candidates.`);

    console.log("Stage 2: Calling AI to curate an itinerary from real places...");
    const systemInstruction = constructItineraryPrompt(candidatePlaces, dateVibe, isAdult);
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction,
        tools: [{ functionDeclarations: [createDateStopTool, createTravelLegTool] }],
    });
    
    const result = await model.generateContent("Please generate the best possible date plan from the provided list of locations.");
    
    console.log("Stage 3: Assembling final plan...");
    const functionCalls = result.response.functionCalls() || [];
    const stops = [];
    const travelLegs = [];
    for (const fn of functionCalls) {
        if (fn.name === 'create_date_stop') {
            stops.push(fn.args);
        } else if (fn.name === 'create_travel_leg') {
            travelLegs.push(fn.args);
        }
    }
    if (stops.length < 2) {
        throw new Error("AI failed to generate a valid plan from the locations.");
    }
    
    const planTitle = result.response.text().trim() || `A Great ${dateVibe} Date`;
    stops.sort((a, b) => a.stopNumber - b.stopNumber);

    const finalStops = stops.map(stop => {
        const leg = travelLegs.find(leg => leg.fromStop === stop.stopNumber);
        return { ...stop, travelToNext: leg ? { transportMode: leg.transportMode, travelTime: leg.travelTime } : null };
    });

    const finalPlan = {
        planTitle,
        stops: finalStops,
    };
    
    console.log("-> Successfully assembled curated date plan.");
    res.status(200).json(finalPlan);

  } catch (error) {
    console.error("Error in /api/generate-plan:", error);
    res.status(500).json({ error: error.message || 'An unexpected error occurred.' });
  }
});

// --- SERVER START ---
app.listen(PORT, () => {
  console.log(`AI Date Planner server listening on port ${PORT}`);
});