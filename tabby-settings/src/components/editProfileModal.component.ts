/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Observable, OperatorFunction, debounceTime, map, distinctUntilChanged } from 'rxjs'
import { Component, Input, ViewChild, ViewContainerRef, ComponentFactoryResolver, Injector } from '@angular/core'
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { PartialProfileGroup, Profile, ProfileProvider, ProfileSettingsComponent, ProfilesService, TAB_COLORS, ProfileGroup, ConnectableProfileProvider, FullyDefined, ConfigProxy, ConfigService, NotificationsService, TranslateService } from 'tabby-core'
import { EditProfileGroupModalComponent, EditProfileGroupModalComponentResult } from './editProfileGroupModal.component'

const iconsData = require('../../../tabby-core/src/icons.json')
const iconsClassList = Object.keys(iconsData).map(
    icon => iconsData[icon].map(
        style => `fa${style[0]} fa-${icon}`,
    ),
).flat()

/** @hidden */
@Component({
    templateUrl: './editProfileModal.component.pug',
})
export class EditProfileModalComponent<P extends Profile, PP extends ProfileProvider<P>> {
    @Input('profile') partialProfile: P
    @Input() profileProvider: PP
    @Input() settingsComponent: new () => ProfileSettingsComponent<P, PP>
    @Input() defaultsMode: 'enabled'|'group'|'disabled' = 'disabled'
    @Input() profileGroup: PartialProfileGroup<ProfileGroup> | undefined
    groups: PartialProfileGroup<ProfileGroup>[] = []
    loadingGroups = true
    creatingGroup = false
    @ViewChild('placeholder', { read: ViewContainerRef }) placeholder: ViewContainerRef

    protected profile: FullyDefined<P> & ConfigProxy<FullyDefined<P>>
    private settingsComponentInstance?: ProfileSettingsComponent<P, PP>

    constructor (
        private injector: Injector,
        private componentFactoryResolver: ComponentFactoryResolver,
        private profilesService: ProfilesService,
        private modalInstance: NgbActiveModal,
        private modal: NgbModal,
        private config: ConfigService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    colorsAutocomplete = text$ => text$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        map((q: string) =>
            TAB_COLORS
                .filter(x => !q || x.name.toLowerCase().startsWith(q.toLowerCase()))
                .map(x => x.value),
        ),
    )

    colorsFormatter = value => {
        return TAB_COLORS.find(x => x.value === value)?.name ?? value
    }

    async ngOnInit (): Promise<void> {
        this.profile = this.profilesService.getConfigProxyForProfile<P>(this.partialProfile, { skipGlobalDefaults: this.defaultsMode === 'enabled', skipGroupDefaults: this.defaultsMode === 'group' })
        if (this.defaultsMode === 'disabled') {
            this.groups = await this.profilesService.getProfileGroups()
            this.profileGroup = this.groups.find(g => g.id === this.partialProfile.group)
        }
        this.loadingGroups = false
    }

    ngAfterViewInit () {
        const componentType = this.profileProvider.settingsComponent
        if (componentType) {
            setTimeout(() => {
                const componentFactory = this.componentFactoryResolver.resolveComponentFactory(componentType)
                const componentRef = componentFactory.create(this.injector)
                this.settingsComponentInstance = componentRef.instance
                this.settingsComponentInstance.profile = this.profile
                this.placeholder.insert(componentRef.hostView)
            })
        }
    }

    groupLabel (group: PartialProfileGroup<ProfileGroup>): string {
        return this.profilesService.resolveProfileGroupPath(group.id).join(' / ')
    }

    selectGroup (groupId: string): void {
        this.profileGroup = this.groups.find(g => g.id === groupId)
        this.profile.group = this.profileGroup?.id ?? ''
        this.profilesService.refreshConfigProxyForProfile<P>(this.profile)
    }

    async newGroup (): Promise<void> {
        if (this.loadingGroups || this.creatingGroup) { return }
        this.creatingGroup = true
        try {
            const dialog = this.modal.open(EditProfileGroupModalComponent, { size: 'lg' })
            dialog.componentInstance.group = { id: 'new', name: '', icon: 'far fa-folder' }
            dialog.componentInstance.providers = []
            const result: EditProfileGroupModalComponentResult<ProfileGroup>|null = await dialog.result.catch(() => null)
            if (!result) { return }
            try {
                await this.config.save()
            } catch (error) {
                // The group editor inserts the new group before returning it.
                this.config.store.groups = this.config.store.groups.filter(g => g.id !== result.group.id)
                this.notifications.error(this.translate.instant('Could not create group'), error instanceof Error ? error.message : String(error))
                return
            }
            this.groups = await this.profilesService.getProfileGroups()
            this.selectGroup(result.group.id)
        } finally {
            this.creatingGroup = false
        }
    }

    iconSearch: OperatorFunction<string, string[]> = (text$: Observable<string>) =>
        text$.pipe(
            debounceTime(200),
            map(term => iconsClassList.filter(v => v.toLowerCase().includes(term.toLowerCase())).slice(0, 10)),
        )

    save () {
        if (this.loadingGroups || this.creatingGroup) { return }
        if (this.defaultsMode === 'disabled') {
            this.profile.group = this.profileGroup?.id ?? ''
        }

        this.settingsComponentInstance?.save?.()
        this.profile.__cleanup()
        this.modalInstance.close(this.partialProfile)
    }

    cancel () {
        this.modalInstance.dismiss()
    }

    isConnectable (): boolean {
        return this.profileProvider instanceof ConnectableProfileProvider
    }

}
