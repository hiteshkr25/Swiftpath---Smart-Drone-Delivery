from app import db
from flask_login import UserMixin
from datetime import datetime
import json


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(256))
    user_type = db.Column(db.String(20), default='customer')
    full_name = db.Column(db.String(100))
    phone = db.Column(db.String(20))
    address = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    orders = db.relationship('Order', backref='customer', lazy=True)


class ChargingStation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    location = db.Column(db.String(200))
    lat = db.Column(db.Float, nullable=False)
    lng = db.Column(db.Float, nullable=False)
    capacity = db.Column(db.Integer, default=4)

    drones = db.relationship('Drone', backref='charging_station', lazy=True)


class Warehouse(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    location = db.Column(db.String(200))
    lat = db.Column(db.Float)
    lng = db.Column(db.Float)
    products = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def get_products_list(self):
        if self.products:
            return self.products.split(',')
        return []


class Drone(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    # States: idle, assigned, picking_up, delivering, charging, low_battery
    status = db.Column(db.String(20), default='idle')
    battery_level = db.Column(db.Float, default=100.0)
    current_lat = db.Column(db.Float)
    current_lng = db.Column(db.Float)
    max_weight = db.Column(db.Float, default=5.0)
    charging_station_id = db.Column(db.Integer, db.ForeignKey('charging_station.id'))
    last_battery_update = db.Column(db.DateTime, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    orders = db.relationship('Order', backref='assigned_drone', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'status': self.status,
            'battery_level': round(self.battery_level, 1),
            'current_lat': self.current_lat,
            'current_lng': self.current_lng,
            'max_weight': self.max_weight,
            'charging_station_id': self.charging_station_id,
        }


class Order(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    customer_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    drone_id = db.Column(db.Integer, db.ForeignKey('drone.id'))

    items = db.Column(db.Text)
    total_weight = db.Column(db.Float)
    order_type = db.Column(db.String(20), default='normal')
    status = db.Column(db.String(20), default='pending')

    pickup_locations = db.Column(db.Text)
    delivery_lat = db.Column(db.Float)
    delivery_lng = db.Column(db.Float)
    delivery_address = db.Column(db.Text)

    optimized_route = db.Column(db.Text)
    route_total_distance = db.Column(db.Float, default=0.0)
    current_location_lat = db.Column(db.Float)
    current_location_lng = db.Column(db.Float)
    estimated_delivery_time = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    confirmed_at = db.Column(db.DateTime)
    delivered_at = db.Column(db.DateTime)

    def get_items_list(self):
        if self.items:
            return json.loads(self.items)
        return []

    def get_pickup_locations_list(self):
        if self.pickup_locations:
            return json.loads(self.pickup_locations)
        return []

    def get_optimized_route_list(self):
        if self.optimized_route:
            return json.loads(self.optimized_route)
        return []


class DeliveryRoute(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('order.id'), nullable=False)
    waypoint_order = db.Column(db.Integer)
    warehouse_id = db.Column(db.Integer, db.ForeignKey('warehouse.id'))
    lat = db.Column(db.Float)
    lng = db.Column(db.Float)
    estimated_arrival = db.Column(db.DateTime)
    actual_arrival = db.Column(db.DateTime)
    status = db.Column(db.String(20), default='pending')

    order = db.relationship('Order', backref='route_waypoints')
    warehouse = db.relationship('Warehouse', backref='delivery_routes')


class DroneEvent(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    drone_id = db.Column(db.Integer, db.ForeignKey('drone.id'), nullable=False)
    order_id = db.Column(db.Integer, db.ForeignKey('order.id'), nullable=True)
    event_type = db.Column(db.String(50), nullable=False)
    message = db.Column(db.Text)
    battery_at_event = db.Column(db.Float)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    drone = db.relationship('Drone', backref='events')
