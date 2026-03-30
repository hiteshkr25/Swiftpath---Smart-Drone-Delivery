// ─── Order Tracking Manager ────────────────────────────────────────────────────
class OrderTrackingManager {
    constructor(orderId, mapContainerId, userType = 'customer') {
        this.orderId = orderId;
        this.mapContainerId = mapContainerId;
        this.userType = userType;           // 'customer' | 'admin' | 'vendor'
        this.isAdmin = (userType === 'admin' || userType === 'vendor');
        this.map = null;
        this.updateInterval = null;
        this.lastKnownPosition = null;
        this.lastBattery = null;
        this.algorithmAnimated = false;

        this.init();
    }

    init() {
        this.initializeMap();
        this.startTracking();
        this.bindEvents();
        // Start algorithm visualization after a short delay
        setTimeout(() => this.initializeAlgorithmVisualizations(), 800);
    }

    initializeMap() {
        this.map = new MapManager(this.mapContainerId, {
            center: [30.3165, 78.0322],
            zoom: 13
        });
        // Always show charging stations on the tracking map
        this.loadChargingStations();
    }

    async loadChargingStations() {
        try {
            const res = await fetch('/api/charging_stations');
            if (res.ok) {
                const stations = await res.json();
                stations.forEach(s => this.map.addChargingStationMarker(s.id, s.lat, s.lng, s));
            }
        } catch (e) {
            // Fallback: static stations
            const fallback = [
                { id: 1, name: 'Central Charging Hub',   location: 'Paltan Bazaar', lat: 30.3165, lng: 78.0322, capacity: 4 },
                { id: 2, name: 'North Charging Station',  location: 'Rajpur Road',   lat: 30.3545, lng: 78.0762, capacity: 3 },
                { id: 3, name: 'South Charging Station',  location: 'Karanpur',      lat: 30.3076, lng: 78.0272, capacity: 3 },
            ];
            fallback.forEach(s => this.map.addChargingStationMarker(s.id, s.lat, s.lng, s));
        }
    }

    // ─── Tracking loop ──────────────────────────────────────────────────────────
    async startTracking() {
        try {
            await this.updateOrderStatus();
            this.updateInterval = setInterval(() => this.updateOrderStatus(), 2000);
        } catch (err) {
            console.error('Tracking start error:', err);
            this.showError('Failed to start order tracking');
        }
    }

