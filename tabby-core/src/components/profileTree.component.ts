import { Component, HostBinding, HostListener, Input, Output, EventEmitter, TemplateRef, SimpleChanges, ViewChild } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import deepClone from 'clone-deep'
import FuzzySearch from 'fuzzy-search'

import { ConfigService } from '../services/config.service'
import { ProfilesService } from '../services/profiles.service'
import { AppService } from '../services/app.service'
import { ProfileProvider } from '../api/index'
import { PartialProfileGroup, ProfileGroup, PartialProfile, Profile } from '../index'
import { BaseComponent } from './base.component'
import { SplitTabComponent } from './splitTab.component'
import { BaseTabComponent } from './baseTab.component'
import { CommandService } from '../services/commands.service'
import { NotificationsService } from '../services/notifications.service'
import { RenameTabModalComponent } from './renameTabModal.component'
import { SessionContextMenuComponent } from './sessionContextMenu.component'

interface CollapsableProfileGroup extends ProfileGroup {
    collapsed: boolean
    children: PartialProfileGroup<CollapsableProfileGroup>[]
}

/** @hidden */
@Component({
    selector: 'profile-tree',
    styleUrls: ['./profileTree.component.scss'],
    templateUrl: './profileTree.component.pug',
})
export class ProfileTreeComponent extends BaseComponent {
    @ViewChild(SessionContextMenuComponent) contextMenu: SessionContextMenuComponent
    profileGroups: PartialProfileGroup<ProfileGroup>[] = []
    rootGroups: PartialProfileGroup<ProfileGroup>[] = []

    filteredProfiles: PartialProfile<Profile>[] = []
    @Input() filter = ''
    quickConnectQuery = ''
    connecting = false
    page: 'sessions'|'recent'|'open'|'files' = 'sessions'
    @Input() contentTemplate: TemplateRef<unknown>|null = null
    @Output() sidebarClosed = new EventEmitter<void>()
    recentProfiles: PartialProfile<Profile>[] = []
    draggedProfileId: string|null = null
    dropTargetId: string|null = null
    private savedProfileIds = new Set<string>()
    private expandGroupTimeout: ReturnType<typeof setTimeout>|null = null
    private savingMove = false


    panelMinWidth = 200
    panelMaxWidth = 600
    panelInternalWidth: number = Math.min(600, Math.max(200, parseInt(window.localStorage.profileTreeWidth ?? '250') || 250))
    panelStartWidth = this.panelInternalWidth
    panelIsResizing = false
    panelStartX = 0

    constructor (
        public app: AppService,
        public config: ConfigService,
        public commands: CommandService,
        private profilesService: ProfilesService,
        private translate: TranslateService,
        private notifications: NotificationsService,
        private ngbModal: NgbModal,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        await this.loadTreeItems()
        this.subscribeUntilDestroyed(this.config.changed$, () => this.loadTreeItems())
        this.subscribeUntilDestroyed(this.app.tabsChanged$, () => this.tabStateChanged())
        this.subscribeUntilDestroyed(this.app.activeTabChange$, () => this.tabStateChanged())
    }


    ngOnChanges (changes: SimpleChanges): void {
        if (Object.keys(changes).includes('contentTemplate')) {
            if (this.contentTemplate) {
                this.page = 'files'
            } else if (this.page === 'files') {
                this.page = 'sessions'
            }
        }
    }

    selectPage (page: 'sessions'|'recent'|'open'|'files'): void {
        this.page = page
        if (page !== 'files') { this.sidebarClosed.emit() }
    }

    private async loadTreeItems (): Promise<void> {
        this.savedProfileIds = new Set<string>(this.config.store.profiles.filter(p => !p.isBuiltin && !p.isTemplate).map(p => p.id))
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        let groups = await this.profilesService.getProfileGroups({ includeNonUserGroup: true, includeProfiles: true })

        for (const group of groups) {
            if (group.profiles?.length) {
                // remove template profiles
                group.profiles = group.profiles.filter(x => !x.isTemplate)

                // remove blocklisted profiles
                group.profiles = group.profiles.filter(x => x.id && !this.config.store.profileBlacklist.includes(x.id))
            }
        }

        if (!this.config.store.terminal.showBuiltinProfiles) { groups = groups.filter(g => g.id !== 'built-in') }

        groups.sort((a, b) => a.name.localeCompare(b.name))
        groups.sort((a, b) => (a.id === 'built-in' || !a.editable ? 1 : 0) - (b.id === 'built-in' || !b.editable ? 1 : 0))
        groups.sort((a, b) => (a.id === 'ungrouped' ? 0 : 1) - (b.id === 'ungrouped' ? 0 : 1))
        this.profileGroups = groups.map(g => ProfileTreeComponent.intoPartialCollapsableProfileGroup(g, profileGroupCollapsed[g.id] ?? (g.id === 'built-in')))
        this.rootGroups = this.profilesService.buildGroupTree(this.profileGroups)
        await this.onFilterChange()
        this.tabStateChanged()
    }

