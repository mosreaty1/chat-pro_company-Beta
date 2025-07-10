import os
from datetime import datetime
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ConfigurationError
from bson.objectid import ObjectId
from werkzeug.security import generate_password_hash, check_password_hash
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class MongoDBManager:
    """Handles MongoDB connection and operations with your updated connection string"""
    def __init__(self):
        self.client = None
        self.db = None
        self.connect()

    def connect(self):
        """Establish MongoDB connection using your new Atlas URI"""
        connection_string = (
            "mongodb://alsariti1:446655@ac-gg0m2ex-shard-00-00.7ot1qbc.mongodb.net:27017,"
            "ac-gg0m2ex-shard-00-01.7ot1qbc.mongodb.net:27017,"
            "ac-gg0m2ex-shard-00-02.7ot1qbc.mongodb.net:27017/"
            "?replicaSet=atlas-kr0oed-shard-0&ssl=true&authSource=admin"
        )
        
        try:
            self.client = MongoClient(
                connection_string,
                connectTimeoutMS=30000,
                socketTimeoutMS=30000,
                serverSelectionTimeoutMS=30000,
                retryWrites=True,
                w="majority"
            )
            # Verify connection
            self.client.admin.command('ping')
            self.db = self.client.get_database("chatpro_db")  # Updated database name
            logger.info("Successfully connected to MongoDB Atlas")
            
            # Create indexes for better performance
            self.create_indexes()
            
        except ConnectionFailure as e:
            logger.error("Could not connect to MongoDB: %s", e)
            raise
        except Exception as e:
            logger.error("Unexpected error: %s", e)
            raise

    def create_indexes(self):
        """Create database indexes for better performance"""
        try:
            # User indexes
            self.db.users.create_index("username", unique=True)
            self.db.users.create_index("email", unique=True)
            
            # Room indexes
            self.db.rooms.create_index("name")
            self.db.rooms.create_index("created_by")
            self.db.rooms.create_index("is_private")
            self.db.rooms.create_index("last_activity")
            
            # Message indexes
            self.db.messages.create_index("room_id")
            self.db.messages.create_index([("room_id", 1), ("timestamp", -1)])
            self.db.messages.create_index("timestamp")
            
            logger.info("Database indexes created successfully")
        except Exception as e:
            logger.warning("Error creating indexes: %s", e)

    def get_collection(self, collection_name):
        """Get a collection from the database"""
        if self.db is None:
            self.connect()
        return self.db[collection_name]

class UserManager:
    """Handles user-related operations with enhanced validation"""
    def __init__(self, mongo_manager):
        self.users = mongo_manager.get_collection("users")

    def register_user(self, username, password, email):
        """Register a new user with enhanced validation"""
        if not username or not password or not email:
            raise ValueError('All fields are required')
        
        # Enhanced validation
        if len(username) < 3 or len(username) > 30:
            raise ValueError('Username must be between 3 and 30 characters')
        
        if len(password) < 8:
            raise ValueError('Password must be at least 8 characters')
        
        # Check for valid email format
        import re
        email_pattern = r'^[^\s@]+@[^\s@]+\.[^\s@]+$'
        if not re.match(email_pattern, email):
            raise ValueError('Please enter a valid email address')
        
        # Check if username already exists
        if self.users.find_one({'username': username}):
            raise ValueError('Username already exists')
        
        # Check if email already exists
        if self.users.find_one({'email': email.lower()}):
            raise ValueError('Email already registered')
        
        hashed_password = generate_password_hash(password, method='pbkdf2:sha256')
        
        user_data = {
            'username': username,
            'password': hashed_password,
            'email': email.lower(),
            'display_name': username,
            'created_at': datetime.utcnow(),
            'last_login': None,
            'last_seen': datetime.utcnow(),
            'is_active': True,
            'profile': {
                'avatar_color': self.generate_avatar_color(username),
                'status': 'online',
                'bio': ''
            }
        }
        
        result = self.users.insert_one(user_data)
        logger.info(f"New user registered: {username}")
        return str(result.inserted_id)

    def authenticate_user(self, username, password):
        """Authenticate user with secure password checking"""
        user = self.users.find_one({
            'username': username,
            'is_active': True
        })
        
        if user and check_password_hash(user['password'], password):
            # Update last login and status
            self.users.update_one(
                {'_id': user['_id']},
                {
                    '$set': {
                        'last_login': datetime.utcnow(),
                        'last_seen': datetime.utcnow(),
                        'profile.status': 'online'
                    }
                }
            )
            user['_id'] = str(user['_id'])  # Convert ObjectId to string
            logger.info(f"User authenticated: {username}")
            return user
        return None

    def update_user_status(self, user_id, status):
        """Update user online status"""
        try:
            self.users.update_one(
                {'_id': ObjectId(user_id)},
                {
                    '$set': {
                        'profile.status': status,
                        'last_seen': datetime.utcnow()
                    }
                }
            )
        except Exception as e:
            logger.error(f"Error updating user status: {e}")

    def generate_avatar_color(self, username):
        """Generate a consistent color for user avatar"""
        colors = [
            '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
            '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
            '#ef4444', '#f97316', '#f59e0b', '#eab308',
            '#84cc16', '#22c55e', '#10b981', '#14b8a6',
            '#06b6d4', '#0891b2'
        ]
        hash_value = sum(ord(c) for c in username)
        return colors[hash_value % len(colors)]

