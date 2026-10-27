/*
 * Пробный плагин: только раздел настроек с двумя списками.
 * Нужен, чтобы выяснить, ломается ли экран настроек сам по себе.
 * Никаких слушателей, таймеров и обращений к контроллерам здесь нет.
 */
(function () {
    'use strict'

    if (window.probe_ready) return
    window.probe_ready = true

    function init() {
        Lampa.SettingsApi.addComponent({
            component: 'probe',
            name: 'Probe',
            icon: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                  '<circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="4"/>' +
                  '<path d="M24 12v12l8 5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>'
        })

        // Список A: без описания
        Lampa.SettingsApi.addParam({
            component: 'probe',
            param: { name: 'probe_a', type: 'select', values: { '10': '10 sec', '20': '20 sec', '30': '30 sec' }, default: '20' },
            field: { name: 'Список A (без описания)' }
        })

        // Список B: с описанием
        Lampa.SettingsApi.addParam({
            component: 'probe',
            param: { name: 'probe_b', type: 'select', values: { '900': '15 min', '1800': '30 min', '3600': '60 min' }, default: '3600' },
            field: { name: 'Список B (с описанием)', description: 'Тестовое описание под пунктом' }
        })

        console.log('[Probe] готов')
    }

    if (window.appready) init()
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init() })
})()
