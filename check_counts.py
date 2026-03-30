from app import app, db
from models import Warehouse, Drone, ChargingStation
with app.app_context():
    print('Warehouses:', Warehouse.query.count())
    print('Drones:', Drone.query.count())
    print('Charging Stations:', ChargingStation.query.count())