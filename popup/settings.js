document.addEventListener('DOMContentLoaded', function() {
    // Элементы настроек
    const adBlockToggle = document.getElementById('adBlockToggle');
    const trackerBlockToggle = document.getElementById('trackerBlockToggle');
    const securityCheckToggle = document.getElementById('securityCheckToggle');
    const incognitoToggle = document.getElementById('incognitoToggle');
    const safeSearchToggle = document.getElementById('safeSearchToggle');
    const privacyRadios = document.querySelectorAll('input[name="privacyLevel"]');
    
    // Загрузка сохраненных настроек
    function loadSettings() {
        chrome.storage.local.get([
            'adBlockEnabled', 
            'trackerBlockEnabled', 
            'securityCheckEnabled',
            'incognitoEnabled',
            'safeSearchEnabled',
            'privacyLevel'
        ], function(settings) {
            // Установка значений по умолчанию
            adBlockToggle.checked = settings.adBlockEnabled !== false;
            trackerBlockToggle.checked = settings.trackerBlockEnabled !== false;
            securityCheckToggle.checked = settings.securityCheckEnabled !== false;
            incognitoToggle.checked = settings.incognitoEnabled === true;
            safeSearchToggle.checked = settings.safeSearchEnabled !== false;
            
            // Установка уровня приватности
            const privacyLevel = settings.privacyLevel || 'basic';
            document.getElementById(`privacy${capitalizeFirstLetter(privacyLevel)}`).checked = true;
        });
    }
    
    // Сохранение настроек
    function saveSetting(key, value) {
        chrome.storage.local.set({ [key]: value }, function() {
            // Отправляем сообщение об обновлении настроек
            chrome.runtime.sendMessage({
                action: "updateSettings",
                settings: { [key]: value }
            });
        });
    }
    
    // Вспомогательная функция для заглавной буквы
    function capitalizeFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }
    
    // Обработчики изменений переключателей
    adBlockToggle.addEventListener('change', function() {
        saveSetting('adBlockEnabled', this.checked);
    });
    
    trackerBlockToggle.addEventListener('change', function() {
        saveSetting('trackerBlockEnabled', this.checked);
    });
    
    securityCheckToggle.addEventListener('change', function() {
        saveSetting('securityCheckEnabled', this.checked);
    });
    
    incognitoToggle.addEventListener('change', function() {
        saveSetting('incognitoEnabled', this.checked);
    });
    
    safeSearchToggle.addEventListener('change', function() {
        saveSetting('safeSearchEnabled', this.checked);
    });
    
    // Обработчики для радиокнопок приватности
    privacyRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.checked) {
                saveSetting('privacyLevel', this.value);
                
                // Автоматическое включение/выключение связанных настроек
                if (this.value === 'maximum') {
                    adBlockToggle.checked = true;
                    trackerBlockToggle.checked = true;
                    securityCheckToggle.checked = true;
                    
                    saveSetting('adBlockEnabled', true);
                    saveSetting('trackerBlockEnabled', true);
                    saveSetting('securityCheckEnabled', true);
                }
            }
        });
    });
    
    // Загрузка настроек при запуске
    loadSettings();
});