    private async editProfile (profile: PartialProfile<Profile>): Promise<void> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )

        const provider = this.profilesService.providerForProfile(profile)
        if (!provider) { throw new Error('Cannot edit a profile without a provider') }

        modal.componentInstance.partialProfile = deepClone({ ...profile })
        modal.componentInstance.profileProvider = provider

        const result = await modal.result.catch(() => null)
        if (!result) { return }

        result.type = provider.id

        await this.profilesService.writeProfile(result)
        await this.config.save()
    }

    private async editProfileGroup (group: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        const { EditProfileGroupModalComponent } = window['nodeRequire']('tabby-settings')

        const modal = this.ngbModal.open(
            EditProfileGroupModalComponent,
            { size: 'lg' },
        )

        modal.componentInstance.group = deepClone(group)
        modal.componentInstance.providers = this.profilesService.getProviders()

        const result: PartialProfileGroup<ProfileGroup & { group: PartialProfileGroup<CollapsableProfileGroup>, provider?: ProfileProvider<Profile> }> | null = await modal.result.catch(() => null)
        if (!result) { return }
        if (!result.group) { return }

        if (result.provider) {
            return this.editProfileGroupDefaults(result.group, result.provider)
        }

        delete result.group.collapsed
        delete result.group.children
        await this.profilesService.writeProfileGroup(result.group)
        await this.config.save()
    }

    private async editProfileGroupDefaults (group: PartialProfileGroup<CollapsableProfileGroup>, provider: ProfileProvider<Profile>): Promise<void> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')

        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )
        const model = group.defaults?.[provider.id] ?? {}
        model.type = provider.id
        modal.componentInstance.partialProfile = Object.assign({}, model)
        modal.componentInstance.profileProvider = provider
        modal.componentInstance.defaultsMode = 'group'

        const result = await modal.result.catch(() => null)
        if (result) {
            // Fully replace the config
            for (const k in model) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete model[k]
            }
            Object.assign(model, result)
            if (!group.defaults) {
                group.defaults = {}
            }
            group.defaults[provider.id] = model
        }
        return this.editProfileGroup(group)
    }

    private async renameProfileGroup (group: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        if (!group.editable) { return }
        const modal = this.ngbModal.open(RenameTabModalComponent)
        modal.componentInstance.title = this.translate.instant('Rename group')
        modal.componentInstance.value = group.name
        modal.componentInstance.requireNonEmpty = true
        const result: string|undefined = await modal.result.catch(() => undefined)
        const name = result?.trim()
        const savedGroup = this.config.store.groups.find(g => g.id === group.id)
        if (!name || !savedGroup || name === savedGroup.name) { return }

        const previousName = savedGroup.name
        // Keep the ID and all relationships and defaults intact.
        savedGroup.name = name
        try {
            await this.config.save()
        } catch (error) {
            savedGroup.name = previousName
            this.notifications.error(this.translate.instant('Could not rename group'), error instanceof Error ? error.message : String(error))
        }
        await this.loadTreeItems()
    }

    async profileContextMenu (profile: PartialProfile<Profile>, event: MouseEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()

        this.contextMenu.open([
            {
                label: this.translate.instant('Run'),
                icon: 'fas fa-play',
                click: () => this.launchProfile(profile),
            },
            {
                label: this.translate.instant('Edit profile'),
                icon: 'fas fa-sliders',
                click: () => this.editProfile(profile),
                enabled: !(profile.isBuiltin ?? profile.isTemplate),
            },
            { type: 'separator' },
            { label: this.translate.instant('New session'), icon: 'fas fa-plus', click: () => this.commands.run('settings:new-profile', {}) },
            { label: this.translate.instant('New group'), icon: 'fas fa-folder-plus', click: () => this.newGroup() },
        ], event, profile.name)
    }

    async groupContextMenu (group: PartialProfileGroup<CollapsableProfileGroup>, event: MouseEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        this.contextMenu.open([
            { label: this.translate.instant('New group'), icon: 'fas fa-folder-plus', click: () => this.newGroup() },
            {
                label: this.translate.instant('New subgroup'),
                icon: 'fas fa-folder-tree',
                click: () => this.newGroup(group),
                enabled: !!group.editable,
            },
            { type: 'separator' },
            {
                label: this.translate.instant('Rename group'),
                icon: 'fas fa-pen',
                click: () => this.renameProfileGroup(group),
                enabled: !!group.editable,
            },
            {
                label: this.translate.instant('Edit group'),
                icon: 'fas fa-sliders',
                click: () => this.editProfileGroup(group),
                enabled: group.editable,
            },
            {
                label: group.collapsed ? this.translate.instant('Expand group') : this.translate.instant('Collapse group'),
                icon: group.collapsed ? 'fas fa-angles-down' : 'fas fa-angles-up',
                click: () => this.toggleGroupCollapse(group),
            },
        ], event, group.name || this.translate.instant('Ungrouped'))
    }

    async newGroup (parent?: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        this.config.store.showProfileTree = true
        this.selectPage('sessions')
        this.filter = ''
        await this.onFilterChange()
        if (parent) {
            parent.collapsed = false
            this.saveProfileGroupCollapse(parent)
        }
        await this.editProfileGroup({
            id: 'new',
            name: '',
            icon: 'far fa-folder',
            parentGroupId: parent?.id,
        })
    }

    treeContextMenu (event: MouseEvent): void {
        if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) { return }
        event.preventDefault()
        event.stopPropagation()
        this.contextMenu.open([
            { label: this.translate.instant('New session'), icon: 'fas fa-plus', click: () => this.commands.run('settings:new-profile', {}) },
            { label: this.translate.instant('New group'), icon: 'fas fa-folder-plus', click: () => this.newGroup() },
        ], event)
    }

    canDragProfile (profile: PartialProfile<Profile>): boolean {
        return !this.savingMove && !!profile.id && this.savedProfileIds.has(profile.id)
    }

    get filteredDropGroups (): PartialProfileGroup<ProfileGroup>[] {
        return this.profileGroups.filter(g => g.editable === true || g.id === 'ungrouped')
    }

    dropGroupName (group: PartialProfileGroup<ProfileGroup>): string {
        return group.id === 'ungrouped' ? group.name : this.profilesService.resolveProfileGroupPath(group.id).join(' / ')
    }

    onProfileDragStart (profile: PartialProfile<Profile>, event: DragEvent): void {
        if (!this.canDragProfile(profile) || !event.dataTransfer) {
            event.preventDefault()
            return
        }
        this.draggedProfileId = profile.id!
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-tabby-profile', profile.id!)
        event.stopPropagation()
    }

    canDropProfile (group: PartialProfileGroup<ProfileGroup>): boolean {
        if (!this.draggedProfileId || this.savingMove) { return false }
        const profile = this.config.store.profiles.find(p => p.id === this.draggedProfileId)
        if (!profile || !this.savedProfileIds.has(this.draggedProfileId)) { return false }
        const targetId = group.id === 'ungrouped' ? '' : group.id
        if ((profile.group ?? '') === targetId) { return false }
        return group.id === 'ungrouped' || !!group.editable && this.config.store.groups.some(g => g.id === group.id)
    }

    onGroupDragOver (group: PartialProfileGroup<CollapsableProfileGroup>, event: DragEvent): void {
        event.stopPropagation()
        if (!event.dataTransfer?.types.includes('application/x-tabby-profile') || !this.canDropProfile(group)) {
            this.clearDropTarget()
            if (event.dataTransfer) { event.dataTransfer.dropEffect = 'none' }
            return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (this.dropTargetId === group.id) { return }
        this.clearDropTarget()
        this.dropTargetId = group.id
        if (group.collapsed) {
            this.expandGroupTimeout = setTimeout(() => {
                group.collapsed = false
                this.saveProfileGroupCollapse(group)
                this.expandGroupTimeout = null
            }, 600)
        }
    }

    onGroupDragLeave (event: DragEvent): void {
        event.stopPropagation()
        const current = event.currentTarget as HTMLElement
        if (event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) { return }
        this.clearDropTarget()
    }

    async onProfileDrop (group: PartialProfileGroup<CollapsableProfileGroup>, event: DragEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        if (event.dataTransfer?.getData('application/x-tabby-profile') !== this.draggedProfileId || !this.canDropProfile(group)) {
            this.onProfileDragEnd()
            return
        }
        const profileId = this.draggedProfileId!
        const profile = this.config.store.profiles.find(p => p.id === profileId)!
        const previousGroup = profile.group
        this.onProfileDragEnd()
        this.savingMove = true
        try {
            if (this.profilesService.moveProfileToGroup(profileId, group.id === 'ungrouped' ? null : group.id)) {
                group.collapsed = false
                this.saveProfileGroupCollapse(group)
                await this.config.save()
                await this.loadTreeItems()
            }
        } catch (error) {
            profile.group = previousGroup
            this.notifications.error(this.translate.instant('Could not move session'), error instanceof Error ? error.message : String(error))
            await this.loadTreeItems()
        } finally {
            this.savingMove = false
        }
    }

    @HostListener('document:dragend')
    onProfileDragEnd (): void {
        this.draggedProfileId = null
        this.clearDropTarget()
    }

    private clearDropTarget (): void {
        if (this.expandGroupTimeout) { clearTimeout(this.expandGroupTimeout) }
        this.expandGroupTimeout = null
        this.dropTargetId = null
    }

    ngOnDestroy (): void {
        this.onProfileDragEnd()
        super.ngOnDestroy()
    }

    private tabStateChanged (): void {
        this.recentProfiles = this.profilesService.getRecentProfiles().filter(p => !this.config.store.profileBlacklist.includes(p.id))
    }

    get activeProfileId (): string|undefined {
        let tab = this.app.activeTab
        if (tab instanceof SplitTabComponent) { tab = tab.getFocusedTab() }
        return (tab as (BaseTabComponent & { profile?: PartialProfile<Profile> })|null)?.profile?.id
    }

    async quickConnect (): Promise<void> {
        const query = this.quickConnectQuery.trim()
        if (!query || this.connecting) { return }
        this.connecting = true
        try {
            const profile = await this.profilesService.quickConnect(query)
            if (profile) {
                await this.launchProfile(profile)
                this.quickConnectQuery = ''
            }
        } finally {
            this.connecting = false
        }
    }

    async toggleSidebar (): Promise<void> {
        this.sidebarClosed.emit()
        this.config.store.showProfileTree = false
        await this.config.save()
    }

    async launchProfile<P extends Profile> (profile: PartialProfile<P>): Promise<any> {
        return this.profilesService.launchProfile(profile)
    }

    async onFilterChange (): Promise<void> {
        try {
            const q = this.filter.trim().toLowerCase()

            if (q.length === 0) {
                this.rootGroups = this.profilesService.buildGroupTree(this.profileGroups)
                return
            }

            const profiles = await this.profilesService.getProfiles({
                includeBuiltin: this.config.store.terminal.showBuiltinProfiles,
                clone: true,
            })

            const matches = new FuzzySearch(
                profiles.filter(p => !p.isTemplate && !this.config.store.profileBlacklist.includes(p.id)),
                ['name', 'description'],
                { sort: false },
            ).search(q)

            this.rootGroups = [
                {
                    id: 'search',
                    editable: false,
                    name: this.translate.instant('Filter results'),
                    icon: 'fas fa-magnifying-glass',
                    profiles: matches,
                },
            ]
        } catch (error) {
            console.error('Error occurred during search:', error)
        }
    }

    ////// RESIZING //////
    startResize (event: MouseEvent): void {
        this.panelIsResizing = true
        this.panelStartX = event.clientX
        this.panelStartWidth = this.panelWidth
        event.preventDefault()
    }

    @HostListener('document:mousemove', ['$event'])
    onMouseMove (event: MouseEvent): void {
        if (!this.panelIsResizing) { return }
        const delta = event.clientX - this.panelStartX
        const width = Math.min(Math.max(this.panelMinWidth, this.panelStartWidth + delta), this.panelMaxWidth)
        this.panelWidth = width
        window.localStorage.profileTreeWidth = width
    }

    @HostListener('document:mouseup')
    stopResize (): boolean {
        this.panelIsResizing = false
        return true
    }

    @HostBinding('style.width.px')
    get panelWidth (): number {
        return this.panelInternalWidth
    }

    set panelWidth (value: number) {
        this.panelInternalWidth = value
    }

    ////// GROUP COLLAPSING //////
    toggleGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        group.collapsed = !group.collapsed
        this.saveProfileGroupCollapse(group)
    }

    private saveProfileGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        profileGroupCollapsed[group.id] = group.collapsed
        window.localStorage.profileGroupCollapsed = JSON.stringify(profileGroupCollapsed)
    }

    private static intoPartialCollapsableProfileGroup (group: PartialProfileGroup<ProfileGroup>, collapsed: boolean): PartialProfileGroup<CollapsableProfileGroup> {
        const collapsableGroup = {
            ...group,
            collapsed,
        }
        return collapsableGroup
    }

}
