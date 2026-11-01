import { Component, EventEmitter, Input, Output, ViewChild } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { Subscription } from 'rxjs'
import { Command, CommandContext } from '../api/commands'
import { HostWindowService } from '../api/hostWindow'
import { ConfigService } from '../services/config.service'
import { CommandService } from '../services/commands.service'
import { AppService } from '../services/app.service'
import { HomeBaseService } from '../services/homeBase.service'
import { SplitTabComponent } from './splitTab.component'
import { BaseComponent } from './base.component'
import { CustomButton, getCustomButtonInput, isCustomButtonValid } from '../customButtons'
import { CustomButtonsModalComponent } from './customButtonsModal.component'
import { SessionContextMenuComponent, SessionContextMenuItem } from './sessionContextMenu.component'
import { NotificationsService } from '../services/notifications.service'
import { TranslateService } from '@ngx-translate/core'

/** @hidden */
@Component({
    selector: 'workspace-toolbar',
    templateUrl: './workspaceToolbar.component.pug',
    styleUrls: ['./workspaceToolbar.component.scss'],
})
export class WorkspaceToolbarComponent extends BaseComponent {
    @Output() homeRequested = new EventEmitter<void>()
    @Output() workspaceRequested = new EventEmitter<void>()
    @Input() transfersVisible = false
    @Output() transfersRequested = new EventEmitter<void>()
    @ViewChild(SessionContextMenuComponent) buttonContextMenu: SessionContextMenuComponent
    availableCommands = new Map<string, Command>()
    private commandRevision = 0
    private splitFocusSubscription: Subscription|null = null

    constructor (
        public app: AppService,
        public config: ConfigService,
        public hostWindow: HostWindowService,
        public homeBase: HomeBaseService,
        public commands: CommandService,
        private modal: NgbModal,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) {
        super()
    }

    ngOnInit (): void {
        this.observeActiveTab()
        this.subscribeUntilDestroyed(this.app.activeTabChange$, () => this.observeActiveTab())
        this.subscribeUntilDestroyed(this.app.tabsChanged$, () => this.refreshCommands())
        this.subscribeUntilDestroyed(this.config.changed$, () => this.refreshCommands())
    }

    private get context (): CommandContext {
        const tab = this.app.activeTab
        return { tab: tab instanceof SplitTabComponent ? tab.getFocusedTab() ?? tab.getAllTabs()[0] : tab ?? undefined }
    }

    get customButtons (): CustomButton[] {
        return this.config.store.customButtonBar.buttons
    }

    customButtonEnabled (button: CustomButton): boolean {
        return isCustomButtonValid(button) && (button.action === 'send-text'
            ? !!this.context.tab?.canSendCustomInput
            : this.availableCommands.has(button.commandId))
    }

    async runCustomButton (button: CustomButton): Promise<void> {
        if (!this.customButtonEnabled(button)) { return }
        const context = this.context
        this.workspaceRequested.emit()
        try {
            if (button.action === 'send-text') {
                context.tab?.sendCustomInput(getCustomButtonInput(button))
            } else {
                await this.commands.run(button.commandId, context)
                await this.refreshCommands()
            }
        } catch (error) {
            this.notifications.error(this.translate.instant('Could not run custom button'), String(error))
        }
    }

    async editCustomButtons (addNew = false, selectedId: string|null = null): Promise<void> {
        const commands = (await this.commands.getCommands(this.context))
            .filter(command => command.id && !command.id.startsWith('core:recent-profile-'))
            .filter((command, index, all) => all.findIndex(other => other.id === command.id) === index)
            .sort((a, b) => a.label.localeCompare(b.label))
        const dialog = this.modal.open(CustomButtonsModalComponent, {
            size: 'lg',
            beforeDismiss: () => !dialog.componentInstance.saving,
        })
        dialog.componentInstance.commands = commands
        dialog.componentInstance.addNew = addNew
        dialog.componentInstance.selectedId = selectedId
        await dialog.result.catch(() => null)
    }

    async toggleCustomButtonBar (): Promise<void> {
        const previous = this.config.store.customButtonBar.visible
        this.config.store.customButtonBar.visible = !previous
        try {
            await this.config.save()
        } catch (error) {
            this.config.store.customButtonBar.visible = previous
            this.notifications.error(this.translate.instant('Could not save custom buttons'), String(error))
        }
    }

    showButtonContextMenu (event: MouseEvent, button?: CustomButton): void {
        event.preventDefault()
        event.stopPropagation()
        const items: SessionContextMenuItem[] = []
        if (button) {
            items.push({ label: this.translate.instant('Edit button'), icon: 'fas fa-pen', click: () => this.editCustomButtons(false, button.id) })
            items.push({ type: 'separator' })
        }
        items.push(
            { label: this.translate.instant('Add button'), icon: 'fas fa-plus', click: () => this.editCustomButtons(true) },
            { label: this.translate.instant('Manage buttons'), icon: 'fas fa-sliders', click: () => this.editCustomButtons() },
            { label: this.translate.instant('Hide button bar'), icon: 'far fa-eye-slash', click: () => this.toggleCustomButtonBar() },
        )
        this.buttonContextMenu.open(items, event, this.translate.instant('Custom buttons'))
    }

    private observeActiveTab (): void {
        this.splitFocusSubscription?.unsubscribe()
        const tab = this.app.activeTab
        this.splitFocusSubscription = tab instanceof SplitTabComponent
            ? tab.focusChanged$.subscribe(() => this.refreshCommands())
            : null
        this.refreshCommands()
    }

    ngOnDestroy (): void {
        this.splitFocusSubscription?.unsubscribe()
        super.ngOnDestroy()
    }

    private async refreshCommands (): Promise<void> {
        const revision = ++this.commandRevision
        const commands = await this.commands.getCommands(this.context)
        if (revision === this.commandRevision) {
            this.availableCommands = new Map(commands.filter(c => c.id).map(c => [c.id!, c]))
        }
    }

    async run (id: string): Promise<void> {
        if (id.startsWith('terminal:') || id.startsWith('ssh:')) {
            this.workspaceRequested.emit()
        }
        await this.commands.run(id, this.context)
        await this.refreshCommands()
    }

    async toggleSessions (): Promise<void> {
        this.config.store.showProfileTree = !this.config.store.showProfileTree
        await this.config.save()
    }

    async closeTab (): Promise<void> {
        if (this.app.activeTab) {
            await this.app.closeTab(this.app.activeTab, true)
        }
    }
}
