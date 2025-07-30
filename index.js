import {
    extension_settings,
} from '../../../extensions.js';
import {
    saveSettingsDebounced,
    getRequestHeaders,
} from '../../../../script.js';
import {
    callGenericPopup,
    POPUP_TYPE
} from '../../../popup.js';


// --- 插件元数据 ---
const PLUGIN_ID = 'modern-screenshot';
const PLUGIN_NAME = 'modern-screenshot';
const SCRIPT_VERSION = '2.0.7';

// 日志系统
const captureLogger = {
    log: (message, level = 'info', data = null) => {
        const timer = new Date().toISOString();
        const supportedLevels = ['log', 'info', 'warn', 'error'];
        const consoleFunc = supportedLevels.includes(level) ? console[level] : console.log;
        consoleFunc(`[${timer.split('T')[1].slice(0,12)}][${PLUGIN_NAME}] ${message}`, data || '');
    },
    info: (message, data) => { captureLogger.log(message, 'info', data); },
    warn: (message, data) => { captureLogger.log(message, 'warn', data); },
    error: (message, data) => { captureLogger.log(message, 'error', data); },
};

// 插件设置、版本管理与持久化
const STORAGE_KEY = 'modernScreenshotExtensionSettingsV2';
let settings = {};

function loadSettings() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const defaultStructure = {
            pluginSettings: { ...defaultSettings },
            lastSeenVersion: '0',
        };
        settings = stored ? { ...defaultStructure, ...JSON.parse(stored) } : { ...defaultStructure };
        if (!settings.pluginSettings) {
            settings.pluginSettings = { ...defaultSettings };
        }
    } catch (error) {
        captureLogger.error("加载设置失败，将使用默认设置。", error);
        settings = {
            pluginSettings: { ...defaultSettings },
            lastSeenVersion: '0',
        };
    }
}
function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
        captureLogger.error("保存设置失败。", error);
    }
}
function shouldShowUpdateNotice() {
    return settings.lastSeenVersion !== SCRIPT_VERSION;
}
function markUpdateNoticeSeen() {
    if (shouldShowUpdateNotice()) {
        settings.lastSeenVersion = SCRIPT_VERSION;
        saveSettings();
        $(`#${UPDATE_NOTICE_ID}`).slideUp();
    }
}

// 自动更新检查器
const updateChecker = {
    GITHUB_REPO: 'yuncengfeihou/modern-screenshot',
    REMOTE_CHANGELOG_PATH: 'CHANGELOG.md',
    REMOTE_MANIFEST_PATH: 'manifest.json',
    remoteVersion: '0.0.0',
    latestCommitHash: '',
    isUpdateAvailable: false,

    compareVersions(versionA, versionB) {
        const cleanA = versionA.split('-')[0].split('+')[0];
        const cleanB = versionB.split('-')[0].split('+')[0];
        const partsA = cleanA.split('.').map(Number);
        const partsB = cleanB.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            const numA = partsA[i] || 0;
            const numB = partsB[i] || 0;
            if (isNaN(numA) || isNaN(numB)) return 0;
            if (numA > numB) return 1;
            if (numA < numB) return -1;
        }
        return 0;
    },

    async getRemoteFileContent(filePath, commitHash) {
        const url = `https://cdn.jsdelivr.net/gh/${this.GITHUB_REPO}@${commitHash}/${filePath}`;
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`jsDelivr error! status: ${response.status}`);
            return await response.text();
        } catch (error) {
            captureLogger.error(`无法获取远程文件 ${filePath}`, error);
            throw error;
        }
    },

    parseVersionFromManifest(content) {
        try {
            const manifest = JSON.parse(content);
            return manifest?.version || '0.0.0';
        } catch (error) { return '0.0.0'; }
    },

    extractRelevantChangelog(changelogContent, currentVersion, latestVersion) {
        try {
            const startMarker = `## [${latestVersion}]`;
            let startIndex = changelogContent.indexOf(startMarker);
            if (startIndex === -1) {
                const simpleVersion = latestVersion.split(' ')[0];
                startIndex = changelogContent.indexOf(`## [${simpleVersion}]`);
            }
            if (startIndex === -1) return "无法找到最新版本的更新日志。";
            
            const endMarker = `## [${currentVersion}]`;
            let endIndex = changelogContent.indexOf(endMarker, startIndex);
            if (endIndex === -1) endIndex = changelogContent.length;
            
            return changelogContent.substring(startIndex, endIndex).trim();
        } catch (error) {
            captureLogger.error("解析更新日志失败:", error);
            return "解析更新日志失败。";
        }
    },

    async handleUpdate() {
        let updatingToast = null;
        try {
            const changelog = await this.getRemoteFileContent(this.REMOTE_CHANGELOG_PATH, this.latestCommitHash);
            const relevantLog = this.extractRelevantChangelog(changelog, SCRIPT_VERSION, this.remoteVersion);
            const logHtml = relevantLog.replace(/### (.*)/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

            await callGenericPopup(
                `<h3>发现新版本: ${this.remoteVersion}</h3><hr><div style="text-align:left; max-height: 300px; overflow-y: auto;">${logHtml}</div>`,
                POPUP_TYPE.CONFIRM,
                { okButton: '确认更新', cancelButton: '稍后' }
            );

            updatingToast = toastr.info("正在请求后端更新插件，请不要关闭或刷新页面...", "正在更新", {
                timeOut: 0, extendedTimeOut: 0, tapToDismiss: false,
            });
            
            const response = await fetch("/api/extensions/update", {
                method: "POST", headers: getRequestHeaders(),
                body: JSON.stringify({ extensionName: PLUGIN_ID, global: true })
            });

            if (!response.ok) {
                throw new Error(`更新失败，服务器返回: ${response.status}.`);
            }
            
            toastr.success(`更新成功！3秒后将自动刷新页面...`, "更新完成", { timeOut: 3000 });
            setTimeout(() => location.reload(), 3000);

        } catch (error) {
            if (error?.message?.includes("更新失败")) {
                toastr.error(error.message, '更新出错');
            } else {
                toastr.info("更新已取消。");
            }
        } finally {
            if (updatingToast) toastr.clear(updatingToast);
        }
    },

    updateUI() {
        if (this.isUpdateAvailable) {
            const button = $(`#modern-screenshot-settings-button`);
            if (button.length && button.find('.update-available-indicator').length === 0) {
                const indicator = $('<span class="update-available-indicator" title="有新版本可用！点击更新">(可更新)</span>');
                indicator.on('click', (e) => {
                    e.stopPropagation();
                    this.handleUpdate();
                });
                button.find('span').after(indicator);
            }
        }
    },
    
    async check() {
        captureLogger.info("正在检查更新...");
        try {
            const repoApiUrl = `https://api.github.com/repos/${this.GITHUB_REPO}/commits/main`;
            const commitResponse = await fetch(repoApiUrl, { cache: 'no-store' });
            if (!commitResponse.ok) throw new Error('GitHub API request failed');
            const commitData = await commitResponse.json();
            this.latestCommitHash = commitData.sha;
            
            const remoteManifest = await this.getRemoteFileContent(this.REMOTE_MANIFEST_PATH, this.latestCommitHash);
            this.remoteVersion = this.parseVersionFromManifest(remoteManifest);

            if (this.remoteVersion && SCRIPT_VERSION) {
                 this.isUpdateAvailable = this.compareVersions(this.remoteVersion, SCRIPT_VERSION) > 0;
            }
            
            if(this.isUpdateAvailable) {
                captureLogger.info(`发现新版本: ${this.remoteVersion} (当前: ${SCRIPT_VERSION})`);
            } else {
                captureLogger.info(`当前已是最新版本 (${SCRIPT_VERSION})。`);
            }

        } catch (error) {
            captureLogger.error("检查更新失败:", error);
            this.isUpdateAvailable = false;
        }
        this.updateUI();
    }
};