class RoomManager:
    """Handles chat room operations with enhanced features"""
    def __init__(self, mongo_manager):
        self.rooms = mongo_manager.get_collection("rooms")
        self.messages = mongo_manager.get_collection("messages")

    def create_room(self, name, created_by, description="", is_private=False):
        """Create a new chat room with enhanced validation"""
        if not name or not created_by:
            raise ValueError('Room name and creator are required')
        
        # Validate room name
        if len(name) < 3 or len(name) > 50:
            raise ValueError('Room name must be between 3 and 50 characters')
        
        # Check if room name already exists
        existing_room = self.rooms.find_one({'name': name, 'is_active': True})
        if existing_room:
            raise ValueError('Room name already exists')
        
        room_data = {
            'name': name,
            'description': description,
            'created_by': created_by,
            'created_at': datetime.utcnow(),
            'members': [created_by],
            'is_active': True,
            'is_private': is_private,
            'last_activity': datetime.utcnow(),
            'settings': {
                'allow_file_upload': True,
                'max_members': 100 if not is_private else 10
            }
        }
        
        result = self.rooms.insert_one(room_data)
        logger.info(f"New room created: {name}")
        return str(result.inserted_id)

    def get_all_public_rooms(self):
        """Get all active public rooms"""
        return list(self.rooms.find({
            'is_active': True,
            'is_private': False
        }).sort('last_activity', -1))

    def get_user_rooms(self, user_id):
        """Get rooms where user is a member"""
        return list(self.rooms.find({
            'is_active': True,
            'members': user_id
        }).sort('last_activity', -1))

    def get_room_by_id(self, room_id):
        """Get room by ID with member count"""
        try:
            room = self.rooms.find_one({'_id': ObjectId(room_id), 'is_active': True})
            if room:
                room['_id'] = str(room['_id'])
                room['member_count'] = len(room.get('members', []))
            return room
        except Exception as e:
            logger.error(f"Error getting room: {e}")
            return None

    def join_room(self, room_id, user_id):
        """Add user to room members"""
        try:
            result = self.rooms.update_one(
                {'_id': ObjectId(room_id), 'is_active': True},
                {
                    '$addToSet': {'members': user_id},
                    '$set': {'last_activity': datetime.utcnow()}
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error joining room: {e}")
            return False

    def leave_room(self, room_id, user_id):
        """Remove user from room members"""
        try:
            result = self.rooms.update_one(
                {'_id': ObjectId(room_id)},
                {
                    '$pull': {'members': user_id},
                    '$set': {'last_activity': datetime.utcnow()}
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error leaving room: {e}")
            return False

    def get_room_messages(self, room_id, page=1, per_page=50):
        """Get paginated messages for a room"""
        try:
            skip = (page - 1) * per_page
            messages = list(self.messages.find({'room_id': room_id})
                          .sort('timestamp', -1)
                          .skip(skip)
                          .limit(per_page))
            
            # Convert ObjectIds to strings
            for message in messages:
                message['_id'] = str(message['_id'])
            
            return messages
        except Exception as e:
            logger.error(f"Error getting messages: {e}")
            return []

    def add_message(self, room_id, user_id, username, message, message_type="text"):
        """Add message and update room activity"""
        if not room_id or not user_id or not message:
            raise ValueError('Missing required fields')
        
        message_data = {
            'room_id': room_id,
            'user_id': user_id,
            'username': username,
            'message': message,
            'message_type': message_type,
            'timestamp': datetime.utcnow(),
            'is_system': False,
            'is_edited': False,
            'reactions': {}
        }
        
        # Update room's last activity
        self.rooms.update_one(
            {'_id': ObjectId(room_id)},
            {'$set': {'last_activity': datetime.utcnow()}}
        )
        
        result = self.messages.insert_one(message_data)
        logger.info(f"Message added to room {room_id}")
        return str(result.inserted_id)

    def add_system_message(self, room_id, message):
        """Add a system message to the room"""
        message_data = {
            'room_id': room_id,
            'user_id': 'system',
            'username': 'System',
            'message': message,
            'message_type': 'system',
            'timestamp': datetime.utcnow(),
            'is_system': True,
            'is_edited': False,
            'reactions': {}
        }
        
        result = self.messages.insert_one(message_data)
        return str(result.inserted_id)

class ChatApplication:
    """Enhanced main application class"""
    def __init__(self):
        # Initialize Flask app with correct template structure for your project
        self.app = Flask(__name__, 
                        template_folder='static/templates', 
                        static_folder='static')
        
        self.app.secret_key = os.environ.get('SECRET_KEY') or 'chatpro-secret-key-change-in-production'
        
        # Enhanced security settings
        self.app.config.update(
            SESSION_COOKIE_SECURE=False,  # Set to True in production with HTTPS
            SESSION_COOKIE_HTTPONLY=True,
            SESSION_COOKIE_SAMESITE='Lax',
            PERMANENT_SESSION_LIFETIME=3600,  # 1 hour
            MAX_CONTENT_LENGTH=16 * 1024 * 1024  # 16MB max file upload
        )
        
        # Initialize Socket.IO with enhanced configuration
        self.socketio = SocketIO(
            self.app, 
            cors_allowed_origins="*", 
            logger=False,  # Disable Socket.IO logging for cleaner output
            engineio_logger=False,
            async_mode='threading'
        )
        
        # Initialize MongoDB and managers
        try:
            self.mongo_manager = MongoDBManager()
            self.user_manager = UserManager(self.mongo_manager)
            self.room_manager = RoomManager(self.mongo_manager)
            
            # Create default general room if it doesn't exist
            self.create_default_room()
            
        except Exception as e:
            logger.critical("Failed to initialize database: %s", e)
            raise
        
        # Register routes and socket events
        self._register_routes()
        self._register_socket_events()
        self._register_error_handlers()

    def create_default_room(self):
        """Create a default 'General' room if it doesn't exist"""
        try:
            existing_general = self.room_manager.rooms.find_one({'name': 'general', 'is_active': True})
            if not existing_general:
                # Create system user for default room
                system_user = self.user_manager.users.find_one({'username': 'system'})
                if not system_user:
                    system_user_id = self.user_manager.register_user('system', 'system_password', 'system@chatpro.com')
                else:
                    system_user_id = str(system_user['_id'])
                
                # Create general room
                self.room_manager.create_room(
                    'general', 
                    system_user_id, 
                    'Welcome to ChatPro! This is the general discussion room.',
                    False
                )
                logger.info("Default 'general' room created")
        except Exception as e:
            logger.warning(f"Could not create default room: {e}")

    def _register_routes(self):
        """Register all Flask routes with enhanced functionality"""
        
        @self.app.route('/')
        def home():
            if 'user_id' in session:
                return redirect(url_for('chat'))
            return render_template('login.html')

        @self.app.route('/login', methods=['GET', 'POST'])
        def login():
            if request.method == 'POST':
                try:
                    username = request.form.get('username', '').strip()
                    password = request.form.get('password', '').strip()
                    remember_me = request.form.get('remember') == 'on'
                    
                    if not username or not password:
                        return render_template('login.html', error='Username and password are required')
                    
                    user = self.user_manager.authenticate_user(username, password)
                    if user:
                        session['user_id'] = user['_id']
                        session['username'] = user['username']
                        session['display_name'] = user.get('display_name', user['username'])
                        
                        if remember_me:
                            session.permanent = True
                        
                        return redirect(url_for('chat'))
                    
                    return render_template('login.html', error='Invalid username or password')
                    
                except Exception as e:
                    logger.error("Login error: %s", e)
                    return render_template('login.html', error='An error occurred during login')
            
            return render_template('login.html')

        @self.app.route('/register', methods=['GET', 'POST'])
        def register():
            if request.method == 'POST':
                try:
                    username = request.form.get('username', '').strip()
                    password = request.form.get('password', '').strip()
                    email = request.form.get('email', '').strip().lower()
                    
                    user_id = self.user_manager.register_user(username, password, email)
                    
                    # Auto-login after registration
                    session['user_id'] = user_id
                    session['username'] = username
                    session['display_name'] = username
                    
                    return redirect(url_for('chat'))
                    
                except ValueError as e:
                    return render_template('register.html', error=str(e))
                except Exception as e:
                    logger.error("Registration error: %s", e)
                    return render_template('register.html', error='Could not create account. Please try again.')
            
            return render_template('register.html')

        @self.app.route('/chat')
        def chat():
            if 'user_id' not in session:
                return redirect(url_for('login'))
            
            try:
                # Get user's rooms
                public_rooms = self.room_manager.get_all_public_rooms()
                user_rooms = self.room_manager.get_user_rooms(session['user_id'])
                
                # Convert ObjectIds to strings and add member counts
                for room in public_rooms + user_rooms:
                    room['_id'] = str(room['_id'])
                    room['created_by'] = str(room['created_by'])
                    room['member_count'] = len(room.get('members', []))
                
                return render_template('chat.html',
                                   username=session['username'],
                                   display_name=session.get('display_name', session['username']),
                                   public_rooms=public_rooms,
                                   user_rooms=user_rooms)
                                   
            except Exception as e:
                logger.error("Chat error: %s", e)
                return render_template('error.html', message='Could not load chat interface')

        @self.app.route('/logout')
        def logout():
            if 'user_id' in session:
                # Update user status to offline
                self.user_manager.update_user_status(session['user_id'], 'offline')
            
            session.clear()
            return redirect(url_for('home'))

        @self.app.route('/api/rooms', methods=['GET', 'POST'])
        def handle_rooms():
            if 'user_id' not in session:
                return jsonify({'error': 'Unauthorized'}), 401
            
            if request.method == 'POST':
                try:
                    data = request.get_json()
                    room_name = data.get('name', '').strip().lower()
                    description = data.get('description', '').strip()
                    is_private = data.get('is_private', False)
                    
                    if not room_name:
                        return jsonify({'error': 'Room name is required'}), 400
                    
                    room_id = self.room_manager.create_room(
                        room_name,
                        session['user_id'],
                        description,
                        is_private
                    )
                    
                    return jsonify({
                        'id': room_id,
                        'name': room_name,
                        'description': description,
                        'is_private': is_private,
                        'success': True
                    }), 201
                    
                except ValueError as e:
                    return jsonify({'error': str(e)}), 400
                except Exception as e:
                    logger.error("Room creation error: %s", e)
                    return jsonify({'error': 'Could not create room'}), 500
            
            # GET all rooms user can access
            try:
                public_rooms = self.room_manager.get_all_public_rooms()
                user_rooms = self.room_manager.get_user_rooms(session['user_id'])
                
                rooms = []
                for room in public_rooms + user_rooms:
                    rooms.append({
                        'id': str(room['_id']),
                        'name': room['name'],
                        'description': room.get('description', ''),
                        'created_by': str(room['created_by']),
                        'is_private': room.get('is_private', False),
                        'member_count': len(room.get('members', [])),
                        'last_activity': room.get('last_activity').isoformat() if room.get('last_activity') else None
                    })
                
                return jsonify(rooms)
                
            except Exception as e:
                logger.error("Room fetch error: %s", e)
                return jsonify({'error': 'Could not fetch rooms'}), 500

        @self.app.route('/api/messages/<room_id>')
        def get_messages(room_id):
            if 'user_id' not in session:
                return jsonify({'error': 'Unauthorized'}), 401
            
            try:
                page = int(request.args.get('page', 1))
                per_page = min(int(request.args.get('per_page', 50)), 100)  # Max 100 messages
                
                # Check if user has access to this room
                room = self.room_manager.get_room_by_id(room_id)
                if not room:
                    return jsonify({'error': 'Room not found'}), 404
                
                if room['is_private'] and session['user_id'] not in room.get('members', []):
                    return jsonify({'error': 'Access denied'}), 403
                
                messages = self.room_manager.get_room_messages(room_id, page, per_page)
                
                formatted_messages = []
                for message in messages:
                    formatted_messages.append({
                        'id': str(message['_id']),
                        'user_id': str(message['user_id']),
                        'username': message['username'],
                        'message': message['message'],
                        'message_type': message.get('message_type', 'text'),
                        'timestamp': message['timestamp'].isoformat(),
                        'is_system': message.get('is_system', False),
                        'is_edited': message.get('is_edited', False)
                    })
                
                return jsonify({
                    'messages': formatted_messages,
                    'page': page,
                    'per_page': per_page,
                    'room_name': room['name']
                })
                
            except Exception as e:
                logger.error("Messages fetch error: %s", e)
                return jsonify({'error': 'Could not fetch messages'}), 500

    def _register_socket_events(self):
        """Register all Socket.IO events with enhanced functionality"""
        
        @self.socketio.on('connect')
        def handle_connect():
            if 'user_id' not in session:
                logger.warning("Unauthorized connection attempt")
                return False  # Reject connection
            
            # Update user status to online
            self.user_manager.update_user_status(session['user_id'], 'online')
            logger.info(f"User {session['username']} connected")

        @self.socketio.on('disconnect')
        def handle_disconnect():
            if 'user_id' in session:
                # Update user status to offline
                self.user_manager.update_user_status(session['user_id'], 'offline')
                logger.info(f"User {session['username']} disconnected")

        @self.socketio.on('join_room')
        def handle_join_room(data):
            if 'user_id' not in session:
                return
            
            room_id = data.get('room_id')
            if not room_id:
                return
            
            try:
                # Verify user can access this room
                room = self.room_manager.get_room_by_id(room_id)
                if not room:
                    emit('error', {'message': 'Room not found'})
                    return
                
                # Check access permissions
                if room['is_private'] and session['user_id'] not in room.get('members', []):
                    emit('error', {'message': 'Access denied to private room'})
                    return
                
                # Add user to room members if not already there
                if session['user_id'] not in room.get('members', []):
                    self.room_manager.join_room(room_id, session['user_id'])
                
                join_room(room_id)
                
                # Add system message
                system_message_id = self.room_manager.add_system_message(
                    room_id, 
                    f"{session['username']} joined the room"
                )
                
                emit('message', {
                    'id': system_message_id,
                    'user_id': 'system',
                    'username': 'System',
                    'message': f"{session['username']} joined the room",
                    'timestamp': datetime.utcnow().isoformat(),
                    'is_system': True,
                    'room_id': room_id
                }, room=room_id)
                
                emit('join_success', {
                    'room_id': room_id,
                    'room_name': room['name']
                })
                
            except Exception as e:
                logger.error("Join room error: %s", e)
                emit('error', {'message': 'Could not join room'})

        @self.socketio.on('leave_room')
        def handle_leave_room(data):
            if 'user_id' not in session:
                return
            
            room_id = data.get('room_id')
            if not room_id:
                return
            
            try:
                leave_room(room_id)
                
                # Add system message
                system_message_id = self.room_manager.add_system_message(
                    room_id, 
                    f"{session['username']} left the room"
                )
                
                emit('message', {
                    'id': system_message_id,
                    'user_id': 'system',
                    'username': 'System',
                    'message': f"{session['username']} left the room",
                    'timestamp': datetime.utcnow().isoformat(),
                    'is_system': True,
                    'room_id': room_id
                }, room=room_id)
                
            except Exception as e:
                logger.error("Leave room error: %s", e)

        @self.socketio.on('send_message')
        def handle_send_message(data):
            if 'user_id' not in session:
                return
            
            room_id = data.get('room_id')
            message = data.get('message', '').strip()
            
            if not room_id or not message:
                return
            
            # Validate message length
            if len(message) > 2000:
                emit('error', {'message': 'Message too long (max 2000 characters)'})
                return
            
            try:
                # Verify user can access this room
                room = self.room_manager.get_room_by_id(room_id)
                if not room:
                    emit('error', {'message': 'Room not found'})
                    return
                
                if room['is_private'] and session['user_id'] not in room.get('members', []):
                    emit('error', {'message': 'Access denied'})
                    return
                
                # Add message
                message_id = self.room_manager.add_message(
                    room_id,
                    session['user_id'],
                    session['username'],
                    message
                )
                
                # Emit message to all room members
                emit('message', {
                    'id': message_id,
                    'user_id': session['user_id'],
                    'username': session['username'],
                    'message': message,
                    'timestamp': datetime.utcnow().isoformat(),
                    'is_system': False,
                    'room_id': room_id
                }, room=room_id)
                
            except Exception as e:
                logger.error("Send message error: %s", e)
                emit('error', {'message': 'Could not send message'})

        @self.socketio.on('typing_start')
        def handle_typing_start(data):
            if 'user_id' not in session:
                return
            
            room_id = data.get('room_id')
            if room_id:
                emit('user_typing', {
                    'username': session['username'],
                    'room_id': room_id
                }, room=room_id, include_self=False)

        @self.socketio.on('typing_stop')
        def handle_typing_stop(data):
            if 'user_id' not in session:
                return
            
            room_id = data.get('room_id')
            if room_id:
                emit('user_stopped_typing', {
                    'username': session['username'],
                    'room_id': room_id
                }, room=room_id, include_self=False)

    def _register_error_handlers(self):
        """Register enhanced error handlers"""
        
        @self.app.errorhandler(404)
        def not_found(error):
            return render_template('error.html', message='Page not found'), 404
        
        @self.app.errorhandler(500)
        def server_error(error):
            logger.error("Server error: %s", error)
            return render_template('error.html', message='Internal server error'), 500
        
        @self.app.errorhandler(403)
        def forbidden(error):
            return render_template('error.html', message='Access forbidden'), 403

    def run(self, host='0.0.0.0', port=5000, debug=True):
        """Run the application with enhanced configuration"""
        logger.info(f"Starting ChatPro server on {host}:{port}")
        logger.info(f"MongoDB connection: {'✓ Connected' if self.mongo_manager.client else '✗ Failed'}")
        logger.info(f"Template folder: {self.app.template_folder}")
        logger.info(f"Static folder: {self.app.static_folder}")
        
        self.socketio.run(
            self.app,
            host=host,
            port=port,
            debug=debug,
            use_reloader=debug,
            allow_unsafe_werkzeug=True
        )

if __name__ == '__main__':
    try:
        print("🚀 Initializing ChatPro Professional Chat Application...")
        print("=" * 60)
        
        chat_app = ChatApplication()
        
        print("✅ Application initialized successfully!")
        print("🌐 MongoDB Atlas connected")
        print("📁 Template folder: static/templates")
        print("📦 Static folder: static")
        print("=" * 60)
        print("🔥 Starting server...")
        
        chat_app.run(
            host='127.0.0.1',  # Use localhost for development
            port=5000,
            debug=True
        )
        
    except Exception as e:
        logger.critical("Application failed to start: %s", e)
        print(f"❌ Error: {e}")
        print("\n🔧 Troubleshooting:")
        print("1. Check MongoDB connection string")
        print("2. Ensure static/templates folder exists")
        print("3. Verify all dependencies are installed")
        print("4. Run: pip install -r requirements.txt")
        print("5. Make sure login.html, register.html, chat.html exist in static/templates")