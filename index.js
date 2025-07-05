// public/extensions/third-party/scane/index.js

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
    screenshotScale: 2.0,      // 降低到 1.0 以提高速度
    useForeignObjectRendering: false,
    letterRendering: true,    // 新增：关闭字形渲染提高文字渲染速度
    imageTimeout: 3000,        // 新增：缩短图像加载超时
    debugOverlay: true,        // 新增：是否显示进度遮罩层
    imageFormat: 'jpg'         // 新增：默认图片格式
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

    // 将所有html2canvas相关设置正确地应用到 html2canvasOptions
    const loadedScale = parseFloat(settings.screenshotScale);
    if (!isNaN(loadedScale) && loadedScale > 0) {
        config.html2canvasOptions.scale = loadedScale;
    } else {
        config.html2canvasOptions.scale = defaultSettings.screenshotScale;
    }

    // 添加调试输出
    console.log('DEBUG: html2canvas配置加载', config.html2canvasOptions);

    // 应用其他html2canvas设置
    config.html2canvasOptions.foreignObjectRendering = settings.useForeignObjectRendering;
    config.html2canvasOptions.letterRendering = settings.letterRendering !== undefined ?
        settings.letterRendering : defaultSettings.letterRendering;
    config.html2canvasOptions.imageTimeout = settings.imageTimeout || defaultSettings.imageTimeout;

    // 加载图片格式设置
    config.imageFormat = settings.imageFormat || defaultSettings.imageFormat;

    console.log(`${PLUGIN_NAME}: 配置已加载并应用:`, config);
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


