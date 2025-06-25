// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- INITIALIZATION ---
const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
        name: { type: 'STRING', description: "The proper, real-world name of the establishment, park, or landmark (e.g., 'Cafe Madras', 'Gateway of India')." },
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

/**
 * Converts a location name string (e.g., "Thane") into coordinates.
 * @param {string} locationName
 * @returns {Promise<{lat: number, lng: number}>}
 */
async function getCoordsFromLocationName(locationName) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=1`;
    const response = await axios.get(url, { headers: { 'User-Agent': 'AI-Date-Planner-Server' } });

    if (response.data && response.data.length > 0) {
      const { lat, lon } = response.data[0];
      return { lat: parseFloat(lat), lng: parseFloat(lon) };
    } else {
      throw new Error(`Could not find coordinates for "${locationName}".`);
    }
  } catch (error) {
    console.error("Geocoding Error:", error.message);
    throw new Error(`Could not find a valid location for "${locationName}". Please be more specific.`);
  }
}

async function getLocationContext(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`;
    const response = await axios.get(url, { headers: { 'User-Agent': 'AI-Date-Planner-Server' } });
    const address = response.data.address;
    const specificArea = address.suburb || address.neighbourhood || address.quarter || address.road || "the user's area";
    const city = address.city || address.town || address.state_district || "";
    return city ? `the ${specificArea} area of ${city}` : specificArea;
  } catch (error) {
    console.error("Error fetching location context:", error.message);
    return "the user's current area";
  }
}

function constructItineraryPrompt(locationContext, dateVibe, transportMode, isAdult) {
  const ageInstruction = isAdult
    ? "The plan is for adults and can include venues like bars, lounges, and 18+ establishments."
    : "The plan MUST be all-ages and teen-friendly. Do NOT include places that are primarily bars.";

  return `
    You are a world-class, creative, and expert local guide. Your goal is to generate the best possible date itinerary based on the user's request.

    **Core Philosophy:**
    -   **Be a Local Expert:** The user is in **${locationContext}**. Create a plan that deeply reflects the character, landmarks, and hidden gems of THIS SPECIFIC AREA.
    -   **Flexibility is Key:** The number of stops is up to you (typically 2-5). Create what you think is best for a great, well-paced date in this area.

    **Your Task & Rules:**
    1.  First, create a single, creative 'planTitle' for the date. This should be the first part of your text response.
    2.  Use the provided tools to build the itinerary.
    3.  **CRITICAL RULE:** The 'name' for each stop MUST be the proper name of a real-world establishment, park, or landmark (e.g., 'Sanjay Gandhi National Park', 'Pizza Express'), NOT a generic activity description (e.g., 'Evening Stroll', 'Dinner with a View').
    4.  Call 'create_date_stop' for each stop and 'create_travel_leg' for the journey between stops.
  `;
}

// --- API ROUTE ---
app.post('/api/generate-plan', async (req, res) => {
  try {
    const { location, locationName, dateVibe, transportMode, isAdult = false } = req.body;
    let lat, lng;

    // Determine coordinates from either input type
    if (locationName) {
      console.log(`Input type: Location Name ("${locationName}")`);
      const coords = await getCoordsFromLocationName(locationName);
      lat = coords.lat;
      lng = coords.lng;
    } else if (location && location.lat && location.lng) {
      console.log(`Input type: Coordinates (${location.lat}, ${location.lng})`);
      lat = location.lat;
      lng = location.lng;
    } else {
      return res.status(400).json({ error: 'Missing location data. Provide either locationName or location with lat/lng.' });
    }

    // The rest of the logic proceeds identically once we have coordinates
    const locationContext = await getLocationContext(lat, lng);
    const systemInstruction = constructItineraryPrompt(locationContext, dateVibe, transportMode, isAdult);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction, tools: [createDateStopTool, createTravelLegTool] });
    
    console.log("Calling Context-Aware AI Planner...");
    const result = await model.generateContent("Please generate the best possible date plan based on my context.");
    const functionCalls = result.response.functionCalls() || [];

    // Assemble the final plan from the AI's function calls
    console.log(`Assembling plan from ${functionCalls.length} function calls...`);
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
        throw new Error("AI failed to generate a plan with at least two stops.");
    }

    const planTitle = result.response.text().trim() || `A Great ${dateVibe} Date`;
    stops.sort((a, b) => a.stopNumber - b.stopNumber);

    const finalStops = stops.map(stop => {
        const leg = travelLegs.find(leg => leg.fromStop === stop.stopNumber);
        const finalStop = { ...stop };
        if (leg) {
            finalStop.travelToNext = { transportMode: leg.transportMode, travelTime: leg.travelTime };
        }
        return finalStop;
    });

    const finalPlan = { planTitle, stops: finalStops };

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