    async updateOrderStatus() {
        try {
            const res = await fetch(`/api/order_status/${this.orderId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            this.updateUI(data);
            this.updateMap(data);
            this.updateEventLog(data.recent_events || []);

            // Stop polling once delivered
            if (data.status === 'delivered' && this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }
        } catch (err) {
            console.error('Update error:', err);
        }
    }

    // ─── UI updates ─────────────────────────────────────────────────────────────
    updateUI(data) {
        // Status badge
        const statusBadge = document.getElementById('orderStatus');
        if (statusBadge) {
            statusBadge.textContent = this._formatOrderStatus(data.status);
            statusBadge.className = `order-status ${data.status}`;
        }

        // Progress bar
        const pct = Math.round(data.progress_percentage);
        const progressBar = document.getElementById('progressBar');
        if (progressBar) {
            progressBar.style.width = `${pct}%`;
            progressBar.setAttribute('aria-valuenow', pct);
        }
        const progressText = document.getElementById('progressText');
        if (progressText) progressText.textContent = `${pct}%`;

        // Estimated delivery
        const deliveryEl = document.getElementById('estimatedDelivery');
        if (deliveryEl && data.estimated_delivery) {
            deliveryEl.textContent = this.formatTimeIST(new Date(data.estimated_delivery));
        }

        // Battery with animation
        this.updateBatteryDisplay(data.drone_battery, data.drone_status);

        // Drone state panel
        this.updateDroneStatePanel(data);

        // Next destination
        const nextDest = document.getElementById('nextDestination');
        if (nextDest) {
            const stop = this.getNextDestination(data);
            nextDest.innerHTML = `
                <div class="d-flex align-items-center">
                    <span style="font-size:18px;margin-right:8px;">🧭</span>
                    <div>
                        <strong>Next Stop:</strong><br>
                        <small class="text-muted">${stop}</small>
                    </div>
                </div>`;
        }

        this.updateStatusTimeline(data.status, data.progress_percentage);
    }

    updateBatteryDisplay(battery, droneStatus) {
        const batteryLevelEl = document.getElementById('droneBattery');
        const batteryBar     = document.getElementById('batteryBar');
        const batteryIcon    = document.getElementById('batteryIcon');

        if (!batteryLevelEl) return;

        batteryLevelEl.textContent = `${battery}%`;

        // Animate a drop if battery decreased
        if (this.lastBattery !== null && battery < this.lastBattery) {
            batteryLevelEl.classList.add('battery-draining');
            setTimeout(() => batteryLevelEl.classList.remove('battery-draining'), 800);
        }
        this.lastBattery = battery;

        const color = battery >= 60 ? 'success' : battery >= 30 ? 'warning' : 'danger';
        if (batteryBar) {
            batteryBar.style.width = `${battery}%`;
            batteryBar.className = `progress-bar bg-${color}`;
        }

        // Customers see only battery % — no charging/low-battery state icons
        if (batteryIcon) {
            batteryIcon.textContent = '🔋';
            batteryIcon.title = `Battery: ${battery}%`;
        }
    }

    updateDroneStatePanel(data) {
        const panel = document.getElementById('droneStatePanel');
        if (!panel) return;

        const st      = data.drone_status || 'unknown';
        const battery = data.drone_battery || 0;
        const battColor = battery >= 60 ? 'success' : battery >= 30 ? 'warning' : 'danger';

        if (this.isAdmin) {
            // ── Admin view — full state details ──────────────────────────────
            const stateColors = {
                idle: 'success', assigned: 'primary', picking_up: 'info',
                delivering: 'warning', low_battery: 'danger', charging: 'warning'
            };
            const stateLabels = {
                idle: 'Idle', assigned: 'Assigned', picking_up: 'Picking Up',
                delivering: 'Delivering', low_battery: '⚠ Low Battery', charging: 'Charging'
            };
            const stateIcons = {
                idle: '😴', assigned: '📋', picking_up: '📦',
                delivering: '🚁', low_battery: '⚠️', charging: '⚡'
            };
            const color = stateColors[st] || 'secondary';
            const label = stateLabels[st] || st;
            const icon  = stateIcons[st]  || '🚁';

            panel.innerHTML = `
                <div class="drone-state-display">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="fw-semibold">${data.drone_name || 'Drone'}</span>
                        <span class="badge bg-${color}">${icon} ${label}</span>
                    </div>
                    <div class="d-flex align-items-center gap-2 mb-1">
                        <span style="font-size:13px;">🔋 Battery</span>
                        <div class="flex-grow-1">
                            <div class="progress" style="height:10px;border-radius:5px;">
                                <div class="progress-bar bg-${battColor}"
                                     style="width:${battery}%;transition:width .5s ease;"></div>
                            </div>
                        </div>
                        <span class="fw-bold" style="min-width:38px;text-align:right;" id="droneBattery">${battery}%</span>
                    </div>
                    ${battery < 30 ? `
                    <div class="alert alert-danger py-1 px-2 mb-0 mt-2" style="font-size:12px;">
                        ⚠️ Low battery — drone will charge after delivery
                    </div>` : ''}
                    ${st === 'charging' ? `
                    <div class="alert alert-warning py-1 px-2 mb-0 mt-2" style="font-size:12px;">
                        ⚡ Charging… +5% per minute
                    </div>` : ''}
                    <div class="mt-2" style="font-size:12px;color:var(--bs-secondary);">
                        Route distance: <strong>${(data.route_total_distance || 0).toFixed(1)} km</strong>
                    </div>
                </div>`;
        } else {
            // ── Customer view — battery % only, friendly delivery status ─────
            const friendlyLabels = {
                assigned: 'On its way', picking_up: 'Picking up your order',
                delivering: 'Out for delivery', low_battery: 'Out for delivery',
                idle: 'Ready', charging: 'Getting ready'
            };
            const friendlyLabel = friendlyLabels[st] || 'In progress';

            panel.innerHTML = `
                <div class="drone-state-display">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="fw-semibold">🚁 ${data.drone_name || 'Your Drone'}</span>
                        <span class="badge bg-primary">${friendlyLabel}</span>
                    </div>
                    <div class="d-flex align-items-center gap-2 mb-1">
                        <span style="font-size:13px;">🔋 Battery</span>
                        <div class="flex-grow-1">
                            <div class="progress" style="height:10px;border-radius:5px;">
                                <div class="progress-bar bg-${battColor}"
                                     style="width:${battery}%;transition:width .5s ease;"></div>
                            </div>
                        </div>
                        <span class="fw-bold" style="min-width:38px;text-align:right;" id="droneBattery">${battery}%</span>
                    </div>
                    <div class="mt-2" style="font-size:12px;color:var(--bs-secondary);">
                        Estimated route: <strong>${(data.route_total_distance || 0).toFixed(1)} km</strong>
                    </div>
                </div>`;
        }
    }

    updateEventLog(events) {
        const logEl = document.getElementById('eventLog');
        if (!logEl || !events.length) return;

        logEl.innerHTML = events.map(ev => {
            const typeColors = {
                battery_low_event: 'danger',
                drone_charging_started: 'warning',
                delivery_completed: 'success',
                order_assigned: 'primary',
                charging_complete: 'success'
            };
            const color = typeColors[ev.type] || 'secondary';
            return `
                <div class="event-log-item border-start border-${color} border-3 ps-2 mb-2">
                    <div class="d-flex justify-content-between">
                        <small class="fw-semibold text-${color}">${this._formatEventType(ev.type)}</small>
                        <small class="text-muted">${this.formatTimeIST(new Date(ev.time))}</small>
                    </div>
                    <small>${ev.message || ''}</small>
                    ${ev.battery !== null ? `<small class="text-muted"> (${ev.battery}%)</small>` : ''}
                </div>`;
        }).join('');
    }

    _formatEventType(type) {
        const map = {
            battery_low_event: '⚠ Low Battery',
            drone_charging_started: '⚡ Charging Started',
            delivery_completed: '✅ Delivered',
            order_assigned: '📋 Assigned',
            charging_complete: '🔋 Charged'
        };
        return map[type] || type;
    }

    // ─── Map update ─────────────────────────────────────────────────────────────
    updateMap(data) {
        if (!this.map) return;

        this.map.clearRoutes();

        // Draw planned route (dashed grey)
        if (data.route && data.route.length > 1) {
            const coords = data.route.map(p => [p.lat, p.lng]);
            this.map.drawRoute(coords, { color: '#6c757d', weight: 3, opacity: 0.5, dashArray: '6, 8' });

            data.route.forEach(p => {
                if (p.id === 'delivery') {
                    this.map.addDeliveryMarker(p.lat, p.lng, { address: p.name });
                } else {
                    this.map.addWarehouseMarker(p.id, p.lat, p.lng, { name: p.name });
                }
            });
        }

        // Update drone position
        if (data.current_location && data.current_location.lat) {
            const { lat, lng } = data.current_location;
            const droneKey = `order-${this.orderId}`;

            if (this.lastKnownPosition) {
                this.map.animateDroneMovement(droneKey,
                    [this.lastKnownPosition.lat, this.lastKnownPosition.lng],
                    [lat, lng], 1800);
            } else {
                this.map.addDroneMarker(droneKey, lat, lng, {
                    name: data.drone_name || 'Delivery Drone',
                    status: data.drone_status,
                    battery_level: data.drone_battery
                });
            }
            this.lastKnownPosition = { lat, lng };

            // Live route line (blue) from drone to delivery
            if (data.route && data.route.length > 0) {
                const last = data.route[data.route.length - 1];
                this.map.drawRoute([[lat, lng], [last.lat, last.lng]], {
                    color: '#007bff', weight: 4, opacity: 0.85
                });
            }
        }

        this.map.fitBounds();
    }

    // ─── Status timeline ────────────────────────────────────────────────────────
    updateStatusTimeline(currentStatus, progress) {
        const timeline = document.getElementById('statusTimeline');
        if (!timeline) return;

        const steps = ['confirmed', 'in_transit', 'delivered'];
        const labels = { confirmed: 'Order Confirmed', in_transit: 'In Transit', delivered: 'Delivered' };
        const icons  = { confirmed: '✅', in_transit: '🚁', delivered: '📦' };
        const curIdx = steps.indexOf(currentStatus);

        timeline.innerHTML = `<div class="status-timeline">` + steps.map((st, i) => {
            const done = curIdx >= i;
            const cur  = currentStatus === st;
            return `
                <div class="timeline-item ${done ? 'active' : ''} ${cur ? 'current' : ''}">
                    <div class="timeline-marker">${done ? icons[st] : ''}</div>
                    <div class="timeline-content">
                        <h6>${labels[st]}</h6>
                        ${cur ? `<small class="text-muted">${Math.round(progress)}% complete</small>` : ''}
                    </div>
                </div>`;
        }).join('') + `</div>`;
    }

    // ─── Greedy + Dijkstra visualizations ─────────────────────────────────────
    initializeAlgorithmVisualizations() {
        if (this.algorithmAnimated) return;
        this.algorithmAnimated = true;
        this.runGreedyVisualization();
        this.runDijkstraVisualization();
    }

    runGreedyVisualization() {
        const container = document.getElementById('greedyVisualization');
        if (!container) return;

        // Realistic drone fleet with distances from delivery point
        const drones = [
            { id: 1,  name: 'Swift-Alpha',   dist: 2.8, battery: 100, status: 'idle' },
            { id: 2,  name: 'Swift-Beta',     dist: 1.5, battery: 100, status: 'idle' },
            { id: 3,  name: 'Swift-Gamma',    dist: 3.1, battery: 65,  status: 'charging' },
            { id: 4,  name: 'Swift-Delta',    dist: 0.9, battery: 100, status: 'idle' },
            { id: 5,  name: 'Swift-Echo',     dist: 4.2, battery: 100, status: 'idle' },
            { id: 6,  name: 'Swift-Foxtrot',  dist: 2.1, battery: 90,  status: 'idle' },
            { id: 7,  name: 'Swift-Golf',     dist: 1.8, battery: 40,  status: 'charging' },
            { id: 8,  name: 'Swift-Hotel',    dist: 5.0, battery: 100, status: 'idle' },
            { id: 9,  name: 'Swift-India',    dist: 3.5, battery: 55,  status: 'charging' },
            { id: 10, name: 'Swift-Juliet',   dist: 2.4, battery: 100, status: 'idle' },
        ];
        const tripDist = 6.2; // estimated total trip km
        const batteryNeeded = tripDist * 1 + 10; // 1%/km + 10% buffer

        const eligible = drones.filter(d => d.status === 'idle' && d.battery > 30 && d.battery >= batteryNeeded + 30);
        const selected = eligible.sort((a, b) => a.dist - b.dist)[0];

        const steps = [
            { label: 'Scanning all 10 drones in fleet…', action: 'scan' },
            { label: `Battery check: need ≥ ${batteryNeeded.toFixed(0)}% (trip: ${tripDist} km + 10% buffer)`, action: 'battery' },
            { label: 'Sorting eligible drones by proximity (Greedy)…', action: 'sort' },
            { label: `✅ Selected: ${selected.name} (${selected.dist} km away, ${selected.battery}% battery)`, action: 'done' },
        ];

        let step = 0;
        container.innerHTML = `
            <div id="greedyStepLabel" class="algorithm-step active mb-2">
                <small><strong>Step 1:</strong> ${steps[0].label}</small>
            </div>
            <div id="greedyDroneList"></div>`;

        const tick = setInterval(() => {
            step++;
            if (step >= steps.length) { clearInterval(tick); return; }

            const labelEl = document.getElementById('greedyStepLabel');
            if (labelEl) {
                labelEl.innerHTML = `<small><strong>Step ${step + 1}:</strong> ${steps[step].label}</small>`;
                if (step === steps.length - 1) labelEl.classList.add('completed');
            }

            if (steps[step].action === 'battery' || steps[step].action === 'sort') {
                this._renderDroneCandidates(drones, batteryNeeded, selected, steps[step].action);
            }
            if (steps[step].action === 'done') {
                this._renderGreedyResult(selected, container);
            }
        }, 2200);
    }

    _renderDroneCandidates(drones, batteryNeeded, selected, phase) {
        const list = document.getElementById('greedyDroneList');
        if (!list) return;

        const sorted = phase === 'sort'
            ? [...drones].filter(d => d.status === 'idle' && d.battery >= batteryNeeded + 30).sort((a, b) => a.dist - b.dist)
            : drones;

        list.innerHTML = sorted.map(d => {
            const eligible = d.status === 'idle' && d.battery >= batteryNeeded + 30;
            const isSelected = selected && d.id === selected.id && phase === 'sort';
            const cls = isSelected ? 'selected' : (!eligible ? 'rejected' : '');
            const battColor = d.battery >= 60 ? 'success' : d.battery >= 30 ? 'warning' : 'danger';
            return `
                <div class="drone-candidate ${cls}" style="font-size:12px;padding:6px 8px;margin:3px 0;">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${isSelected ? '⭐ ' : ''}${d.name}</strong>
                            <span class="ms-2 badge bg-${eligible ? 'success' : 'secondary'}" style="font-size:10px;">${d.status}</span>
                        </div>
                        <div class="text-end">
                            <span class="badge bg-${battColor}">${d.battery}%</span>
                            <br><small class="text-muted">${d.dist} km</small>
                        </div>
                    </div>
                </div>`;
        }).join('');
    }

    _renderGreedyResult(selected, container) {
        container.innerHTML += `
            <div class="alert alert-success py-2 px-3 mt-2 mb-0" style="font-size:12px;">
                <strong>🚁 ${selected.name} dispatched</strong><br>
                Distance: ${selected.dist} km · Battery: ${selected.battery}%
            </div>`;
    }

    runDijkstraVisualization() {
        const container = document.getElementById('dijkstraVisualization');
        if (!container) return;

        // Simulate warehouses and route nodes
        const nodes = [
            { id: 'drone',     label: 'Swift-Delta (Start)', dist: 0,        prev: null },
            { id: 'wh1',       label: 'Electronics Hub',     dist: Infinity,  prev: null },
            { id: 'wh2',       label: 'Grocery Store',       dist: Infinity,  prev: null },
            { id: 'wh3',       label: 'Medical Center',      dist: Infinity,  prev: null },
            { id: 'delivery',  label: 'Delivery Location',   dist: Infinity,  prev: null },
        ];

        // Simulated Dijkstra steps: [node relaxed, new distance, from]
        const relaxSteps = [
            { nodeId: 'wh1',      dist: 0.9,  from: 'drone' },
            { nodeId: 'wh2',      dist: 1.4,  from: 'drone' },
            { nodeId: 'wh3',      dist: 2.1,  from: 'wh1'   },
            { nodeId: 'delivery', dist: 3.6,  from: 'wh3'   },
        ];

        const dijkSteps = [
            { label: 'Init: all distances = ∞, start = 0 km', action: 'init' },
            { label: 'Relaxing edges from drone position…',    action: 'relax0' },
            { label: 'Visit nearest node → Electronics Hub',  action: 'relax1' },
            { label: 'Continue relaxing → Grocery, Medical…', action: 'relax2' },
            { label: `✅ Optimal path found (${relaxSteps[relaxSteps.length-1].dist} km total)`, action: 'done' },
        ];

        let step = 0;
        container.innerHTML = `
            <div id="dijkStepLabel" class="algorithm-step active mb-2">
                <small><strong>Step 1:</strong> ${dijkSteps[0].label}</small>
            </div>
            <div id="dijkNodeList"></div>`;

        this._renderDijkstraNodes(nodes);

        const tick = setInterval(() => {
            step++;
            if (step >= dijkSteps.length) { clearInterval(tick); return; }

            const labelEl = document.getElementById('dijkStepLabel');
            if (labelEl) {
                labelEl.innerHTML = `<small><strong>Step ${step + 1}:</strong> ${dijkSteps[step].label}</small>`;
                if (step === dijkSteps.length - 1) labelEl.classList.add('completed');
            }

            if (step >= 1 && step <= relaxSteps.length) {
                const r = relaxSteps[step - 1];
                const node = nodes.find(n => n.id === r.nodeId);
                if (node) { node.dist = r.dist; node.prev = r.from; }
                this._renderDijkstraNodes(nodes, r.nodeId);
            }

            if (dijkSteps[step].action === 'done') {
                this._renderDijkstraResult(container);
            }
        }, 2500);
    }

    _renderDijkstraNodes(nodes, activeId) {
        const list = document.getElementById('dijkNodeList');
        if (!list) return;
        list.innerHTML = nodes.map(n => {
            const isCurrent = n.id === activeId;
            const visited   = n.dist < Infinity;
            const cls = isCurrent ? 'current' : visited ? 'completed' : '';
            return `
                <div class="route-step ${cls}" style="font-size:12px;padding:5px 8px;margin:3px 0;">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            ${isCurrent ? '➡️ ' : visited ? '✅ ' : '⬜ '}
                            <strong>${n.label}</strong>
                            ${n.prev ? `<small class="text-muted"> ← ${n.prev}</small>` : ''}
                        </div>
                        <span class="badge bg-${visited ? 'success' : 'secondary'}">
                            ${n.dist === Infinity ? '∞' : n.dist.toFixed(1) + ' km'}
                        </span>
                    </div>
                </div>`;
        }).join('');
    }

    _renderDijkstraResult(container) {
        container.innerHTML += `
            <div class="alert alert-success py-2 px-3 mt-2 mb-0" style="font-size:12px;">
                <strong>📍 Optimal Route:</strong><br>
                Drone → Electronics Hub (0.9 km) → Medical Center (2.1 km) → Delivery (3.6 km total)
            </div>`;
    }

    // ─── Next destination helper ────────────────────────────────────────────────
    getNextDestination(data) {
        if (data.status === 'delivered') return '✅ Order delivered!';
        if (data.status === 'pending')   return 'Awaiting confirmation…';
        if (!data.route || !data.route.length) return 'Calculating route…';

        const progress = data.progress_percentage || 0;
        const route    = data.route;
        const total    = route.length - 1;
        const segIdx   = Math.min(Math.floor((progress / 100) * total), total - 1);
        const next     = route[segIdx + 1];
        if (!next) return 'Arriving…';
        return next.id === 'delivery' ? '📍 Your delivery location' : `📦 ${next.name}`;
    }

    // ─── Event log ─────────────────────────────────────────────────────────────
    // (already handled in updateEventLog above)

    // ─── Helpers ────────────────────────────────────────────────────────────────
    _formatOrderStatus(status) {
        const m = {
            pending: 'Pending', confirmed: 'Confirmed', in_transit: 'In Transit',
            delivered: 'Delivered', cancelled: 'Cancelled'
        };
        return m[status] || status;
    }

    formatDateTime(date) {
        return new Intl.DateTimeFormat('en-IN', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            timeZone: 'Asia/Kolkata'
        }).format(date) + ' IST';
    }

    formatTimeIST(date) {
        return new Intl.DateTimeFormat('en-IN', {
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Asia/Kolkata'
        }).format(date) + ' IST';
    }

    showError(msg) {
        const el = document.getElementById('errorContainer');
        if (el) {
            el.innerHTML = `
                <div class="alert alert-danger alert-dismissible fade show">
                    ⚠ ${msg}
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                </div>`;
        }
    }

    bindEvents() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.updateOrderStatus();
                const orig = refreshBtn.innerHTML;
                refreshBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
                refreshBtn.disabled = true;
                setTimeout(() => {
                    refreshBtn.innerHTML = orig;
                    refreshBtn.disabled = false;
                    if (typeof feather !== 'undefined') feather.replace();
                }, 1000);
            });
        }

        const autoToggle = document.getElementById('autoRefreshToggle');
        if (autoToggle) {
            autoToggle.addEventListener('change', (e) => {
                if (e.target.checked) this.startTracking();
                else this.stopTracking();
            });
        }
    }

    stopTracking() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    destroy() {
        this.stopTracking();
        this.map = null;
    }
}


// ─── Admin Order Manager ───────────────────────────────────────────────────────
class AdminOrderManager {
    constructor() {
        this.bindEvents();
    }

    bindEvents() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('.approve-order-btn')) {
                const btn = e.target.closest('.approve-order-btn');
                this.approveOrder(btn.dataset.orderId, btn);
            }
            if (e.target.closest('.deny-order-btn')) {
                const btn = e.target.closest('.deny-order-btn');
                this.denyOrder(btn.dataset.orderId, btn);
            }
        });

        const refreshBtn = document.getElementById('refreshDronesBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshFleetData());
    }

    async approveOrder(orderId, button) {
        const orig = button.innerHTML;
        button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        button.disabled = true;

        try {
            const res = await fetch(`/api/approve_order/${orderId}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                button.innerHTML = '✅ Approved';
                button.classList.replace('btn-outline-success', 'btn-success');
                setTimeout(() => location.reload(), 1500);
            } else {
                button.innerHTML = orig;
                button.disabled = false;
            }
        } catch {
            button.innerHTML = orig;
            button.disabled = false;
        }
    }

