from flask import render_template, request, redirect, url_for, flash, jsonify, session
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from app import app, db
from models import User, Order, Drone, Warehouse, DeliveryRoute, ChargingStation, DroneEvent
import json
import heapq
import math
from datetime import datetime, timedelta
import logging

logging.basicConfig(level=logging.DEBUG)

# ─── Constants ────────────────────────────────────────────────────────────────

BATTERY_DRAIN_PER_KM = 1.0 / 3.0   # 1% per 3 km of flight
BATTERY_CHARGE_PER_MIN = 5.0        # 5% per minute when charging
LOW_BATTERY_THRESHOLD = 10.0        # trigger mid-flight handoff below this
CHARGE_TARGET = 100.0               # always charge to 100% before going idle
DELIVERY_SIMULATION_MINUTES = 20    # simulated delivery window

# Fixed charging stations across Dehradun
CHARGING_STATION_DATA = [
    {'id': 1, 'name': 'Central Charging Hub', 'location': 'Paltan Bazaar', 'lat': 30.3165, 'lng': 78.0322, 'capacity': 4},
    {'id': 2, 'name': 'North Charging Station', 'location': 'Rajpur Road', 'lat': 30.3545, 'lng': 78.0762, 'capacity': 3},
    {'id': 3, 'name': 'South Charging Station', 'location': 'Karanpur', 'lat': 30.3076, 'lng': 78.0272, 'capacity': 3},
]

# 10-drone fleet data for seeding
DRONE_FLEET_DATA = [
    {'name': 'Swift-Alpha',   'station_idx': 0},
    {'name': 'Swift-Beta',    'station_idx': 0},
    {'name': 'Swift-Gamma',   'station_idx': 0},
    {'name': 'Swift-Delta',   'station_idx': 0},
    {'name': 'Swift-Echo',    'station_idx': 1},
    {'name': 'Swift-Foxtrot', 'station_idx': 1},
    {'name': 'Swift-Golf',    'station_idx': 1},
    {'name': 'Swift-Hotel',   'station_idx': 2},
    {'name': 'Swift-India',   'station_idx': 2},
    {'name': 'Swift-Juliet',  'station_idx': 2},
]

WAREHOUSE_SEED_DATA = [
    {'name': 'Electronics Hub',   'location': 'Dehradun Central',  'lat': 30.3183, 'lng': 78.0338, 'products': 'Laptops,Smartphones,Tablets,Chargers'},
    {'name': 'Medical Center',    'location': 'ISBT Dehradun',     'lat': 30.3255, 'lng': 78.0367, 'products': 'Medicines,First Aid,Health Supplements'},
    {'name': 'Food Court',        'location': 'Paltan Bazaar',     'lat': 30.3204, 'lng': 78.0301, 'products': 'Snacks,Beverages,Fast Food'},
    {'name': 'Books & Stationery','location': 'Rajpur Road',       'lat': 30.3596, 'lng': 78.0815, 'products': 'Books,Notebooks,Pens,Art Supplies'},
    {'name': 'Grocery Store',     'location': 'Clock Tower',       'lat': 30.3177, 'lng': 78.0339, 'products': 'Groceries,Vegetables,Fruits,Dairy'},
    {'name': 'Fashion Hub',       'location': 'Ashley Hall',       'lat': 30.3089, 'lng': 78.0435, 'products': 'Clothing,Accessories,Shoes'},
    {'name': 'Sports Center',     'location': 'Rispana',           'lat': 30.3290, 'lng': 78.0267, 'products': 'Sports Equipment,Fitness Gear,Apparel & Merchandise'},
    {'name': 'Tech Plaza',        'location': 'Gandhi Road',       'lat': 30.3134, 'lng': 78.0404, 'products': 'Computer Parts,Gadgets,Cables'},
    {'name': 'Home & Garden',     'location': 'Karanpur',          'lat': 30.3076, 'lng': 78.0272, 'products': 'Furniture,Garden Tools,Decor'},
    {'name': 'Pharmacy Plus',     'location': 'Rajpur Road',       'lat': 30.3565, 'lng': 78.0790, 'products': 'Medicines,Cosmetics,Health Products'},
]


