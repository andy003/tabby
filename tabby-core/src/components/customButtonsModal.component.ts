import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { v4 as uuidv4 } from 'uuid'
import { Command } from '../api/commands'
import { CustomButton, isCustomButtonValid } from '../customButtons'
import { ConfigService } from '../services/config.service'
import { NotificationsService } from '../services/notifications.service'
import { TranslateService } from '@ngx-translate/core'

/** @hidden */
@Component({
    templateUrl: './customButtonsModal.component.pug',
    styleUrls: ['./customButtonsModal.component.scss'],
})
export class CustomButtonsModalComponent {
    @Input() commands: Command[] = []
    @Input() addNew = false
    @Input() selectedId: string|null = null
    buttons: CustomButton[] = []
    saving = false

    constructor (
        public modal: NgbActiveModal,
        private config: ConfigService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    ngOnInit (): void {
        this.buttons = this.config.store.customButtonBar.buttons.map((button: CustomButton) => ({ ...button }))
        if (this.addNew || !this.buttons.length) {
            this.addButton()
        } else {
            this.selectedId ??= this.buttons[0].id
        }
    }

    get selected (): CustomButton|undefined {
        return this.buttons.find(button => button.id === this.selectedId)
    }

    get selectedIndex (): number {
        return this.buttons.findIndex(button => button.id === this.selectedId)
    }

    get valid (): boolean {
        return this.buttons.every(isCustomButtonValid)
    }

    get selectedCommandAvailable (): boolean {
        return this.commands.some(command => command.id === this.selected?.commandId)
    }

    addButton (): void {
        const button: CustomButton = {
            id: uuidv4(), label: '', action: 'send-text', text: '', commandId: '',
            appendNewline: true, interpretEscapes: false,
        }
        this.buttons.push(button)
        this.selectedId = button.id
    }

    removeButton (): void {
        const index = this.selectedIndex
        if (index < 0) { return }
        this.buttons.splice(index, 1)
        this.selectedId = this.buttons[Math.min(index, this.buttons.length - 1)]?.id ?? null
    }

    moveButton (offset: number): void {
        const index = this.selectedIndex
        const target = index + offset
        if (index < 0 || target < 0 || target >= this.buttons.length) { return }
        const [button] = this.buttons.splice(index, 1)
        this.buttons.splice(target, 0, button)
    }

    async save (): Promise<void> {
        if (!this.valid || this.saving) { return }
        this.saving = true
        const previous = this.config.store.customButtonBar.buttons
        this.config.store.customButtonBar.buttons = this.buttons.map(button => ({ ...button, label: button.label.trim() }))
        try {
            await this.config.save()
            this.modal.close()
        } catch (error) {
            this.config.store.customButtonBar.buttons = previous
            this.notifications.error(this.translate.instant('Could not save custom buttons'), String(error))
        } finally {
            this.saving = false
        }
    }
}
