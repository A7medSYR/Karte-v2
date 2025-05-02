let watchId = null;
 let userMarker = null;
 let userCircle = null;
 let tracking = true;
 let lastPosition = null;
 let positionHistory = [];
 let map;
 
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
   map = L.map('map').setView([49.5, 7.0], 14);
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
     attribution: '&copy; OpenStreetMap-Mitwirkende'
   }).addTo(map);
 
   // Genauigkeitsanzeige hinzufügen
   const accuracyInfo = L.control({ position: 'bottomleft' });
   accuracyInfo.onAdd = function() {
     const div = L.DomUtil.create('div', 'accuracy-info');
     div.innerHTML = '<div id="accuracy" style="background: white; padding: 5px; border-radius: 4px; display: inline-block;"></div>';
     return div;
   };
   accuracyInfo.addTo(map);
   
   // Standortverfolgung-Button hinzufügen
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
     timeout: 5000              // 5 Sekunden Timeout (schnellere Updates)
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
     let zoomLevel = 18; // Standardzoom
 
     // Dynamischer Zoom basierend auf Geschwindigkeit
     if (speed !== null) {
       if (speed > 19) { // Schnell (> 72 km/h)
         zoomLevel = 10;
       } else if (speed > 8) { // Mittel (> 29 km/h)
         zoomLevel = 19;
       } else if (speed > 3) { // Langsam (> 11 km/h)
         zoomLevel = 19;
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
     
     // Strategie 2: Q-Parameter mit formatierter Adresse
     // Bessere Ergebnisse für ungewöhnliche Adressen oder wenn die Straße falsch geschrieben ist
     const formattedAddress = `${formattedStreet} ${formattedHausnr}, ${formattedOrt}, Deutschland`;
     const params2 = new URLSearchParams({ 
       format: 'json', 
       q: formattedAddress,
       limit: '1',
       countrycodes: 'de'
     });
     
     console.log(`Nominatim Strategie 2: Freie Suche "${formattedAddress}"`);
     
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
       console.log('Nominatim Strategie 2 erfolgreich:', data2[0].display_name);
       return result;
     }
     
     // Strategie 3: Spezielle Behandlung für Straßen mit Umlauten - Normalisieren von Umlauten
     const normalizedStreet = formattedStreet
       .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
       .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue');
       
     // Nur versuchen, wenn sich die normalisierte Straße vom Original unterscheidet
     if (normalizedStreet !== formattedStreet) {
       const params3 = new URLSearchParams({ 
         format: 'json', 
         street: `${normalizedStreet} ${formattedHausnr}`,
         city: formattedOrt,
         country: 'de',
         limit: '1'
       });
       
       console.log(`Nominatim Strategie 3: Normalisierte Umlaute "${normalizedStreet} ${formattedHausnr}, ${formattedOrt}"`);
       
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
         console.log('Nominatim Strategie 3 erfolgreich (normalisierte Umlaute):', data3[0].display_name);
         return result;
       }
     }
     
     // Strategie 4: Ohne Hausnummer, nur Straße und Ort
     // Hilfreich, wenn die Hausnummer falsch ist oder nicht existiert
     const params4 = new URLSearchParams({ 
       format: 'json', 
       street: formattedStreet,
       city: formattedOrt, 
       country: 'de',
       limit: '5'
     });
     
     console.log(`Nominatim Strategie 4: Nur Straße "${formattedStreet}, ${formattedOrt}"`);
     
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
       console.log('Nominatim Strategie 4 erfolgreich (ohne Hausnummer):', data4[0].display_name);
       return result;
     }
     
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
     
     // Normalisiere den Straßennamen für bessere Ergebnisse
     const normalizedStrasse = normalizeStreetName(strasse);
     
     // Cache-Key mit Kleinschreibung für bessere Trefferquote
     const key = `${normalizedStrasse.toLowerCase()}|${hausnr.toLowerCase()}|${ort.toLowerCase()}`;
     if (cache[key]) {
       console.log('Adresse aus Cache geladen:', key);
       return cache[key];
     }

     console.log('Geocode-Anfrage für:', `${strasse} ${hausnr}, ${ort}`);
     console.log('Normalisierter Straßenname:', normalizedStrasse);
     
     // 1. Google Maps API verwenden, wenn API-Schlüssel verfügbar ist
     const GOOGLE_API_KEY = 'DEIN_API_KEY'; // Hier deinen API-Schlüssel eintragen
     if (GOOGLE_API_KEY && GOOGLE_API_KEY !== 'DEIN_API_KEY') {
       try {
         // Deutsche Adressformatierung für Google
         const formattedAddress = `${strasse} ${hausnr}, ${ort}, Deutschland`;
         
         const params = new URLSearchParams({
           address: formattedAddress,
           key: GOOGLE_API_KEY,
           language: 'de',
           region: 'de',
           components: 'country:de'
         });
         
         const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;
         console.log('Google Geocode-Anfrage:', formattedAddress);
         
         const res = await fetch(url, {
           headers: {
             'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
           }
         });
         const data = await res.json();
         
         if (data.status === 'OK' && data.results.length) {
           const result = data.results[0];
           const loc = result.geometry.location;
           const accuracy = result.geometry.location_type;
           
           const coordinates = [loc.lat, loc.lng];
           const resultObj = {
             coordinates,
             accuracy,
             source: 'google'
           };
           
           cache[key] = resultObj;
           console.log(`Google Geocoding erfolgreich: ${accuracy}`);
           return resultObj;
         }
         console.warn('Google Geocoding fehlgeschlagen:', data.status);
       } catch (googleError) {
         console.error('Google Geocoding API-Fehler:', googleError);
       }
     }
     
     // 2. Nominatim als Fallback (optimiert für deutsche Adressen)
     console.log('Versuche Nominatim als Fallback für deutsche Adresse...');
     
     // Verwende den normalisierten Straßennamen für bessere Ergebnisse
     let nominatimResult = await geocodeNominatim(normalizedStrasse, hausnr, ort);
     
     // Falls kein Ergebnis, versuche es mit dem Original-Straßennamen
     if (!nominatimResult && normalizedStrasse !== strasse) {
       console.log('Versuche mit Original-Straßennamen:', strasse);
       nominatimResult = await geocodeNominatim(strasse, hausnr, ort);
     }
     
     if (nominatimResult) {
       const resultObj = {
         coordinates: nominatimResult,
         accuracy: 'approximate',
         source: 'nominatim'
       };
       
       cache[key] = resultObj;
       return resultObj;
     }
     
     // Wenn keine Ergebnisse gefunden wurden, versuche noch eine letzte Strategie:
     // Hausnummern mit Buchstaben behandeln
     if (hausnr && /^(\d+)([a-zA-Z].*)$/.test(hausnr)) {
       console.log('Versuche spezielle Strategie für Hausnummern mit Buchstaben');
       const numericPart = hausnr.match(/^(\d+)/)[1];
       
       // Versuche mit dem numerischen Teil der Hausnummer
       const specialResult = await geocodeNominatim(strasse, numericPart, ort);
       
       if (specialResult) {
         const resultObj = {
           coordinates: specialResult,
           accuracy: 'approximate',
           source: 'nominatim-special'
         };
         
         cache[key] = resultObj;
         return resultObj;
       }
     }
     
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
 
     Papa.parse(file, {
       header: true,
       delimiter: ';',  // Semikolon als Trennzeichen verwenden
       skipEmptyLines: true,
       complete: async results => {
         console.log('Felder:', results.meta.fields);
         
         // Debugging: Zeige die ersten Zeilen der CSV-Datei
         console.log('Erste Zeilen:', results.data.slice(0, 3));
         
         let count = 0;
         let failedCount = 0;
         
         // Zähler für Ergebnisse
 
         // Referenzen für Marker und deren IDs speichern
         const markerRefs = [];
 
         for (const row of results.data) {
           console.log('Zeile:', row);
 
           // Extrahiere die Adressdaten aus den richtigen Spalten
           const strasse = row['strasse'] || '';
           const hausnr = row['hausnummer'] || '';
           const ort = row['ort'] || '';
           const hinweis = row['Hinweis'] || '';
 
           // Überspringe Zeilen ohne Straße oder Hausnummer
           if (!strasse || !hausnr) continue;
 
           console.log('Adresse:', strasse, hausnr, ort);
 
           // Geocoding mit verbesserter Methode
           const result = await geocode(strasse, hausnr, ort);
 
           if (!result) {
             console.warn('Kein Ergebnis für:', `${strasse} ${hausnr}, ${ort}`);
             failedCount++;
             continue;
           }
 
           // Extrahiere Koordinaten und Metadaten
           let coords, accuracy, source;
 
           if (Array.isArray(result)) {
             coords = result;
             accuracy = 'unknown';
             source = 'unknown';
           } else if (result.coordinates) {
             coords = result.coordinates;
             accuracy = result.accuracy || 'unknown';
             source = result.source || 'unknown';
           }
 
           count++;
 
           // Wähle den richtigen Marker basierend auf Genauigkeit und Hinweis
           const markerIcon = getMarkerIcon(accuracy, source, !!hinweis);
 
           // Eindeutige ID für den Schalter im Popup
           const markerId = `switch-${count}`;
 
           // Erstelle den Marker mit Popup inkl. Schalter
           const marker = L.marker(coords, { icon: markerIcon })
             .addTo(map)
             .bindPopup(
               `<strong>${strasse} ${hausnr}, ${ort}</strong>` +
               (hinweis ? `<br><em>Hinweis:</em> ${hinweis}` : '') +
               `<br><label style="display:inline-flex;align-items:center;margin-top:6px;">
                 <input type="checkbox" id="${markerId}" style="margin-right:6px;"> Pin grün
               </label>`
             );
 
           // Speichere Marker-Referenz für spätere Manipulation
           markerRefs.push({ marker, markerId, hasHint: !!hinweis });
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
   });
 }
 
 // Initialisierung beim Laden der Seite
 document.addEventListener('DOMContentLoaded', () => {
   initMap();
   setupUI();
   
   // Event-Listener für Sichtbarkeitsänderungen (Tab-Wechsel, App-Minimierung)
   document.addEventListener('visibilitychange', () => {
     if (document.visibilityState === 'visible') {
       console.log('App wieder sichtbar - Starte Geolocation neu');
       // Stoppe vorhandene Tracking-Session und starte neu
       stopTracking();
       startTracking();
     }
   });
   
   // Zusätzlicher Event-Listener für mobile Geräte (Page Show/Hide Events)
   window.addEventListener('pageshow', () => {
     console.log('Seite neu angezeigt - Starte Geolocation neu');
     stopTracking();
     startTracking();
   });
   
   // Bei Wiederherstellung aus dem Hintergrund (für iOS Safari)
   window.addEventListener('focus', () => {
     console.log('Fenster erhält Fokus - Starte Geolocation neu');
     stopTracking();
     startTracking();
   });
 });
 
 // Neuer grüner Pin
 const greenPin = L.icon({
   iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
   shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
   iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
 });