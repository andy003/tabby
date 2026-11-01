export interface CustomButton {
    id: string
    label: string
    action: 'send-text'|'command'
    text: string
    commandId: string
    appendNewline: boolean
    interpretEscapes: boolean
}

/** Convert configured text into terminal input without evaluating shell syntax. */
export function getCustomButtonInput (button: CustomButton): string {
    let text = button.text
    if (button.interpretEscapes) {
        const escapes: Record<string, string> = { r: '\r', n: '\n', t: '\t', e: '\x1b', '\\': '\\' }
        text = text.replace(/\\(x[0-9a-f]{2}|[rnte\\])/gi, (_match, code: string) =>
            code[0].toLowerCase() === 'x'
                ? String.fromCharCode(parseInt(code.slice(1), 16))
                : escapes[code.toLowerCase()])
    }
    text = text.replace(/\r\n|\n/g, '\r')
    return button.appendNewline && !text.endsWith('\r') ? text + '\r' : text
}

export function isCustomButtonValid (button: CustomButton): boolean {
    return !!button.label.trim() && (button.action === 'send-text'
        ? button.text.length > 0
        : !!button.commandId.trim())
}
