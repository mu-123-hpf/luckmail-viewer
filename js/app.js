// ===== LuckMail Viewer - Core App =====
// API proxy to avoid CORS issues
const API_BASE = 'https://luckmail-api.luckymail.workers.dev';
const STORAGE_KEY = 'luckmail_tokens';

// ===== State =====
let state = {
    tokens: [],          // [{token, label, address, alive}]
    activeToken: null,
    mails: [],
    latestCode: null,
    autoRefreshTimer: null,
};

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    loadTokens();
    renderSidebar();
    initTheme();
    document.getElementById('addTokenBtn').addEventListener('click', showAddModal);
    document.getElementById('autoRefreshToggle').addEventListener('change', toggleAutoRefresh);
    document.getElementById('tokenInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') confirmAddToken();
    });
});

// ===== Token Storage =====
function loadTokens() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        state.tokens = data ? JSON.parse(data) : [];
    } catch { state.tokens = []; }
}

function saveTokens() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tokens));
}

// ===== Sidebar Rendering =====
function renderSidebar() {
    const list = document.getElementById('emailList');
    const empty = document.getElementById('sidebarEmpty');
    const count = document.getElementById('emailCount');

    count.textContent = state.tokens.length;

    if (state.tokens.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        showWelcome();
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = state.tokens.map((t, i) => `
        <div class="email-item ${state.activeToken === t.token ? 'active' : ''}" 
             onclick="selectEmail(${i})" id="email-item-${i}">
            <div class="email-item-dot ${t.alive === false ? 'offline' : ''}"></div>
            <div class="email-item-info">
                <div class="email-item-label">${escHtml(t.label || '邮箱 ' + (i + 1))}</div>
                <div class="email-item-addr">${escHtml(t.address || t.token.slice(0, 12) + '...')}</div>
            </div>
            <button class="email-item-delete" onclick="event.stopPropagation(); removeToken(${i})" title="移除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </button>
        </div>
    `).join('');
}

// ===== Add Token =====
function showAddModal() {
    document.getElementById('addModal').classList.remove('hidden');
    document.getElementById('tokenInput').value = '';
    document.getElementById('labelInput').value = '';
    setTimeout(() => document.getElementById('tokenInput').focus(), 100);
}

function closeAddModal() {
    document.getElementById('addModal').classList.add('hidden');
}

async function confirmAddToken() {
    const token = document.getElementById('tokenInput').value.trim();
    const label = document.getElementById('labelInput').value.trim();

    if (!token) {
        showToast('请输入 Token', 'error');
        return;
    }

    if (state.tokens.some(t => t.token === token)) {
        showToast('该 Token 已存在', 'error');
        return;
    }

    const btn = document.getElementById('confirmAddBtn');
    btn.disabled = true;
    btn.textContent = '验证中...';

    try {
        const info = await checkAlive(token);
        const entry = {
            token,
            label: label || '',
            address: info.email_address || '',
            alive: info.alive,
            project: info.project || '',
            mailCount: info.mail_count || 0,
        };
        state.tokens.push(entry);
        saveTokens();
        closeAddModal();
        renderSidebar();
        selectEmail(state.tokens.length - 1);
        showToast(`已添加: ${entry.address || 'OK'}`, 'success');
    } catch (err) {
        showToast('Token 验证失败: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '添加';
    }
}

function removeToken(index) {
    const t = state.tokens[index];
    if (!confirm(`确定移除「${t.label || t.address || 'Token'}」？`)) return;
    state.tokens.splice(index, 1);
    saveTokens();
    if (state.activeToken === t.token) {
        state.activeToken = null;
        stopAutoRefresh();
        showWelcome();
    }
    renderSidebar();
}

// ===== Select Email =====
async function selectEmail(index) {
    const entry = state.tokens[index];
    state.activeToken = entry.token;
    renderSidebar();
    await loadInbox(entry);
}

// ===== API Calls =====
async function checkAlive(token) {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(token)}/alive`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message || '请求失败');
    return json.data;
}

async function fetchCode(token) {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(token)}/code`);
    const json = await res.json();
    if (json.code !== 0) return null;
    return json.data;
}

