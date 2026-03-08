// ==UserScript==
// @name         Image cropper with fixed aspect ratio (cover stretch)
// @namespace    https://github.com/Dima-programmer/itd-scripts
// @version      2.6
// @description  Adds custom SVG button (18x18) with title "Загрузить баннер". Crop modal with aspect ratio 650/224, beautiful checkbox for non‑proportional stretch to fill crop area. Uploads as JPG, sets bannerId, reloads on success. Toast notifications.
// @author       Dmitry (Дым) 
// @match        https://xn--d1ah4a.com/
// @grant        GM.xmlHttpRequest
// @grant        GM_addStyle
// @updateURL    https://github.com/Dima-programmer/itd-scripts/raw/refs/heads/main/image-banner.user.js
// @downloadURL  https://github.com/Dima-programmer/itd-scripts/raw/refs/heads/main/image-banner.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ---------- Configuration ----------
    const ASPECT_RATIO = 650 / 224;
    const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/tiff'];
    const MODAL_WIDTH = 900;
    const MODAL_BORDER_RADIUS = '16px';
    const REFRESH_URL = '/api/v1/auth/refresh';
    const UPLOAD_URL = '/api/files/upload';
    const UPDATE_USER_URL = '/api/users/me';
    const BUTTON_SELECTOR = 'button[data-userscript="banner-upload-btn"]';
    const ORIGINAL_BUTTON_SELECTOR = 'button[title="Нарисовать баннер"]';

    // ---------- Styles ----------
    GM_addStyle(`
        .rotating {
            animation: rotate 1s linear infinite;
            display: inline-block;
        }
        @keyframes rotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .custom-toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: #333;
            color: #fff;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10001;
            font-size: 14px;
            max-width: 80%;
            text-align: center;
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
        }
        .custom-toast.show {
            opacity: 1;
        }
        .custom-toast.error {
            background-color: #d32f2f;
        }
        .custom-toast.success {
            background-color: #388e3c;
        }
        .custom-toast.info {
            background-color: #1976d2;
        }

        /* Красивый чекбокс */
        .stretch-checkbox-container {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 15px;
            font-size: 14px;
            cursor: pointer;
            user-select: none;
        }
        .stretch-checkbox-container input[type="checkbox"] {
            position: absolute;
            opacity: 0;
            width: 0;
            height: 0;
        }
        .custom-checkbox {
            display: inline-block;
            width: 20px;
            height: 20px;
            background: #fff;
            border: 2px solid #ccc;
            border-radius: 5px;
            transition: all 0.2s;
            position: relative;
        }
        .stretch-checkbox-container input[type="checkbox"]:checked + .custom-checkbox {
            background: #4CAF50;
            border-color: #4CAF50;
        }
        .stretch-checkbox-container input[type="checkbox"]:checked + .custom-checkbox::after {
            content: '';
            position: absolute;
            left: 6px;
            top: 2px;
            width: 5px;
            height: 10px;
            border: solid white;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
        }
        .stretch-checkbox-container:hover .custom-checkbox {
            border-color: #4CAF50;
        }
        /* Темная тема */
        [data-theme="dark"] .custom-checkbox {
            background: #555;
            border-color: #888;
        }
    `);

    // ---------- State ----------
    let accessToken = null;
    let tokenPromise = null;
    let cropperLoaded = false;

    // ---------- URL check: pathname должен быть /@something ----------
    function isTargetPage() {
        return /^\/@[^\/]+$/.test(window.location.pathname);
    }

    // ---------- Toast ----------
    function showToast(message, type = 'error', duration = 3000) {
        const existing = document.getElementById('custom-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'custom-toast';
        toast.className = `custom-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ---------- Load Cropper resources ----------
    function loadCropperResources() {
        return new Promise((resolve, reject) => {
            let cssLoaded = false;
            let jsLoaded = false;
            let error = false;

            function check() {
                if (cssLoaded && jsLoaded && !error) {
                    cropperLoaded = true;
                    resolve();
                }
            }

            GM.xmlHttpRequest({
                method: 'GET',
                url: 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.css',
                onload: (resp) => {
                    if (resp.status >= 200 && resp.status < 300) {
                        const style = document.createElement('style');
                        style.textContent = resp.responseText;
                        document.head.appendChild(style);
                        cssLoaded = true;
                        check();
                    } else {
                        error = true;
                        reject(new Error('Failed to load cropper CSS'));
                    }
                },
                onerror: () => {
                    error = true;
                    reject(new Error('Failed to load cropper CSS'));
                }
            });

            GM.xmlHttpRequest({
                method: 'GET',
                url: 'https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.12/cropper.min.js',
                onload: (resp) => {
                    if (resp.status >= 200 && resp.status < 300) {
                        const script = document.createElement('script');
                        script.textContent = resp.responseText;
                        document.head.appendChild(script);
                        jsLoaded = true;
                        check();
                    } else {
                        error = true;
                        reject(new Error('Failed to load cropper JS'));
                    }
                },
                onerror: () => {
                    error = true;
                    reject(new Error('Failed to load cropper JS'));
                }
            });

            const link = document.createElement('link');
            link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        });
    }

    loadCropperResources().catch(err => {
        console.error('Cropper load error:', err);
        showToast('Не удалось загрузить редактор изображений', 'error');
    });

    // ---------- Token refresh ----------
    async function fetchAccessToken() {
        if (tokenPromise) return tokenPromise;

        tokenPromise = (async () => {
            try {
                const response = await fetch(REFRESH_URL, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                });
                if (!response.ok) throw new Error(`Refresh failed: ${response.status}`);
                const data = await response.json();
                if (!data.accessToken) throw new Error('No accessToken in response');
                accessToken = data.accessToken;
                return accessToken;
            } catch (error) {
                console.error('Failed to refresh token:', error);
                accessToken = null;
                throw error;
            } finally {
                tokenPromise = null;
            }
        })();

        return tokenPromise;
    }

    // ---------- Get current theme ----------
    function getCurrentTheme() {
        return document.documentElement.getAttribute('data-theme') || 'light';
    }

    // ---------- Create button with SVG 18x18 and title ----------
    function createButton(btnClass) {
        const btn = document.createElement('button');
        btn.className = btnClass;
        btn.setAttribute('data-userscript', 'banner-upload-btn');
        btn.setAttribute('title', 'Загрузить баннер');

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('viewBox', '0 0 35 35');
        svg.setAttribute('fill', 'none');

        const path1 = document.createElementNS(svgNS, 'path');
        path1.setAttribute('fill', 'currentColor');
        path1.setAttribute('d', 'M29.467,34.749H5.53A5.288,5.288,0,0,1,.25,29.467V5.532A5.286,5.286,0,0,1,5.53.252H29.467a5.286,5.286,0,0,1,5.28,5.28V29.467A5.288,5.288,0,0,1,29.467,34.749ZM5.53,2.752a2.783,2.783,0,0,0-2.78,2.78V29.467a2.784,2.784,0,0,0,2.78,2.782H29.467a2.784,2.784,0,0,0,2.78-2.782V5.532a2.783,2.783,0,0,0-2.78-2.78Z');

        const path2 = document.createElementNS(svgNS, 'path');
        path2.setAttribute('fill', 'currentColor');
        path2.setAttribute('d', 'M11.86,17.226a4.468,4.468,0,1,1,4.468-4.468A4.473,4.473,0,0,1,11.86,17.226Zm0-6.435a1.968,1.968,0,1,0,1.968,1.967A1.97,1.97,0,0,0,11.86,10.791Z');

        const path3 = document.createElementNS(svgNS, 'path');
        path3.setAttribute('fill', 'currentColor');
        path3.setAttribute('d', 'M2.664,31.92a1.25,1.25,0,0,1-.929-2.085l5.876-6.547a3.288,3.288,0,0,1,4.553-.341l2.525,2.084a.77.77,0,0,0,.6.178.794.794,0,0,0,.543-.3l6.644-8.584a3.277,3.277,0,0,1,2.6-1.279h.012A3.282,3.282,0,0,1,27.673,16.3l6.372,8.107a1.25,1.25,0,0,1-1.966,1.545l-6.372-8.107a.785.785,0,0,0-.627-.3.864.864,0,0,0-.631.309L17.8,26.434a3.3,3.3,0,0,1-4.707.525l-2.525-2.084a.794.794,0,0,0-1.1.083L3.6,31.5A1.245,1.245,0,0,1,2.664,31.92Z');

        svg.appendChild(path1);
        svg.appendChild(path2);
        svg.appendChild(path3);
        btn.appendChild(svg);

        btn.style.cursor = 'pointer';
        btn.style.margin = '0 4px';
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';

        return btn;
    }

    // ---------- Удалить нашу кнопку, если есть ----------
    function removeOurButton() {
        const existingBtn = document.querySelector(BUTTON_SELECTOR);
        if (existingBtn) existingBtn.remove();
    }

    // ---------- Основная функция вставки/обновления кнопки ----------
    function updateButton() {
        if (!isTargetPage()) {
            removeOurButton();
            return;
        }

        const originalBtn = document.querySelector(ORIGINAL_BUTTON_SELECTOR);
        if (!originalBtn) {
            removeOurButton();
            return;
        }

        const parent = originalBtn.parentNode;
        if (!parent) {
            removeOurButton();
            return;
        }

        const originalClass = originalBtn.className;
        const ourBtn = document.querySelector(BUTTON_SELECTOR);

        if (ourBtn) {
            if (ourBtn.className !== originalClass) {
                ourBtn.className = originalClass;
            }
            return;
        }

        const newBtn = createButton(originalClass);
        newBtn.addEventListener('click', onButtonClick);
        parent.prepend(newBtn);
        console.log('Photo button injected/updated');
    }

    // ---------- Наблюдатель за изменениями DOM ----------
    function observe() {
        updateButton();

        const observer = new MutationObserver(() => {
            updateButton();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });

        window.addEventListener('popstate', () => updateButton());
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href) {
                setTimeout(updateButton, 50);
            }
        });
    }

    // ---------- Обработчик клика по нашей кнопке ----------
    async function onButtonClick() {
        if (typeof Cropper === 'undefined' || !cropperLoaded) {
            showToast('Редактор изображений ещё загружается, попробуйте через секунду', 'info');
            return;
        }

        if (!accessToken) {
            try {
                await fetchAccessToken();
            } catch {
                showToast('Не удалось авторизоваться', 'error');
                return;
            }
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = ALLOWED_MIME_TYPES.join(',');
        input.multiple = false;

        input.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            if (file.type === 'image/gif') {
                showToast('GIF не разрешены', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (ev) => showCropModal(ev.target.result);
            reader.readAsDataURL(file);
        });

        input.click();
    }

    // ---------- Upload and set banner ----------
    async function uploadAndSetBanner(canvas) {
        try {
            if (!accessToken) await fetchAccessToken();

            const blob = await new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/jpeg', 0.95);
            });
            if (!blob) throw new Error('Не удалось создать изображение');

            const formData = new FormData();
            formData.append('file', blob, 'banner.jpg');

            const uploadRes = await fetch(UPLOAD_URL, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Authorization': `Bearer ${accessToken}` },
                body: formData,
            });
            if (!uploadRes.ok) throw new Error(`Ошибка загрузки: ${uploadRes.status}`);
            const { id: fileId } = await uploadRes.json();
            if (!fileId) throw new Error('Нет ID файла');

            const updateRes = await fetch(UPDATE_USER_URL, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ bannerId: fileId }),
            });
            if (!updateRes.ok) throw new Error(`Ошибка обновления: ${updateRes.status}`);

            location.reload();
        } catch (error) {
            console.error(error);
            showToast('Ошибка: ' + error.message, 'error');
            throw error;
        }
    }

    // ---------- Crop modal with non-proportional stretch ----------
    function showCropModal(imageSrc) {
        const theme = getCurrentTheme();
        const isDark = theme === 'dark';

        const existing = document.getElementById('custom-crop-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'custom-crop-modal';
        overlay.style.cssText = `
            position: fixed; top:0; left:0; width:100%; height:100%;
            background: rgba(0,0,0,0.5); display: flex; justify-content: center;
            align-items: center; z-index: 10000;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            width: ${MODAL_WIDTH}px; max-width: 90vw;
            background: ${isDark ? '#333' : '#fff'}; color: ${isDark ? '#fff' : '#000'};
            border-radius: ${MODAL_BORDER_RADIUS}; padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3); display: flex;
            flex-direction: column; gap: 20px;
        `;

        const imgContainer = document.createElement('div');
        imgContainer.style.cssText = 'width:100%; max-height:70vh; overflow:hidden; text-align:center;';

        const img = document.createElement('img');
        img.src = imageSrc;
        img.style.cssText = 'max-width:100%; display:block;';
        imgContainer.appendChild(img);

        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display:flex; justify-content:flex-end; gap:10px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Отмена';
        cancelBtn.style.cssText = `
            padding:8px 16px; border-radius:8px; border:none; cursor:pointer;
            background:${isDark ? '#555' : '#f0f0f0'}; color:${isDark ? '#fff' : '#000'};
        `;

        const saveBtn = document.createElement('button');
        saveBtn.style.cssText = `
            padding:8px 16px; border-radius:8px; border:none; cursor:pointer;
            background:#4CAF50; color:#fff; display:inline-flex; align-items:center; gap:8px;
        `;
        saveBtn.innerHTML = 'Сохранить';

        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(saveBtn);

        // Красивый чекбокс
        const checkboxContainer = document.createElement('label');
        checkboxContainer.className = 'stretch-checkbox-container';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'stretch-checkbox';
        const customSpan = document.createElement('span');
        customSpan.className = 'custom-checkbox';
        const labelText = document.createTextNode(' Растянуть непропорционально (заполнить область)');

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(customSpan);
        checkboxContainer.appendChild(labelText);

        modal.appendChild(imgContainer);
        modal.appendChild(btnContainer);
        modal.appendChild(checkboxContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        let cropper = null;

        // Инициализация cropper после загрузки изображения
        img.onload = () => {
            if (cropper) cropper.destroy();
            cropper = new Cropper(img, {
                aspectRatio: ASPECT_RATIO,
                viewMode: 1,
                autoCropArea: 1,
                responsive: true,
                background: false,
                modal: true,
                guides: true,
                center: true,
                highlight: false,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false,
                ready() {
                    console.log('Cropper ready');
                }
            });
        };

        // Обработчик чекбокса (непропорциональное растяжение)
        checkbox.addEventListener('change', function() {
            if (!cropper) {
                showToast('Изображение ещё не готово', 'info');
                this.checked = false;
                return;
            }

            if (this.checked) {
                // Получаем данные об изображении и области обрезки
                const imageData = cropper.getImageData();
                const cropBoxData = cropper.getCropBoxData();

                // Текущие размеры изображения в контейнере (после текущего масштаба)
                const currentWidth = imageData.width;
                const currentHeight = imageData.height;

                // Целевые размеры области обрезки
                const targetWidth = cropBoxData.width;
                const targetHeight = cropBoxData.height;

                // Коэффициенты растяжения по осям
                const scaleX = targetWidth / currentWidth;
                const scaleY = targetHeight / currentHeight;

                // Применяем непропорциональное масштабирование
                cropper.scaleX(scaleX);
                cropper.scaleY(scaleY);

                // Центрируем изображение по центру области обрезки (опционально)
                // После масштабирования изображение может сместиться, корректируем позицию
                const newImageData = cropper.getImageData();
                const dx = (cropBoxData.left + cropBoxData.width / 2) - (newImageData.left + newImageData.width / 2);
                const dy = (cropBoxData.top + cropBoxData.height / 2) - (newImageData.top + newImageData.height / 2);
                cropper.move(dx, dy);

                console.log('Stretched non-proportionally');
            } else {
                // Возвращаем масштаб к исходному (1 по обеим осям)
                cropper.scaleX(1);
                cropper.scaleY(1);

                // Также можно попытаться восстановить позицию, но проще перезагрузить? 
                // Лучше просто вернуть масштаб, позиция останется примерно той же.
                // Если нужно точное восстановление, можно сохранять перед изменением, но для простоты так.
                console.log('Restored scale');
            }
        });

        cancelBtn.addEventListener('click', () => {
            if (cropper) cropper.destroy();
            overlay.remove();
        });

        saveBtn.addEventListener('click', async () => {
            if (!cropper) return;

            const canvas = cropper.getCroppedCanvas({ width: 650, height: 224, fillColor: '#fff' });

            saveBtn.disabled = true;
            cancelBtn.disabled = true;
            saveBtn.innerHTML = '<span class="material-icons rotating">sync</span> Сохранение...';

            try {
                await uploadAndSetBanner(canvas);
            } catch {
                saveBtn.disabled = false;
                cancelBtn.disabled = false;
                saveBtn.innerHTML = 'Сохранить';
            }
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (cropper) cropper.destroy();
                overlay.remove();
            }
        });
    }

    // ---------- Запуск ----------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observe);
    } else {
        observe();
    }

})();