// 插件设置UI初始化函数
const initSettingsUI = () => {
    const BUTTON_ID = 'modern-screenshot-settings-button';
    const PANEL_ID = 'modern-screenshot-settings-panel';
    const HELP_PANEL_ID = 'modern-screenshot-help-panel';
    const UPDATE_NOTICE_ID = 'mss-update-notice';
    const OVERLAY_ID = 'modern-screenshot-settings-overlay';
    const STYLE_ID = 'modern-screenshot-styles';
    let panelElement = null;
    let helpPanelElement = null;

    const centerElement = (element) => {
        if (!element) return;
        const windowWidth = window.innerWidth || document.documentElement.clientWidth;
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        const panelWidth = element.offsetWidth;
        const panelHeight = element.offsetHeight;
        const left = Math.max(0, (windowWidth - panelWidth) / 2);
        const top = Math.max(0, (windowHeight - panelHeight) / 2);
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
    };

    const injectStyles = () => {
        if ($(`#${STYLE_ID}`).length > 0) return;
        const styles = `
        <style id="${STYLE_ID}">
            @keyframes mssFadeIn { from { opacity: 0; transform: translateY(-20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
            #${OVERLAY_ID} { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background-color: rgba(0, 0, 0, 0.5); backdrop-filter: blur(5px); z-index: 9998; display: none; }
            #${PANEL_ID}, #${HELP_PANEL_ID} { position: fixed; display: flex; flex-direction: column; width: 90%; max-width: 600px; max-height: 85vh; background: var(--SmartThemeBlurTintColor, #2a2a2a); color: var(--SmartThemeBodyColor, #e0e0e0); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 12px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3), 0 8px 16px rgba(0, 0, 0, 0.2); animation: mssFadeIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); overflow: hidden; z-index: 9999; }
            .mss-panel-header { padding: 10px 20px; border-bottom: 1px solid var(--SmartThemeBorderColor, #444); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
            .mss-panel-header h4 { margin: 0; font-size: 16px; font-weight: 600; }
            .mss-panel-header #mss-show-help-btn { cursor: pointer; transition: color 0.2s; }
            .mss-panel-header #mss-show-help-btn:hover { color: var(--SmartThemeQuoteColor, #8cdeff); }
            .mss-panel-close-btn { background: transparent; border: none; color: var(--SmartThemeBodyColor, #aaa); font-size: 24px; cursor: pointer; padding: 8px; line-height: 1; transition: all 0.2s ease; border-radius: 50%; }
            .mss-panel-close-btn:hover { color: var(--SmartThemeBodyColor, #fff); background: rgba(255, 255, 255, 0.1); }
            .mss-panel-content { overflow-y: auto; padding: 24px; font-family: inherit; font-size: 14px; display: flex; flex-direction: column; flex-grow: 1;min-height: 0; }
            .update-available-indicator { color: red; font-weight: bold; margin-left: 8px; cursor: pointer; }
            .update-available-indicator:hover { text-decoration: underline; }
            #${UPDATE_NOTICE_ID} { margin-bottom: 20px; padding: 15px; border: 1px solid var(--SmartThemeQuoteColor, #8cdeff); background: rgba(74, 158, 255, 0.1); border-radius: 8px; line-height: 1.6; }
            #${UPDATE_NOTICE_ID} h5 { margin-top: 0; color: var(--SmartThemeQuoteColor, #8cdeff); }
            #${UPDATE_NOTICE_ID} p, #${UPDATE_NOTICE_ID} ul { margin: 10px 0; }
            #${UPDATE_NOTICE_ID} ul { padding-left: 20px; }
            #${UPDATE_NOTICE_ID} .update-footer { font-size: 0.85em; color: #888; margin-top: 15px; text-align: center; }
            #${HELP_PANEL_ID} { display: none; }
            .mss-help-content { padding: 0 24px 24px 24px; line-height: 1.7; }
            .mss-help-content h4 { font-size: 1.3em; margin-bottom: 15px; text-align: center; color: var(--SmartThemeQuoteColor, #8cdeff); border-bottom: 1px solid var(--SmartThemeBorderColor, #444); padding-bottom: 10px;}
            .mss-help-content h5 { color: var(--SmartThemeQuoteColor, #8cdeff); font-size: 1.1em; margin-top: 25px; margin-bottom: 15px; }
            .mss-help-content h6 { font-size: 1.05em; margin-top: 20px; margin-bottom: 10px; font-weight: bold; }
            .mss-help-content ul { list-style-type: disc; padding-left: 25px; }
            .mss-help-content li { margin-bottom: 15px; }
            .mss-help-content strong { color: #ffffff; }
            .mss-help-content code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
            .mss-help-content blockquote { border-left: 3px solid var(--SmartThemeQuoteColor, #4a9eff); margin-left: 0; padding-left: 15px; color: #ccc; font-style: italic; }
            .mss-help-content .description { margin-top: 5px; color: #ddd; padding-left: 10px; }
            .mss-help-content hr { border: none; border-top: 1px solid var(--SmartThemeBorderColor, #444); margin: 30px 0; }
            .mss-help-footer { padding: 15px 20px; border-top: 1px solid var(--SmartThemeBorderColor, #444); text-align: center; }
            .mss-help-close-btn { background: var(--SmartThemeQuoteColor, #4a9eff); color: #fff; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; }
            #${PANEL_ID} .settings_section { margin-bottom: 20px; }
            #${PANEL_ID} label { display: block; margin-bottom: 8px; font-weight: 500; font-size: 14px; }
            #${PANEL_ID} select, #${PANEL_ID} input[type="number"], #${PANEL_ID} input[type="text"] { width: 100%; background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.05)); color: var(--SmartThemeBodyColor, #ffffff); border: 2px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1)); border-radius: 10px; padding: 12px 16px; box-sizing: border-box; font-size: 14px; transition: all 0.3s ease; }
            #${PANEL_ID} input:focus, #${PANEL_ID} select:focus { outline: none; border-color: var(--SmartThemeQuoteColor, #4a9eff); background: var(--SmartThemeBlurTintColor, rgba(255, 255, 255, 0.08)); }
            #${PANEL_ID} .checkbox_item { display: flex; align-items: center; margin-bottom: 8px; }
            #${PANEL_ID} .checkbox_item input[type="checkbox"] { margin-right: 10px; width: auto; }
            #${PANEL_ID} .checkbox_item label { margin-bottom: 0; font-weight: normal; }
            #${PANEL_ID} .custom-icon-group { display: flex; align-items: center; gap: 10px; }
            #${PANEL_ID} .custom-icon-group input[type="text"] { flex-grow: 1; }
            #${PANEL_ID} .custom-icon-group a { text-decoration: none; color: var(--SmartThemeQuoteColor, #8cdeff); font-size: 1.2em; }
        </style>`;
        $('head').append(styles);
    };
    
	async function getUpdateNoticeHtml(version) {
		const repo = 'yuncengfeihou/modern-screenshot'; // 你的 GitHub 仓库
		const changelogUrl = `https://cdn.jsdelivr.net/gh/${repo}@main/CHANGELOG.md`;

		try {
			captureLogger.info(`Fetching remote changelog for version ${version} from: ${changelogUrl}`);
			
			// 1. 从网络获取最新的 CHANGELOG.md 内容
			const response = await fetch(changelogUrl, { cache: 'no-store' });
			if (!response.ok) {
				throw new Error(`Failed to load changelog from jsDelivr: ${response.statusText}`);
			}
			const changelogContent = await response.text();
			
			// 2. 精确定位当前版本 (version) 的日志内容
			const cleanVersion = String(version).replace('v', '').trim().replace(/\./g, '\\.');
			const startRegex = new RegExp(`(##\\s*\\[?v?${cleanVersion}\\]?.*)`, 'i');
			const startMatch = changelogContent.match(startRegex);

			if (!startMatch) {
				captureLogger.warn(`在远程CHANGELOG中找不到版本 ${version} 的内容。`);
				return `<h5>更新日志 (v${version})</h5><p>无法自动加载更新详情，请检查远程 CHANGELOG.md 文件格式是否正确。</p>`;
			}
			
			const startIndex = startMatch.index;

			// 3. 寻找下一个版本标题作为结束标记
			const endRegex = /\n##\s*\[?v?[\d.]+/g;
			endRegex.lastIndex = startIndex + startMatch[0].length; // 从当前标题之后开始搜索
			const nextMatch = endRegex.exec(changelogContent);
			
			let endIndex = nextMatch ? nextMatch.index : changelogContent.length;
			
			let relevantLog = changelogContent.substring(startIndex, endIndex).trim();

			// 4. 将简单的 Markdown 格式转换为 HTML
			relevantLog = relevantLog
				.replace(/## \[(.*?)\]/g, '<h5>更新日志 (v$1)</h5>')
				.replace(/## (v?[\d.]+)/g, '<h5>更新日志 ($1)</h5>')
				.replace(/### (.*?)(?:\n|<br>)/g, '<strong>$1</strong><br>')
				.replace(/\n\s*\*/g, '\n<li>')
				.replace(/\n/g, '<br>')
				.replace(/<li>/g, '<ul><li>')
				.replace(/(<\/li><br><ul><li>)+/g, '</li><li>')
				.replace(/<\/li><br>$/g, '</li>');

			// 确保列表被正确闭合
			if (relevantLog.includes('<li>') && !relevantLog.endsWith('</ul>')) {
				 relevantLog += '</ul>';
			}

			return `
				${relevantLog}
				<br>
				<p><b>点击面板右上角的关闭按钮即可隐藏此通知。</b></p>
				<p class="update-footer">此日志仅在版本更新后首次打开时显示。</p>
			`;

		} catch (error) {
			captureLogger.error("从网络加载CHANGELOG.md失败:", error);
			return `<h5>更新日志 (v${version})</h5><p>加载更新日志时发生网络错误，请检查网络连接或稍后重试。</p>`;
		}
	}

	const createAndInjectUI = () => {
        if ($(`#${BUTTON_ID}`).length === 0 && $(`#extensionsMenu`).length > 0) {
            const settingsButton = $('<div/>', {
                id: BUTTON_ID, class: 'list-group-item flex-container flexGap5 interactable',
                html: '<i class="fa-solid fa-camera"></i><span>截图设置</span>'
            });
            $('#extensionsMenu').append(settingsButton);
        }

        if ($(`#${OVERLAY_ID}`).length === 0) {
            const helpContentHtml = `
                <h4>酒馆截图插件 v2.0.7 使用说明</h4>
                
                <h5>✨ 主要更新内容</h5>
                <h6>核心优化与修复</h6>
                <ul>
                    <li><strong>背景与美化修复</strong>：优化了对聊天背景图片、小剧场等美化元素的兼容性，截图效果更佳。</li>
                    <li><strong>性能与稳定性</strong>：提升了截图速度和稳定性，整体体验更流畅。</li>
                    <li><strong>快捷多选截图</strong>：<strong>长按</strong> 每条消息的相机图标，现在可以直接唤出菜单，快速截取上下文中的多条消息！</li>
                </ul>

                <h5>新增功能详解</h5>
                <h6>1. "截图设置" 面板</h6>
                <div class="description">现在您可以在扩展菜单中找到全新的 <strong>“截图设置”</strong> 面板，自由定制各项截图参数。</div>
                <ul>
                    <li>
                        <strong>截图缩放比例 (Scale)</strong>
                        <div class="description"><strong>作用</strong>：调整截图的清晰度。值越高，图片越大越清晰，但文件体积也越大，生成速度会变慢。</div>
                        <div class="description"><strong>推荐值</strong>：设置为 <code>1.5</code> ~ <code>2.0</code> 之间即可获得高清画质，是性能和质量的最佳平衡点。</div>
                    </li>
                    <li>
                        <strong>图片格式 (Format)</strong>
                        <ul>
                            <li><strong>WebP</strong>：推荐。在同等画质下文件体积最小（比 JPEG 小30%-50%），兼容性好。生成速度比 JPEG 稍慢（约1秒）。</li>
                            <li><strong>JPEG</strong>：速度最快，兼容性好，适合生成超长截图。</li>
                            <li><strong>PNG</strong>：无损画质，但文件体积巨大，清晰度与另外两个格式相比肉眼看不出区别，性价比极低。</li>
                        </ul>
                        <blockquote><strong>特别说明</strong>：当截图过长，超过 WebP 格式的高度限制时，插件会自动将本次截图回退到 JPEG 格式以确保成功生成。</blockquote>
                    </li>
                    <li>
                        <strong>图片质量 (Quality)</strong>
                        <div class="description"><strong>作用</strong>：仅对 <code>WebP</code> 和 <code>JPEG</code> 格式有效。数值越高，画质越好，但对文件大小和速度的影响远小于“缩放比例”。</div>
                        <div class="description"><strong>用途</strong>：可作为微调参数，通常保持默认值 <code>0.92</code> 即可。</div>
                    </li>
                    <li>
                        <strong>不截取背景图片 (No Background)</strong>
                        <div class="description"><strong>作用</strong>：开启后，截图背景将变为透明（PNG/WebP）或纯色（JPEG），而不是聊天窗口的背景图。</div>
                        <div class="description"><strong>推荐场景</strong>：当您使用的主题没有背景图，或者背景图被消息气泡完全遮挡时（例如某些纯色主题），开启此项可以显著提升截图速度并减小文件体积。</div>
                    </li>
                    <li>
                        <strong>自定义图标 (Custom Icon)</strong>
                        <div class="description"><strong>作用</strong>：允许您用自己喜欢的图片替换默认的相机图标。</div>
                        <div class="description"><strong>使用方法</strong>：点击输入框右侧的 <i class="fa-solid fa-arrow-up-from-bracket"></i> 箭头会跳转到 <code>catbox.moe</code> 图床。上传您的图标后，将生成的图片直链粘贴到输入框中并勾选“启用”即可。</div>
                    </li>
                </ul>

                <h5>其他改进与说明</h5>
                <ul>
                    <li><strong>内置使用说明</strong>：想要随时回顾这些功能介绍？直接点击设置面板左上角的“<strong>使用说明</strong>”标题即可查看详细指南。</li>
                    <li><strong>自动更新提醒</strong>：插件现在会自动检查更新。当有新版本时，扩展菜单中的“截图设置”右侧会出现红色的“**(可更新)**”提示，点击它即可一键更新！</li>
                    <li><strong>更新过程</strong>：点击更新后，请耐心等待后端处理。如果更新失败，可以尝试在扩展列表中删除本插件后重新安装。</li>
                    <li><strong>问题反馈</strong>：有任何问题或建议，欢迎在旅程搜索“<strong>酒馆消息精准截图</strong>”关键词，进入帖子进行反馈！</li>
                </ul>
                <hr>
                <p style="text-align:right; font-style:italic;">发布于 2025年7月30日</p>
            `;
            const uiHtml = `
                <div id="${OVERLAY_ID}">
                    <div id="${PANEL_ID}">
                        <div class="mss-panel-header">
                            <h4 id="mss-show-help-btn" title="点击查看使用说明">使用说明（点击该标题查看使用说明）</h4>
                            <button class="mss-panel-close-btn" title="Close">×</button>
                        </div>
                        <div class="mss-panel-content">
                            <div id="${UPDATE_NOTICE_ID}" style="display: none;"></div>
                        </div>
                    </div>
                    <div id="${HELP_PANEL_ID}">
                        <div class="mss-panel-header">
                            <h4>插件使用说明</h4>
                            <button class="mss-panel-close-btn" title="Close">×</button>
                        </div>
                        <div class="mss-panel-content mss-help-content">${helpContentHtml}</div>
                        <div class="mss-help-footer"><button class="mss-help-close-btn">返回设置</button></div>
                    </div>
                </div>`;
             $('body').append(uiHtml);
             
             const settingsContent = `
                <div class="settings_section">
                    <label for="st-mod-ss-scale">截图缩放比例</label>
                    <input type="number" id="st-mod-ss-scale" class="text_pole" step="0.1" min="0.5" max="5">
                </div>
                <div class="settings_section">
                    <label for="st-mod-ss-format">图片格式</label>
                    <select id="st-mod-ss-format" class="text_pole"><option value="webp">WebP</option><option value="jpeg">JPEG</option><option value="png">PNG</option></select>
                </div>
                <div class="settings_section">
                    <label for="st-mod-ss-quality">图片质量 (JPEG/WebP)</label>
                    <input type="number" id="st-mod-ss-quality" class="text_pole" step="0.01" min="0.1" max="1">
                </div>
                <div class="settings_section">
                    <label>功能开关</label>
                    <div class="checkbox_item"><input type="checkbox" id="st-mod-ss-no-background"><label for="st-mod-ss-no-background">不截取背景图片 (背景将透明)</label></div>
                </div>
                <div class="settings_section">
                    <label>自定义图标</label>
                    <div class="checkbox_item" style="margin-bottom: 10px;"><input type="checkbox" id="st-mod-ss-custom-icon-enable"><label for="st-mod-ss-custom-icon-enable">启用自定义图标</label></div>
                    <div class="custom-icon-group"><input type="text" id="st-mod-ss-custom-icon-url" class="text_pole" placeholder="输入图片网址..."><a href="https://catbox.moe/" target="_blank" title="上传图片到Catbox"><i class="fa-solid fa-arrow-up-from-bracket"></i></a></div>
                </div>`;
            $(`#${PANEL_ID} .mss-panel-content`).append(settingsContent);
            panelElement = $(`#${PANEL_ID}`)[0];
            helpPanelElement = $(`#${HELP_PANEL_ID}`)[0];
        }
    };

    const populateSettingsUI = () => {
        const currentSettings = getPluginSettings();
        $('#st-mod-ss-scale').val(currentSettings.screenshotScale);
        $('#st-mod-ss-format').val(currentSettings.imageFormat);
        $('#st-mod-ss-quality').val(currentSettings.imageQuality).prop('disabled', !['jpeg', 'webp'].includes(currentSettings.imageFormat));
        $('#st-mod-ss-no-background').prop('checked', currentSettings.noBackground);
        $('#st-mod-ss-custom-icon-enable').prop('checked', currentSettings.useCustomIcon);
        $('#st-mod-ss-custom-icon-url').val(currentSettings.customIconUrl).prop('disabled', !currentSettings.useCustomIcon);
    };

	const bindEvents = () => {
		const $body = $('body');
		
		// --- 定义核心操作函数，便于复用和理解 ---

		// 1. 打开主设置面板的函数
		const openMainPanel = () => {
			populateSettingsUI();

			if (shouldShowUpdateNotice()) {
				$(`#${UPDATE_NOTICE_ID}`).html(getUpdateNoticeHtml(SCRIPT_VERSION)).show();
			} else {
				$(`#${UPDATE_NOTICE_ID}`).hide();
			}

			// 确保总是从主面板开始显示
			$(`#${HELP_PANEL_ID}`).hide();
			$(`#${PANEL_ID}`).show();
			$(`#${OVERLAY_ID}`).fadeIn(200);

			centerElement(panelElement);
			$(window).on('resize.mss.main', () => centerElement(panelElement));
		};

		// 2. 完全关闭所有面板（包括遮罩层）的函数
		const closeAllPanels = () => {
			$(`#${OVERLAY_ID}`).fadeOut(200);
			$(window).off('resize.mss.main resize.mss.help'); // 移除所有命名空间的resize事件
			markUpdateNoticeSeen();
		};

		// 3. 从帮助面板返回主设置面板的函数
		const backToMainPanel = () => {
			$(`#${HELP_PANEL_ID}`).hide();
			$(`#${PANEL_ID}`).show();
			
			// 切换resize事件的监听目标
			$(window).off('resize.mss.help').on('resize.mss.main', () => centerElement(panelElement));
			centerElement(panelElement); // 重新居中
		};
		
		// 4. 打开帮助面板的函数
		const openHelpPanel = () => {
			$(`#${PANEL_ID}`).hide();
			$(`#${HELP_PANEL_ID}`).show();

			// 切换resize事件的监听目标
			$(window).off('resize.mss.main').on('resize.mss.help', () => centerElement(helpPanelElement));
			centerElement(helpPanelElement); // 重新居中
		};


		// --- 绑定事件 ---

		// 点击扩展菜单中的 "截图设置" 按钮
		$('#extensionsMenu').on('click', `#${BUTTON_ID}`, (event) => {
			if ($(event.target).hasClass('update-available-indicator')) return;
			event.stopPropagation();
			openMainPanel();
		});

		// 点击遮罩层背景关闭所有面板
		$body.on('click', `#${OVERLAY_ID}`, (e) => {
			if (e.target.id === OVERLAY_ID) {
				closeAllPanels();
			}
		});

		// 点击主设置面板的关闭按钮(X)
		$body.on('click', `#${PANEL_ID} .mss-panel-close-btn`, () => {
			closeAllPanels();
		});

		// 点击 "使用说明" 标题，打开帮助面板
		$body.on('click', `#mss-show-help-btn`, () => {
			openHelpPanel();
		});

		// 点击帮助面板的关闭按钮(X) -> 只返回主面板
		$body.on('click', `#${HELP_PANEL_ID} .mss-panel-close-btn`, () => {
			backToMainPanel();
		});
		
		// 点击帮助面板下方的 "返回设置" 按钮 -> 只返回主面板
		$body.on('click', `.mss-help-close-btn`, () => {
			backToMainPanel();
		});

		// 监听设置项变化 (这部分逻辑保持不变)
		$body.on('change input', `#${PANEL_ID} input, #${PANEL_ID} select`, function() {
			const currentSettings = getPluginSettings();
			const $target = $(this);
			const id = $target.attr('id');

			switch(id) {
				case 'st-mod-ss-scale': 
					currentSettings.screenshotScale = parseFloat($target.val()) || defaultSettings.screenshotScale; 
					invalidateScreenshotContext();
					break;
				case 'st-mod-ss-format': currentSettings.imageFormat = $target.val(); break;
				case 'st-mod-ss-quality': currentSettings.imageQuality = parseFloat($target.val()) || defaultSettings.imageQuality; break;
				case 'st-mod-ss-no-background': currentSettings.noBackground = $target.prop('checked'); break;
				case 'st-mod-ss-custom-icon-enable': currentSettings.useCustomIcon = $target.prop('checked'); break;
				case 'st-mod-ss-custom-icon-url': currentSettings.customIconUrl = $target.val(); break;
			}

			$(`#${PANEL_ID} #st-mod-ss-quality`).prop('disabled', !['jpeg', 'webp'].includes(settings.pluginSettings.imageFormat));
			$(`#${PANEL_ID} #st-mod-ss-custom-icon-url`).prop('disabled', !currentSettings.useCustomIcon);
			
			if (id.includes('custom-icon')) updateAllScreenshotIcons();
			if (id === 'st-mod-ss-no-background' || id === 'st-mod-ss-scale') invalidateUnitBackgroundCache();
			
			settings.pluginSettings = currentSettings;
			saveSettings();
		});
	};
    
    injectStyles();
    createAndInjectUI();
    bindEvents();
};


// --- 默认设置与配置 ---
const defaultSettings = {
    screenshotScale: 1.8,
    imageFormat: 'jpeg',
    imageQuality: 0.92,
    noBackground: false,
    useCustomIcon: false,
    customIconUrl: '',
};

// ... (config, OPTIMIZED_STYLE_PROPERTIES, etc.) ...
const config = {
    buttonClass: 'st-screenshot-button',
    chatContentSelector: '#chat',
    messageSelector: '.mes',
    multiCaptureMenuClass: 'st-multi-capture-menu',
    longPressDuration: 500,
};
const OPTIMIZED_STYLE_PROPERTIES = new Set(['display','position','top','right','bottom','left','float','clear','width','height','min-width','min-height','max-width','max-height','margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top','padding-right','padding-bottom','padding-left','border','border-width','border-style','border-color','border-radius','border-top-left-radius','border-top-right-radius','border-bottom-left-radius','border-bottom-right-radius','border-collapse','border-spacing','box-sizing','overflow','overflow-x','overflow-y','flex','flex-basis','flex-direction','flex-flow','flex-grow','flex-shrink','flex-wrap','align-content','align-items','align-self','justify-content','justify-items','justify-self','gap','row-gap','column-gap','grid','grid-area','grid-template','grid-template-areas','grid-template-rows','grid-template-columns','grid-row','grid-row-start','grid-row-end','grid-column','grid-column-start','grid-column-end','color','font','font-family','font-size','font-weight','font-style','font-variant','line-height','letter-spacing','word-spacing','text-align','text-decoration','text-indent','text-transform','text-shadow','white-space','vertical-align','background','background-color','background-image','background-repeat','background-position','background-size','background-clip','opacity','visibility','box-shadow','outline','outline-offset','cursor','transform','transform-origin','transform-style','transition','animation','filter','list-style','list-style-type','list-style-position','list-style-image',]);
const STYLE_WHITELIST_ARRAY = Array.from(OPTIMIZED_STYLE_PROPERTIES);

// --- [OPTIMIZATION] Performance Caches and Invalidation Logic ---
let CACHED_UNIT_BACKGROUND = null;
const FONT_DATA_MEMORY_CACHE = new Map();
const IMAGE_DATA_MEMORY_CACHE = new Map();
let ACTIVE_FONT_MAPPING = null;
let CACHED_FA_CSS = null;
// [OPTIMIZATION 1] 新增内存缓存，用于存储字体CSS文件内容
const CSS_CONTENT_MEMORY_CACHE = new Map();
// [OPTIMIZATION 2] 新增变量，用于持有可复用的截图上下文（Web Worker）
let PERSISTENT_SCREENSHOT_CONTEXT = null;

function invalidateUnitBackgroundCache() { if (CACHED_UNIT_BACKGROUND) { captureLogger.info('Cache invalidation: Unit background has been cleared.'); CACHED_UNIT_BACKGROUND = null; } }
// [OPTIMIZATION 2] 新增函数，用于销毁持久化的截图上下文
function invalidateScreenshotContext() {
    if (PERSISTENT_SCREENSHOT_CONTEXT) {
        captureLogger.info('Cache invalidation: Screenshot context (Web Worker) is being destroyed.');
        // 安全地调用销毁方法
        if (window.modernScreenshot && typeof window.modernScreenshot.destroyContext === 'function') {
            window.modernScreenshot.destroyContext(PERSISTENT_SCREENSHOT_CONTEXT);
        }
        PERSISTENT_SCREENSHOT_CONTEXT = null;
    }
}


class AssetCacheManager { constructor(dbName = 'ModernScreenshotCache', version = 1) { this.db = null; this.dbName = dbName; this.dbVersion = 2; this.stores = { fontMappings: 'fontMappings', fontData: 'fontData', imageData: 'imageData', }; } async init() { return new Promise((resolve, reject) => { if (this.db) return resolve(); const request = indexedDB.open(this.dbName, this.dbVersion); request.onupgradeneeded = (event) => { const db = event.target.result; if (!db.objectStoreNames.contains(this.stores.fontMappings)) { db.createObjectStore(this.stores.fontMappings, { keyPath: 'cssUrl' }); } if (!db.objectStoreNames.contains(this.stores.fontData)) { db.createObjectStore(this.stores.fontData, { keyPath: 'fontUrl' }); } if (!db.objectStoreNames.contains(this.stores.imageData)) { db.createObjectStore(this.stores.imageData, { keyPath: 'imageUrl' }); } }; request.onsuccess = (event) => { this.db = event.target.result; resolve(); }; request.onerror = (event) => { captureLogger.error('Failed to connect to asset cache database:', event.target.error); reject(event.target.error); }; }); } _getStore(storeName, mode = 'readonly') { const transaction = this.db.transaction(storeName, mode); return transaction.objectStore(storeName); } async getAllFontData() { return new Promise((resolve, reject) => { const store = this._getStore(this.stores.fontData); const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = (e) => reject(e.target.error); }); } async getMapping(cssUrl) { return new Promise((resolve, reject) => { const store = this._getStore(this.stores.fontMappings); const request = store.get(cssUrl); request.onsuccess = () => resolve(request.result?.mapping); request.onerror = (e) => reject(e.target.error); }); } async saveMapping(cssUrl, mapping) { return new Promise((resolve, reject) => { const store = this._getStore(this.stores.fontMappings, 'readwrite'); const request = store.put({ cssUrl, mapping }); request.onsuccess = () => resolve(); request.onerror = (e) => reject(e.target.error); }); } async getFontData(fontUrl) { return new Promise((resolve, reject) => { const store = this._getStore(this.stores.fontData); const request = store.get(fontUrl); request.onsuccess = () => resolve(request.result?.dataUrl); request.onerror = (e) => reject(e.target.error); }); } async saveFontData(fontUrl, dataUrl) { return new Promise((resolve, reject) => { const store = this._getStore(this.stores.fontData, 'readwrite'); const request = store.put({ fontUrl, dataUrl }); request.onsuccess = () => resolve(); request.onerror = (e) => reject(e.target.error); }); } async getAllImageData() { return new Promise((resolve, reject) => { const store = this._getStore(this.stores.imageData); const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = (e) => reject(e.target.error); }); } async getImageData(imageUrl) { return new Promise((resolve, reject) => { const store = this._getStore(this.stores.imageData); const request = store.get(imageUrl); request.onsuccess = () => resolve(request.result?.dataUrl); request.onerror = (e) => reject(e.target.error); }); } async saveImageData(imageUrl, dataUrl) { return new Promise((resolve, reject) => { const store = this._getStore(this.stores.imageData, 'readwrite'); const request = store.put({ imageUrl, dataUrl }); request.onsuccess = () => resolve(); request.onerror = (e) => reject(e.target.error); }); } async processFontFromStyleElement() { captureLogger.info('--- Font Processing Started ---'); const styleElement = document.querySelector('#custom-style'); if (!styleElement) { captureLogger.error('Font Diagnosis: ABORTED. Critical: Could not find the <style id="custom-style"> element. No custom fonts can be processed.'); return; } const rawCss = styleElement.textContent || ''; if (!rawCss.trim()) { captureLogger.warn('Font Diagnosis: ABORTED. The #custom-style element was found but is empty. No custom fonts to process.'); return; } captureLogger.info('Font Diagnosis: Found #custom-style. Content (first 200 chars):', rawCss.substring(0, 200)); const importMatch = /@import\s+url\((['"]?)(.*?)\1\);/g.exec(rawCss); let cssContent; let baseUrl; let styleIdentifier; if (importMatch) { styleIdentifier = importMatch[2]; baseUrl = styleIdentifier; captureLogger.info(`Font Diagnosis: Detected external font CSS via @import. URL: ${styleIdentifier}`); } else if (rawCss.includes('@font-face')) { styleIdentifier = 'inline-style:' + rawCss.trim(); baseUrl = window.location.href; cssContent = rawCss; captureLogger.info('Font Diagnosis: Detected inline @font-face rules inside #custom-style.'); } else { captureLogger.warn('Font Diagnosis: ABORTED. No @import or inline @font-face rules found within #custom-style. System will use default fonts.'); ACTIVE_FONT_MAPPING = null; return; } if (ACTIVE_FONT_MAPPING && ACTIVE_FONT_MAPPING.cssUrl === styleIdentifier) { captureLogger.info(`Font Diagnosis: Mapping for "${styleIdentifier.substring(0, 70)}..." is already active in memory. Skipping.`); return; } const dbMapping = await assetCacheManager.getMapping(styleIdentifier); if (dbMapping) { ACTIVE_FONT_MAPPING = { cssUrl: styleIdentifier, mapping: dbMapping }; captureLogger.info(`Font Diagnosis: Font mapping loaded from DB cache into memory: ${styleIdentifier.substring(0, 70)}...`); return; } if (!cssContent) { try { captureLogger.info(`Font Diagnosis: Downloading external CSS content from: ${styleIdentifier}`); cssContent = await fetch(styleIdentifier).then(res => res.text()); } catch (error) { captureLogger.error(`Font Diagnosis: FAILED to download external font CSS: ${styleIdentifier}`, error); return; } } try { captureLogger.info(`Font Diagnosis: Creating new font mapping for style: ${styleIdentifier.substring(0, 70)}...`); const fontFaceRegex = /@font-face\s*{([^}]*)}/g; const unicodeRangeRegex = /unicode-range:\s*([^;]*);/; const urlRegex = /url\((['"]?)(.*?)\1\)/; const mapping = {}; let match; let rulesFound = 0; fontFaceRegex.lastIndex = 0; while ((match = fontFaceRegex.exec(cssContent)) !== null) { rulesFound++; const fontFaceBlock = match[1]; const urlMatch = fontFaceBlock.match(urlRegex); if (urlMatch) { const fontFileUrl = new URL(urlMatch[2], baseUrl).href; const unicodeRangeMatch = fontFaceBlock.match(unicodeRangeRegex); if (unicodeRangeMatch) { const ranges = unicodeRangeMatch[1]; ranges.split(',').forEach(range => { range = range.trim().toUpperCase().substring(2); if (range.includes('-')) { const [start, end] = range.split('-').map(hex => parseInt(hex, 16)); for (let i = start; i <= end; i++) { mapping[i] = fontFileUrl; } } else { mapping[parseInt(range, 16)] = fontFileUrl; } }); } else { mapping['default'] = fontFileUrl; } } } captureLogger.info(`Font Diagnosis: Scanned CSS content. Found ${rulesFound} @font-face rules.`); if (Object.keys(mapping).length > 0) { await assetCacheManager.saveMapping(styleIdentifier, mapping); ACTIVE_FONT_MAPPING = { cssUrl: styleIdentifier, mapping: mapping }; captureLogger.info(`Font Diagnosis: SUCCESS. Font mapping created with ${Object.keys(mapping).length} entries and saved.`); } else { captureLogger.error('Font Diagnosis: FAILED. Found @font-face rules but could not parse any valid font URLs from them.'); } } catch (error) { captureLogger.error(`Font Diagnosis: FAILED during style processing: ${styleIdentifier}`, error); } } }
const assetCacheManager = new AssetCacheManager();
async function getFontDataUrlAsync(fontUrl) { if (FONT_DATA_MEMORY_CACHE.has(fontUrl)) return FONT_DATA_MEMORY_CACHE.get(fontUrl); let dataUrl = await assetCacheManager.getFontData(fontUrl); if (dataUrl) { FONT_DATA_MEMORY_CACHE.set(fontUrl, dataUrl); return dataUrl; } captureLogger.info(`Downloading and caching font: ${fontUrl}`); try { const fontBlob = await fetch(fontUrl).then(res => res.ok ? res.blob() : Promise.reject(`HTTP ${res.status}`)); dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(fontBlob); }); FONT_DATA_MEMORY_CACHE.set(fontUrl, dataUrl); await assetCacheManager.saveFontData(fontUrl, dataUrl); return dataUrl; } catch (err) { captureLogger.error(`Failed to download font: ${fontUrl}`, err); return null; } }
async function customImageFetchFn(url) { const logPrefix = '[Image Fetch]'; captureLogger.info(`${logPrefix} Request received for URL:`, { url }); if (!url || typeof url !== 'string') { captureLogger.warn(`${logPrefix} Invalid URL detected: URL is null or not a string. Skipping.`, { url }); return false; } try { const urlObj = new URL(url, window.location.origin); if (urlObj.pathname === '/' && urlObj.search === '' && urlObj.hash === '') { captureLogger.error(`${logPrefix} CRITICAL: URL points to the web root. This is likely an error from an empty 'src' attribute in an <img> tag. Skipping fetch.`, { url }); return false; } } catch (e) { captureLogger.error(`${logPrefix} Invalid URL format. Skipping.`, { url, error: e.message }); return false; } if (url.startsWith('data:')) { captureLogger.info(`${logPrefix} URL is a data: URI. No fetch needed.`); return false; } if (IMAGE_DATA_MEMORY_CACHE.has(url)) { captureLogger.info(`${logPrefix} Found in L1 Memory Cache.`); return IMAGE_DATA_MEMORY_CACHE.get(url); } captureLogger.info(`${logPrefix} Not in L1. Checking L2 IndexedDB Cache...`); let dataUrl = await assetCacheManager.getImageData(url); if (dataUrl) { IMAGE_DATA_MEMORY_CACHE.set(url, dataUrl); captureLogger.info(`${logPrefix} Found in L2 IndexedDB. Loaded into L1.`); return dataUrl; } captureLogger.warn(`${logPrefix} Not in any cache. Fetching from network...`); try { const response = await fetch(url, { mode: 'cors' }); if (!response.ok) { const errorData = { url, status: response.status, statusText: response.statusText }; captureLogger.error(`${logPrefix} Network fetch FAILED: Non-2xx response.`, errorData); return Promise.reject(`HTTP ${response.status} for ${url}`); } const contentType = response.headers.get('content-type'); if (!contentType || !contentType.startsWith('image/')) { const errorData = { url, contentType }; captureLogger.error(`${logPrefix} Network fetch FAILED: Response is not an image. This confirms an invalid image link.`, errorData); return Promise.reject(`URL is not an image type: ${contentType}`); } captureLogger.info(`${logPrefix} Network fetch SUCCESS. Converting blob to Data URL...`); const imageBlob = await response.blob(); dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(imageBlob); }); IMAGE_DATA_MEMORY_CACHE.set(url, dataUrl); await assetCacheManager.saveImageData(url, dataUrl); captureLogger.info(`${logPrefix} SUCCESS. Image fetched, converted, and cached.`); return dataUrl; } catch (err) { captureLogger.error(`${logPrefix} CRITICAL EXCEPTION during network fetch. Often a CORS issue.`, { url, errorMessage: err.message, }); return false; } }
async function getFontAwesomeCssAsync() { if (CACHED_FA_CSS) { captureLogger.info('Using cached Font Awesome CSS from memory.'); return CACHED_FA_CSS; } captureLogger.info('Processing Font Awesome @font-face rules...'); const fontFaceRules = []; for (const sheet of document.styleSheets) { try { if (!sheet.cssRules) continue; for (const rule of sheet.cssRules) { if (rule.type === CSSRule.FONT_FACE_RULE && rule.style.fontFamily.includes('Font Awesome')) { fontFaceRules.push(rule); } } } catch (e) { continue; } } if (fontFaceRules.length === 0) { captureLogger.warn('Could not find any Font Awesome @font-face rules.'); return ''; } const fontUrlRegex = /url\((['"]?)(.+?)\1\)/g; const processedRulesPromises = fontFaceRules.map(async (rule) => { let originalCssText = rule.cssText; let processedRule = originalCssText; const fontUrlMatches = [...originalCssText.matchAll(fontUrlRegex)]; for (const urlMatch of fontUrlMatches) { const originalUrlToken = urlMatch[0]; const absoluteFontUrl = new URL(urlMatch[2], rule.parentStyleSheet.href || window.location.href).href; const fontDataUrl = await getFontDataUrlAsync(absoluteFontUrl); if (fontDataUrl) { processedRule = processedRule.replace(originalUrlToken, `url("${fontDataUrl}")`); } } return processedRule; }); const finalRules = await Promise.all(processedRulesPromises); CACHED_FA_CSS = finalRules.join('\n'); captureLogger.info(`Font Awesome CSS processed, ${finalRules.length} rules inlined.`); return CACHED_FA_CSS; }
async function getSubsettedFontCssAsync(text) {
    if (!ACTIVE_FONT_MAPPING) {
        captureLogger.warn('No active font mapping available, cannot generate subsetted font CSS.');
        return '';
    }
    const { cssUrl, mapping } = ACTIVE_FONT_MAPPING;
    const requiredFontUrls = new Set();
    if (mapping['default']) {
        requiredFontUrls.add(mapping['default']);
    }
    for (const char of text) {
        const charCode = char.charCodeAt(0);
        if (mapping[charCode]) {
            requiredFontUrls.add(mapping[charCode]);
        }
    }
    if (requiredFontUrls.size === 0) return '';
    const urlToDataUrlMap = new Map();
    const fetchPromises = [];
    for (const url of requiredFontUrls) {
        const fetchPromise = (async () => {
            const dataUrl = await getFontDataUrlAsync(url);
            if (dataUrl) {
                urlToDataUrlMap.set(url, dataUrl);
            }
        })();
        fetchPromises.push(fetchPromise);
    }
    await Promise.all(fetchPromises);

    let cssContent;
    let baseUrl;
    // [OPTIMIZATION 1] 缓存字体CSS文件内容
    if (cssUrl.startsWith('inline-style:')) {
        cssContent = cssUrl.substring('inline-style:'.length);
        baseUrl = window.location.href;
    } else {
        if (CSS_CONTENT_MEMORY_CACHE.has(cssUrl)) {
            captureLogger.info("Using cached font CSS content from memory.");
            cssContent = CSS_CONTENT_MEMORY_CACHE.get(cssUrl);
        } else {
            captureLogger.info("Fetching font CSS content from network.");
            cssContent = await fetch(cssUrl).then(res => res.text());
            CSS_CONTENT_MEMORY_CACHE.set(cssUrl, cssContent); // 缓存结果
        }
        baseUrl = cssUrl;
    }
    
    const fontFaceRegex = /@font-face\s*{[^}]*}/g;
    const requiredCssRules = [];
    let match;
    fontFaceRegex.lastIndex = 0;
    while ((match = fontFaceRegex.exec(cssContent)) !== null) {
        const rule = match[0];
        const urlMatch = /url\((['"]?)(.*?)\1\)/.exec(rule);
        if (urlMatch) {
            const fontFileUrl = new URL(urlMatch[2], baseUrl).href;
            if (urlToDataUrlMap.has(fontFileUrl)) {
                requiredCssRules.push(rule.replace(urlMatch[0], `url("${urlToDataUrlMap.get(fontFileUrl)}")`));
            }
        }
    }
    const finalCss = requiredCssRules.join('\n');
    captureLogger.info(`Generated ${requiredCssRules.length} inlined @font-face rules for current text.`);
    return finalCss;
}
function findActiveBackgroundElement() { const selectors = ['#bg_animation_container > div[id^="bg"]', '#background > div[id^="bg"]', '#bg1', '#bg_animation_container', '#background']; for (const selector of selectors) { const el = document.querySelector(selector); if (el && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).backgroundImage !== 'none') return el; } captureLogger.warn("Could not find a specific background element, falling back to #chat as source."); return document.querySelector(config.chatContentSelector); }
function loadImage(dataUrl) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = (err) => reject(new Error('Image load failed', { cause: err })); img.src = dataUrl; }); }
async function createUnitBackgroundAsync(scale) { const currentSettings = getPluginSettings(); const chatContainer = document.querySelector(config.chatContentSelector); if (!chatContainer) throw new Error("Cannot find #chat element!"); const formSheld = document.querySelector('#form_sheld'); const chatRect = chatContainer.getBoundingClientRect(); const formSheldHeight = formSheld ? formSheld.offsetHeight : 0; const unitWidth = chatContainer.clientWidth; const unitHeight = chatRect.height - formSheldHeight; if (currentSettings.noBackground) { captureLogger.info('"No Background" is enabled. Creating a transparent background canvas.'); const transparentCanvas = document.createElement('canvas'); transparentCanvas.width = unitWidth * scale; transparentCanvas.height = unitHeight * scale; return transparentCanvas; } if (CACHED_UNIT_BACKGROUND) { captureLogger.info('Using cached "unit background".'); const clonedCanvas = CACHED_UNIT_BACKGROUND.cloneNode(true); const ctx = clonedCanvas.getContext('2d'); ctx.drawImage(CACHED_UNIT_BACKGROUND, 0, 0); return clonedCanvas; } const backgroundHolder = findActiveBackgroundElement(); const unitTop = chatRect.top; const unitLeft = chatContainer.getBoundingClientRect().left; const foregroundSelectors = ['#chat', '#form_sheld', '.header', '#right-panel', '#left-panel', '#character-popup']; const hiddenElements = []; let fullBackgroundDataUrl; captureLogger.info('--- Background Image Processing Started ---', { scale }); try { foregroundSelectors.forEach(selector => { document.querySelectorAll(selector).forEach(el => { if (el.style.visibility !== 'hidden') { el.style.visibility = 'hidden'; hiddenElements.push(el); } }); }); await new Promise(resolve => setTimeout(resolve, 100)); fullBackgroundDataUrl = await window.domToDataUrl(backgroundHolder, { scale, includeStyleProperties: STYLE_WHITELIST_ARRAY, fetchFn: customImageFetchFn, }); } finally { hiddenElements.forEach(el => { el.style.visibility = 'visible'; }); captureLogger.info('--- Background Image Processing Finished ---'); } if (!fullBackgroundDataUrl) throw new Error("Background capture failed during unit background creation."); const fullBgImage = await loadImage(fullBackgroundDataUrl); const unitCanvas = document.createElement('canvas'); unitCanvas.width = unitWidth * scale; unitCanvas.height = unitHeight * scale; const unitCtx = unitCanvas.getContext('2d'); unitCtx.drawImage(fullBgImage, unitLeft * scale, unitTop * scale, unitWidth * scale, unitHeight * scale, 0, 0, unitWidth * scale, unitHeight * scale); CACHED_UNIT_BACKGROUND = unitCanvas; captureLogger.info('"Unit background" created and cached successfully.'); const returnedCanvas = unitCanvas.cloneNode(true); const returnedCtx = returnedCanvas.getContext('2d'); returnedCtx.drawImage(unitCanvas, 0, 0); return returnedCanvas; }
async function captureLongScreenshot(elementsToCapture) {
    captureLogger.info('--- New Screenshot Process Started ---', { userAgent: navigator.userAgent, elementCount: elementsToCapture.length, isSingleMessage: elementsToCapture.length === 1, });
    if (!elementsToCapture || elementsToCapture.length === 0) {
        const error = new Error("No elements provided for long screenshot.");
        captureLogger.error(error.message, { error });
        throw error;
    }
    const timer = (label, start = performance.now()) => () => captureLogger.info(`⏱️ [Performance] ${label}: ${(performance.now() - start).toFixed(2)} ms`);
    const mainProcessStart = timer('Total process');
    const currentSettings = getPluginSettings();
    const scale = currentSettings.screenshotScale;
    const fontPrepStart = timer('0. Font preparation');
    const allTextContent = elementsToCapture.map(el => el.textContent || '').join('');
    const [subsettedCss, faCss] = await Promise.all([ getSubsettedFontCssAsync(allTextContent), getFontAwesomeCssAsync(), ]);
    const combinedCss = `${subsettedCss}\n${faCss}`;
    fontPrepStart();
    const calcStart = timer('1. Size calculation');
    let totalHeight = 0;
    let maxWidth = 0;
    elementsToCapture.forEach(el => {
        const rect = el.getBoundingClientRect();
        totalHeight += rect.height;
        if (el.clientWidth > maxWidth) maxWidth = el.clientWidth;
    });
    const messageMargin = elementsToCapture.length > 1 ? 5 : 0;
    totalHeight += (elementsToCapture.length - 1) * messageMargin;
    const finalWidth = maxWidth * scale;
    const finalHeight = totalHeight * scale;
    captureLogger.info(`Final dimensions calculated: ${maxWidth}x${totalHeight} (scaled: ${finalWidth}x${finalHeight})`);
    calcStart();
    let effectiveFormat = currentSettings.imageFormat;
    const MAX_WEBP_DIMENSION = 16000;
    if (currentSettings.imageFormat === 'webp' && (finalWidth > MAX_WEBP_DIMENSION || finalHeight > MAX_WEBP_DIMENSION)) {
        effectiveFormat = 'jpeg';
        captureLogger.warn(`WebP dimension limit (${MAX_WEBP_DIMENSION}px) exceeded. Temporarily falling back to JPEG for this capture.`);
        toastr.warning(`由于截图太长超过WebP格式高度上限，本次截图将回退至JPG格式！`, "格式回退", {timeOut: 5000});
    }
    const bgPrepStart = timer('2. Background preparation');
    const unitBgCanvas = await createUnitBackgroundAsync(scale);
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = finalWidth;
    finalCanvas.height = finalHeight;
    const finalCtx = finalCanvas.getContext('2d');
    if (!currentSettings.noBackground) {
        const pattern = finalCtx.createPattern(unitBgCanvas, 'repeat-y');
        finalCtx.fillStyle = pattern;
        finalCtx.fillRect(0, 0, finalWidth, finalHeight);
        const chatElement = document.querySelector(config.chatContentSelector);
        if (chatElement) {
            const chatBgColor = window.getComputedStyle(chatElement).backgroundColor;
            if (chatBgColor && chatBgColor !== 'rgba(0, 0, 0, 0)') {
                captureLogger.info(`Applying #chat background color to long screenshot: ${chatBgColor}`);
                if (effectiveFormat === 'jpeg') {
                    finalCtx.fillStyle = chatBgColor;
                    finalCtx.fillRect(0, 0, finalWidth, finalHeight);
                } else {
                    finalCtx.fillStyle = chatBgColor;
                    finalCtx.fillRect(0, 0, finalWidth, finalHeight);
                }
            }
        }
    }
    bgPrepStart();
    const stitchStart = timer('3. Foreground stitching');
    const lib = window.modernScreenshot;

    // 【修复】移除有问题的上下文复用逻辑。
    // 每次截图都创建一个全新的、干净的上下文，以确保字体等动态资源总是最新的。
    const context = await lib.createContext(elementsToCapture[0], {
        scale,
        font: false,
        includeStyleProperties: STYLE_WHITELIST_ARRAY,
        style: { margin: '0' },
        features: { restoreScrollPosition: true },
        fetchFn: customImageFetchFn,
        onCreateForeignObjectSvg: (svg) => {
            const quoteFixCss = 'q::before, q::after { content: none !important; }';
            const layoutFixCss = `pre { white-space: pre-wrap !important; word-break: break-all !important; overflow-wrap: break-word !important; } .name_text { white-space: nowrap !important; } .ch_name { letter-spacing: -0.5px !important; }`;
            const finalFontCss = combinedCss + '\n' + quoteFixCss + '\n' + layoutFixCss;
            if (finalFontCss) {
                const styleElement = document.createElement('style');
                styleElement.textContent = finalFontCss;
                let defs = svg.querySelector('defs');
                if (!defs) {
                    defs = document.createElement('defs');
                    svg.prepend(defs);
                }
                defs.appendChild(styleElement);
            }
        },
        workerUrl: `/scripts/extensions/third-party/${PLUGIN_ID}/worker.js`,
        // 【修复】由于不再复用，设置 autoDestruct 为 true 或在结束后手动销毁。
        // 手动销毁更明确，我们将使用 lib.destroyContext。
        autoDestruct: false,
    });
    
    let currentY = 0;
    for (const [index, element] of elementsToCapture.entries()) {
        const messageId = element.getAttribute('mesid') || `index-${index}`;
        captureLogger.info(`--- Message Content Processing Started (Msg ID: ${messageId}) ---`);
        const rect = element.getBoundingClientRect();
        // 更新上下文中的节点和尺寸
        context.node = element;
        context.width = rect.width;
        context.height = rect.height;
        
        const sectionCanvas = await lib.domToCanvas(context);
        captureLogger.info(`--- Message Content Processing Finished (Msg ID: ${messageId}) ---`);
        const offsetX = (finalWidth - sectionCanvas.width) / 2;
        finalCtx.drawImage(sectionCanvas, offsetX, currentY);
        currentY += rect.height * scale + messageMargin * scale;
    }
    
    // 【修复】每次截图任务完成后，必须销毁本次创建的上下文，释放资源。
    lib.destroyContext(context); 

    stitchStart();
    const exportStart = timer('4. Final image export');
    const finalDataUrl = finalCanvas.toDataURL('image/' + effectiveFormat, currentSettings.imageQuality);
    exportStart();
    mainProcessStart();
    captureLogger.info('--- Screenshot Process Finished Successfully ---');
    return finalDataUrl;
}
async function loadScript(src) { return new Promise((resolve, reject) => { if (document.querySelector(`script[src="${src}"]`)) return resolve(); const script = document.createElement('script'); script.src = src; script.async = true; script.onload = resolve; script.onerror = () => reject(new Error(`Script load failed: ${src}`)); document.head.appendChild(script); }); }

function getPluginSettings() {
    return { ...defaultSettings,
        ...settings.pluginSettings
    };
}

function getScreenshotIconHtml(faClass = 'fa-solid fa-camera') {
    const currentSettings = getPluginSettings();
    if (currentSettings.useCustomIcon && currentSettings.customIconUrl) {
        return `<img src="${currentSettings.customIconUrl}" style="width: 1em; height: 1em; object-fit: contain;">`;
    }
    return `<i class="${faClass}"></i>`;
}

function updateAllScreenshotIcons() {
    document.querySelectorAll(`.${config.buttonClass}`).forEach(button => {
        button.innerHTML = getScreenshotIconHtml();
    });
    const startButton = $('#long_screenshot_start_button');
    if (startButton.length) {
        startButton.find('i, img').replaceWith(getScreenshotIconHtml('fa-solid fa-scroll'));
    }
    const captureButton = $('#long_screenshot_capture_button');
    if (captureButton.length) {
        captureButton.find('i, img').replaceWith(getScreenshotIconHtml('fa-solid fa-camera'));
    }
}

function initLongScreenshotUI() {
    $('#long_screenshot_start_button, #long_screenshot_capture_button, #long_screenshot_cancel_button').remove();
    const startButton = $(`<div id="long_screenshot_start_button" class="menu_button">${getScreenshotIconHtml('fa-solid fa-scroll')}<span class="menu_button_text"> Long Screenshot</span></div>`);
    $('#chat_menu_buttons').append(startButton);
    startButton.on('click', () => {
        $('body').addClass('long-screenshot-selecting');
        $('#chat .mes').addClass('selectable-message');
        startButton.hide();
        const captureButton = $(`<div id="long_screenshot_capture_button" class="menu_button">${getScreenshotIconHtml()}<span class="menu_button_text"> Capture</span></div>`);
        const cancelButton = $('<div id="long_screenshot_cancel_button" class="menu_button"><i class="fa-solid fa-times"></i><span class="menu_button_text"> Cancel</span></div>');
        $('#chat_menu_buttons').append(captureButton, cancelButton);
        cancelButton.on('click', () => {
            $('body').removeClass('long-screenshot-selecting');
            $('#chat .mes').removeClass('selectable-message selected-for-screenshot');
            captureButton.remove();
            cancelButton.remove();
            startButton.show();
        });
        captureButton.on('click', async () => {
            const selectedElements = Array.from(document.querySelectorAll('.selected-for-screenshot'));
            if (selectedElements.length === 0) {
                toastr.warning("Please select at least one message.");
                return;
            }
            selectedElements.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            await executeScreenshot(selectedElements, captureButton[0]);
            cancelButton.trigger('click');
        });
    });
    $(document).on('click', '.selectable-message', function() {
        $(this).toggleClass('selected-for-screenshot');
    });
    const styles = `.long-screenshot-selecting #chat { cursor: pointer; } .selectable-message { transition: background-color 0.2s; } .selected-for-screenshot { background-color: rgba(0, 150, 255, 0.3) !important; }`;
    $('head').append(`<style>${styles}</style>`);
}

function removeMultiCaptureMenu() {
    document.querySelectorAll(`.${config.multiCaptureMenuClass}`).forEach(menu => menu.remove());
}

function showMultiCaptureMenu(buttonElement, messageElement) {
    removeMultiCaptureMenu();
    const menu = document.createElement('div');
    menu.className = config.multiCaptureMenuClass;
    const options = [{
        label: '截取前4条',
        before: 4,
        after: 0
    }, {
        label: '截取前3条',
        before: 3,
        after: 0
    }, {
        label: '截取前2条',
        before: 2,
        after: 0
    }, {
        label: '截取前1条',
        before: 1,
        after: 0
    }, {
        label: '截取后1条',
        before: 0,
        after: 1
    }, {
        label: '截取后2条',
        before: 0,
        after: 2
    }, {
        label: '截取后3条',
        before: 0,
        after: 3
    }, {
        label: '截取后4条',
        before: 0,
        after: 4
    }, ];
    options.forEach(option => {
        const optionEl = document.createElement('div');
        optionEl.className = 'st-multi-capture-option';
        optionEl.textContent = option.label;
        optionEl.addEventListener('click', (e) => {
            e.stopPropagation();
            removeMultiCaptureMenu();
            triggerMultiScreenshot(messageElement, option.before, option.after, buttonElement);
        });
        menu.appendChild(optionEl);
    });
    buttonElement.parentElement.appendChild(menu);
    setTimeout(() => {
        document.addEventListener('click', removeMultiCaptureMenu, {
            once: true
        });
    }, 0);
}

async function triggerMultiScreenshot(currentMessage, countBefore, countAfter, buttonElement) {
    const elementsToCapture = [currentMessage];
    let prev = currentMessage;
    for (let i = 0; i < countBefore; i++) {
        prev = prev.previousElementSibling;
        if (prev && prev.matches(config.messageSelector)) {
            elementsToCapture.unshift(prev);
        } else {
            break;
        }
    }
    let next = currentMessage;
    for (let i = 0; i < countAfter; i++) {
        next = next.nextElementSibling;
        if (next && next.matches(config.messageSelector)) {
            elementsToCapture.push(next);
        } else {
            break;
        }
    }
    elementsToCapture.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    captureLogger.info(`Triggering multi-message screenshot. Before: ${countBefore}, After: ${countAfter}. Total found: ${elementsToCapture.length}`);
    // --- START: 新增的动画处理逻辑 ---

    // 1. 保存原始图标内容，并立即显示加载动画
    const originalContent = buttonElement.innerHTML;
    buttonElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    buttonElement.classList.add('loading');

    try {
        // 2. 执行耗时的截图操作
        // 注意：我们仍然可以传递 buttonElement，尽管 executeScreenshot 不再使用它来控制动画
        await executeScreenshot(elementsToCapture, buttonElement);
    } catch (error) {
        // 如果 executeScreenshot 内部有未捕获的错误，这里可以捕获
        // 但根据现有代码，错误已在内部处理并 toastr 提示，所以这里可以留空
        captureLogger.error('Error during multi-screenshot execution from trigger.', error);
    } finally {
        // 3. 无论成功或失败，最后都必须恢复按钮的原始状态
        buttonElement.innerHTML = originalContent;
        buttonElement.classList.remove('loading');
    }
}

async function executeScreenshot(elements) {
    if (!elements || elements.length === 0) {
        toastr.warning("没有需要截图的消息。");
        return;
    }
    //const buttonIconContainer = triggerButton.querySelector('i, img')?.parentElement || triggerButton;
    //const originalContent = buttonIconContainer.innerHTML;
    //buttonIconContainer.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    //triggerButton.classList.add('loading');
    try {
        const dataUrl = await captureLongScreenshot(elements);
        const link = document.createElement('a');
        const extension = dataUrl.substring('data:image/'.length, dataUrl.indexOf(';'));
        const prefix = elements.length > 1 ? 'SillyTavern_Multi' : 'SillyTavern';
        link.download = `${prefix}_${new Date().toISOString().replace(/[:.T-]/g, '').slice(0, 14)}.${extension}`;
        link.href = dataUrl;
        link.click();
    } catch (error) {
        captureLogger.error('Screenshot execution failed:', error);
        toastr.error('截图失败，请查看控制台获取更多信息。');
    } 
}

function addScreenshotButtonToMessage(messageElement) {
    if (!messageElement || typeof messageElement.querySelector !== 'function' || messageElement.querySelector(`.${config.buttonClass}`)) return;
    const buttonsContainer = messageElement.querySelector('.mes_block .mes_buttons');
    if (!buttonsContainer) return;
    const screenshotButton = document.createElement('div');
    screenshotButton.innerHTML = getScreenshotIconHtml();
    screenshotButton.className = `${config.buttonClass} mes_button interactable`;
    screenshotButton.title = '点击截图，长按可多选';
    Object.assign(screenshotButton.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer'
    });
    const multiCaptureMenu = document.createElement('div');
    multiCaptureMenu.className = config.multiCaptureMenuClass;
    Object.assign(multiCaptureMenu.style, {
        display: 'none',
        position: 'absolute',
        zIndex: 10001,
    });
    const options = [{
        label: '截取前4条',
        before: 4,
        after: 0
    }, {
        label: '截取前3条',
        before: 3,
        after: 0
    }, {
        label: '截取前2条',
        before: 2,
        after: 0
    }, {
        label: '截取前1条',
        before: 1,
        after: 0
    }, {
        label: '截取后1条',
        before: 0,
        after: 1
    }, {
        label: '截取后2条',
        before: 0,
        after: 2
    }, {
        label: '截取后3条',
        before: 0,
        after: 3
    }, {
        label: '截取后4条',
        before: 0,
        after: 4
    }, ];
    options.forEach(option => {
        const optionEl = document.createElement('div');
        optionEl.className = 'st-multi-capture-option';
        optionEl.textContent = option.label;
        optionEl.addEventListener('click', (e) => {
            e.stopPropagation();
            hideMenu();
            triggerMultiScreenshot(messageElement, option.before, option.after, screenshotButton);
        });
        multiCaptureMenu.appendChild(optionEl);
    });
    document.body.appendChild(multiCaptureMenu);
    const handleClickOutside = (event) => {
        if (multiCaptureMenu.style.display === 'block' && !multiCaptureMenu.contains(event.target) && !screenshotButton.contains(event.target)) {
            hideMenu();
        }
    };
    const showMenu = () => {
        const rect = screenshotButton.getBoundingClientRect();
        multiCaptureMenu.style.display = 'block';
        const menuWidth = multiCaptureMenu.offsetWidth;
        const menuHeight = multiCaptureMenu.offsetHeight;
        const spaceOnRight = window.innerWidth - rect.right;
        let x;
        if (spaceOnRight >= menuWidth + 5) {
            x = rect.right + 5;
        } else {
            x = rect.left - menuWidth - 5;
        }
        const iconCenterY = rect.top + rect.height / 2;
        let y = iconCenterY - menuHeight / 2;
        const viewportHeight = window.innerHeight;
        if (x < 5) {
            x = 5;
        }
        if (y < 5) {
            y = 5;
        } else if (y + menuHeight > viewportHeight - 5) {
            y = viewportHeight - menuHeight - 5;
        }
        multiCaptureMenu.style.left = `${x}px`;
        multiCaptureMenu.style.top = `${y}px`;
        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    };
    const hideMenu = () => {
        if (multiCaptureMenu.style.display === 'block') {
            multiCaptureMenu.style.display = 'none';
            document.removeEventListener('click', handleClickOutside);
        }
    };
    let pressTimer = null;
    let isLongPress = false;
    const startPress = (event) => {
        if (event.type === 'mousedown' && event.button !== 0) return;
        isLongPress = false;
        pressTimer = setTimeout(() => {
            isLongPress = true;
            captureLogger.info('Long press detected.');
            showMenu();
        }, config.longPressDuration);
    };
    const cancelPress = () => {
        clearTimeout(pressTimer);
    };
    screenshotButton.addEventListener('mousedown', startPress);
    screenshotButton.addEventListener('touchstart', startPress, {
        passive: true
    });
    screenshotButton.addEventListener('mouseup', cancelPress);
    screenshotButton.addEventListener('mouseleave', cancelPress);
    screenshotButton.addEventListener('touchend', cancelPress);
    screenshotButton.addEventListener('touchcancel', cancelPress);
	// 在 addScreenshotButtonToMessage 函数中，找到这个点击事件监听器
	screenshotButton.addEventListener('click', async (event) => {
		if (isLongPress) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		
		// --- START: 修改部分 ---

		if (screenshotButton.classList.contains('loading')) return;

		// 1. 立即更新UI，显示加载动画
		const originalContent = screenshotButton.innerHTML;
		screenshotButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
		screenshotButton.classList.add('loading');

		try {
			// 2. 然后再执行耗时的截图操作
			captureLogger.info('Executing single message screenshot...');
			// 注意：我们将不再把 screenshotButton 传递给 executeScreenshot
			await executeScreenshot([messageElement]); 
		} catch (error) {
			// 错误处理已在 executeScreenshot 内部完成，但保留以防万一
			captureLogger.error('Screenshot execution failed from click handler:', error);
		} finally {
			// 3. 无论成功或失败，最后都恢复按钮状态
			screenshotButton.innerHTML = originalContent;
			screenshotButton.classList.remove('loading');
		}
		
		// --- END: 修改部分 ---
	});
    const extraButtonsContainer = buttonsContainer.querySelector('.extraMesButtons');
    if (extraButtonsContainer) {
        buttonsContainer.insertBefore(screenshotButton, extraButtonsContainer);
    } else {
        buttonsContainer.appendChild(screenshotButton);
    }
}

function installScreenshotButtons() {
    document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
    const chatContentEl = document.querySelector(config.chatContentSelector);
    if (!chatContentEl) {
        captureLogger.warn('Chat container not found, retrying in 1s...');
        setTimeout(installScreenshotButtons, 1000);
        return;
    }
    chatContentEl.querySelectorAll(config.messageSelector).forEach(addScreenshotButtonToMessage);
    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.matches(config.messageSelector)) {
                        addScreenshotButtonToMessage(node);
                    } else if (typeof node.querySelectorAll === 'function') {
                        node.querySelectorAll(config.messageSelector).forEach(addScreenshotButtonToMessage);
                    }
                }
            }
        }
    });
    observer.observe(chatContentEl, {
        childList: true,
        subtree: true
    });
}

