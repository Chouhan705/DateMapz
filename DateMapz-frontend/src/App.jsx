import React, { useState, useEffect, useRef } from 'react';
import { GoogleMap, useLoadScript, Marker } from '@react-google-maps/api';
import { 
  HiMapPin, 
  HiCheckCircle, 
  HiArrowPath, 
  HiSparkles, 
  HiTruck, 
  HiCog8Tooth,
  HiClock,
  HiArrowRightCircle
} from 'react-icons/hi2';

// --- Configuration ---
const DATE_VIBES = ["Romantic", "Adventurous", "Casual", "Foodie", "Artsy"];
const TRANSPORT_MODES = ["Driving", "Walking", "Transit"];
const mapContainerStyle = { width: '100%', height: '350px', borderRadius: '0.5rem' };
const libraries = ['places'];

// Helper function to select an icon URL based on the stop type
const getIconForStop = (type) => {
  const base = 'http://maps.google.com/mapfiles/ms/icons/';
  switch (type) {
    case 'Food': return base + 'orange-dot.png';
    case 'Cafe': return base + 'yellow-dot.png';
    case 'Activity': return base + 'ltblue-dot.png';
    case 'Park': return base + 'green-dot.png';
    case 'Shop': return base + 'blue-dot.png';
    case 'Bar': return base + 'pink-dot.png';
    default: return base + 'purple-dot.png';
  }
};

