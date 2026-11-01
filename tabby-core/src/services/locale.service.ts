import { Injectable, Pipe, PipeTransform } from '@angular/core'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { formatDate, registerLocaleData } from '@angular/common'
import { TranslateService, MissingTranslationHandler } from '@ngx-translate/core'
import { TranslateMessageFormatCompiler } from 'ngx-translate-messageformat-compiler'

import localeENUS from '@angular/common/locales/en'
import localeENGB from '@angular/common/locales/en-GB'
import localeAF from '@angular/common/locales/af'
import localeBG from '@angular/common/locales/bg'
import localeCS from '@angular/common/locales/cs'
import localeDA from '@angular/common/locales/da'
import localeDE from '@angular/common/locales/de'
import localeES from '@angular/common/locales/es'
import localeFR from '@angular/common/locales/fr'
import localeHR from '@angular/common/locales/hr'
import localeID from '@angular/common/locales/id'
import localeIT from '@angular/common/locales/it'
import localeJA from '@angular/common/locales/ja'
import localeKO from '@angular/common/locales/ko'
import localePL from '@angular/common/locales/pl'
import localePT from '@angular/common/locales/pt'
import localeRU from '@angular/common/locales/ru'
import localeSRSP from '@angular/common/locales/sr-Cyrl'
import localeSV from '@angular/common/locales/sv'
import localeTR from '@angular/common/locales/tr'
import localeUK from '@angular/common/locales/uk'
import localeZH from '@angular/common/locales/zh'
import { Observable, Subject } from 'rxjs'
import { distinctUntilChanged } from 'rxjs/operators'
import { ConfigService } from './config.service'
import { LogService, Logger } from './log.service'

registerLocaleData(localeENUS)
registerLocaleData(localeENGB)
registerLocaleData(localeAF)
registerLocaleData(localeBG)
registerLocaleData(localeCS)
registerLocaleData(localeDA)
registerLocaleData(localeDE)
registerLocaleData(localeES)
registerLocaleData(localeFR)
registerLocaleData(localeHR)
registerLocaleData(localeID)
registerLocaleData(localeIT)
registerLocaleData(localeJA)
registerLocaleData(localeKO)
registerLocaleData(localePL)
registerLocaleData(localePT)
registerLocaleData(localeRU)
registerLocaleData(localeSRSP)
registerLocaleData(localeSV)
registerLocaleData(localeTR)
registerLocaleData(localeUK)
registerLocaleData(localeZH)

function flattenMessageFormatTranslation (po: any) {
    const translation = {}
    for (const context of Object.keys(po.translations)) {
        const messages = po.translations[context]
        for (const k of Object.keys(messages)) {
            translation[k] ??= messages[k].msgstr[0] || k
        }
    }
    return translation
}

export class CustomMissingTranslationHandler extends MissingTranslationHandler {
    compiler = new TranslateMessageFormatCompiler()

    // eslint-disable-next-line @typescript-eslint/ban-types
    handle (params: { key: string, translateService: TranslateService, interpolateParams?: Object }): any {
        const v = this.compiler.compile(params.key, params.translateService.currentLang)
        if (typeof v === 'string') {
            return v
        }
        return v(params.interpolateParams)
    }
}

@Injectable({ providedIn: 'root' })
export class LocaleService {
    private logger: Logger

    static allLanguages: { code: string, name: string }[] = [
        {
            code: 'af-ZA',
            name: _('Afrikaans'),
        },
        {
            code: 'id-ID',
            name: _('Bahasa Indonesia'),
        },
        {
            code: 'cs-CZ',
            name: _('Čeština'),
        },
        {
            code: 'da-DK',
            name: _('Dansk'),
        },
        {
            code: 'de-DE',
            name: _('Deutsch'),
        },
        {
            code: 'en-GB',
            name: _('English (UK)'),
        },
        {
            code: 'en-US',
            name: _('English (US)'),
        },
        {
            code: 'es-ES',
            name: _('Español'),
        },
        {
            code: 'fr-FR',
            name: _('Français'),
        },
        {
            code: 'hr-HR',
            name: _('Hrvatski'),
        },
        {
            code: 'it-IT',
            name: _('Italiano'),
        },
        {
            code: 'pl-PL',
            name: _('Polski'),
        },
        {
            code: 'pt-PT',
            name: _('Português'),
        },
        {
            code: 'pt-BR',
            name: _('Português do Brasil'),
        },
        {
            code: 'sv-SE',
            name: _('Svenska'),
        },
        {
            code: 'tr-TR',
            name: _('Türkçe'),
        },
        {
            code: 'bg-BG',
            name: _('Български'),
        },
        {
            code: 'ru-RU',
            name: _('Русский'),
        },
        {
            code: 'sr-SP',
            name: _('Српски'),
        },
        {
            code: 'uk-UA',
            name: _('Українська'),
        },
        {
            code: 'ja-JP',
            name: _('日本語'),
        },
        {
            code: 'ko-KR',
            name: _('한국어'),
        },
        {
            code: 'zh-CN',
            name: _('中文（简体）'),
        },
        {
            code: 'zh-TW',
            name: _('中文 (繁體)'),
        },
    ]

    get localeChanged$ (): Observable<string> {
        return this.localeChanged.pipe(distinctUntilChanged())
    }

    private locale = 'zh-CN'
    private localeChanged = new Subject<string>()

    constructor (
        private config: ConfigService,
        private translate: TranslateService,
        log: LogService,
    ) {
        this.patchTranslateService(translate)
        this.logger = log.create('translate')
        config.changed$.subscribe(() => {
            this.refresh()
        })
        config.ready$.subscribe(() => {
            this.refresh()
        })

        const d = new Date()
        if (d.getMonth() === 3 && d.getDate() === 1) {
            LocaleService.allLanguages.find(x => x.code === 'en-US')!.name = _('English (simplified)')
            LocaleService.allLanguages.find(x => x.code === 'en-GB')!.name = _('English (traditional)')
        }
    }

    private patchTranslateService (translate: TranslateService) {
        translate['_defaultTranslation'] = null
        const oldGetParsedResult = translate.getParsedResult.bind(translate)

        // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
        translate.getParsedResult = function (translations: any, key: any, interpolateParams?: any): any {
            if (!this._defaultTranslation) {
                const po = require(`../../../locale/en-US.po`)
                this._defaultTranslation = flattenMessageFormatTranslation(po)
            }
            this.translations[this.defaultLang][key] ??= this.compiler.compile(
                this._defaultTranslation[key] || key,
                this.defaultLang,
            )
            return oldGetParsedResult(translations, key, interpolateParams ?? {})
        }.bind(translate)
    }

    refresh (): void {
        const lang = this.config.store.language ?? 'zh-CN'
        this.setLocale(lang)
    }

    async setLocale (lang: string): Promise<void> {
        if (!this.translate.langs.includes(lang)) {
            this.translate.addLangs([lang])

            const po = require(`../../../locale/${lang}.po`)
            const translation = flattenMessageFormatTranslation(po)
            this.translate.setTranslation(lang, translation)
        }

        this.translate.setDefaultLang(lang)

        this.locale = lang
        this.localeChanged.next(lang)
        this.logger.debug('Setting language to', lang)
    }

    getLocale (): string {
        return this.locale
    }
}

@Pipe({
    name: 'tabbyDate',
})
export class TabbyFormatedDatePipe implements PipeTransform {

    constructor (private locale: LocaleService) {}

    transform (date: string): string {
        return formatDate(date, 'medium', this.locale.getLocale())
    }
}
