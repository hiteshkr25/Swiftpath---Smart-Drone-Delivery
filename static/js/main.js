// Theme Management
class ThemeManager {
    constructor() {
        this.theme = localStorage.getItem('theme') || 'light';
        this.init();
    }

    init() {
        this.applyTheme();
        this.bindEvents();
    }

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.innerHTML = this.theme === 'light' 
                ? '<i data-feather="moon"></i>' 
                : '<i data-feather="sun"></i>';
        }
    }

    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', this.theme);
        this.applyTheme();
        feather.replace(); // Re-render feather icons
    }

    bindEvents() {
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => this.toggleTheme());
        }
    }
}

// Form Validation
class FormValidator {
    constructor(formSelector) {
        this.form = document.querySelector(formSelector);
        if (this.form) {
            this.init();
        }
    }

    init() {
        this.form.addEventListener('submit', (e) => this.validateForm(e));
        this.bindRealTimeValidation();
    }

    validateForm(event) {
        let isValid = true;
        const inputs = this.form.querySelectorAll('input[required], select[required], textarea[required]');
        
        inputs.forEach(input => {
            if (!this.validateField(input)) {
                isValid = false;
            }
        });

        if (!isValid) {
            event.preventDefault();
            this.showAlert('Please fill in all required fields correctly.', 'danger');
        }
    }

    validateField(field) {
        const value = field.value.trim();
        const type = field.type;
        let isValid = true;
        let message = '';

        // Clear previous validation state
        this.clearFieldValidation(field);

        // Required field validation
        if (field.hasAttribute('required') && !value) {
            isValid = false;
            message = 'This field is required.';
        }

        // Email validation
        if (type === 'email' && value && !this.isValidEmail(value)) {
            isValid = false;
            message = 'Please enter a valid email address.';
        }

        // Password validation
        if (type === 'password' && value && value.length < 6) {
            isValid = false;
            message = 'Password must be at least 6 characters long.';
        }

        // Phone validation
        if (field.name === 'phone' && value && !this.isValidPhone(value)) {
            isValid = false;
            message = 'Please enter a valid phone number.';
        }

        // Weight validation
        if (field.name === 'total_weight' && value && (parseFloat(value) <= 0 || parseFloat(value) > 10)) {
            isValid = false;
            message = 'Weight must be between 0.1 and 10 kg.';
        }

        this.setFieldValidation(field, isValid, message);
        return isValid;
    }