# ─── Database Seeding ─────────────────────────────────────────────────────────

def seed_database():
    """Seed charging stations, warehouses and drones if not present."""
    # Charging stations
    if ChargingStation.query.count() == 0:
        for cs in CHARGING_STATION_DATA:
            station = ChargingStation(
                name=cs['name'], location=cs['location'],
                lat=cs['lat'], lng=cs['lng'], capacity=cs['capacity']
            )
            db.session.add(station)
        db.session.flush()
        logging.info('Seeded charging stations')

    # Warehouses
    if Warehouse.query.count() == 0:
        for w in WAREHOUSE_SEED_DATA:
            warehouse = Warehouse(
                name=w['name'], location=w['location'],
                lat=w['lat'], lng=w['lng'], products=w['products']
            )
            db.session.add(warehouse)
        logging.info('Seeded warehouses')

    # Drones
    if Drone.query.count() == 0:
        stations = ChargingStation.query.order_by(ChargingStation.id).all()
        for d in DRONE_FLEET_DATA:
            station = stations[d['station_idx']]
            drone = Drone(
                name=d['name'],
                status='idle',
                battery_level=100.0,
                current_lat=station.lat,
                current_lng=station.lng,
                charging_station_id=station.id,
                last_battery_update=datetime.utcnow()
            )
            db.session.add(drone)
        logging.info('Seeded drone fleet')

    db.session.commit()


# ─── Battery & Charging Helpers ───────────────────────────────────────────────