    async denyOrder(orderId, button) {
        const orig = button.innerHTML;
        button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
        button.disabled = true;

        try {
            const res = await fetch(`/api/deny_order/${orderId}`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                button.innerHTML = '❌ Denied';
                button.classList.replace('btn-outline-danger', 'btn-danger');
                setTimeout(() => location.reload(), 1500);
            } else {
                button.innerHTML = orig;
                button.disabled = false;
            }
        } catch {
            button.innerHTML = orig;
            button.disabled = false;
        }
    }

    async refreshFleetData() {
        try {
            const res = await fetch('/api/drone_fleet');
            if (!res.ok) return;
            const fleet = await res.json();
            this.renderFleetTable(fleet);
        } catch (e) {
            console.error('Fleet refresh error:', e);
        }
    }

    renderFleetTable(fleet) {
        const container = document.getElementById('fleetTableBody');
        if (!container) return;

        const stateColors = {
            idle: 'success', assigned: 'primary', picking_up: 'info',
            delivering: 'warning', low_battery: 'danger', charging: 'warning'
        };

        container.innerHTML = fleet.map(d => {
            const color = stateColors[d.status] || 'secondary';
            const battColor = d.battery_level >= 60 ? 'success' : d.battery_level >= 30 ? 'warning' : 'danger';
            return `
                <tr>
                    <td><strong>${d.name}</strong></td>
                    <td><span class="badge bg-${color}">${d.status}</span></td>
                    <td>
                        <div class="d-flex align-items-center gap-2">
                            <div class="progress flex-grow-1" style="height:8px;">
                                <div class="progress-bar bg-${battColor}" style="width:${d.battery_level}%"></div>
                            </div>
                            <small>${d.battery_level}%</small>
                        </div>
                    </td>
                    <td><small>${d.station_name || 'N/A'}</small></td>
                    <td><small>${d.recent_events && d.recent_events[0] ? d.recent_events[0].message : '—'}</small></td>
                </tr>`;
        }).join('');
    }
}
