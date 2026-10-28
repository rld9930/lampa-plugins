/*
 * Пробный плагин 3: диагностика пустого экрана настроек.
 * Показывает на экране журнал событий Lampa (контроллеры, список выбора, настройки, клавиши)
 * и состояние страницы настроек после каждого переключения.
 * Регистрация настроек происходит сразу при загрузке скрипта, как у Online Mod.
 */
(function () {
    'use strict'

    if (window.probe3_ready) return
    window.probe3_ready = true

    var t0 = Date.now()
    var lines = []
    var box = null

    function log(text) {
        var t = Date.now() - t0
        lines.push(t + ' ' + text)
        if (lines.length > 18) lines.shift()

        if (!box) {
            box = $('<div></div>').css({
                position: 'fixed', left: 0, bottom: 0, zIndex: 999999,
                background: 'rgba(0,0,0,0.85)', color: '#7CFC00',
                font: '16px monospace', padding: '6px 10px',
                whiteSpace: 'pre', pointerEvents: 'none', maxWidth: '70%'
            })
            $('body').append(box)
        }

        box.text(lines.join('\n'))
        try { console.log('[Probe3]', text) } catch (e) {}
    }

    function ctrlName() {
        try { return (Lampa.Controller.enabled() || {}).name } catch (e) { return '?' }
    }

    function snap(tag) {
        try {
            var b = $('.settings__body')
            log(tag + ' kids=' + b.children().length +
                ' params=' + b.find('.settings-param').length +
                ' h=' + Math.round(b.height() || 0) +
                ' ctrl=' + ctrlName())
        } catch (e) { log(tag + ' snap error ' + e) }
    }

    var ICON = '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
               '<circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="4"/>' +
               '<path d="M24 12v12l8 5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>'

    function register() {
        Lampa.SettingsApi.addComponent({ component: 'probe3', name: 'Probe 3', icon: ICON })

        Lampa.SettingsApi.addParam({
            component: 'probe3',
            param: { name: 'probe3_a', type: 'select', values: { '10': '10 sec', '20': '20 sec', '30': '30 sec' }, default: '20' },
            field: { name: 'A: числовые ключи' }
        })

        Lampa.SettingsApi.addParam({
            component: 'probe3',
            param: { name: 'probe3_b', type: 'select', values: { 'low': 'Low', 'mid': 'Medium', 'high': 'High' }, default: 'mid' },
            field: { name: 'B: текстовые ключи' }
        })
    }

    function hook() {
        var ver = ''
        try { ver = Lampa.Manifest.app_version } catch (e) {}
        log('probe3 ready, version=' + ver + ' tizen=' + (Lampa.Platform.is('tizen') ? 'yes' : 'no'))

        Lampa.Controller.listener.follow('toggle', function (e) {
            log('ctrl -> ' + e.name)
            setTimeout(function () { snap('   +300ms') }, 300)
        })

        Lampa.Select.listener.follow('close', function () {
            log('select closed')
            snap('   at close')
        })

        Lampa.Settings.listener.follow('open', function (e) {
            log('settings open: ' + e.name)
        })

        Lampa.Settings.listener.follow('close', function () {
            log('settings close')
        })

        Lampa.Keypad.listener.follow('keydown', function (e) {
            log('key ' + e.code)
        })
    }

    // Регистрация сразу при загрузке, если API уже есть (как у Online Mod)
    var mode = 'load-time'

    try {
        if (Lampa.SettingsApi) register()
        else throw new Error('no SettingsApi yet')
    } catch (e) {
        mode = 'after-ready'
    }

    function afterReady() {
        if (mode === 'after-ready') register()
        hook()
        log('registered: ' + mode)
    }

    if (window.appready) afterReady()
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') afterReady() })
})()