function setupFontChangeObserver() {
    const styleNode = document.getElementById('custom-style');
    if (!styleNode) {
        captureLogger.warn('Could not find #custom-style element, cannot set up font change observer.');
        return;
    }
    const observer = new MutationObserver(() => {
        captureLogger.info('#custom-style content changed, processing new fonts...');
        // [OPTIMIZATION] 字体CSS变化时，清空相关缓存
        CSS_CONTENT_MEMORY_CACHE.clear();
        invalidateScreenshotContext();
        assetCacheManager.processFontFromStyleElement().catch(err => {
            captureLogger.error("Failed to re-preprocess font mapping:", err);
        });
    });
    observer.observe(styleNode, {
        childList: true,
        characterData: true,
        subtree: true
    });
    captureLogger.info('Font change observer for #custom-style has been successfully set up.');
}

async function initializePlugin() {
    try {
        captureLogger.info(`Plugin core initialization starting... (v${SCRIPT_VERSION})`);
        
        loadSettings();

        const libPromise = loadScript(`/scripts/extensions/third-party/${PLUGIN_ID}/modern-screenshot.umd.js`);
        const dbInitPromise = assetCacheManager.init();
        await Promise.all([libPromise, dbInitPromise]);
        if (!window.modernScreenshot?.domToDataUrl) throw new Error('Modern Screenshot library failed to load!');
        window.domToDataUrl = window.modernScreenshot.domToDataUrl;
        
        const multiCaptureStyles = `
            .${config.multiCaptureMenuClass} { background: black !important; color: white !important; border: 1px solid #444; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 10001; width: auto; padding: 4px; display: flex; flex-direction: column; gap: 2px; }
            .st-multi-capture-option { padding: 6px 12px; font-size: 13px; white-space: nowrap; cursor: pointer; border-radius: 4px; transition: background-color 0.2s ease; }
            .st-multi-capture-option:hover { background-color: rgba(255, 255, 255, 0.2) !important; }
        `;
        $('head').append(`<style>${multiCaptureStyles}</style>`);
        
        captureLogger.info('Pre-warming resource memory cache (L1)...');
        const hydrationStart = performance.now();
        const fontPromise = assetCacheManager.getAllFontData().then(allFonts => { for (const font of allFonts) { FONT_DATA_MEMORY_CACHE.set(font.fontUrl, font.dataUrl); } return allFonts.length; });
        const imagePromise = assetCacheManager.getAllImageData().then(allImages => { for (const image of allImages) { IMAGE_DATA_MEMORY_CACHE.set(image.imageUrl, image.dataUrl); } return allImages.length; });
        const [fontCount, imageCount] = await Promise.all([fontPromise, imagePromise]);
        captureLogger.info(`Resource cache pre-warmed. Loaded ${fontCount} fonts and ${imageCount} images. Took ${(performance.now() - hydrationStart).toFixed(2)} ms.`);
        
        await assetCacheManager.processFontFromStyleElement();
        setupFontChangeObserver();
        
        installScreenshotButtons();
        initLongScreenshotUI();
        initSettingsUI();

        updateChecker.check();

        const chatContainer = document.querySelector(config.chatContentSelector);
        if (chatContainer) {
            const resizeObserver = new ResizeObserver(() => {
                captureLogger.info('Window/container resize detected.');
                // [OPTIMIZATION] 窗口大小变化，必须销毁所有相关缓存
                invalidateUnitBackgroundCache();
                invalidateScreenshotContext();
            });
            resizeObserver.observe(chatContainer);
        }
        captureLogger.info('Plugin initialized successfully.');
    } catch (error) {
        captureLogger.error('A critical error occurred during plugin initialization:', error);
    }
}

jQuery(async () => {
    let isInitialized = false;
    const runInitialization = () => {
        if (isInitialized) return;
        isInitialized = true;
        initializePlugin();
    };
    if (typeof window.eventSource !== 'undefined' && typeof window.event_types !== 'undefined' && window.event_types.APP_READY) {
        window.eventSource.on(window.event_types.APP_READY, runInitialization);
    } else {
        setTimeout(runInitialization, 1000);
    }
});
