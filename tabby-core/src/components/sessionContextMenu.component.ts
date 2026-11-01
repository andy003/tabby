import { ChangeDetectorRef, Component, ElementRef, HostListener, ViewChild } from '@angular/core'

export interface SessionContextMenuItem {
    label?: string
    icon?: string
    type?: 'separator'
    enabled?: boolean
    click?: () => void
}

/** @hidden */
@Component({
    selector: 'session-context-menu',
    templateUrl: './sessionContextMenu.component.pug',
    styleUrls: ['./sessionContextMenu.component.scss'],
})
export class SessionContextMenuComponent {
    @ViewChild('menu') menu: ElementRef<HTMLElement>|undefined
    items: SessionContextMenuItem[] = []
    title = ''
    visible = false
    x = 0
    y = 0
    private previousFocus: HTMLElement|null = null

    constructor (private changeDetector: ChangeDetectorRef) { }

    open (items: SessionContextMenuItem[], event: MouseEvent, title = ''): void {
        this.items = items.filter(item => item.enabled !== false)
            .filter((item, index, list) => item.type !== 'separator' || (index > 0 && index < list.length - 1 && list[index - 1].type !== 'separator'))
        this.title = title
        this.previousFocus = event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>('button') ?? (document.activeElement as HTMLElement|null)
            : document.activeElement as HTMLElement|null
        const anchor = event.target instanceof HTMLElement ? event.target.closest('button')?.getBoundingClientRect() : undefined
        const keyboard = event.clientX === 0 && event.clientY === 0
        this.x = keyboard ? (anchor?.left ?? 8) : event.clientX + 2
        this.y = keyboard ? (anchor?.bottom ?? 8) : event.clientY + 2
        this.visible = true
        this.changeDetector.detectChanges()
        const bounds = this.menu!.nativeElement.getBoundingClientRect()
        this.x = Math.max(8, Math.min(this.x, window.innerWidth - bounds.width - 8))
        this.y = Math.max(8, Math.min(this.y, window.innerHeight - bounds.height - 8))
        this.changeDetector.detectChanges()
        this.menu!.nativeElement.querySelector('button')?.focus({ preventScroll: true })
    }

    close (restoreFocus = true): void {
        if (!this.visible) { return }
        this.visible = false
        if (restoreFocus && this.previousFocus?.isConnected) {
            this.previousFocus.focus({ preventScroll: true })
        }
    }

    run (item: SessionContextMenuItem): void {
        this.close()
        item.click?.()
    }

    onKeyDown (event: KeyboardEvent): void {
        const buttons = Array.from(this.menu!.nativeElement.querySelectorAll('button'))
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        let next = index
        if (event.key === 'ArrowDown') {
            next = (index + 1) % buttons.length
        } else if (event.key === 'ArrowUp') {
            next = (index - 1 + buttons.length) % buttons.length
        } else if (event.key === 'Home') {
            next = 0
        } else if (event.key === 'End') {
            next = buttons.length - 1
        } else if (event.key === 'Escape' || event.key === 'Tab') {
            this.close()
        } else {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        if (this.visible) { buttons[next].focus({ preventScroll: true }) }
    }

    @HostListener('document:pointerdown', ['$event'])
    onPointerDown (event: PointerEvent): void {
        if (event.target instanceof Node && !this.menu?.nativeElement.contains(event.target)) { this.close(false) }
    }

    @HostListener('window:blur')
    @HostListener('window:resize')
    onWindowChange (): void {
        this.close(false)
    }

    @HostListener('document:wheel', ['$event'])
    onWheel (event: WheelEvent): void {
        if (event.target instanceof Node && !this.menu?.nativeElement.contains(event.target)) { this.close(false) }
    }
}
