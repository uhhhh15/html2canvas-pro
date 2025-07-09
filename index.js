// public/extensions/third-party/html2canvas-pro/index.js

import {
    extension_settings,
    getContext, // 如果需要使用 context 对象，则导入
    renderExtensionTemplateAsync,
    // loadExtensionSettings // 这个函数通常由 ST 核心调用，插件一般不需要主动导入和调用
} from '../../../extensions.js';

// 从 script.js 导入
import {
    saveSettingsDebounced,
    eventSource,
    event_types, // 如果需要监听事件，则导入
    // 其他可能需要的函数，如 messageFormatting, addOneMessage 等
} from '../../../../script.js';

// 如果你的插件需要弹窗功能，从 popup.js 导入
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// 如果需要 UUID 或时间戳处理等工具函数，从 utils.js 导入
import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

// 插件的命名空间，与 manifest.json 中的文件夹名称一致
const PLUGIN_ID = 'html2canvas-pro';
const PLUGIN_NAME = 'html2canvas-pro';

// 在顶部声明区域添加日志系统
const captureLogger = {
    logs: [],
    maxLogs: 100,
    
    // 日志级别: info, warn, error, success, debug
    log: function(message, level = 'info', data = null) {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            message,
            level,
            data
        };
        this.logs.push(entry); // 改为添加到末尾，保持时间顺序
        if (this.logs.length > this.maxLogs) this.logs.shift(); // 从前面移除旧日志
        
        // 同时在控制台输出
        const consoleMethod = level === 'error' ? 'error' : 
                             level === 'warn' ? 'warn' : 
                             level === 'debug' ? 'debug' : 'log';
        console[consoleMethod](`[${timestamp}][${level.toUpperCase()}] ${message}`, data || '');
    },
    
    info: function(message, data) { this.log(message, 'info', data); },
    warn: function(message, data) { this.log(message, 'warn', data); },
    error: function(message, data) { this.log(message, 'error', data); },
    success: function(message, data) { this.log(message, 'success', data); },
    debug: function(message, data) { this.log(message, 'debug', data); },
    
    // 记录重要警告 - 可能导致黑屏的关键问题
    critical: function(message, data) { this.log(`【关键】${message}`, 'critical', data); },
    
    clear: function() { this.logs = []; }
};

// 插件的默认设置
const defaultSettings = {
    screenshotDelay: 10,       // 可以设置更低值，比如 0-20
    scrollDelay: 10,
    autoInstallButtons: true,
    altButtonLocation: true,
    screenshotScale: 1.5,      // 降低到 1.5 以提高速度
    useForeignObjectRendering: false,
    letterRendering: true,    // 关闭字形渲染提高文字渲染速度
    imageTimeout: 3000,        // 缩短图像加载超时
    debugOverlay: true,        // 是否显示进度遮罩层
    imageFormat: 'jpg'         // 默认图片格式
};

// 全局配置对象，将从设置中加载
const config = {
    buttonClass: 'st-screenshot-button',
    chatScrollContainerSelector: '#chat', // Used for context, not direct scroll iterations for h2c
    chatContentSelector: '#chat',
    messageSelector: '.mes',
    lastMessageSelector: '.mes.last_mes',
    messageTextSelector: '.mes_block .mes_text',
    messageHeaderSelector: '.mes_block .ch_name',
    // html2canvas options will be loaded from settings
    html2canvasOptions: {
        allowTaint: true,
        useCORS: true,
        backgroundColor: null,
        logging: false,        // 始终关闭日志以提高性能
        removeContainer: true
        // 其他选项会从 settings 加载，不要在这里硬编码
    },
    imageFormat: 'jpg'         // 新增：默认图片格式
};


// --- 新增：性能优化的关键 ---
// 一个包含绝大多数影响视觉渲染的CSS属性的白名单。
// 我们将只复制这些属性，而不是全部300+个，从而极大地提升性能。
const OPTIMIZED_STYLE_PROPERTIES = [
    // --- Layout & Box Model ---
    'display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-width', 'border-style', 'border-color', 'border-radius', 
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    'border-collapse', 'border-spacing', 'box-sizing', 'overflow', 'overflow-x', 'overflow-y',

    // --- Flexbox & Grid ---
    'flex', 'flex-basis', 'flex-direction', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-wrap',
    'align-content', 'align-items', 'align-self', 'justify-content', 'justify-items', 'justify-self',
    'gap', 'row-gap', 'column-gap',
    'grid', 'grid-area', 'grid-template', 'grid-template-areas', 'grid-template-rows', 'grid-template-columns',
    'grid-row', 'grid-row-start', 'grid-row-end', 'grid-column', 'grid-column-start', 'grid-column-end',

    // --- Typography ---
    'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration', 'text-indent',
    'text-transform', 'text-shadow', 'white-space', 'vertical-align',

    // --- Visuals ---
    'background', 'background-color', 'background-image', 'background-repeat', 'background-position', 'background-size',
    'opacity', 'visibility', 'box-shadow', 'outline', 'outline-offset', 'cursor',
    'transform', 'transform-origin', 'transform-style', 'transition', 'animation', 'filter'
];

// 确保插件设置已加载并与默认值合并
function getPluginSettings() {
    extension_settings[PLUGIN_ID] = extension_settings[PLUGIN_ID] || {};
    Object.assign(extension_settings[PLUGIN_ID], { ...defaultSettings, ...extension_settings[PLUGIN_ID] });
    return extension_settings[PLUGIN_ID];
}

// 加载并应用配置
function loadConfig() {
    const settings = getPluginSettings();

    // 基本配置
    config.screenshotDelay = parseInt(settings.screenshotDelay, 10) || 0;
    config.scrollDelay = parseInt(settings.scrollDelay, 10) || 0;
    config.autoInstallButtons = settings.autoInstallButtons;
    config.altButtonLocation = settings.altButtonLocation;
    config.debugOverlay = settings.debugOverlay !== undefined ? settings.debugOverlay : true;

    // --- 【增强日志与强制修正】处理 screenshotScale ---
    captureLogger.info('[配置] 开始处理 screenshotScale 设置');

    const rawSavedScale = settings.screenshotScale;
    const loadedScale = parseFloat(rawSavedScale);
    
    captureLogger.debug(`[配置] 从设置中读取到的原始 scale 值为: ${rawSavedScale} (类型: ${typeof rawSavedScale})`);
    
    // 场景 1: 读取到的值是旧的默认值 2.0
    if (!isNaN(loadedScale) && loadedScale === 2.0) {
        settings.screenshotScale = 1.5; // 更新设置对象中的值
        config.html2canvasOptions.scale = 1.5; // 同时更新当前配置
        
        captureLogger.warn(`[配置] 检测到旧的默认 scale 值 (2.0)，已自动修正为新的默认值 1.5。`);
        // 可选：如果 saveSettingsDebounced 可靠，可以调用它来保存修正
        if (typeof saveSettingsDebounced === 'function') {
            saveSettingsDebounced();
        }
    } 
    // 场景 2: 读取到的值是有效的自定义值 (不是 2.0)
    else if (!isNaN(loadedScale) && loadedScale > 0) {
        config.html2canvasOptions.scale = loadedScale;
        captureLogger.info(`[配置] 已加载用户自定义的 scale 值: ${loadedScale}`);
    } 
    // 场景 3: 读取到的值无效或不存在，应用新的默认值
    else {
        settings.screenshotScale = 1.5;
        config.html2canvasOptions.scale = 1.5;
        captureLogger.info(`[配置] 未找到有效的 scale 值，已应用新的默认值 1.5。`);
    }

    // 最终确认
    captureLogger.success(`[配置] screenshotScale 最终生效值为: ${config.html2canvasOptions.scale}`);
    
    // 应用其他html2canvas设置
    config.html2canvasOptions.foreignObjectRendering = settings.useForeignObjectRendering;
    config.html2canvasOptions.letterRendering = settings.letterRendering !== undefined ?
        settings.letterRendering : defaultSettings.letterRendering;
    config.html2canvasOptions.imageTimeout = settings.imageTimeout || defaultSettings.imageTimeout;

    // 加载图片格式设置
    config.imageFormat = settings.imageFormat || defaultSettings.imageFormat;

    // 最终打印一次完整的配置信息
    console.log(`${PLUGIN_NAME}: 配置已加载并应用:`, { ...config });
    captureLogger.info(`[配置] 插件配置加载完成`, { ...config });
}
// === 动态加载脚本的辅助函数 (保持在 jQuery 闭包外部) ===
async function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            console.log(`[${PLUGIN_NAME}] 脚本加载成功: ${src}`);
            resolve();
        };
        script.onerror = (error) => {
            console.error(`[${PLUGIN_NAME}] 脚本加载失败: ${src}`, error);
            reject(new Error(`Failed to load script: ${src}`));
        };
        document.head.appendChild(script);
    });
}

