// Check the simplified Chinese catalog against the UI sources before adding new text.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { GettextExtractor, JsExtractors, HtmlExtractors } from 'gettext-extractor'
import pug from 'pug'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const extractorRequire = createRequire(require.resolve('gettext-extractor'))
const parse5 = extractorRequire('parse5')
const catalog = extractorRequire('pofile').parse(fs.readFileSync(path.join(root, 'locale/zh-CN.po'), 'utf8'))
const key = (text, context) => `${context ?? ''}\u0000${text}`
const translations = new Map()
for (const item of catalog.items) {
    if (item.obsolete) { continue }
    const id = key(item.msgid, item.msgctxt)
    if (translations.has(id)) { throw new Error(`Duplicate Chinese translation: ${item.msgid}`) }
    translations.set(id, item.msgstr[0])
}

const extractor = new GettextExtractor()
extractor.createJsParser([
    JsExtractors.callExpression('this.translate.instant', { arguments: { text: 0 } }),
    JsExtractors.callExpression('translate.instant', { arguments: { text: 0 } }),
    JsExtractors.callExpression('_', { arguments: { text: 0 } }),
]).parseFilesGlob(path.join(root, 'tabby-*/src/**/*.ts'))
const html = extractor.createHtmlParser([
    HtmlExtractors.elementContent('translate, [translate=""]', { attributes: { context: 'translatecontext' } }),
    HtmlExtractors.elementAttribute('[translate*=" "]', 'translate', { attributes: { context: 'translatecontext' } }),
])
// These identify software, keys or wire-level values rather than UI prose.
const identifiers = new Set(['Tabby', 'Windows Terminal', 'Cygwin', 'RTS / CTS', 'XON', 'XOFF', 'Xany', 'Ctrl', 'Shift', 'SSH', 'Pageant', 'HMAC', 'xterm-256color'])
const untranslatedLiterals = new Set()

function checkLiterals (document, file, translated = false) {
    const attributes = document.attrs ?? []
    translated ||= attributes.some(attribute => attribute.name === 'translate')
    const check = value => {
        value = value.replace(/\{\{[\s\S]*?\}\}/g, '').trim()
        if (/[A-Za-z]{2}/.test(value) && !identifiers.has(value)) {
            untranslatedLiterals.add(`${file}: ${value}`)
        }
    }
    if (document.nodeName === '#text' && !translated) { check(document.value) }
    for (const attribute of attributes.filter(item => ['title', 'placeholder', 'aria-label'].includes(item.name))) {
        check(attribute.value)
    }
    for (const child of document.childNodes ?? []) { checkLiterals(child, file, translated) }
    if (document.content) { checkLiterals(document.content, file, translated) }
}

function templates (directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const name = path.join(directory, entry.name)
        return entry.isDirectory() ? templates(name) : entry.name.endsWith('.pug') ? [name] : []
    })
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const source = path.join(root, entry.name, 'src')
    if (!entry.isDirectory() || !entry.name.startsWith('tabby-') || !fs.existsSync(source)) { continue }
    for (const file of templates(source)) {
        // Rendering also catches broken Pug attributes. SVG content is irrelevant to translation.
        const rendered = pug.renderFile(file, { doctype: 'html', require: () => '' })
        const relative = path.relative(root, file)
        html.parseString(rendered, relative)
        // The color preview deliberately contains sample command output and filenames.
        if (!file.endsWith('colorSchemePreview.component.pug')) {
            checkLiterals(parse5.parseFragment(rendered), relative)
        }
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/(['"])([^'"\n]+)\1\s*\|\s*translate/g)) {
            extractor.addMessage({ text: match[2], references: [path.relative(root, file)] })
        }
    }
}

// Labels selected by expressions cannot be extracted as a single string literal.
for (const text of [
    'User sessions', 'Recent sessions', 'Open tabs', 'SFTP browser',
    'Start local terminal', 'Start a session', 'Imported from .ssh/config',
]) {
    extractor.addMessage({ text })
}
const missing = extractor.getMessages().filter(message => !translations.get(key(message.text, message.context)))
if (untranslatedLiterals.size) {
    console.error('UI text must use the translation service:')
    for (const literal of untranslatedLiterals) { console.error(`  ${literal}`) }
    process.exitCode = 1
}
if (missing.length) {
    console.error('Missing simplified Chinese translations:')
    for (const message of missing) { console.error(`  ${message.text}`) }
    process.exitCode = 1
} else if (!untranslatedLiterals.size) {
    console.log(`Simplified Chinese translations cover ${extractor.getMessages().length} UI messages.`)
}