def calculate_distance(lat1, lng1, lat2, lng2):
    """Haversine distance in km."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def calculate_battery_usage(distance_km):
    """Battery % consumed for a given distance."""
    return distance_km * BATTERY_DRAIN_PER_KM


def find_nearest_charging_station(lat, lng):
    """Return the nearest ChargingStation object."""
    stations = ChargingStation.query.all()
    if not stations:
        return None
    return min(stations, key=lambda s: calculate_distance(lat, lng, s.lat, s.lng))


def log_drone_event(drone, event_type, message, order=None):
    """Persist a drone event to the database."""
    ev = DroneEvent(
        drone_id=drone.id,
        order_id=order.id if order else None,
        event_type=event_type,
        message=message,
        battery_at_event=round(drone.battery_level, 1)
    )
    db.session.add(ev)


def update_charging_drones():
    """Increase battery for all drones currently in 'charging' state.
    Charges at BATTERY_CHARGE_PER_MIN until 100%, then sets idle."""
    now = datetime.utcnow()
    charging_drones = Drone.query.filter_by(status='charging').all()
    for drone in charging_drones:
        if drone.last_battery_update:
            elapsed_minutes = (now - drone.last_battery_update).total_seconds() / 60.0
            charge_gain = elapsed_minutes * BATTERY_CHARGE_PER_MIN
            drone.battery_level = min(100.0, drone.battery_level + charge_gain)
            drone.last_battery_update = now

            if drone.battery_level >= CHARGE_TARGET:
                drone.battery_level = 100.0
                drone.status = 'idle'
                log_drone_event(drone, 'charging_complete',
                                f'{drone.name} fully charged to 100%')
    if charging_drones:
        db.session.commit()


def drain_drone_battery(drone, distance_km, order=None):
    """Drain battery for actual distance flown (1% per 3 km).
    Clamps to 0 — drone physically cannot move below 0%."""
    drain = calculate_battery_usage(distance_km)
    drone.battery_level = max(0.0, drone.battery_level - drain)
    drone.last_battery_update = datetime.utcnow()

    if drone.battery_level <= LOW_BATTERY_THRESHOLD and drone.status == 'delivering':
        drone.status = 'low_battery'
        log_drone_event(drone, 'battery_low_event',
                        f'{drone.name} battery critically low ({drone.battery_level:.1f}%) — handoff needed', order)


def send_drone_to_charge(drone):
    """Send drone to nearest charging station. Always called after delivery or handoff."""
    station = find_nearest_charging_station(drone.current_lat or 30.3165, drone.current_lng or 78.0322)
    if station:
        drone.status = 'charging'
        drone.charging_station_id = station.id
        drone.current_lat = station.lat
        drone.current_lng = station.lng
        drone.last_battery_update = datetime.utcnow()
        log_drone_event(drone, 'drone_charging_started',
                        f'{drone.name} returning to {station.name} to charge ({drone.battery_level:.1f}%)')


def find_handoff_drone(cur_lat, cur_lng, order, progress_pct):
    """Find an idle drone that can complete the remaining delivery route.
    Prioritises: highest battery → nearest to current position."""
    remaining_dist = (order.route_total_distance or 0) * (1.0 - progress_pct / 100.0)
    # Add delivery-to-station return leg
    nearest_station = find_nearest_charging_station(order.delivery_lat, order.delivery_lng)
    if nearest_station:
        remaining_dist += calculate_distance(
            order.delivery_lat, order.delivery_lng, nearest_station.lat, nearest_station.lng)

    battery_needed = calculate_battery_usage(remaining_dist)

    candidates = Drone.query.filter(
        Drone.status == 'idle',
        Drone.battery_level >= battery_needed,
        Drone.id != order.drone_id
    ).all()

    if not candidates:
        return None

    candidates.sort(key=lambda d: (
        -d.battery_level,
        calculate_distance(d.current_lat or cur_lat, d.current_lng or cur_lng, cur_lat, cur_lng)
    ))
    return candidates[0]


# ─── Drone Assignment (Greedy + Battery-Aware) ────────────────────────────────

def assign_drone_based_on_battery(delivery_lat, delivery_lng, warehouses):
    """
    Greedy drone assignment with full round-trip battery check.
    Priority order:
      1. Maximum battery percentage (highest battery first)
      2. Nearest to the first warehouse
      3. Must be idle and have enough battery for full round trip:
         drone → warehouses → delivery → nearest charging station
    Returns the selected Drone or None.
    """
    update_charging_drones()

    candidates = Drone.query.filter_by(status='idle').all()
    if not candidates:
        return None

    first_wh = warehouses[0] if warehouses else {'lat': delivery_lat, 'lng': delivery_lng}
    valid = []

    for drone in candidates:
        drone_lat = drone.current_lat or 30.3165
        drone_lng = drone.current_lng or 78.0322

        # Full round trip: drone → warehouses → delivery → nearest station
        trip_points = [(drone_lat, drone_lng)]
        for wh in warehouses:
            trip_points.append((wh['lat'], wh['lng']))
        trip_points.append((delivery_lat, delivery_lng))

        # Add return leg to nearest charging station from delivery point
        return_station = find_nearest_charging_station(delivery_lat, delivery_lng)
        if return_station:
            trip_points.append((return_station.lat, return_station.lng))

        total_dist = sum(
            calculate_distance(trip_points[i][0], trip_points[i][1],
                               trip_points[i + 1][0], trip_points[i + 1][1])
            for i in range(len(trip_points) - 1)
        )
        battery_needed = calculate_battery_usage(total_dist)

        # Only accept drone if it can complete the full round trip
        if drone.battery_level >= battery_needed:
            dist_to_first_wh = calculate_distance(drone_lat, drone_lng,
                                                  first_wh['lat'], first_wh['lng'])
            valid.append((dist_to_first_wh, drone))

    if not valid:
        return None

    # Priority: highest battery first → nearest to first warehouse second
    valid.sort(key=lambda x: (-x[1].battery_level, x[0]))
    return valid[0][1]


# ─── Route Optimisation (Dijkstra / Nearest-Neighbour) ────────────────────────

def calculate_optimized_route(warehouses, delivery_location):
    """
    Nearest-neighbour TSP over warehouses, ending at delivery.
    Returns ordered list of location dicts and total distance.
    """
    all_locations = warehouses + [delivery_location]
    n = len(all_locations)

    dist_matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                dist_matrix[i][j] = calculate_distance(
                    all_locations[i]['lat'], all_locations[i]['lng'],
                    all_locations[j]['lat'], all_locations[j]['lng']
                )

    visited = [False] * (n - 1)
    route = []
    current = 0
    total_dist = 0.0

    while len(route) < len(warehouses):
        route.append(all_locations[current])
        if current < len(warehouses):
            visited[current] = True

        min_d = float('inf')
        nxt = -1
        for i in range(len(warehouses)):
            if not visited[i] and dist_matrix[current][i] < min_d:
                min_d = dist_matrix[current][i]
                nxt = i

        if nxt == -1:
            break
        total_dist += dist_matrix[current][nxt]
        current = nxt

    # distance from last warehouse to delivery
    if route:
        last = route[-1]
        total_dist += calculate_distance(last['lat'], last['lng'],
                                         delivery_location['lat'], delivery_location['lng'])
    route.append(delivery_location)
    return route, round(total_dist, 2)


# ─── Delivery Simulation ──────────────────────────────────────────────────────

def simulate_drone_progress(order):
    """Simulate drone movement and battery drain based on elapsed time.

    Battery logic:
    - Drained based on actual distance covered since last known position (1% / 3km).
    - If battery hits 0%: drone stops physically. Handoff is attempted.
    - A handoff drone continues from the current position, preserving route progress.

    Post-delivery:
    - Drone always returns to nearest charging station and charges to 100%.
    """
    if not order.confirmed_at:
        return {'lat': 0, 'lng': 0, 'progress': 0}

    total_time = DELIVERY_SIMULATION_MINUTES * 60
    elapsed = (datetime.utcnow() - order.confirmed_at).total_seconds()
    progress_pct = min((elapsed / total_time) * 100, 100)

    route = order.get_optimized_route_list()
    if not route:
        return {'lat': 0, 'lng': 0, 'progress': 0}

    total_segs = len(route) - 1
    if total_segs == 0:
        return {'lat': route[0]['lat'], 'lng': route[0]['lng'], 'progress': progress_pct}

    seg_prog = (progress_pct / 100) * total_segs
    cur_seg  = min(int(seg_prog), total_segs - 1)
    seg_frac = seg_prog - cur_seg

    start_pt = route[cur_seg]
    end_pt   = route[cur_seg + 1]
    cur_lat  = start_pt['lat'] + (end_pt['lat'] - start_pt['lat']) * seg_frac
    cur_lng  = start_pt['lng'] + (end_pt['lng'] - start_pt['lng']) * seg_frac

    # ── Delivery completed ────────────────────────────────────────────────────
    if progress_pct >= 100 and order.status != 'delivered':
        order.status = 'delivered'
        order.delivered_at = datetime.utcnow()

        drone = order.assigned_drone
        if drone:
            drone.current_lat = order.delivery_lat
            drone.current_lng = order.delivery_lng
            log_drone_event(drone, 'delivery_completed',
                            f'{drone.name} completed delivery for order #{order.id}', order)
            # Always return to station and charge to 100%
            send_drone_to_charge(drone)

        db.session.commit()

    # ── Order just left the warehouse (confirmed → in_transit) ────────────────
    elif progress_pct > 0 and order.status == 'confirmed':
        order.status = 'in_transit'
        if order.assigned_drone:
            order.assigned_drone.status = 'delivering'
            order.current_location_lat = cur_lat
            order.current_location_lng = cur_lng
        db.session.commit()

    # ── En route: drain battery based on distance actually covered ────────────
    elif order.status == 'in_transit' and order.assigned_drone:
        drone = order.assigned_drone

        # Battery at 0% — drone physically cannot move → attempt handoff
        if drone.battery_level <= 0:
            rescue = find_handoff_drone(cur_lat, cur_lng, order, progress_pct)
            if rescue:
                original = drone
                # Adjust confirmed_at so simulation continues from current progress
                order.drone_id = rescue.id
                elapsed_so_far = total_time * (progress_pct / 100.0)
                order.confirmed_at = datetime.utcnow() - timedelta(seconds=elapsed_so_far)
                rescue.status = 'delivering'
                rescue.current_lat = cur_lat
                rescue.current_lng = cur_lng
                log_drone_event(rescue, 'handoff_received',
                                f'{rescue.name} took over order #{order.id} at {progress_pct:.0f}% '
                                f'(battery: {rescue.battery_level:.1f}%)', order)
                log_drone_event(original, 'handoff_sent',
                                f'{original.name} handed off order #{order.id} — battery depleted', order)
                send_drone_to_charge(original)
            else:
                # No rescue available — log once, keep order paused
                if drone.status != 'low_battery':
                    drone.status = 'low_battery'
                    log_drone_event(drone, 'delivery_stalled',
                                    f'Order #{order.id} stalled — no rescue drone available', order)
            db.session.commit()
        else:
            # Normal flight: drain battery proportional to actual distance traveled
            prev_lat = order.current_location_lat or cur_lat
            prev_lng = order.current_location_lng or cur_lng
            dist_this_tick = calculate_distance(prev_lat, prev_lng, cur_lat, cur_lng)

            if dist_this_tick > 0:
                drain_drone_battery(drone, dist_this_tick, order)

                # Low battery during flight → try handoff immediately
                if drone.battery_level <= LOW_BATTERY_THRESHOLD:
                    rescue = find_handoff_drone(cur_lat, cur_lng, order, progress_pct)
                    if rescue:
                        original = drone
                        order.drone_id = rescue.id
                        elapsed_so_far = total_time * (progress_pct / 100.0)
                        order.confirmed_at = datetime.utcnow() - timedelta(seconds=elapsed_so_far)
                        rescue.status = 'delivering'
                        rescue.current_lat = cur_lat
                        rescue.current_lng = cur_lng
                        log_drone_event(rescue, 'handoff_received',
                                        f'{rescue.name} took over order #{order.id} at {progress_pct:.0f}% '
                                        f'(battery: {rescue.battery_level:.1f}%)', order)
                        log_drone_event(original, 'handoff_sent',
                                        f'{original.name} handed off — battery {original.battery_level:.1f}%', order)
                        send_drone_to_charge(original)

            order.current_location_lat = cur_lat
            order.current_location_lng = cur_lng
            db.session.commit()

    return {'lat': cur_lat, 'lng': cur_lng, 'progress': round(progress_pct, 1)}


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        email = request.form.get('email')
        password = request.form.get('password')
        full_name = request.form.get('full_name')
        phone = request.form.get('phone')
        user_type = request.form.get('user_type', 'customer')

        if User.query.filter_by(username=username).first():
            flash('Username already exists', 'error')
            return render_template('register.html')
        if User.query.filter_by(email=email).first():
            flash('Email already exists', 'error')
            return render_template('register.html')

        user = User(
            username=username, email=email,
            password_hash=generate_password_hash(password),
            full_name=full_name, phone=phone, user_type=user_type
        )
        db.session.add(user)
        db.session.commit()
        flash('Registration successful! Please log in.', 'success')
        return redirect(url_for('login'))

    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()

        if user and check_password_hash(user.password_hash, password):
            login_user(user)
            flash('Login successful!', 'success')
            if user.user_type in ('admin', 'vendor'):
                return redirect(url_for('admin_dashboard'))
            return redirect(url_for('customer_dashboard'))

        flash('Invalid username or password', 'error')
    return render_template('login.html')


@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('index'))


@app.route('/customer_dashboard')
@login_required
def customer_dashboard():
    if current_user.user_type != 'customer':
        flash('Access denied', 'error')
        return redirect(url_for('index'))

    recent_orders = Order.query.filter_by(customer_id=current_user.id)\
        .order_by(Order.created_at.desc()).limit(5).all()
    
    # Update order statuses by running simulation
    for order in recent_orders:
        if order.status in ['confirmed', 'in_transit', 'assigned']:
            simulate_drone_progress(order)
    
    all_drones = Drone.query.all()
    return render_template('customer_dashboard.html', orders=recent_orders, drones=all_drones)


@app.route('/admin_dashboard')
@login_required
def admin_dashboard():
    if current_user.user_type not in ('admin', 'vendor'):
        flash('Access denied', 'error')
        return redirect(url_for('index'))

    update_charging_drones()

    all_orders = Order.query.order_by(Order.created_at.desc()).all()
    all_drones = Drone.query.all()
    stations = ChargingStation.query.all()

    total_orders = Order.query.count()
    pending_orders = Order.query.filter_by(status='pending').count()
    idle_drones = Drone.query.filter_by(status='idle').count()
    charging_drones = Drone.query.filter_by(status='charging').count()
    delivering_drones = Drone.query.filter(
        Drone.status.in_(['delivering', 'picking_up', 'assigned'])
    ).count()
    low_battery_drones = Drone.query.filter_by(status='low_battery').count()

    stats = {
        'total_orders': total_orders,
        'pending_orders': pending_orders,
        'active_drones': idle_drones,
        'total_drones': len(all_drones),
        'charging_drones': charging_drones,
        'delivering_drones': delivering_drones,
        'low_battery_drones': low_battery_drones,
    }

    return render_template('admin_dashboard.html',
                           orders=all_orders, drones=all_drones,
                           stations=stations, stats=stats)


@app.route('/place_order', methods=['GET', 'POST'])
@login_required
def place_order():
    if current_user.user_type != 'customer':
        flash('Access denied', 'error')
        return redirect(url_for('index'))

    if request.method == 'POST':
        selected_items = request.form.getlist('items')
        # total_weight = float(request.form.get('total_weight', 0))
        # order_type = request.form.get('order_type', 'normal')
        total_weight = 0.0  # Default weight
        order_type = 'normal'  # Default type
        delivery_lat = float(request.form.get('delivery_lat'))
        delivery_lng = float(request.form.get('delivery_lng'))
        delivery_address = request.form.get('delivery_address', '')

        items_data = []
        required_warehouses = set()
        for item in selected_items:
            warehouse_id, product_name = item.split(':')
            items_data.append({'warehouse_id': int(warehouse_id), 'product': product_name, 'quantity': 1})
            required_warehouses.add(int(warehouse_id))

        warehouse_locations = []
        for wid in required_warehouses:
            wh = Warehouse.query.get(wid)
            warehouse_locations.append({'id': wh.id, 'lat': wh.lat, 'lng': wh.lng, 'name': wh.name})

        delivery_location = {'id': 'delivery', 'lat': delivery_lat, 'lng': delivery_lng, 'name': 'Delivery Location'}

        # Optimise route
        optimized_route, total_dist = calculate_optimized_route(warehouse_locations, delivery_location)

        # Battery-aware greedy drone assignment
        selected_drone = assign_drone_based_on_battery(delivery_lat, delivery_lng, warehouse_locations)
        if not selected_drone:
            flash('No drones available with sufficient battery right now. Please try again shortly.', 'error')
            return redirect(url_for('place_order'))

        order = Order(
            customer_id=current_user.id,
            drone_id=selected_drone.id,
            items=json.dumps(items_data),
            total_weight=total_weight,
            order_type=order_type,
            pickup_locations=json.dumps(warehouse_locations),
            delivery_lat=delivery_lat,
            delivery_lng=delivery_lng,
            delivery_address=delivery_address,
            optimized_route=json.dumps(optimized_route),
            route_total_distance=total_dist,
            status='confirmed',
            confirmed_at=datetime.utcnow(),
            estimated_delivery_time=datetime.utcnow() + timedelta(minutes=20)
        )

        selected_drone.status = 'assigned'
        log_drone_event(selected_drone, 'order_assigned',
                        f'{selected_drone.name} assigned to new order (battery: {selected_drone.battery_level:.1f}%, trip: {total_dist:.1f} km)', order)

        db.session.add(order)
        db.session.commit()

        flash('Order placed successfully! Your drone is on the way.', 'success')
        return redirect(url_for('track_order', order_id=order.id))

    warehouses = Warehouse.query.all()
    return render_template('place_order.html', warehouses=warehouses)


@app.route('/track_order/<int:order_id>')
@login_required
def track_order(order_id):
    order = Order.query.get_or_404(order_id)
    if current_user.user_type == 'customer' and order.customer_id != current_user.id:
        flash('Access denied', 'error')
        return redirect(url_for('customer_dashboard'))
    return render_template('track_order.html', order=order)


# ─── APIs ─────────────────────────────────────────────────────────────────────

@app.route('/api/order_status/<int:order_id>')
@login_required
def api_order_status(order_id):
    order = Order.query.get_or_404(order_id)
    if current_user.user_type == 'customer' and order.customer_id != current_user.id:
        return jsonify({'error': 'Access denied'}), 403

    route = order.get_optimized_route_list()
    current_progress = simulate_drone_progress(order)

    drone = order.assigned_drone
    recent_events = []
    if drone:
        evts = DroneEvent.query.filter_by(drone_id=drone.id)\
            .order_by(DroneEvent.created_at.desc()).limit(5).all()
        recent_events = [{
            'type': e.event_type,
            'message': e.message,
            'battery': e.battery_at_event,
            'time': e.created_at.isoformat() + 'Z'
        } for e in evts]

    return jsonify({
        'order_id': order.id,
        'status': order.status,
        'current_location': {'lat': current_progress['lat'], 'lng': current_progress['lng']},
        'route': route,
        'progress_percentage': current_progress['progress'],
        'estimated_delivery': (order.estimated_delivery_time.isoformat() + 'Z') if order.estimated_delivery_time else None,
        'drone_battery': round(drone.battery_level, 1) if drone else 0,
        'drone_status': drone.status if drone else 'unknown',
        'drone_name': drone.name if drone else 'N/A',
        'route_total_distance': order.route_total_distance or 0,
        'recent_events': recent_events,
    })


@app.route('/api/drones')
@login_required
def api_drones():
    update_charging_drones()
    drones = Drone.query.all()
    return jsonify([d.to_dict() for d in drones])


@app.route('/api/charging_stations')
@login_required
def api_charging_stations():
    stations = ChargingStation.query.all()
    return jsonify([{
        'id': s.id,
        'name': s.name,
        'location': s.location,
        'lat': s.lat,
        'lng': s.lng,
        'capacity': s.capacity,
        'drones_charging': Drone.query.filter_by(
            charging_station_id=s.id, status='charging').count()
    } for s in stations])


@app.route('/api/drone_fleet')
@login_required
def api_drone_fleet():
    if current_user.user_type not in ('admin', 'vendor'):
        return jsonify({'error': 'Access denied'}), 403
    update_charging_drones()
    drones = Drone.query.all()
    fleet = []
    for d in drones:
        last_events = DroneEvent.query.filter_by(drone_id=d.id)\
            .order_by(DroneEvent.created_at.desc()).limit(3).all()
        fleet.append({
            **d.to_dict(),
            'station_name': d.charging_station.name if d.charging_station else 'N/A',
            'recent_events': [{'type': e.event_type, 'message': e.message,
                                'battery': e.battery_at_event,
                                'time': e.created_at.isoformat() + 'Z'} for e in last_events]
        })
    return jsonify(fleet)


@app.route('/api/approve_order/<int:order_id>', methods=['POST'])
@login_required
def api_approve_order(order_id):
    if current_user.user_type not in ('admin', 'vendor'):
        return jsonify({'error': 'Access denied'}), 403
    order = Order.query.get_or_404(order_id)
    order.status = 'confirmed'
    order.confirmed_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'success': True, 'message': 'Order approved successfully'})


@app.route('/api/deny_order/<int:order_id>', methods=['POST'])
@login_required
def api_deny_order(order_id):
    if current_user.user_type not in ('admin', 'vendor'):
        return jsonify({'error': 'Access denied'}), 403
    order = Order.query.get_or_404(order_id)
    order.status = 'cancelled'
    if order.assigned_drone:
        drone = order.assigned_drone
        # Always send to charge on cancellation — drone returns and charges to 100%
        send_drone_to_charge(drone)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Order denied successfully'})


# Register seed to run on first request
@app.before_request
def ensure_seeded():
    if not hasattr(app, '_seeded'):
        seed_database()
        app._seeded = True