async function getDynamicBackground(elementForContext) {
    captureLogger.debug(`[背景] 开始获取动态背景`);
    
    const chatContainer = document.querySelector(config.chatContentSelector);
    if (!chatContainer) {
        captureLogger.critical(`[背景] 找不到聊天容器: ${config.chatContentSelector}`);
        return { color: '#1e1e1e', imageInfo: null };
    }

    const computedChatStyle = window.getComputedStyle(chatContainer);
    
    let backgroundColor = '#1e1e1e'; // Fallback
    if (computedChatStyle.backgroundColor && computedChatStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && computedChatStyle.backgroundColor !== 'transparent') {
        backgroundColor = computedChatStyle.backgroundColor;
    } else {
        const pcbVar = getComputedStyle(document.body).getPropertyValue('--pcb');
        if (pcbVar && pcbVar.trim()) {
            backgroundColor = pcbVar.trim();
        }
    }
    
    captureLogger.debug(`[背景] 确定的背景色: ${backgroundColor}`);
    
    const bgElement = document.querySelector('#bg1, #bg2') || chatContainer;
    const computedBgStyle = window.getComputedStyle(bgElement);
    
    let backgroundImageInfo = null;
    if (computedBgStyle.backgroundImage && computedBgStyle.backgroundImage !== 'none') {
        captureLogger.debug(`[背景] 检测到背景图: ${computedBgStyle.backgroundImage.substring(0, 50)}...`);
        
        const bgImageUrlMatch = computedBgStyle.backgroundImage.match(/url\("?(.+?)"?\)/);
        if (bgImageUrlMatch) {
            const bgImageUrl = bgImageUrlMatch[1];
            
            const img = new Image();
            img.src = bgImageUrl;
            await new Promise(resolve => {
                img.onload = () => {
                    captureLogger.debug(`[背景] 背景图加载成功: ${img.naturalWidth}x${img.naturalHeight}`);
                    resolve();
                };
                img.onerror = () => {
                    captureLogger.warn(`[背景] 背景图加载失败: ${bgImageUrl}`);
                    resolve();
                };
            });

            const elementRect = elementForContext.getBoundingClientRect();
            const bgRect = bgElement.getBoundingClientRect();
            const offsetX = elementRect.left - bgRect.left;
            const offsetY = elementRect.top - bgRect.top;

            backgroundImageInfo = {
                url: bgImageUrl,
                originalWidth: img.naturalWidth || bgRect.width,
                originalHeight: img.naturalHeight || bgRect.height,
                styles: {
                    backgroundImage: computedBgStyle.backgroundImage,
                    backgroundSize: computedBgStyle.backgroundSize,
                    backgroundRepeat: 'repeat-y', 
                    backgroundPosition: `-${offsetX}px -${offsetY}px`,
                }
            };
        }
    } else {
        captureLogger.debug(`[背景] 没有检测到背景图`);
    }
    
    return { color: backgroundColor, imageInfo: backgroundImageInfo };
}

// 在jQuery初始化函数中添加
function ensureMobileViewport() {
    let viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) {
        viewportMeta = document.createElement('meta');
        viewportMeta.name = 'viewport';
        document.head.appendChild(viewportMeta);
    }
    viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    console.log('[html2canvas-pro] 已设置移动设备视口');
}