async function fetchMails(token) {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(token)}/mails`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message || '获取邮件列表失败');
    return json.data;
}

async function fetchMailDetail(token, messageId) {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(token)}/mails/${encodeURIComponent(messageId)}`);
    const json = await res.json();
    if (json.code !== 0) throw new Error(json.message || '获取邮件详情失败');
    return json.data;
}

// ===== Load Inbox =====
async function loadInbox(entry) {
    showLoading();
    try {
        // Parallel: get alive info + code + mails
        const [aliveInfo, codeData, mailsData] = await Promise.all([
            checkAlive(entry.token).catch(() => null),
            fetchCode(entry.token).catch(() => null),
            fetchMails(entry.token),
        ]);

        // Update entry info
        if (aliveInfo) {
            entry.address = aliveInfo.email_address || entry.address;
            entry.alive = aliveInfo.alive;
            entry.project = aliveInfo.project || '';
            entry.mailCount = aliveInfo.mail_count || 0;
            saveTokens();
            renderSidebar();
        }

        state.mails = mailsData.mails || [];
        state.latestCode = codeData;

        showInbox(entry);
    } catch (err) {
        showError(err.message);
    }
}

// ===== Render Inbox =====
function showInbox(entry) {
    hideAll();
    document.getElementById('inboxView').classList.remove('hidden');

    // Email info bar
    document.getElementById('currentEmailAddress').textContent = entry.address || '未知';
    document.getElementById('emailStatus').textContent = entry.alive ? '在线' : '离线';
    document.getElementById('emailStatus').style.color = entry.alive ? 'var(--success)' : 'var(--danger)';
    document.getElementById('mailCount').textContent = `${state.mails.length} 封邮件`;
    document.getElementById('projectName').textContent = entry.project || '—';

    // Verification code
    renderCode();

    // Mail list
    renderMailList();
}

function renderCode() {
    const display = document.getElementById('codeDisplay');
    const meta = document.getElementById('codeMeta');

    if (state.latestCode && state.latestCode.code) {
        const code = state.latestCode.code;
        display.innerHTML = `<span class="code-value code-flash" onclick="copyCode('${escHtml(code)}')" title="点击复制">${escHtml(code)}</span>
            <button class="btn-copy" onclick="copyCode('${escHtml(code)}')" title="复制验证码">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            </button>`;
        const from = state.latestCode.from || '';
        const subject = state.latestCode.subject || '';
        meta.textContent = from ? `来自: ${from}  |  ${subject}` : subject;
    } else {
        display.innerHTML = '<span class="code-placeholder">暂无验证码 — 等待 OpenAI 发送...</span>';
        meta.textContent = '';
    }
}

