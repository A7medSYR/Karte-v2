let watchId = null;
let userMarker = null;
let userCircle = null;
let tracking = true;
let lastPosition = null;
let positionHistory = [];
let map;
// Variable für Screen Wake Lock
let wakeLock = null;

// Deutsche Straßen- und Ortssynonyme für verbesserte Geocodierung
const streetSynonyms = {
  'str': 'straße',
  'str.': 'straße',
  'strasse': 'straße',
  'ave': 'allee',
  'avenue': 'allee',
  'platz': 'platz',
  'pl': 'platz',
  'pl.': 'platz',
  'weg': 'weg',
  'gasse': 'gasse',
  'pfad': 'pfad',
  'ring': 'ring'
};

// Hilfsfunktion zur Normalisierung von Straßennamen
function normalizeStreetName(street) {
  if (!street) return '';
  
  let normalized = street.toLowerCase().trim();
  
  // Finde den Straßentyp am Ende des Namens
  const words = normalized.split(/\s+/);
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    const streetType = streetSynonyms[lastWord];
    
    if (streetType) {
      // Ersetze den Straßentyp mit der standardisierten Version
      words[words.length - 1] = streetType;
      normalized = words.join(' ');
    }
  }
  
  return normalized;
}

// 1) Leaflet & Geolocation-Setup
function initMap() {
  map = L.map('map', {
    minZoom: 4,
    maxZoom: 20,
    zoomControl: true
  }).setView([49.5, 7.0], 14);
  
  // NEUE 2024 OSMC-TOPO KARTE (Deutschland-optimiert, KEIN API-SCHLÜSSEL)
  // Hochaktuelle Daten mit täglicher Aktualisierung, höchste Detailstufe
  L.tileLayer('https://tile.osmand.net/hd/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://osmand.net">OsmAnd 2024</a> | <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  
  // Gebäude-Layer automatisch aktivieren
  let buildingsLayer;
  let currentBuildingsBounds = null;
  
  // Funktion zum Laden von Gebäuden mit Hausnummern (neu 2024)
  function loadBuildings() {
    if (map.getZoom() < 16) return;
    
    const bounds = map.getBounds();
    
    // Vermeide zu häufiges Nachladen
    if (currentBuildingsBounds && currentBuildingsBounds.contains(bounds)) {
      return;
    }
    
    // Erweitere den Bereich etwas
    const expandedBounds = bounds.pad(0.3);
    currentBuildingsBounds = expandedBounds;
    
    const south = expandedBounds.getSouth();
    const west = expandedBounds.getWest();
    const north = expandedBounds.getNorth();
    const east = expandedBounds.getEast();
    
    // Overpass API Abfrage für deutsche Gebäude mit Hausnummern (2024)
    // Hochoptimierte Abfrage für schnellere Ergebnisse
    const query = `
      [out:json][timeout:25];
      (
        // Priorität 1: Gebäude mit Hausnummern und kompletten Adressen
        way["building"]["addr:housenumber"](${south},${west},${north},${east});
        relation["building"]["addr:housenumber"](${south},${west},${north},${east});
        
        // Priorität 2: Neu hinzugefügte/aktualisierte Gebäude (seit 2023)
        way["building"](newer:"2023-01-01T00:00:00Z")(${south},${west},${north},${east});
        relation["building"](newer:"2023-01-01T00:00:00Z")(${south},${west},${north},${east});
        
        // Priorität 3: Gebäude mit Straße aber ohne Hausnummer
        way["building"]["addr:street"](${south},${west},${north},${east});
        relation["building"]["addr:street"](${south},${west},${north},${east});
      );
      out body;
      >;
      out skel qt;
    `;
    
    // Ladeanzeige
    let loadingElement = document.getElementById('loading-buildings');
    if (!loadingElement) {
      const loadingIndicator = L.control({ position: 'bottomleft' });
      loadingIndicator.onAdd = function() {
        const div = L.DomUtil.create('div', 'loading-indicator');
        div.innerHTML = '<div style="background: white; padding: 5px; border-radius: 4px; display: inline-block;">Aktualisierung.. </div>';
        div.id = 'loading-buildings';
        return div;
      };
      loadingIndicator.addTo(map);
    }
    
    // Overpass-API (ohne Schlüssel, täglich aktualisierte Daten)
    fetch('https://overpass.kumi.systems/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    })
    .then(response => response.json())
    .then(data => {
      // Bestehenden Layer entfernen
      if (buildingsLayer) {
        map.removeLayer(buildingsLayer);
      }
      
      // GeoJSON erstellen
      const buildings = osmtogeojson(data);
      
      // Gebäude als Layer hinzufügen
      buildingsLayer = L.geoJSON(buildings, {
        style: function(feature) {
          // Aktuelles Farbschema 2024
          return {
            color: '#3476c2',
            weight: 1.5,
            fillColor: '#3476c2',
            fillOpacity: 0.2,
            opacity: 0.8
          };
        },
        onEachFeature: function(feature, layer) {
          // Hausnummern und Infos im Popup
          if (feature.properties && feature.properties.tags) {
            const tags = feature.properties.tags;
            let popupContent = '';
            
            // Adressinformationen
            if (tags['addr:housenumber']) {
              popupContent += `<strong>Nr.:</strong> ${tags['addr:housenumber']}<br>`;
            }
            
            if (tags['addr:street']) {
              popupContent += `<strong>Straße:</strong> ${tags['addr:street']}<br>`;
            }
            
            if (tags['addr:postcode']) {
              popupContent += `<strong>PLZ:</strong> ${tags['addr:postcode']}<br>`;
            }
            
            // Gebäudeinfo
            if (tags.name) {
              popupContent += `<strong>Name:</strong> ${tags.name}<br>`;
            }
            
            // Baujahr (falls verfügbar)
            if (tags['start_date']) {
              popupContent += `<strong>Baujahr:</strong> ${tags['start_date']}<br>`;
            }
            
            if (popupContent) {
              layer.bindPopup(popupContent);
            }
          }
        }
      }).addTo(map);
      
      // Ladeanzeige entfernen
      loadingElement = document.getElementById('loading-buildings');
      if (loadingElement) {
        loadingElement.remove();
      }
    })
    .catch(error => {
      console.error('Fehler beim Laden der Gebäude:', error);
      
      // Alternativer Overpass-Server bei Fehler
      fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query)
      })
      .then(response => response.json())
      .then(data => {
        if (buildingsLayer) {
          map.removeLayer(buildingsLayer);
        }
        
        const buildings = osmtogeojson(data);
        buildingsLayer = L.geoJSON(buildings, {
          // Gleiche Konfiguration wie oben
          style: function(feature) {
            return {
              color: '#3476c2',
              weight: 1.5,
              fillColor: '#3476c2',
              fillOpacity: 0.2,
              opacity: 0.8
            };
          },
          onEachFeature: function(feature, layer) {
            if (feature.properties && feature.properties.tags) {
              const tags = feature.properties.tags;
              let popupContent = '';
              
              if (tags['addr:housenumber']) {
                popupContent += `<strong>Nr.:</strong> ${tags['addr:housenumber']}<br>`;
              }
              
              if (tags['addr:street']) {
                popupContent += `<strong>Straße:</strong> ${tags['addr:street']}<br>`;
              }
              
              if (tags['addr:postcode']) {
                popupContent += `<strong>PLZ:</strong> ${tags['addr:postcode']}<br>`;
              }
              
              if (tags.name) {
                popupContent += `<strong>Name:</strong> ${tags.name}<br>`;
              }
              
              if (tags['start_date']) {
                popupContent += `<strong>Baujahr:</strong> ${tags['start_date']}<br>`;
              }
              
              if (popupContent) {
                layer.bindPopup(popupContent);
              }
            }
          }
        }).addTo(map);
        
        // Ladeanzeige entfernen
        loadingElement = document.getElementById('loading-buildings');
        if (loadingElement) {
          loadingElement.remove();
        }
      })
      .catch(err => {
        console.error('Auch alternativer Server fehlgeschlagen:', err);
        
        // Ladeanzeige entfernen
        loadingElement = document.getElementById('loading-buildings');
        if (loadingElement) {
          loadingElement.remove();
        }
      });
    });
  }
  
  // Gebäude bei Kartenbewegung nachladen
  map.on('moveend', loadBuildings);
  map.on('zoomend', function() {
    // Gebäude nur bei hohem Zoom laden
    if (map.getZoom() >= 16) {
      loadBuildings();
    } else if (buildingsLayer) {
      map.removeLayer(buildingsLayer);
      buildingsLayer = null;
    }
  });
  
  // Maßstabsanzeige
  L.control.scale({
    imperial: false,
    metric: true,
    position: 'bottomright'
  }).addTo(map);
  
  // Genauigkeitsanzeige
  const accuracyInfo = L.control({ position: 'bottomleft' });
  accuracyInfo.onAdd = function() {
    const div = L.DomUtil.create('div', 'accuracy-info');
    div.innerHTML = '<div id="accuracy" style="background: white; padding: 5px; border-radius: 4px; display: inline-block;"></div>';
    return div;
  };
  accuracyInfo.addTo(map);
  
  // Standortverfolgung-Button
  const locateControl = L.control({ position: 'topright' });
  locateControl.onAdd = () => {
    const btn = L.DomUtil.create('button', 'locate-button');
    btn.id = 'locate-btn';
    btn.textContent = '⏸️ Stoppen';
    btn.title = 'Standortverfolgung ein-/ausschalten';
    L.DomEvent.on(btn, 'click', e => {
      L.DomEvent.stopPropagation(e);
      toggleTracking();
    });
    return btn;
  };
  locateControl.addTo(map);
  
  // Standortverfolgung starten
  startTracking();
}