// 在初始化时调用
jQuery(async () => {
    console.log(`${PLUGIN_NAME}: 插件初始化中...`);
    
    // 确保移动设备视口设置正确
    ensureMobileViewport();
    
    try {
        await loadScript(`scripts/extensions/third-party/${PLUGIN_ID}/html2canvas-pro.min.js`);
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 无法加载 html2canvas-pro.min.js。插件功能将受限。`, error);
        return;
    }

    loadConfig();

    let settingsHtml;
    try {
        settingsHtml = await renderExtensionTemplateAsync(`third-party/${PLUGIN_ID}`, 'settings');
        console.log(`${PLUGIN_NAME}: 成功加载设置面板模板`);
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 无法加载设置面板模板:`, error);
        
        settingsHtml = `
        <div id="scane2_settings">
          <h2>ST截图3.0</h2>

          <div class="option-group">
            <h3>截图操作</h3>
            <button id="st_h2c_captureLastMsgBtn" class="menu_button">截取最后一条消息</button>
          </div>

          <hr>

          <div class="option-group">
            <h3>扩展设置</h3>
            <div class="option">
              <label for="st_h2c_screenshotDelay">截图前延迟 (ms):</label>
              <input type="number" id="st_h2c_screenshotDelay" min="0" max="2000" step="50" value="${defaultSettings.screenshotDelay}">
            </div>
            <div class="option">
              <label for="st_h2c_scrollDelay">UI更新等待 (ms):</label>
              <input type="number" id="st_h2c_scrollDelay" min="0" max="2000" step="50" value="${defaultSettings.scrollDelay}">
            </div>
            <div class="option">
              <label for="st_h2c_screenshotScale">渲染比例 (Scale):</label>
              <input type="number" id="st_h2c_screenshotScale" min="0.5" max="4.0" step="0.1" value="${defaultSettings.screenshotScale}">
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_useForeignObjectRendering" ${defaultSettings.useForeignObjectRendering ? 'checked' : ''}>
              <label for="st_h2c_useForeignObjectRendering">尝试快速模式 (兼容性低)</label>
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_autoInstallButtons" ${defaultSettings.autoInstallButtons ? 'checked' : ''}>
              <label for="st_h2c_autoInstallButtons">自动安装消息按钮</label>
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_altButtonLocation" ${defaultSettings.altButtonLocation ? 'checked' : ''}>
              <label for="st_h2c_altButtonLocation">按钮备用位置</label>
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_letterRendering" ${defaultSettings.letterRendering ? 'checked' : ''}>
              <label for="st_h2c_letterRendering">字形渲染</label>
            </div>
            <div class="option">
              <input type="checkbox" id="st_h2c_debugOverlay" ${defaultSettings.debugOverlay ? 'checked' : ''}>
              <label for="st_h2c_debugOverlay">显示调试覆盖层</label>
            </div>
            <div class="option">
              <label for="st_h2c_imageFormat">图片格式:</label>
              <select id="st_h2c_imageFormat">
                <option value="jpg" ${config.imageFormat === 'jpg' ? 'selected' : ''}>JPG</option>
                <option value="png" ${config.imageFormat === 'png' ? 'selected' : ''}>PNG</option>
              </select>
            </div>

            <button id="st_h2c_saveSettingsBtn" class="menu_button">保存设置</button>
            <div class="status-area" id="st_h2c_saveStatus" style="display:none;"></div>
          </div>
        </div>
        `;
    }

    $('#extensions_settings_content').append(settingsHtml);

    const settingsForm = $('#extensions_settings_content');

    const screenshotDelayEl = settingsForm.find('#st_h2c_screenshotDelay');
    const scrollDelayEl = settingsForm.find('#st_h2c_scrollDelay');
    const screenshotScaleEl = settingsForm.find('#st_h2c_screenshotScale');
    const useForeignObjectRenderingEl = settingsForm.find('#st_h2c_useForeignObjectRendering');
    const autoInstallButtonsEl = settingsForm.find('#st_h2c_autoInstallButtons');
    const altButtonLocationEl = settingsForm.find('#st_h2c_altButtonLocation');
    const saveSettingsBtn = settingsForm.find('#st_h2c_saveSettingsBtn');
    const saveStatusEl = settingsForm.find('#st_h2c_saveStatus');
    const captureLastMsgBtn = settingsForm.find('#st_h2c_captureLastMsgBtn');
    const letterRenderingEl = settingsForm.find('#st_h2c_letterRendering');
    const debugOverlayEl = settingsForm.find('#st_h2c_debugOverlay');
    const imageFormatSelect = settingsForm.find('#st_h2c_imageFormat');

    function updateSettingsUI() {
        const settings = getPluginSettings();
        screenshotDelayEl.val(settings.screenshotDelay);
        scrollDelayEl.val(settings.scrollDelay);
        screenshotScaleEl.val(settings.screenshotScale);
        useForeignObjectRenderingEl.prop('checked', settings.useForeignObjectRendering);
        autoInstallButtonsEl.prop('checked', settings.autoInstallButtons);
        altButtonLocationEl.prop('checked', settings.altButtonLocation !== undefined ? settings.altButtonLocation : true);
        
        if (letterRenderingEl) letterRenderingEl.prop('checked', settings.letterRendering);
        if (debugOverlayEl) debugOverlayEl.prop('checked', settings.debugOverlay);
        
        if (imageFormatSelect.length) {
            imageFormatSelect.val(settings.imageFormat || defaultSettings.imageFormat);
        }
    }

    saveSettingsBtn.on('click', () => {
        const settings = getPluginSettings();

        settings.screenshotDelay = parseInt(screenshotDelayEl.val(), 10) || defaultSettings.screenshotDelay;
        settings.scrollDelay = parseInt(scrollDelayEl.val(), 10) || defaultSettings.scrollDelay;
        settings.screenshotScale = parseFloat(screenshotScaleEl.val()) || defaultSettings.screenshotScale;
        settings.useForeignObjectRendering = useForeignObjectRenderingEl.prop('checked');
        settings.autoInstallButtons = autoInstallButtonsEl.prop('checked');
        settings.altButtonLocation = altButtonLocationEl.prop('checked');
        settings.letterRendering = letterRenderingEl.prop('checked');
        settings.debugOverlay = debugOverlayEl.prop('checked');
        settings.imageFormat = $('#st_h2c_imageFormat').val();

        saveSettingsDebounced();

        saveStatusEl.text("设置已保存!").css('color', '#4cb944').show();
        setTimeout(() => saveStatusEl.hide(), 1000);

        loadConfig();
        if (config.autoInstallButtons) {
            installScreenshotButtons();
        } else {
            document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
        }
    });

    captureLastMsgBtn.on('click', async () => {
        const options = {
            target: 'last',
            includeHeader: true
        };
        try {
            const dataUrl = await captureMessageWithOptions(options);
            if (dataUrl) {
                downloadImage(dataUrl, null, options.target);
            } else {
                throw new Error('未能生成截图');
            }
        } catch (error) {
            console.error('从设置面板截图失败:', error.stack || error);
            alert(`截图失败: ${error.message || '未知错误'}`);
        }
    });

    updateSettingsUI();

    if (config.autoInstallButtons) {
        installScreenshotButtons();
    } else {
        console.log(`${PLUGIN_NAME}: 自动安装截图按钮已禁用.`);
    }

    console.log(`${PLUGIN_NAME}: 插件初始化完成.`);

    function addExtensionMenuButton() {
        if (document.querySelector(`#extensionsMenu .fa-camera[data-plugin-id="${PLUGIN_ID}"]`)) {
            return;
        }
        
        const menuButton = document.createElement('div');
        menuButton.classList.add('fa-solid', 'fa-camera', 'extensionsMenuExtension');
        menuButton.title = `${PLUGIN_NAME} 日志`;
        menuButton.setAttribute('data-plugin-id', PLUGIN_ID);

        menuButton.appendChild(document.createTextNode('截图日志'));
        
        menuButton.addEventListener('click', () => {
            const extensionsMenu = document.getElementById('extensionsMenu');
            if (extensionsMenu) extensionsMenu.style.display = 'none';
            
            showCaptureLogsPopup();
        });
        
        const extensionsMenu = document.getElementById('extensionsMenu');
        if (extensionsMenu) {
            extensionsMenu.appendChild(menuButton);
            captureLogger.info(`[UI] 截图日志按钮已添加到扩展菜单`);
        } else {
            captureLogger.error(`[UI] 无法找到扩展菜单(#extensionsMenu)`);
        }
    }
	

    function waitForExtensionsMenu() {
        captureLogger.debug(`[UI] 等待扩展菜单加载...`);
        
        if (document.getElementById('extensionsMenu')) {
            captureLogger.debug(`[UI] 扩展菜单已存在，添加按钮`);
            addExtensionMenuButton();
            return;
        }
        
        captureLogger.debug(`[UI] 扩展菜单不存在，设置观察器`);
        const observer = new MutationObserver((mutations, obs) => {
            if (document.getElementById('extensionsMenu')) {
                captureLogger.debug(`[UI] 扩展菜单已加载，添加按钮`);
                addExtensionMenuButton();
                obs.disconnect();
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    waitForExtensionsMenu();
});


/**
 * [极速版辅助函数] 将一个元素的所有关键计算样式，包括伪元素，复制到另一个元素上。
 * 通过白名单机制，避免遍历数百个无关属性，性能提升10-50倍。
 * @param {HTMLElement} source - 样式来源元素
 * @param {HTMLElement} target - 样式应用目标元素
 * @param {string} cloneId - 一个唯一的ID，用于为伪元素生成特定样式
 */
function copyComputedStyles(source, target, cloneId) {
    if (!source || !target) return;

    // --- 1. 复制元素本身的所有关键样式 (使用白名单) ---
    const computedStyle = window.getComputedStyle(source);
    // 核心优化：只遍历我们的白名单，而不是整个 computedStyle 对象
    for (const prop of OPTIMIZED_STYLE_PROPERTIES) {
        target.style.setProperty(
            prop,
            computedStyle.getPropertyValue(prop),
            computedStyle.getPropertyPriority(prop)
        );
    }

    // --- 2. 处理伪元素 (逻辑保持不变，因为伪元素属性不多，性能影响小) ---
    const pseudoTypes = ['::before', '::after'];
    let pseudoStyles = '';

    pseudoTypes.forEach(pseudoType => {
        const pseudoStyle = window.getComputedStyle(source, pseudoType);
        const content = pseudoStyle.getPropertyValue('content');
        if (content && content !== 'none' && content !== 'normal') {
            target.id = target.id || cloneId || `h2c-clone-${uuidv4()}`;
            let rule = `#${target.id}${pseudoType} { content: ${content};`; // 确保 content 属性被首先设置
            // 对伪元素也使用白名单进行优化
            for (const prop of OPTIMIZED_STYLE_PROPERTIES) {
                rule += `${prop}: ${pseudoStyle.getPropertyValue(prop)} ${pseudoStyle.getPropertyPriority(prop) ? '!important' : ''}; `;
            }
            rule += '} ';
            pseudoStyles += rule;
        }
    });

    if (pseudoStyles) {
        let styleTag = document.getElementById('h2c-pseudo-styles');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'h2c-pseudo-styles';
            document.head.appendChild(styleTag);
        }
        styleTag.textContent += pseudoStyles;
    }
}


/**
 * [增强修复版] 通过高保真复制计算样式来修复复杂布局。
 * 此版本不再重新克隆子元素，而是在现有克隆体上工作，以保留准备阶段的成果。
 * @param {HTMLElement} originalElement - 原始元素
 * @param {HTMLElement} clonedElement - 克隆元素
 * @param {string[]} selectors - 需要修复的容器选择器数组
 */
function fixComplexLayouts(originalElement, clonedElement, selectors) {
    captureLogger.info('[布局修复-增强版] 开始高保真样式复制...');

    selectors.forEach(selector => {
        const originalContainers = originalElement.querySelectorAll(selector);
        const clonedContainers = clonedElement.querySelectorAll(selector);

        if (originalContainers.length !== clonedContainers.length) {
            captureLogger.warn(`[布局修复] 选择器 "${selector}" 的原始与克隆数量不匹配，跳过。原始: ${originalContainers.length}, 克隆: ${clonedContainers.length}`);
            return;
        }

        originalContainers.forEach((originalContainer, index) => {
            const clonedContainer = clonedContainers[index];
            if (!originalContainer || !clonedContainer) return;

            captureLogger.debug(`[布局修复] 正在处理容器: ${originalContainer.className}`);

            // 1. 复制容器本身的样式 (保持不变)
            copyComputedStyles(originalContainer, clonedContainer, `container-${index}`);
            clonedContainer.style.width = `${originalContainer.offsetWidth}px`;
            clonedContainer.style.height = `${originalContainer.offsetHeight}px`;
            
            // --- 核心逻辑变更：不再清空和重新克隆 ---
            // clonedContainer.innerHTML = ''; // <-- 移除这一行

            // 2. 遍历 *原始容器* 的直接子元素
            Array.from(originalContainer.children).forEach((originalChild) => {
                if (!(originalChild instanceof HTMLElement)) return;

                // 3. 在 *克隆容器* 中找到对应的子元素
                // 注意：这是一个简化的匹配，假设顺序和标签类型一致。
                // 在SillyTavern的结构中，这通常是可靠的。
                const correspondingClonedChild = Array.from(clonedContainer.children).find(
                    cloneChild => cloneChild.className === originalChild.className && !cloneChild.dataset.styled
                );

                if (correspondingClonedChild) {
                    // --- 新增逻辑：跳过已被移除的元素 ---
                    if (originalChild.matches('.mes_buttons')) {
                        captureLogger.debug(`  > 已跳过 .mes_buttons 元素的样式修复，因为它应已被移除。`);
                        // 标记一下，以防有同class的元素
                        correspondingClonedChild.dataset.styled = 'true';
                        return;
                    }
                    // --- 新增逻辑结束 ---
                    
                    const cloneId = `child-${index}-${uuidv4().substring(0, 8)}`;
                    
                    // 4. 对找到的对应子元素应用样式
                    copyComputedStyles(originalChild, correspondingClonedChild, cloneId);
                    correspondingClonedChild.style.width = `${originalChild.offsetWidth}px`;
                    correspondingClonedChild.style.height = `${originalChild.offsetHeight}px`;

                    // 标记为已处理，防止在循环中被重复匹配
                    correspondingClonedChild.dataset.styled = 'true';

                    captureLogger.debug(`  > 已修复现有子元素: ${correspondingClonedChild.className}`);
                } else {
                     captureLogger.debug(`  > 在克隆体中未找到对应的子元素: ${originalChild.className}`);
                }
            });

            // 清理标记
            clonedContainer.querySelectorAll('[data-styled]').forEach(el => el.removeAttribute('data-styled'));

            captureLogger.success(`[布局修复] 已成功修复容器 "${selector}" 及其子元素的布局。`);
        });
    });
}


function prepareSingleElementForHtml2CanvasPro(originalElement) {
    if (!originalElement) return null;

    const element = originalElement.cloneNode(true);
    
    const computedStyle = window.getComputedStyle(originalElement);
    const importantStyles = [
        'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'display', 'position', 'top', 'right', 'bottom', 'left',
        'font-family', 'font-size', 'font-weight', 'line-height',
        'color', 'background-color', 'border', 'border-radius',
        'text-align', 'vertical-align', 'white-space', 'overflow', 'visibility'
    ];
    
    importantStyles.forEach(style => {
        element.style[style] = computedStyle[style];
    });
    
    element.querySelectorAll('.mes_buttons').forEach(buttonsArea => {
        buttonsArea?.parentNode?.removeChild(buttonsArea);
    });
	
    /*
    ['mesIDDisplay', 'mes_timer', 'tokenCounterDisplay'].forEach(selector => {
        element.querySelectorAll(`.${selector}`).forEach(el => {
            el?.parentNode?.removeChild(el);
        });
    });
	*/

    element.querySelectorAll('script, style, noscript, canvas').forEach(el => el.remove());
    
    element.querySelectorAll('.mes_reasoning, .mes_reasoning_delete, .mes_reasoning_edit_cancel').forEach(el => {
        if (el?.style) {
            el.style.removeProperty('color');
            el.style.removeProperty('background-color');
            el.style.removeProperty('border-color');
        }
    });


	// 简化版的details元素处理函数（只同步状态）
	function handleDetailsElements(origNode, cloneNode) {
		if (!origNode || !cloneNode) return;
		
		// 递归处理子元素
		const origChildren = Array.from(origNode.children);
		const cloneChildren = Array.from(cloneNode.children);
		const minLength = Math.min(origChildren.length, cloneChildren.length);
		for (let i = 0; i < minLength; i++) {
			handleDetailsElements(origChildren[i], cloneChildren[i]);
		}

		// 只处理当前节点是否是details元素
		if (origNode.tagName === 'DETAILS') {
			console.log(`[FIX] 处理details元素，原始折叠状态:`, origNode.open);
			
			// 设置克隆元素的open状态与原始元素一致
			if (origNode.open) {
				cloneNode.setAttribute('open', '');
			} else {
				cloneNode.removeAttribute('open');
				
				// 如果是折叠状态，则移除summary之外的所有子节点
				const nodesToRemove = [];
				Array.from(cloneNode.childNodes).forEach(child => {
					if (!(child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SUMMARY')) {
						nodesToRemove.push(child);
					}
				});
				nodesToRemove.forEach(node => cloneNode.removeChild(node));
			}
		}
	}

    
    // 调用增强的details处理函数
    handleDetailsElements(originalElement, element);
    
    element.style.display = 'block';
    element.style.visibility = 'visible';
    element.style.opacity = '1';
    element.style.width = originalElement.offsetWidth + 'px';
    element.style.height = 'auto';
    element.style.overflow = 'visible';
	
    return element;
}


async function handleIframesAsync(clonedElement, originalDocument) {
    const iframes = clonedElement.querySelectorAll('iframe');
    if (iframes.length === 0) {
        return;
    }

    const originalIframes = Array.from(originalDocument.querySelectorAll('iframe'));

    const promises = Array.from(iframes).map(async (iframe, index) => {
        const originalIframe = originalIframes[index];
        if (!originalIframe) return;

        try {
            const isSameOrigin = originalIframe.contentWindow && originalIframe.contentWindow.document;

            if (isSameOrigin) {
                console.log(`${PLUGIN_NAME}: Same-origin iframe found, recursively capturing...`, originalIframe.src);
                const iframeDoc = originalIframe.contentWindow.document;
                
                const canvas = await html2canvas(iframeDoc.body, {
                    scale: config.html2canvasOptions.scale,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: window.getComputedStyle(iframeDoc.body).backgroundColor,
                    foreignObjectRendering: false, 
                });
                
                const imgDataUrl = canvas.toDataURL('image/png');
                
                const img = document.createElement('img');
                img.src = imgDataUrl;
                img.style.width = iframe.style.width || `${originalIframe.clientWidth}px`;
                img.style.height = iframe.style.height || `${originalIframe.clientHeight}px`;
                img.style.border = 'none';

                if (iframe.parentNode) {
                    iframe.parentNode.replaceChild(img, iframe);
                }
            } else {
                console.warn(`${PLUGIN_NAME}: Cross-origin iframe found, cannot capture. Creating placeholder.`, originalIframe.src);
                const placeholder = document.createElement('div');
                placeholder.style.width = iframe.style.width || `${originalIframe.clientWidth}px`;
                placeholder.style.height = iframe.style.height || `${originalIframe.clientHeight}px`;
                placeholder.style.border = '1px dashed #999';
                placeholder.style.backgroundColor = '#f0f0f0';
                placeholder.style.display = 'flex';
                placeholder.style.alignItems = 'center';
                placeholder.style.justifyContent = 'center';
                placeholder.style.fontSize = '12px';
                placeholder.style.color = '#666';
                placeholder.textContent = '跨源内容无法截取';
                if (iframe.parentNode) {
                    iframe.parentNode.replaceChild(placeholder, iframe);
                }
            }
        } catch (error) {
            console.error(`${PLUGIN_NAME}: Error processing iframe:`, error, originalIframe.src);
             const errorPlaceholder = document.createElement('div');
             errorPlaceholder.style.width = iframe.style.width || `${originalIframe.clientWidth}px`;
             errorPlaceholder.style.height = iframe.style.height || `${originalIframe.clientHeight}px`;
             errorPlaceholder.style.border = '1px dashed red';
             errorPlaceholder.textContent = 'Iframe 渲染错误';
             if (iframe.parentNode) {
                 iframe.parentNode.replaceChild(errorPlaceholder, iframe);
             }
        }
    });

    await Promise.all(promises);
}

// [最终修复版 - 完整无缺]
async function captureElementWithHtml2Canvas(elementToCapture, h2cUserOptions = {}) {
    // 每次截图前清除上一轮日志
    captureLogger.clear();
	captureLogger.info(`[单元素截图] 使用的配置`, { scale: config.html2canvasOptions.scale, format: config.imageFormat });
    captureLogger.info(`[单元素截图] 启动截图流程`, {
        元素: elementToCapture?.tagName,
        类名: elementToCapture?.className,
        ID: elementToCapture?.id,
        DOM路径: getDomPath(elementToCapture)
    });
    
    let overlay = null;
    if (config.debugOverlay) {
        overlay = createOverlay('启动截图流程...');
        document.body.appendChild(overlay);
        captureLogger.debug(`[单元素截图] 已创建调试覆盖层`);
    }
    
    let finalDataUrl = null;
    const tempContainer = document.createElement('div');

    try {
        if (overlay) updateOverlay(overlay, '准备内容和计算尺寸...', 0.05);
        
        const contentWidth = elementToCapture.offsetWidth;
        const contentHeight = elementToCapture.offsetHeight;
        const computedStyle = window.getComputedStyle(elementToCapture);
        
        captureLogger.debug(`[单元素截图] 元素尺寸测量`, {
            宽度: contentWidth,
            高度: contentHeight,
            计算样式: { 可见性: computedStyle.visibility, 显示: computedStyle.display, 定位: computedStyle.position, 溢出: computedStyle.overflow, zIndex: computedStyle.zIndex }
        });
        
        if (contentWidth === 0) {
            captureLogger.critical(`[单元素截图] 无法测量内容宽度，元素可能不可见`, {
                可见性: computedStyle.visibility, 显示: computedStyle.display, 位置: computedStyle.position, 元素HTML: elementToCapture.outerHTML.substring(0, 200) + '...',
                父元素可见性: elementToCapture.parentElement ? window.getComputedStyle(elementToCapture.parentElement).visibility : 'N/A',
                父元素显示: elementToCapture.parentElement ? window.getComputedStyle(elementToCapture.parentElement).display : 'N/A'
            });
            throw new Error("无法测量消息内容宽度，元素可能不可见。");
        }

        const preparedElement = prepareSingleElementForHtml2CanvasPro(elementToCapture);
        if (!preparedElement) {
            captureLogger.critical(`[单元素截图] 元素准备失败，返回null`);
            throw new Error("无法准备截图元素");
        }

        captureLogger.info('[布局修复-根元素] 开始修复根元素Flexbox布局...');
        copyComputedStyles(elementToCapture, preparedElement, 'root-clone');
        preparedElement.style.width = `${contentWidth}px`; 
        captureLogger.success('[布局修复-根元素] 根元素布局已修复。');

        if (overlay) updateOverlay(overlay, '获取并构建背景...', 0.15);
        const background = await getDynamicBackground(elementToCapture);
        captureLogger.debug(`[单元素截图] 背景信息`, {
            背景色: background.color,
            图片信息: background.imageInfo ? { URL: background.imageInfo.url.substring(0, 100) + '...', 宽度: background.imageInfo.originalWidth, 高度: background.imageInfo.originalHeight, 背景大小: background.imageInfo.styles.backgroundSize, 背景重复: background.imageInfo.styles.backgroundRepeat } : '无背景图'
        });
        
        // --- 核心变化 1：将临时容器背景设为透明，为手动合成做准备 ---
        Object.assign(tempContainer.style, {
            position: 'absolute',
            left: '-9999px',
            top: '0px',
            width: `${contentWidth}px`,
            padding: '0', 
            backgroundColor: 'transparent', // **重要**：不再设置背景色和背景图
            overflow: 'visible',
        });
        // 不再执行: if (background.imageInfo) { Object.assign(...) }

        tempContainer.appendChild(preparedElement);
        document.body.appendChild(tempContainer);
        
        captureLogger.debug(`[单元素截图] 临时容器已创建并添加到DOM`, {
            计算宽度: tempContainer.offsetWidth, 计算高度: tempContainer.offsetHeight, 内容HTML长度: tempContainer.innerHTML.length,
        });

        if (tempContainer.innerHTML.length < 10 || !tempContainer.children.length) {
            captureLogger.critical(`[单元素截图] 临时容器似乎是空的或内容异常短`);
        }
        
        // 保持布局修复和iframe处理不变
        try {
            captureLogger.info('[布局修复-后代] 开始修复复杂布局...');
            const selectorsToFix = ['.mesAvatarWrapper', '.ch_name.flex-container.justifySpaceBetween', '.flex-container.alignItemsBaseline'];
            fixComplexLayouts(elementToCapture, preparedElement, selectorsToFix);
            captureLogger.success('[布局修复-后代] 复杂布局修复完成。');
        } catch (error) {
            captureLogger.error('[布局修复-后代] 修复过程中发生错误', error);
        }
        if (overlay) updateOverlay(overlay, '正在处理内联框架(iframe)...', 0.25);
        await handleIframesAsync(tempContainer, elementToCapture.ownerDocument);
        await new Promise(resolve => setTimeout(resolve, Math.max(100, config.screenshotDelay)));
        captureLogger.info(`[单元素截图] 延迟${Math.max(100, config.screenshotDelay)}ms后继续`);

        if (overlay) updateOverlay(overlay, '正在渲染场景(内容层)...', 0.4);
        
        // --- 核心变化 2：准备渲染内容层（透明背景） ---
        const finalOptions = {
            ...config.html2canvasOptions,
            backgroundColor: null, // 强制html2canvas使用透明背景
        };
        
        captureLogger.info(`[单元素截图] 开始调用html2canvas渲染 (透明背景模式)`);
        
        // **渲染内容层画布，保持所有原有选项**
        const contentCanvas = await html2canvas(tempContainer, {
            ...finalOptions,
            ignoreElements: (element) => { // **保留了 ignoreElements**
                const classList = element.classList;
                if (!classList) return false;
                if (classList.contains('swipeRightBlock') || classList.contains('swipe_left') || classList.contains('st-capture-overlay') || element.id === 'top-settings-holder' || element.id === 'form_sheld') {
                    return true;
                }
                return false;
            },
			
            onclone: (documentClone, element) => { // **保留了 onclone**
                captureLogger.debug(`[单元素截图] html2canvas克隆完成回调`, { 克隆元素宽度: element.offsetWidth, 克隆元素高度: element.offsetHeight });
                captureLogger.debug(`[h2c onclone] 开始强制移除 <summary> 的列表标记...`);
                try {
                    const clonedSummaries = Array.from(documentClone.querySelectorAll('summary'));
                    clonedSummaries.forEach((cloneSummary, index) => {
                        cloneSummary.style.setProperty('list-style', 'none', 'important');
                        // 保留原始的详细日志记录
                        captureLogger.success(`[h2c onclone] 已为第 ${index + 1} 个 <summary> 移除列表标记。`);
                    });
                } catch(e) {
                    captureLogger.error(`[h2c onclone] 移除 <summary> 标记时发生错误`, e);
                }
                return element;
            },
        });
        
        captureLogger.info(`[单元素截图] 内容层渲染完成`, { canvas宽: contentCanvas.width, canvas高: contentCanvas.height });
        if (contentCanvas.width === 0 || contentCanvas.height === 0) {
            captureLogger.critical(`[单元素截图] 生成的Canvas尺寸为0！截图将是空白的`);
        }
        
        // --- 核心变化 3：手动合成最终图像 ---
        if (overlay) updateOverlay(overlay, '手动合成最终图像...', 0.9);

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = contentCanvas.width;
        finalCanvas.height = contentCanvas.height;
        const ctx = finalCanvas.getContext('2d');
        
        // 步骤 A: 填充纯色背景
        ctx.fillStyle = background.color;
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

        // 步骤 B: 绘制平铺背景图 (已修复错误处理)
        if (background.imageInfo) {
            try {
                const bgImage = new Image();
                bgImage.crossOrigin = 'anonymous';

                const imageLoaded = await new Promise((resolve) => {
                    bgImage.onload = () => resolve(true); // 加载成功，返回 true
                    bgImage.onerror = (err) => {
                        // 在日志中记录具体错误，但不再中断流程
                        captureLogger.warn('[背景合成] 背景图加载失败，将跳过绘制', { url: background.imageInfo.url, error: err });
                        resolve(false); // 加载失败，返回 false
                    };
                    bgImage.src = background.imageInfo.url;
                });

                // 仅当图片成功加载后才进行绘制
                if (imageLoaded) {
                    captureLogger.debug('[背景合成] 背景图加载成功，开始绘制');
                    const pattern = ctx.createPattern(bgImage, 'repeat-y');
                    ctx.fillStyle = pattern;
                    const scale = finalOptions.scale || 1;
                    const elementRect = elementToCapture.getBoundingClientRect();
                    const bgContextElement = document.querySelector('#bg1, #bg2') || document.querySelector(config.chatContentSelector);
                    const bgRect = bgContextElement.getBoundingClientRect();
                    const offsetX = (elementRect.left - bgRect.left) * scale;
                    const offsetY = (elementRect.top - bgRect.top) * scale;
                    ctx.save();
                    ctx.translate(-offsetX, -offsetY);
                    ctx.fillRect(offsetX, offsetY, finalCanvas.width, finalCanvas.height);
                    ctx.restore();
                }

            } catch (e) {
                // 添加一个额外的安全网，以防绘制过程中出现其他异常
                captureLogger.error('[背景合成] 绘制背景图时发生意外错误', e);
            }
        }

        // 步骤 C: 将内容层绘制到背景之上
        ctx.drawImage(contentCanvas, 0, 0);

        if (overlay) updateOverlay(overlay, '生成最终图像数据...', 0.9);
        const startTime = performance.now();
        if (config.imageFormat === 'jpg') {
            finalDataUrl = finalCanvas.toDataURL('image/jpeg', 0.9);
        } else {
            finalDataUrl = finalCanvas.toDataURL('image/png');
        }
        const endTime = performance.now();

        // **保留了所有详细的 DataURL 日志记录**
        if (finalDataUrl) {
            const dataUrlLength = finalDataUrl.length;
            captureLogger.debug(`[单元素截图] 数据URL生成完成`, {
                格式: config.imageFormat, 生成耗时: `${(endTime - startTime).toFixed(2)}ms`, URL长度: dataUrlLength,
                URL前缀: finalDataUrl.substring(0, 50) + '...', URL结尾: '...' + finalDataUrl.substring(finalDataUrl.length - 20)
            });
            if (dataUrlLength < 1000) {
                captureLogger.critical(`[单元素截图] 生成的数据URL异常短 (${dataUrlLength}字节)，可能是空白或黑屏图像`);
            } else {
                captureLogger.success(`[单元素截图] 成功生成图像数据URL (${dataUrlLength}字节)`);
            }
        }

    } catch (error) {
        captureLogger.error(`[单元素截图] 截图流程失败:`, error.stack || error.message || error);
        if (overlay) updateOverlay(overlay, `渲染错误: ${error.message?.substring(0, 60)}...`, 0);
        throw error;
    } finally {
        // **保留了完整的 finally 清理逻辑**
        if (tempContainer.parentElement) {
            tempContainer.parentElement.removeChild(tempContainer);
            captureLogger.debug(`[单元素截图] 临时容器已从DOM移除`);
            const pseudoStyleTag = document.getElementById('h2c-pseudo-styles');
            if (pseudoStyleTag) {
                pseudoStyleTag.remove();
                captureLogger.debug(`[单元素截图] 伪元素样式表已清理`);
            }
        }
        if (overlay?.parentElement) {
            const delay = finalDataUrl ? 1200 : 3000;
            const message = finalDataUrl ? '截图完成!' : '截图失败!';
            updateOverlay(overlay, message, finalDataUrl ? 1 : 0);
            setTimeout(() => { if (overlay.parentElement) overlay.parentElement.removeChild(overlay) }, delay);
        }
    }
    
    if (!finalDataUrl) {
        captureLogger.critical(`[单元素截图] 截图流程未能生成最终图像数据`);
        throw new Error("截图流程未能生成最终图像数据。");
    }
    return finalDataUrl;
}


// ### FIX 3 of 3: Removed container padding for multi-message captures as well. ###
async function captureMultipleMessagesWithHtml2Canvas(messagesToCapture, actionHint, h2cUserOptions = {}) {
    // 每次多消息截图前清除上一轮日志
    captureLogger.clear();
    if (!messagesToCapture || messagesToCapture.length === 0) {
        throw new Error("没有提供消息给 captureMultipleMessagesWithHtml2Canvas");
    }
    console.log(`[captureMultipleMessagesWithHtml2Canvas-pro] Capturing ${messagesToCapture.length} messages. Hint: ${actionHint}`);

    const overlay = createOverlay(`组合 ${messagesToCapture.length} 条消息...`);
    document.body.appendChild(overlay);

    let dataUrl = null;
    const tempContainer = document.createElement('div');

    try {
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        tempContainer.style.padding = '0';
        tempContainer.style.overflow = 'visible';

        const firstMessage = messagesToCapture[0];
        const containerWidth = firstMessage.offsetWidth;
        tempContainer.style.width = containerWidth + 'px';
        
        updateOverlay(overlay, `正在准备背景...`, 0.02);
        const background = await getDynamicBackground(firstMessage);
        tempContainer.style.backgroundColor = background.color;
        if (background.imageInfo) {
            Object.assign(tempContainer.style, background.imageInfo.styles);
        }

        updateOverlay(overlay, `准备 ${messagesToCapture.length} 条消息...`, 0.05);
        
        const preparedClones = [];
        messagesToCapture.forEach((msg, index) => {
            try {
                const preparedClone = prepareSingleElementForHtml2CanvasPro(msg);
                if (preparedClone) {
                    
                    // =================================================================
                    // ✨✨✨ 【决定性修复 - 多消息】 ✨✨✨
                    // 对每一条被克隆的消息都执行同样的操作，确保它们各自的 Flexbox 布局正确。
                    copyComputedStyles(msg, preparedClone, `multi-clone-${index}`);
                    preparedClone.style.width = `${containerWidth}px`; // 统一所有消息宽度
                    // =================================================================

                    tempContainer.appendChild(preparedClone);
                    preparedClones.push(preparedClone); // 保存起来供后续使用
                } else {
                     console.warn("Skipping null prepared clone for message:", msg);
                }
            } catch (e) {
                console.error("Error preparing message for multi-capture:", msg, e);
            }
        });
        document.body.appendChild(tempContainer);
		
        try {
            const selectorsToFix = [
                '.mesAvatarWrapper', 
                '.ch_name.flex-container.justifySpaceBetween',
                '.flex-container.alignItemsBaseline'
            ];

            messagesToCapture.forEach((originalMsg, index) => {
                const clonedMsg = preparedClones[index]; // 使用我们保存的克隆体
                if (originalMsg && clonedMsg) {
                    // 对每条消息的后代元素进行修复
                    fixComplexLayouts(originalMsg, clonedMsg, selectorsToFix);
                }
            });
            captureLogger.success('[布局修复-多消息-后代] 修复完成。');
        } catch(error) {
            captureLogger.error('[布局修复-多消息-后代] 修复过程中发生错误', error);
        }
        
        if (overlay) updateOverlay(overlay, '正在处理所有内联框架(iframe)...', 0.15);
        await handleIframesAsync(tempContainer, firstMessage.ownerDocument);
        
        await new Promise(resolve => setTimeout(resolve, config.screenshotDelay));

        updateOverlay(overlay, '正在渲染…', 0.3);

        const finalH2cOptions = {...config.html2canvasOptions, ...h2cUserOptions};
        
        const canvas = await html2canvas(tempContainer, {
            ...finalH2cOptions,
            ignoreElements: (element) => {
                const classList = element.classList;
                return classList && (
                    classList.contains('swipeRightBlock') || 
                    classList.contains('swipe_left') ||
                    classList.contains('st-capture-overlay') ||
                    element.id === 'top-settings-holder' ||
                    element.id === 'form_sheld'
                );
            },
            onclone: (documentClone, element) => {
                captureLogger.debug(`[h2c onclone - multi] 开始强制移除 <summary> 的列表标记...`);
                try {
                    const clonedSummaries = Array.from(documentClone.querySelectorAll('summary'));
                    clonedSummaries.forEach((cloneSummary, index) => {
                        cloneSummary.style.setProperty('list-style', 'none', 'important');
                    });
                    captureLogger.success(`[h2c onclone - multi] 已成功为 ${clonedSummaries.length} 个 <summary> 移除列表标记。`);
                } catch(e) {
                    captureLogger.error(`[h2c onclone - multi] 移除 <summary> 标记时发生错误`, e);
                }
                return element;
            }
        });
		
        updateOverlay(overlay, '生成图像数据...', 0.9);
        if (config.imageFormat === 'jpg') {
            dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        } else {
            dataUrl = canvas.toDataURL('image/png');
        }

    } catch (error) {
        console.error('html2canvas-pro 多消息截图失败:', error.stack || error);
         if (overlay && document.body.contains(overlay)) {
             const errorMsg = error && error.message ? error.message : "未知渲染错误";
             updateOverlay(overlay, `多消息渲染错误: ${errorMsg.substring(0,50)}...`, 0);
        }
        throw error;
    } finally {
        if (tempContainer?.parentElement) {
            document.body.removeChild(tempContainer);
        }
        if (overlay?.parentElement) {
            updateOverlay(overlay, dataUrl ? '截图完成!' : '截图失败!', dataUrl ? 1 : 0);
            setTimeout(() => { if (overlay.parentElement) document.body.removeChild(overlay); }, 1500);
        }
    }
    if (!dataUrl) throw new Error("html2canvas-pro 未能生成多消息图像数据。");
    console.log("DEBUG: html2canvas-pro multiple messages capture successful.");
    return dataUrl;
}

async function captureMessageWithOptions(options) {
    const { target, includeHeader } = options;
    captureLogger.info(`[选择元素] captureMessageWithOptions 开始`, options);

    const chatSelector = config.chatContentSelector;
    if (typeof chatSelector !== 'string' || !chatSelector) {
         const errorMsg = `聊天内容容器选择器无效: '${chatSelector}'`;
         captureLogger.critical(`[选择元素] ${errorMsg}`);
         throw new Error(errorMsg);
    }
    
    const chatContentEl = document.querySelector(chatSelector);
    if (!chatContentEl) {
         const errorMsg = `聊天内容容器 '${chatSelector}' 未找到!`;
         captureLogger.critical(`[选择元素] ${errorMsg}`);
         throw new Error(errorMsg);
    }
    
    captureLogger.debug(`[选择元素] 已找到聊天容器`, {
        选择器: chatSelector,
        容器宽度: chatContentEl.offsetWidth,
        容器高度: chatContentEl.offsetHeight,
        子元素数: chatContentEl.children.length,
        HTML片段: chatContentEl.outerHTML.substring(0, 200) + '...'
    });

    let elementToRender;
    let messagesForMultiCapture = [];

    switch (target) {
        case 'last':
            elementToRender = chatContentEl.querySelector(config.lastMessageSelector);
            captureLogger.debug(`[选择元素] 尝试选择最后一条消息`, {
                选择器: config.lastMessageSelector,
                找到元素: Boolean(elementToRender),
                元素类型: elementToRender?.tagName,
                元素ID: elementToRender?.id,
                元素类名: elementToRender?.className,
                元素尺寸: elementToRender ? `${elementToRender.offsetWidth}x${elementToRender.offsetHeight}` : 'N/A',
                可见性: elementToRender ? window.getComputedStyle(elementToRender).visibility : 'N/A'
            });
            if (!elementToRender) throw new Error('最后一条消息元素未找到');
            break;
        case 'selected':
            elementToRender = chatContentEl.querySelector(`${config.messageSelector}[data-selected="true"]`) || chatContentEl.querySelector(`${config.messageSelector}.selected`);
            if (!elementToRender) throw new Error('没有选中的消息');
            break;
        case 'conversation':
            messagesForMultiCapture = Array.from(chatContentEl.querySelectorAll(config.messageSelector));
            captureLogger.debug(`[选择元素] 尝试选择对话中所有消息`, {
                选择器: config.messageSelector,
                找到消息数: messagesForMultiCapture.length,
                第一条消息类名: messagesForMultiCapture[0]?.className || 'N/A',
                第一条消息尺寸: messagesForMultiCapture[0] ? 
                    `${messagesForMultiCapture[0].offsetWidth}x${messagesForMultiCapture[0].offsetHeight}` : 'N/A'
            });
            if (messagesForMultiCapture.length === 0) throw new Error("对话中没有消息可捕获。");
            captureLogger.info(`[选择元素] 进入多消息截图流程，共 ${messagesForMultiCapture.length} 条消息`);
            return await captureMultipleMessagesWithHtml2Canvas(messagesForMultiCapture, "conversation_all", {});
        default:
            captureLogger.critical(`[选择元素] 未知的截图目标类型: ${target}`);
            throw new Error('未知的截图目标类型');
    }

    if (!elementToRender && messagesForMultiCapture.length === 0) {
         captureLogger.critical(`[选择元素] 目标元素未找到`, {
             target,
             chatSelector,
             lastMessageSelector: config.lastMessageSelector
         });
         throw new Error(`目标元素未找到 (for ${target} within ${chatSelector})`);
    }

    if (elementToRender) {
        let finalElementToCapture = elementToRender;
        if (!includeHeader && target !== 'conversation' && elementToRender.querySelector(config.messageTextSelector)) {
            const textElement = elementToRender.querySelector(config.messageTextSelector);
            if (textElement) {
                finalElementToCapture = textElement;
                captureLogger.debug(`[选择元素] 仅捕获文本元素`, {
                    文本元素类型: textElement.tagName,
                    文本元素类名: textElement.className,
                    文本元素尺寸: `${textElement.offsetWidth}x${textElement.offsetHeight}`,
                    内容样本: textElement.textContent.substring(0, 50) + '...'
                });
            } else {
                captureLogger.warn(`[选择元素] 无法找到文本元素，将捕获完整消息`);
            }
        }
        
        captureLogger.info(`[选择元素] 最终选择的截图元素`, {
            元素类型: finalElementToCapture.tagName,
            元素类名: finalElementToCapture.className,
            元素尺寸: `${finalElementToCapture.offsetWidth}x${finalElementToCapture.offsetHeight}`,
            元素可见性: window.getComputedStyle(finalElementToCapture).visibility,
            元素显示模式: window.getComputedStyle(finalElementToCapture).display,
            样式计算结果: {
                颜色: window.getComputedStyle(finalElementToCapture).color,
                背景色: window.getComputedStyle(finalElementToCapture).backgroundColor,
                定位: window.getComputedStyle(finalElementToCapture).position,
                溢出: window.getComputedStyle(finalElementToCapture).overflow
            }
        });
        
        return await captureElementWithHtml2Canvas(finalElementToCapture, {});
    }
    
    captureLogger.critical(`[选择元素] captureMessageWithOptions 未能处理截图逻辑`);
    throw new Error("captureMessageWithOptions (h2c-pro v5): Unhandled capture scenario.");
}

function installScreenshotButtons() {
    document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());

    const chatSelector = config.chatContentSelector;
    if (typeof chatSelector !== 'string' || !chatSelector) {
         console.error(`${PLUGIN_NAME}: 无法安装按钮，聊天内容容器选择器无效:`, chatSelector);
         return false;
    }
    const chatContentEl = document.querySelector(chatSelector);
    if (chatContentEl) {
        chatContentEl.querySelectorAll(config.messageSelector).forEach(message => addScreenshotButtonToMessage(message));
    } else {
        console.warn(`Chat content ('${chatSelector}') not found for initial button installation.`);
    }


    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches(config.messageSelector)) {
                addScreenshotButtonToMessage(node);
              }
              else if (node.querySelectorAll) {
                node.querySelectorAll(config.messageSelector).forEach(addScreenshotButtonToMessage);
              }
            }
          });
        }
      });
    });

    if (chatContentEl) {
      observer.observe(chatContentEl, { childList: true, subtree: true });
    } else {
      console.warn(`Chat content ('${chatSelector}') not found for MutationObserver.`);
    }
    console.log(`${PLUGIN_NAME}: 截图按钮安装逻辑已执行。`);
    return true;
}

