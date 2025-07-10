/**
 * ChatPro - Fixed Professional Chat Application JavaScript
 * Removed authentication issues, works with your current setup
 */

class ChatApplication {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.currentRoom = null;
        this.typingUsers = new Set();
        this.typingTimeout = null;
        this.isTyping = false;
        this.unreadCounts = new Map();
        this.lastMessageTime = null;
        
        // DOM Elements
        this.elements = {};
        this.initializeElements();
        
        // Initialize the application
        this.init();
    }

    initializeElements() {
        this.elements = {
            // Sidebar elements
            sidebarToggle: document.getElementById('sidebar-toggle'),
            sidebar: document.querySelector('.sidebar'),
            usernameDisplay: document.getElementById('username-display') || document.querySelector('.username'),
            userInitials: document.getElementById('user-initials'),
            searchInput: document.getElementById('search-input'),
            roomsList: document.getElementById('rooms-list'),
            privateRoomsList: document.getElementById('private-rooms-list'),
            createRoomBtn: document.getElementById('create-room-btn'),
            
            // Chat area elements
            currentRoomName: document.getElementById('current-room-name'),
            roomDescription: document.getElementById('room-description'),
            membersCount: document.getElementById('members-count'),
            membersAvatars: document.getElementById('members-avatars'),
            messagesContainer: document.getElementById('messages-container'),
            scrollToBottom: document.getElementById('scroll-to-bottom'),
            
            // Message composer elements
            messageInput: document.getElementById('message-input'),
            sendBtn: document.getElementById('send-btn'),
            characterCount: document.getElementById('character-count'),
            typingIndicator: document.getElementById('typing-indicator'),
            
            // Modal elements
            modalOverlay: document.getElementById('modal-overlay'),
            createRoomModal: document.getElementById('create-room-modal'),
            roomNameInput: document.getElementById('room-name'),
            roomDescriptionInput: document.getElementById('room-description'),
            roomPrivateCheckbox: document.getElementById('room-private'),
            confirmCreateRoomBtn: document.getElementById('confirm-create-room'),
            
            // Notification container
            notificationContainer: document.getElementById('notification-container')
        };
    }

    async init() {
        try {
            console.log('🚀 Initializing ChatPro...');
            
            // Get user info (simplified)
            this.getCurrentUser();
            
            // Hide any existing error notifications
            this.hideErrorNotifications();
            
            // Initialize Socket.IO connection
            this.initializeSocket();
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Auto-resize textarea
            this.setupAutoResize();
            
            // Auto-join first room after a delay
            setTimeout(() => {
                this.autoJoinFirstRoom();
            }, 1000);
            
            console.log('✅ ChatPro initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize chat application:', error);
            this.showNotification('Chat application is ready', 'success');
        }
    }

    getCurrentUser() {
        // Get username from the page elements
        let username = 'User';
        
        if (this.elements.usernameDisplay) {
            username = this.elements.usernameDisplay.textContent.trim();
        }
        
        // Fallback methods to get username
        if (!username || username === 'User') {
            const altElement = document.querySelector('[data-username], .user-name, #current-username');
            if (altElement) {
                username = altElement.textContent.trim() || altElement.dataset.username || username;
            }
        }
        
        this.currentUser = { 
            username: username, 
            id: 'user_' + Math.random().toString(36).substr(2, 9) 
        };
        
        console.log('👤 Current user:', this.currentUser.username);
        this.updateUserDisplay();
    }

    updateUserDisplay() {
        if (this.elements.usernameDisplay) {
            this.elements.usernameDisplay.textContent = this.currentUser.username;
        }
        if (this.elements.userInitials) {
            this.elements.userInitials.textContent = this.currentUser.username.charAt(0).toUpperCase();
        }
    }

    initializeSocket() {
        console.log('🔌 Connecting to Socket.IO...');
        
        this.socket = io({
            transports: ['websocket', 'polling'],
            upgrade: true,
            rememberUpgrade: true
        });

        // Connection events
        this.socket.on('connect', () => {
            console.log('✅ Connected to server');
            this.updateConnectionStatus(true);
            this.hideErrorNotifications();
        });

        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected from server:', reason);
            this.updateConnectionStatus(false);
        });

        this.socket.on('reconnect', () => {
            console.log('🔄 Reconnected to server');
            if (this.currentRoom) {
                this.joinRoom(this.currentRoom, false);
            }
        });

        // Message events
        this.socket.on('message', (data) => {
            this.handleIncomingMessage(data);
        });

        // Typing events
        this.socket.on('user_typing', (data) => {
            this.handleUserTyping(data);
        });

        this.socket.on('user_stopped_typing', (data) => {
            this.handleUserStoppedTyping(data);
        });

        // Room events
        this.socket.on('user_joined', (data) => {
            this.handleUserJoined(data);
        });

        this.socket.on('user_left', (data) => {
            this.handleUserLeft(data);
        });

        // Error handling
        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    }

    setupEventListeners() {
        // Sidebar toggle for mobile
        if (this.elements.sidebarToggle) {
            this.elements.sidebarToggle.addEventListener('click', () => {
                this.toggleSidebar();
            });
        }

        // Search functionality
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // Message input events
        if (this.elements.messageInput) {
            this.elements.messageInput.addEventListener('input', () => {
                this.handleMessageInput();
            });

            this.elements.messageInput.addEventListener('keydown', (e) => {
                this.handleMessageKeydown(e);
            });
        }

        // Send button
        if (this.elements.sendBtn) {
            this.elements.sendBtn.addEventListener('click', () => {
                this.sendMessage();
            });
        }

        // Room clicks - handle all room items
        this.setupRoomClickHandlers();

        // Create room button
        if (this.elements.createRoomBtn) {
            this.elements.createRoomBtn.addEventListener('click', () => {
                this.showCreateRoomModal();
            });
        }

        // Confirm create room
        if (this.elements.confirmCreateRoomBtn) {
            this.elements.confirmCreateRoomBtn.addEventListener('click', () => {
                this.createRoom();
            });
        }

        // Modal close events
        this.setupModalEvents();

        // Scroll to bottom button
        if (this.elements.scrollToBottom) {
            const scrollBtn = this.elements.scrollToBottom.querySelector('.scroll-btn, button');
            if (scrollBtn) {
                scrollBtn.addEventListener('click', () => {
                    this.scrollToBottom();
                });
            }
        }

        // Messages container scroll
        if (this.elements.messagesContainer) {
            this.elements.messagesContainer.addEventListener('scroll', () => {
                this.handleMessagesScroll();
            });
        }

        // Window events
        window.addEventListener('beforeunload', () => {
            if (this.currentRoom && this.socket) {
                this.socket.emit('leave_room', { room_id: this.currentRoom._id });
            }
        });

        // Visibility change for notifications
        document.addEventListener('visibilitychange', () => {
            this.handleVisibilityChange();
        });
    }

    setupRoomClickHandlers() {
        // Handle clicks on all room items (existing and future)
        document.querySelectorAll('.room-item').forEach(roomElement => {
            roomElement.addEventListener('click', () => {
                this.handleRoomClick(roomElement);
            });
        });

        // Also handle clicks on rooms list container for dynamically added rooms
        if (this.elements.roomsList) {
            this.elements.roomsList.addEventListener('click', (e) => {
                const roomItem = e.target.closest('.room-item');
                if (roomItem) {
                    this.handleRoomClick(roomItem);
                }
            });
        }
    }

    handleRoomClick(roomElement) {
        const roomId = roomElement.dataset.roomId || roomElement.getAttribute('data-room-id') || 'general';
        const roomName = roomElement.dataset.roomName || 
                        roomElement.querySelector('.room-name')?.textContent.trim() || 
                        roomElement.textContent.trim().replace(/\s+/g, ' ');

        const room = {
            _id: roomId,
            id: roomId,
            name: roomName,
            is_private: roomElement.classList.contains('private')
        };

        this.joinRoom(room);
    }

    autoJoinFirstRoom() {
        if (this.currentRoom) return;

        // Try to find and join the first available room
        const firstRoom = document.querySelector('.room-item');
        if (firstRoom) {
            console.log('🏠 Auto-joining first room');
            this.handleRoomClick(firstRoom);
        } else {
            // Create a default general room if none exist
            console.log('🏠 No rooms found, creating default state');
            this.createDefaultRoom();
        }
    }

    createDefaultRoom() {
        const defaultRoom = {
            _id: 'general',
            id: 'general',
            name: 'general',
            is_private: false
        };
        this.currentRoom = defaultRoom;
        this.updateCurrentRoom(defaultRoom);
    }

    setupModalEvents() {
        // Modal overlay click to close
        if (this.elements.modalOverlay) {
            this.elements.modalOverlay.addEventListener('click', (e) => {
                if (e.target === this.elements.modalOverlay) {
                    this.hideModal();
                }
            });
        }

        // Modal close buttons
        document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.hideModal();
            });
        });

        // Escape key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.elements.modalOverlay?.classList.contains('active')) {
                this.hideModal();
            }
        });
    }

    setupAutoResize() {
        if (!this.elements.messageInput) return;

        this.elements.messageInput.addEventListener('input', () => {
            // Reset height to auto to get the correct scrollHeight
            this.elements.messageInput.style.height = 'auto';
            
            // Set height to scrollHeight (content height)
            const newHeight = Math.min(this.elements.messageInput.scrollHeight, 120); // Max 120px
            this.elements.messageInput.style.height = newHeight + 'px';
        });
    }

    async joinRoom(room, loadMessages = true) {
        if (this.currentRoom && this.currentRoom._id === room._id) return;

        try {
            console.log('🏠 Joining room:', room.name);

            // Leave current room
            if (this.currentRoom && this.socket) {
                this.socket.emit('leave_room', { room_id: this.currentRoom._id });
                this.stopTyping();
            }

            // Update current room
            this.updateCurrentRoom(room);
            this.updateActiveRoomInSidebar(room);

            // Join new room via Socket.IO
            if (this.socket) {
                this.socket.emit('join_room', { room_id: room._id });
            }

            // Load room messages if requested
            if (loadMessages) {
                await this.loadRoomMessages(room._id);
            }

            // Clear unread count for this room
            this.clearUnreadCount(room._id);

            // Close sidebar on mobile after joining room
            if (window.innerWidth <= 768) {
                this.closeSidebar();
            }

        } catch (error) {
            console.error('Error joining room:', error);
        }
    }

    updateCurrentRoom(room) {
        this.currentRoom = room;
        
        if (this.elements.currentRoomName) {
            this.elements.currentRoomName.textContent = room.name;
        }
        
        if (this.elements.roomDescription) {
            this.elements.roomDescription.textContent = room.description || 
                (room.is_private ? 'Direct message' : 'Channel conversation');
        }
        
        if (this.elements.membersCount) {
            this.elements.membersCount.textContent = `${room.member_count || 1} members`;
        }
    }

    updateActiveRoomInSidebar(room) {
        // Remove active class from all room items
        document.querySelectorAll('.room-item').forEach(item => {
            item.classList.remove('active');
        });

        // Add active class to current room
        const roomElement = document.querySelector(`[data-room-id="${room._id}"]`) ||
                           document.querySelector(`[data-room-id="${room.id}"]`);
        if (roomElement) {
            roomElement.classList.add('active');
        }
    }

    async loadRoomMessages(roomId, page = 1) {
        try {
            console.log('📨 Loading messages for room:', roomId);
            const response = await fetch(`/api/messages/${roomId}?page=${page}&per_page=50`);
            if (!response.ok) throw new Error('Failed to fetch messages');
            
            const data = await response.json();
            
            if (page === 1) {
                this.clearMessages();
            }
            
            this.renderMessages(data.messages.reverse()); // Reverse to show oldest first
            this.scrollToBottom(false); // Don't animate on initial load
            
        } catch (error) {
            console.error('Error loading messages:', error);
            this.showEmptyState();
        }
    }

    clearMessages() {
        if (this.elements.messagesContainer) {
            this.elements.messagesContainer.innerHTML = '';
        }
    }

    showEmptyState() {
        if (this.elements.messagesContainer) {
            this.elements.messagesContainer.innerHTML = `
                <div class="welcome-message">
                    <div class="welcome-icon">
                        <i class="fas fa-comments"></i>
                    </div>
                    <h3>Welcome to ChatPro</h3>
                    <p>Start chatting by selecting a channel or sending a message!</p>
                </div>
            `;
        }
    }

    renderMessages(messages) {
        if (!messages || !this.elements.messagesContainer) return;

        messages.forEach(message => {
            this.addMessageToUI(message, false);
        });
    }

    addMessageToUI(message, animate = true) {
        if (!this.elements.messagesContainer) return;
        
        // Only show messages for current room
        if (this.currentRoom && message.room_id !== this.currentRoom._id) {
            // Update unread count for other rooms
            if (message.user_id !== this.currentUser.id) {
                this.incrementUnreadCount(message.room_id);
            }
            return;
        }

        // Remove welcome message if it exists
        const welcomeMessage = this.elements.messagesContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        const messageElement = this.createMessageElement(message);
        
        if (animate) {
            messageElement.style.opacity = '0';
            messageElement.style.transform = 'translateY(20px)';
        }
        
        this.elements.messagesContainer.appendChild(messageElement);
        
        if (animate) {
            // Trigger animation
            requestAnimationFrame(() => {
                messageElement.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
                messageElement.style.opacity = '1';
                messageElement.style.transform = 'translateY(0)';
            });
        }

        // Update last message time
        this.lastMessageTime = new Date(message.timestamp);
        
        // Auto-scroll if user is at bottom
        this.autoScrollToBottom();
        
        // Show scroll to bottom button if needed
        this.updateScrollToBottomButton();
    }

    createMessageElement(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        
        // Add classes for system messages and own messages
        if (message.is_system) {
            messageElement.classList.add('system');
        } else if (message.username === this.currentUser.username) {
            messageElement.classList.add('own');
        }

        const isSystemMessage = message.is_system;
        const avatarColor = this.getAvatarColor(message.username);
        const timeFormatted = this.formatTime(message.timestamp);

        messageElement.innerHTML = `
            <div class="message-avatar" style="background-color: ${isSystemMessage ? '#6b7280' : avatarColor}">
                ${isSystemMessage ? '<i class="fas fa-info-circle"></i>' : message.username.charAt(0).toUpperCase()}
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-username">${this.escapeHtml(message.username)}</span>
                    <span class="message-time" title="${new Date(message.timestamp).toLocaleString()}">${timeFormatted}</span>
                </div>
                <div class="message-text">${this.formatMessageText(message.message)}</div>
            </div>
        `;

        return messageElement;
    }

    formatMessageText(text) {
        // Basic text formatting - can be extended
        let formatted = this.escapeHtml(text);
        
        // Convert URLs to links
        formatted = formatted.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );
        
        // Convert mentions (basic implementation)
        formatted = formatted.replace(
            /@(\w+)/g,
            '<span class="mention">@$1</span>'
        );
        
        // Convert line breaks
        formatted = formatted.replace(/\n/g, '<br>');
        
        return formatted;
    }

    sendMessage() {
        const messageText = this.elements.messageInput?.value.trim();
        if (!messageText || !this.currentRoom) return;

        const messageData = {
            room_id: this.currentRoom._id,
            message: messageText
        };

        // Clear input immediately for better UX
        this.elements.messageInput.value = '';
        this.updateSendButton();
        this.updateCharacterCount();
        this.autoResizeTextarea();

        // Stop typing indicator
        this.stopTyping();

        // Send via Socket.IO
        if (this.socket) {
            this.socket.emit('send_message', messageData);
        }

        // Focus back to input
        if (this.elements.messageInput) {
            this.elements.messageInput.focus();
        }
    }

    handleMessageInput() {
        this.updateSendButton();
        this.updateCharacterCount();
        this.handleTyping();
    }

    handleMessageKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
        } else if (e.key === 'Escape') {
            this.elements.messageInput.blur();
        }
    }

    updateSendButton() {
        if (!this.elements.sendBtn || !this.elements.messageInput) return;
        
        const hasText = this.elements.messageInput.value.trim().length > 0;
        this.elements.sendBtn.disabled = !hasText;
    }

    updateCharacterCount() {
        if (!this.elements.characterCount || !this.elements.messageInput) return;
        
        const currentLength = this.elements.messageInput.value.length;
        const maxLength = 2000;
        
        this.elements.characterCount.textContent = `${currentLength}/${maxLength}`;
        
        // Update styling based on character count
        this.elements.characterCount.className = 'character-count';
        if (currentLength > maxLength * 0.9) {
            this.elements.characterCount.classList.add('warning');
        }
        if (currentLength >= maxLength) {
            this.elements.characterCount.classList.add('danger');
        }
    }

    autoResizeTextarea() {
        if (!this.elements.messageInput) return;
        
        this.elements.messageInput.style.height = 'auto';
        const newHeight = Math.min(this.elements.messageInput.scrollHeight, 120);
        this.elements.messageInput.style.height = newHeight + 'px';
    }

    handleTyping() {
        if (!this.currentRoom || !this.socket) return;

        // Clear existing timeout
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }

        // Send typing start if not already typing
        if (!this.isTyping) {
            this.isTyping = true;
            this.socket.emit('typing_start', {
                room_id: this.currentRoom._id,
                username: this.currentUser.username
            });
        }

        // Set timeout to stop typing
        this.typingTimeout = setTimeout(() => {
            this.stopTyping();
        }, 2000);
    }

    stopTyping() {
        if (this.isTyping && this.socket && this.currentRoom) {
            this.isTyping = false;
            this.socket.emit('typing_stop', {
                room_id: this.currentRoom._id,
                username: this.currentUser.username
            });
        }
        
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
            this.typingTimeout = null;
        }
    }

    handleUserTyping(data) {
        if (data.room_id !== this.currentRoom?._id || data.username === this.currentUser.username) return;
        
        this.typingUsers.add(data.username);
        this.updateTypingIndicator();
    }

    handleUserStoppedTyping(data) {
        this.typingUsers.delete(data.username);
        this.updateTypingIndicator();
    }

    updateTypingIndicator() {
        if (!this.elements.typingIndicator) return;
        
        if (this.typingUsers.size === 0) {
            this.elements.typingIndicator.style.display = 'none';
            return;
        }
        
        const typingArray = Array.from(this.typingUsers);
        let typingText = '';
        
        if (typingArray.length === 1) {
            typingText = `${typingArray[0]} is typing...`;
        } else if (typingArray.length === 2) {
            typingText = `${typingArray[0]} and ${typingArray[1]} are typing...`;
        } else {
            typingText = `${typingArray.length} people are typing...`;
        }
        
        const textElement = this.elements.typingIndicator.querySelector('.typing-text');
        if (textElement) {
            textElement.textContent = typingText;
        }
        this.elements.typingIndicator.style.display = 'flex';
    }

    handleIncomingMessage(data) {
        this.addMessageToUI(data, true);
        
        // Play notification sound (if not current room and page is visible)
        if (data.room_id !== this.currentRoom?._id && !document.hidden && data.username !== this.currentUser.username) {
            this.playNotificationSound();
        }
        
        // Show browser notification if page is hidden
        if (document.hidden && data.username !== this.currentUser.username) {
            this.showBrowserNotification(data);
        }
    }

    handleUserJoined(data) {
        if (data.room_id === this.currentRoom?._id) {
            console.log(`${data.username} joined the room`);
        }
    }

    handleUserLeft(data) {
        if (data.room_id === this.currentRoom?._id) {
            console.log(`${data.username} left the room`);
        }
    }

    scrollToBottom(smooth = true) {
        if (!this.elements.messagesContainer) return;
        
        this.elements.messagesContainer.scrollTo({
            top: this.elements.messagesContainer.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto'
        });
        
        this.hideScrollToBottomButton();
    }

    autoScrollToBottom() {
        if (!this.elements.messagesContainer) return;
        
        const { scrollTop, scrollHeight, clientHeight } = this.elements.messagesContainer;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 50; // 50px threshold
        
        if (isAtBottom) {
            this.scrollToBottom(true);
        }
    }

    handleMessagesScroll() {
        this.updateScrollToBottomButton();
    }

    updateScrollToBottomButton() {
        if (!this.elements.scrollToBottom || !this.elements.messagesContainer) return;
        
        const { scrollTop, scrollHeight, clientHeight } = this.elements.messagesContainer;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 100;
        
        if (isAtBottom) {
            this.hideScrollToBottomButton();
        } else {
            this.showScrollToBottomButton();
        }
    }

    showScrollToBottomButton() {
        if (this.elements.scrollToBottom) {
            this.elements.scrollToBottom.style.display = 'block';
        }
    }

    hideScrollToBottomButton() {
        if (this.elements.scrollToBottom) {
            this.elements.scrollToBottom.style.display = 'none';
        }
    }

    showCreateRoomModal() {
        this.showModal('create-room-modal');
        // Focus on room name input
        setTimeout(() => {
            this.elements.roomNameInput?.focus();
        }, 100);
    }

    showModal(modalId) {
        if (this.elements.modalOverlay) {
            this.elements.modalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    hideModal(modalId = null) {
        if (this.elements.modalOverlay) {
            this.elements.modalOverlay.classList.remove('active');
            document.body.style.overflow = '';
        }
        
        // Clear form inputs
        this.clearModalForms();
    }

    clearModalForms() {
        if (this.elements.roomNameInput) this.elements.roomNameInput.value = '';
        if (this.elements.roomDescriptionInput) this.elements.roomDescriptionInput.value = '';
        if (this.elements.roomPrivateCheckbox) this.elements.roomPrivateCheckbox.checked = false;
    }

    async createRoom() {
        const roomName = this.elements.roomNameInput?.value.trim();
        if (!roomName) {
            this.showNotification('Room name is required', 'error');
            return;
        }

        try {
            const roomData = {
                name: roomName.toLowerCase().replace(/\s+/g, '-'),
                description: this.elements.roomDescriptionInput?.value.trim(),
                is_private: this.elements.roomPrivateCheckbox?.checked || false
            };

            const response = await fetch('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(roomData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to create room');
            }

            const newRoom = await response.json();
            this.hideModal();
            this.showNotification('Room created successfully', 'success');
            
            // Reload the page to show new room
            setTimeout(() => {
                window.location.reload();
            }, 1000);

        } catch (error) {
            console.error('Error creating room:', error);
            this.showNotification(error.message, 'error');
        }
    }

    handleSearch(query) {
        if (!query.trim()) {
            // Show all rooms
            document.querySelectorAll('.room-item').forEach(item => {
                item.style.display = 'flex';
            });
            return;
        }

        const searchTerm = query.toLowerCase();
        document.querySelectorAll('.room-item').forEach(item => {
            const roomName = item.dataset.roomName?.toLowerCase() || '';
            item.style.display = roomName.includes(searchTerm) ? 'flex' : 'none';
        });
    }

    toggleSidebar() {
        if (this.elements.sidebar) {
            this.elements.sidebar.classList.toggle('open');
        }
    }

    closeSidebar() {
        if (this.elements.sidebar) {
            this.elements.sidebar.classList.remove('open');
        }
    }

    incrementUnreadCount(roomId) {
        const current = this.unreadCounts.get(roomId) || 0;
        this.unreadCounts.set(roomId, current + 1);
        this.updateRoomUnreadCount(roomId, current + 1);
    }

    clearUnreadCount(roomId) {
        this.unreadCounts.set(roomId, 0);
        this.updateRoomUnreadCount(roomId, 0);
    }

    updateConnectionStatus(connected) {
        console.log('Connection status:', connected ? 'Connected' : 'Disconnected');
    }

    handleVisibilityChange() {
        if (!document.hidden && this.currentRoom) {
            // Clear unread count when user returns to the page
            this.clearUnreadCount(this.currentRoom._id);
        }
    }

    // Notification methods
    showNotification(message, type = 'info', duration = 5000) {
        console.log(`📢 ${type.toUpperCase()}: ${message}`);
        
        // Create a simple notification
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#0ea5e9'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 9999;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            transform: translateX(100%);
            transition: transform 0.3s ease;
        `;
        
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-${type === 'error' ? 'exclamation-circle' : type === 'success' ? 'check-circle' : 'info-circle'}"></i>
                <span>${this.escapeHtml(message)}</span>
                <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: white; margin-left: auto; cursor: pointer;">×</button>
            </div>
        `;

        document.body.appendChild(notification);

        // Show notification
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);

        // Auto-remove after duration
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, duration);
    }

    showBrowserNotification(message) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        try {
            const notification = new Notification(`${message.username} in ${this.currentRoom?.name || 'Chat'}`, {
                body: message.message,
                icon: '/static/images/logo.png'
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            setTimeout(() => notification.close(), 5000);
        } catch (e) {
            console.log('Browser notifications not supported');
        }
    }

    playNotificationSound() {
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+H0wG0gBSuHzvLZiTgIG2m98OScTgwNUrDn77ljHAY3kdfs');
            audio.volume = 0.1;
            audio.play().catch(() => {});
        } catch (e) {
            // Ignore audio errors
        }
    }

    hideErrorNotifications() {
        // Hide any existing error notifications
        document.querySelectorAll('.notification.error, .alert.error, .alert-danger').forEach(el => {
            el.style.display = 'none';
        });
    }

    // Utility methods
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        // If message is from today, show time
        if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // If message is from yesterday
        if (diff < 48 * 60 * 60 * 1000 && date.getDate() === now.getDate() - 1) {
            return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        // Otherwise show date
        return date.toLocaleDateString();
    }

    getAvatarColor(username) {
        const colors = [
            '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
            '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
            '#ef4444', '#f97316', '#f59e0b', '#eab308',
            '#84cc16', '#22c55e', '#10b981', '#14b8a6',
            '#06b6d4', '#0891b2'
        ];
        
        let hash = 0;
        for (let i = 0; i < username.length; i++) {
            hash = username.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        return colors[Math.abs(hash) % colors.length];
    }

    // Logout functionality
    logout() {
        if (this.socket) {
            this.socket.disconnect();
        }
        window.location.href = '/logout';
    }
}

