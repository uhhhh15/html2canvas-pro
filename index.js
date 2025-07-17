import {
    extension_settings,
    renderExtensionTemplateAsync,
} from '../../../extensions.js';
import {
    saveSettingsDebounced,
} from '../../../../script.js';

// --- 插件元数据 ---
const PLUGIN_ID = 'modern-screenshot';
const PLUGIN_NAME = 'Modern Screenshot';

// --- 日志系统 ---
const captureLogger = {
    log: (message, level = 'info', data = null) => {
        const timer = new Date().toLocaleTimeString();
        console[level](`[${timer}][${PLUGIN_NAME}] ${message}`, data || '');
    },
    info: (message, data) => { captureLogger.log(message, 'info', data); },
    warn: (message, data) => { captureLogger.log(message, 'warn', data); },
    error: (message, data) => { captureLogger.log(message, 'error', data); },
};

// --- 默认设置与配置 ---
const defaultSettings = {
    screenshotScale: 1.5,
    imageFormat: 'jpeg',
    imageQuality: 0.92,
    autoInstallButtons: true,
    debugOverlay: false,
};
const config = {
    buttonClass: 'st-screenshot-button',
    chatContentSelector: '#chat',
    messageSelector: '.mes',
};

// --- 性能优化 ---
const OPTIMIZED_STYLE_PROPERTIES = new Set([
    'display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-width', 'border-style', 'border-color', 'border-radius',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    'border-collapse', 'border-spacing', 'box-sizing', 'overflow', 'overflow-x', 'overflow-y',
    'flex', 'flex-basis', 'flex-direction', 'flex-flow', 'flex-grow', 'flex-shrink', 'flex-wrap',
    'align-content', 'align-items', 'align-self', 'justify-content', 'justify-items', 'justify-self',
    'gap', 'row-gap', 'column-gap',
    'grid', 'grid-area', 'grid-template', 'grid-template-areas', 'grid-template-rows', 'grid-template-columns',
    'grid-row', 'grid-row-start', 'grid-row-end', 'grid-column', 'grid-column-start', 'grid-column-end',
    'color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration', 'text-indent',
    'text-transform', 'text-shadow', 'white-space', 'vertical-align',
    'background', 'background-color', 'background-image', 'background-repeat', 'background-position', 'background-size', 'background-clip',
    'opacity', 'visibility', 'box-shadow', 'outline', 'outline-offset', 'cursor',
    'transform', 'transform-origin', 'transform-style', 'transition', 'animation', 'filter',
    'list-style', 'list-style-type', 'list-style-position', 'list-style-image',
]);
const STYLE_WHITELIST_ARRAY = Array.from(OPTIMIZED_STYLE_PROPERTIES);

let CACHED_UNIT_BACKGROUND = null;
function invalidateUnitBackgroundCache() {
    if (CACHED_UNIT_BACKGROUND) {
        captureLogger.info('缓存失效：单位背景已被清除。');
        CACHED_UNIT_BACKGROUND = null;
    }
}

// --- 混合缓存策略核心 ---

// MODIFIED: 引入内存缓存 (L1 Cache) 以获得极致性能
const FONT_DATA_MEMORY_CACHE = new Map();
// NEW: 为图片资源创建 L1 内存缓存
const IMAGE_DATA_MEMORY_CACHE = new Map();
let ACTIVE_FONT_MAPPING = null; // 内存中的当前主题字体映射表
let CACHED_FA_CSS = null;

// --- 统一资产缓存管理器 (AssetCacheManager) for IndexedDB (L2 Cache) ---
class AssetCacheManager {
    constructor(dbName = 'ModernScreenshotCache', version = 1) {
        this.db = null;
        this.dbName = dbName;
        // MODIFIED: 提升数据库版本以安全地添加新的对象仓库
        this.dbVersion = 2; 
        this.stores = {
            fontMappings: 'fontMappings',
            fontData: 'fontData',
            // NEW: 为图片数据添加新的仓库
            imageData: 'imageData',
        };
    }