function App() {
  // --- State, Refs, Hooks ---
  const [location, setLocation] = useState(null); // For GPS coords {lat, lng}
  const [manualLocationName, setManualLocationName] = useState(''); // For manual text input
  const [selectedVibe, setSelectedVibe] = useState(null);
  const [transportMode, setTransportMode] = useState(TRANSPORT_MODES[0]);
  const [isAdult, setIsAdult] = useState(false);
  const [planTitle, setPlanTitle] = useState('');
  const [datePlan, setDatePlan] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mapRef = useRef();
  const resultsRef = useRef(null);
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries,
  });

  // --- Effect ---
  useEffect(() => {
    if (!datePlan || datePlan.length === 0) return;
    if (mapRef.current) {
      const bounds = new window.google.maps.LatLngBounds();
      if (location) {
        bounds.extend(new window.google.maps.LatLng(location.lat, location.lng));
      }
      datePlan.forEach(stop => {
        bounds.extend(new window.google.maps.LatLng(parseFloat(stop.lat), parseFloat(stop.lng)));
      });
      mapRef.current.fitBounds(bounds);
    }
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [datePlan, location]);

  // --- Handlers ---
  const onMapLoad = (map) => { mapRef.current = map; };

  const handleGetLocation = () => {
    setManualLocationName(''); 
    setError('');
    setLocation(null);
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({ lat: latitude, lng: longitude });
      },
      (err) => {
        setError("Could not get location. Please enable it in your browser settings.");
      }
    );
  };

  const handleManualLocationChange = (e) => {
    setLocation(null); 
    setManualLocationName(e.target.value);
  };

  const handlePlanDate = async () => {
    setLoading(true); setError('');
    setDatePlan(null); setPlanTitle('');

    const baseRequestBody = {
      dateVibe: selectedVibe,
      transportMode,
      isAdult,
    };

    const requestBody = location
      ? { ...baseRequestBody, location: location }
      : { ...baseRequestBody, locationName: manualLocationName.trim() };

    try {
      const response = await fetch('http://localhost:3000/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const responseData = await response.json();
      const rawStops = responseData.stops || [];
      const validStops = rawStops.filter(stop => 
        stop && stop.lat != null && !isNaN(parseFloat(stop.lat)) && stop.lng != null && !isNaN(parseFloat(stop.lng))
      );
      if (rawStops.length !== validStops.length) {
        console.warn("Some stops were filtered out due to invalid coordinates.");
        if (validStops.length === 0) setError("The plan had no valid locations.");
      }
      setPlanTitle(responseData.planTitle);
      setDatePlan(validStops);
    } catch (err) {
      setError(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const isPlanButtonDisabled = 
    (!location && manualLocationName.trim() === '') ||
    !selectedVibe || 
    !transportMode || 
    loading;

  // --- Render Logic ---
  if (loadError) {
    return (
      <div className="bg-gray-900 min-h-screen flex items-center justify-center p-4">
        <div className="text-center text-white bg-red-800/50 p-6 rounded-lg">
          <h2 className="text-xl font-bold mb-2">Map Loading Failed</h2>
          <p>The Google Maps script was blocked from loading.</p>
          <p className="mt-2 text-sm text-gray-300">This is usually caused by an ad blocker or privacy extension. Please disable it for this site and refresh the page.</p>
        </div>
      </div>
    );
  }
  
  if (!isLoaded) {
    return <div className="bg-gray-900 min-h-screen flex items-center justify-center text-white">Loading...</div>;
  }

  return (
    <div className="bg-gray-900 min-h-screen flex items-start justify-center text-white font-sans p-4 sm:p-6">
      <div className="w-full max-w-md space-y-4">
        {/* --- Controls Section --- */}
        <div className="p-6 bg-gray-800 rounded-lg shadow-lg space-y-4">
          <h1 className="text-3xl font-bold text-center text-pink-400 flex items-center justify-center gap-2">
            <HiSparkles />
            <span>AI Date Planner</span>
          </h1>
          
          <div className="p-4 bg-gray-700/50 rounded-lg">
            <h2 className="font-bold text-lg mb-2 flex items-center gap-2"><HiMapPin className="text-pink-400" /><span>Step 1: Your Location</span></h2>
            
            {location ? (
              <div className="flex items-center gap-2">
                <div className="flex-grow bg-green-600 text-white font-bold py-2 px-4 rounded-lg text-center flex items-center justify-center gap-2"><HiCheckCircle /><span>Location Captured!</span></div>
                <button onClick={handleGetLocation} title="Retake Location" className="flex-shrink-0 bg-blue-500 hover:bg-blue-600 text-white p-2.5 rounded-lg"><HiArrowPath className="h-5 w-5" /></button>
              </div>
            ) : (
              <button onClick={handleGetLocation} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg w-full flex items-center justify-center gap-2">
                <HiMapPin /><span>Use My Current Location</span>
              </button>
            )}

            <div className="my-3 text-center text-gray-400 text-sm font-semibold">OR</div>

            <input 
              type="text"
              placeholder="Enter a city or neighborhood"
              className="w-full bg-gray-600 border border-gray-500 rounded-lg p-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-400"
              value={manualLocationName}
              onChange={handleManualLocationChange}
            />
          </div>

          <div className="p-4 bg-gray-700/50 rounded-lg"><h2 className="font-bold text-lg mb-3 flex items-center gap-2"><HiSparkles className="text-pink-400" /><span>Step 2: The Vibe</span></h2><div className="grid grid-cols-3 gap-2">{DATE_VIBES.map(vibe => (<button key={vibe} onClick={() => setSelectedVibe(vibe)} className={`p-2 rounded-lg text-sm font-semibold transition-all ${selectedVibe === vibe ? 'bg-pink-600' : 'bg-gray-600 hover:bg-gray-500'}`}>{vibe}</button>))}</div></div>
          <div className="p-4 bg-gray-700/50 rounded-lg"><h2 className="font-bold text-lg mb-2 flex items-center gap-2"><HiTruck className="text-pink-400" /><span>Step 3: How You'll Get Around</span></h2><select value={transportMode} onChange={(e) => setTransportMode(e.target.value)} className="w-full p-2 bg-gray-600 rounded-lg">{TRANSPORT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}</select></div>
          <div className="p-4 bg-gray-700/50 rounded-lg"><h2 className="font-bold text-lg mb-2 flex items-center gap-2"><HiCog8Tooth className="text-pink-400" /><span>Step 4: Preferences</span></h2><label htmlFor="isAdultToggle" className="flex items-center justify-between cursor-pointer"><span className="text-gray-200">Include 18+ locations</span><div className="relative"><input type="checkbox" id="isAdultToggle" className="sr-only" checked={isAdult} onChange={() => setIsAdult(!isAdult)} /><div className="block bg-gray-600 w-14 h-8 rounded-full"></div><div className={`dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${isAdult ? 'transform translate-x-6 bg-pink-400' : ''}`}></div></div></label></div>
          
          <button onClick={handlePlanDate} disabled={isPlanButtonDisabled} className="w-full bg-pink-500 text-white font-bold py-3 rounded-lg text-lg flex items-center justify-center gap-2 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed hover:bg-pink-600">{loading ? (<><HiArrowPath className="animate-spin h-5 w-5" /><span>Generating...</span></>) : (<><span>Plan My Date!</span><HiSparkles className="h-5 w-5" /></>)}</button>
          {error && <div className="text-red-400 bg-red-900/50 p-3 rounded-lg text-center">{error}</div>}
        </div>
        
        {/* --- Results Section --- */}
        {datePlan && datePlan.length > 0 && (
          <div ref={resultsRef} className="p-6 bg-gray-800 rounded-lg shadow-lg space-y-4">
            <h2 className="text-2xl font-bold text-center text-pink-400">{planTitle || "Your Generated Date Plan"}</h2>
            
            <GoogleMap mapContainerStyle={mapContainerStyle} center={location || { lat: parseFloat(datePlan[0].lat), lng: parseFloat(datePlan[0].lng) }} zoom={13} onLoad={onMapLoad} options={{ disableDefaultUI: true, zoomControl: true }}>
              {location && <Marker position={location} title="Your Location" />}
              {datePlan.map((stop) => {
                const labelText = (stop.stopNumber != null && typeof stop.stopNumber !== 'object') ? `${stop.stopNumber}` : '';
                return (
                  <Marker 
                    key={stop.stopNumber || stop.lat}
                    position={{ lat: parseFloat(stop.lat), lng: parseFloat(stop.lng) }}
                    title={stop.name || 'Date Stop'}
                    label={{ text: labelText, color: 'white', fontWeight: 'bold' }} 
                    icon={getIconForStop(stop.type)} 
                  />
                );
              })}
            </GoogleMap>
            
            <div>
              {datePlan.sort((a, b) => (a.stopNumber || 0) - (b.stopNumber || 0)).map((stop, index) => (
                <React.Fragment key={stop.stopNumber || index}>
                  <div className="p-4 bg-gray-700/70 rounded-lg">
                    <p className="font-bold text-lg">{stop.stopNumber}. {stop.name || 'Unnamed Stop'}</p>
                    <div className="flex items-center gap-2 text-sm text-pink-300 mt-1">
                      <HiClock />
                      <span>Starts at {stop.startTime} (approx. {stop.duration})</span>
                    </div>
                    <p className="text-sm text-gray-300 mt-2">{stop.description}</p>
                  </div>
                  
                  {stop.travelToNext && (
                    <div className="h-20 flex items-center pl-5">
                      <div className="border-l-2 border-dashed border-gray-500 h-full"></div>
                      <div className="flex items-center gap-3 -ml-4">
                          <HiArrowRightCircle className="w-8 h-8 text-gray-400" />
                          <div className="text-gray-300">
                            <p className="font-semibold">{stop.travelToNext.travelTime}</p>
                            <p className="text-sm">via {stop.travelToNext.transportMode}</p>
                          </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;