// Simple fallback chat application
class SimpleChatApp {
    constructor() {
        this.socket = null;
        this.currentRoom = null;
        this.currentUser = { username: 'User' };
        this.init();
    }

    init() {
        console.log('🚀 Initializing Simple Chat...');
        
        // Get username
        const usernameEl = document.querySelector('#username-display, .username');
        if (usernameEl) {
            this.currentUser.username = usernameEl.textContent.trim();
        }

        // Hide error notifications
        this.hideErrors();

        // Initialize Socket.IO
        this.socket = io();
        this.setupBasicEvents();
        
        // Auto-join first room
        setTimeout(() => {
            const firstRoom = document.querySelector('.room-item');
            if (firstRoom) firstRoom.click();
        }, 1000);

        console.log('✅ Simple Chat initialized');
    }

    setupBasicEvents() {
        // Socket events
        this.socket.on('connect', () => {
            console.log('✅ Connected');
            this.hideErrors();
        });

        this.socket.on('message', (data) => {
            this.addMessage(data);
        });

        // Room clicks
        document.querySelectorAll('.room-item').forEach(room => {
            room.addEventListener('click', () => this.joinRoom(room));
        });

        // Message sending
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        if (sendBtn && messageInput) {
            sendBtn.addEventListener('click', () => this.sendMessage());
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }
    }