function renderMailList() {
    const list = document.getElementById('mailList');
    const empty = document.getElementById('mailEmpty');

    if (!state.mails || state.mails.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = state.mails.map((mail, i) => {
        const hasCode = mail.code && mail.code.trim();
        const time = formatTime(mail.received_at);
        const fromDisplay = (mail.from || '').replace(/<.*>/, '').trim() || mail.from || '未知发件人';
        return `
        <div class="mail-item" onclick="openMail(${i})">
            <div class="mail-item-icon ${hasCode ? 'has-code' : ''}">
                ${hasCode ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                </svg>`}
            </div>
            <div class="mail-item-body">
                <div class="mail-item-subject">${escHtml(mail.subject || '(无主题)')}</div>
                <div class="mail-item-from">${escHtml(fromDisplay)}</div>
            </div>
            <div class="mail-item-right">
                <span class="mail-item-time">${time}</span>
                ${hasCode ? `<span class="mail-item-code">${escHtml(mail.code)}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ===== Open Mail Detail =====
async function openMail(index) {
    const mail = state.mails[index];
    if (!mail) return;

    hideAll();
    const detail = document.getElementById('mailDetail');
    detail.classList.remove('hidden');

    document.getElementById('detailSubject').textContent = mail.subject || '(无主题)';
    document.getElementById('detailFrom').textContent = '来自: ' + (mail.from || '未知');
    document.getElementById('detailDate').textContent = formatTime(mail.received_at);

    // Code section
    const codeSection = document.getElementById('detailCodeSection');
    if (mail.code && mail.code.trim()) {
        codeSection.classList.remove('hidden');
        document.getElementById('detailCode').textContent = mail.code;
    } else {
        codeSection.classList.add('hidden');
    }

    // Body - try to load detail if we have message_id
    const body = document.getElementById('detailBody');
    if (mail.html_body && mail.html_body.length > 20) {
        renderHtmlBody(body, mail.html_body);
    } else if (mail.body) {
        body.textContent = mail.body;
    } else if (mail.message_id && state.activeToken) {
        body.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>加载邮件内容...</p></div>';
        try {
            const detail = await fetchMailDetail(state.activeToken, mail.message_id);
            if (detail.html_body && detail.html_body.length > 20) {
                renderHtmlBody(body, detail.html_body);
            } else {
                body.textContent = detail.body || '(无内容)';
            }
        } catch {
            body.textContent = mail.body || '(无法加载详情)';
        }
    } else {
        body.textContent = '(无内容)';
    }
}

function renderHtmlBody(container, html) {
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin';
    container.innerHTML = '';
    container.appendChild(iframe);
    iframe.srcdoc = html;
    iframe.onload = () => {
        try {
            const h = iframe.contentDocument.body.scrollHeight;
            iframe.style.height = Math.min(h + 30, 800) + 'px';
        } catch {}
    };
}

function closeMailDetail() {
    document.getElementById('mailDetail').classList.add('hidden');
    document.getElementById('inboxView').classList.remove('hidden');
}

// ===== Refresh =====
async function refreshInbox() {
    if (!state.activeToken) return;
    const entry = state.tokens.find(t => t.token === state.activeToken);
    if (!entry) return;

    try {
        const [codeData, mailsData] = await Promise.all([
            fetchCode(entry.token).catch(() => null),
            fetchMails(entry.token),
        ]);

        const oldCode = state.latestCode?.code;
        state.latestCode = codeData;
        state.mails = mailsData.mails || [];

        renderCode();
        renderMailList();

        // Flash if new code arrived
        if (codeData?.code && codeData.code !== oldCode) {
            showToast(`新验证码: ${codeData.code}`, 'success');
        }
    } catch (err) {
        showToast('刷新失败: ' + err.message, 'error');
    }
}

function retryLoad() {
    if (!state.activeToken) return;
    const entry = state.tokens.find(t => t.token === state.activeToken);
    if (entry) loadInbox(entry);
}

// ===== Auto Refresh =====
function toggleAutoRefresh() {
    const on = document.getElementById('autoRefreshToggle').checked;
    if (on) {
        refreshInbox();
        state.autoRefreshTimer = setInterval(refreshInbox, 30000);
    } else {
        stopAutoRefresh();
    }
}

function stopAutoRefresh() {
    if (state.autoRefreshTimer) {
        clearInterval(state.autoRefreshTimer);
        state.autoRefreshTimer = null;
    }
    const toggle = document.getElementById('autoRefreshToggle');
    if (toggle) toggle.checked = false;
}

// ===== View State Helpers =====
function hideAll() {
    ['welcomeState', 'loadingState', 'errorState', 'inboxView', 'mailDetail'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
}

function showWelcome() {
    hideAll();
    document.getElementById('welcomeState').classList.remove('hidden');
}

function showLoading() {
    hideAll();
    document.getElementById('loadingState').classList.remove('hidden');
}

function showError(msg) {
    hideAll();
    document.getElementById('errorState').classList.remove('hidden');
    document.getElementById('errorMessage').textContent = msg || '请检查 Token 是否正确';
}

// ===== Copy Helpers =====
function copyCode(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast('验证码已复制: ' + code, 'success');
    }).catch(() => {
        fallbackCopy(code);
        showToast('验证码已复制', 'success');
    });
}

function copyEmail() {
    const addr = document.getElementById('currentEmailAddress').textContent;
    if (addr && addr !== '—') {
        navigator.clipboard.writeText(addr).then(() => {
            showToast('邮箱地址已复制', 'success');
        }).catch(() => fallbackCopy(addr));
    }
}

function copyDetailCode() {
    const code = document.getElementById('detailCode').textContent;
    if (code && code !== '—') copyCode(code);
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

// ===== Toast =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        toast.style.transition = '0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== Theme =====
function initTheme() {
    const saved = localStorage.getItem('luckmail_theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('themeToggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('luckmail_theme', next);
    });
}

// ===== Mobile Sidebar =====
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ===== Utilities =====
function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        const now = new Date();
        const diff = now - d;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
        if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
        return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return dateStr;
    }
}
