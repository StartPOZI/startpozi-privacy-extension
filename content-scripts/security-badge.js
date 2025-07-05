// Добавляем значок безопасности в DOM
const securityBadge = document.createElement('div');
securityBadge.id = 'startpozi-security-badge';
securityBadge.style.position = 'fixed';
securityBadge.style.bottom = '15px';
securityBadge.style.right = '15px';
securityBadge.style.zIndex = '9999';
securityBadge.style.padding = '8px 15px';
securityBadge.style.borderRadius = '20px';
securityBadge.style.fontFamily = 'Arial, sans-serif';
securityBadge.style.fontSize = '14px';
securityBadge.style.display = 'flex';
securityBadge.style.alignItems = 'center';
securityBadge.style.gap = '8px';
securityBadge.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';

// Проверяем безопасность сайта
function checkSecurity() {
    const domain = window.location.hostname;
    
    // Списки безопасных и опасных сайтов
    const safeSites = ['youtube.com', 'google.com', 'wikipedia.org', 'github.com'];
    const dangerousSites = ['piratebay.org', 'exemplo.ru', 'untrusted.com'];
    
    if (safeSites.some(safe => domain.includes(safe))) {
        securityBadge.innerHTML = '<img src="' + chrome.runtime.getURL('icons/shield-green.png') + '" width="16"> Безопасный сайт';
        securityBadge.style.background = 'rgba(76, 175, 80, 0.9)';
        securityBadge.style.color = 'white';
    } else if (dangerousSites.some(danger => domain.includes(danger))) {
        securityBadge.innerHTML = '<img src="' + chrome.runtime.getURL('icons/shield-red.png') + '" width="16"> Опасный сайт!';
        securityBadge.style.background = 'rgba(244, 67, 54, 0.9)';
        securityBadge.style.color = 'white';
    } else {
        securityBadge.innerHTML = '<img src="' + chrome.runtime.getURL('icons/shield-yellow.png') + '" width="16"> Проверьте безопасность';
        securityBadge.style.background = 'rgba(255, 193, 7, 0.9)';
        securityBadge.style.color = 'black';
    }
    
    document.body.appendChild(securityBadge);
    
    // Анимация появления
    securityBadge.style.transform = 'translateY(30px)';
    securityBadge.style.opacity = '0';
    setTimeout(() => {
        securityBadge.style.transition = 'all 0.5s ease';
        securityBadge.style.transform = 'translateY(0)';
        securityBadge.style.opacity = '1';
    }, 100);
}

// Запускаем проверку после загрузки страницы
window.addEventListener('load', checkSecurity);