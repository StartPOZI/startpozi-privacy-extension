// Установка расширения
chrome.runtime.onInstalled.addListener(function() {
    chrome.settingsPrivate.setDefaultSearchProvider({
        name: "StartPOZI",
        searchURL: "https://startpozi.netlify.app/search.html?q={searchTerms}",
        faviconURL: "https://startpozi.netlify.app/favicon.ico",
        is_default: true,
        keyword: "sp"
    });
    
    // Инициализация статистики
    chrome.storage.local.set({
        adsBlocked: 0,
        trackersBlocked: 0
    });
});

// Контекстное меню
chrome.contextMenus.create({
    id: "searchWithStartPOZI",
    title: "Искать в StartPOZI: '%s'",
    contexts: ["selection"]
});

chrome.contextMenus.onClicked.addListener(function(info) {
    if (info.menuItemId === "searchWithStartPOZI" && info.selectionText) {
        chrome.tabs.create({
            url: `https://startpozi.netlify.app/search.html?q=${encodeURIComponent(info.selectionText)}`
        });
    }
});

// Обновление баджа
chrome.storage.onChanged.addListener(function(changes) {
    const ads = changes.adsBlocked ? changes.adsBlocked.newValue : 0;
    const trackers = changes.trackersBlocked ? changes.trackersBlocked.newValue : 0;
    
    const totalBlocked = ads + trackers;
    if (totalBlocked > 0) {
        chrome.browserAction.setBadgeText({text: totalBlocked.toString()});
        chrome.browserAction.setBadgeBackgroundColor({color: '#34a853'});
    }
});