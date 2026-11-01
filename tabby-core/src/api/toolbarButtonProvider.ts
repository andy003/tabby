/**
 * See [[ToolbarButtonProvider]]
 */
export interface ToolbarButton {
    /** Stable command ID for menus and keyboard-driven interfaces. */
    id?: string
    /**
     * Raw SVG icon code
     */
    icon?: string

    title: string

    /**
     * Optional Touch Bar icon ID
     */
    touchBarNSImage?: string

    /**
     * Optional Touch Bar button label
     */
    touchBarTitle?: string

    weight?: number

    click?: () => void

    submenu?: () => Promise<ToolbarButton[]>

    /** @hidden */
    submenuItems?: ToolbarButton[]
}

/**
 * Extend to add buttons to the toolbar
 */
export abstract class ToolbarButtonProvider {
    abstract provide (): ToolbarButton[]
}
