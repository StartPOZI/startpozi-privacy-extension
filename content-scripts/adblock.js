// Списки для блокировки
const adDomains = [
    'doubleclick.net', 
    'googleadservices.com',
    'googlesyndication.com',
    'ads.youtube.com',
    'adservice.google.com'
];

const trackerDomains = [
    'facebook.com',
    'facebook.net',
    'fbcdn.net',
    'analytics.google.com',
    'yandex.ru/metrika',
    'mc.yandex.ru'
];

// Подсчет заблокированных элементов
let adsBlocked = 0;
let trackersBlocked = 0;

// Блокировка рекламных и трекерных запросов
chrome.webRequest.onBeforeRequest.addListener(
    function(details) {
        const url = new URL(details.url);
        
        // Проверка на рекламу
        if (adDomains.some(domain => url.hostname.includes(domain))) {
            adsBlocked++;
            updateStats();
            return {cancel: true};
        }
        
        // Проверка на трекеры
        if (trackerDomains.some(domain => url.hostname.includes(domain))) {
            trackersBlocked++;
            updateStats();
            return {cancel: true};
        }
        
        return {cancel: false};
    },
    {urls: ["<all_urls>"]},
    ["blocking"]
);

// Обновление статистики в хранилище
function updateStats() {
    chrome.storage.local.get(['adsBlocked', 'trackersBlocked'], function(data) {
        const currentAds = (data.adsBlocked || 0) + 1;
        const currentTrackers = (data.trackersBlocked || 0) + 1;
        
        chrome.storage.local.set({
            adsBlocked: currentAds,
            trackersBlocked: currentTrackers
        });
    });
}