jQuery(async () => {
    console.log(`${PLUGIN_NAME}: 插件初始化中...`);

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


// ### FIX 1 of 3: Remove the red debug border which adds 1px margin ###
function prepareSingleElementForHtml2CanvasPro(originalElement) {
    captureLogger.info(`[准备元素] 开始准备元素`, {
        元素类型: originalElement?.tagName,
        元素ID: originalElement?.id,
        元素类名: originalElement?.className,
        DOM路径: getDomPath(originalElement),
        内容长度: originalElement?.textContent?.length || 0
    });
    
    if (!originalElement) {
        captureLogger.critical(`[准备元素] 提供的元素为空！这将导致截图失败`);
        return null;
    }

    // 记录元素的计算样式和尺寸详细信息
    const originalComputedStyle = window.getComputedStyle(originalElement);
    captureLogger.debug(`[准备元素] 原始元素详细信息`, {
        标签: originalElement.tagName,
        宽度: originalElement.offsetWidth,
        高度: originalElement.offsetHeight,
        可见性: originalComputedStyle.visibility,
        显示模式: originalComputedStyle.display,
        定位方式: originalComputedStyle.position,
        字体大小: originalComputedStyle.fontSize,
        背景色: originalComputedStyle.backgroundColor,
        前景色: originalComputedStyle.color,
        内边距: `${originalComputedStyle.paddingTop} ${originalComputedStyle.paddingRight} ${originalComputedStyle.paddingBottom} ${originalComputedStyle.paddingLeft}`,
        外边距: `${originalComputedStyle.marginTop} ${originalComputedStyle.marginRight} ${originalComputedStyle.marginBottom} ${originalComputedStyle.marginLeft}`,
        边框: `${originalComputedStyle.borderTopWidth} ${originalComputedStyle.borderRightWidth} ${originalComputedStyle.borderBottomWidth} ${originalComputedStyle.borderLeftWidth}`,
        子元素数: originalElement.children.length,
        HTML长度: originalElement.outerHTML.length,
        HTML前200字符: originalElement.outerHTML.substring(0, 200).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '...'
    });

    const element = originalElement.cloneNode(true);
    
    captureLogger.debug(`[准备元素] 元素已克隆`, {
        克隆后子元素数: element.children.length,
        克隆后HTML长度: element.outerHTML.length
    });
    
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
    
    if (originalElement.offsetWidth <= 0) {
        captureLogger.critical(`[准备元素] 元素宽度为0！截图将失败`, {
            元素: originalElement,
            样式: {
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                opacity: computedStyle.opacity,
                position: computedStyle.position
            }
        });
    }
    
    // 记录移除前的子元素信息
    const preRemovalInfo = {
        按钮区域数: element.querySelectorAll('.mes_buttons').length,
        其他UI元素数: element.querySelectorAll('.mesIDDisplay, .mes_timer, .tokenCounterDisplay').length,
        脚本元素数: element.querySelectorAll('script, style, noscript, canvas').length
    };
    captureLogger.debug(`[准备元素] 移除前子元素情况`, preRemovalInfo);
    
    // 原有代码的按钮和不必要元素移除逻辑...
    element.querySelectorAll('.mes_buttons').forEach(buttonsArea => {
        buttonsArea?.parentNode?.removeChild(buttonsArea);
    });
    
    ['mesIDDisplay', 'mes_timer', 'tokenCounterDisplay'].forEach(selector => {
        element.querySelectorAll(`.${selector}`).forEach(el => {
            el?.parentNode?.removeChild(el);
        });
    });

    element.querySelectorAll('script, style, noscript, canvas').forEach(el => el.remove());
    
    // 处理details元素
    handleDetailsElements(originalElement, element);
    
    element.style.display = 'block';
    element.style.visibility = 'visible';
    element.style.opacity = '1';
    element.style.width = originalElement.offsetWidth + 'px';
    element.style.height = 'auto';
    element.style.overflow = 'visible';
    
    // 处理后的详细信息
    captureLogger.info(`[准备元素] 元素准备完成`, {
        宽度: element.style.width,
        可见性: element.style.visibility,
        透明度: element.style.opacity,
        溢出处理: element.style.overflow,
        显示模式: element.style.display,
        最终子元素数: element.children.length,
        最终HTML长度: element.outerHTML.length
    });
    
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

// ### FIX 2 of 3: Removed container padding and negative offset to perfectly frame the content ###
async function captureElementWithHtml2Canvas(elementToCapture, h2cUserOptions = {}) {
    // 每次截图前清除上一轮日志
    captureLogger.clear();
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
            计算样式: {
                可见性: computedStyle.visibility,
                显示: computedStyle.display,
                定位: computedStyle.position,
                溢出: computedStyle.overflow,
                zIndex: computedStyle.zIndex
            }
        });
        
        if (contentWidth === 0) {
            captureLogger.critical(`[单元素截图] 无法测量内容宽度，元素可能不可见`, {
                可见性: computedStyle.visibility,
                显示: computedStyle.display,
                位置: computedStyle.position,
                元素HTML: elementToCapture.outerHTML.substring(0, 200) + '...',
                父元素可见性: elementToCapture.parentElement ? 
                    window.getComputedStyle(elementToCapture.parentElement).visibility : 'N/A',
                父元素显示: elementToCapture.parentElement ? 
                    window.getComputedStyle(elementToCapture.parentElement).display : 'N/A'
            });
            throw new Error("无法测量消息内容宽度，元素可能不可见。");
        }

        const preparedElement = prepareSingleElementForHtml2CanvasPro(elementToCapture);
        if (!preparedElement) {
            captureLogger.critical(`[单元素截图] 元素准备失败，返回null`);
            throw new Error("无法准备截图元素");
        }

        if (overlay) updateOverlay(overlay, '获取并构建背景...', 0.15);
        const background = await getDynamicBackground(elementToCapture);
        captureLogger.debug(`[单元素截图] 背景信息`, {
            背景色: background.color,
            图片信息: background.imageInfo ? {
                URL: background.imageInfo.url.substring(0, 100) + '...',
                宽度: background.imageInfo.originalWidth,
                高度: background.imageInfo.originalHeight,
                背景大小: background.imageInfo.styles.backgroundSize,
                背景重复: background.imageInfo.styles.backgroundRepeat
            } : '无背景图'
        });

        // 记录tempContainer创建前的状态
        captureLogger.debug(`[单元素截图] 创建临时容器前`, {
            内容宽度: contentWidth,
            预处理元素宽度: preparedElement.style.width,
            预处理元素高度: preparedElement.style.height
        });

        Object.assign(tempContainer.style, {
            position: 'absolute',
            left: '-9999px',
            top: '0px',
            width: `${contentWidth}px`,
            padding: '0', 
            backgroundColor: background.color,
            overflow: 'visible',
        });

        if (background.imageInfo) {
            Object.assign(tempContainer.style, background.imageInfo.styles);
        }
        
        // 记录preparedElement添加到容器前的状态
        captureLogger.debug(`[单元素截图] 添加元素到临时容器前`, {
            tempContainer宽度: tempContainer.style.width,
            tempContainer背景: tempContainer.style.backgroundColor,
            preparedElement子元素数: preparedElement.children.length,
            preparedElement宽度: preparedElement.offsetWidth || preparedElement.style.width
        });

        tempContainer.appendChild(preparedElement);
        document.body.appendChild(tempContainer);
        
        // 记录添加到DOM后的状态
        const tempContainerComputedStyle = window.getComputedStyle(tempContainer);
        captureLogger.debug(`[单元素截图] 临时容器已创建并添加到DOM`, {
            计算宽度: tempContainer.offsetWidth,
            计算高度: tempContainer.offsetHeight,
            样式宽度: tempContainerComputedStyle.width,
            内容HTML长度: tempContainer.innerHTML.length,
            子元素数: tempContainer.children.length,
            子元素宽度: tempContainer.children[0]?.offsetWidth || 0,
            子元素高度: tempContainer.children[0]?.offsetHeight || 0,
            tempContainer位置: `${tempContainer.offsetLeft},${tempContainer.offsetTop}`,
            tempContainer可见性: tempContainerComputedStyle.visibility,
            tempContainer显示模式: tempContainerComputedStyle.display
        });

        // 检查临时容器是否真正包含了内容
        if (tempContainer.innerHTML.length < 10 || !tempContainer.children.length) {
            captureLogger.critical(`[单元素截图] 临时容器似乎是空的或内容异常短`, {
                innerHTML: tempContainer.innerHTML,
                子元素数: tempContainer.children.length
            });
        }

        if (overlay) updateOverlay(overlay, '正在处理内联框架(iframe)...', 0.25);
        await handleIframesAsync(tempContainer, elementToCapture.ownerDocument);
        
        await new Promise(resolve => setTimeout(resolve, Math.max(100, config.screenshotDelay)));
        captureLogger.info(`[单元素截图] 延迟${Math.max(100, config.screenshotDelay)}ms后继续`);

        if (overlay) updateOverlay(overlay, '正在渲染场景...', 0.4);
        
        // 详细记录html2canvas配置
        const finalOptions = {
            ...config.html2canvasOptions,
            backgroundColor: null,
            // 其他配置
        };
        
        captureLogger.info(`[单元素截图] 开始调用html2canvas渲染`, {
            容器尺寸: `${tempContainer.offsetWidth}x${tempContainer.offsetHeight}px`,
            容器位置: `${tempContainer.offsetLeft},${tempContainer.offsetTop}`,
            选项: finalOptions,
            scale: finalOptions.scale || 1,
            可见性: window.getComputedStyle(tempContainer).visibility,
            父元素可见性: tempContainer.parentElement ? 
                window.getComputedStyle(tempContainer.parentElement).visibility : 'N/A'
        });
        
        // 如果是调试模式，临时让容器可见
        if (config.debugOverlay) {
            const originalPosition = tempContainer.style.position;
            const originalLeft = tempContainer.style.left;
            
            // 临时将容器放在可见位置用于调试
            captureLogger.debug(`[单元素截图] 调试模式：临时使容器可见`);
            tempContainer.style.position = 'fixed';
            tempContainer.style.left = '10px';
            tempContainer.style.top = '50px';
            tempContainer.style.zIndex = '10001';
            tempContainer.style.border = '2px solid red';
            
            // 短暂延迟以便观察
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 恢复原始位置进行实际渲染
            tempContainer.style.position = originalPosition;
            tempContainer.style.left = originalLeft;
            captureLogger.debug(`[单元素截图] 调试模式：恢复容器原始位置`);
        }

        const finalCanvas = await html2canvas(tempContainer, {
            ...finalOptions,
            ignoreElements: (element) => {
                const classList = element.classList;
                if (!classList) return false;
                if (classList.contains('swipeRightBlock') || 
                    classList.contains('swipe_left') ||
                    classList.contains('st-capture-overlay') ||
                    element.id === 'top-settings-holder' ||
                    element.id === 'form_sheld') {
                    return true;
                }
                return false;
            },
            onclone: (documentClone, element) => {
                captureLogger.debug(`[单元素截图] html2canvas克隆完成回调`, {
                    克隆元素宽度: element.offsetWidth,
                    克隆元素高度: element.offsetHeight,
                    克隆元素类名: element.className,
                    克隆元素可见性: window.getComputedStyle(element).visibility
                });
                
                // 详细记录克隆后的DOM状态
                const clonedElementInfo = {
                    标签名: element.tagName,
                    类名: element.className,
                    ID: element.id,
                    宽度: element.offsetWidth,
                    高度: element.offsetHeight,
                    子元素数: element.children.length,
                    HTML长度: element.outerHTML.length,
                    计算样式: {
                        可见性: window.getComputedStyle(element).visibility,
                        显示模式: window.getComputedStyle(element).display,
                        位置: window.getComputedStyle(element).position,
                        背景色: window.getComputedStyle(element).backgroundColor
                    }
                };
                captureLogger.debug(`[单元素截图] html2canvas克隆元素详情`, clonedElementInfo);
                return element;
            }
        });
        
        captureLogger.info(`[单元素截图] html2canvas渲染完成`, {
            canvas宽: finalCanvas.width,
            canvas高: finalCanvas.height,
            canvas类型: finalCanvas.constructor.name
        });
        
        if (finalCanvas.width === 0 || finalCanvas.height === 0) {
            captureLogger.critical(`[单元素截图] 生成的Canvas尺寸为0！截图将是空白的`, {
                canvas宽: finalCanvas.width,
                canvas高: finalCanvas.height
            });
        }
        
        if (overlay) updateOverlay(overlay, '生成最终图像...', 0.9);
        // 根据设置选择图片格式
        const startTime = performance.now();
        if (config.imageFormat === 'jpg') {
            finalDataUrl = finalCanvas.toDataURL('image/jpeg', 1.0);
        } else {
            finalDataUrl = finalCanvas.toDataURL('image/png');
        }
        const endTime = performance.now();

        if (finalDataUrl) {
            // 检查dataUrl是否正常
            const dataUrlLength = finalDataUrl.length;
            captureLogger.debug(`[单元素截图] 数据URL生成完成`, {
                格式: config.imageFormat,
                生成耗时: `${(endTime - startTime).toFixed(2)}ms`,
                URL长度: dataUrlLength,
                URL前缀: finalDataUrl.substring(0, 50) + '...',
                URL结尾: '...' + finalDataUrl.substring(finalDataUrl.length - 20)
            });
            
            if (dataUrlLength < 1000) {
                captureLogger.critical(`[单元素截图] 生成的数据URL异常短 (${dataUrlLength}字节)，可能是空白或黑屏图像`, {
                    data_url_前50字符: finalDataUrl.substring(0, 50)
                });
            } else {
                captureLogger.success(`[单元素截图] 成功生成图像数据URL (${dataUrlLength}字节)`);
            }
        }

    } catch (error) {
        captureLogger.error(`[单元素截图] 截图流程失败:`, error.stack || error.message || error);
        if (overlay) updateOverlay(overlay, `渲染错误: ${error.message?.substring(0, 60)}...`, 0);
        throw error;
    } finally {
        if (tempContainer.parentElement) {
            tempContainer.parentElement.removeChild(tempContainer);
            captureLogger.debug(`[单元素截图] 临时容器已从DOM移除`);
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

function syncDetailsState(origNode, cloneNode) {
    if (origNode.tagName === 'DETAILS') {
        cloneNode.open = origNode.open;
    }
    
    const origChildren = origNode.children;
    const cloneChildren = cloneNode.children;
    
    if (origChildren.length === cloneChildren.length) {
        for (let i = 0; i < origChildren.length; i++) {
            syncDetailsState(origChildren[i], cloneChildren[i]);
        }
    }
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
        // ### FIX: Removed padding to eliminate unwanted margins.
        tempContainer.style.padding = '0';
        tempContainer.style.overflow = 'visible';

        const firstMessage = messagesToCapture[0];
        const containerWidth = firstMessage.offsetWidth + 'px';
        tempContainer.style.width = containerWidth;
        
        updateOverlay(overlay, `正在准备背景...`, 0.02);
        const background = await getDynamicBackground(firstMessage);
        tempContainer.style.backgroundColor = background.color;
        if (background.imageInfo) {
            Object.assign(tempContainer.style, background.imageInfo.styles);
        }

        updateOverlay(overlay, `准备 ${messagesToCapture.length} 条消息...`, 0.05);
        messagesToCapture.forEach(msg => {
            try {
                const preparedClone = prepareSingleElementForHtml2CanvasPro(msg);
                if (preparedClone) {
                    tempContainer.appendChild(preparedClone);
                } else {
                     console.warn("Skipping null prepared clone for message:", msg);
                }
            } catch (e) {
                console.error("Error preparing message for multi-capture:", msg, e);
            }
        });
        document.body.appendChild(tempContainer);
        
        if (overlay) updateOverlay(overlay, '正在处理所有内联框架(iframe)...', 0.15);
        await handleIframesAsync(tempContainer, firstMessage.ownerDocument);
        
        await new Promise(resolve => setTimeout(resolve, config.screenshotDelay));

        updateOverlay(overlay, '正在渲染…', 0.3);

        const finalH2cOptions = {...config.html2canvasOptions, ...h2cUserOptions};
        
        finalH2cOptions.ignoreElements = (element) => {
            const classList = element.classList;
            if (!classList) return false;
            
            if (classList.contains('swipeRightBlock') || 
                classList.contains('swipe_left') ||
                classList.contains('st-capture-overlay') ||
                element.id === 'top-settings-holder' ||
                element.id === 'form_sheld') {
                return true;
            }
            
            return false;
        };

        console.log("DEBUG: html2canvas-pro (multiple) options:", finalH2cOptions);
        const canvas = await html2canvas(tempContainer, finalH2cOptions);

        updateOverlay(overlay, '生成图像数据...', 0.8);
        // 根据设置选择图片格式
        if (config.imageFormat === 'jpg') {
            dataUrl = canvas.toDataURL('image/jpeg', 1.0); // JPG格式质量为1.0
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

function downloadImage(dataUrl, messageElement = null, typeHint = 'screenshot') {
    captureLogger.info(`[下载] 准备下载图片: ${typeHint}`);
    
    // 检查dataUrl是否正常
    if (!dataUrl || dataUrl.length < 1000) {
        captureLogger.critical(`[下载] 数据URL异常短或为空 (${dataUrl?.length || 0}字节)，可能是空白或黑屏图像`);
    }
    
    const link = document.createElement('a');
    let filename = `SillyTavern_${typeHint.replace(/[^a-z0-9_-]/gi, '_')}`;

    if (messageElement && typeof messageElement.querySelector === 'function') {
      const nameSelector = config.messageHeaderSelector + ' .name_text';
      const nameFallbackSelector = config.messageHeaderSelector;
      const nameTextElement = messageElement.querySelector(nameSelector) || messageElement.querySelector(nameFallbackSelector);
      let senderName = 'Character';
      if (nameTextElement && nameTextElement.textContent) {
          senderName = nameTextElement.textContent.trim() || 'Character';
      }
      const isUser = messageElement.classList.contains('user_mes') || (messageElement.closest && messageElement.closest('.user_mes'));
      const sender = isUser ? 'User' : senderName;

      const msgIdData = messageElement.getAttribute('mesid') || messageElement.dataset.msgId || messageElement.id;
      const msgId = msgIdData ? msgIdData.slice(-5) : ('m' + Date.now().toString().slice(-8, -4));

      const timestampAttr = messageElement.dataset.timestamp || messageElement.getAttribute('data-timestamp') || new Date().toISOString();
      const timestamp = timestampAttr.replace(/[:\sTZ.]/g, '_').replace(/__+/g, '_');

      const filenameSafeSender = sender.replace(/[^a-z0-9_-]/gi, '_').substring(0, 20);
      filename = `SillyTavern_${filenameSafeSender}_${msgId}_${timestamp}`;
      
      captureLogger.debug(`[下载] 已生成文件名: ${filename}`);
    } else {
      filename += `_${new Date().toISOString().replace(/[:.TZ]/g, '-')}`;
      captureLogger.debug(`[下载] 使用默认文件名: ${filename}`);
    }

    // 根据当前设置选择正确的文件扩展名
    const fileExtension = config.imageFormat || 'jpg';
    link.download = `${filename}.${fileExtension}`;
    link.href = dataUrl;
    
    // 检测图片实际尺寸
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
    
    try {
        link.click();
        captureLogger.success(`[下载] 图像已开始下载: ${link.download}`);
    } catch (error) {
        captureLogger.error(`[下载] 下载图像失败:`, error);
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
    const settings = getPluginSettings();
    
    const overlay = document.createElement('div');
    overlay.className = 'st-settings-overlay';
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
        alignItems: 'flex-start',
        paddingTop: '0', // 不需要额外的顶部内边距
        overflowY: 'auto' // 添加滚动功能以确保在小屏幕上可以访问所有内容
    });

    const popup = document.createElement('div');
    popup.className = 'st-settings-popup';
    Object.assign(popup.style, {
        backgroundColor: '#2a2a2a',
        padding: '20px',
        borderRadius: '10px',
        maxWidth: '400px',
        width: '100%',
        maxHeight: '80vh',
        overflowY: 'auto',
        marginTop: '80px', // 改为固定的 80px 而不是 25vh
        position: 'relative', // 添加相对定位
        top: '0' // 确保从顶部开始
    });

    
    const title = document.createElement('h3');
    title.textContent = '截图设置';
    title.style.marginTop = '0';
    title.style.marginBottom = '15px';
    title.style.textAlign = 'center';
    popup.appendChild(title);
    
    const settingsConfig = [
        { id: 'screenshotDelay', type: 'number', label: '截图前延迟 (ms)', min: 0, max: 2000, step: 50 },
        { id: 'scrollDelay', type: 'number', label: 'UI更新等待 (ms)', min: 0, max: 2000, step: 50 },
        { id: 'screenshotScale', type: 'number', label: '渲染比例 (Scale)', min: 0.5, max: 4.0, step: 0.1 },
        { id: 'useForeignObjectRendering', type: 'checkbox', label: '尝试快速模式 (兼容性低)' },
        { id: 'autoInstallButtons', type: 'checkbox', label: '自动安装消息按钮' },
        { id: 'altButtonLocation', type: 'checkbox', label: '按钮备用位置' },
        { id: 'letterRendering', type: 'checkbox', label: '字形渲染' },
        { id: 'debugOverlay', type: 'checkbox', label: '显示调试覆盖层' },
        { id: 'imageFormat', type: 'select', label: '图片格式', 
          options: [
              { value: 'jpg', label: 'JPG' },
              { value: 'png', label: 'PNG' }
          ]
        },
    ];
    
    settingsConfig.forEach(setting => {
        const settingContainer = document.createElement('div');
        settingContainer.style.margin = '10px 0';
        settingContainer.style.display = 'flex';
        settingContainer.style.justifyContent = 'space-between';
        settingContainer.style.alignItems = 'center';
        
        const label = document.createElement('label');
        label.textContent = setting.label;
        label.style.marginRight = '10px';
        settingContainer.appendChild(label);
        
        let input;
        if (setting.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = `st_setting_${setting.id}`;
            input.checked = settings[setting.id];
        } else if (setting.type === 'number') {
            input = document.createElement('input');
            input.type = 'number';
            input.id = `st_setting_${setting.id}`;
            input.min = setting.min;
            input.max = setting.max;
            input.step = setting.step;
            input.value = settings[setting.id];
            input.style.width = '80px';
        } else if (setting.type === 'select') {
            input = document.createElement('select');
            input.id = `st_setting_${setting.id}`;
            setting.options.forEach(option => {
                const optElement = document.createElement('option');
                optElement.value = option.value;
                optElement.textContent = option.label;
                if (settings[setting.id] === option.value) {
                    optElement.selected = true;
                }
                input.appendChild(optElement);
            });
        }
        
        settingContainer.appendChild(input);
        popup.appendChild(settingContainer);
    });
    
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.marginTop = '20px';
    
    const saveButton = document.createElement('button');
    saveButton.textContent = '保存设置';
    saveButton.style.padding = '8px 16px';
    saveButton.style.borderRadius = '4px';
    saveButton.style.backgroundColor = '#4dabf7';
    saveButton.style.border = 'none';
    saveButton.style.color = 'white';
    saveButton.style.cursor = 'pointer';
    
    saveButton.addEventListener('click', () => {
        const settings = getPluginSettings();
        
        settingsConfig.forEach(setting => {
            const input = document.getElementById(`st_setting_${setting.id}`);
            if (setting.type === 'checkbox') {
                settings[setting.id] = input.checked;
            } else if (setting.type === 'number') {
                settings[setting.id] = parseFloat(input.value);
                if (isNaN(settings[setting.id])) {
                    settings[setting.id] = defaultSettings[setting.id];
                }
            } else if (setting.type === 'select') {
                settings[setting.id] = input.value;
            }
        });
        
        saveSettingsDebounced();
        loadConfig();
        
        // 使用toastr显示成功消息
        toastr.success('设置已保存！');
        
        // 立即关闭UI面板
        if (overlay.parentElement) {
            document.body.removeChild(overlay);
        }
        
        if (settings.autoInstallButtons) {
            document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
            installScreenshotButtons();
        } else {
            document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
        }
    });
    
    buttonContainer.appendChild(saveButton);
    popup.appendChild(buttonContainer);
    
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) document.body.removeChild(overlay);
    });
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
        
        if (path.length > 5) {
            path.shift(); // 限制路径长度
            path.unshift('...');
            break;
        }
        
        currentElement = currentElement.parentElement;
    }
    
    return path.join(' > ');
}

