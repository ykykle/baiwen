/**
 * Chat Module - Message display, streaming, and input handling
 */
const Chat = {
    messages: [],
    attachments: [],
    isStreaming: false,
    currentStreamingEl: null,
    currentThinkingEl: null,

    /**
     * Initialize chat
     */
    init() {
        this.messagesEl = document.getElementById('chat-messages');
        this.emptyStateEl = document.getElementById('empty-state');
        this.inputEl = document.getElementById('chat-input');
        this.sendBtn = document.getElementById('btn-send');
        this.uploadBtn = document.getElementById('btn-upload');
        this.fileInputEl = document.getElementById('file-input');
        this.attachmentsEl = document.getElementById('attachment-previews');
        this.modelSelectEl = document.getElementById('model-select');

        // Bind events
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.uploadBtn.addEventListener('click', () => this.fileInputEl.click());
        this.fileInputEl.addEventListener('change', (e) => this.handleFileSelect(e));
        this.inputEl.addEventListener('keydown', (e) => this.handleInputKeydown(e));
        this.inputEl.addEventListener('input', () => this.autoResizeInput());

        // Mode buttons
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
        });

        // Quick action buttons on empty state
        document.querySelectorAll('.quick-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.dataset.prompt;
                this.inputEl.value = prompt;
                this.sendMessage();
            });
        });

        // Model select
        this.modelSelectEl.addEventListener('change', () => {
            if (App.currentConvId) {
                API.updateSettings(App.currentConvId, this.modelSelectEl.value, null).catch(() => {});
            }
        });
    },

    /**
     * Load messages into the chat view
     */
    loadMessages(messages) {
        this.messages = messages || [];
        this.renderMessages();
    },

    /**
     * Render all messages
     */
    renderMessages() {
        if (!this.messagesEl) return;

        if (this.messages.length === 0) {
            this.showEmptyState();
            return;
        }

        this.hideEmptyState();
        this.messagesEl.innerHTML = '';

        const inner = document.createElement('div');
        inner.className = 'chat-messages-inner';

        this.messages.forEach((msg, index) => {
            const msgEl = this.createMessageElement(msg, index);
            inner.appendChild(msgEl);
        });

        this.messagesEl.appendChild(inner);
        this.scrollToBottom();
    },

    /**
     * Create a single message DOM element
     */
    createMessageElement(msg, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message';
        wrapper.dataset.index = index;

        wrapper.innerHTML = `
            <div class="message-inner">
                <div class="message-avatar ${msg.role}">
                    ${msg.role === 'user' ? 'U' : 'AI'}
                </div>
                <div class="message-body">
                    <div class="message-role">${msg.role === 'user' ? '你' : 'AI助手'}</div>
                    ${msg.attachments && msg.attachments.length ? `
                        <div class="message-attachments">
                            ${msg.attachments.map(att => `
                                <div class="message-attachment">
                                    ${att.type && att.type.startsWith('image/')
                                        ? `<img src="${att.data_url}" alt="${Utils.escapeHtml(att.name)}" loading="lazy">`
                                        : Utils.getFileIcon(att.type || '')}
                                    <span>${Utils.escapeHtml(att.name)}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    <div class="message-content">${Utils.renderMarkdown(msg.content || '')}</div>
                </div>
            </div>
        `;

        // Highlight code blocks
        const contentEl = wrapper.querySelector('.message-content');
        if (contentEl) {
            Utils.highlightCode(contentEl);
        }

        // Add copy button to code blocks
        wrapper.querySelectorAll('pre').forEach(pre => {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-copy-btn';
            copyBtn.textContent = '复制';
            copyBtn.style.cssText = `
                position:absolute; top:8px; right:8px; padding:4px 10px;
                border-radius:4px; background:rgba(255,255,255,0.1); color:#ccc;
                font-size:11px; cursor:pointer; border:none; transition:all 0.2s;
            `;
            copyBtn.addEventListener('click', () => {
                const code = pre.querySelector('code')?.textContent || pre.textContent;
                Utils.copyToClipboard(code);
            });
            copyBtn.addEventListener('mouseenter', () => {
                copyBtn.style.background = 'rgba(255,255,255,0.2)';
                copyBtn.style.color = '#fff';
            });
            copyBtn.addEventListener('mouseleave', () => {
                copyBtn.style.background = 'rgba(255,255,255,0.1)';
                copyBtn.style.color = '#ccc';
            });
            pre.style.position = 'relative';
            pre.appendChild(copyBtn);
        });

        return wrapper;
    },

    /**
     * Create a streaming message element (empty, for live updates)
     */
    createStreamingElement() {
        const wrapper = document.createElement('div');
        wrapper.className = 'message streaming';
        wrapper.innerHTML = `
            <div class="message-inner">
                <div class="message-avatar assistant">AI</div>
                <div class="message-body">
                    <div class="message-role">AI助手</div>
                    <div class="message-content streaming-cursor"></div>
                </div>
            </div>
        `;

        // Add thinking section for deep mode
        const thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'thinking-section';
        thinkingDiv.style.cssText = 'display:none; margin-top: 8px; padding: 10px 14px; background: var(--bg-tertiary); border-radius: var(--radius-sm); font-size: 13px; color: var(--text-tertiary); border-left: 3px solid var(--accent);';
        thinkingDiv.innerHTML = '<div class="thinking-label" style="font-weight:600;margin-bottom:4px;color:var(--accent);">🧠 深度思考</div><div class="thinking-content"></div>';
        wrapper.querySelector('.message-body').appendChild(thinkingDiv);

        return wrapper;
    },

    /**
     * Send a message
     */
    async sendMessage() {
        const text = this.inputEl.value.trim();
        if (!text || this.isStreaming) return;

        // Create conversation if needed
        if (!App.currentConvId) {
            try {
                const conv = await API.createConversation();
                App.currentConvId = conv.id;
                Sidebar.setActive(conv.id);
                await Sidebar.loadConversations();
            } catch (err) {
                Utils.toast('创建对话失败: ' + err.message, 'error');
                return;
            }
        }

        // Clear input
        this.inputEl.value = '';
        this.autoResizeInput();

        // Clear attachments
        const attachments = [...this.attachments];
        this.clearAttachments();

        // Add user message to local state
        const userMsg = {
            id: Utils.uid(),
            role: 'user',
            content: text,
            attachments: attachments.length > 0 ? attachments : undefined,
        };
        this.messages.push(userMsg);

        // Update UI
        this.hideEmptyState();
        this.appendUserMessage(userMsg);

        // Disable send button, show streaming
        this.isStreaming = true;
        this.updateSendButton();

        // Create streaming placeholder
        this.currentStreamingEl = this.createStreamingElement();
        const inner = this.messagesEl.querySelector('.chat-messages-inner');
        inner.appendChild(this.currentStreamingEl);
        this.scrollToBottom();

        const contentEl = this.currentStreamingEl.querySelector('.message-content');
        const thinkingEl = this.currentStreamingEl.querySelector('.thinking-section');
        const thinkingContentEl = this.currentStreamingEl.querySelector('.thinking-content');
        let fullText = '';

        // Get current settings
        const model = this.modelSelectEl.value;
        const mode = document.querySelector('.mode-btn.active')?.dataset?.mode || 'quick';

        // Stream the response
        await API.chatStream(
            App.currentConvId,
            text,
            model,
            mode,
            attachments.length > 0 ? attachments : null,
            // onText
            (chunk) => {
                fullText += chunk;
                contentEl.innerHTML = Utils.renderMarkdown(fullText);
                contentEl.classList.add('streaming-cursor');
                this.scrollToBottom();
            },
            // onThinking
            (thinkingText) => {
                if (thinkingEl) {
                    thinkingEl.style.display = 'block';
                    if (thinkingText === '[思考开始]') {
                        thinkingContentEl.textContent = '';
                    } else if (thinkingText === '[思考结束]') {
                        // Keep thinking visible but mark as complete
                    } else {
                        thinkingContentEl.textContent += thinkingText;
                    }
                }
                this.scrollToBottom();
            },
            // onDone
            (messageId) => {
                contentEl.classList.remove('streaming-cursor');
                contentEl.innerHTML = Utils.renderMarkdown(fullText);
                Utils.highlightCode(contentEl);

                // Add to messages
                this.messages.push({
                    id: messageId || Utils.uid(),
                    role: 'assistant',
                    content: fullText,
                });

                // Clean up streaming state
                this.currentStreamingEl.classList.remove('streaming');
                this.currentStreamingEl = null;
                this.currentThinkingEl = null;
                this.isStreaming = false;
                this.updateSendButton();
                this.inputEl.focus();

                // Refresh sidebar (for title update)
                Sidebar.loadConversations();
            },
            // onError
            (errorText) => {
                contentEl.classList.remove('streaming-cursor');
                contentEl.innerHTML = `<div class="error-banner">❌ 错误: ${Utils.escapeHtml(errorText)}</div>`;
                this.currentStreamingEl = null;
                this.isStreaming = false;
                this.updateSendButton();
                this.inputEl.focus();
                Utils.toast('请求失败: ' + errorText, 'error');
            }
        );
    },

    /**
     * Append a user message to the chat display
     */
    appendUserMessage(msg) {
        const inner = this.messagesEl.querySelector('.chat-messages-inner') || (() => {
            const div = document.createElement('div');
            div.className = 'chat-messages-inner';
            this.messagesEl.appendChild(div);
            return div;
        })();

        const msgEl = this.createMessageElement(msg, this.messages.length - 1);
        inner.appendChild(msgEl);
        this.scrollToBottom();
    },

    /**
     * Handle keyboard events in the input
     */
    handleInputKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage();
        }
    },

    /**
     * Auto-resize the textarea
     */
    autoResizeInput() {
        const el = this.inputEl;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    },

    /**
     * Handle file selection
     */
    async handleFileSelect(e) {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        // Show loading
        const overlay = document.getElementById('loading-overlay');
        overlay.style.display = 'flex';

        for (const file of files) {
            try {
                const result = await API.uploadFile(file);
                this.attachments.push(result);
                this.renderAttachmentPreviews();
            } catch (err) {
                Utils.toast(`上传 ${file.name} 失败: ${err.message}`, 'error');
            }
        }

        overlay.style.display = 'none';
        this.fileInputEl.value = ''; // Reset so same file can be re-uploaded
    },

    /**
     * Render attachment previews below the input
     */
    renderAttachmentPreviews() {
        if (!this.attachmentsEl) return;

        this.attachmentsEl.innerHTML = this.attachments.map((att, i) => `
            <div class="attachment-preview">
                ${att.data_url && att.type && att.type.startsWith('image/')
                    ? `<img src="${att.data_url}" alt="${Utils.escapeHtml(att.name)}">`
                    : `<span>${Utils.getFileIcon(att.type || '')}</span>`}
                <span class="attachment-preview-name" title="${Utils.escapeHtml(att.name)}">${Utils.escapeHtml(att.name)}</span>
                <button class="attachment-preview-remove" data-index="${i}" title="移除">×</button>
            </div>
        `).join('');

        // Bind remove buttons
        this.attachmentsEl.querySelectorAll('.attachment-preview-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.attachments.splice(index, 1);
                this.renderAttachmentPreviews();
            });
        });
    },

    /**
     * Clear all attachments
     */
    clearAttachments() {
        this.attachments = [];
        if (this.attachmentsEl) this.attachmentsEl.innerHTML = '';
    },

    /**
     * Set chat mode (quick/deep)
     */
    setMode(mode) {
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        if (App.currentConvId) {
            API.updateSettings(App.currentConvId, null, mode).catch(() => {});
        }
    },

    /**
     * Update send button state
     */
    updateSendButton() {
        this.sendBtn.disabled = this.isStreaming;
        if (this.isStreaming) {
            this.sendBtn.style.opacity = '0.5';
        } else {
            this.sendBtn.style.opacity = '1';
        }
    },

    /**
     * Show empty state
     */
    showEmptyState() {
        if (this.emptyStateEl) this.emptyStateEl.style.display = '';
        if (this.messagesEl) this.messagesEl.style.display = 'none';
    },

    /**
     * Hide empty state
     */
    hideEmptyState() {
        if (this.emptyStateEl) this.emptyStateEl.style.display = 'none';
        if (this.messagesEl) this.messagesEl.style.display = '';
    },

    /**
     * Scroll to the bottom of messages
     */
    scrollToBottom() {
        if (this.messagesEl) {
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
        }
    },

    /**
     * Clear the chat view
     */
    clear() {
        this.messages = [];
        this.attachments = [];
        this.isStreaming = false;
        this.currentStreamingEl = null;
        this.renderAttachmentsPreview = '';
        if (this.messagesEl) this.messagesEl.innerHTML = '';
        if (this.attachmentsEl) this.attachmentsEl.innerHTML = '';
        this.showEmptyState();
        this.updateSendButton();
    },
};
