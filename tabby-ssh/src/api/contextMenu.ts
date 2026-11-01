import { MenuItemOptions } from 'tabby-core'
import { SFTPFile } from '../session/sftp'
import { SFTPPanelComponent } from '../components/sftpPanel.component'

/**
 * Extend to add items to the SFTPPanel context menu
 */
export abstract class SFTPContextMenuItemProvider {
    weight = 0
    supportsEditing = false

    abstract getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]>

    /** Open a file in a local editor, when this provider supports editing. */
    async editFile (_item: SFTPFile, _panel: SFTPPanelComponent): Promise<boolean> {
        return false
    }
}