// 新增缺失的 handleDetailsElements 函数，用于处理 <details> 元素状态同步（解决 "handleDetailsElements is not defined" 错误）
function handleDetailsElements(origNode, cloneNode) {
    // 将原始节点中 <details> 的 open 状态同步到克隆节点
    syncDetailsState(origNode, cloneNode);
}

// 新增缺失的 showCaptureLogsPopup 函数，用于弹出截图日志面板（解决 "截图日志" 按钮无响应 问题）
function showCaptureLogsPopup() {
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
        alignItems: 'center'
    });

    const popup = document.createElement('div');
    Object.assign(popup.style, {
        backgroundColor: '#2a2a2a',
        color: '#ffffff',
        padding: '20px',
        borderRadius: '5px',
        maxHeight: '80%',
        overflowY: 'auto',
        width: '80%'
    });

    // 标题
    const title = document.createElement('h3');
    title.textContent = `${PLUGIN_NAME} 日志`;
    title.style.marginTop = '0';
    popup.appendChild(title);

    // 添加操作筛选器
    const filterDiv = document.createElement('div');
    filterDiv.style.marginBottom = '10px';
    
    const levelFilter = document.createElement('select');
    levelFilter.innerHTML = `
        <option value="all">所有级别</option>
        <option value="info">信息</option>
        <option value="debug">调试</option>
        <option value="warn">警告</option>
        <option value="error">错误</option>
        <option value="critical">严重错误</option>
        <option value="success">成功</option>
    `;
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '搜索日志...';
    searchInput.style.marginLeft = '10px';
    
    filterDiv.appendChild(document.createTextNode('筛选: '));
    filterDiv.appendChild(levelFilter);
    filterDiv.appendChild(searchInput);
    popup.appendChild(filterDiv);
    
    // 创建日志容器
    const logsContainer = document.createElement('div');
    logsContainer.style.maxHeight = '500px';
    logsContainer.style.overflowY = 'auto';
    
    // 按操作分组显示日志
    const groupedLogs = {};
    captureLogger.logs.forEach(entry => {
        // 提取操作标识符，例如 [单元素截图], [选择元素] 等
        const match = entry.message.match(/^\[(.*?)\]/);
        const group = match ? match[1] : '其他';
        
        if (!groupedLogs[group]) {
            groupedLogs[group] = [];
        }
        groupedLogs[group].push(entry);
    });
    
    // 为每个操作创建可折叠的日志组
    Object.keys(groupedLogs).forEach(group => {
        const groupDiv = document.createElement('details');
        groupDiv.open = true; // 默认展开
        
        const summary = document.createElement('summary');
        summary.textContent = `${group} (${groupedLogs[group].length}条日志)`;
        summary.style.fontWeight = 'bold';
        summary.style.cursor = 'pointer';
        groupDiv.appendChild(summary);
        
        groupedLogs[group].forEach(entry => {
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry log-${entry.level}`;
            logEntry.dataset.level = entry.level;
            logEntry.dataset.text = entry.message.toLowerCase();
            
            const time = new Date(entry.timestamp).toLocaleTimeString('zh-CN', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3
            });
            
            logEntry.innerHTML = `<span class="log-time">${time}</span> <span class="log-level ${entry.level}">[${entry.level}]</span> ${entry.message}`;
            
            if (entry.data) {
                const detailsBtn = document.createElement('button');
                detailsBtn.textContent = '查看详情';
                detailsBtn.style.marginLeft = '10px';
                detailsBtn.style.fontSize = 'small';
                
                const dataDiv = document.createElement('pre');
                dataDiv.textContent = JSON.stringify(entry.data, null, 2);
                dataDiv.style.display = 'none';
                dataDiv.style.backgroundColor = '#1e1e1e';
                dataDiv.style.padding = '8px';
                dataDiv.style.marginTop = '5px';
                dataDiv.style.borderRadius = '4px';
                dataDiv.style.maxHeight = '200px';
                dataDiv.style.overflowY = 'auto';
                
                detailsBtn.onclick = () => {
                    if (dataDiv.style.display === 'none') {
                        dataDiv.style.display = 'block';
                        detailsBtn.textContent = '隐藏详情';
                    } else {
                        dataDiv.style.display = 'none';
                        detailsBtn.textContent = '查看详情';
                    }
                };
                
                logEntry.appendChild(detailsBtn);
                logEntry.appendChild(dataDiv);
            }
            
            groupDiv.appendChild(logEntry);
        });
        
        logsContainer.appendChild(groupDiv);
    });
    
    popup.appendChild(logsContainer);
    
    // 实现筛选功能
    function filterLogs() {
        const level = levelFilter.value;
        const searchText = searchInput.value.toLowerCase();
        
        document.querySelectorAll('.log-entry').forEach(entry => {
            const matchesLevel = level === 'all' || entry.dataset.level === level;
            const matchesSearch = !searchText || entry.dataset.text.includes(searchText);
            entry.style.display = matchesLevel && matchesSearch ? 'block' : 'none';
        });
    }
    
    levelFilter.addEventListener('change', filterLogs);
    searchInput.addEventListener('input', filterLogs);
    
    // 关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    Object.assign(closeBtn.style, {
        marginTop: '10px',
        padding: '8px 12px',
        cursor: 'pointer'
    });
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });
    popup.appendChild(closeBtn);

    // 下载日志按钮
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = '下载日志';
    Object.assign(downloadBtn.style, {
        marginLeft:'10px',
        padding:   '8px 12px',
        cursor:    'pointer'
    });
    downloadBtn.addEventListener('click', () => {
        const textContent = captureLogger.logs.map(entry => {
            let line = `[${entry.level}] ${entry.message}`;
            if (entry.data) line += '\n' + JSON.stringify(entry.data, null, 2);
            return line;
        }).join('\n\n');
        const blob = new Blob([textContent], { type:'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `${PLUGIN_NAME}_logs_${new Date().toISOString().replace(/[:.]/g,'-')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    });
    popup.appendChild(downloadBtn);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
}