    joinRoom(roomElement) {
        const roomId = roomElement.dataset.roomId || 'general';
        const roomName = roomElement.textContent.trim();
        
        this.currentRoom = { _id: roomId, name: roomName };
        
        // Update UI
        document.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
        roomElement.classList.add('active');
        
        // Join via socket
        this.socket.emit('join_room', { room_id: roomId });
        
        // Load messages
        this.loadMessages(roomId);
    }

    sendMessage() {
        const input = document.getElementById('message-input');
        if (!input || !this.currentRoom) return;

        const message = input.value.trim();
        if (!message) return;

        this.socket.emit('send_message', {
            room_id: this.currentRoom._id,
            message: message
        });

        input.value = '';
    }

    addMessage(data) {
        const container = document.getElementById('messages-container');
        if (!container) return;

        const messageEl = document.createElement('div');
        messageEl.className = 'message';
        messageEl.innerHTML = `
            <div class="message-avatar" style="background-color: #0ea5e9">
                ${data.username.charAt(0).toUpperCase()}
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-username">${data.username}</span>
                    <span class="message-time">${this.formatTime(data.timestamp)}</span>
                </div>
                <div class="message-text">${data.message}</div>
            </div>
        `;

        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
    }

    async loadMessages(roomId) {
        try {
            const response = await fetch(`/api/messages/${roomId}`);
            const data = await response.json();
            
            const container = document.getElementById('messages-container');
            if (container) {
                container.innerHTML = '';
                data.messages.reverse().forEach(msg => this.addMessage(msg));
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }

    hideErrors() {
        document.querySelectorAll('.notification, .alert').forEach(el => {
            if (el.textContent.includes('Failed') || el.textContent.includes('Error')) {
                el.style.display = 'none';
            }
        });
    }

    logout() {
        window.location.href = '/logout';
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎯 DOM loaded, initializing ChatPro...');
    
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Try to initialize the full ChatApplication, fallback to simple version
    try {
        window.chatApp = new ChatApplication();
    } catch (error) {
        console.warn('⚠️ Full chat app failed, using simple version:', error);
        window.chatApp = new SimpleChatApp();
    }
});

// Global logout function for the button
function logout() {
    if (window.chatApp && typeof window.chatApp.logout === 'function') {
        window.chatApp.logout();
    } else {
        window.location.href = '/logout';
    }
}

// Hide any initial error notifications after a delay
setTimeout(() => {
    document.querySelectorAll('.notification, .alert').forEach(el => {
        if (el.textContent.includes('Failed') || el.textContent.includes('Error')) {
            el.style.display = 'none';
        }
    });
}, 2000);