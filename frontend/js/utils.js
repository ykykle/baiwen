/**
 * Utility functions
 */
const Utils = {
    /**
     * Generate a short unique ID
     */
    uid() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    },

    /**
     * Format a date string for display
     */
    formatDate(isoString) {
        const d = new Date(isoString);
        const now = new Date();
        const diff = now - d;
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (mins < 1) return '刚刚';
        if (mins < 60) return `${mins} 分钟前`;
        if (hours < 24) return `${hours} 小时前`;
        if (days < 7) return `${days} 天前`;
        return d.toLocaleDateString('zh-CN');
    },

    /**
     * Escape HTML entities
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Render markdown to HTML using marked.js
     */
    renderMarkdown(text) {
        if (typeof marked === 'undefined') return this.escapeHtml(text);

        try {
            // marked.js v5+ removed getDefaults(); use options directly in parse()
            const html = marked.parse(text, {
                breaks: true,
                gfm: true,
            });

            // Add target="_blank" to links
            return html.replace(/<a /g, '<a target="_blank" rel="noopener" ');
        } catch (e) {
            return this.escapeHtml(text);
        }
    },

    /**
     * Highlight code blocks in an HTML element
     */
    highlightCode(element) {
        if (typeof hljs === 'undefined') return;
        element.querySelectorAll('pre code').forEach((block) => {
            // Remove existing highlighting
            block.classList.remove('hljs');
            // Add language class if present
            const langClass = Array.from(block.classList).find(c => c.startsWith('language-'));
            if (langClass) {
                block.classList.add(langClass.replace('language-', ''));
            }
            hljs.highlightElement(block);
        });
    },

    /**
     * Show a toast notification
     */
    toast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.toast('已复制到剪贴板', 'success');
            return true;
        } catch {
            this.toast('复制失败', 'error');
            return false;
        }
    },

    /**
     * Debounce a function
     */
    debounce(fn, delay = 300) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    /**
     * Get file icon based on MIME type
     */
    getFileIcon(mimeType) {
        if (mimeType.startsWith('image/')) return '🖼️';
        if (mimeType.includes('pdf')) return '📄';
        if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('python')) return '📝';
        return '📎';
    },
};
