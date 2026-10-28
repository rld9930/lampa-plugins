/*
 * Пробный плагин 2: проверяем, от чего зависит пустой экран после списка.
 * Две переменные:
 *   - ключи списка: числовые ('10') или текстовые ('low')
 *   - где лежит список: прямо в разделе плагина или в подразделе,
 *     который открывается через Lampa.Settings.create(..., {onBack}) (как в Online Mod)
 */
(function () {
    'use strict'

    if (window.probe2_ready) return
    window.probe2_ready = true

    var ICON = '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
               '<circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="4"/>' +
               '<path d="M24 12v12l8 5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>'

    function numValues() { return { '10': '10 sec', '20': '20 sec', '30': '30 sec' } }
    function txtValues() { return { 'low': 'Low', 'mid': 'Medium', 'high': 'High' } }

    function init() {
        // Раздел 1
        Lampa.SettingsApi.addComponent({ component: 'probe2', name: 'Probe 2', icon: ICON })

        Lampa.SettingsApi.addParam({
            component: 'probe2',
            param: { name: 'probe2_a', type: 'select', values: numValues(), default: '20' },
            field: { name: 'A: числовые ключи, в разделе' }
        })

        Lampa.SettingsApi.addParam({
            component: 'probe2',
            param: { name: 'probe2_b', type: 'select', values: txtValues(), default: 'mid' },
            field: { name: 'B: текстовые ключи, в разделе' }
        })

        // Кнопка, открывающая подраздел так же, как это делает Online Mod
        Lampa.SettingsApi.addParam({
            component: 'probe2',
            param: { name: 'probe2_sub_button', type: 'button' },
            field: { name: 'Открыть подраздел (C и D)' },
            onChange: function () {
                Lampa.Settings.create('probe2_sub', {
                    onBack: function () {
                        Lampa.Settings.create('probe2')
                    }
                })
            }
        })

        // Подраздел
        Lampa.SettingsApi.addComponent({ component: 'probe2_sub', name: 'Probe 2 sub', icon: ICON })

        Lampa.SettingsApi.addParam({
            component: 'probe2_sub',
            param: { name: 'probe2_c', type: 'select', values: numValues(), default: '20' },
            field: { name: 'C: числовые ключи, в подразделе' }
        })

        Lampa.SettingsApi.addParam({
            component: 'probe2_sub',
            param: { name: 'probe2_d', type: 'select', values: txtValues(), default: 'mid' },
            field: { name: 'D: текстовые ключи, в подразделе' }
        })

        // Прячем подраздел из главного списка настроек (как делает Online Mod)
        Lampa.Settings.listener.follow('open', function (e) {
            if (e.name == 'main') $('[data-component="probe2_sub"]', e.body).hide()
        })

        console.log('[Probe2] готов')
    }

    if (window.appready) init()
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init() })
})()
