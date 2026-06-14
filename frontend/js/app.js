/**
 * Main Application - Initialization and orchestration
 */
const App = {
    currentConvId: null,

    /**
     * Initialize the application
     */
    async init() {
        // Initialize all modules
        Sidebar.init();
        Chat.init();

        // Check API health
        await this.checkHealth();

        // Load conversations from backend
        await Sidebar.loadConversations();

        // If there are conversations, load the first one
        if (Sidebar.conversations.length > 0) {
            await this.switchConversation(Sidebar.conversations[0].id);
        }

        // Global keyboard shortcuts
        this.initKeyboardShortcuts();

        console.log('AI Chat Assistant initialized');
    },

    /**
     * Check API health and update status
     */
    async checkHealth() {
        try {
            const health = await API.health();
            if (health.has_api_key) {
                Sidebar.updateApiStatus(true);
            } else {
                Sidebar.updateApiStatus(false);
                console.warn('API key not configured. Set ANTHROPIC_API_KEY environment variable.');
            }
        } catch (err) {
            Sidebar.updateApiStatus(false);
            console.warn('API server not reachable:', err.message);
        }
    },

    /**
     * Create a new empty chat
     */
    async createNewChat() {
        // Don't create if already on empty state
        if (!this.currentConvId && Chat.messages.length === 0) return;

        this.currentConvId = null;
        Chat.clear();
        Sidebar.setActive(null);

        // Focus input
        Chat.inputEl.focus();
    },

    /**
     * Switch to an existing conversation
     */
    async switchConversation(convId) {
        if (this.currentConvId === convId) return;

        // Don't switch while streaming
        if (Chat.isStreaming) return;

        try {
            const conv = await API.getConversation(convId);
            this.currentConvId = convId;
            Chat.loadMessages(conv.messages || []);

            // Update model select
            if (conv.model && Chat.modelSelectEl) {
                Chat.modelSelectEl.value = conv.model;
            }

            // Update mode buttons
            if (conv.mode) {
                document.querySelectorAll('.mode-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.mode === conv.mode);
                });
            }

            Sidebar.setActive(convId);
        } catch (err) {
            Utils.toast('加载对话失败: ' + err.message, 'error');
            // Remove from sidebar and create new
            this.currentConvId = null;
            await Sidebar.loadConversations();
            Chat.clear();
        }
    },

    /**
     * Initialize global keyboard shortcuts
     */
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+N: New chat
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                this.createNewChat();
            }
            // Ctrl+B: Toggle sidebar
            if (e.ctrlKey && e.key === 'b') {
                e.preventDefault();
                Sidebar.toggle();
            }
            // Escape: close context menu
            if (e.key === 'Escape') {
                Sidebar.hideContextMenu();
            }
        });
    },
};

// --- Bootstrap ---
document.addEventListener('DOMContentLoaded', () => {
    App.init().catch(err => {
        console.error('App initialization failed:', err);
    });
});
