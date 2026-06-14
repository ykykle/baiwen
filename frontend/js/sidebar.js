/**
 * Sidebar Module - Conversation list and management
 */
const Sidebar = {
    conversations: [],
    activeId: null,

    /**
     * Initialize the sidebar
     */
    init() {
        this.listEl = document.getElementById('conversation-list');
        this.toggleBtn = document.getElementById('btn-toggle-sidebar');
        this.toggleIconCollapse = this.toggleBtn.querySelector('.icon-collapse');
        this.toggleIconExpand = this.toggleBtn.querySelector('.icon-expand');
        this.newChatBtn = document.getElementById('btn-new-chat');
        this.themeBtn = document.getElementById('btn-theme');
        this.sidebarEl = document.getElementById('sidebar');
        this.resizerEl = document.getElementById('sidebar-resizer');
        this.apiStatusEl = document.getElementById('api-status');

        // Bind events
        this.newChatBtn.addEventListener('click', () => App.createNewChat());
        this.toggleBtn.addEventListener('click', () => this.toggle());
        this.themeBtn.addEventListener('click', () => this.toggleTheme());
        this.listEl.addEventListener('click', (e) => this.handleListClick(e));
        this.listEl.addEventListener('contextmenu', (e) => this.handleContextMenu(e));

        // Resizer
        this.initResizer();

        // Keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'b') {
                e.preventDefault();
                this.toggle();
            }
        });

        // Close context menu on click outside
        document.addEventListener('click', () => this.hideContextMenu());

        // Load theme
        this.loadTheme();
    },

    /**
     * Load conversations from backend
     */
    async loadConversations() {
        try {
            const data = await API.listConversations();
            this.conversations = data.conversations || [];
            this.render();
        } catch (err) {
            console.error('Failed to load conversations:', err);
            this.conversations = [];
            this.render();
            Utils.toast('加载对话列表失败', 'error');
        }
    },

    /**
     * Render the conversation list
     */
    render() {
        if (!this.listEl) return;

        if (this.conversations.length === 0) {
            this.listEl.innerHTML = `
                <div style="padding:24px 16px;text-align:center;color:var(--text-muted);font-size:13px;">
                    暂无对话<br><br>点击上方按钮开始新对话
                </div>`;
            return;
        }

        this.listEl.innerHTML = this.conversations.map(c => `
            <div class="conv-item ${c.id === this.activeId ? 'active' : ''}"
                 data-id="${c.id}">
                <svg class="conv-item-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span class="conv-item-title">${Utils.escapeHtml(c.title || '新对话')}</span>
                <div class="conv-item-actions">
                    <button class="conv-item-action-btn" data-action="rename" data-id="${c.id}" title="重命名">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="conv-item-action-btn danger" data-action="delete" data-id="${c.id}" title="删除">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    },

    /**
     * Handle clicks in the conversation list
     */
    handleListClick(e) {
        const convItem = e.target.closest('.conv-item');
        const actionBtn = e.target.closest('.conv-item-action-btn');

        if (actionBtn) {
            e.stopPropagation();
            const action = actionBtn.dataset.action;
            const id = actionBtn.dataset.id;
            if (action === 'rename') this.renameConversation(id);
            if (action === 'delete') this.deleteConversation(id);
            return;
        }

        if (convItem) {
            const id = convItem.dataset.id;
            App.switchConversation(id);
        }
    },

    /**
     * Handle context menu (right-click) on conversation items
     */
    handleContextMenu(e) {
        const convItem = e.target.closest('.conv-item');
        if (!convItem) return;

        e.preventDefault();
        const id = convItem.dataset.id;
        this.showContextMenu(e.clientX, e.clientY, id);
    },

    /**
     * Show context menu
     */
    showContextMenu(x, y, convId) {
        const menu = document.getElementById('context-menu');
        menu.style.display = 'block';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.dataset.convId = convId;

        menu.querySelector('[data-action="rename"]').onclick = () => {
            this.renameConversation(convId);
            this.hideContextMenu();
        };
        menu.querySelector('[data-action="delete"]').onclick = () => {
            this.deleteConversation(convId);
            this.hideContextMenu();
        };
    },

    /**
     * Hide context menu
     */
    hideContextMenu() {
        const menu = document.getElementById('context-menu');
        menu.style.display = 'none';
    },

    /**
     * Rename a conversation
     */
    async renameConversation(id) {
        const conv = this.conversations.find(c => c.id === id);
        const currentName = conv ? conv.title : '';
        const newName = prompt('输入新名称:', currentName);
        if (newName && newName.trim()) {
            try {
                await API.renameConversation(id, newName.trim());
                await this.loadConversations();
                Utils.toast('已重命名', 'success');
            } catch (err) {
                Utils.toast('重命名失败: ' + err.message, 'error');
            }
        }
    },

    /**
     * Delete a conversation
     */
    async deleteConversation(id) {
        if (!confirm('确定要删除这个对话吗？此操作不可撤销。')) return;

        try {
            await API.deleteConversation(id);
            if (this.activeId === id) {
                // Switch to another conversation or create new
                const remaining = this.conversations.filter(c => c.id !== id);
                if (remaining.length > 0) {
                    App.switchConversation(remaining[0].id);
                } else {
                    App.createNewChat();
                }
            }
            await this.loadConversations();
            Utils.toast('对话已删除', 'success');
        } catch (err) {
            Utils.toast('删除失败: ' + err.message, 'error');
        }
    },

    /**
     * Set active conversation
     */
    setActive(id) {
        this.activeId = id;
        this.render();
    },

    /**
     * Update the toggle button position and icon for a target state.
     *
     * When the sidebar is collapsed, offsetWidth is 0, so we can't read the
     * expanded width live.  We save it whenever the sidebar is visible and fall
     * back to the saved value (or the CSS default) when expanding.
     *
     * @param {boolean} targetCollapsed - target collapsed state (undefined =
     *   use current DOM state — used for resize / init)
     */
    updateToggleButton(targetCollapsed) {
        if (!this.toggleBtn) return;

        // Resolve target state
        const willBeCollapsed = targetCollapsed !== undefined
            ? targetCollapsed
            : this.sidebarEl.classList.contains('collapsed');

        // Determine the sidebar width that matches the *target* state
        let sidebarWidth;
        if (willBeCollapsed) {
            // Heading to collapsed — button sits at left edge
            sidebarWidth = 0;
        } else {
            // Heading to expanded — need the expanded width.
            // When the sidebar is currently visible we read offsetWidth live;
            // when it's currently collapsed we use the saved width.
            if (!this.sidebarEl.classList.contains('collapsed')) {
                sidebarWidth = this.sidebarEl.offsetWidth;
            } else {
                sidebarWidth = this._savedSidebarWidth
                    || parseInt(this.sidebarEl.style.width)
                    || 280;
            }
        }

        // Persist the expanded width whenever we have a live reading so the
        // expand path above has a reliable fallback.
        if (!willBeCollapsed && sidebarWidth > 0) {
            this._savedSidebarWidth = sidebarWidth;
        }

        this.toggleBtn.style.left = (sidebarWidth + 8) + 'px';

        // Swap icons
        if (this.toggleIconCollapse) {
            this.toggleIconCollapse.style.display = willBeCollapsed ? 'none' : 'block';
        }
        if (this.toggleIconExpand) {
            this.toggleIconExpand.style.display = willBeCollapsed ? 'block' : 'none';
        }
    },

    /**
     * Toggle sidebar visibility.
     * Sets the button target position BEFORE toggling the sidebar class,
     * so both CSS transitions start in the same rendering frame.
     */
    toggle() {
        const willBeCollapsed = !this.sidebarEl.classList.contains('collapsed');
        // Set button target position first, so it animates in sync with sidebar
        this.updateToggleButton(willBeCollapsed);
        this.sidebarEl.classList.toggle('collapsed');
    },

    /**
     * Initialize sidebar resize functionality
     */
    initResizer() {
        let isResizing = false;
        let startX, startWidth;

        this.resizerEl.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = this.sidebarEl.offsetWidth;
            this.resizerEl.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const diff = e.clientX - startX;
            const newWidth = Math.min(
                Math.max(startWidth + diff, 200),
                500
            );
            this.sidebarEl.style.width = newWidth + 'px';
            this.sidebarEl.style.minWidth = newWidth + 'px';
            this.sidebarEl.style.maxWidth = newWidth + 'px';
            this.updateToggleButton();
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                this.resizerEl.classList.remove('resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                // Save width preference
                localStorage.setItem('sidebar-width', this.sidebarEl.offsetWidth);
                this.updateToggleButton();
            }
        });

        // Load saved width
        const savedWidth = localStorage.getItem('sidebar-width');
        if (savedWidth && parseInt(savedWidth) >= 200) {
            this.sidebarEl.style.width = savedWidth + 'px';
            this.sidebarEl.style.minWidth = savedWidth + 'px';
            this.sidebarEl.style.maxWidth = savedWidth + 'px';
        }
        // Initial position
        this.updateToggleButton();
    },

    /**
     * Update API status indicator
     */
    updateApiStatus(connected) {
        const dot = this.apiStatusEl.querySelector('.status-dot');
        const text = this.apiStatusEl.querySelector('.status-text');
        dot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
        text.textContent = connected ? 'API 已连接' : 'API 未连接';
    },

    /**
     * Toggle dark/light theme
     */
    toggleTheme() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const newTheme = isDark ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        this.updateThemeIcon(newTheme);
    },

    /**
     * Load saved theme
     */
    loadTheme() {
        const saved = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', saved);
        this.updateThemeIcon(saved);
    },

    /**
     * Update theme toggle icon
     */
    updateThemeIcon(theme) {
        const sunIcon = this.themeBtn.querySelector('.icon-sun');
        const moonIcon = this.themeBtn.querySelector('.icon-moon');
        if (theme === 'dark') {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
        } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
        }
    },
};