function addScreenshotButtonToMessage(messageElement) {
    if (!messageElement || !messageElement.querySelector || messageElement.querySelector(`.${config.buttonClass}`)) {
      return;
    }

    let buttonsContainer = messageElement.querySelector('.mes_block .ch_name.flex-container.justifySpaceBetween .mes_buttons');
    if (!buttonsContainer) {
      buttonsContainer = messageElement.querySelector('.mes_block .mes_buttons');
      if (!buttonsContainer) {
        return;
      }
    }

    const screenshotButton = document.createElement('div');
    screenshotButton.innerHTML = '<i class="fa-solid fa-camera"></i>';
    screenshotButton.className = `${config.buttonClass} mes_button interactable`; 
    screenshotButton.title = '截图此消息 (长按显示更多选项)';
    screenshotButton.setAttribute('tabindex', '0');
    screenshotButton.style.cursor = 'pointer';

    const contextMenu = document.createElement('div');
    contextMenu.className = 'st-screenshot-context-menu';
    Object.assign(contextMenu.style, { display: 'none', position: 'absolute', zIndex: '10000', background: '#2a2a2a', border: '1px solid #555', borderRadius: '4px', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', padding: '5px 0' });

    const menuOptions = [
      { text: '截取前四条消息', action: 'prev4' },
      { text: '截取前三条消息', action: 'prev3' },
      { text: '截取前两条消息', action: 'prev2' },
      { text: '截取前一条消息', action: 'prev1' },
      { text: '截取后一条消息', action: 'next1' },
      { text: '截取后两条消息', action: 'next2' },
      { text: '截取后三条消息', action: 'next3' },
      { text: '截取后四条消息', action: 'next4' }
    ];

    menuOptions.forEach(option => {
      const menuItem = document.createElement('div');
      menuItem.className = 'st-screenshot-menu-item';
      menuItem.textContent = option.text;
      Object.assign(menuItem.style, { padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background-color 0.2s' });
      menuItem.onmouseover = () => menuItem.style.backgroundColor = '#3a3a3a';
      menuItem.onmouseout = () => menuItem.style.backgroundColor = 'transparent';

      menuItem.onclick = async (e) => {
        e.stopPropagation();
        hideContextMenu();
        await captureMultipleMessagesFromContextMenu(messageElement, option.action);
      };
      contextMenu.appendChild(menuItem);
    });
    document.body.appendChild(contextMenu);

    let pressTimer;
    let isLongPress = false;

    function showContextMenu(x, y) {
      contextMenu.style.display = 'block';
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const menuW = contextMenu.offsetWidth;
      const menuH = contextMenu.offsetHeight;

      if (x + menuW > vpW) x = vpW - menuW - 5;
      if (y + menuH > vpH) y = vpH - menuH - 5;
      if (y < 0) y = 5;


      contextMenu.style.left = `${x}px`;
      contextMenu.style.top = `${y}px`;
       console.log(`DEBUG: Showing context menu at ${x}, ${y}`);
    }

    function hideContextMenu() {
      contextMenu.style.display = 'none';
       console.log('DEBUG: Hiding context menu');
    }

    screenshotButton.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        const rect = screenshotButton.getBoundingClientRect();
        showContextMenu(rect.left, rect.bottom + 5);
      }, 500);
    });

    screenshotButton.addEventListener('mouseup', () => clearTimeout(pressTimer));
    screenshotButton.addEventListener('mouseleave', () => clearTimeout(pressTimer));

    document.addEventListener('click', (e) => {
      if (contextMenu.style.display === 'block' && !contextMenu.contains(e.target) && !screenshotButton.contains(e.target)) {
          hideContextMenu();
      }
    });

    screenshotButton.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    screenshotButton.addEventListener('touchstart', (e) => {
      isLongPress = false;
      pressTimer = setTimeout(() => {
        isLongPress = true;
        const rect = screenshotButton.getBoundingClientRect();
        showContextMenu(rect.left, rect.bottom + 5);
      }, 500);
    });

    screenshotButton.addEventListener('touchend', () => clearTimeout(pressTimer));
    screenshotButton.addEventListener('touchcancel', () => clearTimeout(pressTimer));

    screenshotButton.addEventListener('click', async function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (isLongPress) {
        isLongPress = false;
        return;
      }

      if (this.classList.contains('loading')) return;

      const iconElement = this.querySelector('i');
      const originalIconClass = iconElement ? iconElement.className : '';
      if (iconElement) iconElement.className = `fa-solid fa-spinner fa-spin ${config.buttonClass}-icon-loading`;
      this.classList.add('loading');

      try {
        const dataUrl = await captureElementWithHtml2Canvas(messageElement, {});
        downloadImage(dataUrl, messageElement, 'message');
      } catch (error) {
        console.error('消息截图失败 (h2c-pro button click v5):', error.stack || error);
        alert(`截图失败: ${error.message || '未知错误'}`);
      } finally {
        if (iconElement) iconElement.className = originalIconClass;
        this.classList.remove('loading');
      }
    });

    const extraMesButtons = buttonsContainer.querySelector('.extraMesButtons.visible');
    const editButton = buttonsContainer.querySelector('.mes_button.mes_edit.fa-solid.fa-pencil.interactable');
    
    if (extraMesButtons && editButton) {
      editButton.insertAdjacentElement('beforebegin', screenshotButton);
    } else {
      const existingButton = buttonsContainer.querySelector('.fa-edit, .mes_edit');
      if (existingButton) {
        existingButton.insertAdjacentElement('beforebegin', screenshotButton);
      } else {
        buttonsContainer.appendChild(screenshotButton);
      }
    }
}

