import os
import logging
from datetime import datetime, timedelta
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from werkzeug.middleware.proxy_fix import ProxyFix

# IST = UTC + 5:30
IST_OFFSET = timedelta(hours=5, minutes=30)

# Configure logging
logging.basicConfig(level=logging.DEBUG)

db = SQLAlchemy()

# Create the app
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key-change-in-production")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Configure the database
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///swiftpath.db")
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_recycle": 300,
    "pool_pre_ping": True,
}

# Initialize extensions
db.init_app(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access this page.'

@login_manager.user_loader
def load_user(user_id):
    from models import User
    return User.query.get(int(user_id))

@app.template_filter('as_ist')
def as_ist(dt):
    """Convert a naive UTC datetime to IST (UTC+5:30) for template display."""
    if dt is None:
        return dt
    return dt + IST_OFFSET

with app.app_context():
    # Import models and routes
    import models
    import routes
    
    # Create all database tables
    db.create_all()

    # Ensure schema has required columns for Drone (handles existing DB from prior schema)
    from sqlalchemy import inspect, text
    inspector = inspect(db.engine)
    if 'drone' in inspector.get_table_names():
        drone_columns = {c['name'] for c in inspector.get_columns('drone')}
        required_columns = {
            'charging_station_id': 'INTEGER',
            'last_battery_update': 'DATETIME',
            'max_weight': 'FLOAT',
        }
        for col_name, col_type in required_columns.items():
            if col_name not in drone_columns:
                logging.info(f"Adding missing column drone.{col_name}")
                db.session.execute(text(f'ALTER TABLE drone ADD COLUMN {col_name} {col_type}'))
        db.session.commit()

    if 'order' in inspector.get_table_names():
        order_columns = {c['name'] for c in inspector.get_columns('order')}
        order_required_columns = {
            'pickup_locations': 'TEXT',
            'optimized_route': 'TEXT',
            'route_total_distance': 'FLOAT',
            'current_location_lat': 'FLOAT',
            'current_location_lng': 'FLOAT',
            'estimated_delivery_time': 'DATETIME',
        }
        for col_name, col_type in order_required_columns.items():
            if col_name not in order_columns:
                logging.info(f"Adding missing column order.{col_name}")
                db.session.execute(text(f'ALTER TABLE "order" ADD COLUMN {col_name} {col_type}'))
        db.session.commit()

    # Create sample warehouses and drones if they don't exist
    from models import Warehouse, Drone, ChargingStation
    
    # Seed data constants (matching routes.py)
    CHARGING_STATION_DATA = [
        {'id': 1, 'name': 'Central Charging Hub', 'location': 'Paltan Bazaar', 'lat': 30.3165, 'lng': 78.0322, 'capacity': 4},
        {'id': 2, 'name': 'North Charging Station', 'location': 'Rajpur Road', 'lat': 30.3545, 'lng': 78.0762, 'capacity': 3},
        {'id': 3, 'name': 'South Charging Station', 'location': 'Karanpur', 'lat': 30.3076, 'lng': 78.0272, 'capacity': 3},
    ]

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
    
    # Seed charging stations
    if ChargingStation.query.count() == 0:
        for cs in CHARGING_STATION_DATA:
            station = ChargingStation(
                name=cs['name'], location=cs['location'],
                lat=cs['lat'], lng=cs['lng'], capacity=cs['capacity']
            )
            db.session.add(station)
        db.session.flush()
        logging.info("Seeded charging stations")
    
    # Seed warehouses - remove duplicates first
    # Delete all existing warehouses to ensure clean state
    Warehouse.query.delete()
    for w in WAREHOUSE_SEED_DATA:
        warehouse = Warehouse(
            name=w['name'], location=w['location'],
            lat=w['lat'], lng=w['lng'], products=w['products']
        )
        db.session.add(warehouse)
    db.session.flush()
    logging.info("Seeded warehouses - removed duplicates and re-created 10 unique warehouses")
    
    # Seed drones - remove old Drone-* drones and duplicates, keep only Swift-* drones
    # Delete all old/duplicate drones first
    Drone.query.delete()
    stations = ChargingStation.query.order_by(ChargingStation.id).all()
    if stations:
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
    logging.info("Seeded drone fleet - removed old Drone-* drones, keeping only 10 Swift-* drones")
    
    logging.info("Sample data created successfully")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