// Verbesserte Standortverfolgung mit maximaler Genauigkeit
function startTracking() {
  if (watchId) return;

  const geoOptions = {
    enableHighAccuracy: true,  // Höchste Genauigkeit anfordern
    maximumAge: 0,             // Immer aktuelle Position verwenden
    timeout: 3000              // 5 Sekunden Timeout (schnellere Updates)
  };

  watchId = navigator.geolocation.watchPosition(
    position => updatePosition(position),
    error => {
      console.error('Geolocation Fehler:', error);
      alert(`Standortbestimmung fehlgeschlagen: ${error.message}`);
      stopTracking();
    },
    geoOptions
  );
}

// Optimierte Positionsverarbeitung mit erweitertem Kalman-Filter-Ansatz
function updatePosition(position) {
  const { latitude, longitude, accuracy, heading, speed } = position.coords;
  const timestamp = Date.now();
  const latlng = [latitude, longitude];

  // Nur Positionen mit sehr hoher Genauigkeit akzeptieren (z.B. < 30 Meter)
  if (accuracy > 100) {
    console.warn('Position verworfen wegen zu geringer Genauigkeit:', accuracy);
    return;
  }

  // Position in Historie speichern für Glättung und Filter
  positionHistory.push({latlng, accuracy, timestamp, heading, speed});

  // Historie auf maximal 8 Positionen begrenzen für bessere Dynamik
  if (positionHistory.length > 8) {
    positionHistory.shift();
  }

  // Ausreißer erkennen und ignorieren (z.B. Sprünge > 100m zur letzten Position)
  if (positionHistory.length > 1) {
    const prev = positionHistory[positionHistory.length - 2].latlng;
    const dist = Math.sqrt(Math.pow(latlng[0] - prev[0], 2) + Math.pow(latlng[1] - prev[1], 2)) * 111320; // Meter
    if (dist > 100) {
      console.warn('Ausreißer erkannt und ignoriert:', dist, 'Meter');
      positionHistory.pop();
      return;
    }
  }

  // Adaptive Positionsfilterung basierend auf Genauigkeit und Geschwindigkeit
  let filteredPosition = latlng;
  let filteredAccuracy = accuracy;

  // Adaptive Filter-Logik basierend auf Bewegungsparameter
  if (positionHistory.length >= 3) {
    // Bestimme, ob stationär oder in Bewegung
    const isMoving = speed !== null && speed > 0.8; // Bewegungsschwelle bei 0.8 m/s (ca. 3 km/h)

    if (isMoving) {
      // Bei Bewegung: Weniger Dämpfung, mehr aktuelle Position berücksichtigen
      // Gewichtung zugunsten neuer Messungen (bei hoher Geschwindigkeit)
      const weights = calculateWeights(positionHistory, 'moving');
      filteredPosition = calculateWeightedPosition(positionHistory, weights);

      // Bei höherer Geschwindigkeit ist die aktuelle Genauigkeit wichtiger
      filteredAccuracy = accuracy;
    } else {
      // Bei Stillstand: Mehr Dämpfung, stärkere Glättung
      // Bewerte Positionen nach Genauigkeit (bei Stillstand)
      const weights = calculateWeights(positionHistory, 'stationary');
      filteredPosition = calculateWeightedPosition(positionHistory, weights);

      // Bei Stillstand können wir die Genauigkeit durch Mittelung verbessern
      // Gewichteter Durchschnitt der Genauigkeiten, bevorzugt genauere Werte
      filteredAccuracy = positionHistory.reduce((sum, pos, idx) => {
        // Genauere Messungen höher gewichten
        const accuracyWeight = 1.0 / Math.max(0.1, pos.accuracy);
        return sum + (pos.accuracy * accuracyWeight);
      }, 0) / positionHistory.reduce((sum, pos) => sum + (1.0 / Math.max(0.1, pos.accuracy)), 0);
    }
  }

  // Heading-Glättung für flüssigere Rotation
  let filteredHeading = heading;
  if (heading !== null && positionHistory.length >= 2) {
    // Sammle alle verfügbaren Heading-Werte
    const headings = positionHistory
      .filter(pos => pos.heading !== null)
      .map(pos => pos.heading);

    if (headings.length >= 2) {
      // Verwende gleitenden Durchschnitt für Heading mit spezieller Behandlung für 0/360-Grad-Übergang
      filteredHeading = calculateAverageHeading(headings);
    }
  }

  // Karte auf aktuelle Position zentrieren, wenn Tracking aktiv
  if (tracking) {
    // Sanftes Zoomen basierend auf Geschwindigkeit
    let zoomLevel = 19; // Standardzoom

    // Dynamischer Zoom basierend auf Geschwindigkeit
    if (speed !== null) {
      if (speed > 19) { // Schnell (> 72 km/h)
        zoomLevel = 17;
      } else if (speed > 8) { // Mittel (> 29 km/h)
        zoomLevel = 17;
      } else if (speed > 3) { // Langsam (> 11 km/h)
        zoomLevel = 17;
      }
    }

    // Sanfte Animation beim Zentrieren mit angepasster Dauer
    map.setView(filteredPosition, zoomLevel, {
      animate: true,
      duration: 0.5, // Schnellere Animation für flüssigeres Erlebnis
      easeLinearity: 0.5
    });
  }

  // Marker für Benutzerposition aktualisieren oder erstellen
  if (!userMarker) {
    userMarker = L.marker(filteredPosition, {
      icon: L.divIcon({
        className: 'user-marker',
        html: '<div class="position-dot"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      }),
      rotationAngle: filteredHeading || 0,
      rotationOrigin: 'center center'
    }).addTo(map).bindPopup('Mein Standort');
  } else {
    userMarker.setLatLng(filteredPosition);
    if (filteredHeading !== null) userMarker.setRotationAngle(filteredHeading);
  }

  // Genauigkeitskreis aktualisieren oder erstellen
  if (!userCircle) {
    userCircle = L.circle(filteredPosition, {
      radius: filteredAccuracy,
      color: '#4285F4',
      fillColor: '#4285F4',
      fillOpacity: 0.1,
      weight: 1
    }).addTo(map);
  } else {
    userCircle.setLatLng(filteredPosition);
    userCircle.setRadius(filteredAccuracy);
  }

  // Genauigkeitsanzeige
  document.getElementById('accuracy').innerHTML = `
    <strong>Genauigkeit:</strong> ${Math.round(filteredAccuracy)} m
    ${speed !== null ? `<br><strong>Geschwindigkeit:</strong> ${Math.round(speed * 3.6)} km/h` : ''}
  `;

  lastPosition = {latlng: filteredPosition, accuracy: filteredAccuracy, heading: filteredHeading, speed};
}

// Hilfsfunktionen für Filter und Glättung
function calculateWeights(history, mode) {
  // Modus "moving": Neuere Positionen stärker gewichten
  // Modus "stationary": Genauere Positionen stärker gewichten
  if (mode === 'moving') {
    const n = history.length;
    return history.map((_, i) => 0.2 + 0.8 * (i + 1) / n); // Linear ansteigend
  } else {
    return history.map(pos => 1.0 / Math.max(0.1, pos.accuracy));
  }
}

function calculateWeightedPosition(history, weights) {
  let sumLat = 0, sumLng = 0, sumWeight = 0;
  for (let i = 0; i < history.length; i++) {
    sumLat += history[i].latlng[0] * weights[i];
    sumLng += history[i].latlng[1] * weights[i];
    sumWeight += weights[i];
  }
  return [sumLat / sumWeight, sumLng / sumWeight];
}

function calculateAverageHeading(headings) {
  // Mittelwert unter Berücksichtigung von 0/360-Übergang
  let sinSum = 0, cosSum = 0;
  for (const h of headings) {
    sinSum += Math.sin(h * Math.PI / 180);
    cosSum += Math.cos(h * Math.PI / 180);
  }
  return (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
}

function stopTracking() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function toggleTracking() {
  tracking = !tracking;
  const btn = document.getElementById('locate-btn');
  btn.textContent = tracking ? '⏸️ Stoppen' : '▶️ Folgen';
  
  if (tracking && lastPosition) {
    map.setView(lastPosition.latlng, 18);
  }
}

// 2) Adress-Parsen mit Hausnummer (inkl. Buchstaben) - Spezielle deutsche Adressformate
function parseAddress(combined) {
  // Eingabe normalisieren: Zuerst trimmen und dann nach Komma aufteilen
  const parts = combined.split(',').map(s => s.trim());
  const addrPart = parts[0];
  const ort = parts.length > 1 ? parts[1] : '';
  
  // Deutsche Straßenbezeichnungen (häufig mit Leerzeichen)
  const streetSuffixes = [
    'allee', 'chaussee', 'damm', 'gasse', 'pfad', 'platz', 'ring', 'straße', 'str.', 'str', 
    'weg', 'ufer', 'markt', 'promenade', 'zeile'
  ];
  
  // 1. Methode: Regulärer Ausdruck für das häufigste Format "Straße Hausnummer"
  const standardMatch = addrPart.match(/^(.+?)\s+(\d+\s*[a-zA-Z0-9\/\-]*)$/u);
  if (standardMatch) {
    return { 
      strasse: standardMatch[1].trim(), 
      hausnr: standardMatch[2].trim(), 
      ort 
    };
  }
  
  // 2. Methode: Nach dem letzten Wort suchen, das wie eine Hausnummer aussieht
  const words = addrPart.split(/\s+/);
  let hausnrIndex = -1;
  
  // Von hinten nach vorne durchgehen und nach einer Hausnummer suchen
  for (let i = words.length - 1; i >= 0; i--) {
    if (/^\d+[a-zA-Z0-9\/\-]*$/.test(words[i])) {
      hausnrIndex = i;
      break;
    }
  }
  
  if (hausnrIndex >= 0) {
    const hausnr = words[hausnrIndex];
    const strasse = words.slice(0, hausnrIndex).join(' ');
    return { strasse, hausnr, ort };
  }
  
  // 3. Methode: Prüfe auf typische deutsche Straßennamen mit Leerzeichen vor der Hausnummer
  for (let i = words.length - 2; i >= 0; i--) {
    const potentialStreetSuffix = words[i].toLowerCase().replace(/[^\wäöüß]/g, '');
    if (streetSuffixes.includes(potentialStreetSuffix)) {
      // Das Wort nach dem Straßentyp könnte die Hausnummer sein
      if (i < words.length - 1 && /^\d+[a-zA-Z0-9\/\-]*$/.test(words[i+1])) {
        const hausnr = words[i+1];
        const strasse = words.slice(0, i+1).join(' ');
        return { strasse, hausnr, ort };
      }
    }
  }
  
  // 4. Fallback: Wenn nichts funktioniert, betrachte das letzte Wort als Hausnummer
  const hausnr = words.pop() || '';
  const strasse = words.join(' ');
  
  return { strasse, hausnr, ort };
}

// 3) Verbesserte Geocoding-Strategie für deutsche Adressen
const cache = {};
async function geocodeNominatim(strasse, hausnr, ort) {
  try {
    // Sicherstellen, dass Eingabeparameter gültig sind
    const formattedStreet = strasse ? strasse.trim() : '';
    const formattedHausnr = hausnr ? hausnr.trim() : '';
    const formattedOrt = ort ? ort.trim() : '';
    
    // Cache-Schlüssel: Adressen normalisieren für bessere Cache-Trefferrate
    const cacheKey = `${formattedStreet.toLowerCase()}|${formattedHausnr.toLowerCase()}|${formattedOrt.toLowerCase()}`;
    if (cache[cacheKey]) {
      console.log('Adresse aus Cache geladen:', cacheKey);
      return cache[cacheKey];
    }
    
    // Strategie 1: Formatierte strukturierte Suche (Straße + Hausnummer, Stadt)
    // Diese Strategie funktioniert am besten für Standardadressen
    const params1 = new URLSearchParams({ 
      format: 'json', 
      street: `${formattedStreet} ${formattedHausnr}`,
      city: formattedOrt,
      country: 'de',
      limit: '1',
      addressdetails: '1'
    });
    
    console.log(`Nominatim Strategie 1: "${formattedStreet} ${formattedHausnr}, ${formattedOrt}"`);
    
    const res1 = await fetch(`https://nominatim.openstreetmap.org/search?${params1}`, { 
      headers: { 
        'User-Agent': 'OberthalMap/1.0',
        'Accept-Language': 'de',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      }
    });
    
    const data1 = await res1.json();
    
    if (data1.length > 0) {
      const result = [parseFloat(data1[0].lat), parseFloat(data1[0].lon)];
      cache[cacheKey] = result;
      console.log('Nominatim Strategie 1 erfolgreich:', data1[0].display_name);
      return result;
    }
    
    // Strategie 2: Hausnummernmodifikation für Buchstaben (z.B. "9A" -> "9")
    const hasLetterInNumber = /^(\d+)([a-zA-Z].*)$/i.test(formattedHausnr);
    if (hasLetterInNumber) {
      const numericPart = formattedHausnr.match(/^(\d+)/)[1];
      console.log(`Nominatim Strategie 2: Hausnummer vereinfachen "${formattedStreet} ${numericPart}, ${formattedOrt}"`);
      
      const params2 = new URLSearchParams({ 
        format: 'json', 
        street: `${formattedStreet} ${numericPart}`,
        city: formattedOrt,
        country: 'de',
        limit: '1'
      });
      
      const res2 = await fetch(`https://nominatim.openstreetmap.org/search?${params2}`, { 
        headers: { 
          'User-Agent': 'OberthalMap/1.0',
          'Accept-Language': 'de'
        }
      });
      
      const data2 = await res2.json();
      
      if (data2.length > 0) {
        const result = [parseFloat(data2[0].lat), parseFloat(data2[0].lon)];
        cache[cacheKey] = result;
        console.log('Nominatim Strategie 2 erfolgreich (vereinfachte Hausnummer):', data2[0].display_name);
        return result;
      }
    }
    
    // Strategie 3: Q-Parameter mit formatierter Adresse
    // Bessere Ergebnisse für ungewöhnliche Adressen oder wenn die Straße falsch geschrieben ist
    const formattedAddress = `${formattedStreet} ${formattedHausnr}, ${formattedOrt}, Deutschland`;
    const params3 = new URLSearchParams({ 
      format: 'json', 
      q: formattedAddress,
      limit: '1',
      countrycodes: 'de'
    });
    
    console.log(`Nominatim Strategie 3: Freie Suche "${formattedAddress}"`);
    
    const res3 = await fetch(`https://nominatim.openstreetmap.org/search?${params3}`, { 
      headers: { 
        'User-Agent': 'OberthalMap/1.0',
        'Accept-Language': 'de'
      }
    });
    
    const data3 = await res3.json();
    
    if (data3.length > 0) {
      const result = [parseFloat(data3[0].lat), parseFloat(data3[0].lon)];
      cache[cacheKey] = result;
      console.log('Nominatim Strategie 3 erfolgreich:', data3[0].display_name);
      return result;
    }
    
    // Strategie 4: Freie Suche mit vereinfachter Hausnummer (ohne Buchstaben)
    if (hasLetterInNumber) {
      const numericPart = formattedHausnr.match(/^(\d+)/)[1];
      const simpleAddress = `${formattedStreet} ${numericPart}, ${formattedOrt}, Deutschland`;
      
      const params4 = new URLSearchParams({ 
        format: 'json', 
        q: simpleAddress,
        limit: '1',
        countrycodes: 'de'
      });
      
      console.log(`Nominatim Strategie 4: Freie Suche mit vereinfachter Hausnummer "${simpleAddress}"`);
      
      const res4 = await fetch(`https://nominatim.openstreetmap.org/search?${params4}`, { 
        headers: { 
          'User-Agent': 'OberthalMap/1.0',
          'Accept-Language': 'de'
        }
      });
      
      const data4 = await res4.json();
      
      if (data4.length > 0) {
        const result = [parseFloat(data4[0].lat), parseFloat(data4[0].lon)];
        cache[cacheKey] = result;
        console.log('Nominatim Strategie 4 erfolgreich (freie Suche + vereinfachte Hausnummer):', data4[0].display_name);
        return result;
      }
    }
    
    // Weiterhin die restlichen Strategien ausführen...
    // ... existing code ...
    
    // Strategie 5: Nur die Stadt/Gemeinde suchen, wenn nichts anderes funktioniert
    if (formattedOrt) {
      const params5 = new URLSearchParams({ 
        format: 'json', 
        q: `${formattedOrt}, Deutschland`,
        limit: '1'
      });
      
      console.log(`Nominatim Strategie 5: Nur Ort "${formattedOrt}, Deutschland"`);
      
      const res5 = await fetch(`https://nominatim.openstreetmap.org/search?${params5}`, { 
        headers: { 
          'User-Agent': 'OberthalMap/1.0',
          'Accept-Language': 'de'
        }
      });
      
      const data5 = await res5.json();
      
      if (data5.length > 0) {
        const result = [parseFloat(data5[0].lat), parseFloat(data5[0].lon)];
        cache[cacheKey] = result;
        console.log('Nominatim Strategie 5 erfolgreich (nur Ort):', data5[0].display_name);
        return result;
      }
    }
    
    console.warn('Alle Nominatim-Strategien fehlgeschlagen für:', `${formattedStreet} ${formattedHausnr}, ${formattedOrt}`);
    return null;
  } catch (error) {
    console.error('Nominatim Geocoding-Fehler:', error);
    return null;
  }
}

// Hauptgeocode-Funktion mit optimierter Strategie für deutsche Adressen
async function geocode(strasse, hausnr, ort) {
  try {
    // Normalisierung der Eingabe
    strasse = strasse ? strasse.trim() : '';
    hausnr = hausnr ? hausnr.trim() : '';
    ort = ort ? ort.trim() : '';
    
    // Prüfen ob Hausnummer einen Buchstaben enthält
    const hasLetters = /^(\d+)([a-zA-Z].*)$/i.test(hausnr);
    let numericPart = null;
    
    if (hasLetters) {
      numericPart = hausnr.match(/^(\d+)/)[1];
      console.log(`Hausnummer mit Buchstaben erkannt: ${hausnr} -> Basisnummer: ${numericPart}`);
    }
    
    // Normalisiere den Straßennamen für bessere Ergebnisse
    const normalizedStrasse = normalizeStreetName(strasse);
    
    // Cache-Key mit Kleinschreibung für bessere Trefferquote
    const key = `${normalizedStrasse.toLowerCase()}|${hausnr.toLowerCase()}|${ort.toLowerCase()}`;
    if (cache[key]) {
      console.log('Adresse aus Cache geladen:', key);
      return cache[key];
    }

    console.log('Geocode-Anfrage für:', `${strasse} ${hausnr}, ${ort}`);
    
    // Versuche direkt mit reduzierter Hausnummer, falls buchstabenhaltige Hausnummer vorliegt
    let directResult = null;
    
    // 1. Erster Versuch mit voller Hausnummer (inkl. Buchstaben)
    directResult = await geocodeNominatim(normalizedStrasse, hausnr, ort);
    
    if (directResult) {
      const resultObj = {
        coordinates: directResult,
        accuracy: 'approximate',
        source: 'nominatim'
      };
      
      cache[key] = resultObj;
      return resultObj;
    }
    
    // 2. Falls keine Ergebnisse und Hausnummer hat Buchstaben, versuche mit reduzierter Hausnummer
    if (!directResult && hasLetters && numericPart) {
      console.log(`Versuche mit reduzierter Hausnummer: ${numericPart}`);
      
      const reducedKey = `${normalizedStrasse.toLowerCase()}|${numericPart.toLowerCase()}|${ort.toLowerCase()}`;
      
      // Erst im Cache suchen
      if (cache[reducedKey]) {
        console.log('Reduzierte Adresse aus Cache geladen:', reducedKey);
        const resultObj = {
          ...cache[reducedKey],
          originalHausnr: hausnr,
          reducedHausnr: numericPart,
          isReduced: true
        };
        
        // Speichere auch unter originalem Schlüssel
        cache[key] = resultObj;
        return resultObj;
      }
      
      // Dann mit reduzierter Hausnummer versuchen
      const reducedResult = await geocodeNominatim(normalizedStrasse, numericPart, ort);
      
      if (reducedResult) {
        console.log(`ERFOLG: Reduzierte Hausnummer funktioniert: ${strasse} ${numericPart}, ${ort}`);
        const resultObj = {
          coordinates: reducedResult,
          accuracy: 'approximate',
          source: 'nominatim-reduced',
          originalHausnr: hausnr,
          reducedHausnr: numericPart,
          isReduced: true
        };
        
        // Beide Versionen cachen
        cache[key] = resultObj;
        cache[reducedKey] = resultObj;
        
        return resultObj;
      }
      
      // Auch mit Originalstraßenname versuchen
      if (normalizedStrasse !== strasse) {
        const fallbackResult = await geocodeNominatim(strasse, numericPart, ort);
        
        if (fallbackResult) {
          console.log(`ERFOLG mit Original + reduziert: ${strasse} ${numericPart}, ${ort}`);
          const resultObj = {
            coordinates: fallbackResult,
            accuracy: 'approximate',
            source: 'nominatim-original-reduced',
            originalHausnr: hausnr,
            reducedHausnr: numericPart,
            isReduced: true
          };
          
          cache[key] = resultObj;
          return resultObj;
        }
      }
    }
    
    // Wenn immer noch nichts gefunden wurde...
    console.warn('Alle Geocoding-Strategien fehlgeschlagen für:', `${strasse} ${hausnr}, ${ort}`);
    return null;
  } catch (error) {
    console.error('Geocoding-Gesamtfehler:', error);
    return null;
  }
}

// 4) Farbige Map-Pins
const yellowPin = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const bluePin = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// 5) CSV-Import & Debugging
// Initialisierung der Benutzeroberfläche und Event-Handler
function setupUI() {
  setupFileInput();
}

// Marker-Icons für Standard und Hinweise


// Funktion zur Auswahl des richtigen Markers basierend auf Hinweis
function getMarkerIcon(accuracy, source, hasHint) {
  // Wenn ein Hinweis vorhanden ist, gelber Pin, sonst blauer Pin
  if (hasHint) return yellowPin;
  return bluePin;
}

function setupFileInput() {
  document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return alert('Keine Datei ausgewählt.');

    // Verbesserte Methode zum Einlesen von CSV-Dateien mit korrekter UTF-8-Kodierung
    const reader = new FileReader();
    
    reader.onload = function(e) {
      const csvData = e.target.result;
      
      // Bei Bedarf BOM (Byte Order Mark) entfernen, die manchmal in UTF-8-Dateien vorkommt
      const cleanedData = csvData.replace(/^\uFEFF/, '');
      
      // Mit expliziter UTF-8-Kodierung parsen
      Papa.parse(cleanedData, {
        header: true,
        delimiter: ';',  // Semikolon als Trennzeichen für deutsche CSV
        skipEmptyLines: true,
        transformHeader: header => {
          // Normalisiere Header-Namen
          return header
            .trim()
            .toLowerCase()
            .replace(/[\r\n]+/g, '') // Entferne Zeilenumbrüche
            .replace(/\s+/g, '_'); // Leerzeichen zu Unterstrichen
        },
        complete: async results => {
          console.log('Felder:', results.meta.fields);
          
          // Header-Namen normalisieren und für flexiblere Zuordnung
          const headerMapping = {
            'strasse': ['strasse', 'straße', 'str', 'street', 'adresse'],
            'hausnummer': ['hausnummer', 'hausnr', 'hnr', 'nr', 'nummer', 'house'],
            'ort': ['ort', 'plz', 'postleitzahl', 'stadt', 'gemeinde', 'city', 'town'],
            'hinweis': ['hinweis', 'bemerkung', 'notiz', 'note', 'comment', 'kommentar']
          };
          
          // Debugging: Zeige die ersten Zeilen der CSV-Datei mit korrekten Umlauten
          console.log('Erste Zeilen:', results.data.slice(0, 3));
          console.log('Erkannte Spalten:', results.meta.fields);
          
          let count = 0;
          let failedCount = 0;
          
          // Referenzen für Marker und deren IDs speichern
          const markerRefs = [];

          for (const row of results.data) {
            console.log('Zeile:', row);

            // Flexiblere Feldsuche für verschiedene CSV-Formate
            let strasseWert = '';
            let hausnrWert = '';
            let ortWert = '';
            let hinweisWert = '';
            
            // Finde die richtigen Felder basierend auf verschiedenen möglichen Spaltennamen
            for (const field of results.meta.fields) {
              const lowerField = field.toLowerCase();
              
              // Prüfe für jedes mögliche Feld die verschiedenen Varianten
              if (headerMapping.strasse.some(variant => lowerField.includes(variant))) {
                strasseWert = row[field] || '';
              }
              else if (headerMapping.hausnummer.some(variant => lowerField.includes(variant))) {
                hausnrWert = row[field] || '';
              }
              else if (headerMapping.ort.some(variant => lowerField.includes(variant))) {
                ortWert = row[field] || '';
              }
              else if (headerMapping.hinweis.some(variant => lowerField.includes(variant))) {
                hinweisWert = row[field] || '';
              }
            }

            // Fallback: Verwende die ursprünglichen Feldnamen, wenn kein passendes Feld gefunden wurde
            if (!strasseWert) strasseWert = row['strasse'] || '';
            if (!hausnrWert) hausnrWert = row['hausnummer'] || '';
            if (!ortWert) ortWert = row['ort'] || '';
            if (!hinweisWert) hinweisWert = row['Hinweis'] || '';

            // Überspringe Zeilen ohne Straße oder Hausnummer
            if (!strasseWert || !hausnrWert) continue;

            console.log('Adresse für Geocoding:', strasseWert, hausnrWert, ortWert);

            // Geocoding mit verbesserter Methode
            const result = await geocode(strasseWert, hausnrWert, ortWert);

            if (!result) {
              console.warn('Kein Ergebnis für:', `${strasseWert} ${hausnrWert}, ${ortWert}`);
              failedCount++;
              continue;
            }

            // Extrahiere Koordinaten und Metadaten
            let coords, accuracy, source;
            let isReducedHouseNumber = false;
            let originalHouseNumber = '';
            let reducedHouseNumber = '';

            if (Array.isArray(result)) {
              coords = result;
              accuracy = 'unknown';
              source = 'unknown';
            } else if (result.coordinates) {
              coords = result.coordinates;
              accuracy = result.accuracy || 'unknown';
              source = result.source || 'unknown';
              
              // Überprüfen, ob eine reduzierte Hausnummer verwendet wurde
              if (result.originalHausnr && result.reducedHausnr) {
                isReducedHouseNumber = true;
                originalHouseNumber = result.originalHausnr;
                reducedHouseNumber = result.reducedHausnr;
              } else if (result.isReduced) {
                isReducedHouseNumber = true;
                originalHouseNumber = result.originalHausnr || hausnrWert;
                reducedHouseNumber = result.reducedHausnr;
              }
            }

            count++;

            // Wähle den richtigen Marker basierend auf Genauigkeit und Hinweis
            // Wenn es eine reduzierte Hausnummer ist, setze die Markierung auf gelb
            const markerIcon = getMarkerIcon(accuracy, source, isReducedHouseNumber || !!hinweisWert);

            // Eindeutige ID für den Schalter im Popup
            const markerId = `switch-${count}`;

            // Text für reduzierte Hausnummer erstellen
            let reducedHouseNumberText = '';
            if (isReducedHouseNumber) {
              reducedHouseNumberText = `<br><em style="color:#d9534f;">Hausnummer ${originalHouseNumber} nicht gefunden, 
              zeige stattdessen Hausnummer ${reducedHouseNumber}.</em>`;
            }

            // Erstelle den Marker mit Popup inkl. Schalter
            const marker = L.marker(coords, { icon: markerIcon })
              .addTo(map)
              .bindPopup(
                `<strong>${strasseWert} ${hausnrWert}, ${ortWert}</strong>` +
                (hinweisWert ? `<br><em>Hinweis:</em> ${hinweisWert}` : '') +
                reducedHouseNumberText +
                `<br><label style="display:inline-flex;align-items:center;margin-top:6px;">
                  <input type="checkbox" id="${markerId}" style="margin-right:6px;"> Pin grün
                </label>`
              );

            // Speichere Marker-Referenz für spätere Manipulation
            markerRefs.push({ 
              marker, 
              markerId, 
              hasHint: isReducedHouseNumber || !!hinweisWert,
              isReducedHouseNumber: isReducedHouseNumber
            });
          }

          // Event-Listener für Checkboxen im Popup
          map.on('popupopen', function(e) {
            const popupNode = e.popup._contentNode;
            if (!popupNode) return;
            const input = popupNode.querySelector('input[type="checkbox"]');
            if (!input) return;
            const markerObj = markerRefs.find(obj => obj.markerId === input.id);
            if (!markerObj) return;
            input.addEventListener('change', function() {
              if (input.checked) {
                markerObj.marker.setIcon(greenPin);
              } else {
                // Ursprüngliches Icon wiederherstellen
                markerObj.marker.setIcon(markerObj.hasHint ? yellowPin : bluePin);
              }
            });
          });
          
          // Legende für Marker-Farben hinzufügen
          const legend = L.control({ position: 'bottomright' });
          legend.onAdd = function() {
            const div = L.DomUtil.create('div', 'info legend');
            div.style.backgroundColor = 'white';
            div.style.padding = '10px';
            div.style.borderRadius = '5px';
            div.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
            
            div.innerHTML = '<h4 style="margin:0 0 5px 0">Marker-Legende</h4>';
            div.innerHTML += '<div><img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png" width="15"> Standard </div>';
            div.innerHTML += '<div><img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-yellow.png" width="15"> Mit Hinweis</div>';
            div.innerHTML += '<div><img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png" width="15"> Zugestellt </div>';
            
            return div;
          };
          legend.addTo(map);
    
          // Einfache Zusammenfassung ohne Genauigkeitsstatistiken
          const popup = L.popup({ closeButton: false, autoClose: false, closeOnClick: false, maxWidth: 300 })
            .setLatLng(map.getCenter())
            .setContent(`
              <div style="text-align:center">
                <h3 style="margin:5px 0">Geocoding-Ergebnisse</h3>
                <strong>${count}</strong> Stops gefunden<br/>
                ${failedCount > 0 ? `<strong>${failedCount}</strong> Adressen nicht gefunden<br/>` : ''}
                
                <button id="ok-btn" style="margin-top:12px;padding:6px 12px;cursor:pointer;">
                  OK
                </button>
              </div>`)
            .openOn(map);
          document.getElementById('ok-btn').addEventListener('click', () => {
            map.closePopup(popup);
          });
        },
        error: err => console.error('PapaParse-Fehler:', err)
      });
    };
    
    reader.readAsText(file);
  });
}

// Initialisierung beim Laden der Seite
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupUI();
  
  // Wake Lock anfordern, um den Bildschirm aktiv zu halten
  requestWakeLock();
  
  // Event-Listener für Sichtbarkeitsänderungen (Tab-Wechsel, App-Minimierung)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('App wieder sichtbar - Starte Geolocation neu');
      // Stoppe vorhandene Tracking-Session und starte neu
      stopTracking();
      startTracking();
      
      // Wake Lock erneut anfordern, wenn die App wieder sichtbar wird
      requestWakeLock();
    } else {
      // Optional: Wake Lock freigeben, wenn die App nicht sichtbar ist
      // releaseWakeLock(); // Auskommentiert, damit der Bildschirm auch im Hintergrund an bleibt
    }
  });
  
  // Zusätzlicher Event-Listener für mobile Geräte (Page Show/Hide Events)
  window.addEventListener('pageshow', () => {
    console.log('Seite neu angezeigt - Starte Geolocation neu');
    stopTracking();
    startTracking();
    
    // Wake Lock erneut anfordern
    requestWakeLock();
  });
  
  // Bei Wiederherstellung aus dem Hintergrund (für iOS Safari)
  window.addEventListener('focus', () => {
    console.log('Fenster erhält Fokus - Starte Geolocation neu');
    stopTracking();
    startTracking();
    
    // Wake Lock erneut anfordern
    requestWakeLock();
  });
  
  // Bei Schließen der Seite Wake Lock freigeben
  window.addEventListener('beforeunload', () => {
    releaseWakeLock();
  });
});

// Neuer grüner Pin
const greenPin = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

// Funktion zum Anfordern des Wake Locks, um den Bildschirm aktiv zu halten
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      // Fordere den Wake Lock an
      wakeLock = await navigator.wakeLock.request('screen');
      
      // Event-Listener für den Fall, dass der Wake Lock freigegeben wird
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    }
    // Stille Behandlung, wenn Wake Lock nicht unterstützt wird
  } catch (err) {
    // Fehler still behandeln
  }
}

// Funktion zur Freigabe des Wake Locks
async function releaseWakeLock() {
  if (wakeLock) {
    try {
      await wakeLock.release();
      wakeLock = null;
    } catch (err) {
      // Fehler still behandeln
    }
  }
}