async function captureMultipleMessagesFromContextMenu(currentMessageElement, action) {
    console.log(`[多消息截图 ctx menu h2c-pro v5] Action: ${action} from msg:`, currentMessageElement);
    const button = currentMessageElement.querySelector(`.${config.buttonClass}`);
    const iconElement = button ? button.querySelector('i') : null;
    const originalIconClass = iconElement ? iconElement.className : '';

    if (button) button.classList.add('loading');
    if (iconElement) iconElement.className = `fa-solid fa-spinner fa-spin ${config.buttonClass}-icon-loading`;

    try {
        const chatSelector = config.chatContentSelector;
        if (typeof chatSelector !== 'string' || !chatSelector) {
             const errorMsg = `无法进行多消息截图，聊天内容容器选择器无效: '${chatSelector}'`;
             console.error(`${PLUGIN_NAME}:`, errorMsg);
             throw new Error(errorMsg);
        }
        const chatContent = document.querySelector(chatSelector);
        if (!chatContent) {
             const errorMsg = `无法进行多消息截图，聊天内容容器 '${chatSelector}' 未找到!`;
             console.error(`${PLUGIN_NAME}:`, errorMsg);
             throw new Error(errorMsg);
        }


        let allMessages = Array.from(chatContent.querySelectorAll(config.messageSelector));
        let currentIndex = allMessages.indexOf(currentMessageElement);
        if (currentIndex === -1) throw new Error('无法确定当前消息位置');

        let startIndex = currentIndex;
        let endIndex = currentIndex;
        switch (action) {
            case 'prev4': startIndex = Math.max(0, currentIndex - 4); break;
            case 'prev3': startIndex = Math.max(0, currentIndex - 3); break;
            case 'prev2': startIndex = Math.max(0, currentIndex - 2); break;
            case 'prev1': startIndex = Math.max(0, currentIndex - 1); break;
            case 'next1': endIndex = Math.min(allMessages.length - 1, currentIndex + 1); break;
            case 'next2': endIndex = Math.min(allMessages.length - 1, currentIndex + 2); break;
            case 'next3': endIndex = Math.min(allMessages.length - 1, currentIndex + 3); break;
            case 'next4': endIndex = Math.min(allMessages.length - 1, currentIndex + 4); break;
            default: throw new Error(`未知多消息截图动作: ${action}`);
        }

        const targetMessages = allMessages.slice(startIndex, endIndex + 1);
        if (targetMessages.length === 0) throw new Error('无法获取目标消息进行多条截图');

        const dataUrl = await captureMultipleMessagesWithHtml2Canvas(targetMessages, action, {});

        if (dataUrl) {
            const actionTextMap = {
                'prev4':'前四条',
                'prev3':'前三条',
                'prev2':'前两条',
                'prev1':'前一条',
                'next1':'后一条',
                'next2':'后两条',
                'next3':'后三条',
                'next4':'后四条'
            };
            const fileNameHint = `ST消息组_${actionTextMap[action] || action}`;
            downloadImage(dataUrl, currentMessageElement, fileNameHint);
            console.log(`[多消息截图 ctx menu h2c-pro v5] 截图成功 for ${action}`);
        } else {
            throw new Error('多消息截图 html2canvas-pro 生成失败');
        }
    } catch (error) {
        console.error(`[多消息截图 ctx menu h2c-pro v5] 失败 (${action}):`, error.stack || error);
        alert(`截图 (${action}) 失败: ${error.message || '未知错误'}`);
    } finally {
        if (iconElement) iconElement.className = originalIconClass;
        if (button) button.classList.remove('loading');
        console.log(`[多消息截图 ctx menu h2c-pro v5] 完成 (${action})`);
    }
}

