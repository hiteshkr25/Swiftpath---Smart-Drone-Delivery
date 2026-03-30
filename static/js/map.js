// Map Manager Class
class MapManager {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.map = null;
        this.markers = new Map();
        this.routes = [];

        this.options = {
            center: [30.3165, 78.0322],
            zoom: 13,
            ...options
        };

        this.init();
    }

    init() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Map container "${this.containerId}" not found`);
            return;
        }

        this.map = L.map(this.containerId).setView(this.options.center, this.options.zoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(this.map);

        this.createCustomIcons();
    }

    createCustomIcons() {
        // Drone icon — glowing blue circle with helicopter emoji
        this.droneIcon = L.divIcon({
            html: `<div style="background:linear-gradient(135deg,#007bff,#0056b3);color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 4px 12px rgba(0,123,255,.5);position:relative;">
                      <span style="font-size:18px;">🚁</span>
                      <div style="position:absolute;top:-6px;right:-6px;width:12px;height:12px;background:#28a745;border:2px solid #fff;border-radius:50%;animation:pulse 1.5s infinite;"></div>
                   </div>
                   <style>@keyframes pulse{0%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.7}100%{transform:scale(1);opacity:1}}</style>`,
            className: 'drone-marker',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        // Low-battery drone icon — red warning
        this.droneIconLowBattery = L.divIcon({
            html: `<div style="background:linear-gradient(135deg,#dc3545,#a71d2a);color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 4px 12px rgba(220,53,69,.6);position:relative;">
                      <span style="font-size:18px;">🚁</span>
                      <div style="position:absolute;top:-6px;right:-6px;width:12px;height:12px;background:#ffc107;border:2px solid #fff;border-radius:50%;animation:pulse 0.8s infinite;"></div>
                   </div>`,
            className: 'drone-marker low-battery',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        // Charging drone icon — orange
        this.droneIconCharging = L.divIcon({
            html: `<div style="background:linear-gradient(135deg,#fd7e14,#e55a00);color:#fff;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 4px 12px rgba(253,126,20,.5);position:relative;">
                      <span style="font-size:18px;">🔋</span>
                   </div>`,
            className: 'drone-marker charging',
            iconSize: [36, 36],
            iconAnchor: [18, 18]
        });

        // Warehouse icon — green
        this.warehouseIcon = L.divIcon({
            html: `<div style="background:#28a745;color:#fff;border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-size:16px;">📦</div>`,
            className: 'warehouse-marker',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        // Delivery icon — red pin
        this.deliveryIcon = L.divIcon({
            html: `<div style="background:#dc3545;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);font-size:14px;">📍</div>`,
            className: 'delivery-marker',
            iconSize: [28, 28],
            iconAnchor: [14, 28]
        });

        // Charging station icon — YELLOW lightning bolt
        this.chargingStationIcon = L.divIcon({
            html: `<div style="background:linear-gradient(135deg,#ffc107,#e6a800);color:#000;border-radius:10px;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 8px rgba(255,193,7,.6);font-size:18px;font-weight:bold;">⚡</div>`,
            className: 'charging-station-marker',
            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });

        // User location icon — purple
        this.userIcon = L.divIcon({
            html: `<div style="background:#6f42c1;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,.3);font-size:12px;">👤</div>`,
            className: 'user-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
    }

    // ── Drone icon selection based on state ────────────────────────────────────
    _getDroneIcon(status) {
        if (status === 'low_battery') return this.droneIconLowBattery;
        if (status === 'charging')    return this.droneIconCharging;
        return this.droneIcon;
    }

    // ── Marker: Drone ──────────────────────────────────────────────────────────
    addDroneMarker(id, lat, lng, info = {}) {
        const icon = this._getDroneIcon(info.status);
        const marker = L.marker([lat, lng], { icon }).addTo(this.map);
        marker.bindPopup(this._buildDronePopup(id, info));

        marker.on('popupopen', () => {
            if (typeof feather !== 'undefined') feather.replace();
        });

        this.markers.set(`drone-${id}`, marker);
        return marker;
    }

    _buildDronePopup(id, info) {
        const battery = info.battery_level ?? 0;
        const status  = info.status || 'unknown';
        const color   = this.getBatteryColor(battery);
        const statusColor = this.getDroneStatusColor(status);
        return `
            <div class="drone-popup" style="min-width:180px;">
                <h6 class="mb-2"><strong>🚁 ${info.name || 'Drone ' + id}</strong></h6>
                <div class="mb-1">Status: <span class="badge bg-${statusColor}">${this._formatStatus(status)}</span></div>
                <div class="mb-1">Battery: <strong>${battery}%</strong></div>
                <div class="progress" style="height:6px;border-radius:3px;">
                    <div class="progress-bar bg-${color}" style="width:${battery}%;transition:width .3s;"></div>
                </div>
                ${info.charging_station_id ? '<div class="mt-1"><small class="text-muted">At charging station</small></div>' : ''}
            </div>`;
    }

    _formatStatus(status) {
        const map = {
            idle: 'Idle', assigned: 'Assigned', picking_up: 'Picking Up',
            delivering: 'Delivering', charging: 'Charging', low_battery: '⚠ Low Battery',
            available: 'Available', busy: 'Busy', maintenance: 'Maintenance'
        };
        return map[status] || status;
    }

    // ── Marker: Charging Station ───────────────────────────────────────────────
    addChargingStationMarker(id, lat, lng, info = {}) {
        const marker = L.marker([lat, lng], { icon: this.chargingStationIcon }).addTo(this.map);
        marker.bindPopup(`
            <div style="min-width:160px;">
                <h6 class="mb-1"><strong>⚡ ${info.name || 'Charging Station'}</strong></h6>
                <div class="mb-1"><small>${info.location || ''}</small></div>
                <div>Capacity: <strong>${info.capacity || '?'} drones</strong></div>
                ${info.drones_charging !== undefined ? `<div>Charging now: <strong>${info.drones_charging}</strong></div>` : ''}
            </div>`);
        this.markers.set(`station-${id}`, marker);
        return marker;
    }

    // ── Marker: Warehouse ──────────────────────────────────────────────────────
    addWarehouseMarker(id, lat, lng, info = {}) {
        const marker = L.marker([lat, lng], { icon: this.warehouseIcon }).addTo(this.map);
        marker.bindPopup(`
            <div class="warehouse-popup">
                <h6><strong>${info.name || 'Warehouse ' + id}</strong></h6>
                <p class="mb-1">${info.location || ''}</p>
                ${info.products ? `<p class="mb-0"><small>${info.products}</small></p>` : ''}
            </div>`);
        this.markers.set(`warehouse-${id}`, marker);
        return marker;
    }

    // ── Marker: Delivery ───────────────────────────────────────────────────────
    addDeliveryMarker(lat, lng, info = {}) {
        const marker = L.marker([lat, lng], { icon: this.deliveryIcon }).addTo(this.map);
        marker.bindPopup(`
            <div class="delivery-popup">
                <h6><strong>Delivery Location</strong></h6>
                <p class="mb-0">${info.address || lat.toFixed(5) + ', ' + lng.toFixed(5)}</p>
            </div>`);
        this.markers.set('delivery', marker);
        return marker;
    }

    addUserLocationMarker(lat, lng) {
        const marker = L.marker([lat, lng], { icon: this.userIcon }).addTo(this.map);
        marker.bindPopup('<strong>Your Location</strong>');
        this.markers.set('user', marker);
        return marker;
    }

    // ── Update drone position + popup ──────────────────────────────────────────
    updateDronePosition(id, lat, lng, info = {}) {
        const key = `drone-${id}`;
        const marker = this.markers.get(key);
        if (marker) {
            marker.setLatLng([lat, lng]);
            marker.setIcon(this._getDroneIcon(info.status));
            if (Object.keys(info).length > 0) {
                marker.setPopupContent(this._buildDronePopup(id, info));
            }
        } else {
            this.addDroneMarker(id, lat, lng, info);
        }
    }

    // ── Routes ─────────────────────────────────────────────────────────────────
    drawRoute(coordinates, options = {}) {
        const opts = { color: '#007bff', weight: 4, opacity: 0.8, ...options };
        const route = L.polyline(coordinates, opts).addTo(this.map);
        this.routes.push(route);
        return route;
    }

    clearRoutes() {
        this.routes.forEach(r => this.map.removeLayer(r));
        this.routes = [];
    }

    removeMarker(id) {
        const marker = this.markers.get(id);
        if (marker) {
            this.map.removeLayer(marker);
            this.markers.delete(id);
        }
    }

    fitBounds(padding = 0.02) {
        if (this.markers.size > 0) {
            const group = new L.featureGroup(Array.from(this.markers.values()));
            this.map.fitBounds(group.getBounds().pad(padding));
        }
    }

    // ── Colour helpers ─────────────────────────────────────────────────────────
    getDroneStatusColor(status) {
        const map = {
            idle: 'success', available: 'success',
            assigned: 'primary', picking_up: 'info',
            delivering: 'warning', low_battery: 'danger',
            charging: 'warning', busy: 'warning', maintenance: 'danger'
        };
        return map[status] || 'secondary';
    }

    getBatteryColor(level) {
        if (level >= 60) return 'success';
        if (level >= 30) return 'warning';
        return 'danger';
    }

    // ── Drone movement animation ───────────────────────────────────────────────
    animateDroneMovement(droneId, fromCoords, toCoords, duration = 2000) {
        const marker = this.markers.get(`drone-${droneId}`);
        if (!marker) return;

        const startTime = Date.now();
        const [startLat, startLng] = fromCoords;
        const [endLat, endLng] = toCoords;

        const trail = L.polyline([], {
            color: '#ffc107', weight: 2, opacity: 0.7, dashArray: '4, 8'
        }).addTo(this.map);
        const trailPts = [];

        const animate = () => {
            const t = Math.min((Date.now() - startTime) / duration, 1);
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

            const lat = startLat + (endLat - startLat) * eased;
            const lng = startLng + (endLng - startLng) * eased;
            marker.setLatLng([lat, lng]);
            trailPts.push([lat, lng]);
            trail.setLatLngs(trailPts);

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                setTimeout(() => this.map.removeLayer(trail), 3000);
            }
        };
        requestAnimationFrame(animate);
    }
}


// ── Delivery Location Map ──────────────────────────────────────────────────────
class DeliveryLocationMapManager extends MapManager {
    constructor(containerId) {
        super(containerId, { center: [30.3165, 78.0322], zoom: 13 });
        this.deliveryMarker = null;
        this.onLocationSelected = null;
    }

    init() {
        super.init();
        this.setupMapClickHandler();
        this.loadWarehouses();
        return this;
    }

    setupMapClickHandler() {
        this.map.on('click', (e) => this.setDeliveryLocation(e.latlng.lat, e.latlng.lng));
    }

    setDeliveryLocation(lat, lng) {
        if (this.deliveryMarker) this.map.removeLayer(this.deliveryMarker);

        this.deliveryMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                html: `<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4));">📍</div>`,
                className: 'delivery-pin',
                iconSize: [28, 28],
                iconAnchor: [14, 28]
            })
        }).addTo(this.map);

        this.deliveryMarker.bindPopup(
            `<div class="text-center"><strong>Delivery Location</strong><br>
             <small class="text-muted">${lat.toFixed(6)}, ${lng.toFixed(6)}</small></div>`
        ).openPopup();

        document.getElementById('delivery_lat').value = lat;
        document.getElementById('delivery_lng').value = lng;

        const preview = document.getElementById('locationPreview');
        const coords  = document.getElementById('locationCoords');
        if (preview && coords) {
            coords.textContent = `Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            preview.classList.remove('d-none');
        }

        if (this.onLocationSelected) this.onLocationSelected(lat, lng);
    }

    setCurrentLocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    this.map.setView([pos.coords.latitude, pos.coords.longitude], 15);
                    this.setDeliveryLocation(pos.coords.latitude, pos.coords.longitude);
                },
                () => alert('Unable to get location. Click the map to set delivery point.')
            );
        } else {
            alert('Geolocation not supported. Click the map to set delivery point.');
        }
    }

    async loadWarehouses() {
        const warehouses = [
            { id: 1, name: 'Electronics Hub',    lat: 30.3183, lng: 78.0338 },
            { id: 2, name: 'Medical Supplies',   lat: 30.3255, lng: 78.0367 },
            { id: 3, name: 'Fresh Foods',        lat: 30.3204, lng: 78.0301 },
            { id: 4, name: 'Books & Stationery', lat: 30.3596, lng: 78.0815 },
            { id: 5, name: 'Grocery Store',      lat: 30.3177, lng: 78.0339 },
            { id: 6, name: 'Fashion Hub',        lat: 30.3089, lng: 78.0435 },
            { id: 7, name: 'Sports Center',      lat: 30.3290, lng: 78.0267 },
            { id: 8, name: 'Tech Plaza',         lat: 30.3134, lng: 78.0404 },
            { id: 9, name: 'Home & Garden',      lat: 30.3076, lng: 78.0272 },
            { id: 10, name: 'Pharmacy Plus',     lat: 30.3445, lng: 78.0661 },
        ];
        warehouses.forEach(w => this.addWarehouseMarker(w.id, w.lat, w.lng, w));
    }
}


// ── Dashboard Map (Customer-facing) ────────────────────────────────────────────
// Shows: warehouses + charging stations + BUSY drones only (delivering/picking_up/assigned)
// Hides: idle, charging, low_battery drones (internal fleet status not shown to customers)
class DashboardMapManager extends MapManager {
    constructor(containerId) {
        super(containerId, { center: [30.3165, 78.0322], zoom: 12 });
        this.loadInitialData();
    }

    async loadInitialData() {
        try {
            await this.loadChargingStations();
            await this.loadWarehouses();
            await this.loadBusyDrones();
            this.fitBounds();
        } catch (err) {
            console.error('Map load error:', err);
        }
    }

    async loadChargingStations() {
        try {
            const res = await fetch('/api/charging_stations');
            if (res.ok) {
                const stations = await res.json();
                stations.forEach(s => this.addChargingStationMarker(s.id, s.lat, s.lng, s));
                return;
            }
        } catch (e) { /* fallback */ }
        const fallback = [
            { id: 1, name: 'Central Charging Hub',  location: 'Paltan Bazaar', lat: 30.3165, lng: 78.0322, capacity: 4 },
            { id: 2, name: 'North Charging Station', location: 'Rajpur Road',   lat: 30.3545, lng: 78.0762, capacity: 3 },
            { id: 3, name: 'South Charging Station', location: 'Karanpur',      lat: 30.3076, lng: 78.0272, capacity: 3 },
        ];
        fallback.forEach(s => this.addChargingStationMarker(s.id, s.lat, s.lng, s));
    }

    async loadWarehouses() {
        const warehouses = [
            { id: 1,  name: 'Electronics Hub',    location: 'Dehradun Central', lat: 30.3183, lng: 78.0338, products: 'Laptops, Smartphones' },
            { id: 2,  name: 'Medical Center',     location: 'ISBT Dehradun',    lat: 30.3255, lng: 78.0367, products: 'Medicines, First Aid' },
            { id: 3,  name: 'Food Court',         location: 'Paltan Bazaar',    lat: 30.3204, lng: 78.0301, products: 'Snacks, Beverages' },
            { id: 4,  name: 'Books & Stationery', location: 'Rajpur Road',      lat: 30.3596, lng: 78.0815, products: 'Books, Notebooks' },
            { id: 5,  name: 'Grocery Store',      location: 'Clock Tower',      lat: 30.3177, lng: 78.0339, products: 'Groceries, Vegetables' },
            { id: 6,  name: 'Fashion Hub',        location: 'Ashley Hall',      lat: 30.3089, lng: 78.0435, products: 'Clothing, Accessories' },
            { id: 7,  name: 'Sports Center',      location: 'Rispana',          lat: 30.3290, lng: 78.0267, products: 'Sports Equipment' },
            { id: 8,  name: 'Tech Plaza',         location: 'Gandhi Road',      lat: 30.3134, lng: 78.0404, products: 'Computer Parts, Gadgets' },
            { id: 9,  name: 'Home & Garden',      location: 'Karanpur',         lat: 30.3076, lng: 78.0272, products: 'Furniture, Decor' },
            { id: 10, name: 'Pharmacy Plus',      location: 'Rajpur Road',      lat: 30.3565, lng: 78.0790, products: 'Medicines, Cosmetics' },
        ];
        warehouses.forEach(w => this.addWarehouseMarker(w.id, w.lat, w.lng, w));
    }

    // Customer-safe drone popup — shows only battery %, no internal state
    _buildCustomerDronePopup(id, info) {
        const battery = info.battery_level ?? 0;
        const color = this.getBatteryColor(battery);
        return `
            <div class="drone-popup" style="min-width:160px;">
                <h6 class="mb-2"><strong>🚁 ${info.name || 'Drone ' + id}</strong></h6>
                <div class="mb-1" style="font-size:13px;">Currently delivering a package</div>
                <div class="mb-1" style="font-size:12px;">Battery: <strong>${battery}%</strong></div>
                <div class="progress" style="height:6px;border-radius:3px;">
                    <div class="progress-bar bg-${color}" style="width:${battery}%;transition:width .3s;"></div>
                </div>
            </div>`;
    }

    async loadBusyDrones() {
        const busyStatuses = new Set(['delivering', 'picking_up', 'assigned', 'low_battery']);
        try {
            const res = await fetch('/api/drones');
            if (res.ok) {
                const drones = await res.json();
                drones
                    .filter(d => busyStatuses.has(d.status) && d.current_lat && d.current_lng)
                    .forEach(d => {
                        const marker = L.marker([d.current_lat, d.current_lng], { icon: this.droneIcon }).addTo(this.map);
                        marker.bindPopup(this._buildCustomerDronePopup(d.id, d));
                        this.markers.set(`drone-${d.id}`, marker);
                    });
                return;
            }
        } catch (e) { /* no fallback needed — just show no drones if API fails */ }
    }

    refreshDroneData() {
        Array.from(this.markers.keys())
            .filter(k => k.startsWith('drone-'))
            .forEach(k => {
                this.map.removeLayer(this.markers.get(k));
                this.markers.delete(k);
            });
        this.loadBusyDrones();
    }
}
