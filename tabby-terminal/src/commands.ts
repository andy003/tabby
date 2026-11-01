import { Injectable } from '@angular/core'
import { Command, CommandContext, CommandProvider, SplitTabComponent, TranslateService } from 'tabby-core'
import { BaseTerminalTabComponent } from './api/baseTerminalTab.component'
import { MultifocusService } from './services/multifocus.service'

/** @hidden */
@Injectable()
export class TerminalCommandProvider extends CommandProvider {
    constructor (
        private multifocus: MultifocusService,
        private translate: TranslateService,
    ) { super() }

    async provide (context: CommandContext): Promise<Command[]> {
        const tab = context.tab
        if (!(tab instanceof BaseTerminalTabComponent)) { return [] }
        const parent = tab.parent
        const multifocus = this.multifocus
        const commands: Command[] = [{
            id: 'terminal:multiexec',
            label: this.translate.instant('MultiExec'),
            get checked (): boolean { return multifocus.isActive },
            run: async () => {
                if (this.multifocus.isActive) {
                    this.multifocus.cancel()
                } else {
                    this.multifocus.focusAllTabs()
                }
                tab.frontend?.focus()
            },
        }]
        if (parent instanceof SplitTabComponent) {
            commands.push(
                { id: 'terminal:split-right', label: this.translate.instant('Split vertically'), run: async () => { await parent.splitTab(tab, 'r') } },
                { id: 'terminal:split-bottom', label: this.translate.instant('Split horizontally'), run: async () => { await parent.splitTab(tab, 'b') } },
            )
        }
        return commands
    }
}