// 【最终解决方案 + 增强日志版】替换掉旧的 downloadImage 函数
function downloadImage(dataUrl, messageElement = null, typeHint = 'screenshot') {
    captureLogger.info(`[下载] 准备下载图片: ${typeHint}`);
    
    // --- 日志追踪 1: 确认入口 ---
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        captureLogger.critical(`[下载-追踪] 函数入口验证失败，传入的 dataUrl 无效或格式错误。`, {
            type: typeof dataUrl,
            length: dataUrl?.length || 0,
            prefix: dataUrl?.substring(0, 30) || 'N/A'
        });
        return; // 提前退出
    }
    captureLogger.debug(`[下载-追踪] 函数入口验证通过，dataUrl 长度: ${dataUrl.length}`);
    
    const link = document.createElement('a');
	
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.T-]/g, '').slice(0, 14); // 生成 YYYYMMDDHHMMSS 格式
    const fileExtension = config.imageFormat || 'jpg';
    const filename = `SillyTavern_${timestamp}.${fileExtension}`;
    
    link.download = filename;
    link.href = dataUrl;
    
    // --- 日志追踪 2: 确认文件名和链接属性 ---
    captureLogger.info(`[下载-追踪] 已生成净化后的文件名: "${link.download}"`);
    captureLogger.debug(`[下载-追踪] <a> 链接的 href 属性已设置 (长度: ${link.href.length})`);

    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
        captureLogger.info(`[下载] 图像尺寸: ${img.width}x${img.height}px`, {
            文件名: link.download,
            宽度: img.width,
            高度: img.height,
            数据URL长度: dataUrl.length
        });
        if (img.width === 0 || img.height === 0) {
            captureLogger.critical(`[下载] 生成的图像宽度或高度为0，这是截图黑屏的确认`);
        }
    };
    
    // --- 日志追踪 3: 追踪点击事件 ---
    try {
        // 【健壮性改进】将链接临时添加到DOM中，以实现最大兼容性
        document.body.appendChild(link);
        captureLogger.debug('[下载-追踪] <a> 链接已临时添加到 document.body');

        captureLogger.info('[下载-追踪] 即将执行 link.click()');
        link.click();
        captureLogger.success('[下载-追踪] link.click() 已执行，未抛出即时错误。浏览器现在应该处理下载。');
        
        // 清理
        document.body.removeChild(link);
        captureLogger.debug('[下载-追踪] 临时的 <a> 链接已从 document.body 移除');

    } catch (error) {
        // --- 日志追踪 4: 捕获可能的同步错误 ---
        captureLogger.critical('[下载-追踪] 在尝试触发下载时捕获到异常!', {
            errorMessage: error.message,
            errorStack: error.stack,
            errorName: error.name
        });
        // 确保即使出错也清理
        if (link.parentElement) {
            document.body.removeChild(link);
        }
    }
}

