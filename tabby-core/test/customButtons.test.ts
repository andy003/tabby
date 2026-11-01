import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getCustomButtonInput, isCustomButtonValid } from '../src/customButtons.ts'
import type { CustomButton } from '../src/customButtons.ts'

function button (overrides: Partial<CustomButton> = {}): CustomButton {
    return {
        id: 'test-button', label: 'List files', action: 'send-text', text: 'ls -lah',
        commandId: '', appendNewline: true, interpretEscapes: false, ...overrides,
    }
}

describe('Custom button terminal input', () => {
    it('uses carriage return to execute a command and can leave input unsubmitted', () => {
        assert.equal(getCustomButtonInput(button()), 'ls -lah\r')
        assert.equal(getCustomButtonInput(button({ appendNewline: false })), 'ls -lah')
    })

    it('normalizes multiline input and does not submit an extra empty command', () => {
        assert.equal(getCustomButtonInput(button({ text: 'pwd\r\nls\n' })), 'pwd\rls\r')
        assert.equal(getCustomButtonInput(button({ text: 'pwd\r' })), 'pwd\r')
    })

    it('preserves shell backslashes and expressions unless escape handling is enabled', () => {
        const text = String.raw`printf '\n%s\n' "$HOME"`
        assert.equal(getCustomButtonInput(button({ text, appendNewline: false })), text)
    })

    it('supports Enter, Tab, Escape and hexadecimal control characters', () => {
        const text = String.raw`pwd\rwhoami\n\t\e\x03`
        assert.equal(getCustomButtonInput(button({ text, interpretEscapes: true, appendNewline: false })), 'pwd\rwhoami\r\t\x1b\x03')
    })

    it('decodes escapes once and preserves unknown or incomplete sequences', () => {
        const text = String.raw`\\n\q\x0`
        assert.equal(getCustomButtonInput(button({ text, interpretEscapes: true, appendNewline: false })), String.raw`\n\q\x0`)
    })

    it('does not append a second Enter after an escaped Enter', () => {
        assert.equal(getCustomButtonInput(button({ text: String.raw`pwd\r`, interpretEscapes: true })), 'pwd\r')
    })
})

describe('Custom button validation', () => {
    it('requires a nonempty label and input, allowing meaningful whitespace input', () => {
        assert.equal(isCustomButtonValid(button()), true)
        assert.equal(isCustomButtonValid(button({ label: '  ' })), false)
        assert.equal(isCustomButtonValid(button({ text: '' })), false)
        assert.equal(isCustomButtonValid(button({ text: ' ' })), true)
    })

    it('validates application commands independently of terminal text', () => {
        assert.equal(isCustomButtonValid(button({ action: 'command', commandId: 'settings:open', text: '' })), true)
        assert.equal(isCustomButtonValid(button({ action: 'command', commandId: '' })), false)
    })
})