    async init() {
        return new Promise((resolve, reject) => {
            if (this.db) return resolve();
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.stores.fontMappings)) {
                    db.createObjectStore(this.stores.fontMappings, { keyPath: 'cssUrl' });
                }
                if (!db.objectStoreNames.contains(this.stores.fontData)) {
                    db.createObjectStore(this.stores.fontData, { keyPath: 'fontUrl' });
                }
                // NEW: 创建图片数据仓库
                if (!db.objectStoreNames.contains(this.stores.imageData)) {
                    db.createObjectStore(this.stores.imageData, { keyPath: 'imageUrl' });
                }
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            request.onerror = (event) => {
                captureLogger.error('连接资产缓存数据库失败:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    _getStore(storeName, mode = 'readonly') {
        const transaction = this.db.transaction(storeName, mode);
        return transaction.objectStore(storeName);
    }

    // --- 字体相关方法 (已有) ---
    async getAllFontData() {
        return new Promise((resolve, reject) => {
            const store = this._getStore(this.stores.fontData);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getMapping(cssUrl) {
        return new Promise((resolve, reject) => {
            const store = this._getStore(this.stores.fontMappings);
            const request = store.get(cssUrl);
            request.onsuccess = () => resolve(request.result?.mapping);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async saveMapping(cssUrl, mapping) {
        return new Promise((resolve, reject) => {
            const store = this._getStore(this.stores.fontMappings, 'readwrite');
            const request = store.put({ cssUrl, mapping });
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getFontData(fontUrl) {
        return new Promise((resolve, reject) => {
            const store = this._getStore(this.stores.fontData);
            const request = store.get(fontUrl);
            request.onsuccess = () => resolve(request.result?.dataUrl);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async saveFontData(fontUrl, dataUrl) {
        return new Promise((resolve, reject) => {
            const store = this._getStore(this.stores.fontData, 'readwrite');
            const request = store.put({ fontUrl, dataUrl });
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
	
    // --- NEW: 图片相关方法 ---
    async getAllImageData() {
        return new Promise((resolve, reject) => {
            const store = this._getStore(this.stores.imageData);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    async getImageData(imageUrl) {
        return new Promise((resolve, reject) => {
            const store = this._getStore(this.stores.imageData);
            const request = store.get(imageUrl);
            request.onsuccess = () => resolve(request.result?.dataUrl);
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    async saveImageData(imageUrl, dataUrl) {
        return new Promise((resolve, reject) => {
            const store = this._getStore(this.stores.imageData, 'readwrite');
            const request = store.put({ imageUrl, dataUrl });
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }


	// MODIFIED: 修正后的 processFontFromStyleElement 函数，支持内联 @font-face
	async processFontFromStyleElement() {
		const styleElement = document.querySelector('#custom-style');
		if (!styleElement) {
			captureLogger.warn('未找到 #custom-style 元素，跳过字体处理。');
			return;
		}

		const rawCss = styleElement.textContent || '';
		const importMatch = /@import\s+url\((['"]?)(.*?)\1\);/g.exec(rawCss);

		let cssContent;
		let baseUrl;
		let styleIdentifier; // 用于在数据库中唯一标识这个样式

		if (importMatch) {
			// --- 情况1: 外部 @import 字体 ---
			styleIdentifier = importMatch[2];
			baseUrl = styleIdentifier;
			captureLogger.info(`检测到外部字体CSS: ${styleIdentifier}`);
			if (ACTIVE_FONT_MAPPING && ACTIVE_FONT_MAPPING.cssUrl === styleIdentifier) return;
			const dbMapping = await assetCacheManager.getMapping(styleIdentifier);
			if (dbMapping) {
				ACTIVE_FONT_MAPPING = { cssUrl: styleIdentifier, mapping: dbMapping };
				captureLogger.info(`字体映射从数据库加载到内存: ${styleIdentifier}`);
				return;
			}
			try {
				cssContent = await fetch(styleIdentifier).then(res => res.text());
			} catch (error) {
				captureLogger.error(`下载外部字体CSS失败: ${styleIdentifier}`, error);
				return;
			}

		} else if (rawCss.includes('@font-face')) {
			// --- 情况2: 内联 @font-face 字体 ---
			styleIdentifier = 'inline-style:' + rawCss.trim(); // 使用CSS内容本身作为唯一标识
			baseUrl = window.location.href; // 内联样式的基准URL是当前页面
			cssContent = rawCss; // 直接使用内联的CSS内容
			captureLogger.info('检测到内联 @font-face 规则。');
			if (ACTIVE_FONT_MAPPING && ACTIVE_FONT_MAPPING.cssUrl === styleIdentifier) return;
			const dbMapping = await assetCacheManager.getMapping(styleIdentifier);
			if (dbMapping) {
				ACTIVE_FONT_MAPPING = { cssUrl: styleIdentifier, mapping: dbMapping };
				captureLogger.info(`字体映射从数据库加载到内存: ${styleIdentifier.substring(0, 70)}...`);
				return;
			}
			
		} else {
			// --- 情况3: 两种情况都不满足 ---
			captureLogger.info('当前主题未使用 @import 或内联 @font-face 字体。');
			ACTIVE_FONT_MAPPING = null; // 清除内存中的映射
			return;
		}
		
		// --- 公共的解析和缓存逻辑 ---
		try {
			captureLogger.info(`正在为新样式创建字体映射: ${styleIdentifier.substring(0, 70)}...`);
			const fontFaceRegex = /@font-face\s*{([^}]*)}/g;
			const unicodeRangeRegex = /unicode-range:\s*([^;]*);/;
			const urlRegex = /url\((['"]?)(.*?)\1\)/;
			const mapping = {};
			let match;
			fontFaceRegex.lastIndex = 0; 

			while ((match = fontFaceRegex.exec(cssContent)) !== null) {
				const fontFaceBlock = match[1];
				const unicodeRangeMatch = fontFaceBlock.match(unicodeRangeRegex);
				const urlMatch = fontFaceBlock.match(urlRegex);

				if (urlMatch) {
					const fontFileUrl = new URL(urlMatch[2], baseUrl).href;
					
					if (unicodeRangeMatch) {
						const ranges = unicodeRangeMatch[1];
						ranges.split(',').forEach(range => {
							range = range.trim().toUpperCase().substring(2);
							if (range.includes('-')) {
								const [start, end] = range.split('-').map(hex => parseInt(hex, 16));
								for (let i = start; i <= end; i++) { mapping[i] = fontFileUrl; }
							} else {
								mapping[parseInt(range, 16)] = fontFileUrl;
							}
						});
					} else {
						mapping['default'] = fontFileUrl;
					}
				}
			}

			if (Object.keys(mapping).length > 0) {
				await assetCacheManager.saveMapping(styleIdentifier, mapping);
				ACTIVE_FONT_MAPPING = { cssUrl: styleIdentifier, mapping: mapping };
				captureLogger.info(`字体映射已成功创建并存入数据库和内存: ${styleIdentifier.substring(0, 70)}...`);
			} else {
				captureLogger.warn('在样式中找到了@font-face，但未能成功解析出任何字体映射。');
			}

		} catch (error) {
			captureLogger.error(`处理样式时发生错误: ${styleIdentifier}`, error);
		}
	}
}

const assetCacheManager = new AssetCacheManager();

// --- 资源获取核心 (混合缓存策略) ---

// MODIFIED: 统一的字体数据获取函数，实现 L1/L2 缓存逻辑
async function getFontDataUrlAsync(fontUrl) {
    if (FONT_DATA_MEMORY_CACHE.has(fontUrl)) return FONT_DATA_MEMORY_CACHE.get(fontUrl);
    
    let dataUrl = await assetCacheManager.getFontData(fontUrl);
    if (dataUrl) {
        FONT_DATA_MEMORY_CACHE.set(fontUrl, dataUrl); // 填充 L1
        return dataUrl;
    }
    
    captureLogger.info(`正在下载并缓存字体: ${fontUrl}`);
    try {
        const fontBlob = await fetch(fontUrl).then(res => res.ok ? res.blob() : Promise.reject(`HTTP ${res.status}`));
        dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(fontBlob);
        });
        
        FONT_DATA_MEMORY_CACHE.set(fontUrl, dataUrl);
        await assetCacheManager.saveFontData(fontUrl, dataUrl);
        
        return dataUrl;
    } catch (err) {
        captureLogger.error(`下载字体失败: ${fontUrl}`, err);
        return null;
    }
}

// NEW: 为 `modern-screenshot` 准备的自定义图片获取函数
async function customImageFetchFn(url) {
    // 如果是 data URL，直接让库自己处理
    if (url.startsWith('data:')) return false;

    // 1. 检查 L1 内存缓存
    if (IMAGE_DATA_MEMORY_CACHE.has(url)) {
        return IMAGE_DATA_MEMORY_CACHE.get(url);
    }
    
    // 2. L1 未命中，检查 L2 数据库缓存
    let dataUrl = await assetCacheManager.getImageData(url);
    if (dataUrl) {
        IMAGE_DATA_MEMORY_CACHE.set(url, dataUrl); // 填充 L1 缓存
        return dataUrl;
    }

    // 3. L1 和 L2 均未命中，从网络获取
    captureLogger.info(`正在下载并缓存图片: ${url}`);
    try {
        const imageBlob = await fetch(url).then(res => {
            if (!res.ok) return Promise.reject(`HTTP ${res.status} for ${url}`);
            // 确保内容是图片类型
            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.startsWith('image/')) {
                return Promise.reject(`URL不是图片类型: ${contentType}`);
            }
            return res.blob();
        });

        dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(imageBlob);
        });
        
        // 双重写入: 同时更新 L1 和 L2 缓存
        IMAGE_DATA_MEMORY_CACHE.set(url, dataUrl);
        await assetCacheManager.saveImageData(url, dataUrl);
        
        return dataUrl;
    } catch (err) {
        captureLogger.error(`下载图片失败: ${url}`, err);
        // 返回 false，让 modern-screenshot 使用其默认的失败处理逻辑（例如，显示占位符）
        return false;
    }
}


async function getFontAwesomeCssAsync() {
    if (CACHED_FA_CSS) {
        captureLogger.info('命中内存缓存：正在使用已缓存的 Font Awesome CSS。');
        return CACHED_FA_CSS;
    }

    captureLogger.info('正在处理 Font Awesome @font-face 规则...');
    
    const fontFaceRules = [];
    for (const sheet of document.styleSheets) {
        try {
            if (!sheet.cssRules) continue;
            for (const rule of sheet.cssRules) {
                if (rule.type === CSSRule.FONT_FACE_RULE && rule.style.fontFamily.includes('Font Awesome')) {
                    fontFaceRules.push(rule);
                }
            }
        } catch (e) { continue; }
    }

    if (fontFaceRules.length === 0) {
        captureLogger.warn('未能找到 Font Awesome 的 @font-face 规则。');
        return '';
    }

    const fontUrlRegex = /url\((['"]?)(.+?)\1\)/g;
    const processedRulesPromises = fontFaceRules.map(async (rule) => {
        let originalCssText = rule.cssText;
        let processedRule = originalCssText;
        const fontUrlMatches = [...originalCssText.matchAll(fontUrlRegex)];

        for (const urlMatch of fontUrlMatches) {
            const originalUrlToken = urlMatch[0];
            const absoluteFontUrl = new URL(urlMatch[2], rule.parentStyleSheet.href || window.location.href).href;
            
            const fontDataUrl = await getFontDataUrlAsync(absoluteFontUrl);
            if (fontDataUrl) {
                processedRule = processedRule.replace(originalUrlToken, `url("${fontDataUrl}")`);
            }
        }
        return processedRule;
    });

    const finalRules = await Promise.all(processedRulesPromises);
    CACHED_FA_CSS = finalRules.join('\n');
    captureLogger.info(`Font Awesome CSS 处理完成，内联了 ${finalRules.length} 个规则。`);
    return CACHED_FA_CSS;
}

async function getSubsettedFontCssAsync(text) {
    if (!ACTIVE_FONT_MAPPING) {
        captureLogger.warn('没有激活的字体映射表，无法生成子集字体CSS。');
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
    if (cssUrl.startsWith('inline-style:')) {
        cssContent = cssUrl.substring('inline-style:'.length);
        baseUrl = window.location.href;
    } else {
        cssContent = await fetch(cssUrl).then(res => res.text());
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
    captureLogger.info(`已为当前文本生成 ${requiredCssRules.length} 条内联@font-face规则。`);
    return finalCss;
}

// --- 背景与合成核心 (单消息) ---
function findActiveBackgroundElement() {
    const selectors = ['#bg_animation_container > div[id^="bg"]', '#background > div[id^="bg"]', '#bg1', '#bg_animation_container', '#background'];
    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).backgroundImage !== 'none') return el;
    }
    captureLogger.warn("未能找到特定的背景元素，将回退到 #chat 作为背景源。");
    return document.querySelector(config.chatContentSelector);
}

function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(new Error('图片加载失败', { cause: err }));
        img.src = dataUrl;
    });
}

// --- 长截图核心逻辑 ---
async function createUnitBackgroundAsync(scale) {
    if (CACHED_UNIT_BACKGROUND) {
        captureLogger.info('命中缓存：正在使用已缓存的“单位背景”。');
        const clonedCanvas = CACHED_UNIT_BACKGROUND.cloneNode(true);
        const ctx = clonedCanvas.getContext('2d');
        ctx.drawImage(CACHED_UNIT_BACKGROUND, 0, 0);
        return clonedCanvas;
    }
    captureLogger.info('正在创建可平铺的“单位背景”...');
    const backgroundHolder = findActiveBackgroundElement();
    const chatContainer = document.querySelector(config.chatContentSelector);
    const formSheld = document.querySelector('#form_sheld');
    if (!backgroundHolder || !chatContainer) throw new Error("无法找到 #chat 或背景元素！");
    const chatRect = chatContainer.getBoundingClientRect();
    const formSheldHeight = formSheld ? formSheld.offsetHeight : 0;
    const unitWidth = chatContainer.clientWidth;
    const unitHeight = chatRect.height - formSheldHeight;
    const unitTop = chatRect.top;
    const unitLeft = chatContainer.getBoundingClientRect().left;
    const foregroundSelectors = ['#chat', '#form_sheld', '.header', '#right-panel', '#left-panel', '#character-popup'];
    const hiddenElements = [];
    let fullBackgroundDataUrl;
    try {
        foregroundSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if (el.style.visibility !== 'hidden') {
                    el.style.visibility = 'hidden';
                    hiddenElements.push(el);
                }
            });
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        fullBackgroundDataUrl = await window.domToDataUrl(backgroundHolder, { 
            scale,
            includeStyleProperties: STYLE_WHITELIST_ARRAY,
            // NEW: 注入我们的自定义 fetchFn 以缓存背景图
            fetchFn: customImageFetchFn,
        });
    } finally {
        hiddenElements.forEach(el => { el.style.visibility = 'visible'; });
    }
    if (!fullBackgroundDataUrl) throw new Error("创建单位背景时，背景截图失败。");
    const fullBgImage = await loadImage(fullBackgroundDataUrl);
    const unitCanvas = document.createElement('canvas');
    unitCanvas.width = unitWidth * scale;
    unitCanvas.height = unitHeight * scale;
    const unitCtx = unitCanvas.getContext('2d');
    unitCtx.drawImage(fullBgImage, unitLeft * scale, unitTop * scale, unitWidth * scale, unitHeight * scale, 0, 0, unitWidth * scale, unitHeight * scale);
    CACHED_UNIT_BACKGROUND = unitCanvas;
    captureLogger.info('“单位背景”创建并缓存成功！');
    const returnedCanvas = unitCanvas.cloneNode(true);
    const returnedCtx = returnedCanvas.getContext('2d');
    returnedCtx.drawImage(unitCanvas, 0, 0);
    return returnedCanvas;
}

async function captureLongScreenshot(elementsToCapture) {
    if (!elementsToCapture || elementsToCapture.length === 0) throw new Error("没有提供任何用于长截图的元素。");
    const timer = (label, start = performance.now()) => () => captureLogger.info(`⏱️ [长截图耗时] ${label}: ${(performance.now() - start).toFixed(2)} ms`);
    const mainProcessStart = timer('总流程');
    const settings = getPluginSettings();
    const scale = settings.screenshotScale;
    const fontPrepStart = timer('0. 聚合字体准备');
    const allTextContent = elementsToCapture.map(el => el.textContent || '').join('');
    const [subsettedCss, faCss] = await Promise.all([
        getSubsettedFontCssAsync(allTextContent),
        getFontAwesomeCssAsync(),
    ]);
    const combinedCss = `${subsettedCss}\n${faCss}`;
    fontPrepStart();
    const calcStart = timer('1. 计算总尺寸');
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
    captureLogger.info(`计算出的最终尺寸: ${finalWidth / scale}x${totalHeight} (scaled: ${finalWidth}x${finalHeight})`);
    calcStart();
    const bgPrepStart = timer('2. 准备背景');
    const unitBgCanvas = await createUnitBackgroundAsync(scale);
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = finalWidth;
    finalCanvas.height = finalHeight;
    const finalCtx = finalCanvas.getContext('2d');
    const pattern = finalCtx.createPattern(unitBgCanvas, 'repeat-y');
    finalCtx.fillStyle = pattern;
    finalCtx.fillRect(0, 0, finalWidth, finalHeight);
    bgPrepStart();
    const chatElement = document.querySelector(config.chatContentSelector);
    if (chatElement) {
        const chatBgColor = window.getComputedStyle(chatElement).backgroundColor;
        if (chatBgColor && chatBgColor !== 'rgba(0, 0, 0, 0)') {
            captureLogger.info(`正在为长截图应用 #chat 背景色: ${chatBgColor}`);
            finalCtx.fillStyle = chatBgColor;
            finalCtx.fillRect(0, 0, finalWidth, finalHeight);
        }
    }
    const stitchStart = timer('3. 拼接前景');
    const lib = window.modernScreenshot;
    const context = await lib.createContext(elementsToCapture[0], {
        scale,
        font: false,
        includeStyleProperties: STYLE_WHITELIST_ARRAY,
        style: { margin: '0' },
        features: { restoreScrollPosition: true },
        // NEW: 注入我们的自定义 fetchFn
        fetchFn: customImageFetchFn,
        onCreateForeignObjectSvg: (svg) => {
                const quoteFixCss = 'q::before, q::after { content: none !important; }';
                const layoutFixCss = `
                    pre {
                        white-space: pre-wrap !important;
                        word-break: break-all !important;
                        overflow-wrap: break-word !important;
                    }
                    .name_text { 
                        white-space: nowrap !important; 
                    }
                    .ch_name { 
                        letter-spacing: -0.5px !important; 
                    }
				`;
                const finalCss = combinedCss + '\n' + quoteFixCss + '\n' + layoutFixCss;
                if (finalCss) {
                    const styleElement = document.createElement('style');
                    styleElement.textContent = finalCss;
                    let defs = svg.querySelector('defs');
                    if (!defs) { defs = document.createElement('defs'); svg.prepend(defs); }
                    defs.appendChild(styleElement);
                }
            },
        workerUrl: `/scripts/extensions/third-party/${PLUGIN_ID}/worker.js`,
        autoDestruct: false,
    });
    let currentY = 0;
    for (const element of elementsToCapture) {
        captureLogger.info(`正在处理消息: ${element.getAttribute('mesid') || '未知ID'}`);
        const rect = element.getBoundingClientRect();
        context.node   = element;
        context.width  = rect.width;
        context.height = rect.height;
        const sectionCanvas = await lib.domToCanvas(context);
        const offsetX = (finalWidth - sectionCanvas.width) / 2;
        finalCtx.drawImage(sectionCanvas, offsetX, currentY);
        currentY += rect.height * scale + messageMargin * scale;
    }
    lib.destroyContext(context);
    stitchStart();
    const exportStart = timer('4. 导出最终图像');
    const finalDataUrl = finalCanvas.toDataURL(settings.imageFormat === 'jpeg' ? 'image/jpeg' : 'image/png', settings.imageQuality);
    exportStart();
    mainProcessStart();
    return finalDataUrl;
}


// --- 插件初始化与UI ---
async function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
        document.head.appendChild(script);
    });
}

function getPluginSettings() {
    extension_settings[PLUGIN_ID] = extension_settings[PLUGIN_ID] || {};
    return { ...defaultSettings, ...extension_settings[PLUGIN_ID] };
}

function initLongScreenshotUI() {
    $('#long_screenshot_start_button, #long_screenshot_capture_button, #long_screenshot_cancel_button').remove();
    const startButton = $('<div id="long_screenshot_start_button" class="menu_button"><i class="fa-solid fa-scroll"></i><span class="menu_button_text"> 长截图</span></div>');
    $('#chat_menu_buttons').append(startButton);
    startButton.on('click', () => {
        $('body').addClass('long-screenshot-selecting');
        $('#chat .mes').addClass('selectable-message');
        startButton.hide();
        const captureButton = $('<div id="long_screenshot_capture_button" class="menu_button"><i class="fa-solid fa-camera"></i><span class="menu_button_text"> 截取</span></div>');
        const cancelButton = $('<div id="long_screenshot_cancel_button" class="menu_button"><i class="fa-solid fa-times"></i><span class="menu_button_text"> 取消</span></div>');
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
                toastr.warning("请至少选择一条消息。");
                return;
            }
            selectedElements.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            const icon = captureButton.find('i');
            const originalClass = icon.attr('class');
            icon.attr('class', 'fa-solid fa-spinner fa-spin');
            try {
                const dataUrl = await captureLongScreenshot(selectedElements);
                const link = document.createElement('a');
                const extension = dataUrl.substring('data:image/'.length, dataUrl.indexOf(';'));
                link.download = `SillyTavern_Long_${new Date().toISOString().replace(/[:.T-]/g, '').slice(0, 14)}.${extension}`;
                link.href = dataUrl;
                link.click();
            } catch (error) {
                captureLogger.error('长截图失败:', error);
                toastr.error("长截图失败，请查看控制台获取更多信息。");
            } finally {
                icon.attr('class', originalClass);
                cancelButton.trigger('click');
            }
        });
    });
    $(document).on('click', '.selectable-message', function() { $(this).toggleClass('selected-for-screenshot'); });
    const styles = `
        .long-screenshot-selecting #chat { cursor: pointer; }
        .selectable-message { transition: background-color 0.2s; }
        .selected-for-screenshot { background-color: rgba(0, 150, 255, 0.3) !important; }
    `;
    $('head').append(`<style>${styles}</style>`);
}

function addScreenshotButtonToMessage(messageElement) {
    if (!messageElement || typeof messageElement.querySelector !== 'function' || messageElement.querySelector(`.${config.buttonClass}`)) return;
    
    const buttonsContainer = messageElement.querySelector('.mes_block .mes_buttons');
    if (!buttonsContainer) return;

    const screenshotButton = document.createElement('div');
    screenshotButton.innerHTML = '<i class="fa-solid fa-camera"></i>';
    screenshotButton.className = `${config.buttonClass} mes_button interactable`;
    screenshotButton.title = '点击截图';
    Object.assign(screenshotButton.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
    });

    screenshotButton.addEventListener('click', async (event) => {
        event.preventDefault(); 
        event.stopPropagation();

        if (screenshotButton.classList.contains('loading')) return;

        const icon = screenshotButton.querySelector('i');
        const originalClass = icon.className;
        icon.className = 'fa-solid fa-spinner fa-spin';
        screenshotButton.classList.add('loading');

        try {
            // 现在所有单消息截图，无论长短，都统一使用高效的 captureLongScreenshot 函数。
            captureLogger.info('正在执行单消息截图（统一优化模式）...');
            const dataUrl = await captureLongScreenshot([messageElement]);

            const link = document.createElement('a');
            const extension = dataUrl.substring('data:image/'.length, dataUrl.indexOf(';'));
            link.download = `SillyTavern_${new Date().toISOString().replace(/[:.T-]/g, '').slice(0, 14)}.${extension}`;
            link.href = dataUrl;
            link.click();

        } catch (error) {
            captureLogger.error('消息截图失败:', error);
            toastr.error('截图失败，请查看控制台获取更多信息。');
        } finally {
            icon.className = originalClass;
            screenshotButton.classList.remove('loading');
        }
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
        captureLogger.warn('未找到聊天容器，1秒后重试...');
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
    observer.observe(chatContentEl, { childList: true, subtree: true });
}

// 动态字体观察者
function setupFontChangeObserver() {
    const styleNode = document.getElementById('custom-style');
    if (!styleNode) {
        captureLogger.warn('未能找到 #custom-style 元素，无法设置字体变更观察者。');
        return;
    }

    const observer = new MutationObserver(() => {
        captureLogger.info('检测到 #custom-style 内容发生变化，正在处理新字体...');
        assetCacheManager.processFontFromStyleElement().catch(err => {
            captureLogger.error("字体映射表重新预处理失败:", err);
        });
    });

    observer.observe(styleNode, { childList: true, characterData: true, subtree: true });
    captureLogger.info('已成功设置 #custom-style 的字体变更观察者。');
}

// MODIFIED: 插件主初始化流程，增加了缓存预热步骤
async function initializePlugin() {
    try {
        captureLogger.info('插件核心初始化开始...');

        // 1. 并行加载核心库并初始化数据库
        const libPromise = loadScript(`/scripts/extensions/third-party/${PLUGIN_ID}/modern-screenshot.umd.js`);
        const dbInitPromise = assetCacheManager.init();
        await Promise.all([libPromise, dbInitPromise]);
        
        // 2. 检查核心库
        if (!window.modernScreenshot?.domToDataUrl) throw new Error('Modern Screenshot 库加载失败！');
        window.domToDataUrl = window.modernScreenshot.domToDataUrl;
        
        // 3. MODIFIED: 预热内存缓存 (从L2到L1)，现在包含字体和图片
        captureLogger.info('正在预热资源内存缓存 (L1)...');
        const hydrationStart = performance.now();
        
        const fontPromise = assetCacheManager.getAllFontData().then(allFonts => {
            for (const font of allFonts) {
                FONT_DATA_MEMORY_CACHE.set(font.fontUrl, font.dataUrl);
            }
            return allFonts.length;
        });

        const imagePromise = assetCacheManager.getAllImageData().then(allImages => {
            for (const image of allImages) {
                IMAGE_DATA_MEMORY_CACHE.set(image.imageUrl, image.dataUrl);
            }
            return allImages.length;
        });

        const [fontCount, imageCount] = await Promise.all([fontPromise, imagePromise]);
        
        captureLogger.info(
            `资源缓存预热完成，加载了 ${fontCount} 个字体和 ${imageCount} 个图片，` +
            `耗时 ${(performance.now() - hydrationStart).toFixed(2)} ms。`
        );


        // 4. 首次处理字体映射表并设置观察者
        await assetCacheManager.processFontFromStyleElement();
        setupFontChangeObserver();
        
        // 5. 初始化UI和设置面板
        let settingsHtml = '';
        try {
            settingsHtml = await renderExtensionTemplateAsync(`third-party/${PLUGIN_ID}`, 'settings');
        } catch (ex) {
            captureLogger.error('加载设置模板失败, 使用备用模板。', ex);
            settingsHtml = `<div id="${PLUGIN_ID}-settings"><h2>${PLUGIN_NAME} Settings</h2><p>Failed to load settings panel.</p></div>`;
        }
        $('#extensions_settings_content').append(settingsHtml);
        const settings = getPluginSettings();
        const settingsForm = $('#extensions_settings_content');
        settingsForm.find('#st_h2c_screenshotScale').val(settings.screenshotScale);
        settingsForm.find('#st_h2c_imageFormat').val(settings.imageFormat);
        settingsForm.find('#st_h2c_imageQuality').val(settings.imageQuality).prop('disabled', settings.imageFormat !== 'jpeg');
        settingsForm.find('#st_h2c_autoInstallButtons').prop('checked', settings.autoInstallButtons);
        settingsForm.find('#st_h2c_debugOverlay').prop('checked', settings.debugOverlay);
        settingsForm.on('change', 'select, input', () => {
            invalidateUnitBackgroundCache();
            const newSettings = {
                screenshotScale: parseFloat(settingsForm.find('#st_h2c_screenshotScale').val()) || defaultSettings.screenshotScale,
                imageFormat: settingsForm.find('#st_h2c_imageFormat').val(),
                imageQuality: parseFloat(settingsForm.find('#st_h2c_imageQuality').val()) || defaultSettings.imageQuality,
                autoInstallButtons: settingsForm.find('#st_h2c_autoInstallButtons').prop('checked'),
                debugOverlay: settingsForm.find('#st_h2c_debugOverlay').prop('checked'),
            };
            extension_settings[PLUGIN_ID] = newSettings;
            saveSettingsDebounced();
            settingsForm.find('#st_h2c_imageQuality').prop('disabled', newSettings.imageFormat !== 'jpeg');
            if (newSettings.autoInstallButtons) {
                installScreenshotButtons();
            } else {
                document.querySelectorAll(`.${config.buttonClass}`).forEach(btn => btn.remove());
            }
        });
        if (settings.autoInstallButtons) {
            installScreenshotButtons();
        }
        initLongScreenshotUI();
        const chatContainer = document.querySelector(config.chatContentSelector);
        if (chatContainer) {
            const resizeObserver = new ResizeObserver(() => {
                captureLogger.info('检测到窗口/容器尺寸变化。');
                invalidateUnitBackgroundCache();
            });
            resizeObserver.observe(chatContainer);
        }

        captureLogger.info('插件初始化完成。');

    } catch (error) {
        captureLogger.error('插件初始化过程中发生严重错误:', error);
    }
}

// 使用新的启动器
jQuery(() => {
    // 使用 setTimeout 将初始化推迟到下一个事件循环，以避免与其他脚本的初始化冲突
    setTimeout(initializePlugin, 100);
});