function createOverlay(message) {
    const overlay = document.createElement('div');
    overlay.className = 'st-capture-overlay';
    const statusBox = document.createElement('div');
    statusBox.className = 'st-capture-status';
    const messageP = document.createElement('p');
    messageP.textContent = message;
    statusBox.appendChild(messageP);
    const progressContainer = document.createElement('div');
    progressContainer.className = 'st-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'st-progress-bar';
    progressBar.style.width = '0%';
    progressContainer.appendChild(progressBar);
    statusBox.appendChild(progressContainer);
    overlay.appendChild(statusBox);
    return overlay;
}

function updateOverlay(overlay, message, progressRatio) {
    if (!overlay || !overlay.parentNode) return;
    const messageP = overlay.querySelector('.st-capture-status p');
    const progressBar = overlay.querySelector('.st-progress-bar');
    if (messageP) messageP.textContent = message;
    const safeProgress = Math.max(0, Math.min(1, progressRatio));
    if (progressBar) progressBar.style.width = `${Math.round(safeProgress * 100)}%`;
}

function showSettingsPopup() {
    // 清除旧弹窗
    document.getElementById('html2canvas-shadow-root')?.remove();

    // 创建宿主
    const host = document.createElement('div');
    host.id = 'html2canvas-shadow-root';
    document.body.appendChild(host);

    // 创建 shadow root
    const shadow = host.attachShadow({mode: 'open'});

    // 插入样式和HTML
    shadow.innerHTML = `
        <style>
            .popup {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: #2a2a2a;
                color: #fff;
                border-radius: 8px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                width: 90vw;
                max-width: 400px;
                max-height: 90vh;
                overflow-y: auto;
                z-index: 99999;
                padding: 20px;
                font-size: 16px;
            }
            .popup h3 { margin-top: 0; }
            .popup label { display: block; margin: 10px 0 5px; }
            .popup input, .popup select { width: 100%; margin-bottom: 10px; }
            .popup .footer { text-align: center; margin-top: 20px; }
            .popup button { padding: 8px 16px; background: #4dabf7; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
        </style>
        <div class="popup">
            <h3>截图设置</h3>
            <label>截图前延迟 (ms):<input type="number" id="st_h2c_screenshotDelay" min="0" max="2000" step="50"></label>
            <label>UI更新等待 (ms):<input type="number" id="st_h2c_scrollDelay" min="0" max="2000" step="50"></label>
            <label>渲染比例 (Scale):<input type="number" id="st_h2c_screenshotScale" min="0.5" max="4.0" step="0.1"></label>
            <label>图片格式:
                <select id="st_h2c_imageFormat">
                    <option value="jpg">JPG</option>
                    <option value="png">PNG</option>
                </select>
            </label>
            <div class="footer">
                <button id="saveBtn">保存设置</button>
                <button id="closeBtn" style="background:#888;margin-left:10px;">关闭</button>
            </div>
        </div>
    `;

    // 绑定事件
    shadow.getElementById('closeBtn').onclick = () => host.remove();
    shadow.getElementById('saveBtn').onclick = () => {
        // 保存逻辑...
        host.remove();
    };
}


