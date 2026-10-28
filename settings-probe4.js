/*
 * Пробный плагин 4.
 * 1) Журнал на экране: после закрытия списка показывает ВИДИМОЕ состояние страницы
 *    (положение панели, первый пункт, прокрутка, какой элемент лежит поверх).
 * 2) Переключатель «Обходной путь»: после закрытия списка страница настроек перерисовывается
 *    через Lampa.Settings.update().
 */
(function () {
    'use strict'

    if (window.probe4_ready) return
    window.probe4_ready = true

    var t0 = Date.now()
    var lines = []
    var box = null

    function log(text) {
        lines.push((Date.now() - t0) + ' ' + text)
        if (lines.length > 26) lines.shift()

        if (!box) {
            box = $('<div></div>').css({
                position: 'fixed', left: 0, bottom: 0, zIndex: 999999,
                background: 'rgba(0,0,0,0.85)', color: '#7CFC00',
                font: '15px monospace', padding: '6px 10px',
                whiteSpace: 'pre', pointerEvents: 'none', maxWidth: '62%'
            })
            $('body').append(box)
        }

        box.text(lines.join('\n'))
        try { console.log('[Probe4]', text) } catch (e) {}
    }

    function ctrlName() {
        try { return (Lampa.Controller.enabled() || {}).name } catch (e) { return '?' }
    }

    function fixEnabled() {
        return String(Lampa.Storage.field('probe4_fix')) === 'true'
    }

    function vis(tag) {
        try {
            var p = $('.settings__body .settings-param').first()
            var r = p.length ? p[0].getBoundingClientRect() : null
            var cs = p.length ? getComputedStyle(p[0]) : null
            var pc = $('.settings__content')[0]
            var pr = pc ? pc.getBoundingClientRect() : null
            var sb = $('.settings__body .scroll__body').first()
            var cx = Math.round(window.innerWidth * 0.85)
            var cy = Math.round(window.innerHeight / 2)
            var el = null
            try { el = document.elementFromPoint(cx, cy) } catch (e) {}
            var flags = (document.body.className.match(/settings--open|selectbox--open/g) || []).join(',')

            log(tag + ' body=' + flags + ' ctrl=' + ctrlName() +
                ' panel.left=' + (pr ? Math.round(pr.left) : '-') + ' w=' + (pr ? Math.round(pr.width) : '-'))
            log('   p1 rect(top/left/w/h)=' + (r ? [r.top, r.left, r.width, r.height].map(Math.round).join('/') : 'none') +
                ' op=' + (cs ? cs.opacity : '-') + ' vis=' + (cs ? cs.visibility : '-'))
            log('   scroll=' + (sb.length ? (sb[0].style.transform || 'none') : '-') +
                ' at(' + cx + ',' + cy + ')=' + (el ? el.tagName + '.' + String(el.className).split(' ').slice(0, 2).join('.') : 'null'))
        } catch (e) {
            log(tag + ' vis error ' + e)
        }
    }

    var ICON = '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
               '<circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="4"/>' +
               '<path d="M24 12v12l8 5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>'

    function register() {
        Lampa.SettingsApi.addComponent({ component: 'probe4', name: 'Probe 4', icon: ICON })

        Lampa.SettingsApi.addParam({
            component: 'probe4',
            param: { name: 'probe4_fix', type: 'trigger', default: false },
            field: { name: 'Обходной путь: перерисовать страницу после списка' }
        })

        Lampa.SettingsApi.addParam({
            component: 'probe4',
            param: { name: 'probe4_a', type: 'select', values: { '10': '10 sec', '20': '20 sec', '30': '30 sec' }, default: '20' },
            field: { name: 'Список A' }
        })
    }

    function hook() {
        var ver = ''
        try { ver = Lampa.Manifest.app_version } catch (e) {}
        log('probe4 ready, version=' + ver)

        Lampa.Settings.listener.follow('open', function (e) {
            log('settings open: ' + e.name)
            if (e.name === 'probe4') setTimeout(function () { vis('BASE') }, 500)
        })

        Lampa.Controller.listener.follow('toggle', function (e) {
            log('ctrl -> ' + e.name)
            if (e.name === 'settings_component') setTimeout(function () { vis('AFTER') }, 400)
        })

        // 'hide' срабатывает и при выборе значения, и при выходе кнопкой «Назад»
        Lampa.Select.listener.follow('hide', function () {
            log('select hide, fix=' + (fixEnabled() ? 'ON' : 'off'))

            if (fixEnabled()) {
                setTimeout(function () {
                    if (ctrlName() === 'settings_component') {
                        log('Settings.update()')
                        Lampa.Settings.update()
                        setTimeout(function () { vis('FIXED') }, 400)
                    }
                }, 150)
            }
        })

        Lampa.Keypad.listener.follow('keydown', function (e) {
            log('key ' + e.code)
        })
    }

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
