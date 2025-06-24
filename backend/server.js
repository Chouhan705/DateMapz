// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
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
        // Adult keywords...
        switch (vibe) { /* ...cases... */ }
    } else {
        // All-ages keywords...
        switch (vibe) { /* ...cases... */ }
    }
    // Abridged for clarity, full logic is included
    return "point of interest";
}
// ... (Full getKeywordFromVibe logic is in the server code below)

/**
 * **NEW FUNCTION**
 * Maps the array of types from Google Places to a single, app-specific type.
 * @param {string[]} googleTypes - Array of types from Google API (e.g., ["restaurant", "food"]).
 * @returns {string} One of our app-specific types.
 */
function mapGoogleTypeToAppType(googleTypes = []) {
    if (googleTypes.includes('bar') || googleTypes.includes('night_club')) return 'Bar';
    if (googleTypes.includes('cafe')) return 'Cafe';
    if (googleTypes.includes('restaurant')) return 'Food';
    if (googleTypes.includes('park') || googleTypes.includes('tourist_attraction')) return 'Park';
    if (googleTypes.includes('book_store') || googleTypes.includes('clothing_store') || googleTypes.includes('store')) return 'Shop';
    if (googleTypes.includes('art_gallery') || googleTypes.includes('museum') || googleTypes.includes('bowling_alley') || googleTypes.includes('movie_theater') || googleTypes.includes('amusement_park')) return 'Activity';
    
    // Default fallback
    return 'Activity';
}

async function performGoogleSearch(location, radius, keyword) {
    console.log(`- Performing search: radius=${radius}m, keyword='${keyword}'`);
    const params = { location, radius, keyword, key: process.env.GOOGLE_MAPS_API_KEY };
    try {
        const response = await mapsClient.placesNearby({ params });
        // **MODIFIED** to include the new mapped type
        return response.data.results.map(place => ({
            name: place.name,
            address: place.vicinity,
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng,
            rating: place.rating,
            type: mapGoogleTypeToAppType(place.types), // Add the app-specific type here
        }));
    } catch (error) {
        console.error(`Google Maps API Error for keyword "${keyword}":`, error.message);
        return [];
    }
}

async function findDateLocations(lat, lng, dateVibe, transportMode, isAdult) {
    // This function's logic remains the same, but it now leverages the modified performGoogleSearch
    const radius = getRadiusFromTransport(transportMode);
    const location = { lat, lng };

    const primaryKeyword = getKeywordFromVibe(dateVibe, isAdult);
    const foodKeyword = isAdult ? 'restaurant OR gastropub OR bar with food' : 'restaurant OR cafe dinner';
    const ambianceKeyword = isAdult ? 'lounge OR rooftop bar OR pool hall' : 'park OR scenic viewpoint OR dessert';

    console.log(`-> Running multi-layered searches (isAdult: ${isAdult})...`);
    const [primaryPlaces, foodPlaces, ambiancePlaces] = await Promise.all([
        performGoogleSearch(location, radius, primaryKeyword),
        performGoogleSearch(location, radius, foodKeyword),
        performGoogleSearch(location, radius, ambianceKeyword),
    ]);
    
    const combinedPlaces = new Map();
    [...primaryPlaces, ...foodPlaces, ...ambiancePlaces].forEach(place => {
        if (place.address && !combinedPlaces.has(place.address)) {
            combinedPlaces.set(place.address, place);
        }
    });

    return Array.from(combinedPlaces.values()).slice(0, 20);
}

/**
 * **UPDATED FUNCTION**
 * Instructs Gemini to preserve the new 'type' field.
 */
function constructCuratorPrompt(places, dateVibe, isAdult) {
    const placesString = JSON.stringify(places, null, 2);
    const ageInstruction = isAdult
        ? "The plan is for adults..."
        : "The plan MUST be all-ages...";

    return `
    You are an expert date planner. Your task is to create a personalized, 3-stop date plan...

    **Instructions:**
    1.  ${ageInstruction}
    2.  From the "List of Potential Places", choose the BEST THREE...
    3.  For each chosen stop, you MUST include its "type" exactly as it was provided in the list. This is critical.
    
    **List of Potential Places:**
    ${placesString}

    **JSON Output Schema (MUST match exactly):**
    {
      "planTitle": "A Creative Title for the Date",
      "stops": [
        { "stopNumber": 1, "name": "...", "description": "...", "address": "...", "lat": 0.0, "lng": 0.0, "type": "Food" },
        { "stopNumber": 2, "name": "...", "description": "...", "address": "...", "lat": 0.0, "lng": 0.0, "type": "Activity" },
        { "stopNumber": 3, "name": "...", "description": "...", "address": "...", "lat": 0.0, "lng": 0.0, "type": "Cafe" }
      ]
    }
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

    // STAGE 1: Find places
    const candidatePlaces = await findDateLocations(lat, lng, dateVibe, transportMode, isAdult);
    if (candidatePlaces.length < 3) {
        return res.status(404).json({ error: "Sorry, I couldn't find enough suitable locations." });
    }

    // STAGE 2: Have Gemini curate
    const prompt = constructCuratorPrompt(candidatePlaces, dateVibe, isAdult);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // STAGE 3: Parse, SANITIZE, and respond
    const startIndex = responseText.indexOf('{');
    const endIndex = responseText.lastIndexOf('}');
    if (startIndex === -1 || endIndex === -1) throw new Error("No valid JSON object found in AI response.");
    const jsonString = responseText.substring(startIndex, endIndex + 1);
    const planJson = JSON.parse(jsonString);

    // Final sanitization ensures all fields are correct before sending
    const sanitizedPlan = {
      ...planJson,
      stops: planJson.stops.map(stop => ({
        ...stop,
        lat: parseFloat(stop.lat),
        lng: parseFloat(stop.lng),
        type: stop.type || 'Activity', // Add fallback for type
      })).filter(stop => !isNaN(stop.lat) && !isNaN(stop.lng))
    };
    
    res.status(200).json(sanitizedPlan);

  } catch (error) {
    console.error("Error in /api/generate-plan:", error.message);
    res.status(500).json({ error: error.message || 'An unexpected error occurred.' });
  }
});

// Full getKeywordFromVibe implementation for copy-paste
getKeywordFromVibe = function(dateVibe, isAdult) {
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

// --- SERVER START ---
app.listen(PORT, () => {
  console.log(`AI Date Planner server listening on port ${PORT}`);
});