// 新增缺失的 showCaptureLogsPopup 函数，采用更健壮的布局模式
function showCaptureLogsPopup() {
    // --- 1. 创建遮罩层 (Overlay) ---
    const overlay = document.createElement('div');
    overlay.className = 'st-logs-overlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: '10000',
        display: 'flex',
        justifyContent: 'center',
        // --- 核心变更：借鉴 autoscroll 脚本的成功模式 ---
        alignItems: 'flex-start', // 1. 改为顶部对齐，避免垂直居中计算问题
        padding: '10vh 15px 15px 15px', // 2. 使用 padding 将弹窗从顶部推下来，并提供左右边距
        boxSizing: 'border-box', // 确保 padding 不会影响整体尺寸
    });

    // --- 2. 创建弹窗面板 (Popup) ---
    const popup = document.createElement('div');
    Object.assign(popup.style, {
        backgroundColor: '#2a2a2a',
        color: '#ffffff',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        // --- 核心变更：定义明确且独立的尺寸 ---
        width: '100%', // 宽度占满带 padding 的父容器
        maxWidth: '900px', // 在大屏幕上限制最大宽度，使其不会过宽
        maxHeight: '80vh', // 3. 使用 vh 单位，独立于父元素计算，非常稳定
        boxSizing: 'border-box',
    });

    // --- 3. 弹窗内部结构 (使用Flexbox管理) ---

    // 标题 (保持不变，但在flex布局下表现更好)
    const title = document.createElement('h3');
    title.textContent = `${PLUGIN_NAME} 日志`;
    title.style.cssText = 'margin-top: 0; flex-shrink: 0;';
    popup.appendChild(title);

    // 筛选器 (保持不变)
    const filterDiv = document.createElement('div');
    filterDiv.style.cssText = 'margin-bottom: 10px; flex-shrink: 0;';
    filterDiv.innerHTML = `
        筛选: 
        <select id="log-level-filter" style="margin-left: 5px;">
            <option value="all">所有级别</option><option value="info">信息</option><option value="debug">调试</option>
            <option value="warn">警告</option><option value="error">错误</option><option value="critical">严重错误</option>
            <option value="success">成功</option>
        </select>
        <input type="text" id="log-search-input" placeholder="搜索日志..." style="margin-left: 10px;">
    `;
    popup.appendChild(filterDiv);
    
    // 日志容器 (进行优化以适应flex布局)
    const logsContainer = document.createElement('div');
    logsContainer.style.overflowY = 'auto'; // 日志内容自身滚动
    logsContainer.style.flexGrow = '1';     // 占据所有剩余的垂直空间
    logsContainer.style.minHeight = '0';    // flex布局中的重要技巧，防止内容溢出
    popup.appendChild(logsContainer);
    
    // 底部按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'margin-top: 15px; text-align: right; flex-shrink: 0;';
    popup.appendChild(buttonContainer);

    // 渲染日志内容 (逻辑不变)
    const groupedLogs = {};
    captureLogger.logs.forEach(entry => {
        const match = entry.message.match(/^\[(.*?)\]/);
        const group = match ? match[1] : '其他';
        if (!groupedLogs[group]) groupedLogs[group] = [];
        groupedLogs[group].push(entry);
    });
    
    Object.keys(groupedLogs).forEach(group => {
        const groupDiv = document.createElement('details');
        groupDiv.open = true;
        const summary = document.createElement('summary');
        summary.textContent = `${group} (${groupedLogs[group].length}条日志)`;
        summary.style.cssText = 'font-weight: bold; cursor: pointer;';
        groupDiv.appendChild(summary);
        groupedLogs[group].forEach(entry => {
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry log-${entry.level}`;
            logEntry.dataset.level = entry.level;
            logEntry.dataset.text = entry.message.toLowerCase();
            const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
            logEntry.innerHTML = `<span class="log-time" style="color:#888;">${time}</span> <span class="log-level ${entry.level}" style="font-weight:bold;">[${entry.level}]</span> ${entry.message.replace(/</g, '<').replace(/>/g, '>')}`;
            if (entry.data) {
                const detailsBtn = document.createElement('button');
                detailsBtn.textContent = '查看详情';
                detailsBtn.style.cssText = 'margin-left: 10px; font-size: small; padding: 2px 5px;';
                const dataDiv = document.createElement('pre');
                dataDiv.textContent = JSON.stringify(entry.data, null, 2);
                dataDiv.style.cssText = 'display: none; background-color: #1e1e1e; padding: 8px; margin-top: 5px; border-radius: 4px; max-height: 200px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;';
                detailsBtn.onclick = () => {
                    const isHidden = dataDiv.style.display === 'none';
                    dataDiv.style.display = isHidden ? 'block' : 'none';
                    detailsBtn.textContent = isHidden ? '隐藏详情' : '查看详情';
                };
                logEntry.appendChild(detailsBtn);
                logEntry.appendChild(dataDiv);
            }
            groupDiv.appendChild(logEntry);
        });
        logsContainer.appendChild(groupDiv);
    });

    // 绑定筛选事件
    const levelFilter = popup.querySelector('#log-level-filter');
    const searchInput = popup.querySelector('#log-search-input');
    const filterLogs = () => {
        const level = levelFilter.value;
        const searchText = searchInput.value.toLowerCase();
        logsContainer.querySelectorAll('.log-entry').forEach(entry => {
            const matchesLevel = level === 'all' || entry.dataset.level === level;
            const matchesSearch = !searchText || entry.dataset.text.includes(searchText);
            entry.style.display = matchesLevel && matchesSearch ? 'block' : 'none';
        });
    };
    levelFilter.addEventListener('change', filterLogs);
    searchInput.addEventListener('input', filterLogs);

    // 添加按钮
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '下载日志';
    downloadBtn.style.cssText = 'padding: 8px 12px; cursor: pointer;';
    downloadBtn.onclick = () => {
        const logs = captureLogger.logs;
        const jsonData = JSON.stringify(logs, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `html2canvas-pro-logs-${new Date().toISOString().replace(/[:.TZ]/g, '-')}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }; 
    buttonContainer.appendChild(downloadBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'margin-left: 10px; padding: 8px 12px; cursor: pointer;';
    closeBtn.onclick = () => document.body.removeChild(overlay);
    buttonContainer.appendChild(closeBtn);
    
    // --- 4. 插入到页面 ---
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // 点击遮罩层关闭弹窗
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
}

// 在适当的地方添加这个函数
function showSettingsUsingPopup() {
    // 使用SillyTavern的内置弹窗系统
    if (typeof callPopup === 'function') {
        const settings = getPluginSettings();
        const popupContent = `
            <div id="html2canvas_settings_popup" style="padding: 10px;">
                <h3>截图设置</h3>
                <!-- 设置项 -->
                <div class="flex-container flexGap5">
                    <label for="st_h2c_screenshotDelay">截图前延迟 (ms):</label>
                    <input type="number" id="st_h2c_screenshotDelay" min="0" max="2000" step="50" value="${settings.screenshotDelay}">
                </div>
                <!-- 其他设置项 -->
                <!-- ... -->
            </div>
        `;
        
        callPopup(popupContent, 'html2canvas-settings');
        
        // 绑定保存事件
        $('#save_html2canvas_settings').on('click', function() {
            // 保存设置逻辑
        });
    } else {
        console.error('SillyTavern callPopup 函数不可用，无法显示设置面板');
        // 回退到原来的方法
        showSettingsPopup();
    }
}

// 新增辅助函数：获取元素的DOM路径
function getDomPath(element) {
    if (!element) return "未知元素";
    
    let path = [];
    let currentElement = element;
    
    while (currentElement) {
        let selector = currentElement.tagName.toLowerCase();
        
        if (currentElement.id) {
            selector += `#${currentElement.id}`;
            path.unshift(selector);
            break; // ID是唯一的，找到ID后就不需要继续向上遍历
        } else {
            let siblingCount = 0;
            let sibling = currentElement;
            
            while (sibling.previousElementSibling) {
                sibling = sibling.previousElementSibling;
                if (sibling.tagName === currentElement.tagName) {
                    siblingCount++;
                }
            }
            
            if (siblingCount > 0) {
                selector += `:nth-of-type(${siblingCount + 1})`;
            }
            
            if (currentElement.className) {
                const classList = currentElement.className.split(/\s+/).filter(c => c);
                if (classList.length > 0) {
                    selector += `.${classList.join('.')}`;
                }
            }
        }
        
        path.unshift(selector);
        
        // 限制路径深度，避免过长
        if (currentElement.parentElement && currentElement.parentElement.id === 'chat') {
            break;
        }
        if (path.length > 8) {
            path.shift(); 
            path.unshift('...');
            break;
        }
        
        currentElement = currentElement.parentElement;
    }
    
    return path.join(' > ');
}
