/**
 * API Module - Backend communication layer
 */
const API = {
    base: '/api',

    async request(path, options = {}) {
        const url = `${this.base}${path}`;
        const config = {
            headers: { 'Content-Type': 'application/json', ...options.headers },
            ...options,
        };
        if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
            config.body = JSON.stringify(config.body);
        }
        const res = await fetch(url, config);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || err.detail || `HTTP ${res.status}`);
        }
        return res;
    },

    async get(path) {
        const res = await this.request(path);
        return res.json();
    },

    async post(path, body) {
        const res = await this.request(path, { method: 'POST', body });
        return res.json();
    },

    async patch(path, body) {
        const res = await this.request(path, { method: 'PATCH', body });
        return res.json();
    },

    async put(path, body) {
        const res = await this.request(path, { method: 'PUT', body });
        return res.json();
    },

    async del(path) {
        const res = await this.request(path, { method: 'DELETE' });
        return res.json();
    },

    // --- Health ---
    async health() {
        return this.get('/health');
    },

    // --- Models ---
    async getModels() {
        return this.get('/models');
    },

    // --- Conversations ---
    async listConversations() {
        return this.get('/conversations');
    },

    async createConversation() {
        return this.post('/conversations');
    },

    async getConversation(id) {
        return this.get(`/conversations/${id}`);
    },

    async deleteConversation(id) {
        return this.del(`/conversations/${id}`);
    },

    async renameConversation(id, title) {
        return this.patch(`/conversations/${id}`, { title });
    },

    async updateSettings(id, model, mode) {
        const formData = new FormData();
        if (model) formData.append('model', model);
        if (mode) formData.append('mode', mode);
        const res = await fetch(`${this.base}/conversations/${id}/settings`, {
            method: 'PUT',
            body: formData,
        });
        if (!res.ok) throw new Error('Failed to update settings');
        return res.json();
    },

    // --- Upload ---
    async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${this.base}/upload`, {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) throw new Error('Upload failed');
        return res.json();
    },

    // --- Chat (Streaming) ---
    async chatStream(convId, message, model, mode, attachments, onText, onThinking, onDone, onError) {
        try {
            const res = await fetch(`${this.base}/chat/${convId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, model, mode, attachments }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Request failed' }));
                onError(err.error || 'Request failed');
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            switch (data.type) {
                                case 'text':
                                    onText(data.text);
                                    break;
                                case 'thinking':
                                    onThinking && onThinking(data.text);
                                    break;
                                case 'thinking_start':
                                    onThinking && onThinking('[思考开始]');
                                    break;
                                case 'thinking_end':
                                    onThinking && onThinking('[思考结束]');
                                    break;
                                case 'error':
                                    onError(data.text);
                                    break;
                                case 'done':
                                    onDone(data.message_id);
                                    break;
                            }
                        } catch (e) {
                            // Skip malformed data
                        }
                    }
                }
            }
        } catch (err) {
            onError(err.message || 'Network error');
        }
    },
};