    bindRealTimeValidation() {
        const inputs = this.form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.addEventListener('blur', () => this.validateField(input));
            input.addEventListener('input', () => {
                if (input.classList.contains('is-invalid')) {
                    this.validateField(input);
                }
            });
        });
    }

    setFieldValidation(field, isValid, message) {
        const feedback = field.parentNode.querySelector('.invalid-feedback') || 
                        this.createFeedbackElement(field);

        if (isValid) {
            field.classList.remove('is-invalid');
            field.classList.add('is-valid');
            feedback.textContent = '';
            feedback.style.display = 'none';
        } else {
            field.classList.remove('is-valid');
            field.classList.add('is-invalid');
            feedback.textContent = message;
            feedback.style.display = 'block';
        }
    }

    clearFieldValidation(field) {
        field.classList.remove('is-valid', 'is-invalid');
        const feedback = field.parentNode.querySelector('.invalid-feedback');
        if (feedback) {
            feedback.textContent = '';
            feedback.style.display = 'none';
        }
    }

    createFeedbackElement(field) {
        const feedback = document.createElement('div');
        feedback.className = 'invalid-feedback';
        field.parentNode.appendChild(feedback);
        return feedback;
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    isValidPhone(phone) {
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
    }

    showAlert(message, type) {
        const alertContainer = document.getElementById('alertContainer') || this.createAlertContainer();
        
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} alert-dismissible fade show`;
        alert.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        alertContainer.appendChild(alert);
        
        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }

    createAlertContainer() {
        const container = document.createElement('div');
        container.id = 'alertContainer';
        container.className = 'position-fixed top-0 end-0 p-3';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
        return container;
    }
}

// Geolocation Manager
class GeolocationManager {
    constructor() {
        this.currentPosition = null;
        this.watchId = null;
    }

    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by this browser.'));
                return;
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000 // 5 minutes
            };

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.currentPosition = position;
                    resolve(position);
                },
                (error) => {
                    console.error('Geolocation error:', error);
                    reject(error);
                },
                options
            );
        });
    }

    watchPosition(callback) {
        if (!navigator.geolocation) {
            throw new Error('Geolocation is not supported by this browser.');
        }

        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000 // 1 minute
        };

        this.watchId = navigator.geolocation.watchPosition(
            (position) => {
                this.currentPosition = position;
                callback(position);
            },
            (error) => {
                console.error('Geolocation watch error:', error);
            },
            options
        );

        return this.watchId;
    }

    stopWatching() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }

    async updateLocationFields() {
        try {
            const position = await this.getCurrentPosition();
            
            const latField = document.getElementById('delivery_lat');
            const lngField = document.getElementById('delivery_lng');
            const addressField = document.getElementById('delivery_address');
            
            if (latField && lngField) {
                latField.value = position.coords.latitude;
                lngField.value = position.coords.longitude;
            }
            
            if (addressField && !addressField.value) {
                // Use reverse geocoding if available, otherwise use coordinates
                addressField.value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
            }
            
            return position;
        } catch (error) {
            console.error('Failed to get current location:', error);
            throw error;
        }
    }
}

// Order Management
class OrderManager {
    constructor() {
        this.selectedItems = new Set();
        this.totalWeight = 0;
        this.bindEvents();
    }

    bindEvents() {
        // Product selection
        const productItems = document.querySelectorAll('.product-item');
        productItems.forEach(item => {
            item.addEventListener('click', () => this.toggleProduct(item));
        });

        // Weight input
        const weightInput = document.getElementById('total_weight');
        if (weightInput) {
            weightInput.addEventListener('input', () => this.updateWeight());
        }

        // Get location button
        const getLocationBtn = document.getElementById('getLocationBtn');
        if (getLocationBtn) {
            getLocationBtn.addEventListener('click', () => this.getDeliveryLocation());
        }
    }

    toggleProduct(productElement) {
        const checkbox = productElement.querySelector('input[type="checkbox"]');
        const productValue = checkbox.value;
        
        if (checkbox.checked) {
            this.selectedItems.delete(productValue);
            productElement.classList.remove('selected');
            checkbox.checked = false;
        } else {
            this.selectedItems.add(productValue);
            productElement.classList.add('selected');
            checkbox.checked = true;
        }
        
        this.updateOrderSummary();
    }

    updateWeight() {
        const weightInput = document.getElementById('total_weight');
        if (weightInput) {
            this.totalWeight = parseFloat(weightInput.value) || 0;
            this.updateOrderSummary();
        }
    }

    updateOrderSummary() {
        const summaryElement = document.getElementById('orderSummary');
        if (!summaryElement) return;

        const itemCount = this.selectedItems.size;
        const weightDisplay = this.totalWeight > 0 ? `${this.totalWeight} kg` : 'Not specified';
        
        summaryElement.innerHTML = `
            <div class="row">
                <div class="col-6">
                    <strong>Items Selected:</strong><br>
                    <span class="text-primary">${itemCount}</span>
                </div>
                <div class="col-6">
                    <strong>Total Weight:</strong><br>
                    <span class="text-primary">${weightDisplay}</span>
                </div>
            </div>
        `;
    }

    async getDeliveryLocation() {
        const getLocationBtn = document.getElementById('getLocationBtn');
        const originalText = getLocationBtn.innerHTML;
        
        try {
            getLocationBtn.innerHTML = '<span class="spinner"></span> Getting location...';
            getLocationBtn.disabled = true;
            
            const geoManager = new GeolocationManager();
            await geoManager.updateLocationFields();
            
            getLocationBtn.innerHTML = '<i data-feather="check"></i> Location updated';
            getLocationBtn.classList.remove('btn-outline-primary');
            getLocationBtn.classList.add('btn-success');
            
            feather.replace();
            
            // Reset button after 3 seconds
            setTimeout(() => {
                getLocationBtn.innerHTML = originalText;
                getLocationBtn.classList.remove('btn-success');
                getLocationBtn.classList.add('btn-outline-primary');
                getLocationBtn.disabled = false;
                feather.replace();
            }, 3000);
            
        } catch (error) {
            console.error('Location error:', error);
            getLocationBtn.innerHTML = '<i data-feather="x"></i> Location failed';
            getLocationBtn.classList.remove('btn-outline-primary');
            getLocationBtn.classList.add('btn-danger');
            
            // Show error message
            const validator = new FormValidator('');
            validator.showAlert('Could not get your location. Please enter it manually.', 'warning');
            
            // Reset button after 3 seconds
            setTimeout(() => {
                getLocationBtn.innerHTML = originalText;
                getLocationBtn.classList.remove('btn-danger');
                getLocationBtn.classList.add('btn-outline-primary');
                getLocationBtn.disabled = false;
                feather.replace();
            }, 3000);
        }
    }
}

// Utility Functions
const Utils = {
    formatDate(dateString) {
        const date = new Date(dateString);
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    },

    formatDistance(distance) {
        if (distance < 1) {
            return `${Math.round(distance * 1000)} m`;
        } else {
            return `${distance.toFixed(1)} km`;
        }
    },

    showLoading(element) {
        const originalContent = element.innerHTML;
        element.innerHTML = '<span class="spinner"></span> Loading...';
        element.disabled = true;
        return originalContent;
    },

    hideLoading(element, originalContent) {
        element.innerHTML = originalContent;
        element.disabled = false;
    },

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    // Initialize theme manager
    const themeManager = new ThemeManager();
    
    // Initialize form validation
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        if (form.id) {
            new FormValidator(`#${form.id}`);
        }
    });
    
    // Initialize order manager for order placement page
    if (document.querySelector('.product-item')) {
        new OrderManager();
    }
    
    // Initialize Feather icons
    if (typeof feather !== 'undefined') {
        feather.replace();
    }
    
    // Initialize Bootstrap tooltips
    if (typeof bootstrap !== 'undefined') {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }
    
    // Add smooth scrolling for anchor links (skip bare "#" hrefs)
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;
            e.preventDefault();
            try {
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } catch (err) {
                // Invalid selector — skip silently
            }
        });
    });
});

// Export for global access
window.ThemeManager = ThemeManager;
window.FormValidator = FormValidator;
window.GeolocationManager = GeolocationManager;
window.OrderManager = OrderManager;
window.Utils = Utils;
