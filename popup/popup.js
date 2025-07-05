document.addEventListener('DOMContentLoaded', function() {
    // Элементы интерфейса
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const themeButtons = {
        auto: document.getElementById('themeAuto'),
        light: document.getElementById('themeLight'),
        dark: document.getElementById('themeDark')
    };
    const adsCount = document.getElementById('adsCount');
    const trackersCount = document.getElementById('trackersCount');
    const currentSite = document.getElementById('currentSite');
    const securityBadge = document.getElementById('securityBadge');
    const logo = document.getElementById('logo');
    const settingsBtn = document.getElementById('settingsBtn');
    
    // Переменные для статистики
    let adsBlocked = 0;
    let trackersBlocked = 0;

    // Инициализация темы
    function initTheme() {
        chrome.storage.local.get(['theme'], function(data) {
            const theme = data.theme || 'auto';
            setActiveThemeButton(theme);
            applyTheme(theme);
        });
    }
    
    // Применение темы
    function applyTheme(theme) {
        document.body.classList.remove('light-theme', 'dark-theme');
        
        // Если тема "авто", определяем системную тему
        if (theme === 'auto') {
            theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
        }
    }
    
    // Установка активной кнопки темы
    function setActiveThemeButton(theme) {
        Object.values(themeButtons).forEach(btn => btn.classList.remove('active'));
        themeButtons[theme].classList.add('active');
    }
    
    // Загрузка статистики блокировок
    function loadStats() {
        chrome.storage.local.get(['adsBlocked', 'trackersBlocked'], function(data) {
            adsBlocked = data.adsBlocked || 0;
            trackersBlocked = data.trackersBlocked || 0;
            updateStatsUI();
        });
    }
    
    // Обновление отображения статистики
    function updateStatsUI() {
        adsCount.textContent = formatNumber(adsBlocked);
        trackersCount.textContent = formatNumber(trackersBlocked);
    }
    
    // Форматирование чисел (1000 -> 1K)
    function formatNumber(num) {
        if (num > 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }
    
    // Определение текущего сайта
    function detectCurrentSite() {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length > 0 && tabs[0].url) {
                try {
                    const url = new URL(tabs[0].url);
                    const domain = url.hostname.replace('www.', '');
                    currentSite.textContent = domain;
                    checkSiteSecurity(domain);
                } catch {
                    currentSite.textContent = "Специальная страница";
                    setSecurityBadge('safe');
                }
            } else {
                currentSite.textContent = "Нет активной вкладки";
                securityBadge.style.visibility = 'hidden';
            }
        });
    }
    
    // Проверка безопасности сайта
    function checkSiteSecurity(domain) {
        // Добавляем ваш сайт в список безопасных
        const safeSites = [
            'google.com', 
            'youtube.com', 
            'wikipedia.org', 
            'github.com', 
            'startpozi.netlify.app', // Ваш сайт
            'netlify.app' // Все сайты на Netlify
        ];
        
        const dangerousSites = ['malware.com', 'phishing-site.org'];
        
        // Специальная проверка для вашего домена
        if (domain === 'startpozi.netlify.app' || domain.endsWith('.startpozi.netlify.app')) {
            setSecurityBadge('safe');
            return;
        }
        
        // Общие проверки
        if (safeSites.some(safe => domain.includes(safe))) {
            setSecurityBadge('safe');
        } else if (dangerousSites.some(danger => domain.includes(danger))) {
            setSecurityBadge('danger');
        } else {
            setSecurityBadge('warning');
        }
    }
    
    // Установка значка безопасности
    function setSecurityBadge(status) {
        securityBadge.className = 'security-badge ' + status;
        switch(status) {
            case 'safe':
                securityBadge.innerHTML = '<i class="fas fa-shield-alt"></i> Безопасно';
                break;
            case 'warning':
                securityBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Проверьте';
                break;
            case 'danger':
                securityBadge.innerHTML = '<i class="fas fa-radiation"></i> Опасно!';
                break;
        }
    }
    
    // Выполнение поиска (с указанием типа)
    function performSearch(type = 'web') {
        const query = searchInput.value.trim();
        if (query) {
            // Формируем URL для поиска в StartPOZI с указанием типа
            const searchUrl = `https://startpozi.netlify.app/search.html?q=${encodeURIComponent(query)}&t=${type}`;
            chrome.tabs.create({ url: searchUrl });
            window.close();
        }
    }
    
    // Открытие главной страницы
    function openHomePage() {
        chrome.tabs.create({ url: 'https://startpozi.netlify.app/' });
        window.close();
    }
    
    // Открытие страницы настроек
    function openSettingsPage() {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
        window.close();
    }
    
    // Инициализация
    function init() {
        // Фокус на поисковой строке
        searchInput.focus();
        
        // Обработчики событий
        searchButton.addEventListener('click', () => performSearch('web'));
        searchInput.addEventListener('keypress', e => {
            if (e.key === 'Enter') performSearch('web');
        });
        
        // Обработчики для кнопок поиска по типам
        document.getElementById('btnImages').addEventListener('click', () => performSearch('images'));
        document.getElementById('btnVideos').addEventListener('click', () => performSearch('videos'));
        document.getElementById('btnMaps').addEventListener('click', () => performSearch('maps'));
        document.getElementById('btnNews').addEventListener('click', () => performSearch('news'));
        
        // Обработчики для навигации
        logo.addEventListener('click', openHomePage);
        settingsBtn.addEventListener('click', openSettingsPage);
        
        // Обработчики для кнопок темы
        Object.keys(themeButtons).forEach(theme => {
            themeButtons[theme].addEventListener('click', () => {
                setActiveThemeButton(theme);
                chrome.storage.local.set({theme});
                applyTheme(theme);
            });
        });
        
        // Инициализация данных
        initTheme();
        loadStats();
        detectCurrentSite();
        
        // Слушаем обновления статистики
        chrome.storage.onChanged.addListener(function(changes) {
            if (changes.adsBlocked) {
                adsBlocked = changes.adsBlocked.newValue;
                adsCount.textContent = formatNumber(adsBlocked);
            }
            if (changes.trackersBlocked) {
                trackersBlocked = changes.trackersBlocked.newValue;
                trackersCount.textContent = formatNumber(trackersBlocked);
            }
        });
    }
    
    // Запуск
    init();
    
    // Следим за изменением системной темы
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
        chrome.storage.local.get('theme', function(data) {
            if (data.theme === 'auto') {
                applyTheme('auto');
            }
        });
    });
});