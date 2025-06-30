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
    description: 'Creates a single stop in an itinerary.',
    parameters: {
      type: 'OBJECT',
      properties: {
        stopNumber: { type: 'NUMBER', description: 'The sequence number of the stop (1, 2, 3, etc.).' },
        name: { type: 'STRING', description: "The proper, real-world name of the establishment, park, or landmark." },
        description: { type: 'STRING', description: 'A 2-sentence compelling description of the place.' },
        address: { type: 'STRING', description: 'The full street address of the location.' },
        lat: { type: 'NUMBER', description: 'The latitude coordinate.' },
        lng: { type: 'NUMBER', description: 'The longitude coordinate.' },
        type: { type: 'STRING', description: 'Category: Food, Cafe, Bar, Activity, Park, Shop.' },
        startTime: { type: 'STRING', description: 'Suggested start time (e.g., "09:00").' },
        duration: { type: 'STRING', description: 'Suggested duration (e.g., "1.5 hours").' },
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
        fromStop: { type: 'NUMBER' },
        toStop: { type: 'NUMBER' },
        transportMode: { type: 'STRING' },
        travelTime: { type: 'STRING' },
      },
      required: ['fromStop', 'toStop', 'transportMode', 'travelTime'],
    },
  }],
};

// --- HELPER FUNCTIONS ---

async function getCoordsFromLocationName(locationName) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationName)}&format=json&limit=1`;
    const response = await axios.get(url, { headers: { 'User-Agent': 'AI-Date-Planner-Server' } });
    if (response.data && response.data.length > 0) {
      const { lat, lon } = response.data[0];
      return { lat: parseFloat(lat), lng: parseFloat(lon) };
    }
    throw new Error(`Could not find coordinates for "${locationName}".`);
  } catch (error) {
    console.error("Geocoding Error:", error.message);
    throw new Error(`Could not find a valid location for "${locationName}".`);
  }
}

async function getLocationContext(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`;
    const response = await axios.get(url, { headers: { 'User-Agent': 'AI-Date-Planner-Server' } });
    const address = response.data.address;
    const specificArea = address.suburb || address.neighbourhood || address.road || "the user's area";
    const city = address.city || address.town || "";
    return city ? `the ${specificArea} area of ${city}` : specificArea;
  } catch (error) {
    console.error("Error fetching location context:", error.message);
    return "the user's current area";
  }
}

/**
 * **NEW** - Prompt for the "Simple Mode", inspired by your shared code.
 */
function constructSimplePrompt() {
  return `You are a knowledgeable, geographically-aware assistant. Your goal is to answer any location-related query by creating a detailed, visual day plan.
    - Create a detailed day itinerary with a logical sequence of locations.
    - Aim for 4-6 major stops.
    - Include specific times, realistic durations, and travel details between stops.
    - First, provide a creative title for the plan as a text response.
    - Then, use the 'create_date_stop' and 'create_travel_leg' tools to build the full itinerary.`;
}

/**
 * **NEW** - Prompt for our "Advanced Mode".
 */
function constructAdvancedPrompt(locationContext, dateVibe, transportMode, isAdult) {
  const ageInstruction = isAdult ? "The plan is for adults..." : "The plan MUST be all-ages...";
  return `You are a world-class date planner. Your goal is to generate the best possible date itinerary based on the user's specific preferences.
    - The user is in **${locationContext}**. Create a plan that reflects the character of THIS SPECIFIC AREA.
    - The desired date vibe is: "${dateVibe}". This is your main creative guide.
    - The user's primary transport is "${transportMode}".
    - Adhere to the age guidance: ${ageInstruction}.
    - First, provide a creative title. Then use the tools to build a flexible plan of 2-5 stops.
    - **CRITICAL RULE:** The 'name' for each stop must be a real-world establishment, not a generic activity.`;
}

// --- API ROUTE ---
app.post('/api/generate-plan', async (req, res) => {
  try {
    const { prompt, location, locationName, dateVibe, transportMode, isAdult = false } = req.body;
    let systemInstruction;
    let userMessage;

    // **NEW LOGIC** - Determine which mode is being used
    if (prompt) {
      // SIMPLE MODE
      console.log('Mode: Simple');
      systemInstruction = constructSimplePrompt();
      userMessage = prompt; // The user's freeform text is the prompt
    } else {
      // ADVANCED MODE
      console.log('Mode: Advanced');
      let lat, lng;
      if (locationName) {
        const coords = await getCoordsFromLocationName(locationName);
        lat = coords.lat;
        lng = coords.lng;
      } else if (location) {
        lat = location.lat;
        lng = location.lng;
      } else {
        return res.status(400).json({ error: 'Missing location data for Advanced Mode.' });
      }
      const locationContext = await getLocationContext(lat, lng);
      systemInstruction = constructAdvancedPrompt(locationContext, dateVibe, transportMode, isAdult);
      userMessage = "Please generate the date plan."; // Generic message, context is in the system prompt
    }

    // --- The rest of the logic is now shared ---

    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction,
        tools: [createDateStopTool, createTravelLegTool],
    });

    console.log("Calling AI Planner...");
    const result = await model.generateContent(userMessage);
    const functionCalls = result.response.functionCalls() || [];
    console.log(`-> AI Planner responded with ${functionCalls.length} function calls.`);
    
    // Assemble the plan from the AI's function calls
    const stops = [];
    const travelLegs = [];
    for (const fn of functionCalls) {
        if (fn.name === 'create_date_stop') stops.push(fn.args);
        else if (fn.name === 'create_travel_leg') travelLegs.push(fn.args);
    }
    if (stops.length === 0) throw new Error("AI failed to generate any stops for this request.");

    const planTitle = result.response.text().trim() || `Your Custom Plan`;
    stops.sort((a, b) => a.stopNumber - b.stopNumber);

    const finalStops = stops.map(stop => {
        const leg = travelLegs.find(leg => leg.fromStop === stop.stopNumber);
        const finalStop = { ...stop };
        if (leg) {
            finalStop.travelToNext = { transportMode: leg.transportMode, travelTime: leg.travelTime };
        }
        return finalStop;
    });

    res.status(200).json({ planTitle, stops: finalStops });

  } catch (error) {
    console.error("Error in /api/generate-plan:", error);
    res.status(500).json({ error: error.message || 'An unexpected error occurred.' });
  }
});

// --- SERVER START ---
app.listen(PORT, () => {
  console.log(`AI Date Planner server listening on port ${PORT}`);
});